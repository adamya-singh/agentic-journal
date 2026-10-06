// Draws the flat Horizon Dawn: a dawn sky, half-rings rising from the horizon around the sun ("you"),
// and a pill for each task on the ring of its zone. Returns where each pill landed so the 3D view
// can rebuild the exact same layout.
import type { HorizonData, HorizonItem } from '@/lib/horizon';
import { HORIZON_RING_ZONES } from '@/lib/horizon';

export const DAWN = {
  W: 1200, H: 560, G: 70, X: 600,
  R: [60, 172, 282, 382, 470],
  sky: [[0, '#05070d'], [0.3, '#0b1730'], [0.58, '#1b3f6e'], [0.8, '#5b7aa6'], [0.92, '#c9a08a'], [1, '#e39a5f']] as [number, string][],
  stars: 130,
  sun: ['#fff6d8', '#ffd27a', '#ff9a3c', '#ff7a2f'],
  sunText: '#5a2a08',
  haze: '#ffc26b',
  bands: ['rgba(255,196,128,.17)', 'rgba(255,196,128,.07)', 'rgba(170,200,240,.05)', 'rgba(170,200,240,.02)'],
  ring: 'rgba(255,255,255,.14)',
  groundBand: ['#d9b48d', '#8a6446'],
  groundInk: '#2a1d14',
  line: 'rgba(255,243,220,.7)',
  date: '#e6ecf4',
  pills: {
    ignition: ['#fff6ec', 'none', '#1b0d05', '#ffb37a'],
    climb: ['rgba(255,255,255,.88)', 'none', '#10213a', ''],
    altitude: ['rgba(255,255,255,.1)', 'rgba(255,255,255,.6)', '#eef2f8', ''],
    orbit: ['none', 'rgba(255,255,255,.28)', 'rgba(238,242,248,.75)', ''],
  } as Record<string, [string, string, string, string]>,
};

export const ZONE_NAMES: Record<string, [string, string]> = {
  ignition: ['Ignition', 'next 48h'], climb: ['Climb', 'this week'], altitude: ['Altitude', 'next week'], orbit: ['Orbit', 'later'],
};

const SANS = 'var(--font-geist-sans), Geist, sans-serif';
const MONO = 'var(--font-geist-mono), "Geist Mono", monospace';
const SERIF = 'var(--font-instrument-serif), "Instrument Serif", serif';

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function textWidth(text: string, weight: number): number {
  if (typeof document === 'undefined') return text.length * 7;
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  const family = getComputedStyle(document.body).getPropertyValue('--font-geist-sans').trim() || 'Geist, sans-serif';
  measureCtx.font = `${weight} 13px ${family}`;
  return measureCtx.measureText(text).width;
}

// Deterministic star field, so the flat drawing and the 3D backdrop share the same stars.
export function starField(w: number, h: number, n: number): string {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  let s = '';
  for (let i = 0; i < n; i += 1) {
    const y = rnd() * h, x = rnd() * w, op = (1 - y / h) * (0.25 + rnd() * 0.7);
    s += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rnd() < 0.08 ? 1.4 : 0.7}" fill="#fff" opacity="${op.toFixed(2)}"/>`;
  }
  return s;
}

type Box = [number, number, number, number];
function place(boxes: Box[], cands: [number, number][], w: number, bounds: Box): [number, number] | null {
  for (const c of cands) {
    const b: Box = [c[0] - w / 2 - 5, c[1] - 16, c[0] + w / 2 + 5, c[1] + 30];
    if (b[0] < bounds[0] || b[2] > bounds[2] || b[1] < bounds[1] || b[3] > bounds[3]) continue;
    if (!boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1])) { boxes.push(b); return c; }
  }
  return null;
}

export interface PillSpot { item: HorizonItem; x: number; y: number }

export function drawDawn(svg: SVGSVGElement, data: HorizonData): PillSpot[] {
  const { W, H, G, X, R } = DAWN;
  const pt = (r: number, deg: number): [number, number] => {
    const a = deg * Math.PI / 180;
    return [X + r * Math.cos(a), H - r * Math.sin(a)];
  };
  const spots: PillSpot[] = [];
  let s = '<defs>' +
    `<linearGradient id="hz-sky" x1="0" y1="0" x2="0" y2="1">${DAWN.sky.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>` +
    `<linearGradient id="hz-gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${DAWN.groundBand[0]}"/><stop offset="1" stop-color="${DAWN.groundBand[1]}"/></linearGradient>` +
    `<radialGradient id="hz-sun" cx=".5" cy=".5" r=".5">${DAWN.sun.map((c, i) => `<stop offset="${[0, 0.55, 0.85, 1][i]}" stop-color="${c}"/>`).join('')}</radialGradient>` +
    `<radialGradient id="hz-haze" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${DAWN.haze}" stop-opacity=".5"/><stop offset=".5" stop-color="${DAWN.haze}" stop-opacity=".15"/><stop offset="1" stop-color="${DAWN.haze}" stop-opacity="0"/></radialGradient>` +
    '<filter id="hz-blur" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>' +
    `<clipPath id="hz-above"><rect width="${W}" height="${H}"/></clipPath></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#hz-sky)"/>`;
  s += starField(W, H * 0.6, DAWN.stars);
  s += '<g clip-path="url(#hz-above)">';
  for (let idx = 3; idx >= 0; idx -= 1) {
    s += `<circle cx="${X}" cy="${H}" r="${R[idx + 1]}" fill="${DAWN.bands[idx]}" stroke="${DAWN.ring}"${idx === 3 ? ' stroke-dasharray="2 6"' : ''}/>`;
  }
  s += `<circle cx="${X}" cy="${H}" r="${R[2]}" fill="url(#hz-haze)"/>`;
  s += `<circle cx="${X}" cy="${H}" r="${R[0]}" fill="url(#hz-sun)"/></g>`;
  s += `<text x="${X}" y="${H - 20}" text-anchor="middle" style="font-family:${MONO}" font-size="10" letter-spacing="2" fill="${DAWN.sunText}">YOU</text>`;
  s += `<rect y="${H}" width="${W}" height="${G}" fill="url(#hz-gr)"/>`;
  s += `<rect x="0" y="${H - 1}" width="${W}" height="1.5" fill="${DAWN.line}"/>`;
  HORIZON_RING_ZONES.forEach((k, i) => {
    const mid = (R[i] + R[i + 1]) / 2, x = X - mid, nm = ZONE_NAMES[k];
    s += `<line x1="${x}" x2="${x}" y1="${H}" y2="${H + 7}" stroke="${DAWN.groundInk}"/>`;
    s += `<text x="${x}" y="${H + 30}" text-anchor="middle" style="font-family:${SERIF}" font-size="24" font-style="italic" fill="${DAWN.groundInk}">${nm[0]}</text>`;
    s += `<text x="${x}" y="${H + 46}" text-anchor="middle" style="font-family:${MONO}" font-size="9.5" letter-spacing="1.4" fill="${DAWN.groundInk}" opacity=".7">${nm[1].toUpperCase()}</text>`;
  });
  const boxes: Box[] = [[X - R[0] - 8, H - R[0] - 8, X + R[0] + 8, H], [0, 0, 420, 150], [W - 400, 0, W, 110]];
  HORIZON_RING_ZONES.forEach((k, i) => {
    const list = data.items.filter((it) => it.zone === k), n = list.length, mid = (R[i] + R[i + 1]) / 2;
    list.forEach((it, j) => {
      const deg = n === 1 ? 90 : 160 - 140 * j / (n - 1);
      const fw = it.weight >= 4 ? 600 : 500;
      const w = textWidth(it.short, fw) + 24;
      const cands: [number, number][] = [];
      [0, 6, -6, 12, -12, 18, -18].forEach((d) => { [0, 20, -20].forEach((dr) => { cands.push(pt(mid + dr, deg + d)); }); });
      const p = place(boxes, cands, w, [4, 4, W - 4, H - 4]) || pt(mid, deg);
      const st = DAWN.pills[k], x0 = p[0] - w / 2;
      if (st[3]) s += `<rect x="${(x0 - 4).toFixed(1)}" y="${p[1] - 18}" width="${(w + 8).toFixed(1)}" height="36" rx="18" fill="${st[3]}" opacity=".35" filter="url(#hz-blur)"/>`;
      s += `<rect x="${x0.toFixed(1)}" y="${p[1] - 14}" width="${w.toFixed(1)}" height="28" rx="14" fill="${st[0]}" stroke="${st[1]}"/>`;
      s += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 4.6).toFixed(1)}" text-anchor="middle" style="font-family:${SANS}" font-size="13" font-weight="${fw}" fill="${st[2]}">${esc(it.short)}</text>`;
      s += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 25).toFixed(1)}" text-anchor="middle" style="font-family:${MONO}" font-size="10.5" fill="${DAWN.date}" opacity="${k === 'orbit' ? 0.55 : 0.8}">${esc(it.day)}</text>`;
      spots.push({ item: it, x: p[0], y: p[1] });
    });
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H + G}`);
  svg.innerHTML = s;
  return spots;
}
