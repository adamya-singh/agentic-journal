'use client';

import React from 'react';
import { describeDone, formatWhen } from '@/lib/done-at';
import type { DoneProposalRecord } from '@/app/api/tasks/done-proposals/store';
import type { DoneReceipt } from '@/app/api/tasks/done-at/apply';

// "Done, but when?" on a pad HOLD: Done opens a tray (now / on time / other time). Other time asks
// OpenClaw, whose proposal comes back as a bubble to accept, decline or reply to. The conversation
// lives on the server (done-proposals), so the bubble survives a reload.

export const DONE_CSS = `
.hz-dw{display:inline-flex;flex-direction:column;gap:7px;align-items:flex-start;max-width:100%}
.hz-hold button.hz-on{border-color:#ffd2a8;color:#ffd2a8}
.hz-wait{display:inline-flex;align-items:center;gap:10px;border:1px dashed rgba(255,210,168,.6);color:#ffd2a8;border-radius:999px;padding:4px 13px;font:600 12.5px var(--hz-sans)}
.hz-tray{display:flex;gap:6px;flex-wrap:wrap;align-items:center;padding:6px 8px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,24,.55);border-radius:12px;font:12px var(--hz-sans);color:var(--hz-dim)}
.hz-pb{font:500 11px var(--hz-mono);color:#f3e3cf;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:3px 10px;cursor:pointer}
.hz-pb:hover,.hz-pb:focus-visible{border-color:#ffd2a8;outline:none}
.hz-pb:disabled{opacity:.5;cursor:default}
.hz-pb.hz-on{border-color:#ffd2a8;color:#ffd2a8}
.hz-pb.hz-acc{background:#ffd2a8;color:#1b0d05;border-color:#ffd2a8}
.hz-ask{display:flex;gap:6px;align-items:center;flex-wrap:wrap;width:100%}
.hz-ask input{flex:1;min-width:220px;height:28px;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);border-radius:999px;color:#f3efe7;font:12.5px var(--hz-sans);padding:0 12px}
.hz-ask input:focus{outline:none;border-color:#ffd2a8}
.hz-err{width:100%;font:12px var(--hz-sans);color:#ff8a5c}
.hz-you{font:12.5px var(--hz-sans);color:#f3e3cf;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:14px 14px 14px 4px;padding:5px 11px;max-width:min(430px,100%)}
.hz-said{font:12.5px var(--hz-sans);color:#d6c4ae;max-width:min(430px,100%)}
.hz-think{font:12px var(--hz-mono);color:var(--hz-dim)}
.hz-bub{max-width:min(440px,100%);background:#f3efe7;color:#2a1d14;border-radius:4px 14px 14px 14px;padding:10px 13px;font:13px/1.5 var(--hz-sans);box-sizing:border-box}
.hz-bub .who{font:500 10.5px var(--hz-mono);letter-spacing:.1em;color:#8a5a33;margin-bottom:3px}
.hz-bub .say{font:italic 400 17px/1.3 var(--hz-serif);margin-bottom:6px}
.hz-bub ul{margin:0 0 8px;padding-left:16px}
.hz-bub li{margin:2px 0}
.hz-acts{display:flex;gap:6px;flex-wrap:wrap}
.hz-bb{font:500 11.5px var(--hz-sans);border-radius:999px;padding:3px 11px;cursor:pointer;border:1px solid #c9a98a;background:transparent;color:#5a2a08}
.hz-bb:disabled{opacity:.55;cursor:default}
.hz-bb.y{background:#2a1d14;color:#f3efe7;border-color:#2a1d14}
.hz-bub .hz-ask{margin-top:8px}
.hz-bub .hz-ask input{background:#fff;color:#2a1d14;border-color:#c9a98a}
.hz-bub .hz-err{color:#a3361a}
`;

export interface DoneTarget {
  id: string;
  listType: 'have-to-do' | 'want-to-do';
  short: string;
  title: string;
  due: string | null;
  implied: boolean;
  left?: string;
}

async function post(url: string, body: unknown): Promise<{ success: boolean; error?: string; receipt?: DoneReceipt }> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return await res.json();
  } catch {
    return { success: false, error: 'Couldn’t reach the server. Try again.' };
  }
}

function AskBox(props: {
  placeholder: string;
  label: string;
  inBubble?: boolean;
  autoFocus?: boolean;
  onSend: (text: string) => Promise<string | null>;
}) {
  const [value, setValue] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [sending, setSending] = React.useState(false);
  const send = async () => {
    const text = value.trim();
    if (!text) { setError('Describe when you finished it first.'); return; }
    setSending(true);
    const err = await props.onSend(text);
    setSending(false);
    if (err) setError(err); else setValue('');
  };
  return (
    <div className="hz-ask">
      <input
        value={value}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        aria-label="When did you finish it?"
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') void send(); }}
      />
      <button type="button" className={props.inBubble ? 'hz-bb y' : 'hz-pb hz-acc'} disabled={sending} onClick={() => void send()}>
        {sending ? 'Sending…' : props.label}
      </button>
      {error && <div className="hz-err" role="alert">{error}</div>}
    </div>
  );
}

function Conversation({ record, onChanged, onDone }: {
  record: DoneProposalRecord;
  onChanged: () => void;
  onDone: (receipt: DoneReceipt, label: string) => void;
}) {
  const [replying, setReplying] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const act = async (action: 'accept' | 'decline' | 'retry') => {
    setBusy(true);
    setError(null);
    const res = await post('/api/tasks/done-proposals', { action, id: record.id });
    setBusy(false);
    if (!res.success) { setError(res.error || 'That didn’t work. Try again.'); return; }
    if (action === 'accept' && res.receipt) onDone(res.receipt, formatWhen(new Date(res.receipt.completedAt)));
    onChanged();
  };
  const reply = async (text: string) => {
    const res = await post('/api/tasks/done-proposals', { action: 'reply', id: record.id, text });
    if (!res.success) return res.error || 'That didn’t send. Try again.';
    setReplying(false);
    onChanged();
    return null;
  };

  // Earlier turns stay visible above the live bubble: what you said, and what OpenClaw said back.
  const lastOpenClaw = record.messages.map((m) => m.role).lastIndexOf('openclaw');
  const history = record.messages.filter((m, i) => m.role === 'you' || i !== lastOpenClaw);

  const p = record.proposal;
  const lines = p && record.status === 'proposed'
    ? describeDone(new Date(p.completedAt), p.rangeStart ? new Date(p.rangeStart) : null, record.due ? new Date(record.due) : null, p.timeIsGuess)
    : [];

  return (
    <>
      {history.map((m, i) => (
        <div key={i} className={m.role === 'you' ? 'hz-you' : 'hz-said'}>{m.role === 'openclaw' ? `OpenClaw: ${m.text}` : m.text}</div>
      ))}
      {record.status === 'thinking' && <div className="hz-think" role="status">OpenClaw is reading that…</div>}
      {record.status !== 'thinking' && (
        <div className="hz-bub" role="group" aria-label={`OpenClaw on ${record.short}`}>
          {record.status === 'proposed' && (
            <>
              <div className="who">OPENCLAW · PROPOSED</div>
              <div className="say">{p?.note || 'Here’s what I’d record.'}</div>
              <ul>{lines.map((l) => <li key={l}>{l}</li>)}</ul>
            </>
          )}
          {record.status === 'needs-more' && (
            <>
              <div className="who">OPENCLAW · NEEDS MORE</div>
              <div className="say">{record.question}</div>
            </>
          )}
          {record.status === 'failed' && (
            <>
              <div className="who">OPENCLAW · DIDN’T WORK</div>
              <div className="say">{record.error || 'OpenClaw couldn’t read that.'}</div>
            </>
          )}
          <div className="hz-acts">
            {record.status === 'proposed' && <button type="button" className="hz-bb y" disabled={busy} onClick={() => void act('accept')}>Accept</button>}
            {record.status === 'failed' && <button type="button" className="hz-bb y" disabled={busy} onClick={() => void act('retry')}>Retry</button>}
            <button type="button" className="hz-bb" disabled={busy} onClick={() => void act('decline')}>Decline</button>
            {record.status !== 'needs-more' && !replying && (
              <button type="button" className="hz-bb" disabled={busy} onClick={() => setReplying(true)}>Reply</button>
            )}
          </div>
          {error && <div className="hz-err" role="alert">{error}</div>}
          {(replying || record.status === 'needs-more') && (
            <AskBox inBubble autoFocus placeholder={record.status === 'needs-more' ? 'Monday afternoon' : 'Actually it was closer to 11:30'} label="Send" onSend={reply} />
          )}
        </div>
      )}
    </>
  );
}

export function DoneTray({ target, record, onLetGo, letGoBusy, onDone, onChanged }: {
  target: DoneTarget;
  record: DoneProposalRecord | null;
  /** Present for pad holds; a proposal whose task left the pad shows without Let go. */
  onLetGo?: () => void;
  letGoBusy?: boolean;
  onDone: (receipt: DoneReceipt, label: string) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [other, setOther] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const close = () => { setOpen(false); setOther(false); setError(null); };
  const doneAt = async (completedAt: string | undefined, label: string) => {
    setBusy(true);
    setError(null);
    const res = await post('/api/tasks/done-at', { taskId: target.id, listType: target.listType, completedAt });
    setBusy(false);
    if (!res.success || !res.receipt) { setError(res.error || 'That didn’t save. Try again.'); return; }
    close();
    onDone(res.receipt, label);
  };
  const ask = async (text: string) => {
    const res = await post('/api/tasks/done-proposals', {
      action: 'create', taskId: target.id, listType: target.listType, short: target.short, title: target.title,
      due: target.due, dueIsImplied: target.implied, text,
    });
    if (!res.success) return res.error || 'That didn’t send. Try again.';
    close();
    onChanged();
    return null;
  };

  return (
    <div className="hz-dw">
      {onLetGo ? (
        <span className="hz-hold" title={target.title}>
          HOLD · {target.short}{target.left ? ` · ${target.left}` : ''}
          <button type="button" className={open || record ? 'hz-on' : undefined} aria-expanded={open}
            disabled={busy || letGoBusy || !!record} onClick={() => (open ? close() : setOpen(true))}>
            {busy ? 'Saving…' : open ? 'Done ▾' : 'Done'}
          </button>
          <button type="button" className="hz-letgo" disabled={busy || letGoBusy} onClick={onLetGo}
            title="No longer worth doing. Takes it off your lists without counting it as done.">
            Let go
          </button>
        </span>
      ) : (
        <span className="hz-wait" title={target.title}>DONE? · {target.short}</span>
      )}
      {open && !record && (
        <div className="hz-tray">
          Finished when?
          <button type="button" className="hz-pb" disabled={busy} onClick={() => void doneAt(undefined, 'now')}>Done now</button>
          {target.due && !target.implied && (
            <button type="button" className="hz-pb" disabled={busy} onClick={() => void doneAt(target.due!, 'on time')}>
              On time · {formatWhen(new Date(target.due))}
            </button>
          )}
          <button type="button" className={`hz-pb${other ? ' hz-on' : ''}`} disabled={busy} onClick={() => setOther(true)}>Other time…</button>
          {other && <AskBox autoFocus placeholder="Tuesday night around 10, right after lab" label="Ask OpenClaw" onSend={ask} />}
          {error && <div className="hz-err" role="alert">{error}</div>}
        </div>
      )}
      {record && <Conversation record={record} onChanged={onChanged} onDone={onDone} />}
    </div>
  );
}
