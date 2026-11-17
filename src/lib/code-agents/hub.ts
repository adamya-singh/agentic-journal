// The Journal's side of its coding-agent sessions: one connection per host and agent (made on first use), the live
// state of each linked session (the turn running, approvals waiting), a numbered log of each session's events for
// the stream to replay, and the stream's subscribers. When a connection drops, its sessions read "offline" and it
// is made again with a growing pause while anyone still needs it; sessions that were working are joined again.
// One hub per server process, kept on globalThis, so each route bundle (and a dev hot reload) finds the same one
// and no connection is made twice.
import { ApprovalGoneError, type AdapterFactory, type AgentAdapter, type AdapterSink, type HistoryPage, type NativeState, type QuestionReplyEntry } from './adapter';
import { createClaudeAdapter } from './claude';
import { createCodexAdapter } from './codex';
import { firstTurnText, typedTextOf } from './first-turn';
import {
  AGENT_LABEL, clipLine, LAST_LINE_MAX, TITLE_MAX,
  type AgentKind, type AgentLogin, type AgentStatus, type ApprovalDecision, type ApprovalRequest, type CodeSessionLink, type EventBody, type ModelEntry,
  type NativeSession, type OwnSettings, type Place, type QuestionAnswers, type RateLimitSummary, type SessionEvent, type SessionItem, type SessionPicks, type SessionState, type SessionSummary,
  type SessionTurn, type TokenUsage,
} from './protocol';
import { RpcError } from './transport';
import { isRemote } from './ssh';
import { journalOriginFor } from '@/lib/same-origin';
import { changeCodeSession, findCodeSession, mutateCodeSessions, newLinkId, readAllCodeSessions, readCodeSessions } from './store';
import type { TaskBrief } from '@/lib/task-brief';

/** Every agent the Journal knows, and how to reach it. An agent without an adapter yet says why. */
const FACTORIES: Record<AgentKind, AdapterFactory | null> = {
  codex: createCodexAdapter,
  'claude-code': createClaudeAdapter,
};
const UNAVAILABLE: Partial<Record<AgentKind, string>> = {};

const LOG_MAX = 2000;
/** A session's log is also kept under this many characters of JSON (big diffs and outputs fill it sooner). */
const LOG_CHARS_MAX = 2_000_000;
/** A session nobody has open, with nothing running, is let go after this long quiet; it is read from history again when opened. */
const IDLE_EVICT_MS = 30 * 60_000;
const SWEEP_EVERY_MS = 60_000;
const STATUS_TTL_MS = 15_000;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;
/** A "working" stamp this old is from a turn nobody is watching any more (a restart, a lost connection). */
export const WORKING_STALE_MS = 3 * 60 * 60_000;
/** A sign-in still waiting after this long is given up (a device code lasts about 15 minutes). */
const LOGIN_STALE_MS = 20 * 60_000;
/** An ended sign-in is still shown (done, failed) for this long, then forgotten. */
const LOGIN_SHOWN_MS = 5 * 60_000;

export class HubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HubError';
    this.status = status;
  }
}

type Subscriber = (event: SessionEvent) => void;

interface Live {
  linkId: string;
  taskId: string;
  agent: AgentKind;
  host: string;
  sessionId: string;
  state: SessionState;
  native: NativeState | null;
  turnId: string | null;
  sending: boolean;             // a send is out and its turn has not been heard of yet
  failed: string | null;        // the last turn's failure, until the next starts
  approvals: Map<string, ApprovalRequest>;
  log: SessionEvent[];
  sizes: number[];              // each logged event's size (characters of JSON), alongside the log
  logChars: number;
  seq: number;
  lengths: Map<string, number>; // how long each streaming item's text or output is, as the hub has seen it (delta offsets)
  activeAt: number;             // the last event, read or join: the quiet before it can be let go
  joined: boolean;              // joined on the connection that is up now
  joining: Promise<void> | null;   // a join on its way: the list, the stream and a read after a restart all ask at once
  tokens: TokenUsage | null;
  stored: { state: SessionState; busy: boolean; ask?: string };   // what the store was last told, so it is written only on a change
}

interface Conn {
  key: string;
  agent: AgentKind;
  host: string;
  adapter: AgentAdapter;
  up: boolean;
  reason: string | null;
  backoff: number;
  retry: ReturnType<typeof setTimeout> | null;
  status: { at: number; status: AgentStatus } | null;
  limits: RateLimitSummary | null;
  /** The sign-in on this device, in memory only (its link and code are never written anywhere). */
  login: AgentLogin | null;
  loginStarting: Promise<AgentLogin> | null;
}

interface HubState {
  conns: Map<string, Conn>;
  live: Map<string, Live>;                 // link id → live session
  byNative: Map<string, string>;           // conn key + native id → link id
  subscribers: Map<string, Set<Subscriber>>;   // task id → stream subscribers
  factories: Partial<Record<AgentKind, AdapterFactory | null>>;   // the tests' stand-ins
  sweptAt?: number;
}

const shared = globalThis as typeof globalThis & { __codeAgentsHub?: HubState };
const hub: HubState = (shared.__codeAgentsHub ??= { conns: new Map(), live: new Map(), byNative: new Map(), subscribers: new Map(), factories: {} });

const connKey = (agent: AgentKind, host: string) => `${host}:${agent}`;
const nativeKey = (key: string, sessionId: string) => `${key}|${sessionId}`;
const nowIso = () => new Date().toISOString();
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

function factoryOf(agent: AgentKind): AdapterFactory | null {
  return agent in hub.factories ? hub.factories[agent] ?? null : FACTORIES[agent];
}

/** For the tests (and a later stage's stand-ins): use this factory for an agent; undefined goes back to the real one. */
export function setAdapterFactory(agent: AgentKind, factory: AdapterFactory | null | undefined): void {
  if (factory === undefined) delete hub.factories[agent];
  else hub.factories[agent] = factory;
}

/** Closes every connection and forgets every live session. For the tests. */
export function resetHub(): void {
  for (const conn of hub.conns.values()) { if (conn.retry) clearTimeout(conn.retry); conn.retry = null; conn.adapter.close(); }
  hub.conns.clear();
  hub.live.clear();
  hub.byNative.clear();
  hub.subscribers.clear();
}

// ---- Connections.

function conn(agent: AgentKind, host: string): Conn | null {
  const key = connKey(agent, host);
  const have = hub.conns.get(key);
  if (have) return have;
  const factory = factoryOf(agent);
  if (!factory) return null;
  const sink: AdapterSink = {
    event: (sessionId, body) => { const live = liveOfNative(key, sessionId); if (live) ingest(live, body); },
    nativeState: (sessionId, state) => {
      const live = liveOfNative(key, sessionId);
      if (!live) return;
      live.native = state;
      settle(live);
    },
    limits: (limits) => {
      const c = hub.conns.get(key);
      if (!c) return;
      c.limits = limits;
      if (c.status) c.status.status = { ...c.status.status, limits };
      for (const live of hub.live.values()) if (live.agent === agent && live.host === host && (live.turnId || live.sending)) ingest(live, { type: 'usage-changed', limits });
    },
    connection: (up, reason) => {
      const c = hub.conns.get(key);
      if (!c) return;
      c.up = up;
      c.reason = up ? null : reason ?? 'the connection dropped';
      c.status = null;
      for (const live of hub.live.values()) {
        if (live.agent !== agent || live.host !== host) continue;
        if (!up) { live.joined = false; live.approvals.clear(); }
        settle(live);
      }
      if (!up && needed(c)) reconnectLater(c);
    },
    login: (update) => {
      const c = hub.conns.get(key);
      const login = c?.login;
      if (!c || !login || login.id !== update.loginId || ended(login)) return;
      c.login = { ...login, state: update.state, endedAt: Date.now(), ...(update.error ? { error: update.error } : {}) };
      // Signed in (or not): the next status read asks the agent again.
      c.status = null;
    },
  };
  const made: Conn = { key, agent, host, adapter: factory({ host, sink }), up: false, reason: null, backoff: 0, retry: null, status: null, limits: null, login: null, loginStarting: null };
  hub.conns.set(key, made);
  return made;
}

/** The connection is still wanted: a session on it was working, or someone has one of its sessions open. */
function needed(c: Conn): boolean {
  for (const live of hub.live.values()) {
    if (live.agent !== c.agent || live.host !== c.host) continue;
    if (live.turnId || live.sending || (hub.subscribers.get(live.taskId)?.size ?? 0) > 0) return true;
  }
  return false;
}

function reconnectLater(c: Conn): void {
  if (c.retry) return;
  c.backoff = Math.min(BACKOFF_MAX_MS, Math.max(BACKOFF_MIN_MS, c.backoff * 2));
  c.retry = setTimeout(() => {
    c.retry = null;
    if (hub.conns.get(c.key) !== c) return;
    c.adapter.connect()
      .then(() => { c.backoff = 0; return rejoinAll(c); })
      .catch(() => { if (needed(c)) reconnectLater(c); });
  }, c.backoff);
  c.retry.unref?.();
}

/** After a reconnect: the sessions that were working or open are joined again, and their clients read history anew. */
async function rejoinAll(c: Conn): Promise<void> {
  for (const live of [...hub.live.values()]) {
    if (live.agent !== c.agent || live.host !== c.host) continue;
    if (!live.turnId && !live.sending && (hub.subscribers.get(live.taskId)?.size ?? 0) === 0) continue;
    try {
      await join(live);
      ingest(live, { type: 'reset', reason: 'reconnected' });
    } catch (error) {
      console.warn(`code agents: could not rejoin ${live.sessionId}:`, message(error));
    }
  }
}

/** The adapter, connected. Throws a HubError when the agent is not available or cannot be reached. */
async function ready(agent: AgentKind, host: string): Promise<Conn> {
  const c = conn(agent, host);
  if (!c) throw new HubError(503, UNAVAILABLE[agent] ?? `${AGENT_LABEL[agent]} is not available.`);
  try {
    await c.adapter.connect();
  } catch (error) {
    c.up = false;
    c.reason = message(error);
    const why = message(error);
    throw new HubError(503, /can’t be reached|isn’t (installed|running)/.test(why) ? why : `${AGENT_LABEL[agent]} can’t be reached: ${why}`);
  }
  c.up = true;
  c.reason = null;
  return c;
}

// ---- Live sessions.

function liveOf(link: CodeSessionLink, taskId: string): Live {
  sweepSoon();
  const have = hub.live.get(link.id);
  if (have) { have.activeAt = Date.now(); return have; }
  const live: Live = {
    linkId: link.id, taskId, agent: link.agent, host: link.host, sessionId: link.sessionId,
    // A last turn that failed still reads failed after a restart, until the next turn starts.
    state: link.lastState, native: null, turnId: null, sending: false, failed: link.lastState === 'failed' ? link.lastLine || 'The last turn failed.' : null,
    approvals: new Map(), log: [], sizes: [], logChars: 0, seq: Date.now(), lengths: new Map(), activeAt: Date.now(), joined: false, joining: null, tokens: null,
    stored: { state: link.lastState, busy: !!link.workingSince, ask: askKey(link.asking ?? null) },
  };
  hub.live.set(link.id, live);
  hub.byNative.set(nativeKey(connKey(link.agent, link.host), link.sessionId), link.id);
  return live;
}

/** Whether nothing holds a live session here: no turn, no send, no approval, no join on its way, nobody watching its task. */
function idle(live: Live, now: number): boolean {
  return !live.turnId && !live.sending && live.approvals.size === 0 && !live.joining
    && (hub.subscribers.get(live.taskId)?.size ?? 0) === 0 && now - live.activeAt >= IDLE_EVICT_MS;
}

/**
 * Lets go of sessions that have been quiet a long while with nothing running and nobody watching, so the hub does
 * not keep every session it ever saw (and its log). One opened again is joined and read from history anew; a
 * client still holding an old seq gets a reset. Returns how many were let go.
 */
export function evictIdle(now = Date.now()): number {
  let gone = 0;
  for (const [linkId, live] of hub.live) {
    if (!idle(live, now)) continue;
    hub.live.delete(linkId);
    const key = nativeKey(connKey(live.agent, live.host), live.sessionId);
    if (hub.byNative.get(key) === linkId) hub.byNative.delete(key);
    gone += 1;
  }
  return gone;
}

function sweepSoon(): void {
  const now = Date.now();
  if (hub.sweptAt && now - hub.sweptAt < SWEEP_EVERY_MS) return;
  hub.sweptAt = now;
  evictIdle(now);
}

/** The live session of an agent's session id. Events reach here only for sessions this hub joined, all of them live. */
function liveOfNative(key: string, sessionId: string): Live | null {
  const linkId = hub.byNative.get(nativeKey(key, sessionId));
  return linkId ? hub.live.get(linkId) ?? null : null;
}

function liveOfLink(linkId: string): { live: Live; link: CodeSessionLink; taskId: string } {
  const found = findCodeSession(linkId);
  if (!found) throw new HubError(404, 'That session is gone.');
  return { live: liveOf(found.link, found.taskId), link: found.link, taskId: found.taskId };
}

function stateOf(live: Live): SessionState {
  const c = hub.conns.get(connKey(live.agent, live.host));
  if (c && !c.up && (live.joined || live.turnId || live.sending || c.reason)) return 'offline';
  if (live.approvals.size > 0 || live.native === 'needs-you') return 'needs-you';
  if (live.turnId || live.sending || live.native === 'working') return 'working';
  if (live.failed) return 'failed';
  return 'idle';
}

const askKey = (asking: { kind: string; title: string } | null) => (asking ? `${asking.kind}:${asking.title}` : '');

/** Works out the session's state again; when it changed, says so on the stream and in the store. */
function settle(live: Live, reason?: string): void {
  const state = stateOf(live);
  // The approval it waits on is kept in the store too, for the list and the sky, which cannot ask the hub.
  const first = live.approvals.values().next().value;
  const asking = first ? { kind: first.kind, title: clipLine(first.title, 200) } : null;
  const ask = askKey(asking);
  if (state === live.state && !reason && (live.stored.ask ?? '') === ask) return;
  const changed = state !== live.state;
  live.state = state;
  if (changed || reason) push(live, { type: 'state-changed', state, turnId: live.turnId, ...(reason ? { reason } : {}) });
  const busy = !!(live.turnId || live.sending) || state === 'working' || state === 'needs-you';
  if (live.stored.state === state && live.stored.busy === busy && (live.stored.ask ?? '') === ask) return;
  live.stored = { state, busy, ask };
  changeCodeSession(live.linkId, (link) => {
    let touched = false;
    if (link.lastState !== state) { link.lastState = state; touched = true; }
    if (askKey(link.asking ?? null) !== ask) { link.asking = asking; touched = true; }
    if (busy && !link.workingSince) { link.workingSince = nowIso(); touched = true; }
    if (!busy && link.workingSince) { link.workingSince = null; touched = true; }
    return touched;
  });
}

function push(live: Live, body: EventBody): SessionEvent {
  const event = { ...body, seq: ++live.seq, session: live.linkId, at: Date.now() } as SessionEvent;
  const size = JSON.stringify(event).length;
  live.log.push(event);
  live.sizes.push(size);
  live.logChars += size;
  live.activeAt = event.at;
  // Kept to LOG_MAX events and LOG_CHARS_MAX characters; a client from before the oldest kept gets a reset.
  while (live.log.length > 1 && (live.log.length > LOG_MAX || live.logChars > LOG_CHARS_MAX)) {
    live.log.shift();
    live.logChars -= live.sizes.shift() ?? 0;
  }
  for (const subscriber of hub.subscribers.get(live.taskId) ?? []) {
    try { subscriber(event); } catch (error) { console.error('code agents: a stream subscriber failed:', error); }
  }
  return event;
}

const lengthKey = (turnId: string, itemId: string, field: 'text' | 'output') => `${turnId}\u0000${itemId}\u0000${field}`;

/** Notes how long an item's streaming fields are now, so the deltas after it can say where they start. */
function noteLengths(live: Live, turnId: string, item: SessionItem, done: boolean): void {
  for (const field of ['text', 'output'] as const) {
    const key = lengthKey(turnId, item.id, field);
    const value = field === 'output' ? (item.kind === 'command' ? item.output : null) : 'text' in item && item.kind !== 'notice' ? item.text : null;
    if (done || value === null) live.lengths.delete(key);
    else live.lengths.set(key, value.length);
  }
}

/** One event from the agent: it changes the live state, goes on the stream, and the store keeps the glance. */
function ingest(live: Live, body: EventBody): void {
  switch (body.type) {
    case 'item-delta': {
      // Where it starts in the item, when the hub saw the item begin: a copy read meanwhile skips what it has.
      const key = lengthKey(body.turnId, body.itemId, body.field);
      const have = live.lengths.get(key);
      if (have !== undefined) {
        body = { ...body, offset: have };
        live.lengths.set(key, have + body.delta.length);
      }
      break;
    }
    case 'turn-started':
      live.turnId = body.turnId;
      live.sending = false;
      live.failed = null;
      break;
    case 'turn-completed': {
      const done = body;
      if (!live.turnId || live.turnId === done.turnId) live.turnId = null;
      // What the agent last said of the thread ("working") was about this turn; it says again if more runs.
      live.native = null;
      live.failed = done.status === 'failed' ? done.error ?? 'The turn failed.' : null;
      for (const [id, approval] of live.approvals) if (approval.turnId === done.turnId) live.approvals.delete(id);
      for (const key of live.lengths.keys()) if (key.startsWith(`${done.turnId}\u0000`)) live.lengths.delete(key);
      changeCodeSession(live.linkId, (link) => {
        link.settledAt = nowIso();
        if (done.status === 'failed' && done.error) link.lastLine = clipLine(done.error, LAST_LINE_MAX);
      });
      break;
    }
    case 'approval-asked':
      live.approvals.set(body.approval.id, body.approval);
      break;
    case 'approval-resolved':
      live.approvals.delete(body.approvalId);
      break;
    case 'item-completed':
      noteLengths(live, body.turnId, body.item, true);
      if ((body.item.kind === 'agent' || (body.item.kind === 'question' && body.item.via === 'reply')) && body.item.text.trim()) {
        const said = body.item.kind === 'question' ? `Asks: ${body.item.questions[0]?.question ?? body.item.text}` : body.item.text;
        const line = clipLine(said.replace(/[*_`#>]+/g, ''), LAST_LINE_MAX);
        changeCodeSession(live.linkId, (link) => { if (link.lastLine === line) return false; link.lastLine = line; });
      }
      if (body.item.kind === 'user') {
        const typed = typedTextOf(body.item.text);
        if (typed.framed) body = { ...body, item: { ...body.item, text: typed.text, framed: true } };
      }
      // A question it waited on, settled: Codex's own history leaves it out, so the link keeps it for the next read.
      if (body.item.kind === 'question' && body.item.via === 'ask' && body.item.status !== 'running' && live.agent === 'codex') {
        const entry = { turnId: body.turnId, item: body.item };
        changeCodeSession(live.linkId, (link) => { link.answered = [...(link.answered ?? []).filter((e) => e.item.id !== entry.item.id), entry].slice(-20); });
      }
      break;
    case 'item-started':
      if (body.item.kind === 'user') {
        const typed = typedTextOf(body.item.text);
        if (typed.framed) body = { ...body, item: { ...body.item, text: typed.text, framed: true } };
      }
      noteLengths(live, body.turnId, body.item, false);
      break;
    case 'item-updated':
      noteLengths(live, body.turnId, body.item, false);
      break;
    case 'title-changed': {
      const { title } = body;
      changeCodeSession(live.linkId, (link) => { if (link.title === title) return false; link.title = title; });
      break;
    }
    case 'usage-changed':
      if (body.tokens) live.tokens = body.tokens;
      break;
    default:
      break;
  }
  push(live, body);
  settle(live);
}

/** Joins the session on the connection that is up, so its events come here, and learns whether a turn runs. */
function join(live: Live): Promise<void> {
  live.joining ??= joinNow(live).finally(() => { live.joining = null; });
  return live.joining;
}

async function joinNow(live: Live): Promise<void> {
  const c = await ready(live.agent, live.host);
  if (live.joined && c.up) return;
  const result = await c.adapter.resume(live.sessionId);
  live.joined = true;
  live.native = result.state;
  if (result.turnId) live.turnId = result.turnId;
  else if (live.turnId) {
    // The turn it was on ended while nobody was listening: what it said is in the history.
    live.turnId = null;
    ingest(live, { type: 'reset', reason: 'the turn ended while the Journal was away' });
  }
  settle(live);
}

// ---- What the routes ask.

export async function agentStatus(agent: AgentKind, host: string): Promise<AgentStatus> {
  const c = conn(agent, host);
  if (!c) return { agent, host, state: 'unavailable', reason: UNAVAILABLE[agent] ?? `${AGENT_LABEL[agent]} is not available.` };
  if (c.status && Date.now() - c.status.at < STATUS_TTL_MS) return c.status.status;
  const status = await c.adapter.status();
  if (status.state === 'offline') c.reason = status.reason ?? 'offline';
  if (!status.limits && c.limits) status.limits = c.limits;
  c.status = { at: Date.now(), status };
  return status;
}

/** What the agent's own settings come to on that device, for sessions in `cwd`: what the `own` mode runs with. */
export async function agentOwnSettings(agent: AgentKind, host: string, cwd?: string): Promise<OwnSettings> {
  const c = await ready(agent, host);
  try {
    return await c.adapter.ownSettings(cwd);
  } catch (error) {
    throw new HubError(502, `${AGENT_LABEL[agent]} did not say what its own settings are: ${message(error)}`);
  }
}

// ---- Signing in to an agent on a device. Only in memory: the link and code go to his page and nowhere else.

const ended = (login: AgentLogin) => login.state === 'done' || login.state === 'failed' || login.state === 'cancelled';

/** An agent's error as the route's status: the bridge's bad input is 400, gone 404; anything else 502. */
function loginError(agent: AgentKind, what: string, error: unknown): HubError {
  if (error instanceof HubError) return error;
  if (error instanceof RpcError && error.code === -32602) return new HubError(400, error.message);
  if (error instanceof RpcError && error.code === -32004) return new HubError(404, error.message);
  return new HubError(502, `${AGENT_LABEL[agent]} ${what}: ${message(error)}`);
}

/** The sign-in on that device as the pane shows it: the one running, or one that ended a moment ago. */
export function agentLogin(agent: AgentKind, host: string, now = Date.now()): AgentLogin | null {
  const c = hub.conns.get(connKey(agent, host));
  const login = c?.login;
  if (!c || !login) return null;
  if (ended(login)) {
    if (now - (login.endedAt ?? now) > LOGIN_SHOWN_MS) { c.login = null; return null; }
    return { ...login };
  }
  if (now - login.startedAt > LOGIN_STALE_MS) {
    void c.adapter.loginCancel(login.id).catch(() => {});
    c.login = { ...login, state: 'failed', endedAt: now, error: 'The sign-in took too long. Start again when you are ready.' };
    return { ...c.login };
  }
  return { ...login };
}

/** Starts signing in on that device, or gives the sign-in already running. Refused when the agent is signed in already. */
export async function startLogin(agent: AgentKind, host: string): Promise<AgentLogin> {
  const c = await ready(agent, host);
  const running = agentLogin(agent, host);
  if (running && !ended(running)) return running;
  if (c.loginStarting) return c.loginStarting;
  c.loginStarting = (async () => {
    c.status = null;
    const status = await agentStatus(agent, host);
    if (status.state === 'ready') throw new HubError(409, `${AGENT_LABEL[agent]} is signed in on ${host} already.`);
    let started;
    try { started = await c.adapter.loginStart(); } catch (error) { throw loginError(agent, 'could not start signing in', error); }
    c.login = { id: started.loginId, agent, host, method: started.method, state: 'waiting', url: started.url, ...(started.code ? { code: started.code } : {}), startedAt: Date.now(), endedAt: null };
    return { ...c.login };
  })();
  try { return await c.loginStarting; } finally { c.loginStarting = null; }
}

/** The code he pasted from the sign-in page (Claude Code). It goes to the agent and is kept nowhere. */
export async function sendLoginCode(agent: AgentKind, host: string, loginId: string, code: string): Promise<AgentLogin> {
  const c = await ready(agent, host);
  const login = c.login;
  if (!login || login.id !== loginId || ended(login)) throw new HubError(404, 'That sign-in is no longer running. Start again.');
  if (login.method !== 'paste-code' || !c.adapter.loginCode) throw new HubError(400, `${AGENT_LABEL[agent]} takes no code here: finish signing in on its page.`);
  if (login.state !== 'waiting') throw new HubError(409, 'A code is being checked already.');
  try { await c.adapter.loginCode(loginId, code); } catch (error) { throw loginError(agent, 'did not take the code', error); }
  // Ended already (a wrong code fails at once): leave it as it ended.
  if (c.login?.id === loginId && c.login.state === 'waiting') c.login = { ...c.login, state: 'checking' };
  return { ...c.login! };
}

export async function cancelLogin(agent: AgentKind, host: string, loginId: string): Promise<AgentLogin> {
  const c = await ready(agent, host);
  const login = c.login;
  if (!login || login.id !== loginId) throw new HubError(404, 'That sign-in is no longer running.');
  if (ended(login)) return { ...login };
  try { await c.adapter.loginCancel(loginId); } catch (error) { throw loginError(agent, 'could not stop signing in', error); }
  if (c.login?.id === loginId && !ended(c.login)) c.login = { ...c.login, state: 'cancelled', endedAt: Date.now() };
  return { ...c.login! };
}

export async function agentModels(agent: AgentKind, host: string): Promise<ModelEntry[]> {
  const c = await ready(agent, host);
  return c.adapter.models();
}

/** The agent's own sessions for a folder, each saying which task it is already attached to, if any. */
export async function nativeSessions(agent: AgentKind, host: string, cwd: string): Promise<NativeSession[]> {
  const c = await ready(agent, host);
  const list = await c.adapter.listNative(cwd);
  const linked = new Map<string, string>();
  for (const [taskId, links] of Object.entries(readAllCodeSessions())) for (const l of links) if (l.agent === agent && l.host === host && !l.archived) linked.set(l.sessionId, taskId);
  return list.map((s) => (linked.has(s.sessionId) ? { ...s, linkedTo: linked.get(s.sessionId)! } : s));
}

const unread = (link: CodeSessionLink, state: SessionState) =>
  state === 'needs-you' || (!!link.settledAt && (!link.seenAt || link.settledAt > link.seenAt) && state !== 'working');

/** The task's sessions for the list, most recent first, with their live state. */
export function sessionSummaries(taskId: string, now = Date.now()): SessionSummary[] {
  return readCodeSessions(taskId)
    .filter((link) => !link.archived)
    .map((link) => {
      const live = hub.live.get(link.id);
      let state: SessionState = live ? live.state : link.lastState;
      // Not seen by this process, and its "working" is old: nobody is watching that turn.
      if (!live && (state === 'working' || state === 'needs-you') && (!link.workingSince || now - Date.parse(link.workingSince) > WORKING_STALE_MS)) state = 'idle';
      return { ...link, state, unread: unread(link, state), approvals: live?.approvals.size ?? 0 };
    })
    .sort((a, b) => (b.settledAt ?? b.touchedAt).localeCompare(a.settledAt ?? a.touchedAt));
}

/** Sessions the store says are busy, but this process has not heard from: joined behind the request, to find out. */
export function refreshTask(taskId: string): void {
  for (const link of readCodeSessions(taskId)) {
    if (link.archived || hub.live.has(link.id) || (link.lastState !== 'working' && link.lastState !== 'needs-you')) continue;
    if (!factoryOf(link.agent)) continue;
    const live = liveOf(link, taskId);
    live.turnId = null;
    void join(live).catch(() => settle(live));
  }
}

export interface SessionDetail {
  link: CodeSessionLink;
  turns: SessionTurn[];
  older: string | null;
  seq: number;
  state: SessionState;
  turnId: string | null;
  approvals: ApprovalRequest[];
  tokens: TokenUsage | null;
}

const unframe = (page: HistoryPage): HistoryPage => ({
  ...page,
  turns: page.turns.map((turn) => ({
    ...turn,
    items: turn.items.map((item) => {
      if (item.kind !== 'user') return item;
      const typed = typedTextOf(item.text);
      return typed.framed ? { ...item, text: typed.text, framed: true } : item;
    }),
  })),
});

/** One session's history, a page at a time (newest page first; `older` asks for the one before), and how it stands. */
export async function sessionDetail(linkId: string, cursor?: string | null): Promise<SessionDetail> {
  const { live, link } = liveOfLink(linkId);
  await join(live).catch((error) => { if (error instanceof HubError) throw error; throw new HubError(502, message(error)); });
  const c = await ready(live.agent, live.host);
  // Taken before the history is read: an event that comes in while it is read is in the replay from this seq (the
  // client opens the stream with it), and maybe in the history too. Replaying one the copy already has does no
  // harm: items are put whole by id, a turn's start and end set its status again, and a delta carries its offset,
  // so text it already has is not added twice (applyEvent).
  const seq = live.seq;
  let page: HistoryPage;
  try {
    page = unframe(await c.adapter.history(live.sessionId, cursor));
  } catch (error) {
    throw new HubError(502, `${AGENT_LABEL[live.agent]} could not read the session: ${message(error)}`);
  }
  const current = findCodeSession(linkId)?.link ?? link;
  return { link: current, ...withAnswered(page, current.answered), seq, state: live.state, turnId: live.turnId, approvals: [...live.approvals.values()], tokens: live.tokens };
}

/** The questions the link keeps, put back in their turns where the agent's history left them out, in time order. */
function withAnswered(page: HistoryPage, answered: CodeSessionLink['answered']): HistoryPage {
  if (!answered?.length) return page;
  return {
    ...page,
    turns: page.turns.map((turn) => {
      const mine = answered.filter((e) => e.turnId === turn.id && !turn.items.some((i) => i.id === e.item.id));
      if (!mine.length) return turn;
      const items = turn.items.slice();
      for (const { item } of mine) {
        const when = item.startedAt ?? item.endedAt;
        const at = when ? items.findIndex((i) => (i.startedAt ?? 0) > when) : -1;
        items.splice(at >= 0 ? at : items.length, 0, item);
      }
      return { ...turn, items };
    }),
  };
}

/** Starts a session for a task and sends its first turn behind the answer. Returns the new link. */
export async function startSession(input: { taskId: string; agent: AgentKind; place: Place; text: string; picks: SessionPicks; brief: TaskBrief | null }): Promise<CodeSessionLink> {
  const c = await ready(input.agent, input.place.host);
  const title = clipLine(input.text, TITLE_MAX) || 'New session';
  let started: { sessionId: string; title: string };
  try {
    started = await c.adapter.start({ cwd: input.place.cwd, picks: input.picks, title });
  } catch (error) {
    throw new HubError(502, `${AGENT_LABEL[input.agent]} could not start a session: ${message(error)}`);
  }
  const at = nowIso();
  const link: CodeSessionLink = {
    id: newLinkId(), agent: input.agent, host: input.place.host, cwd: input.place.cwd, sessionId: started.sessionId,
    title: started.title || title, picks: input.picks, createdAt: at, touchedAt: at, seenAt: at, lastState: 'working', lastLine: '', workingSince: at,
  };
  mutateCodeSessions((all) => { (all[input.taskId] ??= []).push(link); });
  const live = liveOf(link, input.taskId);
  live.joined = true;
  live.sending = true;
  live.state = 'working';
  live.stored = { state: 'working', busy: true };
  // On another device 127.0.0.1 is that device: the session is told the Journal's tailnet address instead.
  const text = firstTurnText({ taskId: input.taskId, brief: input.brief, text: input.text, journal: journalOriginFor(isRemote(input.place.host)) });
  void c.adapter.send(started.sessionId, text, input.picks)
    .then(({ turnId }) => { if (live.sending) { live.sending = false; live.turnId ??= turnId; settle(live); } })
    .catch((error) => {
      live.sending = false;
      live.failed = `The first message could not be sent: ${message(error)}`;
      changeCodeSession(link.id, (l) => { l.lastLine = clipLine(live.failed!, LAST_LINE_MAX); });
      settle(live, live.failed);
    });
  return link;
}

/** He writes in a session. A turn already running is steered instead, by the caller (steerSession). */
export async function sendToSession(linkId: string, text: string, picks?: SessionPicks, options?: { trigger?: string }): Promise<{ turnId: string }> {
  const { live, link } = liveOfLink(linkId);
  if (live.turnId || live.sending) throw new HubError(409, `${AGENT_LABEL[live.agent]} is still working. Steer it, or stop it first.`);
  const c = await ready(live.agent, live.host);
  const use = picks ?? link.picks;
  live.sending = true;
  live.failed = null;
  settle(live);
  const at = nowIso();
  changeCodeSession(linkId, (l) => { l.touchedAt = at; l.seenAt = at; if (picks) l.picks = picks; });
  try {
    const { turnId } = await c.adapter.send(live.sessionId, text, use, options);
    live.joined = true;
    if (live.sending) { live.sending = false; live.turnId ??= turnId; }
    settle(live);
    return { turnId };
  } catch (error) {
    live.sending = false;
    settle(live);
    throw new HubError(502, `${AGENT_LABEL[live.agent]} did not take the message: ${message(error)}`);
  }
}

export async function steerSession(linkId: string, text: string): Promise<{ turnId: string }> {
  const { live } = liveOfLink(linkId);
  if (!live.turnId) throw new HubError(409, 'Nothing is running to steer. Send it as a new message.');
  const c = await ready(live.agent, live.host);
  changeCodeSession(linkId, (l) => { l.touchedAt = nowIso(); });
  try {
    return await c.adapter.steer(live.sessionId, live.turnId, text);
  } catch (error) {
    throw new HubError(502, `${AGENT_LABEL[live.agent]} could not take that while it works: ${message(error)}`);
  }
}

export async function interruptSession(linkId: string): Promise<void> {
  const { live } = liveOfLink(linkId);
  if (!live.turnId) throw new HubError(409, 'Nothing is running.');
  const c = await ready(live.agent, live.host);
  try {
    await c.adapter.interrupt(live.sessionId, live.turnId);
  } catch (error) {
    throw new HubError(502, `${AGENT_LABEL[live.agent]} could not be stopped: ${message(error)}`);
  }
}

export async function answerApproval(linkId: string, approvalId: string, decision: ApprovalDecision): Promise<void> {
  const { live } = liveOfLink(linkId);
  const approval = live.approvals.get(approvalId);
  if (!approval) throw new HubError(404, 'That approval is no longer waiting.');
  if (!approval.decisions.includes(decision)) throw new HubError(400, approval.elsewhere ? `Only the ${AGENT_LABEL[live.agent]} app can allow this.` : 'That answer is not one of the choices.');
  const c = await ready(live.agent, live.host);
  try {
    await c.adapter.answer(approvalId, decision);
  } catch (error) {
    // Answered meanwhile (a second press, another window, the agent's own app): the same answer as one already gone.
    if (error instanceof ApprovalGoneError || !live.approvals.has(approvalId)) throw new HubError(404, 'That approval is no longer waiting.');
    throw new HubError(502, `The answer did not reach ${AGENT_LABEL[live.agent]}: ${message(error)}`);
  }
}

/** His answers to a question the agent waits on (an approval of kind 'question'). */
export async function answerQuestion(linkId: string, approvalId: string, answers: QuestionAnswers): Promise<void> {
  const { live } = liveOfLink(linkId);
  const approval = live.approvals.get(approvalId);
  if (!approval) throw new HubError(404, 'That question is no longer waiting.');
  if (approval.kind !== 'question' || !approval.questions) throw new HubError(400, 'That is not a question.');
  const known = new Set(approval.questions.map((q) => q.id));
  if (Object.keys(answers).some((id) => !known.has(id))) throw new HubError(400, 'That answers a question it did not ask.');
  for (const q of approval.questions) {
    const a = answers[q.id];
    if (!a) continue;
    if (!q.multi && a.picked.length > 1) throw new HubError(400, 'That question takes one answer.');
    if (a.picked.some((label) => !q.options.some((o) => o.label === label))) throw new HubError(400, 'That is not one of its choices.');
    if (a.other?.trim() && !q.other) throw new HubError(400, 'That question takes one of its choices only.');
  }
  const c = await ready(live.agent, live.host);
  try {
    await c.adapter.answerQuestion(approvalId, answers);
  } catch (error) {
    if (error instanceof ApprovalGoneError || !live.approvals.has(approvalId)) throw new HubError(404, 'That question is no longer waiting.');
    throw new HubError(502, `The answer did not reach ${AGENT_LABEL[live.agent]}: ${message(error)}`);
  }
}

/**
 * His answer to a question the agent asked without waiting (Codex's async question): sent as the message the agent's
 * own app sends for it, as a new turn, or into the turn that runs.
 */
export async function replyToQuestion(linkId: string, itemId: string, entries: QuestionReplyEntry[]): Promise<{ turnId: string }> {
  const { live } = liveOfLink(linkId);
  const c = await ready(live.agent, live.host);
  if (!c.adapter.questionReply) throw new HubError(400, `${AGENT_LABEL[live.agent]} does not ask questions that way.`);
  const { text, trigger } = c.adapter.questionReply(itemId, entries);
  if (live.turnId) return steerSession(linkId, text);
  return sendToSession(linkId, text, undefined, trigger ? { trigger } : undefined);
}

export async function renameSession(linkId: string, title: string): Promise<CodeSessionLink> {
  const { live } = liveOfLink(linkId);
  const c = await ready(live.agent, live.host);
  try { await c.adapter.rename(live.sessionId, title); } catch (error) { throw new HubError(502, `${AGENT_LABEL[live.agent]} could not rename it: ${message(error)}`); }
  changeCodeSession(linkId, (l) => { l.title = title; });
  push(live, { type: 'title-changed', title });
  return findCodeSession(linkId)!.link;
}

/** Archives the session in the agent too, and takes it off the task's list. */
export async function archiveSession(linkId: string): Promise<void> {
  const { live } = liveOfLink(linkId);
  if (live.turnId || live.sending) throw new HubError(409, 'Stop it before you archive it.');
  const c = await ready(live.agent, live.host);
  try { await c.adapter.archive(live.sessionId); } catch (error) { throw new HubError(502, `${AGENT_LABEL[live.agent]} could not archive it: ${message(error)}`); }
  changeCodeSession(linkId, (l) => { l.archived = true; l.lastState = 'idle'; l.workingSince = null; });
}

/** Attaches one of the agent's own sessions to the task. */
export async function adoptSession(input: {
  taskId: string; agent: AgentKind; host: string; sessionId: string; picks: SessionPicks;
  /** Why its folder is not a place a session may run, or null. */
  allow?: (cwd: string) => string | null;
  /** Its folder as the link keeps it (another device's as `~/…`, as its proj file writes it). */
  placeCwd?: (cwd: string) => string;
}): Promise<CodeSessionLink> {
  for (const [taskId, links] of Object.entries(readAllCodeSessions())) {
    const have = links.find((l) => l.agent === input.agent && l.host === input.host && l.sessionId === input.sessionId && !l.archived);
    if (have) {
      if (taskId === input.taskId) return have;
      throw new HubError(409, 'That session is already attached to another task.');
    }
  }
  const c = await ready(input.agent, input.host);
  let resumed;
  try { resumed = await c.adapter.resume(input.sessionId); } catch (error) { throw new HubError(502, `${AGENT_LABEL[input.agent]} could not open that session: ${message(error)}`); }
  const refused = input.allow ? input.allow(resumed.cwd ?? '') : null;
  if (refused) throw new HubError(400, refused);
  const at = nowIso();
  const link: CodeSessionLink = {
    id: newLinkId(), agent: input.agent, host: input.host, cwd: input.placeCwd ? input.placeCwd(resumed.cwd ?? '') : resumed.cwd ?? '', sessionId: input.sessionId,
    title: resumed.title || 'Untitled', picks: input.picks, createdAt: at, touchedAt: at, seenAt: at, lastState: 'idle', lastLine: '', adopted: true,
  };
  mutateCodeSessions((all) => { (all[input.taskId] ??= []).push(link); });
  const live = liveOf(link, input.taskId);
  live.joined = true;
  live.native = resumed.state;
  live.turnId = resumed.turnId;
  settle(live);
  return findCodeSession(link.id)!.link;
}

export function setSessionPicks(linkId: string, picks: SessionPicks): CodeSessionLink {
  if (!changeCodeSession(linkId, (l) => { l.picks = picks; })) throw new HubError(404, 'That session is gone.');
  return findCodeSession(linkId)!.link;
}

export function markSessionSeen(linkId: string): CodeSessionLink {
  if (!changeCodeSession(linkId, (l) => { l.seenAt = nowIso(); })) throw new HubError(404, 'That session is gone.');
  return findCodeSession(linkId)!.link;
}

// ---- The stream.

/** Where a client is in each session's stream: "linkId:seq,linkId:seq". */
export function parseAfter(raw: string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const part of (raw ?? '').split(',')) {
    const at = part.lastIndexOf(':');
    if (at <= 0) continue;
    const seq = Number(part.slice(at + 1));
    if (Number.isSafeInteger(seq) && seq >= 0) out.set(part.slice(0, at), seq);
  }
  return out;
}

/**
 * Streams a task's session events to `send`: first what each session the client names has had since its seq
 * (or a reset, when the log no longer reaches back that far or the seq is from before this server started), then
 * everything live. The task's sessions are joined so their events flow. Returns the unsubscribe.
 */
export function subscribeTask(taskId: string, after: Map<string, number>, send: Subscriber): () => void {
  const links = readCodeSessions(taskId).filter((l) => !l.archived);
  for (const link of links) {
    const live = liveOf(link, taskId);
    const from = after.get(link.id);
    if (from === undefined) continue;
    const first = live.log[0]?.seq ?? live.seq + 1;
    if (from > live.seq || from < first - 1) {
      send({ type: 'reset', reason: 'the stream lost its place', seq: live.seq, session: live.linkId, at: Date.now() });
      continue;
    }
    for (const event of live.log) if (event.seq > from) send(event);
  }
  let set = hub.subscribers.get(taskId);
  if (!set) hub.subscribers.set(taskId, (set = new Set()));
  set.add(send);
  for (const link of links) {
    if (!factoryOf(link.agent)) continue;
    const live = hub.live.get(link.id)!;
    void join(live).catch(() => {
      const c = hub.conns.get(connKey(live.agent, live.host));
      settle(live);
      if (c && !c.up) reconnectLater(c);
    });
  }
  return () => {
    set!.delete(send);
    if (set!.size === 0) hub.subscribers.delete(taskId);
  };
}

/** For the tests: what the hub holds about one session. */
export function liveSnapshot(linkId: string): { state: SessionState; turnId: string | null; seq: number; approvals: ApprovalRequest[]; log: SessionEvent[] } | null {
  const live = hub.live.get(linkId);
  return live ? { state: live.state, turnId: live.turnId, seq: live.seq, approvals: [...live.approvals.values()], log: [...live.log] } : null;
}
