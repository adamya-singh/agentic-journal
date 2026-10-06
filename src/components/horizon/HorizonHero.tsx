'use client';

import React from 'react';
import { Instrument_Serif } from 'next/font/google';
import { QuickCaptureInput } from '@/components/quick-capture/QuickCaptureInput';
import { useRefresh } from '@/lib/RefreshContext';
import { getCurrentDateISO } from '@/lib/current-date';
import { horizonAnswers, type HorizonData } from '@/lib/horizon';
import { drawDawn } from './dawn-svg';
import type { DawnSpace } from './dawn-space';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });

const CSS = `
.hz-hero{--hz-ink:#f3efe7;--hz-dim:#a9b4c4;--hz-em:#ffd2a8;--hz-serif:var(--font-instrument-serif),'Instrument Serif',serif;--hz-sans:var(--font-geist-sans),Geist,sans-serif;--hz-mono:var(--font-geist-mono),'Geist Mono',monospace;background:#05070d;color:var(--hz-ink)}
.hz-sky{position:relative;overflow:hidden;cursor:pointer;outline:none;background:#05070d}
.hz-sky:focus-visible{box-shadow:inset 0 0 0 2px #ffd2a8}
.hz-sky>svg.hz-flat{position:relative;z-index:3;display:block;width:100%;height:auto;transition:opacity .28s ease}
.hz-sky.hz-live{cursor:crosshair}
.hz-say{position:absolute;left:3%;top:24px;max-width:34%;z-index:6;pointer-events:none}
.hz-say h1{margin:0;font:400 clamp(22px,3.2vw,44px)/1.04 var(--hz-serif);letter-spacing:-.005em;color:var(--hz-ink)}
.hz-say h1 em{font-style:normal;color:var(--hz-em)}
.hz-say p{margin:8px 0 0;font:13px/1.45 var(--hz-sans);color:var(--hz-dim)}
.hz-cap{position:absolute;right:3%;top:24px;width:min(34%,420px);z-index:6}
.hz-loading{position:absolute;inset:0;display:grid;place-items:center;font:13px var(--hz-sans);color:var(--hz-dim);z-index:2}
.hz3d{position:absolute;inset:0;opacity:0;pointer-events:none}
.hz-on3d .hz3d{opacity:1}
.hz3d-bg{position:absolute;left:-100%;width:300%;top:0;height:100%;will-change:transform}
.hz3d-bg svg{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible}
.hz3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.hz3d-lab{position:absolute;inset:0;z-index:2}
.hz3d-tg{position:absolute;left:0;top:0;pointer-events:none;will-change:transform,opacity}
.hz-live .hz3d-tg.hit{pointer-events:auto;cursor:pointer}
.hz3d-tg .p{display:flex;align-items:center;justify-content:center;height:28px;padding:0 12px;border-radius:14px;font:500 13px var(--hz-sans);white-space:nowrap;border:1px solid transparent;box-sizing:border-box}
.hz3d-tg.big .p{font-weight:600}
.hz3d-tg .d{position:absolute;left:50%;top:100%;transform:translateX(-50%);font:10.5px var(--hz-mono);color:#e6ecf4;opacity:.8;white-space:nowrap}
.hz3d-tg.ignition .p{background:#fff6ec;color:#1b0d05;box-shadow:0 0 18px 4px rgba(255,179,122,.35)}
.hz3d-tg.climb .p{background:rgba(255,255,255,.88);color:#10213a}
.hz3d-tg.altitude .p{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.6);color:#eef2f8}
.hz3d-tg.orbit .p{background:transparent;border-color:rgba(255,255,255,.28);color:rgba(238,242,248,.75)}
.hz3d-tg.orbit .d{opacity:.55}
.hz3d-tg.hold .p{background:#120a06;border-color:#ff5a1f;color:#ff8a5c;font-weight:600}
.hz-live .hz3d-tg.hit:hover .p{filter:brightness(1.08)}
.hz3d-zl{position:absolute;left:0;top:0;pointer-events:none;text-align:center;color:#2a1d14;white-space:nowrap;will-change:transform}
.hz3d-zl b{display:block;font:italic 400 24px var(--hz-serif);line-height:1}
.hz3d-zl small{display:block;font:9.5px var(--hz-mono);letter-spacing:1.4px;opacity:.7;margin-top:4px}
.hz3d-you{position:absolute;left:0;top:0;font:10px var(--hz-mono);letter-spacing:2px;color:#5a2a08;pointer-events:none}
.hz3d-enter{position:absolute;right:24px;bottom:22px;z-index:7;display:flex;align-items:center;gap:9px;font:500 13px var(--hz-sans);color:#f3efe7;background:rgba(10,14,24,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:8px 16px;pointer-events:none;transition:opacity .3s ease,transform .2s ease}
.hz3d-enter i{width:8px;height:8px;border-radius:50%;background:#ffd2a8;box-shadow:0 0 0 4px rgba(255,210,168,.2)}
.hz-sky:not(.hz-live):hover .hz3d-enter{transform:translateY(-2px);border-color:#ffd2a8}
.hz-live .hz3d-enter{opacity:0}
.hz3d-hud{position:absolute;left:0;right:0;bottom:0;z-index:7;display:flex;justify-content:space-between;align-items:flex-end;gap:10px;padding:14px 18px;pointer-events:none;flex-wrap:wrap;opacity:0;transition:opacity .4s ease}
.hz-live.hz-settled .hz3d-hud{opacity:1}
.hz3d-where{background:rgba(10,14,24,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:8px 13px;min-width:200px;color:#f3efe7}
.hz3d-where .k{font:500 10px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:#a9b4c4}
.hz3d-where .v{font:italic 400 22px var(--hz-serif);line-height:1.15}
.hz3d-where .v span{font:11px var(--hz-mono);font-style:normal;color:#a9b4c4;margin-left:6px}
.hz3d-where .bar{height:2px;background:rgba(255,255,255,.15);margin-top:6px;border-radius:2px;overflow:hidden}
.hz3d-where .bar i{display:block;height:100%;width:0;background:#ffd2a8}
.hz3d-hint{font:12px var(--hz-sans);color:#d6dde8;background:rgba(10,14,24,.5);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:6px 12px}
.hz3d-btns{display:flex;gap:6px;pointer-events:auto}
.hz3d-btns button{font:500 12.5px var(--hz-sans);color:#f3efe7;background:rgba(10,14,24,.55);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.18);border-radius:8px;padding:6px 11px;cursor:pointer}
.hz3d-btns button:hover,.hz3d-btns button:focus-visible{border-color:#ffd2a8;outline:none}
.hz-ground{background:linear-gradient(#8a6446 0,#5a4030 48px,#241a14 130px,#111827 100%);padding:10px 16px 14px;display:grid;gap:8px}
.hz-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.hz-row b{font:italic 400 22px var(--hz-serif);color:#f3e3cf;margin-right:6px;min-width:64px}
.hz-hold{display:inline-flex;align-items:center;gap:10px;border:1px solid #ff5a1f;background:#120a06;color:#ff8a5c;border-radius:999px;padding:4px 6px 4px 13px;font:600 12.5px var(--hz-sans)}
.hz-hold button{font:500 11px var(--hz-mono);color:#f3e3cf;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:2px 9px;cursor:pointer}
.hz-hold button:hover,.hz-hold button:focus-visible{border-color:#ffd2a8;outline:none}
.hz-hold button:disabled{opacity:.5;cursor:default}
.hz-undated{border:1px dashed rgba(243,239,231,.35);border-radius:999px;padding:4px 12px;font:12.5px var(--hz-sans);color:#f3efe7}
.hz-undated span{font:11px var(--hz-mono);color:#a9b4c4;margin-left:6px}
.hz-none{font:13px var(--hz-sans);color:#d6c4ae}
@media (max-width:760px){.hz-say{max-width:70%}.hz-cap{display:none}.hz3d-hint{display:none}}
`;

export function HorizonHero() {
  const { taskRefreshCounter, refreshTasks } = useRefresh();
  const skyRef = React.useRef<HTMLDivElement>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const spaceRef = React.useRef<DawnSpace | null>(null);
  const [data, setData] = React.useState<HorizonData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [completing, setCompleting] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/tasks/horizon')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) { setData(json.data as HorizonData); setError(null); }
        else setError(json.error || 'Could not load the horizon');
      })
      .catch(() => { if (!cancelled) setError('Could not load the horizon'); });
    return () => { cancelled = true; };
  }, [taskRefreshCounter]);

  // The 3D world lives for the life of the component; it is loaded on demand so three.js stays out of the first paint.
  React.useEffect(() => {
    let disposed = false;
    import('./dawn-space').then(({ DawnSpace: Space }) => {
      if (disposed || !skyRef.current || !svgRef.current) return;
      try {
        spaceRef.current = new Space(skyRef.current, svgRef.current);
      } catch (err) {
        console.warn('Horizon 3D unavailable:', err);
      }
    });
    return () => { disposed = true; spaceRef.current?.destroy(); spaceRef.current = null; };
  }, []);

  // Draw the flat Dawn (again once web fonts are in, so pill widths match the real face).
  React.useEffect(() => {
    if (!data || !svgRef.current) return;
    const draw = () => {
      if (!svgRef.current) return;
      const spots = drawDawn(svgRef.current, data);
      spaceRef.current?.setLayout(spots, data);
    };
    draw();
    let alive = true;
    document.fonts?.ready.then(() => { if (alive) draw(); });
    const retry = window.setTimeout(() => { if (alive) draw(); }, 600);   // in case the 3D layer loaded after the first draw
    return () => { alive = false; window.clearTimeout(retry); };
  }, [data]);

  const completeHold = React.useCallback(async (taskId: string, listType: string) => {
    setCompleting(taskId);
    try {
      await fetch('/api/tasks/today/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, listType, date: getCurrentDateISO() }),
      });
      refreshTasks();
    } finally {
      setCompleting(null);
    }
  }, [refreshTasks]);

  const answers = data ? horizonAnswers(data) : null;
  const headline = answers?.next
    ? (answers.holds.length ? <>Clear the pad, then <em>{answers.next.short}</em>.</> : <>Next up: <em>{answers.next.short}</em>.</>)
    : <>Clear skies.</>;
  const sub = answers
    ? [`${answers.cleared} cleared this week.`, answers.big ? `Next big launch: ${answers.big.short} · ${answers.big.day}.` : '']
      .filter(Boolean).join(' ')
    : '';

  return (
    <section className={`hz-hero ${serif.variable}`} aria-label="Priority horizon">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div
        ref={skyRef}
        className="hz-sky"
        tabIndex={0}
        aria-label="Priority horizon. Press Enter or click to step inside in 3D; Escape returns to the flat view."
      >
        <svg ref={svgRef} className="hz-flat" viewBox="0 0 1200 630" role="img" aria-label="Tasks arranged on rings by how soon they are due" />
        {!data && <div className="hz-loading">{error || 'Loading your horizon…'}</div>}
        <div className="hz-say">
          <h1>{headline}</h1>
          {sub && <p>{sub}</p>}
        </div>
        <div className="hz-cap hz-nointeract" onClick={(e) => e.stopPropagation()}>
          <QuickCaptureInput variant="inline" />
        </div>
      </div>
      <div className="hz-ground">
        <div className="hz-row">
          <b>Pad</b>
          {data && data.holds.length === 0 && <span className="hz-none">Nothing overdue. The pad is clear.</span>}
          {data?.holds.map((h) => (
            <span key={h.id} className="hz-hold" title={h.title}>
              HOLD · {h.short} · {h.left}
              <button type="button" disabled={completing === h.id} onClick={() => completeHold(h.id, h.listType)}>
                {completing === h.id ? 'Saving…' : 'Done'}
              </button>
            </span>
          ))}
        </div>
        {data && data.undated.length > 0 && (
          <div className="hz-row">
            <b>No date</b>
            {data.undated.map((u) => (
              <span key={u.id} className="hz-undated" title={u.title}>{u.short}{u.label && <span>{u.label}</span>}</span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
