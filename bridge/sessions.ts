// The Claude bridge's core: Claude Code sessions run through the Agent SDK, one live streaming query() per session,
// and what each connected client (the Journal) is told about them. It speaks the bridge protocol of
// docs/code-sessions-design.md ("How the Claude bridge slots in"), carrying the Journal's own shapes (protocol.ts).
// The SDK is passed in (deps.sdk), so the tests run it against a stand-in.
//
// Rules it keeps:
//   - One live query per session, behind a per-session lock. A query is opened on the first turn (a new session
//     with its id, an existing one with `resume`) and let go after a quiet spell; the next turn resumes it.
//   - Picks (model, effort, permission mode) go in as query options; when they change, the query is opened again.
//   - When the transcript changed since the bridge last wrote it (the session was continued in a Claude app), the
//     query is opened again with `resume` before the next turn, so the turn sees what was said there. Its size is
//     only the first sign: a change counts when the transcript ends with a message this bridge did not see.
//   - "Allow for this session" rules are kept with the session for as long as the bridge runs, and given to every
//     query opened for it again (they would be lost with the Claude Code process that was told them).
//   - A permission prompt waits under the bridge's own approval id until a client answers it or the turn ends. So do
//     Claude's questions (AskUserQuestion, answered with `question/answer`) and an MCP server's requests for input.
import { spawn, type ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import type { NativeState } from '../src/lib/code-agents/adapter.ts';
import type {
  AgentStatus, ApprovalDecision, ApprovalRequest, EventBody, LimitWindow, QuestionAnswers, SessionPicks, SessionTurn, TokenUsage, TurnStatus,
} from '../src/lib/code-agents/protocol.ts';
import { formContent, isApprovalDecision, isExplicitMode, isPermissionMode, PERMISSION_MAPPING } from '../src/lib/code-agents/protocol.ts';
import {
  approvalFor, askAnswers, DENY_MESSAGE, elicitationFor, historyTurns, isLimited, limitSummary, limitWindows, modelEntries, nativeSession, sessionRuleOptions, STOP_MESSAGE, TaskTracker, TurnBuilder,
} from './mapping.ts';
import type {
  ClaudeSdk, SdkCanUseToolOptions, SdkElicitationRequest, SdkElicitationResult, SdkMessage, SdkPermissionResult, SdkPermissionUpdate, SdkQuery, SdkQueryOptions, SdkUserInput,
} from './sdk-types.ts';

export const BRIDGE_VERSION = '0.3.0';
/**
 * 2: the `own` mode, `settings/own`, and signing in (`login/start`, `login/code`, `login/cancel`, `login/status`).
 * 3: questions: Claude's AskUserQuestion and MCP servers' requests for input come as approvals of kind 'question'
 * (with `questions`) or with a `link`, answered with `question/answer`; ExitPlanMode's plan as `plan`.
 */
export const BRIDGE_PROTOCOL = 3;
/** Said when he leaves Claude's questions unanswered from the Journal. */
const SKIP_MESSAGE = 'The user chose not to answer these questions from the Agentic Journal. Go on with your best judgment, or ask in your reply.';

/** JSON-RPC error codes the bridge answers with. -32001 (busy, try again) is the transport's own. */
export const BRIDGE_ERROR = {
  invalid: -32602,
  notFound: -32004,
  turnRunning: -32010,
  noTurn: -32011,
  failed: -32000,
} as const;

export class BridgeError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.code = code;
  }
}

export const SIGNED_OUT_REASON = 'Claude Code isn’t signed in on this device. Sign in here, or run `claude auth login` in a terminal.';

/** How long a sign-in may wait on him before `claude auth login` is stopped. */
export const LOGIN_MAX_MS = 10 * 60_000;
/** How long `claude auth login` may take to print where to sign in. */
const LOGIN_URL_WAIT_MS = 20_000;

/**
 * The environment `claude auth login` runs in: the sessions' own (already without CLAUDE_*, CLAUDECODE and
 * ANTHROPIC_*), without the deliberate token (a login is for this device's own), and with BROWSER set to `true`, so
 * no browser opens on the device: Claude Code honours BROWSER, and the link goes to the pane instead.
 */
export function loginEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  const out = { ...env };
  delete out.CLAUDE_CODE_OAUTH_TOKEN;
  out.BROWSER = 'true';
  return out;
}

/**
 * Where `claude auth login` says to sign in: the https link it prints after "visit:" (else the first https link),
 * once the whole of it has come (a space or line end after it), not part of it cut at a chunk's end.
 */
export function loginUrlOf(output: string): string | null {
  const found = /visit:\s*(https:\/\/\S+)\s/.exec(output) ?? /(https:\/\/\S+)\s/.exec(output);
  return found ? found[1]!.replace(/[)\].,;'"]+$/, '') : null;
}

/** A failure line from `claude auth login` fit to show: its last line, without links, and never the code he pasted. */
export function loginFailure(stderr: string, code: string | null): string {
  let line = stderr.trim().split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? '';
  if (code) line = line.split(code).join('…');
  line = line.replace(/https?:\/\/\S+/g, '(link)').slice(0, 240);
  return line;
}

/** A connected client. The server makes one per WebSocket connection. */
export interface BridgeClient {
  readonly id: number;
  notify(method: string, params: unknown): void;
}

export interface AuthInfo {
  loggedIn: boolean;
  authMethod?: string;
  subscriptionType?: string;
  apiKeySource?: string;
}

export interface BridgeDeps {
  sdk: ClaudeSdk;
  claudePath: string;
  /** The environment Claude Code runs in, already cleaned (see cleanChildEnv in claude-bridge.ts). */
  env: Record<string, string | undefined>;
  /** Whether Claude Code is signed in here (`claude auth status`). */
  authStatus(): Promise<AuthInfo>;
  /** The installed Claude Code's version, or null when it cannot be run. */
  version(): Promise<string | null>;
  /**
   * The folder of a session whose info has none (the SDK reads only the start of a transcript, and a long first
   * message can push the folder out of it). Default: none known.
   */
  findCwd?(sessionId: string): Promise<string | null>;
  /** How long a session's query may sit with nothing running before it is let go. Default 10 minutes. */
  idleMs?: number;
  /** How long an interrupted turn may take to end before its query is closed. Default 10 s. */
  interruptGraceMs?: number;
  /** How long a sign-in may wait (LOGIN_MAX_MS). For the tests. */
  loginMaxMs?: number;
  log?(line: string): void;
}

export interface Bridge {
  detach(client: BridgeClient): void;
  handle(client: BridgeClient, method: string, params: unknown): Promise<unknown>;
  /** Ends every query. Turns running end as failed. */
  close(): Promise<void>;
  /** For the tests: what the bridge holds. */
  snapshot(): { sessions: { id: string; live: boolean; turnId: string | null; approvals: number; subscribers: number }[] };
}

// ---- A push queue: the streaming prompt of one query.

interface PushQueue extends AsyncIterable<SdkUserInput> {
  push(message: SdkUserInput): void;
  end(): void;
}

function pushQueue(): PushQueue {
  const items: SdkUserInput[] = [];
  let wake: (() => void) | null = null;
  let done = false;
  return {
    push(message) { items.push(message); wake?.(); },
    end() { done = true; wake?.(); },
    async *[Symbol.asyncIterator]() {
      while (true) {
        while (items.length) yield items.shift()!;
        if (done) return;
        await new Promise<void>((resolve) => { wake = resolve; });
        wake = null;
      }
    },
  };
}

// ---- Sessions.

interface Held {
  request: ApprovalRequest;
  toolName: string;
  input: Record<string, unknown>;
  suggestions: SdkPermissionUpdate[];
  toolUseId: string | null;
  resolve(result: SdkPermissionResult): void;
  /** An MCP server's request for input: what its form wants back, and how it is settled. */
  elicitation?: { schema: unknown; done(result: SdkElicitationResult): void };
}

interface LiveTurn {
  id: string;
  builder: TurnBuilder;
  query: SdkQuery | null;
  interrupting: boolean;
  stopTimer: ReturnType<typeof setTimeout> | null;
}

interface Session {
  id: string;
  cwd: string;
  title: string | null;
  isNew: boolean;                      // started here and never run: no transcript yet
  query: SdkQuery | null;
  input: PushQueue | null;
  applied: SessionPicks | null;        // what the live query was opened with
  stderr: string;
  turn: LiveTurn | null;
  lastFailed: boolean;
  approvals: Map<string, Held>;
  subscribers: Set<BridgeClient>;
  idle: ReturnType<typeof setTimeout> | null;
  known: number | null;                // the transcript's size after the bridge last wrote it
  sizeCheck: Promise<void> | null;
  seen: Set<string>;                   // uuids of messages this bridge sent or heard in the session (its own writes)
  rules: SdkPermissionUpdate[];        // "allow for this session" answers, for queries opened again
  rulesPick: SessionPicks['mode'] | null;   // the mode picked when an answer moved the session's mode (setMode)
  tasks: TaskTracker | null;           // its task list (TaskCreate/TaskUpdate), across turns
  lock: Promise<unknown>;
  lastState: NativeState | null;
  tokens: TokenUsage;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const record = (value: unknown): Record<string, unknown> => (value && typeof value === 'object' ? value as Record<string, unknown> : {});

function readPicks(raw: unknown): SessionPicks {
  const p = record(raw);
  return {
    model: typeof p.model === 'string' && p.model.trim() ? p.model.trim() : null,
    effort: typeof p.effort === 'string' && p.effort.trim() ? p.effort.trim() : null,
    // A mode it cannot read is "edit freely", never its own settings (which can be full access).
    mode: isPermissionMode(p.mode) ? p.mode : 'auto-edit',
  };
}

/** One `claude auth login` the bridge runs for a client. The code he pastes is held only until it ends. */
interface Login {
  id: string;
  child: ChildProcess;
  owner: BridgeClient;
  state: 'waiting' | 'checking' | 'done' | 'failed' | 'cancelled';
  url: string | null;
  error?: string;
  pasted: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const samePicks = (a: SessionPicks | null, b: SessionPicks) => !!a && a.model === b.model && a.effort === b.effort && a.mode === b.mode;

function needString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || !value.trim()) throw new BridgeError(BRIDGE_ERROR.invalid, `${key} is missing.`);
  return value;
}

let approvalCounter = 0;

export function createBridge(deps: BridgeDeps): Bridge {
  const { sdk } = deps;
  const idleMs = deps.idleMs ?? 10 * 60_000;
  const graceMs = deps.interruptGraceMs ?? 10_000;
  const log = deps.log ?? ((line: string) => console.error(`claude-bridge: ${line}`));
  const sessions = new Map<string, Session>();
  const clients = new Set<BridgeClient>();
  const windows = new Map<string, LimitWindow & { rejected: boolean }>();
  let authCache: { at: number; info: AuthInfo } | null = null;
  let authFailedAt = 0;                 // a turn failed on sign-in; status says signed out until it is fixed
  let modelCache: { at: number; list: ReturnType<typeof modelEntries> } | null = null;
  let claudeVersion: string | null = null;
  let login: Login | null = null;                // the sign-in running now, or the last one (until another starts)
  const loginMaxMs = deps.loginMaxMs ?? LOGIN_MAX_MS;

  // ---- Telling clients.

  const notify = (session: Session, method: string, params: unknown) => {
    for (const client of session.subscribers) {
      try { client.notify(method, params); } catch (error) { log(`could not tell client ${client.id}: ${message(error)}`); }
    }
  };
  const emit = (session: Session, event: EventBody) => notify(session, 'session/event', { sessionId: session.id, event });

  const stateOf = (session: Session): NativeState => {
    if (session.approvals.size > 0) return 'needs-you';
    if (session.turn) return 'working';
    if (session.lastFailed) return 'failed';
    return 'idle';
  };
  const settle = (session: Session) => {
    const state = stateOf(session);
    if (state === session.lastState) return;
    session.lastState = state;
    notify(session, 'session/state', { sessionId: session.id, state });
  };

  const subscribe = (session: Session, client: BridgeClient) => {
    session.subscribers.add(client);
    clients.add(client);
  };

  const withLock = <T>(session: Session, work: () => Promise<T>): Promise<T> => {
    const run = session.lock.then(work, work);
    session.lock = run.catch(() => undefined);
    return run;
  };

  // ---- Sessions the bridge knows.

  const makeSession = (id: string, cwd: string, title: string | null, isNew: boolean, known: number | null): Session => {
    const session: Session = {
      id, cwd, title, isNew, query: null, input: null, applied: null, stderr: '', turn: null, lastFailed: false,
      approvals: new Map(), subscribers: new Set(), idle: null, known, sizeCheck: null, seen: new Set(), rules: [], rulesPick: null, tasks: null, lock: Promise.resolve(), lastState: null,
      tokens: { total: 0, input: 0, output: 0, contextWindow: null },
    };
    sessions.set(id, session);
    return session;
  };

  /** The session by id: one the bridge holds, or one Claude Code has on disk (any folder). */
  const sessionOf = async (id: string): Promise<Session> => {
    const have = sessions.get(id);
    if (have) return have;
    let info;
    try { info = await sdk.getSessionInfo(id); } catch (error) { throw new BridgeError(BRIDGE_ERROR.failed, `Claude Code could not read that session: ${message(error)}`); }
    if (!info) throw new BridgeError(BRIDGE_ERROR.notFound, 'Claude Code has no session with that id here.');
    const cwd = info.cwd || await deps.findCwd?.(id).catch(() => null);
    if (!cwd) throw new BridgeError(BRIDGE_ERROR.failed, 'Claude Code did not say which folder that session is in.');
    return sessions.get(id) ?? makeSession(id, cwd, info.customTitle || info.summary || null, false, info.fileSize ?? null);
  };

  /** Notes the transcript's size now, so a later change made elsewhere can be told from the bridge's own. */
  const noteSize = (session: Session) => {
    if (session.isNew) return;
    session.sizeCheck = sdk.getSessionInfo(session.id, { dir: session.cwd })
      .then((info) => { session.known = info?.fileSize ?? session.known; })
      .catch(() => undefined)
      .finally(() => { session.sizeCheck = null; });
  };

  const SEEN_MAX = 5000;
  const remember = (session: Session, uuid: string | undefined) => {
    if (!uuid) return;
    session.seen.add(uuid);
    if (session.seen.size > SEEN_MAX) session.seen.delete(session.seen.values().next().value!);
  };

  const changedElsewhere = async (session: Session): Promise<boolean> => {
    if (session.isNew || session.known === null) return false;
    if (session.sizeCheck) await session.sizeCheck;
    let size: number | undefined;
    try {
      size = (await sdk.getSessionInfo(session.id, { dir: session.cwd }))?.fileSize;
    } catch {
      return false;
    }
    if (typeof size !== 'number' || size === session.known) return false;
    // The size moved, but Claude Code itself writes to the transcript after a turn's result (a title, a summary),
    // sometimes after the size was noted. What tells is the messages: one at the end that this bridge never sent
    // nor heard was written by a Claude app. When they cannot be read, the query is opened again to be safe.
    try {
      const last = (await sdk.getSessionMessages(session.id, { dir: session.cwd })).at(-1)?.uuid;
      if (!last || session.seen.has(last)) { session.known = size; return false; }
    } catch { /* cannot tell: open it again */ }
    return true;
  };

  // ---- Queries.

  const closeQuery = (session: Session) => {
    const q = session.query;
    const input = session.input;
    session.query = null;
    session.input = null;
    session.applied = null;
    if (session.idle) { clearTimeout(session.idle); session.idle = null; }
    input?.end();
    try { q?.close(); } catch (error) { log(`closing a query failed: ${message(error)}`); }
  };

  /**
   * Thinking summaries, unless his settings turn them off. Run through the SDK, Claude Code asks for thinking
   * without its text (CLI 2.1.302 consults `showThinkingSummaries` only in its terminal; seen live: signed, empty
   * thinking blocks), which leaves the pane nothing to show while Claude thinks. `--thinking-display summarized`
   * asks for the text and leaves whether and how much it thinks as it was.
   */
  const thinkingArgs = async (cwd: string): Promise<{ extraArgs?: Record<string, string> }> => {
    if (sdk.resolveSettings) {
      try {
        const resolved = await sdk.resolveSettings({ cwd, settingSources: ['user', 'project', 'local'] });
        if (resolved.effective?.showThinkingSummaries === false) return {};
      } catch { /* cannot tell: ask for them */ }
    }
    return { extraArgs: { 'thinking-display': 'summarized' } };
  };

  const openQuery = async (session: Session, picks: SessionPicks) => {
    const input = pushQueue();
    const { permissionMode: ruleMode, ...rules } = sessionRuleOptions(session.rules);
    // "Allow for this session" on an edit moves the session's mode (acceptEdits); it holds while the pick it was
    // given under does.
    const mode = ruleMode && session.rulesPick === picks.mode && picks.mode !== 'full'
      ? { permissionMode: ruleMode }
      // Its own settings: no mode is given, so Claude Code starts as it would in his terminal (settings' defaultMode).
      : isExplicitMode(picks.mode) ? { permissionMode: PERMISSION_MAPPING[picks.mode]['claude-code'] } : {};
    const options: SdkQueryOptions = {
      cwd: session.cwd,
      ...(session.isNew ? { sessionId: session.id, ...(session.title ? { title: session.title } : {}) } : { resume: session.id }),
      pathToClaudeCodeExecutable: deps.claudePath,
      settingSources: ['user', 'project', 'local'],
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      ...mode,
      ...(picks.mode === 'full' ? { allowDangerouslySkipPermissions: true } : {}),
      ...(picks.model ? { model: picks.model } : {}),
      ...(picks.effort ? { effort: picks.effort } : {}),
      ...rules,
      ...await thinkingArgs(session.cwd),
      env: deps.env,
      canUseTool: (toolName, toolInput, opts) => canUseTool(session, toolName, toolInput, opts),
      // Claude's questions (AskUserQuestion) reach the Journal through canUseTool and are answered there; so are an
      // MCP server's forms and sign-in pages.
      onElicitation: (request, opts) => onElicitation(session, request, opts),
      includePartialMessages: true,
      stderr: (data) => { session.stderr = (session.stderr + data).slice(-2000); },
    };
    const q = sdk.query({ prompt: input, options });
    session.query = q;
    session.input = input;
    session.applied = picks;
    session.stderr = '';
    void pump(session, q);
    return q;
  };

  const pump = async (session: Session, q: SdkQuery) => {
    let failure: string | null = null;
    try {
      for await (const m of q) {
        try { onMessage(session, q, m); } catch (error) { log(`a message could not be handled: ${message(error)}`); }
      }
    } catch (error) {
      failure = message(error);
    }
    if (session.query === q) { session.query = null; session.input?.end(); session.input = null; session.applied = null; }
    const turn = session.turn;
    if (turn && turn.query === q) {
      const tail = session.stderr.trim().split('\n').pop();
      if (turn.interrupting) finishTurn(session, 'interrupted', null, false);
      else finishTurn(session, 'failed', failure ?? `Claude Code stopped before the turn finished${tail ? `: ${tail}` : '.'}`, false);
    }
    settle(session);
  };

  /** The turn running now; when Claude Code works without being asked (a queued message, a background task), one is begun. */
  const ensureTurn = (session: Session, q: SdkQuery | null, id?: string): LiveTurn => {
    if (session.turn) return session.turn;
    const turnId = id ?? crypto.randomUUID();
    const at = Date.now();
    const turn: LiveTurn = { id: turnId, builder: new TurnBuilder(turnId, session.cwd, at, (event) => emit(session, event), session.tasks ??= new TaskTracker()), query: q, interrupting: false, stopTimer: null };
    session.turn = turn;
    session.lastFailed = false;
    if (session.idle) { clearTimeout(session.idle); session.idle = null; }
    emit(session, { type: 'turn-started', turnId, at });
    settle(session);
    return turn;
  };

  const finishTurn = (session: Session, status: TurnStatus, error: string | null, limited: boolean) => {
    const turn = session.turn;
    if (!turn) return;
    if (turn.stopTimer) clearTimeout(turn.stopTimer);
    const at = Date.now();
    turn.builder.finish(status, error, limited, at);
    session.turn = null;
    session.lastFailed = status === 'failed';
    for (const [id, held] of session.approvals) {
      if (held.request.turnId !== turn.id) continue;
      session.approvals.delete(id);
      held.resolve({ behavior: 'deny', message: STOP_MESSAGE, interrupt: true });
      emit(session, { type: 'approval-resolved', approvalId: id, decision: null, by: 'elsewhere' });
    }
    emit(session, { type: 'turn-completed', turnId: turn.id, status, error, ...(limited ? { limited: true } : {}), at });
    settle(session);
    noteSize(session);
    if (session.query && idleMs > 0) {
      session.idle = setTimeout(() => {
        session.idle = null;
        void withLock(session, async () => { if (!session.turn && session.approvals.size === 0) closeQuery(session); });
      }, idleMs);
      session.idle.unref?.();
    }
  };

  const onMessage = (session: Session, q: SdkQuery, m: SdkMessage) => {
    if (session.isNew && m.session_id) session.isNew = false;
    if (m.type === 'user' || m.type === 'assistant') remember(session, m.uuid);
    const now = Date.now();
    switch (m.type) {
      case 'system': {
        if (m.subtype === 'init') {
          if (m.claude_code_version) claudeVersion = m.claude_code_version;
          if (m.apiKeySource && m.apiKeySource !== 'none') log(`warning: session ${session.id} runs on an API key (${m.apiKeySource}), not the subscription`);
        } else if (m.subtype === 'session_title_changed') {
          const title = typeof m.title === 'string' ? m.title : typeof m.session_title === 'string' ? m.session_title : '';
          if (title && title !== session.title) { session.title = title; emit(session, { type: 'title-changed', title }); }
        } else if (m.subtype === 'compact_boundary') {
          const turn = ensureTurn(session, q);
          turn.builder.notice(`compact-${now}`, 'info', 'The conversation was compacted to fit.', now);
        } else if (m.subtype === 'api_retry') {
          const turn = ensureTurn(session, q);
          turn.builder.notice(`retry-${turn.id}`, 'warning', 'Claude’s API had a problem; Claude Code is trying again.', now);
        }
        return;
      }
      case 'stream_event':
        if (m.parent_tool_use_id) return;
        ensureTurn(session, q, m.user_message_uuid).builder.stream(m.event, now);
        return;
      case 'assistant': {
        if (m.parent_tool_use_id) { session.turn?.builder.subagent(m.parent_tool_use_id, m); return; }
        const turn = ensureTurn(session, q, m.user_message_uuid);
        turn.builder.assistant(m, now);
        if (m.error === 'authentication_failed' || m.error === 'oauth_org_not_allowed') { authFailedAt = now; authCache = null; }
        return;
      }
      case 'user':
        if (m.parent_tool_use_id || !session.turn) return;
        session.turn.builder.toolResults(m.message?.content, m.tool_use_result, now);
        return;
      case 'result': {
        const turn = session.turn;
        if (!turn) return;
        const failed = m.is_error === true || (m.subtype !== undefined && m.subtype !== 'success');
        const status: TurnStatus = turn.interrupting ? 'interrupted' : failed ? 'failed' : 'done';
        const error = status === 'failed' ? turn.builder.apiError?.text || (typeof m.result === 'string' && m.result) || m.errors?.join('\n') || 'The turn failed.' : null;
        const usage = m.usage ?? {};
        const input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
        const output = usage.output_tokens ?? 0;
        if (input || output) {
          const contextWindow = Object.values(m.modelUsage ?? {}).find((u) => typeof u?.contextWindow === 'number')?.contextWindow ?? session.tokens.contextWindow;
          session.tokens = { total: session.tokens.total + input + output, input: session.tokens.input + input, output: session.tokens.output + output, contextWindow, lastTurn: input + output };
          emit(session, { type: 'usage-changed', tokens: session.tokens });
        }
        if (status === 'done') authFailedAt = 0;
        finishTurn(session, status, error, status === 'failed' && isLimited(turn.builder.apiError?.kind, error));
        return;
      }
      case 'rate_limit_event': {
        const found = m.rate_limit_info ? limitWindows(m.rate_limit_info) : [];
        if (!found.length) return;
        for (const w of found) windows.set(w.type, w);
        const limits = limitSummary(windows.values());
        for (const client of clients) { try { client.notify('account/limits', { limits }); } catch { /* gone */ } }
        return;
      }
      default:
        // auth_status, command_lifecycle, tool_progress, hook and task messages, ...: not shown.
        return;
    }
  };

  // ---- Permission prompts.

  const canUseTool = (session: Session, toolName: string, input: Record<string, unknown>, opts: SdkCanUseToolOptions): Promise<SdkPermissionResult> => new Promise((resolve) => {
    const turn = ensureTurn(session, session.query);
    const id = `ca${Date.now().toString(36)}${(approvalCounter++).toString(36)}`;
    const request: ApprovalRequest = { id, turnId: turn.id, itemId: opts.toolUseID ?? null, ...approvalFor(toolName, input, opts, session.cwd), at: Date.now() };
    let settled = false;
    const held: Held = {
      request, toolName, input, suggestions: opts.suggestions ?? [], toolUseId: opts.toolUseID ?? null,
      resolve: (result) => { if (settled) return; settled = true; resolve(result); },
    };
    session.approvals.set(id, held);
    opts.signal?.addEventListener('abort', () => {
      if (!session.approvals.delete(id)) return;
      held.resolve({ behavior: 'deny', message: STOP_MESSAGE });
      emit(session, { type: 'approval-resolved', approvalId: id, decision: session.turn?.interrupting ? 'cancel' : null, by: session.turn?.interrupting ? 'journal' : 'elsewhere' });
      settle(session);
    }, { once: true });
    emit(session, { type: 'approval-asked', approval: request });
    settle(session);
  });

  /** An MCP server asks for input: held like a permission prompt, answered as a question (a form) or allowed (a page). */
  const onElicitation = (session: Session, request: SdkElicitationRequest, opts: { signal: AbortSignal }): Promise<SdkElicitationResult> => new Promise((resolve) => {
    const turn = ensureTurn(session, session.query);
    const id = `ce${Date.now().toString(36)}${(approvalCounter++).toString(36)}`;
    const asked: ApprovalRequest = { id, turnId: turn.id, itemId: null, ...elicitationFor(request), at: Date.now() };
    let settled = false;
    const done = (result: SdkElicitationResult) => { if (settled) return; settled = true; resolve(result); };
    const held: Held = {
      request: asked, toolName: `mcp:${request.serverName}`, input: {}, suggestions: [], toolUseId: null,
      // Ended as a prompt is (the turn's end, Stop): declined, or cancelled when the turn is being stopped.
      resolve: (result) => done(result.behavior === 'allow' ? { action: 'accept' } : { action: result.interrupt ? 'cancel' : 'decline' }),
      elicitation: { schema: request.requestedSchema, done },
    };
    session.approvals.set(id, held);
    opts.signal?.addEventListener('abort', () => {
      if (!session.approvals.delete(id)) return;
      done({ action: 'cancel' });
      emit(session, { type: 'approval-resolved', approvalId: id, decision: null, by: 'elsewhere' });
      settle(session);
    }, { once: true });
    emit(session, { type: 'approval-asked', approval: asked });
    settle(session);
  });

  /** His answers to a question: Claude's (AskUserQuestion, allowed with them) or an MCP server's form (accepted with them). */
  const answerQuestion = (approvalId: string, answers: QuestionAnswers) => {
    for (const session of sessions.values()) {
      const held = session.approvals.get(approvalId);
      if (!held) continue;
      const questions = held.request.questions;
      if (!questions) throw new BridgeError(BRIDGE_ERROR.invalid, 'That is not a question.');
      session.approvals.delete(approvalId);
      if (held.elicitation) held.elicitation.done({ action: 'accept', content: formContent(held.elicitation.schema, questions, answers) });
      else held.resolve({ behavior: 'allow', updatedInput: { ...held.input, answers: askAnswers(questions, answers) } });
      emit(session, { type: 'approval-resolved', approvalId, decision: 'allow', by: 'journal' });
      settle(session);
      return;
    }
    throw new BridgeError(BRIDGE_ERROR.notFound, 'That question is no longer waiting.');
  };

  const answer = (approvalId: string, decision: ApprovalDecision) => {
    for (const session of sessions.values()) {
      const held = session.approvals.get(approvalId);
      if (!held) continue;
      if (!held.request.decisions.includes(decision)) throw new BridgeError(BRIDGE_ERROR.invalid, 'That answer is not one of the choices.');
      session.approvals.delete(approvalId);
      const turn = session.turn;
      if (decision === 'allow') {
        // Leaving plan mode leaves it for the session (CLI 2.1.302 goes to `default`), also for a query opened again
        // while plan is still the pick.
        if (held.toolName === 'ExitPlanMode' && session.applied?.mode === 'plan') {
          session.rules = session.rules.filter((r) => r.type !== 'setMode');
          session.rules.push({ type: 'setMode', mode: 'default', destination: 'session' });
          session.rulesPick = 'plan';
        }
        held.resolve({ behavior: 'allow', updatedInput: held.input });
      }
      else if (decision === 'allow-session') {
        // Claude Code's own "don't ask again" rules, kept for this session only (never written to a settings file),
        // and kept here too, for the next query opened for it.
        const updates = held.suggestions.map((s) => ({ ...s, destination: 'session' }));
        for (const u of updates) if (!session.rules.some((r) => JSON.stringify(r) === JSON.stringify(u))) session.rules.push(u);
        if (updates.some((u) => u.type === 'setMode')) session.rulesPick = session.applied?.mode ?? null;
        held.resolve({ behavior: 'allow', updatedInput: held.input, updatedPermissions: updates });
      } else {
        if (held.toolUseId) turn?.builder.declined.add(held.toolUseId);
        if (decision === 'cancel' && turn) { turn.interrupting = true; turn.builder.stopping = true; }
        const skipped = held.toolName === 'AskUserQuestion' ? SKIP_MESSAGE : DENY_MESSAGE;
        held.resolve(decision === 'cancel' ? { behavior: 'deny', message: STOP_MESSAGE, interrupt: true } : { behavior: 'deny', message: skipped });
      }
      emit(session, { type: 'approval-resolved', approvalId, decision, by: 'journal' });
      settle(session);
      return;
    }
    throw new BridgeError(BRIDGE_ERROR.notFound, 'That approval is no longer waiting.');
  };

  // ---- Status and models.

  const auth = async (): Promise<AuthInfo> => {
    if (authCache && Date.now() - authCache.at < 30_000) return authCache.info;
    const info = await deps.authStatus();
    authCache = { at: Date.now(), info };
    return info;
  };

  const status = async (): Promise<AgentStatus> => {
    const version = claudeVersion ?? await deps.version().catch(() => null);
    if (!version) return { agent: 'claude-code', host: os.hostname(), state: 'offline', reason: `Claude Code can’t be run here (${deps.claudePath}).` };
    claudeVersion = version;
    let info: AuthInfo;
    try { info = await auth(); } catch (error) { return { agent: 'claude-code', host: os.hostname(), state: 'offline', reason: `Claude Code did not say who is signed in: ${message(error)}`, version }; }
    // A turn that failed on sign-in wins over a status read before it, or within a moment of it.
    const failedSince = authFailedAt && (!authCache || authCache.at < authFailedAt + 30_000);
    if (!info.loggedIn || failedSince) return { agent: 'claude-code', host: os.hostname(), state: 'signed-out', reason: SIGNED_OUT_REASON, version };
    const apiKey = (info.apiKeySource && info.apiKeySource !== 'none') || /api.?key/i.test(info.authMethod ?? '');
    const out: AgentStatus = {
      agent: 'claude-code', host: os.hostname(), state: 'ready', version,
      account: apiKey ? { kind: 'api-key' } : { kind: 'subscription', ...(info.subscriptionType ? { plan: info.subscriptionType } : {}) },
    };
    if (windows.size) out.limits = limitSummary(windows.values());
    return out;
  };

  /** Claude Code's models, read from a short query that runs no turn. */
  const models = async () => {
    if (modelCache && Date.now() - modelCache.at < 10 * 60_000) return modelCache.list;
    const input = pushQueue();
    const q = sdk.query({
      prompt: input,
      options: { cwd: os.homedir(), pathToClaudeCodeExecutable: deps.claudePath, settingSources: ['user', 'project', 'local'], env: deps.env, persistSession: false },
    });
    try {
      const list = await Promise.race([
        q.supportedModels(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Claude Code took too long to list its models.')), 30_000).unref?.()),
      ]);
      modelCache = { at: Date.now(), list: modelEntries(list) };
      return modelCache.list;
    } finally {
      input.end();
      try { q.close(); } catch { /* already gone */ }
    }
  };

  // ---- Signing in: `claude auth login`, driven over plain pipes.
  //
  // Seen on CLI 2.1.302 without a terminal: it prints "Opening browser to sign in…", then "If the browser didn't
  // open, visit: <link>" and "Paste code here if prompted > " on stdout, listens on a local port for the browser's
  // own way back, and reads a pasted code from stdin. A wrong code: "Login failed: Request failed with status code
  // 400" on stderr, exit 1. Closing stdin does not end it; SIGTERM does. What it prints is never logged here.

  const loginView = (l: Login) => ({ loginId: l.id, state: l.state, ...(l.url ? { url: l.url } : {}), ...(l.error ? { error: l.error } : {}) });

  const endLogin = (l: Login, state: 'done' | 'failed' | 'cancelled', error?: string) => {
    if (l.state === 'done' || l.state === 'failed' || l.state === 'cancelled') return;
    l.state = state;
    if (error) l.error = error;
    l.pasted = null;
    if (l.timer) { clearTimeout(l.timer); l.timer = null; }
    if (l.child.exitCode === null && l.child.signalCode === null) { try { l.child.kill('SIGTERM'); } catch { /* gone */ } }
    const params = { loginId: l.id, success: state === 'done', ...(state === 'cancelled' ? { cancelled: true } : {}), ...(error ? { error } : {}) };
    for (const client of new Set([...clients, l.owner])) { try { client.notify('login/completed', params); } catch { /* gone */ } }
  };

  const startLogin = (client: BridgeClient): Promise<{ loginId: string; url: string }> => {
    if (login && (login.state === 'waiting' || login.state === 'checking') && login.url) {
      login.owner = client;
      return Promise.resolve({ loginId: login.id, url: login.url });
    }
    return new Promise((resolve, reject) => {
      let child: ChildProcess;
      try {
        child = spawn(deps.claudePath, ['auth', 'login', '--claudeai'], { env: loginEnv(deps.env) as NodeJS.ProcessEnv, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch (error) {
        reject(new BridgeError(BRIDGE_ERROR.failed, `Claude Code can’t be run here (${deps.claudePath}): ${message(error)}`));
        return;
      }
      const l: Login = { id: `cl${crypto.randomUUID()}`, child, owner: client, state: 'waiting', url: null, pasted: null, timer: null };
      login = l;
      let out = '';
      let err = '';
      let answered = false;
      const urlWait = setTimeout(() => {
        if (answered) return;
        answered = true;
        endLogin(l, 'failed', 'Claude Code did not say where to sign in.');
        reject(new BridgeError(BRIDGE_ERROR.failed, 'Claude Code did not say where to sign in.'));
      }, LOGIN_URL_WAIT_MS);
      urlWait.unref?.();
      child.stdout?.on('data', (data: Buffer) => {
        if (out.length < 64_000) out += data.toString('utf8');
        if (answered) return;
        const url = loginUrlOf(out);
        if (!url) return;
        answered = true;
        clearTimeout(urlWait);
        l.url = url;
        l.timer = setTimeout(() => endLogin(l, 'failed', 'The sign-in took too long, so it was stopped. Start again when you are ready.'), loginMaxMs);
        l.timer.unref?.();
        resolve({ loginId: l.id, url });
      });
      child.stderr?.on('data', (data: Buffer) => { if (err.length < 8000) err += data.toString('utf8'); });
      child.stdin?.on('error', () => { /* it ended first; its exit says how */ });
      child.on('error', (error) => {
        clearTimeout(urlWait);
        const why = `Claude Code can’t be run here (${deps.claudePath}): ${message(error)}`;
        endLogin(l, 'failed', why);
        if (!answered) { answered = true; reject(new BridgeError(BRIDGE_ERROR.failed, why)); }
      });
      child.on('exit', (code) => {
        clearTimeout(urlWait);
        const failure = loginFailure(err, l.pasted);
        if (!answered) {
          answered = true;
          endLogin(l, 'failed', failure || 'Claude Code stopped before it said where to sign in.');
          reject(new BridgeError(BRIDGE_ERROR.failed, l.error ?? 'Claude Code stopped before it said where to sign in.'));
          return;
        }
        if (l.state === 'cancelled' || l.state === 'failed' || l.state === 'done') return;
        if (code !== 0) {
          endLogin(l, 'failed', failure ? `Claude Code could not sign in (${failure}). Start again, and paste the code the page shows.` : 'Claude Code could not sign in. Start again, and paste the code the page shows.');
          return;
        }
        // Signed in, it says: the status is read anew to be sure, and a turn's old sign-in failure is forgotten.
        authCache = null;
        authFailedAt = 0;
        deps.authStatus()
          .then((info) => { authCache = { at: Date.now(), info }; endLogin(l, info.loggedIn ? 'done' : 'failed', info.loggedIn ? undefined : 'Claude Code finished, but it still says it is not signed in.'); })
          .catch((error) => endLogin(l, 'failed', `Claude Code finished, but its sign-in could not be checked: ${message(error)}`));
      });
    });
  };

  // ---- Requests.

  const turnHistory = async (session: Session): Promise<SessionTurn[]> => {
    let turns: SessionTurn[] = [];
    if (!session.isNew) {
      try { turns = historyTurns(await sdk.getSessionMessages(session.id, { dir: session.cwd }), session.cwd); } catch (error) { throw new BridgeError(BRIDGE_ERROR.failed, `Claude Code could not read the session: ${message(error)}`); }
    }
    const live = session.turn;
    if (live) {
      // The running turn as the bridge holds it (the transcript lags, and messages sent into it read there as turns of their own).
      const copy: SessionTurn = structuredClone(live.builder.turn);
      const at = turns.findIndex((t) => t.id === live.id);
      if (at >= 0) turns.splice(at, turns.length - at, copy);
      else turns.push(copy);
    }
    return turns;
  };

  const handlers: Record<string, (client: BridgeClient, params: Record<string, unknown>) => Promise<unknown>> = {
    async status() { return status(); },

    async models() { return { models: await models() }; },

    async 'sessions/list'(_client, params) {
      const cwd = needString(params, 'cwd');
      const limit = typeof params.limit === 'number' && params.limit > 0 ? Math.min(200, Math.floor(params.limit)) : 50;
      const list = await sdk.listSessions({ dir: cwd, limit, includeProgrammatic: false });
      return { sessions: list.filter((s) => !s.archived).sort((a, b) => b.lastModified - a.lastModified).map((s) => nativeSession(s, cwd)) };
    },

    async 'session/start'(client, params) {
      const cwd = needString(params, 'cwd');
      let stat: fs.Stats | null = null;
      try { stat = fs.statSync(cwd); } catch { /* checked below */ }
      if (!cwd.startsWith('/') || !stat?.isDirectory()) throw new BridgeError(BRIDGE_ERROR.invalid, `There is no folder ${cwd} here.`);
      const title = typeof params.title === 'string' && params.title.trim() ? params.title.trim() : null;
      const session = makeSession(crypto.randomUUID(), cwd, title, true, null);
      subscribe(session, client);
      return { sessionId: session.id, title: title ?? '' };
    },

    async 'session/resume'(client, params) {
      const session = await sessionOf(needString(params, 'sessionId'));
      subscribe(session, client);
      // Approvals still waiting reach a client that joins late (the Journal restarted while one waited).
      const waiting = [...session.approvals.values()].map((h) => h.request);
      if (waiting.length) setImmediate(() => { for (const approval of waiting) if (session.approvals.has(approval.id)) client.notify('session/event', { sessionId: session.id, event: { type: 'approval-asked', approval } }); });
      return { state: stateOf(session), turnId: session.turn?.id ?? null, title: session.title, cwd: session.cwd };
    },

    async 'session/history'(_client, params) {
      const session = await sessionOf(needString(params, 'sessionId'));
      const turns = await turnHistory(session);
      const limit = typeof params.limit === 'number' && params.limit > 0 ? Math.floor(params.limit) : 20;
      const cursor = typeof params.cursor === 'string' && /^\d+$/.test(params.cursor) ? Math.min(Number(params.cursor), turns.length) : turns.length;
      const start = Math.max(0, cursor - limit);
      return { turns: turns.slice(start, cursor), older: start > 0 ? String(start) : null };
    },

    async 'turn/send'(client, params) {
      const session = await sessionOf(needString(params, 'sessionId'));
      const text = needString(params, 'text');
      const picks = readPicks(params.picks);
      subscribe(session, client);
      return withLock(session, async () => {
        if (session.turn) throw new BridgeError(BRIDGE_ERROR.turnRunning, 'Claude Code is still working in this session. Steer it, or stop it first.');
        // A mode he picks now wins over one an earlier "allow for this session" moved the session to.
        if (session.rulesPick !== null && session.rulesPick !== picks.mode) {
          session.rules = session.rules.filter((r) => r.type !== 'setMode');
          session.rulesPick = null;
        }
        if (session.query && (!samePicks(session.applied, picks) || await changedElsewhere(session))) closeQuery(session);
        if (session.idle) { clearTimeout(session.idle); session.idle = null; }
        // The task list so far, so a turn that updates a task an earlier one made can name it.
        if (!session.tasks && !session.isNew) {
          const tasks = new TaskTracker();
          try { historyTurns(await sdk.getSessionMessages(session.id, { dir: session.cwd }), session.cwd, tasks); session.tasks = tasks; } catch { /* named by number until then */ }
        }
        const q = session.query ?? await openQuery(session, picks);
        const turnId = crypto.randomUUID();
        const turn = ensureTurn(session, q, turnId);
        turn.builder.user(turnId, text, Date.now());
        remember(session, turnId);
        session.input!.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '', uuid: turnId });
        return { turnId: turn.id };
      });
    },

    async 'turn/steer'(_client, params) {
      const session = await sessionOf(needString(params, 'sessionId'));
      const text = needString(params, 'text');
      const turn = session.turn;
      if (!turn || !session.input || turn.query !== session.query) throw new BridgeError(BRIDGE_ERROR.noTurn, 'Nothing is running to steer. Send it as a new message.');
      // Claude Code takes a message sent while it works into the turn at its next step, as its own apps do.
      const id = crypto.randomUUID();
      turn.builder.user(id, text, Date.now());
      remember(session, id);
      session.input.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, session_id: '', uuid: id });
      return { turnId: turn.id };
    },

    async 'turn/interrupt'(_client, params) {
      const session = await sessionOf(needString(params, 'sessionId'));
      const turn = session.turn;
      if (!turn) return {};
      turn.interrupting = true;
      turn.builder.stopping = true;
      for (const [id, held] of session.approvals) {
        if (held.request.turnId !== turn.id) continue;
        session.approvals.delete(id);
        if (held.toolUseId) turn.builder.declined.add(held.toolUseId);
        held.resolve({ behavior: 'deny', message: STOP_MESSAGE, interrupt: true });
        emit(session, { type: 'approval-resolved', approvalId: id, decision: 'cancel', by: 'journal' });
      }
      settle(session);
      const q = turn.query;
      if (!q) { finishTurn(session, 'interrupted', null, false); return {}; }
      try { await q.interrupt(); } catch (error) { log(`interrupt failed: ${message(error)}`); }
      // A turn that does not end soon after is ended by closing its query.
      if (session.turn === turn && !turn.stopTimer) {
        turn.stopTimer = setTimeout(() => { if (session.turn === turn) { closeQuery(session); finishTurn(session, 'interrupted', null, false); } }, graceMs);
        turn.stopTimer.unref?.();
      }
      return {};
    },

    async 'approval/answer'(_client, params) {
      const decision = params.decision;
      if (!isApprovalDecision(decision)) throw new BridgeError(BRIDGE_ERROR.invalid, 'decision must be allow, allow-session, deny or cancel.');
      answer(needString(params, 'approvalId'), decision);
      return {};
    },

    async 'question/answer'(_client, params) {
      const raw = params.answers;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BridgeError(BRIDGE_ERROR.invalid, 'answers must be an object.');
      const answers: QuestionAnswers = {};
      for (const [id, a] of Object.entries(raw as Record<string, unknown>)) {
        const picked = a && typeof a === 'object' && Array.isArray((a as { picked?: unknown }).picked) ? ((a as { picked: unknown[] }).picked).filter((p): p is string => typeof p === 'string') : [];
        const other = a && typeof a === 'object' && typeof (a as { other?: unknown }).other === 'string' ? (a as { other: string }).other : undefined;
        answers[id] = { picked, ...(other !== undefined ? { other } : {}) };
      }
      answerQuestion(needString(params, 'approvalId'), answers);
      return {};
    },

    async 'session/rename'(_client, params) {
      const session = await sessionOf(needString(params, 'sessionId'));
      const title = needString(params, 'title').trim();
      if (session.isNew) session.title = title;
      else await sdk.renameSession(session.id, title, { dir: session.cwd });
      session.title = title;
      emit(session, { type: 'title-changed', title });
      noteSize(session);
      return {};
    },

    async 'settings/own'(_client, params) {
      // permissions.defaultMode as Claude Code would take it here (a project's escalating mode dropped, as the CLI
      // does), for the picker's "your Claude Code settings". Null when the settings name none or the SDK cannot say.
      const cwd = typeof params.cwd === 'string' && params.cwd.startsWith('/') ? params.cwd : os.homedir();
      if (!sdk.resolveSettings) return { permissionMode: null };
      try {
        const resolved = await sdk.resolveSettings({ cwd, settingSources: ['user', 'project', 'local'] });
        const effective = sdk.filterEscalatingDefaultMode ? sdk.filterEscalatingDefaultMode(resolved) : resolved.effective;
        const mode = effective?.permissions?.defaultMode;
        return { permissionMode: typeof mode === 'string' ? mode : null };
      } catch (error) {
        log(`settings could not be read: ${message(error)}`);
        return { permissionMode: null };
      }
    },

    async 'login/start'(client) {
      return startLogin(client);
    },

    async 'login/code'(_client, params) {
      const loginId = needString(params, 'loginId');
      const raw = params.code;
      const code = typeof raw === 'string' ? raw.trim() : '';
      if (!code || code.length > 2000 || /[\u0000-\u001f\u007f]/.test(code)) throw new BridgeError(BRIDGE_ERROR.invalid, 'That is not a code from the sign-in page.');
      const l = login;
      if (!l || l.id !== loginId) throw new BridgeError(BRIDGE_ERROR.notFound, 'That sign-in is no longer running.');
      if (l.state !== 'waiting') throw new BridgeError(BRIDGE_ERROR.invalid, l.state === 'checking' ? 'A code is being checked already.' : 'That sign-in has ended.');
      if (!l.child.stdin || l.child.stdin.destroyed) throw new BridgeError(BRIDGE_ERROR.failed, 'Claude Code is not reading a code any more.');
      l.pasted = code;
      l.state = 'checking';
      l.child.stdin.write(`${code}\n`);
      return {};
    },

    async 'login/cancel'(_client, params) {
      const loginId = needString(params, 'loginId');
      const l = login;
      if (!l || l.id !== loginId) throw new BridgeError(BRIDGE_ERROR.notFound, 'That sign-in is no longer running.');
      endLogin(l, 'cancelled');
      return {};
    },

    async 'login/status'(_client, params) {
      const l = login;
      if (!l || (typeof params.loginId === 'string' && params.loginId !== l.id)) return { login: null };
      return { login: loginView(l) };
    },

    async 'session/archive'(_client, params) {
      const session = await sessionOf(needString(params, 'sessionId'));
      return withLock(session, async () => {
        if (session.turn) throw new BridgeError(BRIDGE_ERROR.turnRunning, 'Stop it before you archive it.');
        closeQuery(session);
        if (!session.isNew && sdk.archiveSession) await sdk.archiveSession(session.id, { dir: session.cwd });
        sessions.delete(session.id);
        return {};
      });
    },
  };

  return {
    detach(client) {
      clients.delete(client);
      for (const session of sessions.values()) session.subscribers.delete(client);
      // Nobody is left to show its link or take its code: the sign-in is stopped rather than left waiting.
      if (login && login.owner === client) endLogin(login, 'cancelled');
    },

    async handle(client, method, params) {
      const handler = handlers[method];
      if (!handler) throw new BridgeError(-32601, `The Claude bridge has no method ${method}.`);
      clients.add(client);
      return handler(client, record(params));
    },

    async close() {
      if (login) endLogin(login, 'cancelled');
      for (const session of sessions.values()) {
        if (session.turn) finishTurn(session, 'failed', 'The Claude bridge stopped.', false);
        closeQuery(session);
      }
    },

    snapshot() {
      return { sessions: [...sessions.values()].map((s) => ({ id: s.id, live: !!s.query, turnId: s.turn?.id ?? null, approvals: s.approvals.size, subscribers: s.subscribers.size })) };
    },
  };
}
