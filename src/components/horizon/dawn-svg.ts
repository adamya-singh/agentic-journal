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

// Dailies ring the sun: one arc each across its top half, left to right. Shared with the 3D sun and the
// click targets over the flat drawing, so all three line up.
export const DAILY_R = 69;
export function dailyArcs(n: number): { a0: number; a1: number; mid: number }[] {
  const gap = 4, seg = (180 - gap * (n + 1)) / n;
  return Array.from({ length: n }, (_, i) => {
    const a0 = 180 - gap - i * (seg + gap);
    return { a0, a1: a0 - seg, mid: a0 - seg / 2 };
  });
}

export const ZONE_NAMES: Record<string, [string, string]> = {
  ignition: ['Ignition', 'next 48h'], climb: ['Climb', 'this week'], altitude: ['Altitude', 'next week'], orbit: ['Orbit', 'later'],
};

// Pulled back: the camera moves away from the sun so two more rings fit past Orbit. The sun and its
// dailies keep their size; the rings close in around it and the pills shrink a little.
export const PULL = {
  R: [60, 145, 229, 305, 372, 452, 538],
  pill: 0.8,
  orbitDays: 30,
  seasonDays: 90,
  beyondDays: 365,
  bands: ['rgba(207,196,255,.035)', 'rgba(207,196,255,.018)'],
  ring: 'rgba(207,196,255,.28)',
  further: 'rgba(207,196,255,.6)',
};

const SANS = 'var(--font-geist-sans), Geist, sans-serif';
// Single quotes: these go inside style="…" attributes.
const MONO = "var(--font-geist-mono), 'Geist Mono', monospace";
const SERIF = "var(--font-instrument-serif), 'Instrument Serif', serif";

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

export const FAN_LEFT = 174, FAN_RIGHT = 6, SECTOR_GAP = 2;

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

export interface PillSpot { item: HorizonItem; x: number; y: number; s?: number }   // s: pill scale, 1 when unset

export interface PullView { spots: PillSpot[]; sectors: Sector[]; names: [string, string][] }

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOut = (now: Date, days: number) => { const d = new Date(now.getTime() + days * 864e5); return `to ${MON[d.getMonth()]} ${d.getDate()}`; };

// Where a task sits once pulled back: the near rings keep Dawn's own spacing, squeezed into theirs;
// Orbit becomes the next month, then the season, then the rest of the year.
function radiusPulled(it: HorizonItem, data: HorizonData): number {
  const R = DAWN.R, P = PULL.R, pad = 14;
  const i = HORIZON_RING_ZONES.indexOf(it.zone as typeof HORIZON_RING_ZONES[number]);
  if (i >= 0 && i < 3) return P[i] + (radiusFor(it, data) - R[i]) / (R[i + 1] - R[i]) * (P[i + 1] - P[i]);
  const ends = [data.bounds.altitude, PULL.orbitDays * 24, PULL.seasonDays * 24, PULL.beyondDays * 24];
  const b = it.hours <= ends[1] ? 0 : it.hours <= ends[2] ? 1 : 2;
  const f = Math.max(0, Math.min(1, (it.hours - ends[b]) / Math.max(1, ends[b + 1] - ends[b])));
  return P[3 + b] + pad + (P[4 + b] - P[3 + b] - 2 * pad) * f;
}

const overlap = (b: Box, o: Box) => Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1]));

export function pullLayout(data: HorizonData): PullView {
  const { W, H, X } = DAWN, P = PULL.R, s = PULL.pill;
  const pt = (r: number, deg: number): [number, number] => [X + r * Math.cos(deg * Math.PI / 180), H - r * Math.sin(deg * Math.PI / 180)];
  const all = data.items.concat(data.further);
  const sectors = sectorsFor({ ...data, items: all });
  const secBy = new Map(sectors.map((sec) => [sec.group, sec]));
  const core = data.dailies.length ? DAILY_R + 6 : P[0] + 8;
  const boxes: Box[] = [[X - core, H - core, X + core, H], [0, 0, 420, 150], [W - 400, 0, W, 110]];
  const spots: PillSpot[] = [];
  all.slice().sort((a, b) => a.hours - b.hours).forEach((it) => {
    const sec = secBy.get(it.group) as Sector, half = (sec.a0 - sec.a1) / 2;
    const r = radiusPulled(it, data), w = (textWidth(it.short, it.weight >= 4 ? 600 : 500) + 24) * s;
    const cands: { p: [number, number]; cost: number }[] = [];
    [0, 8, -8, 16, -16, 26, -26, 38, -38].forEach((dr, di) => [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9].forEach((f, fi) => cands.push({ p: pt(Math.max(P[0] + 30, r + dr), sec.mid + f * half), cost: di * 1.2 + fi })));
    [1.3, -1.3, 1.8, -1.8, 2.4, -2.4].forEach((f) => [0, 14, -14].forEach((dr) => cands.push({ p: pt(r + dr, sec.mid + f * half), cost: 30 + Math.abs(f) * 4 + Math.abs(dr) / 7 })));
    cands.sort((a, b) => a.cost - b.cost);
    const boxAt = (c: [number, number]): Box => [c[0] - w / 2 - 5, c[1] - 16 * s, c[0] + w / 2 + 5, c[1] + 30 * s];
    const inside = (b: Box) => b[0] >= 4 && b[2] <= W - 4 && b[1] >= 4 && b[3] <= H - 4;
    const cost = (b: Box) => boxes.reduce((sum, o) => sum + overlap(b, o), 0);
    // The first free spot; failing that, the one that covers the least.
    let best = cands.find((c) => { const b = boxAt(c.p); return inside(b) && cost(b) === 0; });
    if (!best) {
      let bv = Infinity;
      for (const c of cands) { const b = boxAt(c.p); if (!inside(b)) continue; const v = cost(b) + c.cost * 30; if (v < bv) { bv = v; best = c; } }
    }
    const p = best ? best.p : pt(r, sec.mid);
    boxes.push(boxAt(p));
    spots.push({ item: it, x: p[0], y: p[1], s });
  });
  const now = new Date(data.now);
  const names: [string, string][] = [ZONE_NAMES.ignition, ZONE_NAMES.climb, ZONE_NAMES.altitude,
    ['Orbit', dayOut(now, PULL.orbitDays)], ['Season', dayOut(now, PULL.seasonDays)], ['Beyond', 'later']];
  return { spots, sectors, names };
}

function pillSvg(it: HorizonItem, further: boolean): string {
  const k = it.zone === 'hold' ? 'orbit' : it.zone, st = DAWN.pills[k];
  const fw = it.weight >= 4 ? 600 : 500, w = textWidth(it.short, fw) + 24, x0 = -w / 2;
  let s = '';
  if (st[3]) s += `<rect x="${(x0 - 4).toFixed(1)}" y="-18" width="${(w + 8).toFixed(1)}" height="36" rx="18" fill="${st[3]}" opacity=".35" filter="url(#hz-blur)"/>`;
  s += `<rect x="${x0.toFixed(1)}" y="-14" width="${w.toFixed(1)}" height="28" rx="14" fill="${st[0]}" stroke="${further ? PULL.further : st[1]}"/>`;
  s += `<text x="0" y="4.6" text-anchor="middle" style="font-family:${SANS}" font-size="13" font-weight="${fw}" fill="${st[2]}">${esc(it.short)}</text>`;
  s += `<text x="0" y="25" text-anchor="middle" style="font-family:${MONO}" font-size="10.5" fill="${DAWN.date}" opacity="${k === 'orbit' ? 0.55 : 0.8}">${esc(it.day)}</text>`;
  return s;
}

const sectorLabel = (sec: Sector) => {
  const c = Math.cos(sec.mid * Math.PI / 180), anchor = c > 0.25 ? 'start' : c < -0.25 ? 'end' : 'middle';
  return `<g class="hz-sl" data-mid="${sec.mid.toFixed(2)}"><text y="3" text-anchor="${anchor}" style="font-family:${MONO}" font-size="10" letter-spacing="1.6" fill="#d6dde8" opacity=".7">${esc(sec.group.toUpperCase())}</text></g>`;
};

export function drawDawn(svg: SVGSVGElement, data: HorizonData): { spots: PillSpot[]; sectors: Sector[]; pulled: PullView } {
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
    '<filter id="hz-dglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>' +
    '<filter id="hz-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>' +
    `<clipPath id="hz-above"><rect width="${W}" height="${H}"/></clipPath></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#hz-sky)"/>`;
  s += starField(W, H * 0.6, DAWN.stars);
  // What rolls when the dome turns (rings, slices, pills) is in .hz-face; the sky, sun, dailies and ground stay.
  s += '<g class="hz-face" clip-path="url(#hz-above)">';
  // Rings 5 and 6 only show when pulled back; at rest they sit invisibly on the outer ring.
  for (let idx = 5; idx >= 0; idx -= 1) {
    const extra = idx >= 4;
    s += `<circle class="hz-ring" data-i="${idx + 1}" cx="${X}" cy="${H}" r="${R[Math.min(idx + 1, 4)]}" fill="${extra ? PULL.bands[idx - 4] : DAWN.bands[idx]}" stroke="${extra ? PULL.ring : DAWN.ring}"${idx >= 3 ? ' stroke-dasharray="2 6"' : ''}${extra ? ' opacity="0"' : ''}/>`;
  }
  s += `<circle class="hz-haze" cx="${X}" cy="${H}" r="${R[2]}" fill="url(#hz-haze)"/>`;
  const sectors = sectorsFor(data);
  const pulled = pullLayout(data);
  // Faint rays between slices, and each slice's name just outside the last ring. The pulled-back view has its own.
  const rays = (secs: Sector[], r1: number) => secs.slice(1).map((sec) => {
    const a = sec.a0 + SECTOR_GAP / 2, p0 = pt(R[0] + 8, a), p1 = pt(r1 + 6, a);
    return `<line x1="${p0[0].toFixed(1)}" y1="${p0[1].toFixed(1)}" x2="${p1[0].toFixed(1)}" y2="${p1[1].toFixed(1)}" stroke="rgba(255,255,255,.09)"/>`;
  }).join('');
  s += `<g class="hz-rays-a">${rays(sectors, R[4])}</g><g class="hz-rays-b" opacity="0">${rays(pulled.sectors, PULL.R[6])}</g>`;
  s += '</g><g clip-path="url(#hz-above)">';
  const dailies = data.dailies, doneN = dailies.filter((d) => d.done).length;
  // The sun glows wider as the day's dailies get done.
  if (dailies.length) {
    const all = doneN === dailies.length;
    s += `<circle cx="${X}" cy="${H}" r="${all ? 104 : 72}" fill="${DAWN.haze}" opacity="${(0.12 + 0.5 * doneN / dailies.length).toFixed(2)}" filter="url(#hz-bloom)"/>`;
  }
  s += `<circle cx="${X}" cy="${H}" r="${R[0]}" fill="url(#hz-sun)"/></g>`;
  dailyArcs(dailies.length).forEach((arc, i) => {
    const d = dailies[i], p0 = pt(DAILY_R, arc.a0), p1 = pt(DAILY_R, arc.a1);
    const path = `M ${p0[0].toFixed(1)} ${p0[1].toFixed(1)} A ${DAILY_R} ${DAILY_R} 0 0 1 ${p1[0].toFixed(1)} ${p1[1].toFixed(1)}`;
    if (d.done) s += `<path d="${path}" fill="none" stroke="#ffb37a" stroke-width="7" stroke-linecap="round" opacity=".8" filter="url(#hz-dglow)"/>`;
    s += `<path class="hz-dseg${d.done ? ' done' : ''}" data-daily="${esc(d.id)}" d="${path}" fill="none" stroke="${d.done ? '#fff6ec' : 'rgba(255,236,214,.38)'}" stroke-width="4.5" stroke-linecap="round"/>`;
  });
  s += '<g class="hz-face">';
  s += `<g class="hz-sl-a">${sectors.map(sectorLabel).join('')}</g><g class="hz-sl-b" opacity="0">${pulled.sectors.map(sectorLabel).join('')}</g>`;
  s += '</g>';
  s += `<text x="${X}" y="${H - (dailies.length ? 29 : 20)}" text-anchor="middle" style="font-family:${MONO}" font-size="10" letter-spacing="2" fill="${DAWN.sunText}">YOU</text>`;
  if (dailies.length) {
    const count = doneN === dailies.length ? 'ALL DONE' : `${doneN} OF ${dailies.length} DAILY`;
    s += `<text x="${X}" y="${H - 12}" text-anchor="middle" style="font-family:${MONO}" font-size="9" letter-spacing="1.4" fill="#7a3a10">${count}</text>`;
  }
  s += `<rect y="${H}" width="${W}" height="${G}" fill="url(#hz-gr)"/>`;
  s += `<rect x="0" y="${H - 1}" width="${W}" height="1.5" fill="${DAWN.line}"/>`;
  // Ground ring names, today's and the pulled-back view's. Each sits in a group at x=0 so it can slide.
  const groundName = (nm: [string, string], i: number) => `<g class="hz-zn" data-i="${i}">` +
    `<line x1="0" x2="0" y1="${H}" y2="${H + 7}" stroke="${DAWN.groundInk}"/>` +
    `<text x="0" y="${H + 30}" text-anchor="middle" style="font-family:${SERIF}" font-size="24" font-style="italic" fill="${DAWN.groundInk}">${esc(nm[0])}</text>` +
    `<text x="0" y="${H + 46}" text-anchor="middle" style="font-family:${MONO}" font-size="9.5" letter-spacing="1.4" fill="${DAWN.groundInk}" opacity=".7">${esc(nm[1].toUpperCase())}</text></g>`;
  s += `<g class="hz-zg-a"><g class="hz-ztoday">${HORIZON_RING_ZONES.map((k, i) => groundName(ZONE_NAMES[k], i)).join('')}</g></g>`;
  s += `<g class="hz-zg-b" opacity="0">${pulled.names.map(groundName).join('')}</g>`;
  s += '<g class="hz-face">';
  const core = data.dailies.length ? DAILY_R + 6 : R[0] + 8;   // keep pills off the sun and its ring of dailies
  const boxes: Box[] = [[X - core, H - core, X + core, H], [0, 0, 420, 150], [W - 400, 0, W, 110]];
  // Place pills nearest-due first, so the most urgent ones keep their ideal spot.
  const secBy = new Map(sectors.map((sec) => [sec.group, sec]));
  data.items.slice().sort((a, b) => a.hours - b.hours).forEach((it) => {
    const sec = secBy.get(it.group) as Sector;
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
    s += `<g class="hz-pill" data-id="${esc(it.id)}" transform="translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})">${pillSvg(it, false)}</g>`;
    spots.push({ item: it, x: p[0], y: p[1] });
  });
  // Tasks only the pulled-back view has room for wait, hidden, until the camera moves.
  data.further.forEach((it) => {
    s += `<g class="hz-pill hz-further" data-id="${esc(it.id)}" opacity="0">${pillSvg(it, true)}</g>`;
  });
  s += '</g>';
  svg.setAttribute('viewBox', `0 0 ${W} ${H + G}`);
  svg.innerHTML = s;
  pullCache.delete(svg);
  return { spots, sectors, pulled };
}

// ---- pulling back: z runs from 0 (today's Dawn) to 1 (pulled back) ----
interface PullEls {
  rings: SVGCircleElement[]; haze: SVGCircleElement | null;
  raysA: SVGGElement | null; raysB: SVGGElement | null; slA: SVGGElement[]; slB: SVGGElement[];
  zgA: SVGGElement | null; zgB: SVGGElement | null; znA: SVGGElement[]; znB: SVGGElement[];
  pills: Map<string, SVGGElement>;
}
const pullCache = new WeakMap<SVGSVGElement, PullEls>();
function pullEls(svg: SVGSVGElement): PullEls {
  let c = pullCache.get(svg);
  if (c) return c;
  const q = <T extends Element>(sel: string) => [...svg.querySelectorAll<T>(sel)];
  c = {
    rings: q<SVGCircleElement>('circle.hz-ring').sort((a, b) => Number(a.dataset.i) - Number(b.dataset.i)),
    haze: svg.querySelector('circle.hz-haze'),
    raysA: svg.querySelector('.hz-rays-a'), raysB: svg.querySelector('.hz-rays-b'),
    slA: q<SVGGElement>('.hz-sl-a .hz-sl'), slB: q<SVGGElement>('.hz-sl-b .hz-sl'),
    zgA: svg.querySelector('.hz-zg-a'), zgB: svg.querySelector('.hz-zg-b'),
    znA: q<SVGGElement>('.hz-zg-a .hz-zn'), znB: q<SVGGElement>('.hz-zg-b .hz-zn'),
    pills: new Map(q<SVGGElement>('.hz-pill').map((el) => [el.dataset.id as string, el])),
  };
  pullCache.set(svg, c);
  return c;
}

export function applyPull(svg: SVGSVGElement, base: PillSpot[], pulled: PullView, z: number): void {
  const { X, H } = DAWN, R = DAWN.R, P = PULL.R, el = pullEls(svg);
  const lerp = (a: number, b: number) => a + (b - a) * z;
  const fx = (n: number) => n.toFixed(1);
  // Rings close in toward the sun; the two new ones grow out of the old outer ring.
  el.rings.forEach((c) => {
    const i = Number(c.dataset.i);
    c.setAttribute('r', fx(lerp(R[Math.min(i, 4)], P[i])));
    if (i >= 5) c.setAttribute('opacity', z.toFixed(3));
    if (i === 4) c.setAttribute('stroke-dasharray', z < 0.5 ? '2 6' : 'none');
  });
  el.haze?.setAttribute('r', fx(lerp(R[2], P[2])));
  el.raysA?.setAttribute('opacity', (1 - z).toFixed(3));
  el.raysB?.setAttribute('opacity', z.toFixed(3));
  const slR = lerp(R[4] + 16, P[6] + 16);
  const placeSl = (g: SVGGElement) => {
    const a = Number(g.dataset.mid) * Math.PI / 180;
    g.setAttribute('transform', `translate(${fx(X + slR * Math.cos(a))} ${fx(H - slR * Math.sin(a))})`);
  };
  el.slA.forEach(placeSl); el.slB.forEach(placeSl);
  el.slA[0]?.parentElement?.setAttribute('opacity', (1 - z).toFixed(3));
  el.slB[0]?.parentElement?.setAttribute('opacity', z.toFixed(3));
  // Ground names slide to the new rings; today's fade out as the pulled-back set fades in.
  const mid = (rs: number[], i: number) => (rs[i] + rs[i + 1]) / 2;
  const nameAt = (g: SVGGElement, from: number, to: number, w: number) => {
    const sc = Math.max(0.7, Math.min(1, w / 100));
    g.setAttribute('transform', `translate(${fx(X - lerp(from, to))} 0) translate(0 ${H}) scale(${sc.toFixed(3)}) translate(0 ${-H})`);
  };
  el.znA.forEach((g, i) => nameAt(g, mid(R, i), mid(P, i), lerp(R[i + 1] - R[i], P[i + 1] - P[i])));
  el.znB.forEach((g, i) => nameAt(g, i < 4 ? mid(R, i) : R[4] + 30 * (i - 3), mid(P, i), P[i + 1] - P[i]));
  el.zgA?.setAttribute('opacity', (1 - z).toFixed(3));
  el.zgB?.setAttribute('opacity', z.toFixed(3));
  // Pills glide from today's spot to the pulled-back one; the newcomers come in from the outer edge.
  const at = new Map(base.map((s) => [s.item.id, s]));
  pulled.spots.forEach((b) => {
    const g = el.pills.get(b.item.id);
    if (!g) return;
    let a = at.get(b.item.id);
    if (!a) {
      const ang = Math.atan2(H - b.y, b.x - X), r = R[4] + 40;
      a = { item: b.item, x: X + r * Math.cos(ang), y: H - r * Math.sin(ang) };
      g.setAttribute('opacity', Math.min(1, z * 1.4).toFixed(3));
    }
    const sc = lerp(a.s ?? 1, b.s ?? 1);
    g.setAttribute('transform', `translate(${fx(lerp(a.x, b.x))} ${fx(lerp(a.y, b.y))}) scale(${sc.toFixed(4)})`);
  });
}
