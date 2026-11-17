'use client';

// Signing in to a coding agent on this device, from where a new chat starts. Codex: a link and a code he enters on
// that page (its device-code way in), and the Journal waits until Codex says it is done. Claude Code: a link, and the
// code the page shows him pasted back here; the Claude bridge runs `claude auth login` for it. Either can be stopped.
// The link and the code are shown only here: nothing in the Journal logs or keeps them.
import React from 'react';
import { copyText, SESSION_APP } from '@/components/horizon/CardSessions';
import { AGENT_LABEL, type AgentKind, type AgentLogin, type AgentStatus } from '@/lib/code-agents/protocol';
import type { CodeSessions } from './useCodeSessions';

const POLL_MS = 1500;
const TERMINAL: Record<AgentKind, string> = { codex: 'codex login', 'claude-code': 'claude auth login' };
const live = (login: AgentLogin | null) => !!login && (login.state === 'starting' || login.state === 'waiting' || login.state === 'checking');
const stop = (e: React.KeyboardEvent) => e.stopPropagation();

/** One agent's sign-in on this device: shown while it is signed out, or while a sign-in runs or has just ended. */
export function AgentSignIn({ code, agent, status }: { code: CodeSessions; agent: AgentKind; status: AgentStatus | undefined }) {
  const label = AGENT_LABEL[agent];
  const app = SESSION_APP[agent];
  const [login, setLogin] = React.useState<AgentLogin | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [pasted, setPasted] = React.useState('');
  const [copied, setCopied] = React.useState(false);
  const signedOut = status?.state === 'signed-out';

  // A sign-in already running (another tab, a reload) is picked up.
  React.useEffect(() => {
    if (!signedOut) return;
    let on = true;
    code.loginRead(agent).then((got) => { if (on && got && got.state !== 'cancelled') setLogin(got); }, () => {});
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per agent while it is signed out
  }, [agent, signedOut]);

  // While it runs, the server is asked how it stands; once it is done, each agent's status is read again.
  const running = live(login);
  React.useEffect(() => {
    if (!running) return;
    let on = true;
    const timer = window.setInterval(() => {
      code.loginRead(agent).then((got) => {
        if (!on) return;
        setLogin(got);
        if (got?.state === 'done') code.refreshAgents();
      }, () => {});
    }, POLL_MS);
    return () => { on = false; window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the poll follows whether one runs
  }, [agent, running]);

  if (!signedOut && !login) return null;
  if (!signedOut && login?.state !== 'done') return null;

  const act = async (work: () => Promise<AgentLogin>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      const got = await work();
      setLogin(got);
      if (got.state === 'done') code.refreshAgents();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };
  const begin = () => { setPasted(''); void act(() => code.loginStart(agent), 'Signing in could not start.'); };
  const cancel = () => { if (login) void act(() => code.loginCancel(agent, login.id), 'It could not be stopped.'); };
  const send = () => {
    const typed = pasted.trim();
    if (!login || !typed) return;
    setPasted('');   // not kept in the page once it is sent
    void act(() => code.loginCode(agent, login.id, typed), 'The code did not reach Claude Code.');
  };

  const host = status?.host ?? 'this device';
  let body: React.ReactNode;
  if (login?.state === 'done') {
    body = <p className="ok" role="status">Signed in. {label} is ready on {host}.</p>;
  } else if (login && (login.state === 'waiting' || login.state === 'checking') && login.url) {
    const page = <a href={login.url} target="_blank" rel="noopener noreferrer">the sign-in page ↗</a>;
    body = login.method === 'device-code' ? (
      <>
        <ol>
          <li>Open {page} and sign in.</li>
          <li>Enter this code there:
            <span className="code"><code aria-label="The code to enter">{login.code}</code>
              <button type="button" className="srp-chip" onClick={() => void copyText(login.code ?? '').then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1600); })}>{copied ? 'Copied' : 'Copy'}</button>
            </span>
          </li>
        </ol>
        <p className="wait" role="status"><i aria-hidden="true" />Waiting for you to finish there. This page notices by itself.</p>
        <div className="row"><button type="button" className="srk-linkish" disabled={busy} onClick={cancel}>Stop signing in</button></div>
      </>
    ) : (
      <>
        <ol>
          <li>Open {page} and sign in with your Claude account.</li>
          <li>Paste the code it shows you:</li>
        </ol>
        <form className="row paste" onSubmit={(e) => { e.preventDefault(); send(); }}>
          <input value={pasted} onChange={(e) => setPasted(e.target.value)} onKeyDown={stop} onKeyUp={stop} disabled={busy || login.state === 'checking'}
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false} aria-label="The code from the sign-in page" placeholder="Paste the code here" />
          <button type="submit" className="srp-chip" disabled={busy || !pasted.trim() || login.state === 'checking'}>{login.state === 'checking' ? 'Checking…' : 'Sign in'}</button>
        </form>
        <div className="row"><button type="button" className="srk-linkish" disabled={busy} onClick={cancel}>Stop signing in</button></div>
      </>
    );
  } else {
    const failed = login?.state === 'failed' ? login.error ?? 'Signing in did not work.' : null;
    body = (
      <>
        {failed && <p className="srk-err" role="alert">{failed}</p>}
        <div className="row">
          <button type="button" className="srp-chip" disabled={busy} onClick={begin}>{busy ? 'Starting…' : failed ? 'Try again' : 'Sign in'}</button>
          <span className="alt">or run <code>{TERMINAL[agent]}</code> in a terminal on {host}</span>
        </div>
      </>
    );
  }

  return (
    <section className="srk-signin" aria-label={`Sign in to ${label} on ${host}`}>
      <div className="h">
        <span className={`srs-app ${app.cls}`} aria-hidden="true">{app.tile}</span>
        <b>{label}</b>
        <small>{host} · {login?.state === 'done' ? 'signed in' : 'not signed in'}</small>
      </div>
      {body}
      {error && <p className="srk-err" role="alert">{error}</p>}
    </section>
  );
}
