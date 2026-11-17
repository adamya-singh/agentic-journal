'use client';

// "Sessions that worked on this", under a task's chats in its workspace: the OpenClaw, Claude Code and Codex
// sessions the session index links to the task, each with its way back in. The rows, "Not this" and "+ Link a
// session" are the same index and the same API the brief cards use (/api/session-index, target task:<id>).
// A chat of this task that is also in the index is not listed again: the chat list above owns it, and so is a Codex
// or Claude Code session already linked to the task as one of its chats. Any other indexed Codex or Claude Code
// session can be continued here: it joins the task's chats.
// With no index on this server it says so, and does not pretend to know that no session exists.
import React from 'react';
import { copyText, SESSION_APP, sessionDates } from '@/components/horizon/CardSessions';
import { openClawChatUrl } from '@/lib/openclaw-ui';
import type { RefreshResult } from '@/lib/session-index/refresh';
import type { SessionRow, SessionsView } from '@/lib/session-index/types';
import { FINDER_CSS, linkSession, SessionFinder } from './SessionFinder';

export const SESSIONS_PANEL_CSS = `
.srs{flex:none;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;margin-top:10px;padding-top:12px;border-top:1px solid rgba(60,30,10,.12)}
.srs-head{display:flex;align-items:baseline;gap:8px}
.srs-head h4{margin:0;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srs-head .n{font:500 10.5px var(--mono);padding:1px 7px;border-radius:999px;background:rgba(34,19,10,.08);color:#5b4230}
.srs-note{margin:0;font-size:12.5px;color:#6a4a32}
.srs-list{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
.srs-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:2px 10px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.95);background:rgba(255,255,255,.7);box-shadow:0 1px 2px rgba(120,60,10,.08)}
.srs-app{grid-row:1/4;width:28px;height:28px;margin-top:1px;border-radius:8px;display:grid;place-items:center;font:600 9.5px var(--mono);letter-spacing:.03em;color:#fff6ec;background:#22130a}
.srs-app.cc{background:#b4552a}
.srs-app.cx{background:#5a4a9a}
.srs-t{font:600 13.5px/1.3 var(--sans);color:#22130a;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.srs-meta{display:flex;flex-wrap:wrap;gap:0 6px;font:10.5px/1.6 var(--mono);color:#8a6a52}
.srs-meta .live{color:#1f7a4a}
.srs-why{font-size:12.5px;color:#5b4230}
.srs-acts{grid-column:2;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:5px}
.srp .srs-go{display:inline-flex;align-items:center;padding:4px 11px;border-radius:999px;border:1px solid rgba(60,30,10,.2);background:#fff;color:#22130a;font:500 12px var(--sans);text-decoration:none;cursor:pointer}
.srs-go:hover{border-color:var(--a)}
.srp .srs-not{border:0;background:none;padding:0;font:500 12px var(--sans);color:#8a6a52;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.srp .srs-not:hover{color:#a3361a}
.srs-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.srp .srs-link{border:1px dashed rgba(60,30,10,.3);background:transparent;border-radius:999px;padding:3px 11px;font:500 12px var(--sans);color:#4a2a14;cursor:pointer}
.srs-link:hover,.srs-link[aria-expanded=true]{border-color:var(--a);border-style:solid;background:#fff}
.srs-status{font:10.5px/1.5 var(--mono);color:#8a6a52}
.srs-pick{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:10px;border-radius:14px;border:1px solid color-mix(in srgb,var(--a) 35%,transparent);background:rgba(255,255,255,.75)}
.srs-pick input{width:100%;box-sizing:border-box;height:34px;padding:0 12px;border-radius:999px;border:1px solid rgba(60,30,10,.2);background:#fff;color:#22130a;font:13px var(--sans);outline:0}
.srs-pick input:focus{border-color:var(--a)}
.srs-pick>ul{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:2px}
.srs-pick>ul>li>button{display:grid;grid-template-columns:22px minmax(0,1fr);gap:1px 8px;align-items:center;width:100%;padding:6px;border-radius:9px;border:0;background:transparent;color:#22130a;font:12.5px var(--sans);text-align:left;cursor:pointer}
.srs-pick>ul>li>button:hover,.srs-pick>ul>li>button:focus-visible{background:color-mix(in srgb,var(--a) 10%,#fff);outline:0}
.srs-pick>ul>li .srs-app{grid-row:1/3;width:22px;height:22px;border-radius:6px;font-size:8px;margin:0}
.srs-pick>ul>li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srs-pick>ul>li .d{font:10.5px var(--mono);color:#8a6a52}
.srs-err{margin:0;font-size:12.5px;color:#a3361a}
/* A phone: what is typed in is 16px (iOS zooms in on anything smaller), and what is pressed is a finger wide. */
.cols-1 .srs-pick input{height:44px;font-size:16px}
.srp.cols-1 .srs-go{min-height:44px;padding:8px 14px;font-size:13.5px}
.srp.cols-1 .srs-not{padding:12px 6px;margin:-12px -6px;font-size:13px}
.srp.cols-1 .srs-link{min-height:44px;padding:8px 14px;font-size:13.5px}
.cols-1 .srs-pick>ul>li>button{min-height:44px}
.srp .srs-again{display:inline-flex;align-items:center;gap:5px;border:1px solid rgba(60,30,10,.18);background:transparent;border-radius:999px;padding:3px 10px;font:500 12px var(--sans);color:#4a2a14;cursor:pointer}
.srp .srs-again:hover:not(:disabled){border-color:var(--a);background:#fff}
.srp .srs-again:disabled{cursor:default;color:#8a6a52}
.srs-again svg{width:12px;height:12px;flex:none}
.srs-again[aria-busy=true] svg{animation:srs-spin .9s linear infinite}
@keyframes srs-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.srs-again[aria-busy=true] svg{animation:none}}
.srs-checked{margin:0;font:10.5px/1.5 var(--mono);color:#8a6a52}
.srs-checked.warn{color:#a3561a}
.srp.cols-1 .srs-again{min-height:44px;padding:8px 14px;font-size:13.5px}
` + FINDER_CSS;

const TASK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFRESH_MS = 120_000;
const STALE_MS = 3 * 86_400_000;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || 'The session index did not answer.');
  return json.data as T;
}
const feedback = (target: string, uid: string, verdict: 'link' | 'not' | 'clear') => call<SessionsView>('/api/session-index/feedback', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, uid, verdict }),
});

function lastSent(iso: string | null): string {
  if (!iso) return 'never';
  const hours = Math.round((Date.now() - Date.parse(iso)) / 3_600_000);
  return hours < 48 ? `${Math.max(hours, 1)}h ago` : new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

type Continue = (app: 'codex' | 'claude-code', sessionId: string, host: string) => Promise<boolean>;

function Row({ row, onNot, onContinue }: { row: SessionRow; onNot: (row: SessionRow) => void; onContinue?: Continue }) {
  const [copied, setCopied] = React.useState(false);
  const [bringing, setBringing] = React.useState(false);
  const coding = row.app === 'codex' || row.app === 'claude-code' ? row.app : null;
  const app = SESSION_APP[row.app];
  const meta = [app.name, row.machine, sessionDates(row), row.turns ? `${row.turns} turn${row.turns === 1 ? '' : 's'}` : ''].filter(Boolean);
  return (
    <li className="srs-row">
      <span className={`srs-app ${app.cls}`} title={app.name} aria-hidden="true">{app.tile}</span>
      <span className="srs-t" title={row.title}>{row.title}</span>
      <span className="srs-meta">
        {row.live && <span className="live">running now ·</span>}
        {meta.map((m, i) => <span key={i}>{i > 0 ? '· ' : ''}{m}</span>)}
      </span>
      {row.why && <span className="srs-why">{row.why}</span>}
      <span className="srs-acts">
        {row.key ? <a className="srs-go" href={openClawChatUrl(row.key)} target="_blank" rel="noopener noreferrer">Continue in OpenClaw ↗</a>
          : row.href ? <a className="srs-go" href={row.href} target="_blank" rel="noopener noreferrer">Open on claude.ai ↗</a>
            : row.resume ? (
              <button type="button" className="srs-go" title={row.resume}
                onClick={() => { void copyText(row.resume!).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); }); }}>
                {copied ? 'Copied' : 'Copy resume command'}
              </button>
            ) : null}
        {coding && onContinue && (
          <button type="button" className="srs-go" disabled={bringing} title={`Bring it into this task’s chats and carry on with it here, in ${app.name} itself`}
            onClick={() => { setBringing(true); void onContinue(coding, row.uid.slice(row.uid.indexOf(':') + 1), row.host).finally(() => setBringing(false)); }}>
            {bringing ? 'Bringing it…' : 'Continue here'}
          </button>
        )}
        <button type="button" className="srs-not" onClick={() => onNot(row)} title="Take it off this task; it will not come back by itself">Not this</button>
      </span>
    </li>
  );
}

function Picker({ target, taskId, hidden, linkedUids, onLinked, onClose }: {
  target: string; taskId: string; hidden: (row: SessionRow) => boolean; linkedUids: Set<string>;
  /** A link made; `close` when it came from the manual search, which closes the panel as it always did. */
  onLinked: (view: SessionsView, close: boolean) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = React.useState<'search' | 'ask'>('search');
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<SessionRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    let live = true;
    const timer = window.setTimeout(() => {
      call<SessionRow[]>(`/api/session-index/search?q=${encodeURIComponent(q)}`)
        .then((found) => { if (live) { setHits(found); setError(null); } }, (e: Error) => { if (live) setError(e.message); });
    }, 220);
    return () => { live = false; window.clearTimeout(timer); };
  }, [q]);
  const shown = (hits ?? []).filter((hit) => !hidden(hit));
  const tab = (id: 'search' | 'ask', label: string) => (
    <button type="button" role="tab" id={`srs-tab-${id}`} aria-selected={mode === id} onClick={() => setMode(id)}>{label}</button>
  );
  return (
    <div className="srs-pick">
      <div className="srs-tabs" role="tablist" aria-label="How to find the session">{tab('search', 'Search')}{tab('ask', 'Ask OpenClaw')}</div>
      {mode === 'search' && (
        <>
          <input autoFocus value={q} placeholder="Search session titles and text" aria-label="Search sessions to link to this task"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}
            onKeyUp={(e) => e.stopPropagation()} />
          {hits && (shown.length > 0 ? (
            <ul>
              {shown.map((hit) => (
                <li key={hit.uid}>
                  <button type="button" onClick={() => { linkSession(target, hit.uid).then((v) => onLinked(v, true), (e: Error) => setError(e.message)); }}>
                    <span className={`srs-app ${SESSION_APP[hit.app].cls}`} aria-hidden="true">{SESSION_APP[hit.app].tile}</span>
                    <span>{hit.title}</span>
                    <span className="d">{[SESSION_APP[hit.app].name, hit.machine, sessionDates(hit)].filter(Boolean).join(' · ')}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="srs-note">No other session matches. <button type="button" className="srs-not" onClick={() => setMode('ask')}>Ask OpenClaw to look</button></p>)}
          {error && <p className="srs-err" role="alert">{error}</p>}
        </>
      )}
      {/* Kept mounted while the search tab is open: a turn that takes a while goes on, and what was typed stays. */}
      <SessionFinder taskId={taskId} hidden={mode !== 'ask'} isLinked={(uid) => linkedUids.has(uid)} onClose={onClose}
        onLink={async (row) => { onLinked(await linkSession(target, row.uid), false); }} />
    </div>
  );
}

const ago = (iso: string, now: number) => {
  const mins = Math.round((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

/** What a refresh says, in a line: what it found, which device it could not reach, or why it did not run. */
function refreshLine(r: RefreshResult): { text: string; warn: boolean } {
  const problems = r.devices.filter((d) => !d.reachable).map((d) => `the ${d.machine} ${d.error ?? 'could not be reached'}`);
  const behind = r.devices.filter((d) => d.reachable && d.pending > 0).map((d) => d.machine);
  if (r.state === 'failed') return { text: r.message ?? 'The index could not be collected just now.', warn: true };
  if (r.state === 'busy') return { text: r.message ?? 'The index was being collected already.', warn: false };
  const added = r.added ?? 0;
  const parts = [r.message ?? (added > 0 ? `${added} new session${added === 1 ? '' : 's'} came in.` : r.changed > 0 ? 'Up to date; no new sessions, newer messages folded in.' : 'Up to date; nothing new.')];
  if (problems.length) parts.push(`${problems.join('; ').replace(/^t/, 'T')}: what it sent before is kept.`);
  if (behind.length) parts.push(`The ${behind.join(' and the ')} still has more to send; the regular run catches up.`);
  return { text: parts.join(' '), warn: problems.length > 0 };
}

const AGAIN_ICON = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/**
 * The sessions of one task. `chatKeys` are the OpenClaw session keys of the task's own chats, which are left out
 * here; nothing is drawn until the chats are `ready`, so a chat never shows twice even for a moment.
 */
export function TaskSessions({ taskId, chatKeys, ready, codeSessions = [], onContinue }: {
  taskId: string; chatKeys: string[]; ready: boolean;
  /** The task's Codex and Claude Code chats, left out here. */
  codeSessions?: { agent: string; sessionId: string }[];
  /** Brings an indexed Codex or Claude Code session into the task's chats. */
  onContinue?: Continue;
}) {
  const target = `task:${taskId}`;
  const valid = TASK_ID.test(taskId);
  const [view, setView] = React.useState<SessionsView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [checked, setChecked] = React.useState<RefreshResult | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);
  // "Check again": the devices are asked for what they have now, then the list is read anew.
  const checkAgain = () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    call<{ view: SessionsView; refresh: RefreshResult }>('/api/session-index/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }),
    }).then(({ view: got, refresh }) => { setView(got); setFailed(false); setChecked(refresh); }, (e: Error) => setError(e.message))
      .finally(() => { setChecking(false); setNow(Date.now()); });
  };
  const load = React.useCallback(() => {
    if (!valid) return;
    call<SessionsView>(`/api/session-index/card?target=${encodeURIComponent(target)}`)
      .then((got) => { setView(got); setFailed(false); }, () => setFailed(true));
  }, [target, valid]);
  React.useEffect(() => {
    load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') load(); }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  if (!valid || !ready || (!view && !failed)) return null;
  const head = (count?: number) => (
    <div className="srs-head"><h4>Sessions that worked on this</h4>{count ? <span className="n">{count}</span> : null}</div>
  );
  const again = (
    <button type="button" className="srs-again" onClick={checkAgain} disabled={checking} aria-busy={checking}
      title="Ask the devices for their newest sessions, then show this list again">
      {AGAIN_ICON}{checking ? 'Checking…' : 'Check again'}
    </button>
  );
  const said = checked ? refreshLine(checked) : null;
  const checkedLine = said && <p className={`srs-checked${said.warn ? ' warn' : ''}`} role="status">{said.text}</p>;
  if (!view) {
    return (
      <section className="srs" aria-label="Sessions that worked on this task">
        {head()}
        <p className="srs-note">The session index could not be read just now. <button type="button" className="srs-not" onClick={load}>Try again</button></p>
      </section>
    );
  }
  const own = new Set(chatKeys);
  const linked = new Set(codeSessions.map((s) => `${s.agent}:${s.sessionId}`));
  const isChat = (row: SessionRow) => (!!row.key && own.has(row.key)) || linked.has(row.uid);
  const rows = view.rows.filter((row) => !isChat(row));
  // The task's own coding sessions are known without the index; anything else needs a machine to have sent its sessions.
  if (view.indexed === 0 && rows.length === 0) {
    return (
      <section className="srs" aria-label="Sessions that worked on this task">
        {head()}
        <p className="srs-note">Nothing is indexed yet. No machine has sent its sessions to this Journal, so it cannot tell which other sessions worked on this task.</p>
        <div className="srs-foot">{again}</div>
        {checkedLine}
        {error && <p className="srs-err" role="alert">{error}</p>}
      </section>
    );
  }
  const listed = new Set(view.rows.map((row) => row.uid));
  const not = (row: SessionRow) => {
    setError(null);
    feedback(target, row.uid, row.why === 'You linked it' ? 'clear' : 'not').then(setView, (e: Error) => setError(e.message));
  };
  const stale = view.hosts.filter((h) => h.lastSync && Date.now() - Date.parse(h.lastSync) > STALE_MS);
  return (
    <section className="srs" aria-label="Sessions that worked on this task">
      {head(rows.length)}
      {rows.length > 0 ? <ul className="srs-list">{rows.map((row) => <Row key={row.uid} row={row} onNot={not} onContinue={onContinue} />)}</ul>
        : <p className="srs-note">None of the {view.indexed.toLocaleString()} indexed sessions is linked to this task{view.rows.length > 0 ? ' besides its chats above' : ''}.</p>}
      {picking && <Picker target={target} taskId={taskId} hidden={(row) => listed.has(row.uid) || isChat(row)} linkedUids={listed}
        onLinked={(got, close) => { setView(got); if (close) setPicking(false); }} onClose={() => setPicking(false)} />}
      <div className="srs-foot">
        <button type="button" className="srs-link" aria-expanded={picking} onClick={() => setPicking((was) => !was)}>+ Link a session</button>
        {again}
        <span className="srs-status">
          {view.indexed ? `${view.indexed.toLocaleString()} indexed${view.hosts.length > 0 ? ` from ${view.hosts.map((h) => h.machine).join(', ')}` : ''}` : 'No machine has sent its sessions yet'}
          {view.checkedAt && ` · checked ${ago(view.checkedAt, now)}`}
          {stale.length > 0 && ` · ${stale.map((h) => `${h.machine} last sent ${lastSent(h.lastSync)}`).join(', ')}`}
        </span>
      </div>
      {checkedLine}
      {error && <p className="srs-err" role="alert">{error}</p>}
    </section>
  );
}
