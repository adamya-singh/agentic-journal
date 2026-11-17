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

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const DEFAULT_ORIGIN = 'https://ubuntu-laptop.taile85e97.ts.net';

/** "Box.example:3000" → "box.example"; "[::1]:3111" → "[::1]". */
function nameOf(host: string): string {
  const h = host.trim().toLowerCase();
  const name = h.startsWith('[') ? h.slice(0, h.indexOf(']') + 1) : h.split(':').length === 2 ? h.split(':')[0]! : h;
  return name.replace(/\.$/, '');
}

/**
 * The names the Journal is reached by, on any port: loopback; the host of AGENTIC_JOURNAL_ORIGIN, the public address
 * the app already uses for its links (by default this laptop's Tailscale name); and any names in
 * AGENTIC_JOURNAL_HOSTS (comma-separated, e.g. "box.tail1234.ts.net,journal.lan").
 */
export function journalHostNames(env: Record<string, string | undefined> = process.env): Set<string> {
  const names = new Set(LOOPBACK);
  try { names.add(nameOf(new URL(env.AGENTIC_JOURNAL_ORIGIN || DEFAULT_ORIGIN).host)); } catch { /* a bad value adds nothing */ }
  for (const part of (env.AGENTIC_JOURNAL_HOSTS ?? '').split(',')) if (part.trim()) names.add(nameOf(part));
  return names;
}

/**
 * fromThisApp, made stricter, for the routes that run coding agents on his machines:
 * - a request that says nothing of where it comes from (neither Sec-Fetch-Site nor Origin) is refused;
 * - the host asked (the Host header, and X-Forwarded-Host when a proxy sends one) must be one of the Journal's own
 *   names (journalHostNames), and so must the page's Origin. Without this, a page on another site that points its
 *   own name at this machine (DNS rebinding) would pass: over plain http it sends no Sec-Fetch-Site, and its Origin
 *   matches the Host it asked by construction.
 * This stops other web pages in his browser. It does not stop a program on the machine, which can send any headers
 * it likes (and could reach the agents' own sockets anyway).
 */
export function fromThisAppStrict(headers: HeaderBag, env: Record<string, string | undefined> = process.env): boolean {
  const origin = headers.get('origin');
  if (!headers.get('sec-fetch-site') && !origin) return false;
  const known = journalHostNames(env);
  const host = headers.get('host');
  const forwarded = headers.get('x-forwarded-host');
  if (!host || !known.has(nameOf(host))) return false;
  if (forwarded !== null && !known.has(nameOf(forwarded))) return false;
  if (origin) {
    try { if (!known.has(nameOf(new URL(origin).host))) return false; } catch { return false; }
  }
  return fromThisApp(headers);
}
