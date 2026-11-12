'use client';

// Sunrise: the home page's hero. Horizon Dawn's sky, where every task is a small form that says what it is, its
// name and its next step, the ones that matter most show a picture of the work, and pressing one opens the work
// right there. The engine (engine.ts) draws and lays everything out with three Handwired programs; this component
// loads the data, fills the engine's slots (the capture box, the trays, the workspace) and talks to the journal.
import React from 'react';
import { createPortal } from 'react-dom';
import { Instrument_Serif } from 'next/font/google';
import { QuickCaptureInput } from '@/components/quick-capture/QuickCaptureInput';
import { LetGoReasonModal } from '@/components/LetGoReasonModal';
import { DONE_CSS, DoneTray } from '@/components/horizon/DoneTray';
import { BRIEF_CSS } from '@/components/horizon/TaskBriefCard';
import { CHAT_CSS } from '@/components/horizon/BriefChat';
import { ActionCardView, CARD_CSS, type CardDecisionInput } from '@/components/horizon/ActionCardView';
import { decideCard, undoCard } from '@/components/horizon/card-actions';
import type { ActionCard, FarSideView } from '@/lib/action-cards/types';
import { cardFormSpec, cardSalience } from '@/lib/sunrise/form-spec';
import { getCurrentDateISO } from '@/lib/current-date';
import { useRefresh } from '@/lib/RefreshContext';
import type { HorizonDaily } from '@/lib/horizon';
import type { SunriseData } from '@/lib/sunrise/data';
import type { DoneProposalRecord } from '@/app/api/tasks/done-proposals/store';
import type { DoneReceipt } from '@/app/api/tasks/done-at/apply';
import type { CardThing, SunriseEngine, TrayKind } from './engine';
import { SUNRISE_CSS } from './sunrise-css';
import { PANE_CSS, TaskPane } from './TaskPane';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });

// The journal's brief, chat and done components were drawn for Dawn's night sky; they read these.
const HERO_CSS = `
.sr-hero{--hz-ink:#f3efe7;--hz-dim:#a9b4c4;--hz-em:#ffd2a8;--hz-serif:var(--font-instrument-serif),'Instrument Serif',serif;--hz-sans:var(--font-geist-sans),Geist,sans-serif;--hz-mono:var(--font-geist-mono),'Geist Mono',monospace}
.sr-tray .sr-t{margin:0;font:400 22px/1.1 var(--serif)}
.sr-tray .sr-s{margin:4px 0 10px;color:#7a6656}
.sr-tray .sr-u{display:flex;align-items:center;gap:5px;padding:6px 0;border-top:1px solid #efe5d9;flex-wrap:wrap}
.sr-tray .sr-u>span{flex:1 1 150px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sr-tray .sr-u .sr-b,.sr-tray .sr-u input{padding:3px 8px;font-size:11.5px}
.sr-tray .sr-u input[type=date]{border:1px solid rgba(60,30,10,.2);border-radius:999px;background:#fff;color:#24140a;height:26px;font-family:var(--sans)}
.sr-tray .sr-list{margin:8px 0 0;padding:0;list-style:none;display:grid;gap:4px}
.sr-tray .sr-list li.did{text-decoration:line-through;color:#9a8676}
.sr-tray label.daily{display:flex;gap:8px;align-items:center;padding:5px 0;cursor:pointer}
.sr-tray label.daily.did span{color:#9a8676}
.sr-tray .sr-err{margin:8px 0 0;color:#a3361a}
.sr-tray .sr-hold{display:grid;gap:6px;padding:8px 0;border-top:1px solid #efe5d9}
.sr-tray .sr-hold:first-of-type{border-top:0}
.sr-tray .sr-hold .sr-open{justify-self:start}
.sr-tray[data-kind=holds]{width:min(480px,calc(100% - 20px));background:#17120f;color:#f3efe7}
.sr-tray[data-kind=holds] .sr-s{color:#c9b8a6}
.sr-tray[data-kind=holds] .sr-hold{border-color:rgba(255,255,255,.12)}
.sr-tray[data-kind=holds] .sr-open{background:transparent;color:#ffd2a8;border-color:rgba(255,210,168,.5);padding:3px 11px;font-size:12px}
.hz-hold{display:inline-flex;align-items:center;gap:10px;border:1px solid #ff5a1f;background:#120a06;color:#ff8a5c;border-radius:999px;padding:4px 6px 4px 13px;font:600 12.5px var(--hz-sans)}
.hz-hold button{font:500 11px var(--hz-mono);color:#f3e3cf;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:2px 9px;cursor:pointer}
.hz-hold button:hover,.hz-hold button:focus-visible{border-color:#ffd2a8;outline:none}
.hz-hold button:disabled{opacity:.5;cursor:default}
.hz-hold .hz-letgo{background:transparent;border-color:rgba(255,255,255,.12);color:#c9b8a6}
.sr-tray .sr-card{display:grid;gap:1px;width:100%;text-align:left;padding:7px 2px;border:0;border-top:1px solid #efe5d9;background:none;cursor:pointer;color:inherit}
.sr-tray .sr-card:hover b{color:#b0521c}
.sr-tray .sr-card small{font:10px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:#9a5a24}
.sr-tray .sr-card span{color:#7a6656;font-size:12px}
.sr-tray .sr-cards{max-height:320px;overflow:auto}
.thing.is-card .shape.sm{border-style:dashed}
.src{position:absolute;inset:0;overflow:auto;background:linear-gradient(180deg,#161b30,#090c18)}
.src .ac{position:static;width:100%;max-height:none;border:0;border-radius:0;box-shadow:none;backdrop-filter:none;-webkit-backdrop-filter:none;background:none}
.sr-undo{position:absolute;left:50%;bottom:104px;z-index:31;transform:translateX(-50%);display:inline-flex;align-items:center;gap:10px;font:12.5px var(--sans);color:#f3e3cf;background:rgba(10,14,24,.85);border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:5px 6px 5px 13px;white-space:nowrap}
.sr-undo button{font:500 11px var(--mono);color:#ffd2a8;background:transparent;border:1px solid rgba(255,210,168,.4);border-radius:999px;padding:2px 9px;cursor:pointer}
`;

const CARD_WHEN: Record<ActionCard['when'], string> = { now: 'Fits a Focus bet right now', period: 'Fine on a build day this period', after: 'Parked until after finals', someday: 'No date yet' };
const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const dayFrom = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function SunriseHero() {
  const { taskRefreshCounter, refreshTasks } = useRefresh();
  const skyRef = React.useRef<HTMLDivElement>(null);
  const engineRef = React.useRef<SunriseEngine | null>(null);
  const [engine, setEngine] = React.useState<SunriseEngine | null>(null);
  const [data, setData] = React.useState<SunriseData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<string | null>(null);
  const [tray, setTray] = React.useState<TrayKind | null>(null);
  const [trayError, setTrayError] = React.useState<string | null>(null);
  const [proposals, setProposals] = React.useState<DoneProposalRecord[]>([]);
  const [undo, setUndo] = React.useState<{ text: string; run: () => Promise<unknown> } | null>(null);
  const undoTimer = React.useRef<number | null>(null);
  const [letGoAsk, setLetGoAsk] = React.useState<{ id: string; listType: string; short: string; title: string } | null>(null);
  const [tick, setTick] = React.useState(0);
  const [cards, setCards] = React.useState<ActionCard[]>([]);

  // The journal's data: on load, whenever tasks change anywhere on the page, and every five minutes.
  React.useEffect(() => {
    let cancelled = false;
    fetch('/api/tasks/sunrise')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success) { setData(json.data as SunriseData); setError(null); }
        else setError(json.error || 'Could not load the horizon');
      })
      .catch(() => { if (!cancelled) setError('Could not load the horizon'); });
    return () => { cancelled = true; };
  }, [taskRefreshCounter, tick]);
  React.useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, []);

  // The action cards still to decide: things OpenClaw noticed and posts he saved. The heaviest rise beside the
  // tasks; all of them wait in the "to decide" chip on the ground.
  const loadCards = React.useCallback(() => {
    fetch('/api/action-cards')
      .then((r) => r.json())
      .then((json) => { if (json.success) setCards((json.data as FarSideView).cards.filter((card) => card.status === 'open')); })
      .catch(() => {});
  }, []);
  React.useEffect(() => { loadCards(); }, [loadCards, taskRefreshCounter, tick]);
  const cardThings = React.useMemo<CardThing[]>(() => cards
    .map((card) => ({ id: `card:${card.id}`, salience: cardSalience(card), form: { spec: cardFormSpec(card), when: card.estimate } }))
    .sort((a, b) => b.salience - a.salience)
    .slice(0, 3), [cards]);

  const loadProposals = React.useCallback(() => {
    fetch('/api/tasks/done-proposals')
      .then((r) => r.json())
      .then((json) => { if (json.success) setProposals(json.records as DoneProposalRecord[]); })
      .catch(() => {});
  }, []);
  React.useEffect(() => { loadProposals(); }, [loadProposals, taskRefreshCounter]);
  // While OpenClaw is answering "done, but when?", check back every few seconds.
  const thinking = proposals.some((p) => p.status === 'thinking');
  React.useEffect(() => {
    if (!thinking) return;
    const timer = window.setInterval(loadProposals, 3000);
    return () => window.clearInterval(timer);
  }, [thinking, loadProposals]);

  const toggleDaily = React.useCallback(async (daily: HorizonDaily) => {
    try {
      const json = await post('/api/tasks/today/complete', { taskId: daily.id, listType: daily.listType, date: getCurrentDateISO() });
      if (!json?.success) engineRef.current?.toast(`${daily.short}: ${json?.error || 'could not be updated'}`);
    } catch {
      engineRef.current?.toast(`${daily.short} could not be updated: the Journal did not answer`);
    }
    refreshTasks();
  }, [refreshTasks]);
  const hostRef = React.useRef({ toggleDaily });
  hostRef.current = { toggleDaily };

  // The engine lives for the life of the component. It and the layout programs are loaded on demand, so building
  // them (most of a second) never holds up the page's first paint.
  React.useEffect(() => {
    let disposed = false;
    void import('./engine').then(async ({ SunriseEngine: Engine, loadPrograms }) => {
      const programs = await loadPrograms();
      if (disposed || !skyRef.current) return;
      const made = new Engine(skyRef.current, programs, {
        onOpen: setOpen,
        onTray: (kind) => { setTray(kind); setTrayError(null); },
        onToggleDaily: (daily) => void hostRef.current.toggleDaily(daily),
      });
      engineRef.current = made;
      setEngine(made);
    }).catch((err) => { console.error('Sunrise could not start:', err); if (!disposed) setError('Sunrise could not start'); });
    return () => { disposed = true; engineRef.current?.destroy(); engineRef.current = null; setEngine(null); };
  }, []);
  React.useEffect(() => { if (engine && data) engine.update(data, cardThings, cards.length); }, [engine, data, cardThings, cards.length]);

  const offerUndo = React.useCallback((text: string, run: () => Promise<unknown>) => {
    setUndo({ text, run });
    if (undoTimer.current) window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 8000);
  }, []);
  React.useEffect(() => () => { if (undoTimer.current) window.clearTimeout(undoTimer.current); }, []);
  const runUndo = React.useCallback(async () => {
    if (!undo) return;
    setUndo(null);
    await undo.run().catch(() => {});
    refreshTasks();
  }, [undo, refreshTasks]);

  const onDone = React.useCallback((short: string) => (receipt: DoneReceipt, label: string) => {
    offerUndo(`Done: ${short} · ${label}.`, () => post('/api/tasks/done-at/undo', receipt));
    engineRef.current?.closeTray();
    refreshTasks();
  }, [offerUndo, refreshTasks]);

  // Let go: no longer worth doing. Not a completion. Asks why first; the reason is required.
  const letGo = React.useCallback(async (reason: string): Promise<string | void> => {
    if (!letGoAsk) return;
    const { id: taskId, listType, short } = letGoAsk;
    const json = await post('/api/tasks/let-go', { taskId, listType, reason }).catch(() => null);
    if (!json?.success) return json?.error || 'Could not let the task go.';
    setLetGoAsk(null);
    engineRef.current?.closeTray();
    engineRef.current?.closeTask();
    offerUndo(`Let go of ${short}.`, () => post('/api/tasks/let-go/restore', { taskId }));
    refreshTasks();
  }, [letGoAsk, offerUndo, refreshTasks]);

  // Giving an undated task a When: it launches from the ground onto its ring.
  const setWhen = React.useCallback(async (taskId: string, short: string, dueDate: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return;
    setTrayError(null);
    const json = await post('/api/tasks/update', { taskId, listType: 'have-to-do', dueDate }).catch(() => null);
    if (!json?.success) { setTrayError(json?.error || 'That did not save. Try again.'); return; }
    engineRef.current?.closeTray();
    engineRef.current?.toast(`${short} → ${dueDate === dayFrom(0) ? 'today' : dueDate === dayFrom(1) ? 'tomorrow' : dueDate}`);
    refreshTasks();
  }, [refreshTasks]);

  // Answering a card always takes a reason. Agreeing can make it a task, which then rises on the rings.
  const decide = React.useCallback(async (card: ActionCard, d: CardDecisionInput): Promise<string | void> => {
    const decided = await decideCard(card, d);
    if (!decided.ok) return decided.error;
    engineRef.current?.closeTask();
    loadCards();
    refreshTasks();
    const said = d.verdict === 'agree'
      ? d.outcome === 'task' ? `Agreed. ${card.short} is a task now.` : d.outcome === 'hand' ? 'Agreed. OpenClaw is on it.' : `Agreed. ${decided.outcome?.label ?? ''}`
      : d.snooze ? 'Dismissed for now; it comes back later.' : 'Dismissed. OpenClaw keeps your reason.';
    offerUndo(said, async () => { await undoCard(card.id); loadCards(); });
  }, [loadCards, offerUndo, refreshTasks]);
  const openCard = open?.startsWith('card:') ? cards.find((card) => `card:${card.id}` === open) ?? null : null;

  const horizon = data?.horizon ?? null;
  const openTask = (id: string) => engineRef.current?.openTask(id);

  const trayBody = !horizon || !data || !tray ? null : tray === 'holds' ? (
    <>
      <p className="sr-t">Overdue</p>
      <p className="sr-s">Done, but when? Or let it go.</p>
      {horizon.holds.map((h) => (
        <div key={h.id} className="sr-hold hz-row-b">
          <DoneTray
            target={{ id: h.id, listType: h.listType, short: h.short, title: h.title, due: h.due, implied: h.implied, left: h.left }}
            record={proposals.find((p) => p.taskId === h.id) ?? null}
            onLetGo={() => setLetGoAsk({ id: h.id, listType: h.listType, short: h.short, title: h.title })}
            onDone={onDone(h.short)}
            onChanged={loadProposals}
          />
          <button type="button" className="sr-b sr-open" onClick={() => openTask(h.id)}>Open it</button>
        </div>
      ))}
    </>
  ) : tray === 'nodate' ? (
    <>
      <p className="sr-t">No date yet</p>
      <p className="sr-s">Give one a When and it launches onto its ring.</p>
      {horizon.undated.map((u) => (
        <div key={u.id} className="sr-u">
          <span title={u.title}>{u.short}</span>
          <button type="button" className="sr-b" onClick={() => void setWhen(u.id, u.short, dayFrom(0))}>Today</button>
          <button type="button" className="sr-b" onClick={() => void setWhen(u.id, u.short, dayFrom(1))}>Tomorrow</button>
          <button type="button" className="sr-b" onClick={() => void setWhen(u.id, u.short, dayFrom(7))}>Next week</button>
          <input type="date" aria-label={`A date for ${u.short}`} min={dayFrom(0)} onChange={(e) => void setWhen(u.id, u.short, e.target.value)} />
          <button type="button" className="sr-b" onClick={() => openTask(u.id)}>Open</button>
        </div>
      ))}
      {trayError && <p className="sr-err" role="alert">{trayError}</p>}
    </>
  ) : tray === 'cards' ? (
    <>
      <p className="sr-t">To decide</p>
      <p className="sr-s">Things OpenClaw noticed and posts you saved. Agree or dismiss, with a reason.</p>
      <div className="sr-cards">
        {cards.slice().sort((a, b) => cardSalience(b) - cardSalience(a)).map((card) => (
          <button key={card.id} type="button" className="sr-card" onClick={() => openTask(`card:${card.id}`)}>
            <small>{card.kind} · {card.estimate}</small>
            <b>{card.short || card.title}</b>
            <span>{card.next}</span>
          </button>
        ))}
      </div>
    </>
  ) : tray === 'today' ? (
    <>
      <p className="sr-t">Today</p>
      <ul className="sr-list">
        {data.today.map((row) => <li key={row.id} className={row.completed ? 'did' : undefined}>{row.short}</li>)}
      </ul>
    </>
  ) : (
    <>
      <p className="sr-t">Dailies</p>
      {horizon.dailies.map((d) => (
        <label key={d.id} className={`daily${d.done ? ' did' : ''}`}>
          <input type="checkbox" checked={d.done} onChange={() => void toggleDaily(d)} /> <span>{d.short}</span>
        </label>
      ))}
    </>
  );

  // A "done, but when?" conversation whose task is no longer overdue on the ground still needs an answer.
  const waiting = horizon ? proposals.filter((p) => !horizon.holds.some((h) => h.id === p.taskId)) : [];

  return (
    <section className={`sr-hero ${serif.variable}`} aria-label="Sunrise: your tasks by how soon they are due">
      <style dangerouslySetInnerHTML={{ __html: SUNRISE_CSS + DONE_CSS + BRIEF_CSS + CHAT_CSS + CARD_CSS + PANE_CSS + HERO_CSS }} />
      <div
        ref={skyRef}
        className="sr-sky"
        tabIndex={0}
        aria-label="Your tasks on rings by how soon they are due. Press a task to open it. Escape closes."
      />
      {!engine && <div className="sr-loading">{error || 'Loading your horizon…'}</div>}
      {engine && error && !data && <div className="sr-loading">{error}</div>}
      {engine && createPortal(<div onClick={(e) => e.stopPropagation()}><QuickCaptureInput variant="inline" /></div>, engine.slots.cap)}
      {engine && trayBody && createPortal(trayBody, engine.slots.tray)}
      {engine && openCard && createPortal(
        <div className="src">
          <ActionCardView
            key={openCard.id}
            card={openCard}
            where={`${CARD_WHEN[openCard.when]}. ${openCard.betLabel}.`}
            side="r"
            onClose={() => engineRef.current?.closeTask()}
            onDecide={(d) => decide(openCard, d)}
          />
        </div>,
        engine.slots.pane,
      )}
      {engine && open && !open.startsWith('card:') && data && createPortal(
        <TaskPane
          key={open}
          taskId={open}
          data={data}
          onClose={() => engineRef.current?.closeTask()}
          onGoto={openTask}
          onChanged={refreshTasks}
          onLetGo={(target) => setLetGoAsk(target)}
          onUndo={offerUndo}
        />,
        engine.slots.pane,
      )}
      {undo && <span className="sr-undo" role="status">{undo.text}<button type="button" onClick={() => void runUndo()}>Undo</button></span>}
      {waiting.length > 0 && (
        <div className="hz-ground hz-keep" style={{ background: '#17120f', padding: '10px 16px', display: 'grid', gap: 8 }}>
          <div className="hz-row hz-row-b" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {waiting.map((p) => (
              <DoneTray
                key={p.id}
                target={{ id: p.taskId, listType: p.listType, short: p.short, title: p.title, due: p.due, implied: p.dueIsImplied }}
                record={p}
                onDone={onDone(p.short)}
                onChanged={loadProposals}
              />
            ))}
          </div>
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 70 }}>
        <LetGoReasonModal taskText={letGoAsk?.title ?? null} onCancel={() => setLetGoAsk(null)} onConfirm={letGo} />
      </div>
    </section>
  );
}
