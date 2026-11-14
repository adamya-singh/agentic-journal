'use client';

// OpenClaw's tray on the home page's ground (docs/task-worker-design.md, "Where Adamya sees it"): everything OpenClaw
// waits on him for across tasks, drawn with the brief's own item cards; what it is on now; what waits on someone
// else; the tasks where one answer would let it start; and the switch that lets it look through his other tasks on
// its own. The chip that opens it (engine.ts) counts what waits on him.
import React from 'react';
import type { NeedsYouItem, TaskWorkStatus } from '@/lib/task-work';
import { TaskWorkItem, type TaskWorkSend } from './TaskWorkStrip';
import type { WorkerChip } from './engine';

export interface WorkerNeedsYou { taskId: string; taskText: string; listType: string; items: NeedsYouItem[] }
export interface WorkerWaiting { taskId: string; taskText: string; listType: string; on: string; since: string; checkAfter: string }
export interface WorkerCouldAsk { taskId: string; taskText: string; listType: string; q: string; why?: string }
export interface WorkerSweep {
  enabled: boolean;
  cap: number;
  claimsToday: number;
  quietNow: boolean;
  sort?: { sorted: number; unsorted: number; prepare: number; nothing: number; ask: number };
}
/** GET /api/tasks/work with no task: the worker across every task. */
export interface WorkerOverview {
  needsYou: WorkerNeedsYou[];
  working: { taskId: string; taskText: string; since?: string; claimedAt?: string } | null;
  waiting?: WorkerWaiting[];
  couldAsk?: WorkerCouldAsk[];
  counts?: Partial<Record<TaskWorkStatus, number>> & { pendingItems?: number };
  sweep?: WorkerSweep;
}

export interface WorkerOverviewState {
  /** The last good read (null before the first one answers). */
  view: WorkerOverview | null;
  /** The newest read failed: the chip keeps the last good one, the tray says so. */
  failed: boolean;
  load: () => Promise<void>;
  setView: React.Dispatch<React.SetStateAction<WorkerOverview | null>>;
}

const POLL_MS = 60_000;
const POLL_OPEN_MS = 10_000;

/**
 * The worker across tasks, read with the hero's other loads (`refreshKey`), every minute while the page is in
 * view, every 10 s while its tray is open, and when the window comes back.
 */
export function useWorkerOverview(trayOpen: boolean, refreshKey: unknown): WorkerOverviewState {
  const [view, setView] = React.useState<WorkerOverview | null>(null);
  const [failed, setFailed] = React.useState(false);
  // Only the newest read is shown: one that set off before an answer can come back after it.
  const reads = React.useRef(0);
  const load = React.useCallback(async () => {
    const mine = ++reads.current;
    try {
      const json = await fetch('/api/tasks/work', { cache: 'no-store' }).then((r) => r.json());
      if (mine !== reads.current) return;
      if (json?.success && json.data && Array.isArray(json.data.needsYou)) { setView(json.data as WorkerOverview); setFailed(false); }
      else setFailed(true);
    } catch {
      if (mine === reads.current) setFailed(true);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load, refreshKey]);
  React.useEffect(() => { if (trayOpen) void load(); }, [trayOpen, load]);
  React.useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, trayOpen ? POLL_OPEN_MS : POLL_MS);
    return () => window.clearInterval(timer);
  }, [trayOpen, load]);
  React.useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [load]);
  return { view, failed, load, setView };
}

/** The ground's chip. Always there once the view has loaded: the tray holds the switch that lets OpenClaw look on its own. */
export function workerChip(view: WorkerOverview | null): WorkerChip | null {
  if (!view) return null;
  return { count: view.counts?.pendingItems ?? view.needsYou.reduce((n, group) => n + group.items.length, 0) };
}

export const OPENCLAW_TRAY_CSS = `
/* OpenClaw's tray: a little wider than the others, and as tall as the room above its chip, scrolling inside. */
.sr-tray[data-kind=openclaw]{width:min(480px,calc(100% - 20px));max-height:min(660px,var(--room,560px));overflow:auto;overscroll-behavior:contain;touch-action:pan-y;padding:16px 16px 14px}
/* Block, not grid: a phone's ✕ floats at the top right and only the heading goes around it. */
.sro{--a:#c2551b;--a-soft:color-mix(in srgb,var(--a) 14%,transparent);display:block;color:#22130a}
.sro>*+*{margin-top:16px}
.sro .sr-t{margin:0}
.sro .sr-s{margin:2px 0 0}
.sro-sec{display:grid;gap:8px}
.sro-sec>h4{margin:0;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.sro-task{display:grid;gap:8px}
.sro-task+.sro-task{padding-top:10px;border-top:1px solid #efe5d9}
.sro-name{display:flex;align-items:baseline;gap:6px;width:100%;min-width:0;padding:2px 0;border:0;background:none;cursor:pointer;text-align:left;font:500 14px/1.35 var(--sans);color:#22130a}
.sro-name span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sro-name::after{content:"›";flex:none;color:var(--a);font-size:16px}
.sro-name:hover span,.sro-name:focus-visible span{color:#b0521c;text-decoration:underline;text-underline-offset:3px}
.sro-name:focus-visible{outline:none}
.sro-said{margin:0;font:500 12.5px/1.4 var(--sans);color:#1f7a4a}
.sro-err{margin:0;color:#a3361a;font:12.5px/1.4 var(--sans)}
.sro-rows{display:grid}
.sro-row{display:grid;gap:1px;width:100%;min-width:0;text-align:left;padding:7px 2px;border:0;border-top:1px solid #efe5d9;background:none;cursor:pointer;color:inherit;font:13px/1.4 var(--sans)}
.sro-row:first-child{border-top:0}
.sro-row b{font-weight:500;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sro-row span{color:#7a6656;font-size:12.5px;overflow-wrap:anywhere}
.sro-row:hover b,.sro-row:focus-visible b{color:#b0521c}
.sro-row:focus-visible{outline:none}
.sro-row b.sro-now{white-space:normal;overflow-wrap:anywhere}
.sro-now i{display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:#14806f;transform:translateY(-1px);animation:srp-pulse 1.1s ease-in-out infinite}
.sro-sec.sro-ask{display:block}
.sro-ask>summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.sro-ask>summary::-webkit-details-marker{display:none}
.sro-ask>summary::before{content:"›";font:15px var(--sans);transition:transform .2s ease}
.sro-ask[open]>summary::before{transform:rotate(90deg)}
.sro-ask>summary em{font:400 12px var(--sans);letter-spacing:0;text-transform:none;color:#a08268}
.sro-ask .sro-rows{margin-top:6px}
.sro-more{justify-self:start;margin-top:4px;border:0;background:none;padding:4px 0;font:500 12.5px var(--sans);color:#7a5a42;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px}
.sro-sweep{display:grid;gap:8px;padding-top:12px;border-top:1px solid #efe5d9}
.sro-sweep p{margin:0;font:13.5px/1.45 var(--sans);color:#3d2a1c}
.sro-sweep .srp-btn{justify-self:start}
.sro-empty{margin:0;font:400 15px/1.45 var(--sans);color:#5b4230}
/* The item cards' buttons, as the brief draws them (TaskPane .srp .srp-btn). */
.sro .srp-btn{border:1px solid #120a05;border-radius:999px;padding:7px 15px;font:500 13px var(--sans);cursor:pointer;color:#fff6ec;background:linear-gradient(180deg,#4a3526,#22130a 55%,#170c06);box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 2px 0 #0c0603,0 10px 18px -10px rgba(34,19,10,.8);transition:transform .08s ease,box-shadow .08s ease}
.sro .srp-btn:hover{background:linear-gradient(180deg,#5a4130,#2c190d 55%,#1c0f07)}
.sro .srp-btn:active{transform:translateY(2px);box-shadow:inset 0 2px 5px rgba(0,0,0,.6)}
.sro .srp-btn.quiet{border-color:rgba(40,22,10,.22);background:linear-gradient(180deg,#fff,#f1ece5);color:#22130a;box-shadow:inset 0 1px 0 #fff,0 2px 0 rgba(40,22,10,.12),0 6px 12px -8px rgba(40,22,10,.4)}
.sro .srp-btn.quiet:hover{background:linear-gradient(180deg,#fff,#f6f2ec);border-color:rgba(40,22,10,.34)}
.sro .srp-btn.quiet:active{transform:translateY(2px);box-shadow:inset 0 2px 4px rgba(40,22,10,.2)}
.sro .srp-btn:disabled{opacity:.55;cursor:default}
.sro .srx-item{box-shadow:inset 0 1px 0 #fff,0 6px 16px -14px rgba(120,60,10,.55)}
/* A phone: a sheet at the foot of the window (sunrise-css), above the keyboard when it is up (--kb and --vvh come
   from the visual viewport). Everything pressed is a finger wide; everything typed in is 16px. */
.narrow .sr-tray[data-kind=openclaw]{bottom:var(--kb,0px)!important;max-height:min(78svh,620px,calc(var(--vvh,100svh) - 12px));padding-bottom:calc(16px + env(safe-area-inset-bottom,0px))}
.narrow .sr-tray[data-kind=openclaw].kb{padding-bottom:12px;border-radius:14px 14px 0 0}
.narrow .sro .srp-btn{min-height:44px;padding:0 16px;font-size:15px}
.narrow .sro-name{min-height:44px;align-items:center;font-size:15px}
.narrow .sro-name::after{font-size:18px}
.narrow .sro-row{min-height:44px;padding:9px 2px;font-size:14px}
.narrow .sro-row span{font-size:13.5px}
.narrow .sro-ask>summary{min-height:44px}
.narrow .sro-more{min-height:44px}
.narrow .sro-sweep p{font-size:14.5px}
.narrow .sro .srx-text{font-size:15.5px}
.narrow .sro .srx-acts span{font-size:13.5px}
.narrow .sro :is(.srx-mail .f input,.srx-mail .body,.srx-item textarea.ans,.srx-item input.why){font-size:16px}
.narrow .sro .srx-item input.why{min-height:44px}
`;

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
/** A task's name without the [Section] it is filed under. */
const named = (text: string) => text.replace(/^\s*\[[^\]]*\]\s*/, '').trim() || text;
function when(iso: string | undefined, now = new Date()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 864e5);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
const ASK_SHOWN = 8;

/**
 * The tray's body. `onOpenTask` opens a task on its brief, where its own strip and Done are. An item is answered
 * in place; the list is read again after every answer.
 */
export function OpenClawTray({ worker, onOpenTask }: { worker: WorkerOverviewState; onOpenTask: (taskId: string) => void }) {
  const { view, failed, load, setView } = worker;
  const root = React.useRef<HTMLDivElement>(null);
  const [said, setSaid] = React.useState<{ taskId: string; text: string } | null>(null);
  const [switching, setSwitching] = React.useState(false);
  const [sweepError, setSweepError] = React.useState<string | null>(null);
  const [allAsks, setAllAsks] = React.useState(false);
  React.useEffect(() => {
    if (!said) return;
    const timer = window.setTimeout(() => setSaid(null), 7000);
    return () => window.clearTimeout(timer);
  }, [said]);

  // A phone's sheet sits on the keyboard, not under it: the part of the window the keyboard leaves is followed
  // while the tray is open. (The engine keeps a phone's tray open when only the window's height changes.)
  React.useEffect(() => {
    const vv = window.visualViewport;
    const sheet = root.current?.parentElement;
    if (!vv || !sheet) return;
    const fit = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      sheet.style.setProperty('--kb', `${kb}px`);
      sheet.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      sheet.classList.toggle('kb', kb > 80);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
      sheet.style.removeProperty('--kb');
      sheet.style.removeProperty('--vvh');
      sheet.classList.remove('kb');
    };
  }, []);

  const send = (taskId: string): TaskWorkSend => async (item, answer, words) => {
    const json = await post('/api/tasks/work/answer', { taskId, itemId: item.id, ...answer }).catch(() => null);
    if (!json?.success) {
      void load();
      return json?.error || 'That did not save. Try again.';
    }
    // Answered: it leaves the list now, before the read comes back.
    setView((was) => was && {
      ...was,
      needsYou: was.needsYou.map((g) => (g.taskId === taskId ? { ...g, items: g.items.filter((i) => i.id !== item.id) } : g)).filter((g) => g.items.length > 0),
      counts: was.counts && { ...was.counts, pendingItems: Math.max(0, (was.counts.pendingItems ?? 1) - 1) },
    });
    setSaid({ taskId, text: words });
    await load();
    return null;
  };

  const flip = async (enabled: boolean) => {
    setSwitching(true);
    setSweepError(null);
    const json = await post('/api/tasks/work/sweep', { enabled }).catch(() => null);
    if (json?.success && json.data) setView((was) => was && { ...was, sweep: json.data as WorkerSweep });
    else setSweepError(json?.error || 'That did not save. Try again.');
    await load();
    setSwitching(false);
  };

  const head = (
    <div>
      <p className="sr-t">OpenClaw</p>
      <p className="sr-s">What it needs from you, and what it is doing on your tasks.</p>
    </div>
  );
  if (!view) {
    return (
      <div ref={root} className="sro">
        {head}
        <p className={failed ? 'sro-err' : 'sro-empty'} role={failed ? 'alert' : undefined}>{failed ? 'Could not read what OpenClaw is doing. It tries again in a moment.' : 'Reading…'}</p>
      </div>
    );
  }

  const needsYou = view.needsYou.filter((g) => g.items.length > 0);
  const waiting = view.waiting ?? [];
  const asks = view.couldAsk ?? [];
  const sweep = view.sweep;
  const nothing = needsYou.length === 0 && !view.working && waiting.length === 0 && asks.length === 0;
  const looked = sweep?.sort ? sweep.sort.sorted + sweep.sort.unsorted : 0;

  return (
    <div ref={root} className="sro">
      {head}
      {failed && <p className="sro-err" role="alert">Could not read the latest from OpenClaw. This is what it said last.</p>}
      {nothing && <p className="sro-empty">Nothing from OpenClaw needs you.</p>}

      {needsYou.length > 0 && (
        <section className="sro-sec" aria-label="Needs you">
          <h4>Needs you</h4>
          {needsYou.map((group) => (
            <div key={group.taskId} className="sro-task">
              <button type="button" className="sro-name" title={group.taskText} onClick={() => onOpenTask(group.taskId)}><span>{named(group.taskText)}</span></button>
              {said?.taskId === group.taskId && <p className="sro-said" role="status">{said.text}</p>}
              {group.items.map((item) => (
                <TaskWorkItem key={item.id} item={item} send={send(group.taskId)} openToMarkDone={() => onOpenTask(group.taskId)} />
              ))}
            </div>
          ))}
        </section>
      )}
      {said && !needsYou.some((g) => g.taskId === said.taskId) && <p className="sro-said" role="status">{said.text}</p>}

      {view.working && (
        <section className="sro-sec" aria-label="Working now">
          <h4>Working now</h4>
          <button type="button" className="sro-row" title={view.working.taskText} onClick={() => onOpenTask(view.working!.taskId)}>
            <b className="sro-now"><i aria-hidden="true" />OpenClaw is working on {named(view.working.taskText)}</b>
          </button>
        </section>
      )}

      {waiting.length > 0 && (
        <section className="sro-sec" aria-label="Waiting on others">
          <h4>Waiting on others</h4>
          <div className="sro-rows">
            {waiting.map((w) => (
              <button key={w.taskId} type="button" className="sro-row" title={w.taskText} onClick={() => onOpenTask(w.taskId)}>
                <b>{named(w.taskText)}</b>
                <span>Waiting on {w.on}{when(w.since) ? ` since ${when(w.since)}` : ''}{when(w.checkAfter) ? ` · looks again ${when(w.checkAfter)}` : ''}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {asks.length > 0 && (
        <details className="sro-sec sro-ask">
          <summary>Could use one answer <em>{asks.length} {asks.length === 1 ? 'task' : 'tasks'}</em></summary>
          <div className="sro-rows">
            {(allAsks ? asks : asks.slice(0, ASK_SHOWN)).map((a) => (
              <button key={a.taskId} type="button" className="sro-row" title={a.why || a.taskText} onClick={() => onOpenTask(a.taskId)}>
                <b>{named(a.taskText)}</b>
                <span>{a.q}</span>
              </button>
            ))}
          </div>
          {!allAsks && asks.length > ASK_SHOWN && <button type="button" className="sro-more" onClick={() => setAllAsks(true)}>Show all {asks.length}</button>}
        </details>
      )}

      {sweep && (
        <section className="sro-sweep" aria-label="Looking through your other tasks">
          <p>
            {sweep.enabled
              ? `OpenClaw is also looking through your other tasks: ${sweep.sort?.sorted ?? 0} of ${looked} looked at, ${sweep.sort?.prepare ?? 0} it can start on, up to ${sweep.cap} a day (${sweep.claimsToday} today).`
              : 'OpenClaw only works on tasks you hand it. Turn this on and it also looks through your other tasks for a first step it can prepare. It never sends anything without asking.'}
            {sweep.enabled && sweep.quietNow ? ' It rests from 11 pm to 8 am.' : ''}
          </p>
          <button type="button" role="switch" aria-checked={sweep.enabled} className={`srp-btn${sweep.enabled ? ' quiet' : ''}`} disabled={switching} onClick={() => void flip(!sweep.enabled)}>
            {switching ? 'Saving…' : sweep.enabled ? 'Turn off' : 'Turn on'}
          </button>
          {sweepError && <p className="sro-err" role="alert">{sweepError}</p>}
        </section>
      )}
    </div>
  );
}
