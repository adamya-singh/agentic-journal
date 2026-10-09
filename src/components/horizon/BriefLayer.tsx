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
.hzb-tether{position:absolute;left:0;top:0;width:330px;max-width:calc(100% - 24px);box-sizing:border-box;background:rgba(12,17,30,.88);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.22);border-radius:14px;padding:14px 14px 12px;box-shadow:0 18px 50px rgba(0,0,0,.45);pointer-events:auto;will-change:transform}
.hzb-tether .hzb-ttl{font-size:24px;padding-right:28px}
.hzb-pop{position:absolute;top:16px;bottom:16px;width:min(470px,calc(100% - 32px));pointer-events:auto}
.hzb-pop-in{position:relative;width:100%;height:100%;box-sizing:border-box;border-radius:18px;border:1px solid rgba(255,230,200,.3);background:linear-gradient(180deg,rgba(17,27,50,.96),rgba(8,12,22,.97) 320px);box-shadow:0 30px 90px rgba(0,0,0,.55),0 0 50px rgba(255,190,130,.1);animation:hzb-in .3s cubic-bezier(.2,.8,.2,1)}
@keyframes hzb-in{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
.hzb-bar{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 14px 10px 18px;border-bottom:1px solid rgba(255,255,255,.13);font:500 10px var(--hz-mono);letter-spacing:.16em;text-transform:uppercase;color:var(--hz-dim)}
.hzb-bar button{font:500 11.5px var(--hz-mono);letter-spacing:0;text-transform:none;border:1px solid rgba(255,255,255,.22);background:transparent;border-radius:999px;padding:3px 11px;cursor:pointer;color:var(--hz-ink)}
.hzb-bar button:hover,.hzb-bar button:focus-visible{border-color:#ffd2a8;outline:none}
.hzb-scroll{position:absolute;top:41px;left:0;right:0;bottom:0;overflow:auto;padding:16px 20px 20px;overscroll-behavior:contain}
.hzb-pop .hzb-ttl{font-size:34px}
.hzb-capture{position:fixed;inset:0;z-index:60;cursor:default}
@media (prefers-reduced-motion:reduce){.hzb-pop-in{animation:none}}
@media (max-width:760px){.hzb-pop{left:8px!important;right:8px!important;width:auto;top:8px;bottom:8px}}
`;

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
    if (space?.isLive && !a.chip) {
      // 3D: centred under the task.
      const el = m === 'tether' ? tether : pop;
      if (!el) return hide();
      const w = el.offsetWidth, top = a.y + 30;
      const x = Math.max(12, Math.min(W - w - 12, a.x - w / 2));
      if (m === 'tether') el.style.transform = `translate(${x.toFixed(1)}px,${Math.min(top, H - el.offsetHeight - 12).toFixed(1)}px)`;
      else { el.style.left = `${x.toFixed(1)}px`; el.style.right = ''; el.style.top = `${top.toFixed(1)}px`; }
      y1 = a.y + 12; x2 = a.x; y2 = top;
    } else if (m === 'tether' && tether) {
      const tw = tether.offsetWidth, th = tether.offsetHeight;
      let x: number, y: number;
      if (a.chip) {                      // ground chips: the card stands above the chip
        x = Math.max(12, Math.min(W - tw - 12, a.x - tw / 2)); y = Math.max(12, a.y - 26 - th);
        x2 = Math.max(x + 16, Math.min(x + tw - 16, a.x)); y2 = y + th; y1 = a.y - 14;
      } else {
        const right = a.x + a.half + 28 + tw < W - 12;
        x = right ? a.x + a.half + 28 : a.x - a.half - 28 - tw;
        y = Math.max(12, Math.min(H - th - 12, a.y - th * 0.35));
        x1 = a.x + (right ? a.half : -a.half);
        x2 = right ? x : x + tw; y2 = Math.max(y + 16, Math.min(y + th - 16, a.y));
      }
      tether.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    } else if (m === 'full' && pop) {
      const pr = pop.getBoundingClientRect(), hr = hero.getBoundingClientRect();
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

  // In 3D, aim so the task sits near the top with its window hanging below it, and hold the view still.
  const aimAt = React.useCallback((id: string, yf: number) => {
    const p = space?.isLive ? space.nodeScreen(id) : null;
    if (p) space!.aim(p.world, yf, true);
  }, [space]);

  const close = React.useCallback(() => { setMode('none'); setSel(null); space?.release(); }, [space]);
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
    if (mode === 'full') popRef.current?.querySelector<HTMLElement>('.hzb-bar button')?.focus({ preventScroll: true });
  }, [mode, sel]);

  const brief = sel ? briefs[sel] ?? null : null;
  const loading = !!sel && !(sel in briefs);
  const anchorNow = sel && mode === 'full' && !space?.isLive ? anchor(sel) : null;
  const side = anchorNow && heroRef.current && anchorNow.x > heroRef.current.clientWidth * 0.55 ? 'left' : 'right';

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
          <div ref={tetherRef} className="hzb-tether" role="dialog" aria-label="Task summary">
            <BriefCompact brief={brief} loading={loading} onGoto={select} onOpenFull={openFull} onClose={close} />
          </div>
        )}
        {sel && mode === 'full' && (
          <div
            ref={popRef}
            className="hzb-pop"
            role="dialog"
            aria-label={brief ? `Brief: ${brief.short}` : 'Task brief'}
            style={space?.isLive ? undefined : side === 'left' ? { left: 16 } : { right: 16 }}
          >
            <div className="hzb-pop-in">
              <div className="hzb-bar">
                <span>Brief · {brief?.course?.name ?? brief?.group ?? ''}</span>
                <button type="button" onClick={backToCard}>Close · Esc</button>
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
          </div>
        )}
      </div>
    </>
  );
}
