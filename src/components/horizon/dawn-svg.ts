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

export interface PullView { spots: PillSpot[]; sectors: Sector[]; names: [string, string][]; hidden: HorizonItem[] }

// ---- placing pills so no two can ever cover each other ----
export type Box = [number, number, number, number];   // x0, y0, x1, y1
export const boxesHit = (b: Box, o: Box) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1];

// Width of a pill (its name plus padding) and of the date under it, before scaling.
export type Measure = (text: string, weight: number) => number;
export const pillWidth = (it: HorizonItem, measure: Measure = textWidth) => measure(it.short, it.weight >= 4 ? 600 : 500) + 24;
const dateWidth = (it: HorizonItem) => it.day.length * 6.3;   // Geist Mono at 10.5px: 0.6em a character

// What a pill takes up at (x, y): the pill, the date under it (sometimes the wider of the two) and a little air.
export function pillBox(it: HorizonItem, x: number, y: number, s: number, measure: Measure = textWidth): Box {
  const hw = (Math.max(pillWidth(it, measure), dateWidth(it)) / 2 + 5) * s;
  return [x - hw, y - 16 * s, x + hw, y + 30 * s];
}

export interface PillAim { item: HorizonItem; r: number; mid: number; half: number }   // ideal distance and slice
export interface PillField {
  scales: number[];   // pill sizes to try, largest first; the layout shrinks only when the larger size can't fit everyone
  rings: number[];    // ring radii: a pill keeps to its own ring as long as it can
  blocked: Box[];     // the sun, the headline, the capture box
  bounds: Box;
  minR: number;       // nothing closer to the sun than this
  measure?: Measure;
}

const at = (r: number, deg: number): [number, number] => [DAWN.X + r * Math.cos(deg * Math.PI / 180), DAWN.H - r * Math.sin(deg * Math.PI / 180)];

// The spots a pill tries first: slide along its slice at its own distance, so the due-date order holds,
// then nudge in or out a little, then lean into the neighbouring slices. Offsets are [radial px, slice halves].
const NEAR: [number, number][] = [];
[0, 8, -8, 16, -16, 24, -24].forEach((dr) => [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9].forEach((f) => NEAR.push([dr, f])));
[1.2, -1.2, 1.6, -1.6, 2.2, -2.2].forEach((f) => [0, 12, -12].forEach((dr) => NEAR.push([dr, f])));
// Failing those, a fine sweep around the ideal spot, nearest first, favouring along the ring over away
// from it (distance from the sun is the due date). Offsets are [radial px, px along the ring].
const SWEEP: [number, number][] = [];
for (let dr = -120; dr <= 120; dr += 4) for (let t = -300; t <= 300; t += 6) SWEEP.push([dr, t]);
SWEEP.sort((a, b) => Math.hypot(1.6 * a[0], a[1]) - Math.hypot(1.6 * b[0], b[1]));

// Places every pill, nearest-due first so the most urgent keep their ideal spot. Each spot is checked
// against every box already down, so two pills can't overlap by construction. A pill that can't fit near
// its spot looks along its own ring, then spills to a neighbouring one (its date still says when). When
// even that fails, every pill shrinks a step and the layout starts over; at the smallest size a pill may
// go anywhere on the sky that is free, and one that finds no room at all is held back (hidden) rather
// than drawn over another.
export function placePills(aims: PillAim[], field: PillField): { spots: PillSpot[]; hidden: HorizonItem[] } {
  const { bounds, blocked, minR, rings, scales } = field;
  const measure = field.measure ?? textWidth;
  const order = aims.slice().sort((a, b) => a.item.hours - b.item.hours);
  let res: { spots: PillSpot[]; hidden: HorizonItem[] } = { spots: [], hidden: [] };
  scales.some((s, si) => {
    const boxes = blocked.slice();
    res = { spots: [], hidden: [] };
    for (const a of order) {
      let box: Box | null = null;
      const free = (x: number, y: number) => {
        const b = pillBox(a.item, x, y, s, measure);
        if (b[0] < bounds[0] || b[2] > bounds[2] || b[1] < bounds[1] || b[3] > bounds[3]) return false;
        for (const o of boxes) if (boxesHit(b, o)) return false;
        box = b;
        return true;
      };
      const k = rings.findIndex((r, i) => i === rings.length - 1 || a.r < rings[i + 1]);
      const lo = Math.max(minR, rings[k]), hi = rings[k + 1] ?? Infinity;
      const swept = (inRing: boolean) => SWEEP.find(([dr, t]) => {
        const r = a.r + dr;
        if (r < minR || (r >= lo && r <= hi) !== inRing) return false;
        const p = at(r, a.mid + (t / r) * 180 / Math.PI);
        return free(p[0], p[1]);
      });
      let p: [number, number] | undefined = NEAR.map(([dr, f]) => at(Math.max(minR, a.r + dr), a.mid + f * a.half)).find((q) => free(q[0], q[1]));
      if (!p) { const o = swept(true) ?? swept(false); if (o) p = at(a.r + o[0], a.mid + (o[1] / (a.r + o[0])) * 180 / Math.PI); }
      if (!p && si === scales.length - 1) {
        // Last resort: the nearest free spot anywhere on the sky, in growing squares around the ideal one.
        const [cx, cy] = at(a.r, a.mid), step = 6, far = Math.ceil(Math.max(bounds[2], bounds[3]) / step);
        for (let d = 1; d <= far && !p; d += 1) {
          for (let i = -d; i <= d && !p; i += 1) {
            for (const [x, y] of [[cx + i * step, cy - d * step], [cx + i * step, cy + d * step], [cx - d * step, cy + i * step], [cx + d * step, cy + i * step]]) {
              if (free(x, y)) { p = [x, y]; break; }
            }
          }
        }
      }
      if (!p || !box) { res.hidden.push(a.item); continue; }
      boxes.push(box);
      res.spots.push({ item: a.item, x: p[0], y: p[1], ...(s !== 1 ? { s } : {}) });
    }
    return res.hidden.length === 0;
  });
  return res;
}

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

// The sky a pill may use: clear of the sun and its ring of dailies, the headline and the capture box.
function fieldFor(data: HorizonData, rings: number[], minR: number, scales: number[], measure?: Measure): PillField {
  const { W, H, X } = DAWN, core = data.dailies.length ? DAILY_R + 6 : DAWN.R[0] + 8;
  return { scales, rings, minR, measure, bounds: [4, 4, W - 4, H - 4], blocked: [[X - core, H - core, X + core, H], [0, 0, 420, 150], [W - 400, 0, W, 110]] };
}

// Pill sizes, largest first; a crowded sky steps down until every pill fits.
const SHRINK = [1, 0.9, 0.8, 0.72, 0.65];

// Today's Dawn: the ring tasks, each on the ring of its zone in its subject's slice.
export function dawnLayout(data: HorizonData, measure?: Measure): { spots: PillSpot[]; sectors: Sector[]; hidden: HorizonItem[] } {
  const sectors = sectorsFor(data), secBy = new Map(sectors.map((sec) => [sec.group, sec]));
  const aims = data.items.map((item) => {
    const sec = secBy.get(item.group) as Sector;
    return { item, r: radiusFor(item, data), mid: sec.mid, half: (sec.a0 - sec.a1) / 2 };
  });
  return { sectors, ...placePills(aims, fieldFor(data, DAWN.R, DAWN.R[0] + 18, SHRINK, measure)) };
}

export function pullLayout(data: HorizonData, measure?: Measure): PullView {
  const all = data.items.concat(data.further);
  const sectors = sectorsFor({ ...data, items: all });
  const secBy = new Map(sectors.map((sec) => [sec.group, sec]));
  const aims = all.map((item) => {
    const sec = secBy.get(item.group) as Sector;
    return { item, r: radiusPulled(item, data), mid: sec.mid, half: (sec.a0 - sec.a1) / 2 };
  });
  const { spots, hidden } = placePills(aims, fieldFor(data, PULL.R, PULL.R[0] + 30, SHRINK.map((k) => k * PULL.pill), measure));
  const now = new Date(data.now);
  const names: [string, string][] = [ZONE_NAMES.ignition, ZONE_NAMES.climb, ZONE_NAMES.altitude,
    ['Orbit', dayOut(now, PULL.orbitDays)], ['Season', dayOut(now, PULL.seasonDays)], ['Beyond', 'later']];
  return { spots, sectors, names, hidden };
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
  const { spots, sectors, hidden } = dawnLayout(data);
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
  spots.forEach(({ item, x, y, s: k }) => {
    s += `<g class="hz-pill" data-id="${esc(item.id)}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})${k ? ` scale(${k})` : ''}">${pillSvg(item, false)}</g>`;
  });
  // A ring task the sky had no room for (only on a very crowded day) waits with the further ones.
  hidden.forEach((it) => {
    s += `<g class="hz-pill" data-id="${esc(it.id)}" opacity="0">${pillSvg(it, false)}</g>`;
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
  // One the pulled-back sky had no room for fades where it stands.
  pulled.hidden.forEach((it) => { if (at.has(it.id)) el.pills.get(it.id)?.setAttribute('opacity', (1 - z).toFixed(3)); });
}
