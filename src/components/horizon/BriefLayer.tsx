'use client';

// Click a task on the Horizon to see its brief. Flat view: the Tether card opens beside the pill and
// "Open full brief" pops the whole brief over the map, on the side away from the task. 3D view: you fly
// to the task first; the card and then the brief hang centred under it, and hold the mouse until Escape.
import React from 'react';
import { getCurrentDateISO } from '@/lib/current-date';
import type { HorizonData } from '@/lib/horizon';
import type { TaskBrief } from '@/lib/task-brief';
import { textWidth, type PillSpot } from './dawn-svg';
import type { DawnSpace } from './dawn-space';
import { BRIEF_CSS, BriefCompact, BriefFull } from './TaskBriefCard';
import { BriefChat, FOLD_W } from './BriefChat';

const CSS = BRIEF_CSS + `
.hz-hero{position:relative}
.hzb-picks{position:absolute;left:0;top:0;width:100%;aspect-ratio:1200/630;z-index:5;pointer-events:none}
.hz-hero:has(.hz-live) .hzb-picks{display:none}
.hzb-pick{position:absolute;transform:translate(-50%,-50%);height:4.6%;min-height:22px;border:0;padding:0;background:transparent;border-radius:999px;cursor:pointer;pointer-events:auto}
.hzb-pick:hover,.hzb-pick:focus-visible{box-shadow:0 0 0 2px rgba(255,210,168,.55);outline:none}
.hzb-pick.sel{box-shadow:0 0 0 2px #ffd2a8,0 0 22px 4px rgba(255,210,168,.45)}
.hz-ground .hz-hold,.hz-ground .hz-undated{cursor:pointer}
.hz-ground .hz-hold.hzb-sel,.hz-ground .hz-undated.hzb-sel{box-shadow:0 0 0 2px #ffd2a8}
.hzb-ov{position:absolute;inset:0;z-index:61;pointer-events:none}
.hzb-dim{position:absolute;inset:0;background:rgba(5,7,13,.38);opacity:0;transition:opacity .3s ease}
.hzb-ov.full .hzb-dim{opacity:1}
.hzb-lead{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.hzb-lead line{stroke:rgba(255,210,168,.75);stroke-width:1.2}
.hzb-lead circle{fill:#ffd2a8}
.hzb-tether{position:absolute;left:0;top:0;display:flex;align-items:stretch;max-width:calc(100% - 24px);max-height:calc(100% - 24px);pointer-events:auto;will-change:transform}
.hzb-card{position:relative;flex:0 1 330px;width:330px;min-width:0;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;background:rgba(12,17,30,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:14px 14px 12px;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.hzb-card .hzb-ttl{font-size:24px;padding-right:28px}
.hzb-pop{position:absolute;top:16px;bottom:16px;display:flex;align-items:stretch;max-width:calc(100% - 32px);pointer-events:auto}
.hzb-pop-in{position:relative;display:flex;flex-direction:column;flex:0 1 470px;width:470px;min-width:0;box-sizing:border-box;border-radius:18px;border:1px solid rgba(255,230,200,.3);background:linear-gradient(180deg,rgba(17,27,50,.96),rgba(8,12,22,.97) 320px);box-shadow:0 30px 90px rgba(0,0,0,.55),0 0 50px rgba(255,190,130,.1);animation:hzb-in .3s cubic-bezier(.2,.8,.2,1)}
@keyframes hzb-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.hzb-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px 10px 18px;border-bottom:1px solid rgba(255,255,255,.13);font:500 10px var(--hz-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--hz-dim)}
.hzb-bar button{font:500 11.5px var(--hz-mono);letter-spacing:0;text-transform:none;border:1px solid rgba(255,255,255,.22);background:transparent;border-radius:999px;padding:3px 11px;cursor:pointer;color:var(--hz-ink)}
.hzb-bar button:hover,.hzb-bar button:focus-visible{border-color:#ffd2a8;outline:none}
.hzb-scroll{flex:1;min-height:0;overflow:auto;padding:16px 20px 20px;overscroll-behavior:contain}
.hzb-pop .hzb-ttl{font-size:34px}
.hzb-capture{position:fixed;inset:0;z-index:60;cursor:default}
/* The chat folds out of the card's far edge like a second page: r(ight), l(eft) or d(own) on narrow screens. */
[data-fold=l]{flex-direction:row-reverse}
[data-fold=d]{flex-direction:column}
.hzb-tether[data-fold=d]{width:330px}
[data-fold=d] .hzb-card{flex:0 1 auto;width:auto;min-height:0}
.folded[data-fold=r] .hzb-card,.folded[data-fold=r] .hzb-pop-in{border-top-right-radius:4px;border-bottom-right-radius:4px}
.folded[data-fold=l] .hzb-card,.folded[data-fold=l] .hzb-pop-in{border-top-left-radius:4px;border-bottom-left-radius:4px}
.folded[data-fold=d] .hzb-card,.folded[data-fold=d] .hzb-pop-in{border-bottom-left-radius:4px;border-bottom-right-radius:4px}
.hzf{position:relative;display:flex;flex-direction:column;flex:0 0 ${FOLD_W}px;width:${FOLD_W}px;min-height:360px;box-sizing:border-box;background:linear-gradient(180deg,rgba(18,26,46,.94),rgba(9,13,24,.95));backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.22);border-radius:4px 14px 14px 4px;margin-left:-1px;box-shadow:0 18px 50px rgba(0,0,0,.45);transform-origin:left center;backface-visibility:hidden;animation:hzf-r .55s cubic-bezier(.22,1,.36,1) both}
.hzf::before,.hzf::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none}
.hzf::before{background:linear-gradient(90deg,rgba(0,0,0,.4),rgba(0,0,0,0) 22px)}
.hzf::after{z-index:2;background:#05070d;opacity:0;animation:hzf-shade .55s ease-out}
[data-fold=l] .hzf{transform-origin:right center;border-radius:14px 4px 4px 14px;margin:0 -1px 0 0;animation-name:hzf-l}
[data-fold=l] .hzf::before{background:linear-gradient(270deg,rgba(0,0,0,.4),rgba(0,0,0,0) 22px)}
[data-fold=d] .hzf{transform-origin:center top;border-radius:4px 4px 14px 14px;margin:-1px 0 0;flex:0 1 300px;width:auto;min-height:180px;animation-name:hzf-d}
[data-fold=d] .hzf::before{background:linear-gradient(180deg,rgba(0,0,0,.4),rgba(0,0,0,0) 22px)}
.hzb-pop .hzf{border-color:rgba(255,230,200,.3)}
.hzf.closing{animation:hzf-r-out .3s cubic-bezier(.55,0,.8,.3) forwards}
[data-fold=l] .hzf.closing{animation-name:hzf-l-out}
[data-fold=d] .hzf.closing{animation-name:hzf-d-out}
.hzf.closing::after{animation:hzf-shade-out .3s ease-in forwards}
@keyframes hzf-r{from{transform:perspective(1100px) rotateY(96deg)}to{transform:perspective(1100px) rotateY(0)}}
@keyframes hzf-l{from{transform:perspective(1100px) rotateY(-96deg)}to{transform:perspective(1100px) rotateY(0)}}
@keyframes hzf-d{from{transform:perspective(1100px) rotateX(-96deg)}to{transform:perspective(1100px) rotateX(0)}}
@keyframes hzf-r-out{to{transform:perspective(1100px) rotateY(96deg)}}
@keyframes hzf-l-out{to{transform:perspective(1100px) rotateY(-96deg)}}
@keyframes hzf-d-out{to{transform:perspective(1100px) rotateX(-96deg)}}
@keyframes hzf-shade{from{opacity:.75}to{opacity:0}}
@keyframes hzf-shade-out{to{opacity:.75}}
.hzb-ask{font:500 12px var(--hz-sans);border:1px solid rgba(255,210,168,.55);background:transparent;color:#ffd2a8;border-radius:999px;padding:3px 11px;cursor:pointer}
.hzb-ask:hover,.hzb-ask:focus-visible{background:rgba(255,210,168,.1);outline:none}
.hzb-ask[aria-expanded=true]{background:#ffd2a8;color:#1b0d05;border-color:#ffd2a8}
.hzb-bar .hzb-ask{font:500 11.5px var(--hz-mono);letter-spacing:0;text-transform:none;padding:3px 11px}
.hzb-bar>div{display:flex;gap:6px}
@media (prefers-reduced-motion:reduce){.hzb-pop-in,.hzf,.hzf::after{animation:none!important}}
@media (max-width:760px){.hzb-pop{left:8px!important;right:8px!important;max-width:none;top:8px;bottom:8px}.hzb-pop-in{flex:1 1 auto;width:auto;min-height:0}.hzb-pop .hzf{flex:0 0 46%}}
`;

type Fold = 'r' | 'l' | 'd';

/**
 * Where the card goes with its chat folded out: the chat opens on `prefer`'s side when it fits, else the
 * other; `fw` is the chat's width now (0 while folded away), so the card itself stays put as it opens.
 */
function foldLayout(cardX: number, cw: number, fw: number, W: number, prefer: 'r' | 'l'): { side: Fold; cardX: number; x: number } {
  if (W < cw + FOLD_W + 48) {
    const x = Math.max(12, Math.min(W - cw - 12, cardX));   // too narrow to sit beside the task; stay on screen
    return { side: 'd', cardX: x, x };
  }
  const fitsR = cardX + cw + FOLD_W <= W - 12, fitsL = cardX - FOLD_W >= 12;
  const side: Fold = prefer === 'l' ? (fitsL || !fitsR ? 'l' : 'r') : (fitsR || !fitsL ? 'r' : 'l');
  const x = side === 'l' ? cardX - fw : cardX;
  const shift = Math.max(12 - x, 0) + Math.min(W - 12 - (x + cw + fw), 0);
  return { side, cardX: cardX + shift, x: x + shift };
}

type Mode = 'none' | 'tether' | 'full';
interface Anchor { x: number; y: number; half: number; on: boolean; chip: boolean; world?: import('three').Vector3 }

const TETHER_AT = 0.24;   // 3D: where the task sits from the top of the view with the card under it
const FULL_AT = 0.11;     // and with the full brief under it

export function BriefLayer({ heroRef, svgRef, space, data, spots, onChanged }: {
  heroRef: React.RefObject<HTMLElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  space: DawnSpace | null;
  data: HorizonData | null;
  spots: PillSpot[];
  onChanged: () => void;
}) {
  const [sel, setSel] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<Mode>('none');
  const [briefs, setBriefs] = React.useState<Record<string, TaskBrief | null>>({});
  const [busy, setBusy] = React.useState(false);
  // The chat with OpenClaw that folds out of the card; 'closing' while it folds back in.
  const [chat, setChat] = React.useState<'closed' | 'open' | 'closing'>('closed');
  const tetherRef = React.useRef<HTMLDivElement>(null);
  const popRef = React.useRef<HTMLDivElement>(null);
  const lineRef = React.useRef<SVGLineElement>(null);
  const dotRef = React.useRef<SVGCircleElement>(null);
  const captureRef = React.useRef<HTMLDivElement>(null);
  const state = React.useRef({ sel, mode });
  state.current = { sel, mode };

  // Titles find the hold and undated chips on the ground, which carry the task title.
  const titles = React.useMemo(() => {
    const m = new Map<string, string>();
    data?.holds.forEach((h) => m.set(h.id, h.title));
    data?.items.forEach((i) => m.set(i.id, i.title));
    data?.undated.forEach((u) => m.set(u.id, u.title));
    return m;
  }, [data]);

  // New horizon data means tasks changed: drop cached briefs, and the selection if its task is gone.
  React.useEffect(() => {
    setBriefs({});
    const id = state.current.sel;
    if (id && data && !titles.has(id)) { setSel(null); setMode('none'); }
  }, [data, titles]);

  React.useEffect(() => {
    if (!sel || sel in briefs) return;
    let cancelled = false;
    fetch(`/api/tasks/brief?id=${encodeURIComponent(sel)}`)
      .then((r) => r.json())
      .then((json) => { if (!cancelled) setBriefs((b) => ({ ...b, [sel]: json.success ? json.data as TaskBrief : null })); })
      .catch(() => { if (!cancelled) setBriefs((b) => ({ ...b, [sel]: null })); });
    return () => { cancelled = true; };
  }, [sel, briefs]);

  // Refetch one brief without the loading state, e.g. while OpenClaw is still filling it in.
  const reloadBrief = React.useCallback((id: string) => {
    fetch(`/api/tasks/brief?id=${encodeURIComponent(id)}`)
      .then((r) => r.json())
      .then((json) => { if (json.success) setBriefs((b) => ({ ...b, [id]: json.data as TaskBrief })); })
      .catch(() => {});
  }, []);

  const agentWorking = !!sel && (briefs[sel]?.agent?.status === 'queued' || briefs[sel]?.agent?.status === 'running');
  React.useEffect(() => {
    if (!sel || !agentWorking || mode === 'none') return;
    const timer = window.setInterval(() => reloadBrief(sel), 8000);
    return () => window.clearInterval(timer);
  }, [sel, agentWorking, mode, reloadBrief]);

  const refreshAgent = React.useCallback(async (id: string) => {
    await fetch('/api/tasks/brief-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'refresh', taskId: id }) });
    reloadBrief(id);
  }, [reloadBrief]);

  const actionDone = React.useCallback(async (id: string, actionId: string) => {
    await fetch('/api/tasks/brief-agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'action-done', taskId: id, actionId }) });
    onChanged();
  }, [onChanged]);

  const chipFor = React.useCallback((id: string): HTMLElement | null => {
    const title = titles.get(id);
    const hero = heroRef.current;
    if (!title || !hero) return null;
    return [...hero.querySelectorAll<HTMLElement>('.hz-ground .hz-hold, .hz-ground .hz-undated')].find((el) => el.title === title) ?? null;
  }, [titles, heroRef]);

  const anchor = React.useCallback((id: string): Anchor | null => {
    const hero = heroRef.current;
    if (!hero) return null;
    if (space?.isLive) {
      const p = space.nodeScreen(id);
      if (p) return { x: p.x, y: p.y, half: 18, on: p.on, chip: false, world: p.world };
    } else {
      const sp = spots.find((s) => s.item.id === id);
      const svg = svgRef.current;
      if (sp && svg) {
        const k = svg.clientWidth / 1200;
        const w = (textWidth(sp.item.short, sp.item.weight >= 4 ? 600 : 500) + 24) * k;
        return { x: sp.x * k, y: sp.y * k, half: w / 2, on: true, chip: false };
      }
    }
    const chip = chipFor(id);
    if (!chip) return null;
    const hr = hero.getBoundingClientRect(), r = chip.getBoundingClientRect();
    return { x: r.left - hr.left + r.width / 2, y: r.top - hr.top + r.height / 2, half: r.width / 2, on: true, chip: true };
  }, [heroRef, space, spots, svgRef, chipFor]);

  // Lay out the card or the brief and the line back to the task. Every frame in 3D; on change when flat.
  const place = React.useCallback(() => {
    const hero = heroRef.current, line = lineRef.current, dot = dotRef.current;
    if (!hero || !line || !dot) return;
    const { sel: id, mode: m } = state.current;
    const a = id && m !== 'none' ? anchor(id) : null;
    const hide = () => { line.setAttribute('opacity', '0'); dot.setAttribute('cx', '-10'); };
    const tether = tetherRef.current, pop = popRef.current;
    if (tether) tether.style.visibility = a && a.on ? '' : 'hidden';
    if (!a || !a.on) { hide(); return; }
    const W = hero.clientWidth, H = hero.clientHeight;
    let x1 = a.x, y1 = a.y, x2: number, y2: number;
    const foldW = (el: HTMLElement) => el.querySelector<HTMLElement>(':scope > .hzf')?.offsetWidth ?? 0;
    if (space?.isLive && !a.chip) {
      // 3D: centred under the task, the chat folding out to the side.
      const el = m === 'tether' ? tether : pop;
      const body = el?.querySelector<HTMLElement>(m === 'tether' ? '.hzb-card' : '.hzb-pop-in');
      if (!el || !body) return hide();
      const bw = body.offsetWidth, top = a.y + 30;
      const f = foldLayout(Math.max(12, Math.min(W - bw - 12, a.x - bw / 2)), bw, foldW(el), W, 'r');
      el.dataset.fold = f.side;
      if (m === 'tether') el.style.transform = `translate(${f.x.toFixed(1)}px,${Math.min(top, H - el.offsetHeight - 12).toFixed(1)}px)`;
      else { el.style.left = `${f.x.toFixed(1)}px`; el.style.right = ''; el.style.top = `${top.toFixed(1)}px`; }
      y1 = a.y + 12; x2 = Math.max(f.cardX + 16, Math.min(f.cardX + bw - 16, a.x)); y2 = top;
    } else if (m === 'tether' && tether) {
      const card = tether.querySelector<HTMLElement>('.hzb-card');
      if (!card) return hide();
      const cw = card.offsetWidth, ch = card.offsetHeight, th = tether.offsetHeight, fw = foldW(tether);
      let f: ReturnType<typeof foldLayout>, y: number;
      if (a.chip) {                      // ground chips: the card stands above the chip
        f = foldLayout(Math.max(12, Math.min(W - cw - 12, a.x - cw / 2)), cw, fw, W, 'r');
        y = Math.max(12, a.y - 26 - th);
        x2 = Math.max(f.cardX + 16, Math.min(f.cardX + cw - 16, a.x)); y2 = y + th; y1 = a.y - 14;
      } else {
        // Beside the task, on a side with room for the card and its chat (open or not, so it never jumps).
        const roomR = W - 12 - (a.x + a.half + 28), roomL = a.x - a.half - 28 - 12;
        const right = roomR >= cw + FOLD_W || (roomL < cw + FOLD_W && roomR >= cw);
        f = foldLayout(right ? a.x + a.half + 28 : a.x - a.half - 28 - cw, cw, fw, W, right ? 'r' : 'l');
        y = Math.max(12, Math.min(H - th - 12, a.y - th * 0.35));
        x1 = a.x + (right ? a.half : -a.half);
        x2 = right ? f.cardX : f.cardX + cw; y2 = Math.max(y + 16, Math.min(y + ch - 16, a.y));
      }
      tether.dataset.fold = f.side;
      tether.style.transform = `translate(${f.x.toFixed(1)}px,${y.toFixed(1)}px)`;
    } else if (m === 'full' && pop) {
      // The brief sits against one side of the view; its chat folds out toward the middle.
      pop.dataset.fold = window.innerWidth <= 760 ? 'd' : pop.style.left ? 'r' : 'l';
      const body = pop.querySelector<HTMLElement>('.hzb-pop-in') ?? pop;
      const pr = body.getBoundingClientRect(), hr = hero.getBoundingClientRect();
      const px = pr.left - hr.left, leftOf = a.x < px;
      x2 = leftOf ? px : px + pr.width;
      y2 = Math.max(pr.top - hr.top + 24, Math.min(pr.bottom - hr.top - 24, a.y));
      if (!a.chip) x1 = a.x + (leftOf ? a.half : -a.half);
    } else return hide();
    line.setAttribute('x1', String(x1)); line.setAttribute('y1', String(y1));
    line.setAttribute('x2', String(x2)); line.setAttribute('y2', String(y2)); line.setAttribute('opacity', '1');
    dot.setAttribute('cx', String(x2)); dot.setAttribute('cy', String(y2));
  }, [heroRef, anchor, space]);

  React.useLayoutEffect(() => { place(); });
  React.useEffect(() => {
    const onResize = () => place();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [place]);
  // The card or brief changes size on its own (it loads, the chat folds out); keep it inside the view.
  React.useEffect(() => {
    const el = tetherRef.current ?? popRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place());
    ro.observe(el);
    return () => ro.disconnect();
  }, [sel, mode, place]);

  // In 3D, aim so the task sits near the top with its window hanging below it, and hold the view still.
  const aimAt = React.useCallback((id: string, yf: number) => {
    const p = space?.isLive ? space.nodeScreen(id) : null;
    if (p) space!.aim(p.world, yf, true);
  }, [space]);

  const close = React.useCallback(() => { setMode('none'); setSel(null); setChat('closed'); space?.release(); }, [space]);
  const toggleChat = React.useCallback(() => {
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setChat((c) => (c === 'open' ? (still ? 'closed' : 'closing') : 'open'));
  }, []);
  const backToCard = React.useCallback(() => {
    setMode('tether');
    if (state.current.sel) aimAt(state.current.sel, TETHER_AT);
  }, [aimAt]);
  const openFull = React.useCallback(() => {
    setMode('full');
    if (state.current.sel) aimAt(state.current.sel, FULL_AT);
  }, [aimAt]);

  const select = React.useCallback((id: string) => {
    if (space?.isLive && space.hasNode(id)) {
      // Fly there first; the card opens when the camera lands.
      setMode('none'); setSel(id); space.focusTask(id);
      return;
    }
    setSel(id);
    setMode((m) => (m === 'full' ? 'full' : 'tether'));
  }, [space]);

  // 3D hooks.
  React.useEffect(() => {
    if (!space) return;
    space.onArrive = (item) => { setSel(item.id); setMode('tether'); aimAt(item.id, TETHER_AT); };
    space.onLeave = () => { setMode('none'); setSel(null); };
    space.onFrame = () => { if (space.isLive && state.current.mode !== 'none') place(); };
    space.onEscape = () => {
      const m = state.current.mode;
      if (m === 'full') { backToCard(); return true; }
      if (m === 'tether') { close(); return true; }
      return false;
    };
    return () => { space.onArrive = null; space.onLeave = null; space.onFrame = null; space.onEscape = null; };
  }, [space, aimAt, place, backToCard, close]);

  // Flat view: Escape steps back, and a click on empty sky closes the brief, then the card.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || space?.isLive) return;      // inside 3D the world asks onEscape
      const m = state.current.mode;
      if (m === 'full') backToCard(); else if (m === 'tether') close();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (space?.isLive || state.current.mode === 'none') return;
      if (t.closest('.hz3d-enter')) { close(); return; }       // stepping inside starts fresh
      if (t.closest('.hzb-tether,.hzb-pop,.hzb-pick,.hz-cap') || !t.closest('.hz-sky')) return;
      if (state.current.mode === 'full') backToCard(); else close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onDown); };
  }, [space, backToCard, close]);

  // Hold and undated chips on the ground open their brief too (their own buttons keep working).
  React.useEffect(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const chip = t.closest<HTMLElement>('.hz-ground .hz-hold, .hz-ground .hz-undated');
      if (!chip || t.closest('button')) return;
      const id = [...titles].find(([, title]) => title === chip.title)?.[0];
      if (id) select(id);
    };
    hero.addEventListener('click', onClick);
    return () => hero.removeEventListener('click', onClick);
  }, [heroRef, titles, select]);

  // Mark the selected chip.
  React.useEffect(() => {
    const hero = heroRef.current;
    hero?.querySelectorAll('.hzb-sel').forEach((el) => el.classList.remove('hzb-sel'));
    if (sel && mode !== 'none') chipFor(sel)?.classList.add('hzb-sel');
  });

  // While a card or brief is open in 3D it holds the mouse: nothing behind it reacts until Escape.
  const captured = !!space?.isLive && mode !== 'none';
  React.useEffect(() => {
    const el = captureRef.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, [captured]);

  // Focus the brief when it opens, for keyboard users.
  React.useEffect(() => {
    if (mode === 'full') popRef.current?.querySelector<HTMLElement>('.hzb-bar .hzb-close')?.focus({ preventScroll: true });
  }, [mode, sel]);

  const brief = sel ? briefs[sel] ?? null : null;
  const loading = !!sel && !(sel in briefs);
  const anchorNow = sel && mode === 'full' && !space?.isLive ? anchor(sel) : null;
  const side = anchorNow && heroRef.current && anchorNow.x > heroRef.current.clientWidth * 0.55 ? 'left' : 'right';

  const fold = brief && chat !== 'closed' ? (
    <div
      className={`hzf${chat === 'closing' ? ' closing' : ''}`}
      onAnimationEnd={(e) => { if (e.target === e.currentTarget && e.animationName.endsWith('-out')) setChat('closed'); }}
    >
      <BriefChat key={brief.id} taskId={brief.id} title={brief.short} onClose={toggleChat} />
    </div>
  ) : null;

  const act = async (url: string, body: object) => {
    setBusy(true);
    try {
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      close();
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="hzb-picks">
        {spots.map(({ item, x, y }) => (
          <button
            key={item.id}
            type="button"
            className={`hzb-pick${sel === item.id && mode !== 'none' ? ' sel' : ''}`}
            aria-label={`${item.short}, ${item.day}. Open its brief.`}
            style={{ left: `${x / 12}%`, top: `${(y / 630) * 100}%`, width: `${(textWidth(item.short, item.weight >= 4 ? 600 : 500) + 24) / 12}%` }}
            onClick={() => select(item.id)}
          />
        ))}
      </div>
      {captured && <div ref={captureRef} className="hzb-capture hz-keep" aria-hidden="true" />}
      <div className={`hzb-ov hz-keep${mode === 'full' ? ' full' : ''}`}>
        <div className="hzb-dim" />
        <svg className="hzb-lead" aria-hidden="true">
          <line ref={lineRef} x1="0" y1="0" x2="0" y2="0" opacity="0" />
          <circle ref={dotRef} r="3" cx="-10" cy="-10" />
        </svg>
        {sel && mode === 'tether' && (
          <div ref={tetherRef} className={`hzb-tether${fold ? ' folded' : ''}`} role="dialog" aria-label="Task summary">
            <div className="hzb-card">
              <BriefCompact brief={brief} loading={loading} onGoto={select} onOpenFull={openFull} onClose={close} chatOpen={chat === 'open'} onToggleChat={toggleChat} />
            </div>
            {fold}
          </div>
        )}
        {sel && mode === 'full' && (
          <div
            ref={popRef}
            className={`hzb-pop${fold ? ' folded' : ''}`}
            role="dialog"
            aria-label={brief ? `Brief: ${brief.short}` : 'Task brief'}
            style={space?.isLive ? undefined : side === 'left' ? { left: 16 } : { right: 16 }}
          >
            <div className="hzb-pop-in">
              <div className="hzb-bar">
                <span>Brief · {brief?.course?.name ?? brief?.group ?? ''}</span>
                <div>
                  {brief && <button type="button" className="hzb-ask" aria-expanded={chat === 'open'} onClick={toggleChat}>Ask OpenClaw</button>}
                  <button type="button" className="hzb-close" onClick={backToCard}>Close · Esc</button>
                </div>
              </div>
              <div className="hzb-scroll">
                {brief ? (
                  <BriefFull
                    brief={brief}
                    actions={{
                      onGoto: select,
                      busy,
                      onDone: () => act('/api/tasks/today/complete', { taskId: brief.id, listType: brief.listType, date: getCurrentDateISO() }),
                      onRefresh: () => void refreshAgent(brief.id),
                      onActionDone: (actionId) => void actionDone(brief.id, actionId),
                    }}
                  />
                ) : <div className="hzb hzb-loading">{loading ? 'Gathering what the Journal knows…' : 'Could not load this task.'}</div>}
              </div>
            </div>
            {fold}
          </div>
        )}
      </div>
    </>
  );
}
