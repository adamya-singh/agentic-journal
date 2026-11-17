'use client';

// A coding session as a row of the task's one chats list (beside the OpenClaw chats), and as the one-line strip
// under the surface while the chats are folded away.
import React from 'react';
import { SESSION_APP } from '@/components/horizon/CardSessions';
import { AGENT_LABEL, type PlaceChoice, type SessionSummary } from '@/lib/code-agents/protocol';
import { placeLine, sessionGlance, sessionPill } from '@/lib/code-sessions-ui';
import type { CodeSessions } from './useCodeSessions';

/** An agent's mark, the same tiles the session index uses. */
export function AgentMark({ agent }: { agent: keyof typeof SESSION_APP }) {
  const app = SESSION_APP[agent];
  return <span className={`srs-app ${app.cls}`} title={app.name} aria-hidden="true">{app.tile}</span>;
}

export function CodeSessionRow({ session: s, when, places, onOpen }: { session: SessionSummary; when: string; places: PlaceChoice[]; onOpen: () => void }) {
  const pill = sessionPill(s);
  const line = sessionGlance(s);
  return (
    <div className={`srk-row srk-arow${s.unread ? ' unread' : ''}`}>
      <AgentMark agent={s.agent} />
      <button type="button" className="srk-rowmain" onClick={onOpen} aria-label={`${AGENT_LABEL[s.agent]} session: ${s.title}. ${pill.word}`}>
        <span className="t"><b>{s.title}</b><i className={`srk-pill ${pill.tone}`} style={{ fontStyle: 'normal' }}>{pill.word}</i></span>
        <span className={`l${s.state === 'needs-you' ? ' needs' : s.state === 'failed' ? ' failed' : ''}`}>{line}</span>
      </button>
      <span className="srk-meta">
        {when}<span className="where" title={s.cwd}>· {placeLine(s.host, s.cwd, places)}</span>
      </span>
    </div>
  );
}

/**
 * Under the surface while the chats are folded away and a coding session is the open one: what it is doing, and the
 * same composer in one line (it steers the turn that runs). The orb opens the chats.
 */
export function CodeMiniChat({ code, count, onOpen }: { code: CodeSessions; count: number; onOpen: () => void }) {
  const { view } = code;
  const summary = code.sessions.find((s) => s.id === code.current) ?? null;
  const agent = view?.link.agent ?? summary?.agent ?? 'codex';
  const label = AGENT_LABEL[agent];
  const state = view?.state ?? summary?.state ?? 'idle';
  const working = state === 'working' || !!view?.turnId;
  const asks = view?.approvals.filter((a) => !code.answering.has(a.id)) ?? [];
  const status = code.error ? code.error
    : asks.length > 0 ? `${label} needs you: ${asks[0]!.title}`
      : working ? `${label} is working${summary?.lastLine ? ` · ${summary.lastLine}` : '…'}`
        : summary ? sessionGlance(summary) : null;
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const submit = () => void code.send(code.draft);
  return (
    <div className="srk-mini">
      {status && <div className="st" role="status"><span>{status}</span><button type="button" onClick={onOpen}>{asks.length > 0 ? 'Answer' : 'Open'}</button></div>}
      <div className="srk-box">
        <button type="button" className={`srk-orb${working ? ' working' : asks.length > 0 || code.waiting > 0 ? ' waiting' : ''}`} onClick={onOpen} aria-label={`Open the chats${count ? ` (${count})` : ''}`} title="Chats about this task">
          {count > 0 && <em>{count}</em>}
        </button>
        <div className="srk-box">
          <textarea ref={ref} rows={1} value={code.draft} placeholder={working ? `Steer ${label}…` : `Message ${label}…`} aria-label={`Message ${label} in this session`}
            onChange={(e) => code.setDraft(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; } if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            onKeyUp={(e) => e.stopPropagation()} enterKeyHint="send" />
          <button type="button" className="srk-send" disabled={!code.draft.trim() || code.sending} onClick={submit}>{working ? 'Steer' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
