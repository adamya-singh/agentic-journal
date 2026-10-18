'use client';

// Daily tasks never come due, so instead of sitting on the zones they ring the sun ("you"): one arc each,
// lit once it's done today. Hover an arc for its name, click it to check it off; click the sun for the
// list. The flat drawing (dawn-svg) and the 3D sun (dawn-space) draw the ring; this layer owns the clicks.
import React from 'react';
import { getCurrentDateISO } from '@/lib/current-date';
import { fmtMinutes, type HorizonData, type HorizonDaily } from '@/lib/horizon';
import { DAILY_R, DAWN, dailyArcs } from './dawn-svg';
import type { DawnSpace } from './dawn-space';

const DAILY_CSS = `
.hzd-frame{position:absolute;left:0;top:0;width:100%;aspect-ratio:1200/630;z-index:8;pointer-events:none}
.hz-hero:has(.hz-live) .hzd-pick,.hz-hero:has(.hz-live) .hzd-sun{display:none}
.hzd-pick{position:absolute;transform:translate(-50%,-50%);width:2.8%;aspect-ratio:1;min-width:22px;border:0;padding:0;border-radius:50%;background:transparent;cursor:pointer;pointer-events:auto}
.hzd-pick:focus-visible{box-shadow:0 0 0 2px #ffd2a8;outline:none}
.hzd-sun{position:absolute;transform:translate(-50%,-100%);width:${(2 * (DAWN.R[0] - 6)) / 12}%;aspect-ratio:2;border:0;padding:0;border-radius:999px 999px 0 0;background:transparent;cursor:pointer;pointer-events:auto}
.hzd-sun:focus-visible{box-shadow:0 0 0 2px #ffd2a8;outline:none}
.hz-flat .hz-dseg{transition:stroke .15s ease,stroke-width .15s ease}
.hz-flat .hz-dseg.hot{stroke:#ffd2a8;stroke-width:6}
.hzd-tip{position:absolute;z-index:9;pointer-events:none;font:500 12.5px var(--hz-sans);color:var(--hz-ink);background:rgba(10,14,24,.8);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,210,168,.5);border-radius:999px;padding:5px 12px;white-space:nowrap}
.hzd-tip span{font:11px var(--hz-mono);color:var(--hz-dim);margin-left:6px}
.hzd-card{position:absolute;width:300px;max-width:calc(100vw - 32px);box-sizing:border-box;pointer-events:auto;color:var(--hz-ink);background:linear-gradient(180deg,rgba(22,27,48,.86),rgba(9,12,24,.93));backdrop-filter:blur(22px) saturate(1.3);-webkit-backdrop-filter:blur(22px) saturate(1.3);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:12px 16px 8px;box-shadow:0 40px 90px -20px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.08);animation:hzd-in .22s cubic-bezier(.2,.8,.2,1)}
@keyframes hzd-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.hzd-head{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:6px}
.hzd-head b{font:italic 400 22px var(--hz-serif)}
.hzd-head>span{display:inline-flex;align-items:flex-end;gap:10px;font:11px var(--hz-mono);color:var(--hz-dim)}
.hzd-week{display:inline-flex;gap:3px;align-items:flex-end;height:14px}
.hzd-week i{display:block;width:5px;border-radius:1px;background:rgba(255,255,255,.2)}
.hzd-week i.on{background:#ffd2a8}
.hzd-row{display:flex;align-items:center;gap:10px;width:100%;padding:5px 0;border:0;border-top:1px solid rgba(255,255,255,.07);background:transparent;color:inherit;font:13px var(--hz-sans);text-align:left;cursor:pointer}
.hzd-row:hover span,.hzd-row:focus-visible span{color:#ffd2a8}
.hzd-row:focus-visible{outline:none}
.hzd-row:disabled{cursor:progress;opacity:.6}
.hzd-row i{flex:none;width:16px;height:16px;border-radius:50%;border:1.4px solid #ffe2c4;box-sizing:border-box;display:grid;place-items:center;font:700 10px var(--hz-sans);font-style:normal;color:#7a3a10}
.hzd-row.done{color:var(--hz-dim)}
.hzd-row.done i{background:#fff6ec;border-color:#fff6ec}
.hzd-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hzd-row small{font:11px var(--hz-mono);color:var(--hz-dim)}
.hzd-err{margin:4px 0;font:12px var(--hz-sans);color:#ff8a5c}
/* 3D: dawn-space builds these targets over the ring and the count above the sun. */
.hz3d-ds,.hz3d-dl,.hz3d-dz{position:absolute;left:0;top:0;border:0;padding:0;background:transparent;pointer-events:none;will-change:transform,opacity}
.hz3d-dz{border-radius:50%}
.hz-live .hz3d-dz.hit{pointer-events:auto}
.hz3d-ds{width:26px;height:26px;border-radius:50%}
.hz3d-dl{font:10px var(--hz-mono);letter-spacing:1.6px;color:#ffe2c4;white-space:nowrap;padding:3px 8px;border-radius:999px}
.hz-live .hz3d-ds.hit,.hz-live .hz3d-dl.hit{pointer-events:auto;cursor:pointer}
.hz3d-dl.hit:hover,.hz3d-dl:focus-visible{background:rgba(10,14,24,.55);outline:none}
.hz3d-ds:hover::after,.hz3d-ds:focus-visible::after{content:attr(data-label);position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);font:500 12px var(--hz-sans);color:var(--hz-ink);background:rgba(10,14,24,.8);border:1px solid rgba(255,210,168,.5);border-radius:999px;padding:4px 11px;white-space:nowrap}
.hz3d-ds:focus-visible{outline:none;box-shadow:0 0 0 2px #ffd2a8}
@media (max-width:760px){.hzd-card.flat{left:50%!important;transform:translateX(-50%)}}
@media (prefers-reduced-motion:reduce){.hzd-card{animation:none}}
.hzd-card:not(.flat){animation:none}
`;

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Where an arc's middle sits on the flat drawing, in percent of the sky box.
function arcSpot(mid: number): { left: string; top: string; right: boolean } {
  const a = mid * Math.PI / 180;
  return { left: `${(DAWN.X + DAILY_R * Math.cos(a)) / 12}%`, top: `${((DAWN.H - DAILY_R * Math.sin(a)) / 630) * 100}%`, right: mid < 90 };
}

export function DailyRing({ data, space, onChanged }: {
  data: HorizonData | null;
  space: DawnSpace | null;
  onChanged: () => void;
}) {
  const dailies = React.useMemo(() => data?.dailies ?? [], [data]);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onOpen = () => setOpen((o) => !o);
    window.addEventListener('hz-daily-open', onOpen);
    return () => window.removeEventListener('hz-daily-open', onOpen);
  }, []);
  const [hot, setHot] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const cardRef = React.useRef<HTMLDivElement>(null);

  const toggle = React.useCallback(async (d: HorizonDaily) => {
    setBusy(d.id);
    setError(null);
    try {
      const res = await fetch('/api/tasks/today/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: d.id, listType: d.listType, date: getCurrentDateISO() }),
      });
      const json = await res.json().catch(() => null);
      if (!json?.success) setError(`${d.short}: ${json?.error || 'could not be updated'}. Try again.`);
      onChanged();
    } catch {
      setError(`${d.short} could not be updated: the Journal did not answer. Try again.`);
    } finally {
      setBusy(null);
    }
  }, [onChanged]);

  React.useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), 6000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // The 3D world asks for the same two things through its hooks.
  const latest = React.useRef({ dailies, toggle });
  latest.current = { dailies, toggle };
  React.useEffect(() => {
    if (!space) return;
    space.onDailyToggle = (id) => {
      const d = latest.current.dailies.find((x) => x.id === id);
      if (d) void latest.current.toggle(d);
    };
    space.onDailyOpen = () => setOpen((o) => !o);
    return () => { space.onDailyToggle = null; space.onDailyOpen = null; };
  }, [space]);

  // Light the hovered arc in the flat drawing.
  React.useEffect(() => {
    const svg = frameRef.current?.closest('.hz-hero')?.querySelector('svg.hz-flat');
    svg?.querySelectorAll('.hz-dseg.hot').forEach((el) => el.classList.remove('hot'));
    if (hot) svg?.querySelector(`.hz-dseg[data-daily="${CSS.escape(hot)}"]`)?.classList.add('hot');
  }, [hot, data]);

  // Escape and clicks elsewhere close the list. Escape is caught first so it doesn't also leave 3D.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest('.hzd-card,.hzd-sun,.hz-daily-line,.hz3d-dl,.hz3d-ds')) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', onDown); };
  }, [open]);

  // In 3D the list hangs beside the sun wherever the camera puts it.
  React.useEffect(() => {
    if (!open || !space) return;
    let raf = 0;
    const follow = () => {
      raf = requestAnimationFrame(follow);
      const card = cardRef.current, frame = frameRef.current;
      if (!card || !frame) return;
      if (!space.isLive) { card.style.transform = ''; return; }
      const sun = space.sunScreen(), W = frame.clientWidth, H = frame.clientHeight;
      if (!sun.on) { setOpen(false); return; }
      const x = Math.max(12, Math.min(W - card.offsetWidth - 12, sun.x + sun.r + 20));
      const y = Math.max(12, Math.min(H - card.offsetHeight - 12, sun.y - card.offsetHeight / 2));
      card.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    };
    follow();
    return () => cancelAnimationFrame(raf);
  }, [open, space]);

  if (!dailies.length) return null;

  const arcs = dailyArcs(dailies.length);
  const hotIdx = dailies.findIndex((d) => d.id === hot);
  const done = dailies.filter((d) => d.done).length;
  const leftMin = dailies.filter((d) => !d.done).reduce((t, d) => t + (d.minutes ?? 0), 0);
  const today = data ? new Date(data.now) : new Date();
  const week = data?.dailyWeek ?? [];
  const live = !!space?.isLive;
  const len = (d: HorizonDaily) => (d.minutes ? fmtMinutes(d.minutes) : '');

  return (
    <div ref={frameRef} className="hzd-frame hz-keep">
      <style dangerouslySetInnerHTML={{ __html: DAILY_CSS }} />
      {arcs.map((arc, i) => {
        const d = dailies[i], spot = arcSpot(arc.mid);
        return (
          <button
            key={d.id}
            type="button"
            className="hzd-pick"
            style={{ left: spot.left, top: spot.top }}
            aria-label={`${d.title}${d.done ? ', done today. Mark not done.' : '. Check off for today.'}`}
            disabled={busy === d.id}
            onPointerEnter={() => setHot(d.id)}
            onPointerLeave={() => setHot((h) => (h === d.id ? null : h))}
            onFocus={() => setHot(d.id)}
            onBlur={() => setHot((h) => (h === d.id ? null : h))}
            onClick={() => void toggle(d)}
          />
        );
      })}
      {hotIdx >= 0 && !open && !live && (() => {
        const d = dailies[hotIdx], spot = arcSpot(arcs[hotIdx].mid);
        return (
          <div className="hzd-tip" role="status" style={{ left: spot.left, top: spot.top, transform: `translate(${spot.right ? '18px' : 'calc(-100% - 18px)'},-130%)` }}>
            {d.short}<span>{[len(d), d.done ? 'done · click to undo' : 'click to check off'].filter(Boolean).join(' · ')}</span>
          </div>
        );
      })()}
      {open && (
        <div
          ref={cardRef}
          className={`hzd-card${live ? '' : ' flat'}`}
          role="dialog"
          aria-label="Daily tasks"
          style={live ? { left: 0, top: 0 } : { left: `${(DAWN.X + 78) / 12}%`, top: `${((DAWN.H - 55) / 630) * 100}%` }}
        >
          <div className="hzd-head">
            <b>Daily</b>
            <span>
              {done} of {dailies.length}{leftMin && done < dailies.length ? ` · ${fmtMinutes(leftMin)} left` : ''}
              {week.length > 0 && (
                <span className="hzd-week" aria-label={`Last ${week.length} days: ${week.join(', ')} done`}>
                  {week.map((n, i) => {
                    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (week.length - 1 - i));
                    return <i key={i} className={n ? 'on' : ''} style={{ height: n ? 3 + Math.min(n, dailies.length) * 2.2 : 2 }} title={`${i === week.length - 1 ? 'Today' : WEEKDAY[day.getDay()]}: ${n} of ${dailies.length}`} />;
                  })}
                </span>
              )}
            </span>
          </div>
          {dailies.map((d) => (
            <button key={d.id} type="button" className={`hzd-row${d.done ? ' done' : ''}`} aria-pressed={d.done} title={d.title} disabled={busy === d.id} onClick={() => void toggle(d)}>
              <i>{d.done ? '✓' : ''}</i>
              <span>{d.short}</span>
              <small>{len(d)}</small>
            </button>
          ))}
          {error && <p className="hzd-err" role="alert">{error}</p>}
        </div>
      )}
      {error && !open && <div className="hzd-tip" role="alert" style={{ left: '50%', top: `${((DAWN.H - DAILY_R - 34) / 630) * 100}%`, transform: 'translate(-50%,-100%)', color: '#ff8a5c' }}>{error}</div>}
    </div>
  );
}
