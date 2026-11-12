// Whether a request comes from one of this app's own pages. For routes that drive something real (OpenClaw's
// signed-in browser), so that another site's page cannot reach them through his browser.
// Pure: the routes and the tests share it.

interface HeaderBag { get(name: string): string | null }

/**
 * A request from one of this app's own pages. Browsers say so themselves on https and on localhost
 * (Sec-Fetch-Site: same-origin, or none for an address he typed). Where they do not (plain http on a LAN or tailnet
 * address, where browsers leave the header out), the page's Origin must name the host being asked: the Host
 * header, or X-Forwarded-Host when a proxy in front passes the public name along. Another site's page, an image
 * tag on one, or a form posted from one is refused. A request with neither header is not from a browser page at
 * all (the CLI, curl on the machine) and stays allowed, as on every other route here.
 */
export function fromThisApp(headers: HeaderBag): boolean {
  const site = headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = headers.get('origin');
  if (!origin) return true;
  try {
    const asked = new URL(origin).host;
    return [headers.get('host'), headers.get('x-forwarded-host')].some((host) => host !== null && host.toLowerCase() === asked);
  } catch {
    return false;
  }
}
