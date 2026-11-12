'use client';

// "Sessions that worked on this", under a task's chats in its workspace: the OpenClaw, Claude Code and Codex
// sessions the session index links to the task, each with its way back in. The rows, "Not this" and "+ Link a
// session" are the same index and the same API the brief cards use (/api/session-index, target task:<id>).
// A chat of this task that is also in the index is not listed again: the chat list above owns it.
// With no index on this server it says so, and does not pretend to know that no session exists.
import React from 'react';
import { copyText, SESSION_APP, sessionDates } from '@/components/horizon/CardSessions';
import { openClawChatUrl } from '@/lib/openclaw-ui';
import type { SessionRow, SessionsView } from '@/lib/session-index/types';

export const SESSIONS_PANEL_CSS = `
.srs{flex:none;display:grid;gap:8px;margin-top:10px;padding-top:12px;border-top:1px solid rgba(60,30,10,.12)}
.srs-head{display:flex;align-items:baseline;gap:8px}
.srs-head h4{margin:0;font:500 9.5px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--a)}
.srs-head .n{font:500 10.5px var(--mono);padding:1px 7px;border-radius:999px;background:rgba(34,19,10,.08);color:#5b4230}
.srs-note{margin:0;font-size:12.5px;color:#6a4a32}
.srs-list{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.srs-row{display:grid;grid-template-columns:28px minmax(0,1fr);gap:2px 10px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.95);background:rgba(255,255,255,.7);box-shadow:0 1px 2px rgba(120,60,10,.08)}
.srs-app{grid-row:1/4;width:28px;height:28px;margin-top:1px;border-radius:8px;display:grid;place-items:center;font:600 9.5px var(--mono);letter-spacing:.03em;color:#fff6ec;background:#22130a}
.srs-app.cc{background:#b4552a}
.srs-app.cx{background:#5a4a9a}
.srs-t{font:600 13.5px/1.3 var(--sans);color:#22130a;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.srs-meta{display:flex;flex-wrap:wrap;gap:0 6px;font:10.5px/1.6 var(--mono);color:#8a6a52}
.srs-meta .live{color:#1f7a4a}
.srs-why{font-size:12.5px;color:#5b4230}
.srs-acts{grid-column:2;display:flex;flex-wrap:wrap;align-items:center;gap:6px 12px;margin-top:5px}
.srs-go{display:inline-flex;align-items:center;padding:4px 11px;border-radius:999px;border:1px solid rgba(60,30,10,.2);background:#fff;color:#22130a;font:500 12px var(--sans);text-decoration:none;cursor:pointer}
.srs-go:hover{border-color:var(--a)}
.srs-not{border:0;background:none;padding:0;font:500 12px var(--sans);color:#8a6a52;cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.srs-not:hover{color:#a3361a}
.srs-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px}
.srs-link{border:1px dashed rgba(60,30,10,.3);background:transparent;border-radius:999px;padding:3px 11px;font:500 12px var(--sans);color:#4a2a14;cursor:pointer}
.srs-link:hover,.srs-link[aria-expanded=true]{border-color:var(--a);border-style:solid;background:#fff}
.srs-status{font:10.5px/1.5 var(--mono);color:#8a6a52}
.srs-pick{display:grid;gap:6px;padding:10px;border-radius:14px;border:1px solid color-mix(in srgb,var(--a) 35%,transparent);background:rgba(255,255,255,.75)}
.srs-pick input{width:100%;box-sizing:border-box;height:34px;padding:0 12px;border-radius:999px;border:1px solid rgba(60,30,10,.2);background:#fff;color:#22130a;font:13px var(--sans);outline:0}
.srs-pick input:focus{border-color:var(--a)}
.srs-pick ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.srs-pick li button{display:grid;grid-template-columns:22px minmax(0,1fr);gap:1px 8px;align-items:center;width:100%;padding:6px;border-radius:9px;border:0;background:transparent;color:#22130a;font:12.5px var(--sans);text-align:left;cursor:pointer}
.srs-pick li button:hover,.srs-pick li button:focus-visible{background:color-mix(in srgb,var(--a) 10%,#fff);outline:0}
.srs-pick li .srs-app{grid-row:1/3;width:22px;height:22px;border-radius:6px;font-size:8px;margin:0}
.srs-pick li span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srs-pick li .d{font:10.5px var(--mono);color:#8a6a52}
.srs-err{margin:0;font-size:12.5px;color:#a3361a}
`;

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

function Row({ row, onNot }: { row: SessionRow; onNot: (row: SessionRow) => void }) {
  const [copied, setCopied] = React.useState(false);
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
        <button type="button" className="srs-not" onClick={() => onNot(row)} title="Take it off this task; it will not come back by itself">Not this</button>
      </span>
    </li>
  );
}

function Picker({ target, hidden, onLinked, onClose }: { target: string; hidden: (row: SessionRow) => boolean; onLinked: (view: SessionsView) => void; onClose: () => void }) {
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
  return (
    <div className="srs-pick">
      <input autoFocus value={q} placeholder="Search session titles and text" aria-label="Search sessions to link to this task"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }}
        onKeyUp={(e) => e.stopPropagation()} />
      {hits && (shown.length > 0 ? (
        <ul>
          {shown.map((hit) => (
            <li key={hit.uid}>
              <button type="button" onClick={() => { feedback(target, hit.uid, 'link').then(onLinked, (e: Error) => setError(e.message)); }}>
                <span className={`srs-app ${SESSION_APP[hit.app].cls}`} aria-hidden="true">{SESSION_APP[hit.app].tile}</span>
                <span>{hit.title}</span>
                <span className="d">{[SESSION_APP[hit.app].name, hit.machine, sessionDates(hit)].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="srs-note">No other session matches.</p>)}
      {error && <p className="srs-err" role="alert">{error}</p>}
    </div>
  );
}

/**
 * The sessions of one task. `chatKeys` are the OpenClaw session keys of the task's own chats, which are left out
 * here; nothing is drawn until the chats are `ready`, so a chat never shows twice even for a moment.
 */
export function TaskSessions({ taskId, chatKeys, ready }: { taskId: string; chatKeys: string[]; ready: boolean }) {
  const target = `task:${taskId}`;
  const valid = TASK_ID.test(taskId);
  const [view, setView] = React.useState<SessionsView | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
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
  if (!view) {
    return (
      <section className="srs" aria-label="Sessions that worked on this task">
        {head()}
        <p className="srs-note">The session index could not be read just now. <button type="button" className="srs-not" onClick={load}>Try again</button></p>
      </section>
    );
  }
  if (view.indexed === 0) {
    return (
      <section className="srs" aria-label="Sessions that worked on this task">
        {head()}
        <p className="srs-note">Nothing is indexed yet. No machine has sent its sessions to this Journal, so it cannot tell which sessions worked on this task.</p>
      </section>
    );
  }
  const own = new Set(chatKeys);
  const isChat = (row: SessionRow) => !!row.key && own.has(row.key);
  const rows = view.rows.filter((row) => !isChat(row));
  const listed = new Set(view.rows.map((row) => row.uid));
  const not = (row: SessionRow) => {
    setError(null);
    feedback(target, row.uid, row.why === 'You linked it' ? 'clear' : 'not').then(setView, (e: Error) => setError(e.message));
  };
  const stale = view.hosts.filter((h) => h.lastSync && Date.now() - Date.parse(h.lastSync) > STALE_MS);
  return (
    <section className="srs" aria-label="Sessions that worked on this task">
      {head(rows.length)}
      {rows.length > 0 ? <ul className="srs-list">{rows.map((row) => <Row key={row.uid} row={row} onNot={not} />)}</ul>
        : <p className="srs-note">None of the {view.indexed.toLocaleString()} indexed sessions is linked to this task{view.rows.length > 0 ? ' besides its chats above' : ''}.</p>}
      {picking && <Picker target={target} hidden={(row) => listed.has(row.uid) || isChat(row)} onLinked={(got) => { setView(got); setPicking(false); }} onClose={() => setPicking(false)} />}
      <div className="srs-foot">
        <button type="button" className="srs-link" aria-expanded={picking} onClick={() => setPicking((was) => !was)}>+ Link a session</button>
        <span className="srs-status">
          {view.indexed.toLocaleString()} indexed{view.hosts.length > 0 ? ` from ${view.hosts.map((h) => h.machine).join(', ')}` : ''}
          {stale.length > 0 && ` · ${stale.map((h) => `${h.machine} last sent ${lastSent(h.lastSync)}`).join(', ')}`}
        </span>
      </div>
      {error && <p className="srs-err" role="alert">{error}</p>}
    </section>
  );
}
