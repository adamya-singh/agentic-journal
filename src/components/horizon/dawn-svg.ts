// Draws the flat Horizon Dawn: a dawn sky, half-rings rising from the horizon around the sun ("you"),
// and a pill for each task on the ring of its zone. Returns where each pill landed so the 3D view
// can rebuild the exact same layout.
import type { HorizonData, HorizonItem } from '@/lib/horizon';
import { HORIZON_RING_ZONES, GROUP_JOBS, GROUP_LIFE, GROUP_OTHER } from '@/lib/horizon';

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

export interface Sector { group: string; a0: number; a1: number; mid: number }

const FAN_LEFT = 174, FAN_RIGHT = 6, SECTOR_GAP = 2;

// One slice of the fan per group, in a fixed order so each subject keeps its direction from day to day:
// courses alphabetically from the left, then Jobs, Other and Life on the right.
export function sectorsFor(data: HorizonData): Sector[] {
  const counts = new Map<string, number>();
  data.holds.forEach((it) => counts.set(it.group, counts.get(it.group) || 0));
  data.items.forEach((it) => counts.set(it.group, (counts.get(it.group) || 0) + 1));
  const tail = [GROUP_JOBS, GROUP_OTHER, GROUP_LIFE];
  const groups = [...counts.keys()].sort((a, b) => {
    const ta = tail.indexOf(a), tb = tail.indexOf(b);
    if (ta !== tb) return ta - tb;
    return a.localeCompare(b);
  });
  const weights = groups.map((g) => Math.max(1.3, counts.get(g) as number));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = FAN_LEFT - FAN_RIGHT - SECTOR_GAP * Math.max(0, groups.length - 1);
  let a = FAN_LEFT;
  return groups.map((group, i) => {
    const w = span * weights[i] / total;
    const sec = { group, a0: a, a1: a - w, mid: a - w / 2 };
    a -= w + SECTOR_GAP;
    return sec;
  });
}

// Distance from the sun grows with the due date: each zone fills its own ring, and inside the ring
// a later due time sits farther out.
export function radiusFor(it: HorizonItem, data: HorizonData): number {
  const R = DAWN.R, pad = 18;
  const span = (lo: number, hi: number, r0: number, r1: number, h: number) => {
    const f = hi > lo ? Math.max(0, Math.min(1, (h - lo) / (hi - lo))) : 0.5;
    return r0 + pad + (r1 - r0 - 2 * pad) * f;
  };
  const { climb, altitude } = data.bounds;
  const h = it.hours;
  if (it.zone === 'ignition') return span(0, Math.min(48, climb), R[0], R[1], h);
  if (it.zone === 'climb') return span(48, climb, R[1], R[2], h);
  if (it.zone === 'altitude') return span(Math.max(48, climb), altitude, R[2], R[3], h);
  // Later: logarithmic over the next couple of months so far-off dates still spread out.
  const f = Math.log1p(Math.max(0, h - altitude) / 24) / Math.log1p(60);
  return R[3] + pad + (R[4] - R[3] - 2 * pad) * Math.min(1, f);
}

export interface PillSpot { item: HorizonItem; x: number; y: number }

export function drawDawn(svg: SVGSVGElement, data: HorizonData): { spots: PillSpot[]; sectors: Sector[] } {
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
  const sectors = sectorsFor(data);
  // Faint rays between slices, and each slice's name just outside the last ring.
  sectors.slice(1).forEach((sec) => {
    const a = sec.a0 + SECTOR_GAP / 2, p0 = pt(R[0] + 8, a), p1 = pt(R[4] + 6, a);
    s += `<line x1="${p0[0].toFixed(1)}" y1="${p0[1].toFixed(1)}" x2="${p1[0].toFixed(1)}" y2="${p1[1].toFixed(1)}" stroke="rgba(255,255,255,.09)"/>`;
  });
  s += `<circle cx="${X}" cy="${H}" r="${R[0]}" fill="url(#hz-sun)"/></g>`;
  sectors.forEach((sec) => {
    const p = pt(R[4] + 16, sec.mid), c = Math.cos(sec.mid * Math.PI / 180);
    const anchor = c > 0.25 ? 'start' : c < -0.25 ? 'end' : 'middle';
    s += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 3).toFixed(1)}" text-anchor="${anchor}" style="font-family:${MONO}" font-size="10" letter-spacing="1.6" fill="#d6dde8" opacity=".7">${esc(sec.group.toUpperCase())}</text>`;
  });
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
  // Place pills nearest-due first, so the most urgent ones keep their ideal spot.
  const secBy = new Map(sectors.map((sec) => [sec.group, sec]));
  data.items.slice().sort((a, b) => a.hours - b.hours).forEach((it) => {
    const sec = secBy.get(it.group) as Sector;
    const k = it.zone;
    const r = radiusFor(it, data);
    const fw = it.weight >= 4 ? 600 : 500;
    const w = textWidth(it.short, fw) + 24;
    const half = (sec.a0 - sec.a1) / 2;
    const cands: [number, number][] = [];
    // Slide along the slice first (same distance, so the due-date order holds), then nudge in or out a little.
    const inSlice = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
    [0, 8, -8, 16, -16, 24, -24].forEach((dr) => inSlice.forEach((f) => cands.push(pt(r + dr, sec.mid + f * half))));
    [1.2, -1.2, 1.6, -1.6, 2.2, -2.2].forEach((f) => [0, 12, -12].forEach((dr) => cands.push(pt(r + dr, sec.mid + f * half))));
    const p = place(boxes, cands, w, [4, 4, W - 4, H - 4]) || pt(r, sec.mid);
    const st = DAWN.pills[k], x0 = p[0] - w / 2;
    if (st[3]) s += `<rect x="${(x0 - 4).toFixed(1)}" y="${p[1] - 18}" width="${(w + 8).toFixed(1)}" height="36" rx="18" fill="${st[3]}" opacity=".35" filter="url(#hz-blur)"/>`;
    s += `<rect x="${x0.toFixed(1)}" y="${p[1] - 14}" width="${w.toFixed(1)}" height="28" rx="14" fill="${st[0]}" stroke="${st[1]}"/>`;
    s += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 4.6).toFixed(1)}" text-anchor="middle" style="font-family:${SANS}" font-size="13" font-weight="${fw}" fill="${st[2]}">${esc(it.short)}</text>`;
    s += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 25).toFixed(1)}" text-anchor="middle" style="font-family:${MONO}" font-size="10.5" fill="${DAWN.date}" opacity="${k === 'orbit' ? 0.55 : 0.8}">${esc(it.day)}</text>`;
    spots.push({ item: it, x: p[0], y: p[1] });
  });
  svg.setAttribute('viewBox', `0 0 ${W} ${H + G}`);
  svg.innerHTML = s;
  return { spots, sectors };
}
