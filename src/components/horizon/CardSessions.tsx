'use client';

// The Sessions section of a task brief or an action card: the OpenClaw, Claude Code and Codex sessions
// that worked on it, each with a way back in. Rows come from /api/session-index/card; "Not this" and
// "+ Link a session" teach it.
import React from 'react';
import { openClawChatUrl } from '@/lib/openclaw-ui';
import type { SessionApp, SessionRow, SessionsView } from '@/lib/session-index/types';

export const SESSIONS_CSS = `
.hzb .hzs{margin-top:16px}
.hzs-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 7px}
.hzs-head h4{margin:0;font:500 10px var(--hz-mono);letter-spacing:.14em;text-transform:uppercase;color:#8d98aa}
.hzs-head span{font:11px var(--hz-mono);color:#6f7b8d}
.hzs-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.hzs-row{display:grid;grid-template-columns:28px minmax(0,1fr) auto;gap:4px 10px;align-items:start;padding:9px 10px;border-radius:12px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.13)}
.hzs-row:hover,.hzs-row:focus-within{border-color:rgba(255,210,168,.45)}
.hzs-app{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font:600 9.5px var(--hz-mono);letter-spacing:.03em;margin-top:1px}
.hzs-app.oc{background:rgba(134,230,216,.12);color:#86e6d8;border:1px solid rgba(134,230,216,.35)}
.hzs-app.cc{background:rgba(255,190,140,.10);color:#ffc89a;border:1px solid rgba(255,190,140,.35)}
.hzs-app.cx{background:rgba(207,196,255,.10);color:#cfc4ff;border:1px solid rgba(207,196,255,.35)}
.hzs-main{min-width:0}
.hzs .hzs-t{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font:500 13.5px/1.3 var(--hz-sans);color:var(--hz-ink);text-decoration:none;overflow-wrap:anywhere}
.hzs a.hzs-t:hover{text-decoration:underline;text-decoration-color:rgba(255,210,168,.6)}
.hzs-meta{display:flex;flex-wrap:wrap;align-items:center;gap:0 6px;margin-top:2px;font:11px/1.5 var(--hz-mono);color:var(--hz-dim)}
.hzs-meta .sep{color:#4e5868}
.hzs-live{display:inline-flex;align-items:center;gap:5px;color:#86e6d8}
.hzs-live i{width:6px;height:6px;border-radius:50%;background:#86e6d8;box-shadow:0 0 8px #86e6d8}
.hzs-why{margin-top:4px;font-size:12.5px;line-height:1.45;color:#c9d1dd}
.hzs-tag{display:inline-block;font:10px/1.5 var(--hz-mono);letter-spacing:.04em;border-radius:5px;padding:0 5px;margin-left:6px;white-space:nowrap;vertical-align:1px}
.hzs-tag.linked{color:#06231f;background:#86e6d8}
.hzs-tag.matched{color:#e2b88f;border:1px dashed rgba(255,210,168,.45)}
.hzs-side{display:flex;flex-direction:column;align-items:flex-end;gap:5px;align-self:center}
.hzs .hzs-go{font:500 11.5px var(--hz-mono);color:#ffd2a8;border:1px solid rgba(255,210,168,.45);border-radius:999px;padding:3px 10px;white-space:nowrap;text-decoration:none;background:transparent;cursor:pointer}
.hzs .hzs-go:hover,.hzs .hzs-go:focus-visible{background:rgba(255,210,168,.1);outline:none}
.hzs .hzs-go.copy{color:var(--hz-ink);border-color:rgba(255,255,255,.22)}
.hzs-not{background:transparent;border:0;padding:0;font:11px var(--hz-mono);color:#6f7b8d;cursor:pointer;opacity:0;transition:opacity .15s}
.hzs-row:hover .hzs-not,.hzs-row:focus-within .hzs-not{opacity:1}
.hzs-not:hover,.hzs-not:focus-visible{color:#ff8a5c;outline:none}
.hzs-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;margin-top:8px}
.hzs-more{background:transparent;border:0;padding:0;color:#ffd2a8;font:500 12.5px var(--hz-sans);cursor:pointer}
.hzs-link{font:500 11px var(--hz-mono);border:1px dashed rgba(255,255,255,.25);background:transparent;border-radius:999px;padding:2px 10px;color:var(--hz-dim);cursor:pointer}
.hzs-link:hover,.hzs-link:focus-visible,.hzs-link[aria-expanded=true]{border-color:#ffd2a8;color:var(--hz-ink);outline:none}
.hzs-status{font:10.5px/1.5 var(--hz-mono);color:#6f7b8d}
.hzs-none{display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;font-size:12.5px;color:var(--hz-dim)}
.hzs-none button{background:transparent;border:0;padding:0;color:#ffd2a8;font:500 12.5px var(--hz-sans);cursor:pointer}
.hzs-none button:hover,.hzs-none button:focus-visible{text-decoration:underline;outline:none}
.hzs-pick{margin-top:8px;padding:10px;border-radius:14px;border:1px solid rgba(255,210,168,.35);background:rgba(0,0,0,.25)}
.hzs-pick input{width:100%;box-sizing:border-box;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);border-radius:10px;padding:8px 11px;color:var(--hz-ink);font:13px var(--hz-sans)}
.hzs-pick input:focus{outline:none;border-color:rgba(255,210,168,.6)}
.hzs-pick ul{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:2px}
.hzs-pick li button{display:grid;grid-template-columns:22px minmax(0,1fr) auto;gap:8px;align-items:center;width:100%;padding:5px 6px;border-radius:8px;border:0;background:transparent;color:var(--hz-ink);font:12.5px var(--hz-sans);text-align:left;cursor:pointer}
.hzs-pick li button:hover,.hzs-pick li button:focus-visible{background:rgba(255,210,168,.1);outline:none}
.hzs-pick li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hzs-pick .hzs-app{width:20px;height:20px;border-radius:6px;font-size:7.5px;margin:0}
.hzs-pick .d{font:11px var(--hz-mono);color:var(--hz-dim)}
.hzs-pick p{margin:8px 2px 0;font-size:12px;color:var(--hz-dim)}
.hzs-err{font-size:12px;color:#ff8a5c;margin-top:6px}
.hzs.compact .hzs-row{padding:7px 9px;gap:2px 9px}
.hzs.compact .hzs-t{-webkit-line-clamp:1}
.hzs.compact .hzs-why{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden}
@media (max-width:760px){
.hzs-row{grid-template-columns:28px minmax(0,1fr)}
.hzs-side{grid-column:2;flex-direction:row;align-items:center;justify-content:flex-start;align-self:start;margin-top:4px}
.hzs-not{opacity:1}
}
`;

export const SESSION_APP: Record<SessionApp, { cls: string; tile: string; name: string }> = {
  openclaw: { cls: 'oc', tile: 'OC', name: 'OpenClaw' },
  'claude-code': { cls: 'cc', tile: 'CC', name: 'Claude Code' },
  codex: { cls: 'cx', tile: 'CX', name: 'Codex' },
};

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "today", "Oct 14", "Sep 3–7", "Sep 30–Oct 2". */
export function sessionDates(row: Pick<SessionRow, 'started' | 'ended'>, now = new Date()): string {
  const end = row.ended ?? row.started;
  if (!end) return '';
  const e = new Date(end);
  if (e.toDateString() === now.toDateString()) return 'today';
  const s = row.started ? new Date(row.started) : e;
  if (s.toDateString() === e.toDateString()) return day(end);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) return `${day(s.toISOString())}–${e.getDate()}`;
  return `${day(s.toISOString())}–${day(end)}`;
}

function ago(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return day(iso);
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // http on a LAN address has no clipboard API
    const t = document.createElement('textarea');
    t.value = text;
    document.body.appendChild(t);
    t.select();
    document.execCommand('copy');
    t.remove();
  }
}

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || 'The session index did not answer.');
  return json.data;
}

function Row({ row, onNot }: { row: SessionRow; onNot: (row: SessionRow) => void }) {
  const [copied, setCopied] = React.useState(false);
  const app = SESSION_APP[row.app];
  const href = row.key ? openClawChatUrl(row.key) : row.href;
  const meta = [app.name, row.machine, sessionDates(row), row.turns ? `${row.turns} turn${row.turns === 1 ? '' : 's'}` : ''].filter(Boolean);
  const title = row.title;
  return (
    <li className="hzs-row">
      <span className={`hzs-app ${app.cls}`} aria-hidden="true">{app.tile}</span>
      <div className="hzs-main">
        {href ? <a className="hzs-t" href={href} target="_blank" rel="noopener noreferrer" title={title}>{title}</a> : <span className="hzs-t" title={title}>{title}</span>}
        <div className="hzs-meta">
          {row.live && <><span className="hzs-live"><i />running now</span><span className="sep">·</span></>}
          {meta.map((m, i) => <React.Fragment key={i}>{i > 0 && <span className="sep">·</span>}<span>{m}</span></React.Fragment>)}
        </div>
        {row.why && <div className="hzs-why">{row.why}<span className={`hzs-tag ${row.tier}`}>{row.tier}</span></div>}
      </div>
      <div className="hzs-side">
        {href ? (
          <a className="hzs-go" href={href} target="_blank" rel="noopener noreferrer">{row.key ? 'Continue ↗' : 'Open ↗'}</a>
        ) : row.resume ? (
          <button type="button" className="hzs-go copy" title={`Copies: ${row.resume}`}
            onClick={() => { void copyText(row.resume!).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}>
            {copied ? 'Copied' : 'Copy resume'}
          </button>
        ) : null}
        <button type="button" className="hzs-not" onClick={() => onNot(row)} title="Take it off this card; it will not come back">Not this</button>
      </div>
    </li>
  );
}

function Picker({ target, linked, onLinked }: { target: string; linked: Set<string>; onLinked: (v: SessionsView) => void }) {
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<SessionRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (q.trim().length < 2) { setHits(null); return; }
    const t = setTimeout(() => {
      call(`/api/session-index/search?q=${encodeURIComponent(q)}`).then(setHits, (e: Error) => setError(e.message));
    }, 220);
    return () => clearTimeout(t);
  }, [q]);
  const link = (uid: string) => {
    call('/api/session-index/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, uid, verdict: 'link' }) })
      .then(onLinked, (e: Error) => setError(e.message));
  };
  const shown = (hits ?? []).filter((h) => !linked.has(h.uid));
  return (
    <div className="hzs-pick">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search session titles and text" aria-label="Search sessions" />
      {hits && (shown.length ? (
        <ul>
          {shown.map((h) => (
            <li key={h.uid}>
              <button type="button" onClick={() => link(h.uid)}>
                <span className={`hzs-app ${SESSION_APP[h.app].cls}`} aria-hidden="true">{SESSION_APP[h.app].tile}</span>
                <span>{h.title}</span>
                <span className="d">{h.machine} · {sessionDates(h)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p>No session matches.</p>)}
      {error && <div className="hzs-err" role="alert">{error}</div>}
    </div>
  );
}

/**
 * Sessions for one task or card. `compact` (the Tether card) shows two rows and nothing at all when there
 * are none; `full` (the brief window, the far-side card) shows every row, linking by hand and freshness.
 */
export function CardSessions({ target, variant, prompt, onMore }: {
  target: string;
  variant: 'compact' | 'full';
  /** What a fresh session should be told; the [aj:...] mark that links it back is added here. */
  prompt?: string;
  onMore?: () => void;
}) {
  const [view, setView] = React.useState<SessionsView | null>(null);
  const [picking, setPicking] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setView(null);
    setPicking(false);
    call(`/api/session-index/card?target=${encodeURIComponent(target)}`).then((v) => { if (live) setView(v); }, () => { if (live) setView(null); });
    return () => { live = false; };
  }, [target]);
  // No index on this server yet (no machine has sent sessions): say nothing.
  if (!view || !view.indexed) return null;
  const compact = variant === 'compact';
  if (compact && !view.rows.length) return null;
  const rows = compact ? view.rows.slice(0, 2) : view.rows;
  const not = (row: SessionRow) => {
    const verdict = row.why === 'You linked it' ? 'clear' : 'not';
    call('/api/session-index/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target, uid: row.uid, verdict }) })
      .then(setView, (e: Error) => setError(e.message));
  };
  const startPrompt = `${prompt ?? ''}\n\n[aj:${target}]`.trim();
  const stale = view.hosts.filter((h) => h.lastSync && Date.now() - Date.parse(h.lastSync) > 3 * 86_400_000);
  return (
    <div className={`hzs${compact ? ' compact' : ''}`}>
      <div className="hzs-head">
        <h4>Sessions</h4>
        <span>{view.rows.length ? `${view.rows.length} on this` : 'none yet'}</span>
      </div>
      {rows.length > 0 ? (
        <ul className="hzs-list">{rows.map((r) => <Row key={r.uid} row={r} onNot={not} />)}</ul>
      ) : (
        <div className="hzs-none">
          <span>No session has worked on this yet.</span>
          <button type="button" title="Paste it into Claude Code, Codex or OpenClaw; that session then shows up here"
            onClick={() => { void copyText(startPrompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }); }}>
            {copied ? 'Copied' : 'Copy a starting prompt'}
          </button>
        </div>
      )}
      {compact ? (
        view.rows.length > 2 && onMore && <div className="hzs-foot"><button type="button" className="hzs-more" onClick={onMore}>{view.rows.length - 2} more in the full brief →</button></div>
      ) : (
        <>
          {picking && <Picker target={target} linked={new Set(view.rows.map((r) => r.uid))} onLinked={(v) => { setView(v); setPicking(false); }} />}
          <div className="hzs-foot">
            <button type="button" className="hzs-link" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>+ Link a session</button>
            <span className="hzs-status">
              {view.indexed.toLocaleString()} sessions from {view.hosts.map((h) => h.machine).join(', ')}
              {stale.length > 0 && ` · ${stale.map((h) => `${h.machine} last sent ${ago(h.lastSync)}`).join(', ')}`}
            </span>
          </div>
        </>
      )}
      {error && <div className="hzs-err" role="alert">{error}</div>}
    </div>
  );
}
