// What the hub needs from one agent on one host. The Codex adapter (codex.ts) implements it over Codex's app
// server; the Claude Code adapter will implement it over the Claude bridge. Everything agent-specific stays inside
// the adapter: the hub only sees the Journal's own model (protocol.ts), keyed by the agent's own session ids.
import type {
  AgentKind, AgentStatus, ApprovalDecision, EventBody, ModelEntry, NativeSession, OwnSettings, QuestionAnswers, RateLimitSummary, SessionPicks, SessionTurn,
} from './protocol';

/** How the agent itself describes a session's state, for turns the Journal did not start. */
export type NativeState = 'idle' | 'working' | 'needs-you' | 'failed' | 'not-loaded';

/** What an adapter tells the hub. Session ids are the agent's own. */
export interface AdapterSink {
  event(sessionId: string, body: EventBody): void;
  nativeState(sessionId: string, state: NativeState): void;
  limits(limits: RateLimitSummary): void;
  /** The connection to the agent is up, or went down (every approval on it is then lost). */
  connection(up: boolean, reason?: string): void;
  /** A sign-in this adapter started has ended. `error` never holds a code or a token. */
  login(update: LoginEnded): void;
}

/** A sign-in begun: where he signs in, and (device code) the code he enters there. Never logged. */
export interface LoginStarted {
  loginId: string;
  method: 'device-code' | 'paste-code';
  url: string;
  code?: string;
}

export interface LoginEnded {
  loginId: string;
  state: 'done' | 'failed' | 'cancelled';
  error?: string;
}

export interface StartInput {
  cwd: string;
  picks: SessionPicks;
  title: string;
}

export interface ResumeResult {
  state: NativeState;
  turnId: string | null;       // the turn running now, when one is
  title: string | null;
  cwd: string | null;
}

export interface HistoryPage {
  turns: SessionTurn[];        // oldest first
  older: string | null;        // cursor for the page before this one; null at the start
}

export interface AgentAdapter {
  readonly agent: AgentKind;
  readonly host: string;
  /** Connects when not connected. Rejects when the agent cannot be reached. */
  connect(): Promise<void>;
  readonly connected: boolean;
  close(): void;
  status(): Promise<AgentStatus>;
  models(): Promise<ModelEntry[]>;
  /** The agent's own sessions for a folder, most recent first. */
  listNative(cwd: string, limit?: number): Promise<NativeSession[]>;
  start(input: StartInput): Promise<{ sessionId: string; title: string }>;
  /** Joins a session so its events reach this connection. Needed before send on a session this connection has not joined. */
  resume(sessionId: string): Promise<ResumeResult>;
  history(sessionId: string, cursor?: string | null, limit?: number): Promise<HistoryPage>;
  /** `trigger`: what started the turn, when it is not a message he typed (his answer to a question). */
  send(sessionId: string, text: string, picks: SessionPicks, options?: { trigger?: string }): Promise<{ turnId: string }>;
  steer(sessionId: string, turnId: string, text: string): Promise<{ turnId: string }>;
  interrupt(sessionId: string, turnId: string): Promise<void>;
  /** Answers an approval this adapter asked for (by the approval's Journal id). Throws ApprovalGoneError when it is no longer waiting. */
  answer(approvalId: string, decision: ApprovalDecision): Promise<void>;
  /** Answers a question this adapter asked (an approval of kind 'question'), by the questions' ids. Throws ApprovalGoneError like `answer`. */
  answerQuestion(approvalId: string, answers: QuestionAnswers): Promise<void>;
  /**
   * The message that answers a question the agent asked without waiting (a 'question' item, via 'reply'), as the
   * agent's own app writes it, and what to say started its turn. Agents without such questions leave it out.
   */
  questionReply?(itemId: string, entries: QuestionReplyEntry[]): { text: string; trigger?: string };
  rename(sessionId: string, title: string): Promise<void>;
  archive(sessionId: string): Promise<void>;
  /** What the agent's own settings come to here (for sessions in `cwd`, when given): what mode `own` runs with. */
  ownSettings(cwd?: string): Promise<OwnSettings>;
  /** Starts signing in on this device. Its end comes through the sink's `login`. */
  loginStart(): Promise<LoginStarted>;
  /** The code he pasted from the sign-in page (paste-code only). */
  loginCode?(loginId: string, code: string): Promise<void>;
  loginCancel(loginId: string): Promise<void>;
}

/** One answer to a question asked without waiting: which question (its id in the item), its words, the answer. */
export interface QuestionReplyEntry {
  questionId: string;
  question: string;
  answer: string;
}

export interface AdapterConfig {
  host: string;
  sink: AdapterSink;
}

export type AdapterFactory = (config: AdapterConfig) => AgentAdapter;

/** An approval that was answered already (here, twice; or elsewhere) or ended with its turn. */
export class ApprovalGoneError extends Error {
  constructor(message = 'That approval is no longer waiting.') {
    super(message);
    this.name = 'ApprovalGoneError';
  }
}
