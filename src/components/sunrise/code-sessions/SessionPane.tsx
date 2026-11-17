'use client';

// One Codex or Claude Code session in a task's chat pane: its head (title, where it runs, rename, archive, and the
// way to open it in the agent's own app), its turns as they stream in, what it asks pinned above the composer while
// it waits, and the composer with the session's model, effort and permission mode. While a turn works, Stop stops
// it and what he sends steers it.
import React from 'react';
import { copyText, SESSION_APP } from '@/components/horizon/CardSessions';
import {
  AGENT_LABEL, DEFAULT_PICKS, PERMISSION_LABEL, PERMISSION_MODES,
  type AgentKind, type ApprovalDecision, type ApprovalRequest, type ModelEntry, type OwnSettings, type PermissionMode, type RateLimitSummary, type SessionPicks, type SessionTurn,
} from '@/lib/code-agents/protocol';
import { limitsLine, ownWords, placeLine, resumeCommand, sessionPill } from '@/lib/code-sessions-ui';
import { MAX_CHAT_MESSAGE } from '@/lib/task-chat';
import { FileStep, Turn } from './SessionItems';
import type { CodeSessions, SessionView } from './useCodeSessions';

export const MODE_HELP: Record<PermissionMode, string> = {
  own: 'Runs as it does when you start it yourself on this device: its own settings decide what it asks.',
  ask: 'Asks before anything that is not plainly safe.',
  'auto-edit': 'Edits files in its folder by itself; asks before anything else.',
  plan: 'Reads and plans only. It changes nothing.',
  full: 'Does anything without asking, outside its folder too. Use it with care.',
};

const effortWord = (effort: string) => `${effort.charAt(0).toUpperCase()}${effort.slice(1)} effort`;
const stop = (e: React.KeyboardEvent) => e.stopPropagation();

/** A touch screen's keyboard has one Return key and no Shift+Enter: there it makes a new line and Send sends. */
export function useTouchKeyboard(): boolean {
  const [coarse] = React.useState(() => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches);
  return coarse;
}

/**
 * The model, effort and permission mode of a session, in the pane's own selects. Full access is never taken on one
 * change of the select: a row under it says what it means and asks him to confirm; only then is it picked
 * (`confirmFull`, which the server wants to see too).
 */
export function PicksSelects({ agent, picks, models, own, onChange }: { agent: AgentKind; picks: SessionPicks; models: ModelEntry[] | null; own?: OwnSettings | null; onChange: (picks: SessionPicks, confirmFull?: boolean) => void }) {
  const label = AGENT_LABEL[agent];
  // Its own settings need no confirming, even when they are full access: that is his standing choice, in its config.
  const mine = ownWords(agent, own);
  const modeTitle = picks.mode === 'own' ? `${mine.label}. ${MODE_HELP.own}` : `${PERMISSION_LABEL[picks.mode]}: ${MODE_HELP[picks.mode]}`;
  const risky = picks.mode === 'full' || (picks.mode === 'own' && mine.full);
  const [askFull, setAskFull] = React.useState(false);
  React.useEffect(() => { if (picks.mode === 'full') setAskFull(false); }, [picks.mode]);
  const fallback = models?.find((m) => m.isDefault) ?? null;
  const using = (picks.model ? models?.find((m) => m.id === picks.model) : null) ?? fallback;
  const efforts = using?.efforts ?? [];
  return (
    <>
    <span className="srk-picks srk-cpicks">
      {models && models.length > 0 && (
        <select className={`srk-model${picks.model ? ' picked' : ''}`} value={picks.model ?? ''} onKeyDown={stop} onKeyUp={stop}
          onChange={(e) => { const model = e.target.value || null; const next = model ? models.find((m) => m.id === model) : fallback; onChange({ ...picks, model, effort: picks.effort && next?.efforts.includes(picks.effort) ? picks.effort : null }); }}
          aria-label={`The ${label} model for this session`} title={`The ${label} model this session runs on, from its next turn`}>
          <option value="">{fallback ? `Default · ${fallback.label}` : `${label}’s default`}</option>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          {picks.model && !models.some((m) => m.id === picks.model) && <option value={picks.model}>{picks.model}</option>}
        </select>
      )}
      {efforts.length > 0 && (
        <select className={`srk-model${picks.effort ? ' picked' : ''}`} value={picks.effort ?? ''} onKeyDown={stop} onKeyUp={stop}
          onChange={(e) => onChange({ ...picks, effort: e.target.value || null })}
          aria-label="How hard the model thinks" title="How hard the model thinks before it acts. More effort is slower and uses more of the limit.">
          <option value="">{using?.defaultEffort ? `${effortWord(using.defaultEffort)} · default` : 'Default effort'}</option>
          {efforts.map((effort) => <option key={effort} value={effort}>{effortWord(effort)}</option>)}
        </select>
      )}
      <select className={`srk-model${picks.mode !== DEFAULT_PICKS.mode ? ' picked' : ''}${risky ? ' risky' : ''}`} value={picks.mode} onKeyDown={stop} onKeyUp={stop}
        onChange={(e) => {
          const mode = e.target.value as PermissionMode;
          if (mode === 'full' && picks.mode !== 'full') { setAskFull(true); return; }
          setAskFull(false);
          onChange({ ...picks, mode });
        }}
        aria-label={`What ${label} may do without asking`} title={modeTitle}>
        {PERMISSION_MODES.map((mode) => <option key={mode} value={mode}>{mode === 'own' ? mine.label : mode === 'full' ? 'Full access · no asking' : PERMISSION_LABEL[mode]}</option>)}
      </select>
    </span>
    {askFull && (
      <div className="srk-fullask" role="alertdialog" aria-label="Give full access?">
        <p><b>Full access?</b> {label} will run any command and change any file on this machine without asking you first, outside its folder too. Nothing stops a mistake. It stays on for this session until you change it.</p>
        <div className="row">
          <button type="button" className="srp-chip danger" onClick={() => { setAskFull(false); onChange({ ...picks, mode: 'full' }, true); }}>Give full access</button>
          <button type="button" className="srk-linkish" onClick={() => setAskFull(false)}>Keep {picks.mode === 'own' ? `your ${label} settings` : PERMISSION_LABEL[picks.mode]}</button>
        </div>
      </div>
    )}
    </>
  );
}

/** The usage limits, quietly. */
export function LimitNote({ limits, nearOnly }: { limits: RateLimitSummary | null | undefined; nearOnly?: boolean }) {
  const line = limitsLine(limits);
  if (!line) return null;
  // In a session's composer it speaks only when the limit is close.
  if (nearOnly && !line.blocked && !(limits?.windows.some((w) => w.usedPercent >= 80))) return null;
  return <span className={`srk-limit${line.blocked ? ' full' : ''}`} title="The agent’s own usage limits on your plan">{line.text}</span>;
}

const DECISION_WORDS: Record<ApprovalDecision, string> = { allow: 'Allow', 'allow-session': 'Allow for this session', deny: 'Deny', cancel: 'Deny and stop' };
const KIND_WORDS: Record<ApprovalRequest['kind'], string> = { command: 'command', 'file-change': 'files', tool: 'question', other: 'access' };

/** One thing the agent asks. Answered here, it goes at once; the stream says when it is settled (maybe elsewhere first). */
function AskCard({ ask, agent, turns, cwd, busy, onAnswer }: { ask: ApprovalRequest; agent: AgentKind; turns: SessionTurn[]; cwd: string; busy: boolean; onAnswer: (decision: ApprovalDecision) => void }) {
  const label = AGENT_LABEL[agent];
  // A file change it asks for is the file-change item it is about: its files and their diffs.
  const item = ask.itemId ? turns.flatMap((t) => t.items).find((i) => i.id === ask.itemId) : undefined;
  const files = item?.kind === 'file-change' ? item.files : [];
  // The command comes whole in its own field: shown as it will run, all of it (the block scrolls), never cut.
  const command = ask.kind === 'command' && ask.command ? ask.command : undefined;
  const decisions = ask.elsewhere ? ask.decisions.filter((d) => d === 'deny' || d === 'cancel') : ask.decisions;
  const words = (d: ApprovalDecision) => (ask.elsewhere ? (d === 'cancel' && decisions.includes('deny') ? 'Decline and stop' : 'Decline') : DECISION_WORDS[d]);
  return (
    <div className="srk-ask" role="group" aria-label={`${label} asks: ${ask.title}`}>
      <div className="h"><i aria-hidden="true" /><b>{label} asks</b><small>{KIND_WORDS[ask.kind]}</small></div>
      {/* A command reads best as itself: its title ("Run npm test") would only say it twice. */}
      {command === undefined && <p className="t">{ask.title}</p>}
      {command !== undefined && <pre className="srk-out srk-askcmd" aria-label="The command">{command}</pre>}
      {ask.detail && <p className="d">{ask.detail}</p>}
      {ask.cwd && ask.cwd !== cwd && <span className="cwd">in {ask.cwd}</span>}
      {files.length > 0 && <div className="srk-steps">{files.map((file, i) => <FileStep key={i} file={file} cwd={cwd} status="running" startOpen={files.length === 1} />)}</div>}
      {!files.length && ask.files && ask.files.length > 0 && <p className="d">{ask.files.join('\n')}</p>}
      {ask.elsewhere && <p className="else">Only the {label} app can allow this. Answer it there, or decline it here.</p>}
      <div className="acts">
        {decisions.map((d) => (
          <button key={d} type="button" className={d === 'allow' ? 'yes' : d === 'deny' ? 'no' : d === 'cancel' && !ask.elsewhere ? 'quiet' : d === 'cancel' ? 'no' : ''} disabled={busy} onClick={() => onAnswer(d)}
            title={d === 'allow-session' ? `Allow this and the same kind of thing for the rest of this session` : d === 'cancel' ? 'Say no, and stop the turn' : undefined}>
            {words(d)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rename, archive, and the way into the agent's own app, under the session's title. */
function SessionMenu({ code, view, show, onClose }: { code: CodeSessions; view: SessionView; show: 'menu' | 'resume'; onClose: () => void }) {
  const { link } = view;
  const label = AGENT_LABEL[link.agent];
  const [mode, setMode] = React.useState<'menu' | 'rename' | 'archive'>('menu');
  const [title, setTitle] = React.useState(link.title);
  const [copied, setCopied] = React.useState(false);
  // On another device the command goes there over ssh, by its alias, and opens it in that device's own agent.
  const device = code.devices.find((d) => d.host === link.host);
  const away = !!device && !device.here;
  // A device whose `codex` is not on its PATH runs the copy its look found (the Mac's ChatGPT.app carries one).
  const command = resumeCommand(link.agent, link.cwd, link.sessionId, away ? device.alias : null, away ? code.deviceOn(link.host)?.codex?.bin : null);
  const working = view.state === 'working' || view.state === 'needs-you' || !!view.turnId;
  const resume = (
    <>
      <p>
        {away
          ? <>Open this session in {label} on {device.label}: run this in a terminal here; it opens it there, over ssh. </>
          : <>Open this session in {label}: run this in a terminal on {device?.label ?? link.host}. </>}
        {link.agent === 'codex' ? `It is in the Codex app’s list for this folder${away ? ` on ${device.label}` : ''} too.` : `It is in Claude Code’s own list for this folder${away ? ` on ${device.label}` : ''} too.`}
      </p>
      <pre>{command}</pre>
      <div className="row">
        <button type="button" className="srp-chip" onClick={() => void copyText(command).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })}>{copied ? 'Copied' : 'Copy the command'}</button>
        <button type="button" className="srk-linkish" onClick={onClose}>Close</button>
      </div>
    </>
  );
  if (show === 'resume') return <div className="srk-menu">{resume}</div>;
  if (mode === 'rename') {
    return (
      <form className="srk-menu" onSubmit={(e) => { e.preventDefault(); void code.rename(title).then((ok) => { if (ok) onClose(); }); }}>
        <div className="row">
          <input autoFocus value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') onClose(); }} onKeyUp={stop} aria-label="The session’s new name" />
          <button type="submit" className="srp-chip" disabled={!title.trim() || title.trim() === link.title}>Rename</button>
          <button type="button" className="srk-linkish" onClick={onClose}>Cancel</button>
        </div>
        <p>It is renamed in {label} too.</p>
      </form>
    );
  }
  if (mode === 'archive') {
    return (
      <div className="srk-menu">
        <p>Archive “{link.title}”? It leaves this task’s chats and is archived in {label} too.</p>
        <div className="row">
          <button type="button" className="srp-chip danger" onClick={() => void code.archive().then((ok) => { if (ok) onClose(); })}>Archive it</button>
          <button type="button" className="srk-linkish" onClick={onClose}>Keep it</button>
        </div>
      </div>
    );
  }
  return (
    <div className="srk-menu" role="menu">
      <div className="row">
        <button type="button" role="menuitem" className="srp-chip" onClick={() => setMode('rename')}>Rename</button>
        <button type="button" role="menuitem" className="srp-chip" disabled={working} title={working ? 'Stop it before you archive it' : undefined} onClick={() => setMode('archive')}>Archive</button>
      </div>
      {resume}
    </div>
  );
}

/** The composer of a session: what he types goes as the next turn, or into the turn that runs (steer). */
function SessionComposer({ code, view, autoFocus, touch }: { code: CodeSessions; view: SessionView; autoFocus: boolean; touch?: boolean }) {
  const newlines = useTouchKeyboard() || !!touch;
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const label = AGENT_LABEL[view.link.agent];
  const working = view.state === 'working' || view.state === 'needs-you' || !!view.turnId;
  React.useEffect(() => { if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [autoFocus, view.link.id]);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [code.draft]);
  const submit = () => void code.send(code.draft);
  const offline = view.state === 'offline';
  return (
    <div className="srk-foot">
      {code.error && <p className="srk-err" role="alert">{code.error}</p>}
      {working && <p className="srk-steer" role="status"><i aria-hidden="true" />{view.state === 'needs-you' ? `${label} is waiting on you above.` : `${label} is working.`} What you send now goes into this turn.</p>}
      <div className="srk-on">
        <LimitNote limits={view.limits} nearOnly />
        <PicksSelects agent={view.link.agent} picks={view.link.picks} models={view.models} own={view.own} onChange={(picks, confirmFull) => void code.setPicks(picks, confirmFull)} />
      </div>
      <div className="srk-box">
        <textarea
          ref={ref}
          rows={1}
          value={code.draft}
          maxLength={MAX_CHAT_MESSAGE * 5}
          placeholder={offline ? `${label} can’t be reached just now…` : working ? `Steer ${label}: add to what it is doing…` : `Message ${label}…`}
          aria-label={`Message ${label} in this session`}
          onChange={(e) => code.setDraft(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; }
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !newlines) { e.preventDefault(); submit(); }
          }}
          onKeyUp={stop}
          enterKeyHint={newlines ? 'enter' : 'send'}
        />
        {working && (
          <button type="button" className="srk-stop" disabled={code.stopping || !view.turnId} onClick={() => void code.stop()} title={`Stop ${label}’s turn`}>
            <span className="sq" aria-hidden="true" />{code.stopping ? 'Stopping…' : 'Stop'}
          </button>
        )}
        <button type="button" className="srk-send" disabled={!code.draft.trim() || code.sending} onClick={submit}>{working ? 'Steer' : 'Send'}</button>
      </div>
    </div>
  );
}

/** The session pane: head, log, what it asks, composer. */
export function SessionPane({ code, phone, autoFocus, closer }: { code: CodeSessions; phone?: boolean; autoFocus: boolean; closer?: React.ReactNode }) {
  const { view } = code;
  const summary = code.sessions.find((s) => s.id === code.current) ?? null;
  const link = view?.link ?? summary;
  const agent: AgentKind = link?.agent ?? 'codex';
  const label = AGENT_LABEL[agent];
  const app = SESSION_APP[agent];
  const [show, setShow] = React.useState<'menu' | 'resume' | null>(null);
  const shownId = code.current;
  React.useEffect(() => setShow(null), [shownId]);

  // Stuck to the end while it streams, unless he scrolled up to read; then a button takes him back down.
  const logRef = React.useRef<HTMLDivElement>(null);
  const atEnd = React.useRef(true);
  const [behind, setBehind] = React.useState(false);
  const toEnd = React.useCallback(() => { const log = logRef.current; if (log) log.scrollTop = log.scrollHeight; atEnd.current = true; setBehind(false); }, []);
  React.useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const onScroll = () => {
      atEnd.current = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
      if (atEnd.current) setBehind(false);
    };
    log.addEventListener('scroll', onScroll, { passive: true });
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => { if (atEnd.current) log.scrollTop = log.scrollHeight; });
    watch?.observe(log);
    return () => { log.removeEventListener('scroll', onScroll); watch?.disconnect(); };
  }, [shownId]);
  const firstShown = React.useRef<string | null>(null);
  // What is at the end of the log: when it grows while he reads above, he is told there is more below.
  const lastTurn = view?.turns.at(-1);
  const lastItem = lastTurn?.items.at(-1);
  const tail = `${lastTurn?.id ?? ''}|${lastTurn?.items.length ?? 0}|${lastTurn?.status ?? ''}|${lastItem && 'text' in lastItem ? lastItem.text.length : 0}|${lastItem?.kind === 'command' ? lastItem.output.length : 0}|${code.outbox ?? ''}|${view?.approvals.length ?? 0}`;
  const tailWas = React.useRef(tail);
  React.useLayoutEffect(() => {
    if (!view) return;
    if (firstShown.current !== view.link.id) { firstShown.current = view.link.id; tailWas.current = tail; toEnd(); return; }
    const log = logRef.current;
    if (!log) return;
    const grew = tailWas.current !== tail;
    tailWas.current = tail;
    if (atEnd.current) log.scrollTop = log.scrollHeight;
    else if (grew) setBehind(true);
  }, [view, tail, toEnd]);

  const pill = view ? sessionPill({ state: view.state, unread: false }) : summary ? sessionPill(summary) : null;
  const asks = view ? view.approvals.filter((a) => !code.answering.has(a.id)) : [];
  const working = !!view && (view.state === 'working' || !!view.turnId);
  const last = view?.turns.at(-1);
  const streaming = last?.status === 'running' && last.items.at(-1)?.kind === 'agent';
  const model = link?.picks.model ? view?.models.find((m) => m.id === link.picks.model)?.label ?? link.picks.model : null;

  return (
    <div className="srk" role="region" aria-label={`A ${label} session about this task`}>
      <div className="srk-head">
        <button type="button" className="srk-back" onClick={code.close}>‹ Chats</button>
        <span className="sp" />
        {pill && <i className={`srk-pill ${pill.tone}`} style={{ fontStyle: 'normal' }} role="status">{pill.word}</i>}
        {closer}
      </div>
      <div className="srk-thread">
        <span className="srk-ctitle">
          <span className={`srs-app ${app.cls}`} title={label} aria-hidden="true">{app.tile}</span>
          <b>{link?.title ?? ' '}</b>
          {view && <button type="button" className="srk-more" aria-expanded={show === 'menu'} aria-label="Rename, archive, open it elsewhere" onClick={() => setShow(show === 'menu' ? null : 'menu')}>⋯</button>}
        </span>
        {link && (
          <span className="srk-meta">
            <span className="where" title={link.cwd}>{placeLine(link.host, link.cwd, code.places, code.devices)}</span>
            {model && <span>· {model}</span>}
            {view && <button type="button" className="srk-linkish" aria-expanded={show === 'resume'} onClick={() => setShow(show === 'resume' ? null : 'resume')}>Open in {label} ↗</button>}
          </span>
        )}
        {view && show && <SessionMenu key={show} code={code} view={view} show={show} onClose={() => setShow(null)} />}
      </div>
      <div className="srk-logwrap">
        <div className="srk-log srk-clog" ref={logRef} aria-live="polite" aria-busy={working}>
          {!view && (code.reading ? <p className="srk-note" role="status">Reading the session from {label}…</p> : code.error ? <p className="srk-err" role="alert">{code.error}</p> : null)}
          {view?.older && (
            <button type="button" className="srp-chip srk-older" disabled={code.olderLoading} onClick={() => void code.loadOlder()}>{code.olderLoading ? 'Reading…' : 'Show earlier turns'}</button>
          )}
          {view && view.turns.length === 0 && !code.outbox && !working && <p className="srk-note">Nothing has been said in this session yet.</p>}
          {view?.turns.map((turn) => <Turn key={turn.id} turn={turn} agent={agent} cwd={view.link.cwd} limits={view.limits} />)}
          {code.outbox && <><span className="srk-who you">You · sending</span><div className="srk-m you out">{code.outbox}</div></>}
          {working && !streaming && asks.length === 0 && <div className="srk-dots" role="status" aria-label={`${label} is working`}><i /><i /><i /></div>}
          {view?.state === 'offline' && <p className="srk-note" role="status">{label} can’t be reached just now. The Journal keeps trying.</p>}
          {code.polling && <p className="srk-note">Live updates are off; this session is read again every few seconds.</p>}
        </div>
        {behind && <button type="button" className="srk-jump" onClick={toEnd}>↓ Jump to latest</button>}
      </div>
      {view && asks.length > 0 && (
        <div className="srk-asks" aria-label={`${label} is waiting on you`}>
          {/* One card at a time, so the log keeps its room: the next comes up when this one is answered. */}
          {asks.slice(0, 1).map((ask) => <AskCard key={ask.id} ask={ask} agent={agent} turns={view.turns} cwd={view.link.cwd} busy={code.answering.has(ask.id)} onAnswer={(d) => void code.approve(ask.id, d)} />)}
          {asks.length > 1 && <p className="srk-askmore" role="status">{asks.length - 1} more {asks.length === 2 ? 'question waits' : 'questions wait'} after this one.</p>}
        </div>
      )}
      {view && <SessionComposer code={code} view={view} autoFocus={autoFocus} touch={phone} />}
    </div>
  );
}
