import fs from 'fs';
import path from 'path';
import { logosDir } from './store';
import { DOMAIN_RE } from './actions';

// Company logos for the casebook, fetched once per domain and kept beside the
// index. Favicon services return 16–48px icons for many companies, so the
// site's own large icons (apple-touch-icon, sized PNG, SVG) are tried first.

const TYPES: Record<string, string> = { png: 'image/png', ico: 'image/x-icon', svg: 'image/svg+xml', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MISS_TTL_MS = 7 * 864e5;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function sniff(buf: Buffer): { ext: string; size: number } | undefined {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { ext: 'png', size: Math.min(buf.readUInt32BE(16), buf.readUInt32BE(20)) };
  if (buf.length > 6 && buf.readUInt32LE(0) === 0x00010000) {
    let best = 0;
    const count = buf.readUInt16LE(4);
    for (let i = 0; i < count && 6 + i * 16 < buf.length; i += 1) best = Math.max(best, buf[6 + i * 16] || 256);
    // .ico files often lead with a 16px frame and browsers may show it, so they rank below any real PNG or SVG.
    return { ext: 'ico', size: Math.min(best, 64) };
  }
  const head = buf.subarray(0, 512).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return { ext: 'svg', size: 512 };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { ext: 'jpg', size: 96 };
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return { ext: 'webp', size: 96 };
  if (buf.subarray(0, 3).toString() === 'GIF') return { ext: 'gif', size: 32 };
  return undefined;
}

async function get(url: string, ms = 8000): Promise<{ buf: Buffer; url: string } | undefined> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, redirect: 'follow', signal: AbortSignal.timeout(ms) });
    if (!res.ok) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 0 && buf.length < 2_000_000 ? { buf, url: res.url || url } : undefined;
  } catch {
    return undefined;
  }
}

/** Icon URLs a homepage declares, biggest first. */
export function iconLinks(html: string, base: string): string[] {
  const found: { href: string; score: number }[] = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const rel = tag.match(/rel=["']([^"']+)["']/i)?.[1]?.toLowerCase() ?? '';
    if (!/icon/.test(rel) || /mask-icon/.test(rel)) continue;
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const sizes = Number(tag.match(/sizes=["'](\d+)x\d+["']/i)?.[1] ?? 0);
    const svg = /\.svg(\?|$)|image\/svg/i.test(tag);
    const ico = /\.ico(\?|$)|image\/(x-icon|vnd\.microsoft\.icon)/i.test(tag);
    // Opaque app icons first: a transparent SVG mark can be white-on-nothing and vanish on the logo tile.
    const score = /apple-touch/.test(rel) ? 1000 + sizes : !svg && !ico && sizes >= 96 ? 500 + sizes : svg ? 300 : ico ? 20 : sizes || 16;
    try { found.push({ href: new URL(href, base).toString(), score }); } catch {}
  }
  return found.sort((a, b) => b.score - a.score).map((f) => f.href);
}

export async function fetchLogo(domain: string): Promise<{ buf: Buffer; ext: string } | undefined> {
  const home = await get(`https://${domain}/`, 10000);
  const candidates = [
    ...(home ? iconLinks(home.buf.toString('utf8'), home.url) : []),
    `https://${domain}/apple-touch-icon.png`,
    `https://www.google.com/s2/favicons?domain=${domain}&sz=128`,
    `https://icons.duckduckgo.com/ip3/${domain}.ico`,
  ];
  let best: { buf: Buffer; ext: string; size: number } | undefined;
  for (const url of [...new Set(candidates)].slice(0, 7)) {
    const got = await get(url);
    const kind = got && sniff(got.buf);
    if (!got || !kind) continue;
    if (!best || kind.size > best.size) best = { buf: got.buf, ...kind };
    if (kind.size >= 96) break;
  }
  return best && { buf: best.buf, ext: best.ext };
}

export function cachedLogo(domain: string): { file: string; type: string } | 'miss' | undefined {
  if (!DOMAIN_RE.test(domain)) return 'miss';
  for (const ext of Object.keys(TYPES)) {
    const file = path.join(logosDir(), `${domain}.${ext}`);
    if (fs.existsSync(file)) return { file, type: TYPES[ext] };
  }
  const miss = path.join(logosDir(), `${domain}.miss`);
  if (fs.existsSync(miss) && Date.now() - fs.statSync(miss).mtimeMs < MISS_TTL_MS) return 'miss';
  return undefined;
}

/** Fetches and stores a domain's logo unless it's cached; returns the cached file or undefined. */
export async function ensureLogo(domain: string, force = false): Promise<{ file: string; type: string } | undefined> {
  const cached = cachedLogo(domain);
  if (!force && cached === 'miss') return undefined;
  if (!force && cached && cached !== 'miss') return cached;
  fs.mkdirSync(logosDir(), { recursive: true });
  const logo = await fetchLogo(domain);
  if (!logo) {
    fs.writeFileSync(path.join(logosDir(), `${domain}.miss`), new Date().toISOString());
    return undefined;
  }
  for (const ext of Object.keys(TYPES)) fs.rmSync(path.join(logosDir(), `${domain}.${ext}`), { force: true });
  fs.rmSync(path.join(logosDir(), `${domain}.miss`), { force: true });
  const file = path.join(logosDir(), `${domain}.${logo.ext}`);
  fs.writeFileSync(file, logo.buf);
  return { file, type: TYPES[logo.ext] };
}
