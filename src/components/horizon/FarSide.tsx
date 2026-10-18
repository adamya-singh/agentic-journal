'use client';

// The far side of Horizon Dawn. Press the sun and the dome rolls about its horizontal axis: today's rings
// tip toward you into the ground and the far side comes up over the top, carrying action cards (posts
// saved to the Openclaw folder, and things OpenClaw noticed). At rest each face is flat, exactly like
// the Dawn; it is only 3D while it turns. The flat SVG keeps drawing today; this layer takes over the
// moment the dome leaves rest.
import React from 'react';
import { createPortal } from 'react-dom';
import type { HorizonData } from '@/lib/horizon';
import { CARD_WHENS, type ActionCard, type CardAnswer, type FarSideView } from '@/lib/action-cards/types';
import { DAWN, FAN_LEFT, FAN_RIGHT, SECTOR_GAP, textWidth, type PillSpot, type Sector } from './dawn-svg';
import type { DawnSpace } from './dawn-space';
import { ActionCardView, CARD_CSS, SRC_ICON, SRC_NAME, type CardDecisionInput } from './ActionCardView';

const { W, H: SY, X: SX, R } = DAWN;
const VH = 630;                 // the drawing's full height, sky plus ground
const DOME_R = 520, DC = 1500;  // the glass dome around the sun, and how far the eye sits from it (drawing units)
const D = Math.PI / 180;
type V3 = [number, number, number];

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const smooth = (u: number) => { const v = clamp(u, 0, 1); return v * v * (3 - 2 * v); };
/** How far into a turn: 0 resting on either face, 1 once it is ~25° in. */
const spun = (a: number) => smooth(Math.min(Math.abs(a), Math.abs(180 - a)) / 25);
/** Pills fade by how squarely they face you, so a half-turn reads as a handoff. */
const faceOf = (z: number) => smooth((z / DOME_R + 0.08) / 0.5);
const depOf = (z: number) => (z >= 0 ? 1 : Math.max(0, 1 + z / (DOME_R * 0.45)));
const ringDep = (z: number) => (z >= 0 ? 1 : Math.max(0.1, 1 + z / (DOME_R * 0.7)));

/** A point of the flat drawing → on the dome, placed so its flat view lands exactly there. The far face sits upside down on the back. */
function to3(x: number, y: number, back = false): V3 {
  const ux = x - SX, uy = SY - y;
  const a2 = (ux * ux + uy * uy) / (DC * DC), disc = DOME_R * DOME_R * (1 + a2) - a2 * DC * DC;
  const z = disc > 0 ? Math.max(0, (a2 * DC + Math.sqrt(disc)) / (a2 + 1)) : 0, f = (DC - z) / DC;
  return back ? [ux * f, -uy * f, -Math.max(z, 1e-4)] : [ux * f, uy * f, z];
}
/** Roll by `a` degrees about the horizontal axis through the sun → [x, y] in drawing units, scale, depth. */
function proj(P: V3, a: number): [number, number, number, number] {
  const c = Math.cos(a * D), s = Math.sin(a * D);
  const y = P[1] * c - P[2] * s, z = P[1] * s + P[2] * c, sc = DC / (DC - z);
  return [SX + P[0] * sc, SY - y * sc, sc, z];
}
const pt = (r: number, deg: number): [number, number] => [SX + r * Math.cos(deg * D), SY - r * Math.sin(deg * D)];

interface FarSlice { bet: string; label: string; a0: number; a1: number; mid: number }
interface FarSpot { card: ActionCard; x: number; y: number }
type Box = [number, number, number, number];

const BET_ORDER = (bet: string) => (/^bet\d/.test(bet) ? `0${bet}` : bet === 'life' ? '9' : `5${bet}`);
export const RING_NAMES: Record<string, [string, string]> = {
  now: ['Now', 'fits a bet'], period: ['This period', 'build days'], after: ['After finals', 'parked'], someday: ['Someday', 'no date'],
};

/** Lay the cards out like a Dawn face: rings by when they fit the compass, slices by bet. */
function layoutFar(cards: ActionCard[]): { spots: FarSpot[]; slices: FarSlice[] } {
  const labels = new Map<string, string>();
  cards.forEach((c) => { if (!labels.has(c.bet)) labels.set(c.bet, c.betLabel); });
  const bets = [...labels.keys()].sort((a, b) => BET_ORDER(a).localeCompare(BET_ORDER(b)));
  const weights = bets.map((b) => Math.max(1.3, cards.filter((c) => c.bet === b).length));
  const total = weights.reduce((x, y) => x + y, 0);
  const span = FAN_LEFT - FAN_RIGHT - SECTOR_GAP * Math.max(0, bets.length - 1);
  let a = FAN_LEFT;
  const slices = bets.map((bet, i) => {
    const w = span * weights[i] / total, s = { bet, label: labels.get(bet) as string, a0: a, a1: a - w, mid: a - w / 2 };
    a -= w + SECTOR_GAP;
    return s;
  });
  const boxes: Box[] = [[SX - 76, SY - 76, SX + 76, SY], [0, 0, 420, 150], [W - 400, 0, W, 110]];
  const inside = (b: Box) => b[0] >= 4 && b[2] <= W - 4 && b[1] >= 4 && b[3] <= SY - 4;
  const overlap = (b: Box) => boxes.reduce((s, o) => s + Math.max(0, Math.min(b[2], o[2]) - Math.max(b[0], o[0])) * Math.max(0, Math.min(b[3], o[3]) - Math.max(b[1], o[1])), 0);
  const spots: FarSpot[] = [];
  cards.slice().sort((x, y) => y.weight - x.weight).forEach((card) => {
    const sl = slices.find((s) => s.bet === card.bet) as FarSlice, ri = CARD_WHENS.indexOf(card.when);
    const lo = R[ri] + 24, hi = R[ri + 1] - 12, mid = (lo + hi) / 2, w = textWidth(card.short, 500) + 50, half = (sl.a0 - sl.a1) / 2;
    const cands: { p: [number, number]; cost: number }[] = [];
    for (let r = lo; r <= hi; r += 6) for (let f = -1; f <= 1.0001; f += 1 / 16) cands.push({ p: pt(r, sl.mid + f * half * 0.92), cost: Math.abs(r - mid) / 40 + Math.abs(f) * 1.4 });
    for (let r = lo - 24; r <= hi + 70; r += 7) for (let f = -2.4; f <= 2.4001; f += 1 / 8) cands.push({ p: pt(r, sl.mid + f * half), cost: 9 + Math.abs(r - mid) / 25 + Math.abs(f) });
    cands.sort((x, y) => x.cost - y.cost);
    const boxAt = (p: [number, number]): Box => [p[0] - w / 2 - 6, p[1] - 16, p[0] + w / 2 + 6, p[1] + 30];
    let best = cands.find((c) => { const b = boxAt(c.p); return inside(b) && overlap(b) === 0; });
    if (!best) {
      let bv = Infinity;
      for (const c of cands) { const b = boxAt(c.p); if (!inside(b)) continue; const v = overlap(b) + c.cost * 40; if (v < bv) { bv = v; best = c; } }
    }
    const p = best ? best.p : pt(mid, sl.mid);
    boxes.push(boxAt(p));
    spots.push({ card, x: p[0], y: p[1] });
  });
  return { spots, slices };
}

export const FAR_CSS = CARD_CSS + `
.hzx{position:absolute;left:0;top:0;width:100%;aspect-ratio:1200/630;z-index:4;pointer-events:none;visibility:hidden}
.hzx.on{visibility:visible}
.hzx canvas{position:absolute;inset:0;width:100%;height:100%}
.hzx-dusk{position:absolute;inset:0;opacity:0;background:linear-gradient(180deg,rgba(46,24,70,.55) 0,rgba(107,42,88,.5) 55%,rgba(194,79,98,.5) 82%,rgba(242,137,90,.45) 88.9%,rgba(74,34,56,.6) 89%,rgba(40,18,32,.75) 100%)}
.hzx-pills{position:absolute;inset:0;clip-path:inset(0 0 ${((VH - SY) / VH * 100).toFixed(3)}% 0)}
.hzx-m{position:absolute;left:0;top:0;will-change:transform}
.hzx-m.back>*{pointer-events:none}
.hzx-si{display:flex;flex-direction:column;align-items:center}
.hzx-si .p{display:flex;align-items:center;gap:7px;height:30px;padding:0 13px 0 4px;border-radius:15px;font:500 13px var(--hz-sans);white-space:nowrap;cursor:pointer;border:1px solid rgba(255,255,255,.5);background:rgba(8,10,24,.45);color:#f2f0ff;pointer-events:auto;transition:transform .2s cubic-bezier(.2,.9,.3,1.3)}
.hzx-si .p:hover{transform:translateY(-2px) scale(1.04)}
.hzx-si .p:focus-visible{outline:2px solid #ffd2a8;outline-offset:2px}
.hzx-si .p img,.hzx-si .p .ico{width:22px;height:22px;border-radius:50%;flex:none;object-fit:cover}
.hzx-si .p .ico{display:grid;place-items:center;background:rgba(134,230,216,.18);color:#86e6d8}
.hzx-si .p .ico svg{width:12px;height:12px}
.hzx-si.bet .p{background:rgba(255,255,255,.93);color:#141a30;border-color:transparent;box-shadow:0 0 22px 2px rgba(255,150,120,.5)}
.hzx-si.oc .p{border-color:rgba(134,230,216,.75);background:rgba(6,30,32,.55);color:#e8fffb;box-shadow:0 0 18px 1px rgba(134,230,216,.3)}
.hzx-si.oc.bet .p{background:#e6fbf7;color:#0b2a26;border-color:transparent;box-shadow:0 0 22px 3px rgba(134,230,216,.5)}
.hzx-si.oc.bet .p .ico{background:#0b2a26}
.hzx-si .d{position:absolute;left:50%;top:100%;transform:translateX(-50%);margin-top:2px;font:10.5px var(--hz-mono);color:#e6ecf4;opacity:.75;white-space:nowrap}
.hzx-si.sel .p{box-shadow:0 0 0 2px #ffd2a8,0 0 30px 6px rgba(255,210,168,.45)}
.hzx-si.handed .p::after{content:"";width:8px;height:8px;border-radius:50%;background:#86e6d8;box-shadow:0 0 8px #86e6d8;margin-left:2px;animation:hzx-blink 1.1s ease-in-out infinite}
.hzx-si.handed .d::after{content:" · OpenClaw on it";color:#86e6d8}
@keyframes hzx-blink{50%{opacity:.25}}
.hzx-sl{font:10px var(--hz-mono);letter-spacing:1.6px;color:#d6dde8;opacity:.7;white-space:nowrap;text-transform:uppercase}
.hzx-zl{position:absolute;left:0;top:0;text-align:center;color:#2a0f1f;white-space:nowrap;transform-origin:50% 0}
.hzx-zl b{display:block;font:italic 400 24px/1 var(--hz-serif)}
.hzx-zl small{display:block;font:9.5px var(--hz-mono);letter-spacing:1.4px;opacity:.7;margin-top:4px;text-transform:uppercase}
.hzx-empty{position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);max-width:46%;text-align:center;font:italic 400 22px/1.3 var(--hz-serif);color:#efe6f4;text-shadow:0 1px 12px rgba(0,0,0,.4)}
.hzx-empty small{display:block;margin-top:8px;font:13px/1.45 var(--hz-sans);font-style:normal;color:#cdbfd6}
.hzx-sun{position:absolute;border-radius:50%;border:0;padding:0;background:none;cursor:pointer;pointer-events:auto;transform:translate(-50%,-50%);touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.hzx-sun::before{content:"";position:absolute;inset:0;border-radius:50%;clip-path:inset(-80px -80px 50% -80px);pointer-events:none}
.hzx-sun:focus-visible{outline:none}
.hzx-sun:hover::before,.hzx-sun:focus-visible::before{box-shadow:0 0 0 1.5px rgba(255,246,232,.65),0 0 36px 12px rgba(255,186,110,.35)}
.hzx-sun:active::before{box-shadow:0 0 0 2.5px rgba(255,246,232,.95),0 0 48px 18px rgba(255,186,110,.55)}
.hzx-sun.home:hover::before,.hzx-sun.home:focus-visible::before{box-shadow:0 0 0 1.5px rgba(255,228,236,.65),0 0 36px 12px rgba(255,120,110,.35)}
.hzx-sun .l{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%);font:500 10px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:#fff3e2;white-space:nowrap;opacity:0;text-shadow:0 1px 6px rgba(0,0,0,.55);pointer-events:none}
.hzx-sun:hover .l,.hzx-sun:focus-visible .l{opacity:1}
.hz-live .hzx-sun{display:none}
.hzx-pulse{position:absolute;border-radius:50%;border:1.5px solid rgba(255,240,222,.8);pointer-events:none;transform:translate(-50%,-50%);clip-path:inset(-200px -200px 50% -200px);animation:hzx-pulse 1.1s ease-out forwards}
@keyframes hzx-pulse{from{opacity:.75}to{opacity:0;scale:2.4}}
.hzx-flash{position:absolute;width:150px;height:150px;border-radius:50%;pointer-events:none;transform:translate(-50%,-50%);background:radial-gradient(circle,rgba(255,244,220,.95) 0,rgba(255,176,100,.55) 35%,rgba(255,120,60,0) 70%);animation:hzx-flash .9s ease-out forwards}
@keyframes hzx-flash{from{opacity:1;scale:.2}to{opacity:0;scale:2.6}}
.hzx-ov{position:absolute;left:0;top:0;width:100%;aspect-ratio:1200/630;z-index:7;pointer-events:none}
.hzx-toast{position:absolute;right:16px;bottom:calc(${((VH - SY) / VH * 100).toFixed(3)}% + 12px);z-index:4;display:flex;gap:12px;align-items:center;max-width:min(560px,calc(100% - 32px));font:13.5px var(--hz-sans);color:var(--hz-ink);background:rgba(12,15,28,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,210,168,.35);border-radius:16px;padding:9px 9px 9px 16px;pointer-events:auto;animation:hzb-in .3s cubic-bezier(.2,.8,.2,1)}
.hzx-toast q{color:#ffd2a8}
.hzx-toast button{flex:none;font:500 12px var(--hz-mono);color:#ffd2a8;background:transparent;border:1px solid rgba(255,210,168,.4);border-radius:999px;padding:3px 10px;cursor:pointer}
.hz-rolled .hzb-picks,.hz-rolled .hz3d-enter{display:none}
.hz-rolled svg.hz-flat .hz-face{opacity:0}
.hz-far .hz-ground{background:linear-gradient(#5a2a40 0,#3a1a2c 48px,#1e111c 130px,#111827 100%)}
.hzx-g{display:contents}
.hzx-chip{border:1px solid rgba(255,255,255,.22);border-radius:999px;padding:4px 12px;font:12.5px var(--hz-sans);color:#f3efe7;white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis;background:rgba(10,14,24,.35);cursor:pointer}
.hzx-chip:hover,.hzx-chip:focus-visible{border-color:#ffd2a8;outline:none}
.hzx-chip em{font:11px var(--hz-mono);font-style:normal;color:#ffd2a8;margin-left:6px}
.hzx-chip.oc{border-color:rgba(134,230,216,.55)}
.hzx-chip.oc em{color:#86e6d8}
.hzx-ans{border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px 12px;font:12.5px var(--hz-sans);color:#f3efe7;background:rgba(255,255,255,.04);white-space:nowrap;max-width:360px;overflow:hidden;text-overflow:ellipsis}
.hzx-ans .y{color:#ffcf9a;margin-right:6px}
.hzx-ans .n{color:#9aa6b8;margin-right:6px}
.hzx-ans q{color:#c9d1dd;font-style:italic;margin-left:6px}
@media (prefers-reduced-motion:reduce){.hzx-pulse,.hzx-flash{animation:none;opacity:0}}
`;

interface Mark { el: HTMLElement; p: V3; ax: 'c' | 's' | 'e'; kind: 'today' | 'far' | 'label'; back?: boolean; s0: number }

export interface FarInfo { far: boolean; count: number; noticed: number }

export function FarSide({ skyRef, svgRef, spots, sectors, data, space, groundSlot, onFar, onTasksChanged }: {
  skyRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  spots: PillSpot[];
  sectors: Sector[];
  data: HorizonData | null;
  space: DawnSpace | null;
  groundSlot: HTMLElement | null;
  onFar: (info: FarInfo) => void;
  onTasksChanged: () => void;
}) {
  const [view, setView] = React.useState<FarSideView | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [farSettled, setFarSettled] = React.useState(false);
  const [toast, setToast] = React.useState<{ html: string; undo?: () => void } | null>(null);
  const [fx, setFx] = React.useState<{ id: number; kind: 'pulse' | 'flash' }[]>([]);
  const layerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const duskRef = React.useRef<HTMLDivElement>(null);
  const sunRef = React.useRef<HTMLButtonElement>(null);
  const marks = React.useRef<Map<string, Mark>>(new Map());
  const roll = React.useRef({ a: 0, goal: 0, from: 0, t0: 0, dur: 0, raf: 0 });
  const absorb = React.useRef<{ id: string; t0: number; done: () => void } | null>(null);
  const [k, setK] = React.useState(1);
  const toastTimer = React.useRef<number | null>(null);
  const halfRef = React.useRef(false);

  const load = React.useCallback(() => {
    fetch('/api/action-cards').then((r) => r.json()).then((j) => { if (j.success) setView(j.data as FarSideView); }).catch(() => {});
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const cards = React.useMemo(() => view?.cards ?? [], [view]);
  const far = React.useMemo(() => layoutFar(cards), [cards]);
  const noticed = cards.filter((c) => c.source !== 'x').length;

  // Scale of the drawing on screen.
  React.useEffect(() => {
    const sky = skyRef.current;
    if (!sky || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setK(sky.clientWidth / W));
    ro.observe(sky);
    setK(sky.clientWidth / W);
    return () => ro.disconnect();
  }, [skyRef]);

  // ---- drawing one frame of the roll ----
  const frame = React.useCallback(() => {
    const a = roll.current.a, sky = skyRef.current, layer = layerRef.current, canvas = canvasRef.current;
    if (!sky || !layer || !canvas) return;
    const rest = a === 0 && !absorb.current;
    layer.classList.toggle('on', !rest);
    sky.closest('.hz-hero')?.classList.toggle('hz-rolled', a !== 0);
    const half = a > 90;
    if (half !== halfRef.current) { halfRef.current = half; onFar({ far: half, count: cards.length, noticed }); }
    if (duskRef.current) duskRef.current.style.opacity = (clamp(a / 180, 0, 1) * 0.92).toFixed(3);
    // Ground ring names swap faces halfway through.
    const f = smooth((a - 55) / 70);
    const ztoday = svgRef.current?.querySelector<SVGGElement>('.hz-ztoday');
    if (ztoday) ztoday.style.opacity = (1 - f).toFixed(3);
    layer.querySelectorAll<HTMLElement>('.hzx-zl').forEach((el) => { el.style.opacity = f.toFixed(3); });
    if (rest) return;
    const kk = sky.clientWidth / W, kh = sky.clientWidth * VH / W;
    for (const m of marks.current.values()) {
      const [x, y, sc, z] = proj(m.p, a);
      const dep = faceOf(z), s = Math.pow(sc / m.s0, 0.9);
      const tx = m.ax === 'c' ? '-50%,-50%' : m.ax === 's' ? '0,-50%' : '-100%,-50%';
      m.el.style.transform = `translate3d(${(x * kk).toFixed(1)}px,${(y * kk).toFixed(1)}px,0) translate(${tx}) scale(${(kk * s).toFixed(4)})`;
      m.el.style.opacity = dep.toFixed(3);
      m.el.style.zIndex = String(1000 + Math.round(z));
      const back = dep < 0.55;
      if (back !== m.back) { m.back = back; m.el.classList.toggle('back', back); }
    }
    // Rings: flat on a face at rest, a glass dome while it turns.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(sky.clientWidth * dpr)) { canvas.width = Math.round(sky.clientWidth * dpr); canvas.height = Math.round(kh * dpr); }
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    g.setTransform(kk * dpr, 0, 0, kk * dpr, 0, 0);
    g.save(); g.beginPath(); g.rect(0, 0, W, SY); g.clip();
    const m3 = spun(a), du = clamp(a / 180, 0, 1);
    const bandRGB = `255,${Math.round(196 - 46 * du)},${Math.round(128 + 2 * du)}`;
    if (m3 < 0.995) {
      // The resting face, drawn flat (today's matches the SVG it stands in for).
      const farFace = a > 90, alphas = farFace ? [0.17, 0.07, 0.05, 0.02] : [0.17, 0.07, 0.05, 0.02];
      const col = farFace ? ['255,150,130', '255,150,130', '210,170,240', '210,170,240'] : ['255,196,128', '255,196,128', '170,200,240', '170,200,240'];
      g.globalAlpha = 1 - m3;
      for (let i = 3; i >= 0; i--) {
        g.beginPath(); g.arc(SX, SY, R[i + 1], Math.PI, 2 * Math.PI); g.arc(SX, SY, R[i], 2 * Math.PI, Math.PI, true); g.closePath();
        g.fillStyle = `rgba(${col[i]},${alphas[i]})`; g.fill();
        g.setLineDash(i === 3 ? [2, 6] : []); g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1;
        g.beginPath(); g.arc(SX, SY, R[i + 1], Math.PI, 2 * Math.PI); g.stroke();
      }
      g.setLineDash([]); g.strokeStyle = 'rgba(255,255,255,.09)';
      (farFace ? far.slices.slice(1).map((s) => s.a0 + SECTOR_GAP / 2) : sectors.slice(1).map((s) => s.a0 + SECTOR_GAP / 2)).forEach((deg) => {
        const p0 = pt(R[0] + 8, deg), p1 = pt(R[4] + 6, deg);
        g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.stroke();
      });
    }
    if (m3 > 0.005) {
      g.globalAlpha = m3;
      const rr = DOME_R * DC / Math.sqrt(DC * DC - DOME_R * DOME_R);
      const gr = g.createRadialGradient(SX - rr * 0.28, SY - rr * 0.62, rr * 0.04, SX, SY, rr);
      gr.addColorStop(0, 'rgba(255,255,255,.075)'); gr.addColorStop(0.62, 'rgba(255,255,255,.018)'); gr.addColorStop(0.94, 'rgba(255,230,205,.05)'); gr.addColorStop(1, 'rgba(255,230,205,.13)');
      g.fillStyle = gr; g.beginPath(); g.arc(SX, SY, rr, Math.PI, 2 * Math.PI); g.fill();
      g.lineWidth = 1.2; g.strokeStyle = 'rgba(255,236,214,.3)'; g.beginPath(); g.arc(SX, SY, rr, Math.PI, 2 * Math.PI); g.stroke();
      for (const back of [true, false]) {
        const rings = R.map((r) => { const ps: ReturnType<typeof proj>[] = []; for (let d = -14; d <= 194; d += 4) ps.push(proj(to3(...pt(r, d), back), a)); return ps; });
        for (let i = 0; i < 4; i++) {
          const inner = rings[i], outer = rings[i + 1], z = outer.reduce((s, p) => s + p[3], 0) / outer.length, dep = depOf(z);
          if (dep < 0.02) continue;
          g.fillStyle = `rgba(${bandRGB},${([0.15, 0.075, 0.05, 0.03][i] * dep).toFixed(3)})`;
          g.beginPath(); outer.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
          for (let j = inner.length - 1; j >= 0; j--) g.lineTo(inner[j][0], inner[j][1]);
          g.closePath(); g.fill();
        }
        rings.forEach((ps, i) => {
          g.setLineDash(i === 4 ? [2, 6] : []); g.lineWidth = 1;
          for (let j = 1; j < ps.length; j++) {
            g.strokeStyle = `rgba(255,255,255,${(0.2 * ringDep((ps[j][3] + ps[j - 1][3]) / 2)).toFixed(3)})`;
            g.beginPath(); g.moveTo(ps[j - 1][0], ps[j - 1][1]); g.lineTo(ps[j][0], ps[j][1]); g.stroke();
          }
        });
        g.setLineDash([]);
        const rays = back ? far.slices.slice(1).map((s) => s.a0 + SECTOR_GAP / 2) : sectors.slice(1).map((s) => s.a0 + SECTOR_GAP / 2);
        rays.forEach((deg) => {
          const ps: ReturnType<typeof proj>[] = [];
          for (let r = R[0] + 8; r <= R[4] + 6; r += 16) ps.push(proj(to3(...pt(r, deg), back), a));
          g.strokeStyle = `rgba(255,255,255,${(0.12 * ringDep(ps.reduce((s, p) => s + p[3], 0) / ps.length)).toFixed(3)})`;
          g.beginPath(); ps.forEach((p, j) => (j ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
        });
      }
    }
    g.restore();
  }, [skyRef, svgRef, cards.length, noticed, onFar, far.slices, sectors]);

  // ---- the roll: fast out of the gate, soft landing, and a press mid-roll turns it back ----
  const tick = React.useCallback(() => {
    const r = roll.current, now = performance.now();
    const u = r.dur ? clamp((now - r.t0) / r.dur, 0, 1) : 1;
    r.a = r.from + (r.goal - r.from) * (1 - Math.pow(1 - u, 4));
    if (absorb.current) {
      const m = marks.current.get(`far:${absorb.current.id}`), t = clamp((now - absorb.current.t0) / 450, 0, 1);
      if (m) {
        const home = (m as Mark & { home?: V3 }).home ?? m.p;
        (m as Mark & { home?: V3 }).home = home;
        const e = t * t; m.p = [home[0] * (1 - e), home[1] * (1 - e), home[2] * (1 - e)];
      }
      if (t >= 1) { const done = absorb.current.done; absorb.current = null; if (m) m.p = (m as Mark & { home?: V3 }).home ?? m.p; done(); }
    }
    frame();
    const still = clamp(r.dur ? (performance.now() - r.t0) / r.dur : 1, 0, 1) >= 1;   // a roll may have started inside this frame
    if (!still || absorb.current) r.raf = requestAnimationFrame(tick);
    else { r.raf = 0; setFarSettled(r.goal === 180); }
  }, [frame]);

  const rollTo = React.useCallback((goal: 0 | 180) => {
    const r = roll.current, still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    r.from = r.a; r.goal = goal; r.t0 = performance.now();
    r.dur = still ? 1 : (300 + Math.abs(goal - r.a) / 180 * 450);
    setFarSettled(false);
    setOpen(null);
    cancelAnimationFrame(r.raf);
    r.raf = requestAnimationFrame(tick);
  }, [tick]);
  const toggle = React.useCallback(() => rollTo(roll.current.goal === 180 ? 0 : 180), [rollTo]);

  React.useEffect(() => () => cancelAnimationFrame(roll.current.raf), []);
  // Redraw when the layout or size changes while off rest.
  React.useEffect(() => { frame(); }, [frame, k, spots, far]);
  // Keep the headline's counts current while the far side is up.
  React.useEffect(() => { if (halfRef.current) onFar({ far: true, count: cards.length, noticed }); }, [cards.length, noticed, onFar]);

  // Escape: close the card, else turn back to today.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || space?.isLive) return;
      if (open) { setOpen(null); return; }
      if (roll.current.goal === 180) rollTo(0);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, rollTo, space]);

  // Once, when there is something on the far side: a soft pulse from the sun says it can be pressed.
  const pulsed = React.useRef(false);
  React.useEffect(() => {
    if (pulsed.current || !cards.length || !data) return;
    pulsed.current = true;
    const t = window.setTimeout(() => setFx((x) => [...x, { id: Date.now(), kind: 'pulse' }]), 900);
    return () => window.clearTimeout(t);
  }, [cards.length, data]);

  const say = React.useCallback((html: string, undo?: () => void) => {
    setToast({ html, undo });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 7000);
  }, []);

  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

  const undo = React.useCallback(async (id: string) => {
    setToast(null);
    const r = await post('/api/action-cards/decide', { id, undo: true });
    if (r.success && r.data.removeTask) await post('/api/tasks/remove', { taskId: r.data.removeTask.id, listType: r.data.removeTask.listType });
    load(); onTasksChanged();
  }, [load, onTasksChanged]);

  const decide = React.useCallback(async (card: ActionCard, d: CardDecisionInput): Promise<string | void> => {
    let taskId: string | undefined, taskListType: 'have-to-do' | 'want-to-do' | undefined;
    const o = card.outcomes.find((x) => x.kind === d.outcome);
    if (d.verdict === 'agree' && d.outcome === 'task') {
      taskListType = o?.listType ?? 'want-to-do';
      const notes = [`From an action card${card.source === 'x' ? ' (Openclaw folder)' : ` OpenClaw noticed in ${SRC_NAME[card.source]}`}.`, '', card.what, card.post ? `\n${card.post.url}` : card.link ? `\n${card.link}` : '', '', `Why: ${d.reason}`].join('\n');
      const t = await post('/api/tasks/add', { task: card.title, listType: taskListType, ...(o?.due ? { dueDate: o.due } : {}), notesMarkdown: notes });
      if (!t.success) return t.error || 'Could not make the task.';
      taskId = t.taskId;
    }
    const r = await post('/api/action-cards/decide', { id: card.id, verdict: d.verdict, reason: d.reason, ...(d.outcome ? { outcome: d.outcome } : {}), ...(taskId ? { taskId, taskListType } : {}), ...(d.snooze ? { snooze: true } : {}) });
    if (!r.success) {
      if (taskId) await post('/api/tasks/remove', { taskId, listType: taskListType });
      return r.error || 'Could not save that answer.';
    }
    setOpen(null);
    const q = `<q>“${esc(d.reason)}”</q>`;
    if (d.verdict === 'agree' && d.outcome === 'task') {
      // The sun takes it in, the dome turns back, and it rises with today.
      absorb.current = {
        id: card.id, t0: performance.now(), done: () => {
          setFx((x) => [...x, { id: Date.now(), kind: 'flash' }]);
          load(); onTasksChanged(); rollTo(0);
          say(`Agreed. <b>${esc(card.short)}</b> is on today's rings${o?.detail ? ` for ${esc(o.detail)}` : ''}. Reason kept: ${q}`, () => void undo(card.id));
        },
      };
      if (!roll.current.raf) roll.current.raf = requestAnimationFrame(tick);
      return;
    }
    load();
    if (d.verdict === 'agree') say(d.outcome === 'hand' ? `Agreed. OpenClaw is on it. Reason kept: ${q}` : `Agreed. ${esc(o?.label ?? '')}. Reason kept: ${q}`, () => void undo(card.id));
    else say(d.snooze ? `Dismissed for now; it comes back later. Reason kept: ${q}` : `Dismissed. OpenClaw keeps your reason and writes fewer cards like it: ${q}`, () => void undo(card.id));
  }, [load, onTasksChanged, rollTo, say, tick, undo]);

  const openCard = React.useCallback((id: string) => {
    if (roll.current.goal !== 180) { rollTo(180); window.setTimeout(() => setOpen(id), 760); return; }
    setOpen((o) => (o === id ? null : id));
  }, [rollTo]);

  // Register a mark's element with its place on the dome.
  const reg = (key: string, p: V3, ax: Mark['ax'], kind: Mark['kind']) => (el: HTMLElement | null) => {
    if (!el) { marks.current.delete(key); return; }
    const prev = marks.current.get(key);
    marks.current.set(key, { el, p: prev && (prev as Mark & { home?: V3 }).home ? prev.p : p, ax, kind, back: prev?.back, s0: DC / (DC - Math.abs(p[2])) });
  };

  const openCardData = open ? cards.find((c) => c.id === open) ?? null : null;
  const openSpot = openCardData ? far.spots.find((s) => s.card.id === open) : null;
  const where = (c: ActionCard) => `${({ now: 'Inner ring: fits a Focus bet right now', period: 'Second ring: fine on a build day this period', after: 'Third ring: parked until after finals', someday: 'Outer ring: no date yet' } as Record<string, string>)[c.when]}. ${c.betLabel}.`;
  const sunR = 2 * 56 * k;

  const ground = groundSlot && farSettled ? createPortal(
    <div className="hzx-g">
      <div className="hz-row">
        <b>Fits now</b>
        {cards.filter((c) => c.when === 'now').length ? cards.filter((c) => c.when === 'now').map((c) => (
          <button key={c.id} type="button" className={`hzx-chip${c.source !== 'x' ? ' oc' : ''}`} onClick={() => openCard(c.id)}>{c.short}<em>{c.estimate}</em></button>
        )) : <span className="hz-none">Nothing that fits right now.</span>}
      </div>
      {noticed > 0 && (
        <div className="hz-row">
          <b>Noticed</b>
          {cards.filter((c) => c.source !== 'x').map((c) => (
            <button key={c.id} type="button" className="hzx-chip oc" onClick={() => openCard(c.id)}>{c.short}<em>{SRC_NAME[c.source]}</em></button>
          ))}
        </div>
      )}
      <div className="hz-row">
        <b>Answers</b>
        {view?.answers.length ? view.answers.slice(0, 4).map((a: CardAnswer) => (
          <span key={`${a.id}${a.at}`} className="hzx-ans" title={a.reason}><span className={a.verdict === 'agree' ? 'y' : 'n'}>{a.verdict === 'agree' ? '✓' : '✕'}</span>{a.short}<q>{a.reason}</q></span>
        )) : <span className="hz-none">Your reasons collect here. OpenClaw reads them before it writes new cards.</span>}
      </div>
    </div>,
    groundSlot,
  ) : null;

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: FAR_CSS }} />
      <div ref={layerRef} className="hzx hz-keep" aria-hidden={!farSettled}>
        <div ref={duskRef} className="hzx-dusk" />
        <canvas ref={canvasRef} />
        <div className="hzx-pills">
          {spots.map(({ item, x, y }) => (
            <div key={`t:${item.id}`} ref={reg(`today:${item.id}`, to3(x, y), 'c', 'today')} className={`hzx-m hz3d-tg ${item.zone}${item.weight >= 4 ? ' big' : ''}`}>
              <div className="p">{item.short}</div><div className="d">{item.day}</div>
            </div>
          ))}
          {sectors.map((sec) => {
            const p = pt(R[4] + 16, sec.mid), c = Math.cos(sec.mid * D);
            return <div key={`ts:${sec.group}`} ref={reg(`tsl:${sec.group}`, to3(p[0], p[1]), c > 0.25 ? 's' : c < -0.25 ? 'e' : 'c', 'label')} className="hzx-m hzx-sl">{sec.group}</div>;
          })}
          {far.spots.map(({ card, x, y }) => {
            const oc = card.source !== 'x';
            return (
              <div key={`f:${card.id}`} ref={reg(`far:${card.id}`, to3(x, y + 1, true), 'c', 'far')} className={`hzx-m hzx-si${card.why.tone === 'bet' ? ' bet' : ''}${oc ? ' oc' : ''}${card.status === 'handed' ? ' handed' : ''}${open === card.id ? ' sel' : ''}`}>
                <button type="button" className="p" tabIndex={farSettled ? 0 : -1} aria-label={`${oc ? 'OpenClaw noticed' : 'Saved'}: ${card.title}`} onClick={() => openCard(card.id)}>
                  {oc ? <span className="ico" dangerouslySetInnerHTML={{ __html: SRC_ICON[card.source] }} /> : card.post?.avatar ? <img src={card.post.avatar} alt="" /> : <span className="ico" dangerouslySetInnerHTML={{ __html: SRC_ICON.x }} />}
                  {card.short}
                </button>
                <div className="d">{card.kind} · {card.estimate}</div>
              </div>
            );
          })}
          {far.slices.map((sl) => {
            const p = pt(R[4] + 16, sl.mid), c = Math.cos(sl.mid * D);
            return <div key={`fs:${sl.bet}`} ref={reg(`fsl:${sl.bet}`, to3(p[0], p[1], true), c > 0.25 ? 's' : c < -0.25 ? 'e' : 'c', 'label')} className="hzx-m hzx-sl">{sl.label}</div>;
          })}
        </div>
        {(['now', 'period', 'after', 'someday'] as const).map((w, i) => {
          const x = SX - (R[i] + R[i + 1]) / 2;
          return (
            <div key={w} className="hzx-zl" style={{ transform: `translate(${(x * k).toFixed(1)}px,${((SY + 11) * k).toFixed(1)}px) translate(-50%,0) scale(${k.toFixed(4)})` }}>
              <b>{RING_NAMES[w][0]}</b><small>{RING_NAMES[w][1]}</small>
            </div>
          );
        })}
        {farSettled && !cards.length && (
          <div className="hzx-empty">Nothing on the far side yet.<small>Save a post to your Openclaw folder on X, or wait for OpenClaw to notice something worth doing.</small></div>
        )}
      </div>
      <button
        ref={sunRef}
        type="button"
        className={`hzx-sun${farSettled ? ' home' : ''}`}
        style={{ left: `${(SX / W) * 100}%`, top: `${(SY / VH) * 100}%`, width: sunR, height: sunR, zIndex: 5 }}
        aria-label={farSettled ? 'Turn back to today' : `Turn to the far side: ${cards.length} to decide`}
        onPointerDown={(e) => { if (e.button === 0) { e.preventDefault(); toggle(); } }}
        onClick={(e) => { if (e.detail === 0) toggle(); }}
      >
        <span className="l">{farSettled ? 'Today' : `Far side · ${cards.length}`}</span>
      </button>
      {fx.map((f) => (
        <div key={f.id} className={f.kind === 'pulse' ? 'hzx-pulse' : 'hzx-flash'} style={{ left: `${(SX / W) * 100}%`, top: `${(SY / VH) * 100}%`, ...(f.kind === 'pulse' ? { width: sunR, height: sunR } : {}), zIndex: 5 }}
          onAnimationEnd={() => setFx((x) => x.filter((y) => y.id !== f.id))} />
      ))}
      <div className="hzx-ov hz-keep">
        {openCardData && farSettled && (
          <ActionCardView
            key={openCardData.id}
            card={openCardData}
            where={where(openCardData)}
            side={openSpot && openSpot.x > W * 0.55 ? 'l' : 'r'}
            onClose={() => setOpen(null)}
            onDecide={(d) => decide(openCardData, d)}
          />
        )}
        {toast && (
          <div className="hzx-toast" role="status">
            <span dangerouslySetInnerHTML={{ __html: toast.html }} />
            {toast.undo && <button type="button" onClick={toast.undo}>Undo</button>}
          </div>
        )}
      </div>
      {ground}
    </>
  );
}
