'use client';

// Pull back: hold Shift and scroll on the sky and the camera follows, away from the sun, until two more
// rings fit past Orbit and the later tasks the outer ring had no room for come into view. When the
// scrolling stops it settles on whichever view is closer. "Further" on the ground does the same in one
// click, and turns into "Nearer" once you're out.
import React from 'react';
import { applyPull, DAWN, PULL, type PillSpot, type PullView } from './dawn-svg';

const CSS = `
.hz-pull{position:absolute;z-index:6;border:0;background:none;padding:2px 8px;border-radius:10px;text-align:center;color:#2a1d14;cursor:pointer;white-space:nowrap;transform-origin:50% 0}
.hz-pull b{display:block;font:italic 400 24px/1 var(--hz-serif);opacity:.55;transition:opacity .15s}
.hz-pull small{display:block;font:9.5px var(--hz-mono);letter-spacing:1.4px;text-transform:uppercase;opacity:.5;margin-top:4px}
.hz-pull small i{font-style:normal;display:inline-block;min-width:1.2em;padding:0 4px;border-radius:999px;background:rgba(58,42,85,.85);color:#efe9ff;letter-spacing:0;margin-right:5px}
.hz-pull:hover b,.hz-pull:focus-visible b{opacity:1}
.hz-pull:hover small,.hz-pull:focus-visible small{opacity:.85}
.hz-pull:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(42,29,20,.45)}
.hz-pull-hint{position:absolute;z-index:6;transform:translate(-50%,-100%);font:500 10.5px var(--hz-mono);letter-spacing:.12em;text-transform:uppercase;color:#f6efe6;background:rgba(10,13,24,.6);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:4px 11px;pointer-events:none;white-space:nowrap;opacity:0;transition:opacity .4s}
.hz-pull-hint.on{opacity:1}
.hz-rolled .hz-pull,.hz-rolled .hz-pull-hint,.hz-live .hz-pull,.hz-on3d .hz-pull{display:none}
.hz-pulling .hzb-picks{visibility:hidden}
`;

const HINT_KEY = 'hz-pull-hint-seen';
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const easeOutQuart = (u: number) => 1 - Math.pow(1 - u, 4);

export function PullBack({ skyRef, svgRef, spots, pulled, further, onOut }: {
  skyRef: React.RefObject<HTMLDivElement | null>;
  svgRef: React.RefObject<SVGSVGElement | null>;
  spots: PillSpot[];
  pulled: PullView | null;
  further: number;
  onOut: (out: boolean) => void;
}) {
  const z = React.useRef(0);
  const anim = React.useRef(0);
  const snapTimer = React.useRef(0);
  const outRef = React.useRef(false);
  const btnRef = React.useRef<HTMLButtonElement>(null);
  const hintRef = React.useRef<HTMLDivElement>(null);
  const [out, setOut] = React.useState(false);

  // Rolled to the far side or inside the 3D world, the pull stands down.
  const blocked = React.useCallback(() => {
    const sky = skyRef.current;
    if (!sky) return true;
    return sky.classList.contains('hz-live') || sky.classList.contains('hz-on3d') || !!sky.closest('.hz-hero')?.classList.contains('hz-rolled');
  }, [skyRef]);

  // Put "Further" on the right half of the ground, mirroring the ring names, clear of the 3D button.
  const placeButton = React.useCallback(() => {
    const sky = skyRef.current, btn = btnRef.current;
    if (!sky || !btn) return;
    const { X, H, R } = DAWN, P = PULL.R, k = sky.clientWidth / DAWN.W, v = z.current, sc = Math.max(0.7, k);
    let x = (X + (R[2] + R[3]) / 2 - 20 + ((P[2] + P[3]) / 2 - (R[2] + R[3]) / 2 + 20) * v) * k;
    const enter = sky.querySelector<HTMLElement>('.hz3d-enter');
    if (enter && enter.offsetParent) x = Math.min(x, enter.offsetLeft - 12 - (btn.offsetWidth * sc) / 2);
    btn.style.transform = `translate(${x.toFixed(1)}px,${((H + 9) * k).toFixed(1)}px) translate(-50%,0) scale(${sc.toFixed(4)})`;
    btn.style.left = '0'; btn.style.top = '0';
    const hint = hintRef.current;
    if (hint) hint.style.cssText = `left:${x.toFixed(1)}px;top:${((H - 10) * k).toFixed(1)}px`;
  }, [skyRef]);

  const set = React.useCallback((v: number) => {
    z.current = clamp(v);
    const svg = svgRef.current;
    if (svg && pulled) applyPull(svg, spots, pulled, z.current);
    skyRef.current?.closest('.hz-hero')?.classList.toggle('hz-pulling', z.current > 0 && z.current < 1);
    placeButton();
    const o = z.current > 0.5;
    if (o !== outRef.current) { outRef.current = o; setOut(o); onOut(o); }
  }, [svgRef, skyRef, pulled, spots, placeButton, onOut]);

  // Fast out of the gate, soft landing; a longer way to go takes a little longer.
  const animateTo = React.useCallback((goal: 0 | 1) => {
    cancelAnimationFrame(anim.current);
    const from = z.current, d = Math.abs(goal - from);
    if (d < 0.001) { set(goal); return; }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { set(goal); return; }
    const t0 = performance.now(), dur = 220 + 380 * d;
    const step = () => {
      const u = Math.min(1, (performance.now() - t0) / dur);
      set(from + (goal - from) * easeOutQuart(u));
      if (u < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, [set]);

  // A redraw resets the drawing to today's view; put it back where the camera is.
  React.useEffect(() => { set(z.current); }, [set]);

  React.useEffect(() => {
    const sky = skyRef.current;
    if (!sky) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.shiftKey || blocked()) return;
      e.preventDefault();
      cancelAnimationFrame(anim.current);
      // Shift turns a vertical scroll sideways on macOS; take whichever axis moved.
      const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      set(z.current + d * (e.deltaMode === 1 ? 0.05 : 0.0018));
      window.clearTimeout(snapTimer.current);
      snapTimer.current = window.setTimeout(() => animateTo(z.current > 0.5 ? 1 : 0), 160);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && z.current > 0 && !blocked()) animateTo(0);
    };
    let hinted = false;
    const onEnter = () => {
      if (hinted || further === 0) return;
      hinted = true;
      try { if (localStorage.getItem(HINT_KEY)) return; localStorage.setItem(HINT_KEY, '1'); } catch { return; }
      window.setTimeout(() => {
        hintRef.current?.classList.add('on');
        window.setTimeout(() => hintRef.current?.classList.remove('on'), 2600);
      }, 700);
    };
    // Rolling to the far side or stepping into 3D starts from today's view.
    const mo = new MutationObserver(() => {
      if (z.current > 0 && blocked()) { cancelAnimationFrame(anim.current); window.clearTimeout(snapTimer.current); set(0); }
    });
    mo.observe(sky, { attributes: true, attributeFilter: ['class'] });
    const hero = sky.closest('.hz-hero');
    if (hero) mo.observe(hero, { attributes: true, attributeFilter: ['class'] });
    const ro = new ResizeObserver(placeButton);
    ro.observe(sky);
    sky.addEventListener('wheel', onWheel, { passive: false });
    sky.addEventListener('keydown', onKey);
    sky.addEventListener('pointerenter', onEnter);
    return () => {
      sky.removeEventListener('wheel', onWheel);
      sky.removeEventListener('keydown', onKey);
      sky.removeEventListener('pointerenter', onEnter);
      mo.disconnect();
      ro.disconnect();
      cancelAnimationFrame(anim.current);
      window.clearTimeout(snapTimer.current);
    };
  }, [skyRef, blocked, set, animateTo, placeButton, further]);

  if (!pulled || (!out && further === 0)) return <style dangerouslySetInnerHTML={{ __html: CSS }} />;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <button
        ref={btnRef}
        type="button"
        className="hz-pull hz-nointeract"
        title={out ? 'Back to the next weeks (Shift + scroll, or Esc)' : 'See further out (Shift + scroll)'}
        aria-label={out ? 'Back to the next weeks' : `${further} more ${further === 1 ? 'task' : 'tasks'} further out. Pull back.`}
        onClick={(e) => { e.stopPropagation(); animateTo(out ? 0 : 1); }}
      >
        {out ? <><b>‹ Nearer</b><small>next weeks</small></> : <><b>Further ›</b><small><i>{further}</i>more</small></>}
      </button>
      <div ref={hintRef} className="hz-pull-hint" aria-hidden="true">Shift + scroll to see further</div>
    </>
  );
}
