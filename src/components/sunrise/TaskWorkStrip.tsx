'use client';

// OpenClaw's task worker in a task's brief (docs/task-worker-design.md, "Where Adamya sees it"): one line on where
// the task stands with OpenClaw, the switch that hands it over or takes it back, and what OpenClaw waits on him for,
// oldest first: an email to approve (its exact recipient and words, which he can edit), a question, "Looks done",
// "Did this go out?". His yes to "Looks done" closes the task through the brief's own Done.
import React from 'react';
import type { NeedsYouDetail, NeedsYouItem, TaskWork, TaskWorkStatus } from '@/lib/task-work';

export const TASK_WORK_CSS = `
/* OpenClaw's own work on the task: a line under who speaks, the switch, and what waits on him. */
.srx{display:grid;gap:10px;margin:8px 0 14px;animation:srp-up .5s .08s both}
.srx-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px}
.srx-state{flex:1 1 180px;min-width:0;display:flex;align-items:baseline;gap:8px;font:500 13.5px/1.4 var(--sans);color:#3d2a1c}
.srx-state i{flex:none;width:8px;height:8px;border-radius:50%;background:rgba(60,30,10,.28);transform:translateY(-1px)}
.srx-state.working i{background:var(--a);animation:srp-pulse 1.1s ease-in-out infinite}
.srx-state.queued i{background:var(--a);opacity:.55}
.srx-state.needs-you i{background:var(--a);box-shadow:0 0 0 3px var(--a-soft)}
.srx-state.waiting i{background:#fff;border:1.5px solid var(--a);box-sizing:border-box}
.srx-state.off i{background:transparent;border:1.5px solid rgba(60,30,10,.35);box-sizing:border-box}
.srx-row .srp-chip{flex:none}
.srx-hint{flex:1 1 200px;margin:0;font:12.5px/1.4 var(--sans);color:#7a5a42}
.srx-said{margin:-4px 0 0;font:500 12.5px/1.4 var(--sans);color:#1f7a4a}
.srx-err{margin:0;color:#a3361a;font:12.5px/1.4 var(--sans)}
/* One open item: OpenClaw speaking in a bubble, as on the ground's done tray. */
.srx-item{display:grid;gap:8px;padding:11px 14px 12px;border-radius:4px 16px 16px 16px;background:linear-gradient(180deg,#fffdf9,#fbf5ec);border:1px solid rgba(60,30,10,.14);box-shadow:inset 0 1px 0 #fff,0 10px 24px -18px rgba(120,60,10,.55);color:#22130a}
.srx-who{display:flex;gap:8px;align-items:baseline;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srx-who em{font-style:normal;letter-spacing:.04em;color:#a08268}
.srx-text{margin:0;font:400 15px/1.45 var(--sans);color:#22130a;overflow-wrap:anywhere}
/* The exact email: who, about what, and the words as they will go. */
.srx-mail{border-radius:10px;overflow:hidden;background:#fff;border:1px solid rgba(40,22,10,.16);box-shadow:inset 0 1px 2px rgba(40,22,10,.06)}
.srx-mail .f{display:grid;grid-template-columns:62px minmax(0,1fr);align-items:baseline;gap:8px;padding:6px 12px;border-bottom:1px solid rgba(40,22,10,.08);font:12px var(--sans);color:#8a6a52}
.srx-mail .f b{font:500 14px var(--sans);color:#22130a;overflow-wrap:anywhere}
.srx-mail .f input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#22130a;font:14px var(--sans);padding:2px 0}
.srx-mail .body{max-height:40vh;overflow:auto;overscroll-behavior:contain;padding:10px 12px 12px;white-space:pre-wrap;overflow-wrap:anywhere;font:400 14.5px/1.55 var(--sans);color:#22130a}
.srx-mail textarea.body{display:block;width:100%;box-sizing:border-box;resize:none;border:0;outline:0;background:transparent;max-height:none;overflow:hidden}
.srx-mail:focus-within{border-color:var(--a);box-shadow:0 0 0 3px color-mix(in srgb,var(--a) 22%,transparent)}
.srx-item textarea.ans,.srx-item input.why{width:100%;box-sizing:border-box;border:1px solid rgba(40,22,10,.22);border-radius:10px;outline:0;padding:8px 11px;background:#fff;color:#22130a;font:14.5px/1.45 var(--sans);box-shadow:inset 0 1px 2px rgba(40,22,10,.12)}
.srx-item textarea.ans{resize:none;overflow:hidden;min-height:44px}
.srx-item textarea.ans:focus,.srx-item input.why:focus{border-color:var(--a);box-shadow:inset 0 1px 2px rgba(40,22,10,.12),0 0 0 3px color-mix(in srgb,var(--a) 22%,transparent)}
.srx-acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.srx-acts .srp-btn{padding:7px 15px}
.srx-acts .srp-btn:disabled{opacity:.55;cursor:default}
.srx-acts span{font:12.5px var(--sans);color:#7a5a42}
/* What was settled before, folded. */
.srx-earlier>summary{cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:6px;font:500 12.5px var(--sans);color:#7a5a42}
.srx-earlier>summary::-webkit-details-marker{display:none}
.srx-earlier>summary::before{content:"›";font-size:15px;color:var(--a);transition:transform .2s ease}
.srx-earlier[open]>summary::before{transform:rotate(90deg)}
.srx-earlier ul{margin:6px 0 0;padding:0;list-style:none;display:grid;gap:4px;font:12.5px/1.4 var(--sans);color:#5b4230}
.srx-earlier li span{font:11px var(--mono);color:#8a6a52;margin-right:8px}
.srx-earlier li b{font-weight:600;color:#3d2a1c}
/* A phone: what is pressed is a finger wide, and what is typed in is 16px. */
.srp.cols-1 .srx-row .srp-chip{min-height:44px;padding:8px 16px}
.srp.cols-1 .srx-acts .srp-btn{min-height:44px;padding:0 16px;font-size:15px}
.cols-1 .srx-mail .f input,.cols-1 .srx-mail .body,.cols-1 .srx-item textarea.ans,.cols-1 .srx-item input.why{font-size:16px}
.cols-1 .srx-item input.why{min-height:44px}
.cols-1 .srx-earlier>summary{min-height:44px}
.cols-1 .srx-state{font-size:14.5px}
.cols-1 .srx-hint{font-size:13.5px}
`;

export interface TaskWorkView { taskId: string; record: TaskWork | null; summary: string }
export interface TaskWorkState {
  /** undefined while the first read is out; null when it failed. */
  view: TaskWorkView | null | undefined;
  /** Open items, oldest first. */
  pending: NeedsYouItem[];
  load: () => Promise<void>;
}

const POLL_WORKING_MS = 5_000;
const POLL_ACTIVE_MS = 30_000;
const ACTIVE: readonly TaskWorkStatus[] = ['queued', 'working', 'waiting', 'needs-you'];

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const day = (iso: string | undefined) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

/**
 * The task's record with OpenClaw's worker, read when the task opens and again when the window comes back: every
 * 5 s while a run is on it, every 30 s while it is handed over, waiting or waiting on him, and not at all otherwise.
 */
export function useTaskWork(taskId: string, enabled = true): TaskWorkState {
  const [view, setView] = React.useState<TaskWorkView | null | undefined>(undefined);
  // Only the newest read is shown: one that set off before an answer can come back after it.
  const reads = React.useRef(0);
  const load = React.useCallback(async () => {
    if (!enabled) return;
    const mine = ++reads.current;
    try {
      const json = await fetch(`/api/tasks/work?taskId=${encodeURIComponent(taskId)}`, { cache: 'no-store' }).then((r) => r.json());
      if (mine !== reads.current) return;
      if (json?.success) setView(json.data as TaskWorkView);
      else setView((was) => was ?? null);
    } catch {
      if (mine === reads.current) setView((was) => was ?? null);
    }
  }, [taskId, enabled]);
  React.useEffect(() => { void load(); }, [load]);

  const status = view?.record?.status;
  React.useEffect(() => {
    const every = status === 'working' ? POLL_WORKING_MS : status && ACTIVE.includes(status) ? POLL_ACTIVE_MS : 0;
    if (!every) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, every);
    return () => window.clearInterval(timer);
  }, [status, load]);
  React.useEffect(() => {
    const back = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', back);
    document.addEventListener('visibilitychange', back);
    return () => {
      window.removeEventListener('focus', back);
      document.removeEventListener('visibilitychange', back);
    };
  }, [load]);

  const items = view?.record?.items;
  const pending = React.useMemo(
    () => (items ?? []).filter((i) => i.status === 'pending').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [items],
  );
  return { view, pending, load };
}

/** A field as tall as its words. */
function useFit(value: string) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return ref;
}

type Answer = { decision: 'approve' | 'decline' | 'answer'; answer?: string; editedDetail?: NeedsYouDetail };
type Send = (item: NeedsYouItem, answer: Answer, said: string) => Promise<string | null>;

const WHO: Record<NeedsYouItem['kind'], string> = { approval: 'To approve', question: 'A question', done: 'Looks done', 'sent-check': 'Did it go out?' };
/** The item's words without the lead-in its label already says ("Looks done:", "Did this go out?"). */
function said(item: NeedsYouItem): string {
  const lead = item.kind === 'done' ? /^looks done:?\s*/i : item.kind === 'sent-check' ? /^did this go out\?\s*/i : null;
  const rest = lead ? item.text.replace(lead, '') : item.text;
  return rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : item.text;
}

/** The exact email (or message) OpenClaw wants to send, as it would go. */
function Mail({ detail }: { detail: NeedsYouDetail }) {
  return (
    <div className="srx-mail">
      {detail.channel && <div className="f">By<b>{detail.channel}</b></div>}
      {detail.to && <div className="f">To<b>{detail.to}</b></div>}
      {detail.subject && <div className="f">Subject<b>{detail.subject}</b></div>}
      {detail.body && <div className="body" tabIndex={0} aria-label="The words it would send">{detail.body}</div>}
    </div>
  );
}

function MailEdit({ value, onChange }: { value: NeedsYouDetail; onChange: (next: NeedsYouDetail) => void }) {
  const body = useFit(value.body ?? '');
  return (
    <div className="srx-mail">
      <label className="f">To<input value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} autoComplete="off" /></label>
      <label className="f">Subject<input value={value.subject ?? ''} onChange={(e) => onChange({ ...value, subject: e.target.value })} autoComplete="off" /></label>
      <textarea ref={body} className="body" aria-label="The words to send" value={value.body ?? ''} rows={4} onChange={(e) => onChange({ ...value, body: e.target.value })} />
    </div>
  );
}

/** One thing OpenClaw waits on him for, and the ways to answer it. */
function Item({ item, send }: { item: NeedsYouItem; send: Send }) {
  const [phase, setPhase] = React.useState<'idle' | 'edit' | 'no'>('idle');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [text, setText] = React.useState('');
  const [why, setWhy] = React.useState('');
  const [edited, setEdited] = React.useState<NeedsYouDetail>(() => ({ ...item.detail }));
  const answerBox = useFit(text);

  const go = async (answer: Answer, said: string) => {
    setSending(true);
    setError(null);
    const failed = await send(item, answer, said);
    // On success the item leaves the list; only a refusal comes back here.
    if (failed) { setError(failed); setSending(false); }
  };
  const approveEdited = () => {
    const was = item.detail ?? {};
    const pick = (k: 'to' | 'subject' | 'body') => (edited[k]?.trim() ? { [k]: k === 'body' ? edited[k] : edited[k]!.trim() } : {});
    const detail: NeedsYouDetail = { ...(was.channel ? { channel: was.channel } : {}), ...pick('to'), ...pick('subject'), ...pick('body') };
    const same = (['to', 'subject', 'body'] as const).every((k) => (detail[k] ?? '') === (was[k] ?? ''));
    void go(same ? { decision: 'approve' } : { decision: 'approve', editedDetail: detail },
      same ? 'Approved · OpenClaw sends it on its next run' : 'Approved with your edits · OpenClaw sends your version on its next run');
  };

  const mail = item.detail && (item.detail.to || item.detail.subject || item.detail.body) ? item.detail : null;
  return (
    <div className="srx-item" role="group" aria-label={WHO[item.kind]}>
      <div className="srx-who">{WHO[item.kind]}<em>{day(item.createdAt)}</em></div>
      <p className="srx-text">{said(item)}</p>

      {item.kind === 'approval' && (
        <>
          {phase === 'edit' ? <MailEdit value={edited} onChange={setEdited} /> : mail && <Mail detail={mail} />}
          {phase === 'no' && (
            <input className="why" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why not? (optional, OpenClaw reads it)" aria-label="Why not, in a line (optional)"
              maxLength={400} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void go({ decision: 'decline', ...(why.trim() ? { answer: why.trim() } : {}) }, 'Not sent · OpenClaw will not send it'); }} />
          )}
          <div className="srx-acts">
            {phase === 'idle' && (
              <>
                <button type="button" className="srp-btn" disabled={sending} onClick={() => void go({ decision: 'approve' }, 'Approved · OpenClaw sends it on its next run')}>{sending ? 'Saving…' : 'Approve'}</button>
                <button type="button" className="srp-btn quiet" disabled={sending} onClick={() => { setEdited({ ...item.detail }); setPhase('edit'); setError(null); }}>Edit</button>
                <button type="button" className="srp-btn quiet" disabled={sending} onClick={() => { setPhase('no'); setError(null); }}>No</button>
              </>
            )}
            {phase === 'edit' && (
              <>
                <button type="button" className="srp-btn" disabled={sending} onClick={approveEdited}>{sending ? 'Saving…' : 'Approve edited'}</button>
                <button type="button" className="srp-btn quiet" disabled={sending} onClick={() => { setPhase('idle'); setError(null); }}>Cancel</button>
              </>
            )}
            {phase === 'no' && (
              <>
                <button type="button" className="srp-btn" disabled={sending} onClick={() => void go({ decision: 'decline', ...(why.trim() ? { answer: why.trim() } : {}) }, 'Not sent · OpenClaw will not send it')}>{sending ? 'Saving…' : 'Don’t send it'}</button>
                <button type="button" className="srp-btn quiet" disabled={sending} onClick={() => { setPhase('idle'); setWhy(''); setError(null); }}>Cancel</button>
              </>
            )}
          </div>
        </>
      )}

      {item.kind === 'question' && (
        <>
          <textarea ref={answerBox} className="ans" rows={1} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer" aria-label="Your answer" maxLength={4000} />
          <div className="srx-acts">
            <button type="button" className="srp-btn" disabled={sending || !text.trim()} onClick={() => void go({ decision: 'answer', answer: text.trim() }, 'Answered · OpenClaw picks it up on its next run')}>{sending ? 'Saving…' : 'Answer'}</button>
            <button type="button" className="srp-btn quiet" disabled={sending} onClick={() => void go({ decision: 'decline' }, 'Skipped')}>Skip</button>
          </div>
        </>
      )}

      {item.kind === 'done' && (
        <div className="srx-acts">
          <button type="button" className="srp-btn" disabled={sending} onClick={() => void go({ decision: 'approve' }, 'Marking it done…')}>{sending ? 'Marking it done…' : 'Yes, mark done'}</button>
          <button type="button" className="srp-btn quiet" disabled={sending} onClick={() => void go({ decision: 'decline' }, 'Noted · it stays open')}>Not yet</button>
        </div>
      )}

      {item.kind === 'sent-check' && (
        <>
          {mail && <Mail detail={mail} />}
          <div className="srx-acts">
            <button type="button" className="srp-btn" disabled={sending} onClick={() => void go({ decision: 'answer', answer: 'sent' }, 'Noted: it went out')}>{sending ? 'Saving…' : 'Yes, it was sent'}</button>
            <button type="button" className="srp-btn quiet" disabled={sending} onClick={() => void go({ decision: 'answer', answer: 'not sent' }, 'Noted: it did not go out')}>No, it wasn’t</button>
          </div>
        </>
      )}
      {error && <p className="srx-err" role="alert">{error}</p>}
    </div>
  );
}

const SETTLED: Record<NeedsYouItem['status'], string> = { approved: 'Approved', declined: 'Declined', answered: 'Answered', pending: '' };

/** What was settled lately, folded: what he approved or turned down, and when. */
function Earlier({ items }: { items: NeedsYouItem[] }) {
  const settled = items.filter((i) => i.status !== 'pending')
    .sort((a, b) => (b.answeredAt ?? b.createdAt).localeCompare(a.answeredAt ?? a.createdAt))
    .slice(0, 4);
  if (settled.length === 0) return null;
  const word = (i: NeedsYouItem) => (i.kind === 'done' ? (i.status === 'approved' ? 'Done' : 'Not yet')
    : i.kind === 'question' && i.status === 'declined' ? 'Skipped'
      : i.kind === 'approval' && i.status === 'approved' && i.editedDetail ? 'Approved, edited' : SETTLED[i.status]);
  return (
    <details className="srx-earlier">
      <summary>Earlier</summary>
      <ul>
        {settled.map((i) => (
          <li key={i.id}>
            <span>{day(i.answeredAt ?? i.createdAt)}</span><b>{word(i)}</b>: {i.text}{i.answer && i.kind !== 'done' ? ` (“${i.answer}”)` : ''}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The strip at the top of the brief. With no record it is only the switch and a line on what handing over means.
 * `onMarkDone` is the brief's own Done (it journals, closes the pane and offers the undo); true when it saved.
 */
export function TaskWorkStrip({ taskId, work, onMarkDone }: { taskId: string; work: TaskWorkState; onMarkDone: () => Promise<boolean> }) {
  const { view, pending, load } = work;
  const [switching, setSwitching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [said, setSaid] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!said) return;
    const timer = window.setTimeout(() => setSaid(null), 7000);
    return () => window.clearTimeout(timer);
  }, [said]);

  if (view === undefined) return null;
  if (view === null) return <p className="srx-err">Could not read what OpenClaw is doing on this task.</p>;
  const record = view.record;
  const status = record?.status;
  const active = !!status && ACTIVE.includes(status);

  const hand = async (on: boolean) => {
    setSwitching(true);
    setError(null);
    setSaid(null);
    const json = await post('/api/tasks/work/hand', { taskId, on }).catch(() => null);
    if (!json?.success) setError(json?.error || 'That did not save. Try again.');
    await load();
    setSwitching(false);
  };
  const send: Send = async (item, answer, words) => {
    const json = await post('/api/tasks/work/answer', { taskId, itemId: item.id, ...answer }).catch(() => null);
    if (!json?.success) {
      await load();
      return json?.error || 'That did not save. Try again.';
    }
    setSaid(words);
    if (json.data?.completeRequested) {
      // The same Done as the brief's foot: the pane closes when it saves.
      const ok = await onMarkDone();
      if (!ok) setSaid('Recorded, but the task did not close. Press Done below.');
    }
    await load();
    return null;
  };

  return (
    <div className="srx" aria-label="OpenClaw’s work on this task">
      <div className="srx-row">
        {record && <span className={`srx-state ${status}`} role="status"><i aria-hidden="true" />{view.summary}</span>}
        <button type="button" className="srp-chip" disabled={switching} onClick={() => void hand(!active)}
          title={active ? 'OpenClaw stops working on this task until you hand it back' : 'OpenClaw takes the next step it can, and asks before it sends anything'}>
          {switching ? 'Saving…' : active ? 'Hands off' : 'Hand to OpenClaw'}
        </button>
        {!record && <span className="srx-hint">OpenClaw takes the next step it can and asks before it sends anything.</span>}
      </div>
      {said && <p className="srx-said" role="status">{said}</p>}
      {error && <p className="srx-err" role="alert">{error}</p>}
      {pending.map((item) => <Item key={item.id} item={item} send={send} />)}
      {record && <Earlier items={record.items} />}
    </div>
  );
}
