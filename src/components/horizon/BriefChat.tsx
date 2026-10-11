'use client';

// Ask OpenClaw about the task: a small chat window that folds out of the brief card (BriefLayer does the
// folding). The thread lives on the server, one OpenClaw session per task, so the card and the full brief
// show the same chat, and "Continue in OpenClaw" opens it in the Control UI.
import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MAX_CHAT_MESSAGE, type TaskChatMessage } from '@/lib/task-chat';

/** Width of the folded-out chat window. */
export const FOLD_W = 300;

export const CHAT_CSS = `
.hzc{position:relative;z-index:1;display:flex;flex-direction:column;flex:1;min-height:0;font:13px/1.45 var(--hz-sans);color:var(--hz-ink)}
.hzc-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:11px 10px 10px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
.hzc-head>div:first-child{display:grid;gap:2px;min-width:0}
.hzc-head b{display:flex;align-items:center;gap:6px;font:500 10px var(--hz-mono);letter-spacing:.16em;text-transform:uppercase;color:#e2b88f}
.hzc-head b i{width:6px;height:6px;border-radius:50%;background:#ffd2a8;animation:hzb-pulse 1.4s ease-in-out infinite}
.hzc-head span{font:400 18px/1.15 var(--hz-serif);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hzc-acts{display:flex;align-items:center;gap:6px;flex:none}
.hzc-acts button{font:500 11px var(--hz-mono);color:var(--hz-dim);border:1px solid rgba(255,255,255,.22);background:transparent;border-radius:999px;padding:2px 9px;cursor:pointer}
.hzc-acts .hzc-x{width:26px;height:26px;padding:0;font:15px/1 var(--hz-sans)}
.hzc-acts button:hover,.hzc-acts button:focus-visible{color:var(--hz-ink);border-color:#ffd2a8;outline:none}
.hzc-log{flex:1;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:7px;padding:12px 12px 10px}
.hzc-m{max-width:90%;padding:6px 10px;border-radius:12px;overflow-wrap:anywhere}
.hzc-m.you{align-self:flex-end;white-space:pre-wrap;background:rgba(255,210,168,.14);border:1px solid rgba(255,210,168,.3);border-bottom-right-radius:4px}
.hzc-m.openclaw{align-self:flex-start;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);border-bottom-left-radius:4px;color:#d6dde8}
.hzc-m.openclaw p,.hzc-m.openclaw ul,.hzc-m.openclaw ol{margin:4px 0}
.hzc-m.openclaw>:first-child{margin-top:0} .hzc-m.openclaw>:last-child{margin-bottom:0}
.hzc-m.openclaw ul,.hzc-m.openclaw ol{padding-left:18px}
.hzc-m.openclaw a{color:var(--hz-em)}
.hzc-m.openclaw code{font:12px var(--hz-mono)}
.hzc-dots{align-self:flex-start;display:flex;gap:4px;padding:9px 11px;border-radius:12px;border-bottom-left-radius:4px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13)}
.hzc-dots i{width:5px;height:5px;border-radius:50%;background:#ffd2a8;animation:hzc-b 1.2s ease-in-out infinite}
.hzc-dots i:nth-child(2){animation-delay:.15s} .hzc-dots i:nth-child(3){animation-delay:.3s}
@keyframes hzc-b{0%,60%,100%{opacity:.25}30%{opacity:1}}
.hzc-err{font-size:12px;color:#ff8a5c}
.hzc-empty{margin-top:auto;display:grid;gap:10px;font-size:12.5px;color:var(--hz-dim)}
.hzc-empty p{margin:0}
.hzc-sugg{display:flex;flex-direction:column;align-items:flex-start;gap:6px}
.hzc-sugg button{font:12.5px var(--hz-sans);color:#ffd2a8;background:rgba(255,210,168,.06);border:1px solid rgba(255,210,168,.3);border-radius:999px;padding:4px 11px;cursor:pointer;text-align:left}
.hzc-sugg button:hover,.hzc-sugg button:focus-visible{border-color:#ffd2a8;outline:none}
.hzc-bottom{padding:0 12px 10px}
.hzc-in{display:flex;align-items:flex-end;gap:6px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.22);border-radius:12px;padding:4px 4px 4px 10px}
.hzc-in:focus-within{border-color:#ffd2a8}
.hzc-in textarea{flex:1;min-width:0;resize:none;border:0;outline:0;background:transparent;color:var(--hz-ink);font:13px/1.4 var(--hz-sans);padding:4px 0;max-height:96px}
.hzc-in textarea::placeholder{color:var(--hz-dim)}
.hzc-send{flex:none;width:26px;height:26px;border-radius:50%;border:0;background:#ffd2a8;color:#1b0d05;font:600 14px/1 var(--hz-sans);cursor:pointer}
.hzc-send:disabled{opacity:.35;cursor:default}
.hzc-foot{display:flex;justify-content:flex-end;margin-top:7px;font:11px var(--hz-mono)}
.hzc-foot a{color:var(--hz-dim);text-decoration:none}
.hzc-foot a:hover,.hzc-foot a:focus-visible{color:#ffd2a8;outline:none}
@media (prefers-reduced-motion:reduce){.hzc-dots i,.hzc-head b i{animation:none;opacity:.7}}
`;

interface ChatView { sessionKey: string; messages: TaskChatMessage[]; pending: boolean; error: string | null }

const POLL_MS = 2500;
const SUGGESTIONS = ['What should I do first?', 'How long will this take?', 'What am I missing?'];

/** The Control UI: same Tailscale host on :18443 when served over https, the local gateway otherwise. */
function controlUiBase(): string {
  const configured = process.env.NEXT_PUBLIC_OPENCLAW_UI_URL;
  if (configured) return configured.replace(/\/+$/, '');
  const { protocol, hostname } = window.location;
  return protocol === 'https:' ? `https://${hostname}:18443` : `http://${hostname}:18789`;
}

export function openClawChatUrl(sessionKey: string): string {
  return `${controlUiBase()}/chat?session=${encodeURIComponent(sessionKey)}`;
}

async function call(url: string, init?: RequestInit): Promise<ChatView | null> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw new Error(json.error || 'That didn’t send.');
  return json.data as ChatView | null;
}

const post = (body: object) => call('/api/tasks/brief-chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export function BriefChat({ taskId, title, onClose }: { taskId: string; title: string; onClose: () => void }) {
  const [chat, setChat] = React.useState<ChatView | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const logRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);

  const load = React.useCallback(async () => {
    try { setChat(await call(`/api/tasks/brief-chat?id=${encodeURIComponent(taskId)}`)); } catch { /* keep what we have */ }
    setLoaded(true);
  }, [taskId]);

  React.useEffect(() => { void load(); }, [load]);
  React.useEffect(() => { inputRef.current?.focus({ preventScroll: true }); }, []);

  const pending = !!chat?.pending;
  React.useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [pending, load]);

  const count = chat?.messages.length ?? 0;
  React.useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [count, pending]);

  // Grow the box with what's typed, up to its max-height.
  React.useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  const send = async (typed: string) => {
    const text = typed.trim();
    if (!text || sending || pending) return;
    setSending(true);
    setSendError(null);
    try {
      setChat(await post({ action: 'send', taskId, text }));
      setDraft('');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'That didn’t send.');
    } finally {
      setSending(false);
    }
  };

  const startOver = async () => {
    try {
      setChat(await post({ action: 'new', taskId }));
      setSendError(null);
      inputRef.current?.focus();
    } catch { /* leave it */ }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); }
  };
  // Escape steps back one layer: out of a draft, then folds the chat away, then (outside it) the card.
  const onEscape = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    const box = inputRef.current;
    if (box && document.activeElement === box && draft.trim()) box.blur();
    else onClose();
  };

  const error = sendError ?? chat?.error ?? null;
  return (
    <div className="hzc" role="region" aria-label="Chat with OpenClaw" onKeyDown={onEscape}>
      <div className="hzc-head">
        <div>
          <b>{pending && <i aria-hidden="true" />}OpenClaw</b>
          <span title={title}>{title}</span>
        </div>
        <div className="hzc-acts">
          {count > 0 && <button type="button" onClick={() => void startOver()} title="Start a fresh conversation about this task">New</button>}
          <button type="button" className="hzc-x" onClick={onClose} aria-label="Fold the chat away">×</button>
        </div>
      </div>
      <div className="hzc-log" ref={logRef} aria-live="polite">
        {loaded && count === 0 && !pending && (
          <div className="hzc-empty">
            <p>Ask anything about this task. OpenClaw gets the brief with your first message.</p>
            <div className="hzc-sugg">
              {SUGGESTIONS.map((s) => <button key={s} type="button" disabled={sending} onClick={() => void send(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {chat?.messages.map((m, i) => (
          <div key={i} className={`hzc-m ${m.role}`}>
            {m.role === 'openclaw' ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{ a: ({ href, ...props }) => <a href={href} {...props} {...(href?.startsWith('/') ? {} : { target: '_blank', rel: 'noopener noreferrer' })} /> }}
              >
                {m.text}
              </ReactMarkdown>
            ) : m.text}
          </div>
        ))}
        {pending && <div className="hzc-dots" role="status" aria-label="OpenClaw is answering"><i /><i /><i /></div>}
        {error && <div className="hzc-err" role="alert">{error}</div>}
      </div>
      <div className="hzc-bottom">
        <div className="hzc-in">
          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            maxLength={MAX_CHAT_MESSAGE}
            placeholder={count ? 'Reply to OpenClaw…' : 'Ask OpenClaw about this…'}
            aria-label="Message OpenClaw about this task"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="hzc-send" aria-label="Send" disabled={!draft.trim() || sending || pending} onClick={() => void send(draft)}>↑</button>
        </div>
        {chat && (
          <div className="hzc-foot">
            <a href={openClawChatUrl(chat.sessionKey)} target="_blank" rel="noopener noreferrer">Continue in OpenClaw ↗</a>
          </div>
        )}
      </div>
    </div>
  );
}
