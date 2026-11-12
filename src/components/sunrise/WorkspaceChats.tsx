'use client';

// His chats with OpenClaw about one task, in the task's workspace: a list of them (most recent first), one open at
// a time, and one composer. Each chat is its own OpenClaw session, so "Continue in OpenClaw" opens the very same
// conversation in the Control UI. Every message he sends carries the surface he was on, and a chat started from a
// page says which. Nothing is shown that was not said: a task with no chats has an empty list.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openClawChatUrl } from '@/lib/openclaw-ui';
import { MAX_CHAT_MESSAGE, type ChatState, type ChatSurfaceRef, type ChatThreadSummary, type ChatThreadView } from '@/lib/task-chat';

export const CHATS_CSS = `
.srk{display:flex;flex-direction:column;min-height:0;height:100%;font:13.5px/1.45 var(--sans);color:#22130a}
.srk-head{flex:none;display:flex;align-items:center;gap:8px;padding:14px 14px 10px 16px}
.srk-head h3{margin:0;font:400 24px/1 var(--serif)}
.srk-head .n{font:500 10.5px var(--mono);padding:2px 7px;border-radius:999px;background:rgba(34,19,10,.08);color:#5b4230}
.srk-head .sp{margin-left:auto}
.srk-back{border:0;background:none;padding:2px 0;font:500 13px var(--sans);color:var(--a);cursor:pointer}
.srk-back:hover{text-decoration:underline}
.srk-pill{flex:none;font:500 10px var(--mono);letter-spacing:.04em;padding:2px 8px;border-radius:999px;background:rgba(34,19,10,.07);color:#6a4a32;white-space:nowrap}
.srk-pill.waiting{background:color-mix(in srgb,var(--a) 16%,#fff);color:var(--a)}
.srk-pill.working{background:#22130a;color:#ffe9d2}
.srk-list{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px;padding:2px 12px 12px}
.srk-row{display:grid;gap:4px;width:100%;text-align:left;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.95);background:rgba(255,255,255,.7);box-shadow:0 1px 2px rgba(120,60,10,.08);cursor:pointer;color:inherit;font:inherit}
.srk-row:hover{background:#fff;border-color:color-mix(in srgb,var(--a) 35%,#fff)}
.srk-row .t{display:flex;align-items:flex-start;gap:8px}
.srk-row .t b{flex:1;min-width:0;font:600 13.5px/1.3 var(--sans);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.srk-row .l{color:#6a4a32;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.srk-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;font:10.5px var(--mono);color:#8a6a52}
.srk-about{display:inline-flex;align-items:center;gap:6px;min-width:0;max-width:100%;padding:2px 9px 2px 3px;border-radius:999px;border:1px solid rgba(60,30,10,.16);background:#fff;color:#22130a;font:500 11.5px var(--sans);cursor:pointer}
.srk-about small{flex:none;font:500 9px var(--mono);letter-spacing:.08em;text-transform:uppercase;padding:1px 6px;border-radius:999px;background:#22130a;color:#fff6ec}
.srk-about span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.srk-about:hover{border-color:var(--a)}
span.srk-about{cursor:default}
.srk-thread{flex:none;display:grid;gap:5px;padding:0 16px 10px;border-bottom:1px solid rgba(60,30,10,.1)}
.srk-thread b{font:600 15px/1.3 var(--sans)}
.srk-thread a{color:var(--a);font:500 12px var(--sans);text-underline-offset:3px}
.srk-log{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px;padding:12px 14px}
.srk-who{font:500 9.5px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:#8a6a52}
.srk-who.you{align-self:flex-end}
.srk-m{max-width:92%;padding:8px 12px;border-radius:14px;overflow-wrap:anywhere}
.srk-m.you{align-self:flex-end;white-space:pre-wrap;background:#22130a;color:#fff6ec;border-bottom-right-radius:5px}
.srk-m.openclaw{align-self:flex-start;background:rgba(255,255,255,.9);border:1px solid rgba(60,30,10,.1);border-bottom-left-radius:5px}
.srk-m.openclaw p,.srk-m.openclaw ul,.srk-m.openclaw ol{margin:5px 0}
.srk-m.openclaw>:first-child{margin-top:0} .srk-m.openclaw>:last-child{margin-bottom:0}
.srk-m.openclaw ul,.srk-m.openclaw ol{padding-left:18px}
.srk-m.openclaw a{color:var(--a)}
.srk-m.openclaw code{font:12px var(--mono);background:rgba(120,70,30,.09);border-radius:5px;padding:1px 4px}
.srk-m.openclaw pre{overflow:auto;padding:8px 10px;border-radius:9px;background:#22130a;color:#ffe9d2}
.srk-m.openclaw pre code{background:none;padding:0}
.srk-m.openclaw table{border-collapse:collapse;font-size:12.5px}
.srk-m.openclaw td,.srk-m.openclaw th{border:1px solid rgba(60,30,10,.16);padding:2px 6px}
.srk-log .srk-about.said{align-self:flex-end}
.srk-dots{align-self:flex-start;display:flex;gap:4px;padding:11px 13px;border-radius:14px;border-bottom-left-radius:5px;background:rgba(255,255,255,.9);border:1px solid rgba(60,30,10,.1)}
.srk-dots i{width:6px;height:6px;border-radius:50%;background:var(--a);animation:srk-b 1.2s ease-in-out infinite}
.srk-dots i:nth-child(2){animation-delay:.15s} .srk-dots i:nth-child(3){animation-delay:.3s}
@keyframes srk-b{0%,60%,100%{opacity:.25}30%{opacity:1}}
.srk-err{margin:0;font-size:12.5px;color:#a3361a}
.srk-empty{margin-top:auto;display:grid;gap:10px;color:#6a4a32;font-size:13px}
.srk-empty p{margin:0}
.srk-sugg{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.srk-sugg button{font:13px var(--sans);color:#4a2a14;background:rgba(255,255,255,.75);border:1px solid color-mix(in srgb,var(--a) 30%,transparent);border-radius:999px;padding:5px 12px;cursor:pointer;text-align:left}
.srk-sugg button:hover{border-color:var(--a);background:#fff}
.srk-sugg button:disabled{opacity:.5;cursor:default}
.srk-foot{flex:none;display:grid;gap:7px;padding:10px 12px 12px;border-top:1px solid rgba(60,30,10,.1)}
.srk-on{display:flex;align-items:center;gap:8px;min-width:0;font:11px var(--mono);color:#8a6a52}
.srk-on .srk-about{flex:0 1 auto}
.srk-meta .srk-about{flex:0 1 auto}
.srk-box{display:flex;align-items:flex-end;gap:8px}
.srk-box textarea{flex:1;min-width:0;resize:none;max-height:120px;padding:9px 13px;border-radius:16px;border:1px solid rgba(60,30,10,.18);background:rgba(255,255,255,.9);color:#22130a;font:14px/1.4 var(--sans);outline:0;box-shadow:inset 0 1px 2px rgba(40,22,10,.1)}
.srk-box textarea:focus{border-color:var(--a);box-shadow:inset 0 1px 2px rgba(40,22,10,.1),0 0 0 3px color-mix(in srgb,var(--a) 20%,transparent)}
.srk-box textarea::placeholder{color:#a08268}
.srk-send{flex:none;height:38px;padding:0 16px;border-radius:999px;border:1px solid #120a05;background:linear-gradient(180deg,#4a3526,#22130a 55%,#170c06);color:#fff6ec;font:600 13px var(--sans);cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 2px 0 #0c0603}
.srk-send:disabled{opacity:.4;cursor:default}
/* The same composer in one line, under the surface, while the chats are folded away. */
.srk-mini{flex:none;display:grid;gap:5px;padding:8px 10px 10px;border-top:1px solid rgba(60,30,10,.1);background:rgba(255,255,255,.55)}
.srk-mini .st{display:flex;align-items:center;gap:8px;min-width:0;font-size:12.5px;color:#5b4230}
.srk-mini .st span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.srk-mini .st button{flex:none;border:0;background:none;padding:0;color:var(--a);font:500 12.5px var(--sans);cursor:pointer;text-decoration:underline;text-underline-offset:3px}
.srk-mini .srk-box{align-items:center}
.srk-mini .srk-box textarea{border-radius:999px;max-height:38px;height:38px;white-space:nowrap;overflow:hidden}
.srk-orb{flex:none;position:relative;width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;background:radial-gradient(circle at 34% 30%,#fff,var(--glow) 46%,var(--a) 100%);box-shadow:0 0 0 4px var(--a-soft)}
.srk-orb.working{animation:srp-breathe 1.1s ease-in-out infinite}
.srk-orb em{position:absolute;right:-4px;top:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#22130a;color:#fff6ec;font:600 10px/16px var(--mono);font-style:normal;text-align:center}
.srk-orb.waiting em{background:var(--a)}
`;

const POLL_BUSY_MS = 2500;
const POLL_QUIET_MS = 20_000;
export const CHAT_SUGGESTIONS = ['What should I do first?', 'How long will this take?', 'What am I missing?'];
const STATE_WORDS: Record<ChatState, string> = { working: 'Working', waiting: 'Waiting on you', idle: 'Idle' };

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || 'That didn’t send.');
  return json.data as T;
}
const post = <T,>(body: object) => call<T>('/api/tasks/brief-chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

/** "just now", "12m ago", "Tue Oct 20 · 9:20 PM". */
export function chatWhen(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  const mins = Math.round((now - at) / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (new Date(now).toDateString() === d.toDateString()) return time;
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

export interface TaskChats {
  loaded: boolean;
  threads: ChatThreadSummary[];
  /** The chat that is open: its id, 'new' for one not yet started, or null for the list. */
  current: string | 'new' | null;
  thread: ChatThreadView | null;
  draft: string;
  sending: boolean;
  error: string | null;
  waiting: number;
  working: number;
  setDraft: (text: string) => void;
  open: (id: string) => void;
  startNew: () => void;
  back: () => void;
  send: (text: string, about: ChatSurfaceRef | null) => Promise<void>;
}

/**
 * The task's chats, kept in step with the server. `watching` is true while he can see the open chat: only then
 * does what OpenClaw said count as read.
 */
export function useTaskChats(taskId: string, watching: boolean): TaskChats {
  const [threads, setThreads] = React.useState<ChatThreadSummary[]>([]);
  const [thread, setThread] = React.useState<ChatThreadView | null>(null);
  const [current, setCurrent] = React.useState<string | 'new' | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const currentRef = React.useRef(current);
  currentRef.current = current;

  const load = React.useCallback(async () => {
    const id = currentRef.current;
    const wanted = id && id !== 'new' ? `&thread=${encodeURIComponent(id)}` : '';
    try {
      const data = await call<{ threads: ChatThreadSummary[]; thread: ChatThreadView | null }>(`/api/tasks/brief-chat?id=${encodeURIComponent(taskId)}&list=1${wanted}`);
      setThreads(data.threads);
      if (currentRef.current === id) setThread(id && id !== 'new' ? data.thread : null);
    } catch { /* keep what we have */ }
    setLoaded(true);
  }, [taskId]);

  React.useEffect(() => { void load(); }, [load, current]);
  const busy = threads.some((t) => t.state === 'working') || !!thread?.pending;
  React.useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, busy ? POLL_BUSY_MS : POLL_QUIET_MS);
    return () => window.clearInterval(timer);
  }, [busy, load]);

  // He is looking at what OpenClaw said: it no longer waits on him.
  const unseen = watching && thread !== null && thread.id === current && thread.state === 'waiting' ? thread.id : null;
  React.useEffect(() => {
    if (!unseen) return;
    void post<ChatThreadView>({ action: 'seen', taskId, threadId: unseen })
      .then((seen) => { if (currentRef.current === seen.id) setThread(seen); return load(); })
      .catch(() => {});
  }, [unseen, taskId, load]);

  const send = React.useCallback(async (typed: string, about: ChatSurfaceRef | null) => {
    const text = typed.trim();
    const id = currentRef.current;
    if (!text || sending || (id && id !== 'new' && thread?.id === id && thread.pending)) return;
    setSending(true);
    setError(null);
    try {
      const sent = await post<ChatThreadView>({ action: 'send', taskId, text, ...(id && id !== 'new' ? { threadId: id } : { fresh: true }), ...(about ? { about } : {}) });
      currentRef.current = sent.id;
      setCurrent(sent.id);
      setThread(sent);
      setDraft('');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t send.');
    } finally {
      setSending(false);
    }
  }, [taskId, sending, thread, load]);

  return {
    loaded, threads, current, thread: thread && thread.id === current ? thread : null, draft, sending, error,
    waiting: threads.filter((t) => t.state === 'waiting').length,
    working: threads.filter((t) => t.state === 'working').length,
    setDraft,
    open: (id) => { setError(null); setThread(null); setCurrent(id); },
    startNew: () => { setError(null); setThread(null); setCurrent('new'); },
    back: () => { setError(null); setThread(null); setCurrent(null); },
    send,
  };
}

/** The surface a chat or a message is about. Pressing it shows that surface. */
export function AboutChip({ about, onShow, said }: { about: ChatSurfaceRef; onShow?: (about: ChatSurfaceRef) => void; said?: boolean }) {
  const inner = <><small>{about.kind === 'web' ? 'web' : 'work'}</small><span>{about.label}</span></>;
  const title = about.url ?? about.label;
  return onShow
    ? <button type="button" className={`srk-about${said ? ' said' : ''}`} title={title} onClick={(e) => { e.stopPropagation(); onShow(about); }}>{inner}</button>
    : <span className={`srk-about${said ? ' said' : ''}`} title={title}>{inner}</span>;
}

/**
 * The one composer. Enter sends and Shift+Enter makes a new line; nothing typed here reaches the page's
 * shortcuts; Escape first leaves the field. `oneLine` is its folded form under the surface.
 */
export function ChatComposer({ chats, about, oneLine, autoFocus, onShowSurface }: {
  chats: TaskChats; about: ChatSurfaceRef | null; oneLine?: boolean; autoFocus?: boolean; onShowSurface?: (about: ChatSurfaceRef) => void;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const pending = !!chats.thread?.pending;
  const shown = chats.current;
  React.useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [autoFocus, shown]);
  // The box grows with what is typed, up to its max-height.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || oneLine) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [chats.draft, oneLine]);
  const submit = () => void chats.send(chats.draft, about);
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // What is typed here is his message and nothing else: no shortcut of the page sees it.
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };
  const placeholder = chats.thread ? (pending ? 'OpenClaw is answering…' : 'Message OpenClaw…') : chats.current === null && chats.threads.length > 0 ? 'Start a new chat with OpenClaw…' : 'Ask OpenClaw about this, or tell it what to do…';
  const box = (
    <div className="srk-box">
      <textarea
        ref={ref}
        rows={1}
        value={chats.draft}
        maxLength={MAX_CHAT_MESSAGE}
        placeholder={placeholder}
        aria-label="Message OpenClaw about this task"
        onChange={(e) => chats.setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => e.stopPropagation()}
      />
      <button type="button" className="srk-send" disabled={!chats.draft.trim() || chats.sending || pending} onClick={submit}>Send</button>
    </div>
  );
  if (oneLine) return box;
  return (
    <div className="srk-foot">
      {chats.error && <p className="srk-err" role="alert">{chats.error}</p>}
      {about && <div className="srk-on">about <AboutChip about={about} onShow={onShowSurface} /></div>}
      {box}
    </div>
  );
}

const mdLink = { a: ({ href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props} {...(href?.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })} /> };

/** The chats panel: the list, or the one chat that is open. */
export function ChatsPanel({ chats, about, autoFocus, onShowSurface, onClose }: {
  chats: TaskChats; about: ChatSurfaceRef | null; autoFocus: boolean; onShowSurface: (about: ChatSurfaceRef) => void; onClose?: () => void;
}) {
  const logRef = React.useRef<HTMLDivElement>(null);
  const { thread } = chats;
  const count = thread?.messages.length ?? 0;
  const pending = !!thread?.pending;
  const shown = chats.current;
  React.useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [count, pending, shown]);
  const closer = onClose && <button type="button" className="srk-back" onClick={onClose} aria-label="Fold the chats away">Hide</button>;

  if (chats.current === null) {
    return (
      <div className="srk" role="region" aria-label="Chats with OpenClaw about this task">
        <div className="srk-head">
          <h3>Chats</h3>
          {chats.threads.length > 0 && <span className="n">{chats.threads.length}</span>}
          <span className="sp" />
          {chats.threads.length > 0 && <button type="button" className="srp-chip" onClick={chats.startNew}>+ New chat</button>}
          {closer}
        </div>
        <div className="srk-list">
          {chats.threads.map((t) => (
            <button key={t.id} type="button" className="srk-row" onClick={() => chats.open(t.id)}>
              <span className="t"><b>{t.title}</b><i className={`srk-pill ${t.state}`} style={{ fontStyle: 'normal' }}>{STATE_WORDS[t.state]}</i></span>
              {t.last && <span className="l">{t.lastRole === 'openclaw' ? 'OpenClaw: ' : 'You: '}{t.last}</span>}
              <span className="srk-meta">{chatWhen(t.updatedAt)}{t.about && <AboutChip about={t.about} />}</span>
            </button>
          ))}
          {chats.loaded && chats.threads.length === 0 && (
            <div className="srk-empty">
              <p>No chats about this task yet. Ask anything, or tell OpenClaw what to do: it gets the brief with your first message, and the page you are on.</p>
              <div className="srk-sugg">
                {CHAT_SUGGESTIONS.map((s) => <button key={s} type="button" disabled={chats.sending} onClick={() => void chats.send(s, about)}>{s}</button>)}
              </div>
            </div>
          )}
        </div>
        <ChatComposer chats={chats} about={about} autoFocus={false} onShowSurface={onShowSurface} />
      </div>
    );
  }

  return (
    <div className="srk" role="region" aria-label="A chat with OpenClaw about this task">
      <div className="srk-head">
        <button type="button" className="srk-back" onClick={chats.back}>‹ Chats</button>
        <span className="sp" />
        {thread && <i className={`srk-pill ${thread.state}`} style={{ fontStyle: 'normal' }} role="status">{STATE_WORDS[thread.state]}</i>}
        {closer}
      </div>
      <div className="srk-thread">
        <b>{thread?.title ?? (chats.current === 'new' ? 'New chat' : ' ')}</b>
        {thread && (
          <span className="srk-meta">
            {chatWhen(thread.updatedAt)}
            {thread.about && <AboutChip about={thread.about} onShow={onShowSurface} />}
            <a href={openClawChatUrl(thread.sessionKey)} target="_blank" rel="noopener noreferrer">Continue in OpenClaw ↗</a>
          </span>
        )}
      </div>
      <div className="srk-log" ref={logRef} aria-live="polite">
        {chats.current === 'new' && (
          <div className="srk-empty">
            <p>A new chat is its own OpenClaw session. It gets the brief with your first message, and the page you are on.</p>
            <div className="srk-sugg">
              {CHAT_SUGGESTIONS.map((s) => <button key={s} type="button" disabled={chats.sending} onClick={() => void chats.send(s, about)}>{s}</button>)}
            </div>
          </div>
        )}
        {thread?.messages.map((m, i) => (
          <React.Fragment key={i}>
            <span className={`srk-who ${m.role}`}>{m.role === 'you' ? 'You' : 'OpenClaw'}</span>
            <div className={`srk-m ${m.role}`}>
              {m.role === 'openclaw' ? <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdLink}>{m.text}</ReactMarkdown> : m.text}
            </div>
            {m.about && <AboutChip about={m.about} onShow={onShowSurface} said />}
          </React.Fragment>
        ))}
        {pending && <div className="srk-dots" role="status" aria-label="OpenClaw is answering"><i /><i /><i /></div>}
        {thread?.error && <p className="srk-err" role="alert">{thread.error}</p>}
      </div>
      <ChatComposer chats={chats} about={about} autoFocus={autoFocus} onShowSurface={onShowSurface} />
    </div>
  );
}

/**
 * Under the surface while the chats are folded away: the same composer in one line, and what the current chat is
 * doing. The orb opens the chats.
 */
export function MiniChat({ chats, about, onOpen }: { chats: TaskChats; about: ChatSurfaceRef | null; onOpen: () => void }) {
  const { thread } = chats;
  const last = thread?.messages[thread.messages.length - 1];
  const status = chats.error ? chats.error
    : thread?.pending ? 'OpenClaw is answering…'
      : thread?.error ? thread.error
        : thread && last?.role === 'openclaw' ? `OpenClaw: ${last.text.replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').slice(0, 160)}`
          : chats.waiting > 0 ? `OpenClaw answered in ${chats.waiting === 1 ? 'a chat' : `${chats.waiting} chats`}.` : null;
  const count = chats.threads.length;
  return (
    <div className="srk-mini">
      {status && <div className="st" role="status"><span>{status}</span><button type="button" onClick={onOpen}>Open</button></div>}
      <div className="srk-box">
        <button type="button" className={`srk-orb${chats.working > 0 || thread?.pending ? ' working' : chats.waiting > 0 ? ' waiting' : ''}`} onClick={onOpen} aria-label={`Open the chats${count ? ` (${count})` : ''}`} title="Chats with OpenClaw">
          {count > 0 && <em>{count}</em>}
        </button>
        <ChatComposer chats={chats} about={about} oneLine />
      </div>
    </div>
  );
}
