'use client';

// "Ask OpenClaw", the second way to find a session in a task's "+ Link a session" panel: he says what he remembers,
// OpenClaw searches the session index (read-only) and answers here with the sessions it thinks match, each an
// ordinary session row with a Link button that links it exactly as the manual search does. He can keep talking to
// narrow it. One chat per task (POST/GET /api/session-index/finder); it is not one of the task's chats.
import React from 'react';
import { SESSION_APP, sessionDates } from '@/components/horizon/CardSessions';
import type { FinderView } from '@/lib/session-finder';
import type { SessionRow, SessionsView } from '@/lib/session-index/types';

export const FINDER_CSS = `
.srs-tabs{display:flex;gap:2px;padding:2px;border-radius:999px;background:rgba(34,19,10,.06);justify-self:start}
.srp .srs-tabs button{border:0;background:transparent;border-radius:999px;padding:4px 12px;font:500 12px var(--sans);color:#6a4a32;cursor:pointer}
.srp .srs-tabs button[aria-selected=true]{background:#fff;color:#22130a;box-shadow:0 1px 2px rgba(120,60,10,.12)}
.srs-tabs button:focus-visible{outline:2px solid var(--a);outline-offset:1px}
.srs-ask{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.srs-ask[hidden]{display:none}
.srs-ask .lead{margin:0;font-size:12.5px;line-height:1.45;color:#6a4a32}
.srs-log{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;max-height:min(420px,55vh);overflow-y:auto;overscroll-behavior:contain;padding-right:2px}
.srs-you{justify-self:end;max-width:85%;padding:6px 11px;border-radius:14px 14px 4px 14px;background:#22130a;color:#fff6ec;font-size:12.5px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere}
.srs-oc{display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.srs-oc .said{margin:0;display:flex;gap:7px;align-items:baseline;font-size:12.5px;line-height:1.45;color:#22130a;overflow-wrap:anywhere}
.srs-oc .said b{flex:none;font:600 9px var(--mono);letter-spacing:.06em;color:#fff6ec;background:#1f6d63;border-radius:5px;padding:1px 5px}
.srs-oc .aside{margin:0;font-size:11.5px;color:#8a6a52}
.srs-oc ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.srs-frow{display:grid;grid-template-columns:24px minmax(0,1fr) auto;gap:1px 9px;align-items:start;padding:8px 10px;border-radius:12px;border:1px solid rgba(60,30,10,.12);background:#fff}
.srs-frow .srs-app{grid-row:1/4;width:24px;height:24px;border-radius:7px;font-size:8.5px;margin-top:1px}
.srs-frow .srs-t{font-size:13px;-webkit-line-clamp:2}
.srs-frow .srs-meta{grid-column:2}
.srs-frow .srs-why{grid-column:2;font-size:12px;line-height:1.4}
.srs-frow .act{grid-column:3;grid-row:1/4;align-self:center}
.srp .srs-frow .srs-go{padding:4px 12px}
.srs-frow .done{font:500 11.5px var(--mono);color:#1f7a4a;white-space:nowrap}
.srs-think{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#6a4a32}
.srs-think i{width:7px;height:7px;border-radius:50%;background:var(--a);animation:srs-pulse 1.1s ease-in-out infinite}
@keyframes srs-pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1)}}
@media (prefers-reduced-motion:reduce){.srs-think i{animation:none}}
.srs-compose{display:flex;gap:6px}
.srs-compose input{flex:1;min-width:0}
.srp .srs-send{flex:none;height:34px;padding:0 14px;border-radius:999px;border:0;background:#22130a;color:#fff6ec;font:500 12.5px var(--sans);cursor:pointer}
.srp .srs-send:disabled{opacity:.45;cursor:default}
.srs-ask .row2{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;font-size:11.5px;color:#8a6a52}
.cols-1 .srs-log{max-height:none;overflow:visible}
.cols-1 .srs-frow{grid-template-columns:24px minmax(0,1fr)}
.cols-1 .srs-frow .act{grid-column:2;grid-row:auto;align-self:start;margin-top:5px}
.srp.cols-1 .srs-frow .srs-go{min-height:44px;padding:8px 16px;font-size:13.5px}
.srp.cols-1 .srs-send{height:44px;padding:0 16px;font-size:14px}
.srp.cols-1 .srs-tabs button{min-height:40px;padding:6px 16px;font-size:13px}
`;

const POLL_MS = 2500;

async function call(url: string, init?: RequestInit): Promise<{ data: FinderView | null; error: string | null }> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({})) as { success?: boolean; data?: FinderView; error?: string };
  if (res.ok && json.success) return { data: json.data ?? null, error: null };
  return { data: json.data ?? null, error: json.error || 'OpenClaw could not be asked just now.' };
}

const post = (body: Record<string, unknown>) => call('/api/session-index/finder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function Found({ row, linked, onLink }: { row: SessionRow; linked: boolean; onLink: (row: SessionRow) => Promise<void> }) {
  const [busy, setBusy] = React.useState(false);
  const app = SESSION_APP[row.app];
  const meta = [app.name, row.machine, row.project, sessionDates(row)].filter(Boolean);
  return (
    <li className="srs-frow">
      <span className={`srs-app ${app.cls}`} title={app.name} aria-hidden="true">{app.tile}</span>
      <span className="srs-t" title={row.title}>{row.title}</span>
      <span className="srs-meta">{meta.map((m, i) => <span key={i}>{i > 0 ? '· ' : ''}{m}</span>)}</span>
      {row.why && <span className="srs-why">{row.why}</span>}
      <span className="act">
        {linked ? <span className="done">Linked ✓</span> : (
          <button type="button" className="srs-go" disabled={busy} aria-label={`Link “${row.title}” to this task`}
            onClick={() => { setBusy(true); void onLink(row).finally(() => setBusy(false)); }}>
            {busy ? 'Linking…' : 'Link'}
          </button>
        )}
      </span>
    </li>
  );
}

function elapsed(since: string | null, now: number): string {
  if (!since) return '';
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/**
 * The chat. `isLinked` says whether a session is already on the task (its row then reads "Linked"); `onLink` links
 * one by hand, as the manual search does, and keeps the panel open.
 */
export function SessionFinder({ taskId, hidden, isLinked, onLink, onClose }: {
  taskId: string;
  hidden: boolean;
  isLinked: (uid: string) => boolean;
  onLink: (row: SessionRow) => Promise<void>;
  onClose: () => void;
}) {
  const [view, setView] = React.useState<FinderView | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  const log = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);

  const load = React.useCallback(() => {
    void call(`/api/session-index/finder?taskId=${encodeURIComponent(taskId)}`).then(({ data, error: e }) => {
      if (data) setView(data);
      setError(e);
    }, () => setError('The chat could not be read just now.'));
  }, [taskId]);
  React.useEffect(() => { load(); }, [load]);
  const pending = !!view?.pending;
  // While OpenClaw looks: its answer is polled for, and the time it has taken ticks.
  React.useEffect(() => {
    if (!pending) return;
    const poll = window.setInterval(load, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { window.clearInterval(poll); window.clearInterval(tick); };
  }, [pending, load]);
  const count = view?.messages.length ?? 0;
  React.useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, pending]);
  React.useEffect(() => { if (!hidden) input.current?.focus(); }, [hidden]);

  const act = async (body: Record<string, unknown>) => {
    setSending(true);
    try {
      const { data, error: e } = await post({ taskId, ...body });
      if (data) setView(data);
      setError(e);
      return !e;
    } catch {
      setError('OpenClaw could not be asked just now.');
      return false;
    } finally {
      setSending(false);
      setNow(Date.now());
    }
  };
  const send = async () => {
    const text = draft.trim();
    if (!text || pending || sending) return;
    if (await act({ action: 'send', text })) setDraft('');
  };

  const link = (row: SessionRow) => onLink(row).then(() => setError(null), (e: Error) => setError(e.message || 'That did not save.'));
  const unavailable = view !== null && !view.openclaw;
  const empty = view !== null && view.indexed === 0;
  const messages = view?.messages ?? [];
  return (
    <div className="srs-ask" hidden={hidden} role="tabpanel" aria-label="Ask OpenClaw to find a session">
      {messages.length === 0 && !pending && (
        <p className="lead">Tell OpenClaw what you remember: the agent, the device, roughly when, what was done. It searches the session index and lists what fits; you link the one you want.</p>
      )}
      {(messages.length > 0 || pending) && (
        <div className="srs-log" ref={log} aria-live="polite">
          {messages.map((m, i) => m.role === 'you' ? <div key={i} className="srs-you">{m.text}</div> : (
            <div key={i} className="srs-oc">
              <p className="said"><b>OC</b><span>{m.text}</span></p>
              {m.sessions && m.sessions.length > 0 && (
                <ul>{m.sessions.map((row) => <Found key={row.uid} row={row} linked={isLinked(row.uid)} onLink={link} />)}</ul>
              )}
              {m.sessions && m.sessions.length === 0 && <p className="aside">The sessions it named have left the index since.</p>}
              {!!m.invented && <p className="aside">{m.invented === 1 ? 'One session it named is' : `${m.invented} sessions it named are`} not in the index, so {m.invented === 1 ? 'it is' : 'they are'} left out.</p>}
              {m.loose && <p className="aside">It did not answer in the form asked for, so nothing here can be linked. Ask again.</p>}
            </div>
          ))}
          {pending && <div className="srs-think" role="status"><i aria-hidden="true" />OpenClaw is searching the index… {elapsed(view?.pendingSince ?? null, now)}</div>}
        </div>
      )}
      {view?.error && !pending && (
        <p className="srs-err" role="alert">
          {view.error.text}{' '}
          <button type="button" className="srs-not" disabled={sending} onClick={() => { void act({ action: 'retry' }); }}>Try again</button>
        </p>
      )}
      {error && !view?.error && <p className="srs-err" role="alert">{error}</p>}
      {unavailable ? <p className="srs-note">OpenClaw isn’t available on this server, so it cannot be asked. The search tab still works.</p>
        : empty ? <p className="srs-note">Nothing is indexed yet, so there is nothing for OpenClaw to search.</p> : (
          <form className="srs-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <input ref={input} value={draft} maxLength={1000} disabled={!view}
              placeholder={messages.length ? 'Narrow it: “no, the earlier one”, “it was Claude Code”' : 'e.g. the Codex session last week on the Mac about the ESC firmware'}
              aria-label="Tell OpenClaw what you remember of the session"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}
              onKeyUp={(e) => e.stopPropagation()} />
            <button type="submit" className="srs-send" disabled={!draft.trim() || pending || sending}>{pending ? 'Searching…' : 'Ask'}</button>
          </form>
        )}
      {(messages.length > 0 || (view?.missing.length ?? 0) > 0) && (
        <div className="row2">
          {view && view.missing.length > 0 && <span>Nothing from the {view.missing.join(' or the ')} is indexed yet.</span>}
          {messages.length > 0 && !pending && (
            <button type="button" className="srs-not" disabled={sending} onClick={() => { void act({ action: 'reset' }).then(() => input.current?.focus()); }}>Start over</button>
          )}
        </div>
      )}
    </div>
  );
}

/** The link the Link button makes, as the manual search makes it. */
export async function linkSession(target: string, uid: string): Promise<SessionsView> {
  const res = await fetch('/api/session-index/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, uid, verdict: 'link' }) });
  const json = await res.json().catch(() => ({})) as { success?: boolean; data?: SessionsView; error?: string };
  if (!res.ok || !json.success || !json.data) throw new Error(json.error || 'That did not save.');
  return json.data;
}
