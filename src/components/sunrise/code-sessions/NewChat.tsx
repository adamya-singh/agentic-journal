'use client';

// "New chat": OpenClaw, Claude Code or Codex. OpenClaw opens a new chat at once, as before. A coding agent asks where
// it runs (the task's place, remembered; other devices' projects are listed but not open yet), what it runs with,
// and what to do first; or continues one of the agent's own sessions in that folder, which then joins the task.
// An agent that cannot take a session now is shown, greyed, with the reason its server gives; one that is not signed
// in on this device can be signed in to from here (SignIn.tsx). Each says who is signed in, and on which plan.
import React from 'react';
import { SESSION_APP } from '@/components/horizon/CardSessions';
import { AGENT_LABEL, DEFAULT_PICKS, type AgentKind, type ModelEntry, type NativeSession, type OwnSettings, type Place, type SessionPicks } from '@/lib/code-agents/protocol';
import { accountLine, limitsLine, ownWords, placeGroups, placeKey } from '@/lib/code-sessions-ui';
import { MAX_CHAT_MESSAGE } from '@/lib/task-chat';
import { PicksSelects, useTouchKeyboard } from './SessionPane';
import { AgentSignIn } from './SignIn';
import type { CodeSessions } from './useCodeSessions';

type Choice = 'openclaw' | AgentKind;
const CHOICES: Choice[] = ['openclaw', 'claude-code', 'codex'];
const WHAT: Record<Choice, string> = {
  openclaw: 'Talks the task through and works on its pages. It gets the brief and the page you are on.',
  'claude-code': 'Works in a folder on your machine. The session is a real Claude Code one: it is in its own list too.',
  codex: 'Works in a folder on your machine. The session is a real Codex one: the Codex app lists it too.',
};
const stop = (e: React.KeyboardEvent) => e.stopPropagation();

/** A server's reason as words, with `a command` in it set as code. */
function reasonText(text: string): React.ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, i) => (part.startsWith('`') && part.endsWith('`') && part.length > 2 ? <code key={i}>{part.slice(1, -1)}</code> : part));
}

function when(ms: number, now = Date.now()): string {
  if (!ms) return '';
  const mins = Math.round((now - ms) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)}h ago`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** The agent's own sessions in the chosen folder, to continue one here. */
function Natives({ code, agent, place, taskId }: { code: CodeSessions; agent: AgentKind; place: Place; taskId: string }) {
  const [list, setList] = React.useState<NativeSession[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  React.useEffect(() => {
    let live = true;
    setList(null);
    setError(null);
    code.native(agent, place).then((got) => { if (live) setList(got); }, (e: Error) => { if (live) setError(e.message || 'Its sessions could not be read.'); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read again for another agent or folder only
  }, [agent, place.host, place.cwd]);
  const label = AGENT_LABEL[agent];
  if (error) return <p className="srk-err" role="alert">{error}</p>;
  if (!list) return <p className="srk-hint" role="status">Reading {label}’s sessions in this folder…</p>;
  if (list.length === 0) return <p className="srk-hint">{label} has no sessions in this folder yet.</p>;
  return (
    <ul className="srk-natives" aria-label={`${label}’s sessions in this folder`}>
      {list.map((s) => {
        const here = s.linkedTo === taskId ? code.sessions.find((l) => l.sessionId === s.sessionId) : undefined;
        return (
          <li key={s.sessionId}>
            <b title={s.title}>{s.title}</b>
            <span>{[when(s.updatedAt), s.source].filter(Boolean).join(' · ')}</span>
            {s.preview && s.preview !== s.title && <p>{s.preview}</p>}
            {here ? <button type="button" className="srp-chip" onClick={() => code.open(here.id)}>Open</button>
              : s.linkedTo ? <em title="It is attached to another task">On another task</em>
                : <button type="button" className="srp-chip" disabled={busy !== null} onClick={() => { setBusy(s.sessionId); void code.adopt(agent, s.sessionId, place.host).finally(() => setBusy(null)); }}>{busy === s.sessionId ? 'Bringing it…' : 'Continue here'}</button>}
          </li>
        );
      })}
    </ul>
  );
}

export function NewChat({ code, taskId, phone, closer, onOpenClaw }: { code: CodeSessions; taskId: string; phone?: boolean; closer?: React.ReactNode; onOpenClaw: () => void }) {
  const [choice, setChoice] = React.useState<AgentKind | null>(null);
  const [picks, setPicks] = React.useState<SessionPicks>(DEFAULT_PICKS);
  const [models, setModels] = React.useState<ModelEntry[] | null>(null);
  const [own, setOwn] = React.useState<OwnSettings | null>(null);
  const [text, setText] = React.useState('');
  const [natives, setNatives] = React.useState(false);
  const newlines = useTouchKeyboard() || !!phone;

  const groups = placeGroups(code.places);
  const usable = code.places.filter((p) => p.available);
  const chosenPlace = (code.place && usable.find((p) => placeKey(p) === placeKey(code.place!))) ?? usable[0] ?? null;
  const status = choice ? code.agents[choice] : undefined;
  const ready = status?.state === 'ready';

  React.useEffect(() => {
    if (!choice || !ready) { setModels(null); return; }
    let live = true;
    code.models(choice).then((got) => { if (live) setModels(got); }, () => { if (live) setModels([]); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per agent
  }, [choice, ready]);
  React.useEffect(() => { setPicks(DEFAULT_PICKS); setNatives(false); }, [choice]);
  // What its own settings come to in the chosen folder, for the picker to say ("full access, never asks").
  React.useEffect(() => {
    setOwn(null);
    if (!choice || !ready || !chosenPlace) return;
    let live = true;
    code.own(choice, chosenPlace).then((got) => { if (live) setOwn(got); }, () => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per agent and folder
  }, [choice, ready, chosenPlace?.host, chosenPlace?.cwd]);

  const start = () => {
    if (!choice || !chosenPlace || !text.trim()) return;
    // Full access can only have been picked through its confirm row (PicksSelects).
    void code.start({ agent: choice, place: { host: chosenPlace.host, cwd: chosenPlace.cwd }, picks, text, confirmFull: picks.mode === 'full' }).then((ok) => { if (ok) setText(''); });
  };

  return (
    <div className="srk" role="region" aria-label="Start a new chat about this task">
      <div className="srk-head">
        <button type="button" className="srk-back" onClick={() => code.choose(false)}>‹ Chats</button>
        <span className="sp" />
        {closer}
      </div>
      <div className="srk-new">
        <h4 id="srk-new-h">New chat with</h4>
        <div className="srk-agents" role="radiogroup" aria-labelledby="srk-new-h">
          {CHOICES.map((c) => {
            const app = SESSION_APP[c];
            const s = c === 'openclaw' ? null : code.agents[c];
            const off = c !== 'openclaw' && (!s || s.state !== 'ready');
            const lim = c !== 'openclaw' ? limitsLine(s?.limits) : null;
            const who = c !== 'openclaw' ? accountLine(s) : null;
            const why = !off ? WHAT[c] : s?.state === 'signed-out' ? `${who ?? 'Not signed in'}. Sign in below.` : s ? reasonText(s.reason ?? `${app.name} can’t take a session just now.`) : code.agentsLoaded ? `${app.name} did not answer.` : 'Checking…';
            return (
              <button key={c} type="button" role="radio" aria-checked={choice === c} className="srk-agent" disabled={off}
                onClick={() => { if (c === 'openclaw') onOpenClaw(); else setChoice(c); }}>
                <span className={`srs-app ${app.cls}`} aria-hidden="true">{app.tile}</span>
                <b>{app.name}</b>
                <span className="why">{why}</span>
                {who && !off && <span className="acct">{who}</span>}
                {lim && <span className={`lim${lim.blocked ? ' full' : ''}`}>{lim.text}</span>}
              </button>
            );
          })}
        </div>
        {(['claude-code', 'codex'] as AgentKind[]).map((a) => <AgentSignIn key={a} code={code} agent={a} status={code.agents[a]} />)}

        {choice && ready && (
          <div className="srk-form">
            <label className="srk-lbl" htmlFor="srk-place">Where it runs</label>
            {chosenPlace ? (
              <>
                <select id="srk-place" className="srk-model srk-place" value={placeKey(chosenPlace)} onKeyDown={stop} onKeyUp={stop}
                  onChange={(e) => { const p = code.places.find((x) => placeKey(x) === e.target.value); if (p?.available) void code.setPlace({ host: p.host, cwd: p.cwd }); }}>
                  {groups.map((g) => (
                    <optgroup key={g.host} label={g.available ? g.host : `${g.host} · not available yet`}>
                      {g.places.map((p) => <option key={placeKey(p)} value={placeKey(p)} disabled={!p.available}>{p.label}{p.kind === 'workspace' ? ' (where the task’s files are)' : ''}{p.available ? '' : ' · not available yet'}</option>)}
                    </optgroup>
                  ))}
                </select>
                <p className="srk-hint">{chosenPlace.host} · <code>{chosenPlace.cwd}</code>. This task’s new sessions run here until you pick another place.</p>
              </>
            ) : <p className="srk-hint">There is no folder on this machine a session can run in.</p>}

            {chosenPlace && (
              <>
                <label className="srk-lbl" htmlFor="srk-first">What should {AGENT_LABEL[choice]} do?</label>
                <div className="srk-on"><PicksSelects agent={choice} picks={picks} models={models} own={own} onChange={setPicks} /></div>
                {picks.mode === 'own' && (() => {
                  // The select is cut short; what its own settings come to is said in full here.
                  const mine = ownWords(choice, own);
                  return (
                    <p className={`srk-hint own${mine.full ? ' full' : ''}`}>
                      It runs on your {AGENT_LABEL[choice]} settings{mine.detail ? <>: <b>{mine.detail}</b></> : ''}, as when you start it yourself. Pick another mode to change that for this session.
                    </p>
                  );
                })()}
                <div className="srk-box">
                  <textarea id="srk-first" rows={3} value={text} maxLength={MAX_CHAT_MESSAGE * 5} placeholder="It gets the task’s brief with your first message."
                    onChange={(e) => setText(e.target.value)} onKeyUp={stop}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Escape') { e.preventDefault(); e.currentTarget.blur(); return; }
                      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !newlines) { e.preventDefault(); start(); }
                    }}
                    enterKeyHint={newlines ? 'enter' : 'send'} />
                  <button type="button" className="srk-send" disabled={!text.trim() || code.sending} onClick={start}>{code.sending ? 'Starting…' : 'Start'}</button>
                </div>
                {code.error && <p className="srk-err" role="alert">{code.error}</p>}
                <button type="button" className="srk-linkish" aria-expanded={natives} onClick={() => setNatives(!natives)}>
                  {natives ? 'Hide the existing sessions' : `Continue an existing ${AGENT_LABEL[choice]} session…`}
                </button>
                {natives && <Natives code={code} agent={choice} place={chosenPlace} taskId={taskId} />}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
