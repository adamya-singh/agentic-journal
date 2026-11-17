// The Journal's own model of a coding-agent session (Codex, Claude Code), the same whichever agent runs it: the
// session as the Journal links it to a task, its turns and items, approvals, state, usage, models and picks, and the
// events the stream sends. The hub, the routes, the stream, the browser and (later) the Claude bridge share it.
// Plain JSON only, no classes; pure, with no node imports, so the browser can import it.
// docs/code-sessions-design.md describes it in full.

export type AgentKind = 'codex' | 'claude-code';
export const AGENT_KINDS: readonly AgentKind[] = ['codex', 'claude-code'];
export const AGENT_LABEL: Record<AgentKind, string> = { codex: 'Codex', 'claude-code': 'Claude Code' };

export const isAgentKind = (value: unknown): value is AgentKind => value === 'codex' || value === 'claude-code';

/**
 * idle: nothing is running. working: a turn is running. needs-you: a turn waits on an approval. failed: the last
 * turn failed (until the next one starts). offline: the agent cannot be reached just now.
 */
export type SessionState = 'idle' | 'working' | 'needs-you' | 'failed' | 'offline';

// ---- Picks: what a session runs with.

/**
 * How much the agent may do without asking. `own` (the default) is the agent's own settings on that device: the
 * Journal says nothing about permissions, so the session runs as it would started in the agent's own app (Codex's
 * config.toml, Claude Code's settings). The other four are the same steps for every agent:
 * ask (asks before anything that is not plainly safe), auto-edit (edits files in its folder, asks for the rest),
 * plan (reads and plans, changes nothing), full (does anything without asking). How each agent maps them is in
 * PERMISSION_MAPPING and in the design doc.
 */
export type PermissionMode = 'own' | 'ask' | 'auto-edit' | 'plan' | 'full';
/** A mode the Journal sets itself, rather than leaving it to the agent's own settings. */
export type ExplicitMode = Exclude<PermissionMode, 'own'>;
export const PERMISSION_MODES: readonly PermissionMode[] = ['own', 'ask', 'auto-edit', 'plan', 'full'];
export const isPermissionMode = (value: unknown): value is PermissionMode => typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
export const isExplicitMode = (mode: PermissionMode): mode is ExplicitMode => mode !== 'own';

export const PERMISSION_LABEL: Record<PermissionMode, string> = {
  own: 'Its own settings',
  ask: 'Ask first',
  'auto-edit': 'Edit freely',
  plan: 'Plan only',
  full: 'Full access',
};

/**
 * What "its own settings" comes to on a device, as the agent itself reports it, for the picker to say in words.
 * Codex: the effective `approval_policy` and `sandbox_mode` (config/read). Claude Code: `permissions.defaultMode`
 * from the settings it loads, when they name one. A value the agent does not report is null.
 */
export interface OwnSettings {
  approvalPolicy?: string | null;
  sandbox?: string | null;
  permissionMode?: string | null;
}

/** What each explicit mode means to each agent. Codex: approval policy and sandbox. Claude Code: its permission mode. */
export const PERMISSION_MAPPING: Record<ExplicitMode, { codex: { approvalPolicy: 'untrusted' | 'on-request' | 'never'; sandbox: 'read-only' | 'workspace-write' | 'danger-full-access' }; 'claude-code': 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions' }> = {
  ask: { codex: { approvalPolicy: 'untrusted', sandbox: 'workspace-write' }, 'claude-code': 'default' },
  'auto-edit': { codex: { approvalPolicy: 'on-request', sandbox: 'workspace-write' }, 'claude-code': 'acceptEdits' },
  plan: { codex: { approvalPolicy: 'on-request', sandbox: 'read-only' }, 'claude-code': 'plan' },
  full: { codex: { approvalPolicy: 'never', sandbox: 'danger-full-access' }, 'claude-code': 'bypassPermissions' },
};

/** Per session. model and effort are null for the agent's own default. */
export interface SessionPicks {
  model: string | null;
  effort: string | null;
  mode: PermissionMode;
}
export const DEFAULT_PICKS: SessionPicks = { model: null, effort: null, mode: 'own' };

/** One model an agent offers, with the efforts it can think at. */
export interface ModelEntry {
  id: string;
  label: string;
  description?: string;
  efforts: string[];
  defaultEffort: string | null;
  isDefault: boolean;
}

// ---- Where a session runs.

export interface Place {
  host: string;              // a `proj` host name; 'laptop' is this machine
  cwd: string;               // absolute on this machine; on another device as its `proj` file writes it (`~/projects/x`)
}

/** A device sessions can run on: this machine, or one the `proj` registry knows and ssh reaches by `alias`. */
export interface DeviceInfo {
  host: string;              // the `proj` host name: laptop, wsl, mac
  label: string;             // laptop, PC, Mac
  alias: string | null;      // how ssh reaches it (null for this machine, or a name ssh cannot use)
  here: boolean;             // this machine
}

/** What a read-only look over ssh found on a device (this machine: reachable, nothing else asked). */
export interface DeviceStatus {
  host: string;
  reachable: boolean;
  reason?: string;           // why it cannot be reached
  os?: string;               // uname -s: Linux, Darwin
  wsl?: boolean;
  // null: not installed there. home: its CODEX_HOME. bin: the Codex found when `codex` is not on its PATH (an app's
  // own copy, codex-bin.ts; `~/…` in the pane). server: the version its running daemon reports.
  codex?: { version: string | null; daemon: boolean; home?: string; bin?: string; server?: string } | null;
  claude?: { version: string | null; bridge: 'running' | 'installed' | 'missing' } | null;
  checkedAt?: number;
}

export interface PlaceChoice extends Place {
  label: string;
  kind: 'workspace' | 'project';
  project?: string;          // the `proj` project name
  available: boolean;        // a session can be started here now
  reason?: string;           // why not, when it cannot
}

// ---- The link from a task to a session. The transcript stays with the agent; this is only the link and a glance.

export interface CodeSessionLink {
  id: string;                // the Journal's own id for the link
  agent: AgentKind;
  host: string;
  cwd: string;
  sessionId: string;         // the agent's own id (a Codex thread id, a Claude session id)
  title: string;
  picks: SessionPicks;
  createdAt: string;         // ISO
  touchedAt: string;         // when he last did something in it (started it, wrote in it)
  seenAt: string | null;     // when he last had it open
  lastState: SessionState;
  lastLine: string;          // the last thing said, clipped, for the list
  workingSince?: string | null;  // set while a turn runs; the deploy queue reads it
  settledAt?: string | null;     // when the last turn ended
  /** The approval it waits on, while one waits: for the list and the sky, which cannot ask the hub. */
  asking?: { kind: ApprovalKind; title: string } | null;
  adopted?: boolean;        // attached from the agent's own list rather than started here
  archived?: boolean;
  /**
   * Questions it waited on and what he answered, kept for an agent whose own history leaves them out (Codex keeps a
   * request_user_input call only in its rollout file, not in thread/turns/list), so a page read anew still shows
   * them. The latest 20; a secret answer is never kept.
   */
  answered?: { turnId: string; item: Extract<SessionItem, { kind: 'question' }> }[];
}

/** A link as the list shows it: with its live state. */
export interface SessionSummary extends CodeSessionLink {
  state: SessionState;
  unread: boolean;           // a turn ended since he last looked, or it waits on him
  approvals: number;         // approvals waiting
}

/** One of the agent's own sessions for a folder, to attach to a task. */
export interface NativeSession {
  sessionId: string;
  title: string;
  preview: string;
  cwd: string;
  createdAt: number;         // ms
  updatedAt: number;         // ms
  source?: string;           // where the agent says it was started (cli, vscode, ...)
  linkedTo?: string;         // the task it is already attached to, when it is
}

// ---- Turns and items.

export type ItemStatus = 'running' | 'done' | 'failed' | 'declined';

interface ItemBase {
  id: string;
  startedAt?: number | null; // ms
  endedAt?: number | null;   // ms
}

export interface FileEdit {
  path: string;
  change: 'add' | 'delete' | 'update';
  movedTo?: string;
  diff: string;              // unified diff
}

export interface PlanStep {
  text: string;
  status: 'pending' | 'running' | 'done';
}

// ---- Questions the agent asks him (Codex's request_user_input and its async form, Claude Code's AskUserQuestion,
// an MCP server's form).

export interface QuestionOption {
  label: string;
  description?: string;
}

/**
 * One question, as the pane shows it: a choice of options (one, or several with `multi`), with a free-text answer
 * besides when `other` is set, or as the only way when there are no options.
 */
export interface AgentQuestion {
  id: string;                // how its answer goes back: Codex's id, the question's place in the list, a form field's name
  header?: string;           // a short chip ("Approach")
  question: string;
  options: QuestionOption[];
  multi?: boolean;           // several options may be chosen
  other?: boolean;           // a free-text answer may be given (Codex's "Other", the one Claude Code always adds)
  secret?: boolean;          // the answer is a secret: typed hidden, never shown back
  required?: boolean;        // a form field that must be filled
  input?: 'text' | 'number' | 'integer';   // what a free-text answer must be (a form's number field)
}

/** His answer to one question: the options he chose (by label), and what he wrote in "Other". */
export interface QuestionAnswer {
  picked: string[];
  other?: string;
}
export type QuestionAnswers = Record<string, QuestionAnswer>;

/** One answer as words: the options chosen, then what he wrote, joined (Claude Code's own way for a multi-select). */
export function answerText(answer: QuestionAnswer | undefined): string {
  if (!answer) return '';
  return [...answer.picked, answer.other?.trim() ?? ''].filter(Boolean).join(', ');
}

/** Whether every question that needs an answer has one. A question with options always needs one. */
export function answersComplete(questions: AgentQuestion[], answers: QuestionAnswers): boolean {
  return questions.every((q) => (q.options.length === 0 && !q.required) || answerText(answers[q.id]) !== '');
}

/**
 * An MCP server's form (`requestedSchema`, a flat JSON Schema object of strings, numbers, booleans and enums, as MCP
 * allows) as questions: an enum is a choice (an array of enums a multiple choice), a boolean Yes / No, a string or
 * number a free-text answer. Null when the form has a field the pane cannot ask for.
 */
export function formQuestions(schema: unknown): AgentQuestion[] | null {
  const s = schema && typeof schema === 'object' ? schema as { properties?: unknown; required?: unknown } : null;
  const props = s?.properties && typeof s.properties === 'object' ? s.properties as Record<string, unknown> : null;
  if (!props) return null;
  const required = new Set(Array.isArray(s?.required) ? s.required.filter((r): r is string => typeof r === 'string') : []);
  const out: AgentQuestion[] = [];
  const text = (value: unknown) => (typeof value === 'string' ? value : '');
  const choices = (field: Record<string, unknown>): QuestionOption[] | null => {
    if (Array.isArray(field.oneOf)) return field.oneOf.map((o) => ({ label: text((o as { title?: unknown }).title) || text((o as { const?: unknown }).const) })).filter((o) => o.label);
    if (Array.isArray(field.enum)) {
      const names = Array.isArray(field.enumNames) ? field.enumNames : [];
      return field.enum.map((v, i) => ({ label: text(names[i]) || String(v) }));
    }
    return null;
  };
  for (const [name, raw] of Object.entries(props)) {
    if (!raw || typeof raw !== 'object') return null;
    const field = raw as Record<string, unknown>;
    const base = { id: name, header: text(field.title) || name, question: text(field.description) || text(field.title) || name, required: required.has(name) };
    if (field.type === 'array') {
      const items = field.items && typeof field.items === 'object' ? choices(field.items as Record<string, unknown>) ?? (Array.isArray((field.items as { anyOf?: unknown }).anyOf) ? choices({ oneOf: (field.items as { anyOf: unknown[] }).anyOf }) : null) : null;
      if (!items) return null;
      out.push({ ...base, options: items, multi: true });
    } else if (field.type === 'boolean') {
      out.push({ ...base, options: [{ label: 'Yes' }, { label: 'No' }] });
    } else if (field.type === 'string' || field.type === 'number' || field.type === 'integer') {
      const options = field.type === 'string' ? choices(field) : null;
      out.push(options ? { ...base, options } : { ...base, options: [], other: true, ...(field.type !== 'string' ? { input: field.type } : {}) });
    } else return null;
  }
  return out;
}

/** His answers to a form as the content MCP wants back: each field's value in its own type. */
export function formContent(schema: unknown, questions: AgentQuestion[], answers: QuestionAnswers): Record<string, unknown> {
  const props = ((schema as { properties?: Record<string, Record<string, unknown>> })?.properties) ?? {};
  const content: Record<string, unknown> = {};
  for (const q of questions) {
    const a = answers[q.id];
    const field = props[q.id] ?? {};
    if (!a || answerText(a) === '') continue;
    // A choice goes back as the value the form named (its const, or its enum entry), not the label shown.
    const valueOf = (label: string, f: Record<string, unknown>): unknown => {
      if (Array.isArray(f.oneOf)) return (f.oneOf.find((o) => (o as { title?: unknown }).title === label || (o as { const?: unknown }).const === label) as { const?: unknown } | undefined)?.const ?? label;
      if (Array.isArray(f.enum)) {
        const names = Array.isArray(f.enumNames) ? f.enumNames : [];
        const at = names.indexOf(label);
        return at >= 0 ? f.enum[at] : f.enum.find((v) => String(v) === label) ?? label;
      }
      return label;
    };
    if (field.type === 'array') {
      const items = (field.items ?? {}) as Record<string, unknown>;
      content[q.id] = a.picked.map((label) => valueOf(label, Array.isArray(items.anyOf) ? { oneOf: items.anyOf } : items));
    } else if (field.type === 'boolean') content[q.id] = a.picked[0] === 'Yes';
    else if (field.type === 'number' || field.type === 'integer') {
      const n = Number((a.other ?? a.picked[0] ?? '').trim());
      if (Number.isFinite(n)) content[q.id] = field.type === 'integer' ? Math.trunc(n) : n;
    } else content[q.id] = a.picked.length ? valueOf(a.picked[0]!, field) : (a.other ?? '').trim();
  }
  return content;
}

export type SessionItem =
  /**
   * framed: the Journal sent the task's context in front of it (first-turn.ts); `text` is only what he typed.
   * answers: this message is his reply to a question the agent asked without waiting (Codex's async question);
   * `text` is then the answer in words, and each entry names the question item and the question it answers.
   */
  | (ItemBase & { kind: 'user'; text: string; framed?: boolean; answers?: { itemId: string; questionId: string; answer: string }[] })
  | (ItemBase & { kind: 'agent'; text: string })
  | (ItemBase & { kind: 'reasoning'; text: string })
  | (ItemBase & { kind: 'command'; command: string; cwd: string; output: string; exitCode: number | null; status: ItemStatus; durationMs: number | null })
  | (ItemBase & { kind: 'file-change'; files: FileEdit[]; status: ItemStatus })
  | (ItemBase & { kind: 'tool'; name: string; input: string; result: string; status: ItemStatus })
  | (ItemBase & { kind: 'plan'; text: string; steps: PlanStep[]; explanation?: string })
  | (ItemBase & { kind: 'web-search'; query: string; status: ItemStatus })
  /**
   * Questions the agent put to him. via 'reply': it went on without waiting (Codex's async question); he answers by
   * sending a message, which the pane makes for him from the card (the `reply` action). via 'ask': it waits on his
   * answer, which comes through the waiting question (an ApprovalRequest of kind 'question'). `answers` is what he
   * answered once known (by question id); `text` is the agent's own words for it, as plain text.
   * status: running (waiting), done (answered), declined (he did not answer), failed.
   */
  | (ItemBase & { kind: 'question'; via: 'reply' | 'ask'; questions: AgentQuestion[]; text: string; answers?: QuestionAnswers | null; status: ItemStatus })
  | (ItemBase & { kind: 'notice'; level: 'info' | 'warning' | 'error'; text: string });

export type ItemKind = SessionItem['kind'];

export type TurnStatus = 'running' | 'done' | 'interrupted' | 'failed';

export interface SessionTurn {
  id: string;
  status: TurnStatus;
  items: SessionItem[];
  error: string | null;
  limited?: boolean;         // it failed on the agent's usage limit
  startedAt: number | null;  // ms
  endedAt: number | null;    // ms
  diff?: string;             // the turn's whole diff, when the agent gives one
}

// ---- Approvals.

/** question: the agent asks him something (it carries `questions`) and waits; he answers with the `answer` action. */
export type ApprovalKind = 'command' | 'file-change' | 'tool' | 'question' | 'other';
export type ApprovalDecision = 'allow' | 'allow-session' | 'deny' | 'cancel';
export const APPROVAL_DECISIONS: readonly ApprovalDecision[] = ['allow', 'allow-session', 'deny', 'cancel'];
export const isApprovalDecision = (value: unknown): value is ApprovalDecision => typeof value === 'string' && (APPROVAL_DECISIONS as readonly string[]).includes(value);

export interface ApprovalRequest {
  id: string;                // the Journal's id for it
  turnId: string | null;
  itemId: string | null;
  kind: ApprovalKind;
  title: string;             // what is asked, in one line ("Run npm test"), clipped
  /** A command approval's whole command, as it will run, never clipped (it can span lines: a heredoc, a script). */
  command?: string;
  detail?: string;           // why it asks (the reason, the agent's own words), the question; never the command again
  cwd?: string;
  files?: string[];
  decisions: ApprovalDecision[];  // what can be answered from the Journal (a question: deny = skip it, cancel = skip and stop)
  elsewhere?: boolean;       // only the agent's own app can allow it; the Journal can only decline
  /** kind 'question': what it asks. Answered with the `answer` action; `decisions` say how it may be left unanswered. */
  questions?: AgentQuestion[];
  /** A page he is asked to open (an MCP server's sign-in, say); allow = he has done what it asks. */
  link?: string;
  /** A plan it wants approved before it starts (markdown), shown as the plan it is. */
  plan?: string;
  at: number;                // ms
}

// ---- Status and usage.

export interface LimitWindow {
  label: string;             // "5 hours", "week"
  usedPercent: number;
  resetsAt: number | null;   // ms
}

export interface RateLimitSummary {
  windows: LimitWindow[];
  blocked: boolean;          // the agent will refuse new turns until a window resets
}

export interface TokenUsage {
  total: number;
  input: number;
  output: number;
  contextWindow: number | null;
  lastTurn?: number;         // tokens of the latest turn
}

export interface AgentStatus {
  agent: AgentKind;
  host: string;
  /** ready: reachable and signed in. offline: cannot be reached. signed-out: reached, no login. unavailable: not built here yet. */
  state: 'ready' | 'offline' | 'signed-out' | 'unavailable';
  reason?: string;
  account?: { kind: 'subscription' | 'api-key' | 'other'; plan?: string };
  limits?: RateLimitSummary;
  version?: string;
}

// ---- Signing in to an agent on a device.

/**
 * starting: the agent is asked for a way in. waiting: he is to sign in on the page (and, for Claude Code, paste the
 * code it shows). checking: the code went to the agent. done / failed / cancelled: it ended.
 */
export type LoginState = 'starting' | 'waiting' | 'checking' | 'done' | 'failed' | 'cancelled';

/**
 * One sign-in, as the pane shows it. Kept in the server's memory only, never on disk. device-code (Codex): open
 * `url`, sign in, enter `code` there. paste-code (Claude Code): open `url`, sign in, paste the code the page shows
 * back into the Journal. `url` and `code` are for his eyes: nothing logs them.
 */
export interface AgentLogin {
  id: string;
  agent: AgentKind;
  host: string;
  method: 'device-code' | 'paste-code';
  state: LoginState;
  url?: string;
  code?: string;
  error?: string;
  startedAt: number;           // ms
  endedAt?: number | null;     // ms
}

// ---- The stream.

/** What happened, without its place in the stream. Adapters produce these; the hub numbers them. */
export type EventBody =
  | { type: 'turn-started'; turnId: string; at: number }
  | { type: 'turn-completed'; turnId: string; status: TurnStatus; error: string | null; limited?: boolean; at: number }
  | { type: 'item-started'; turnId: string; item: SessionItem }
  /**
   * `field` is the item's text (agent, reasoning, plan) or output (command). Append `delta` to it. `offset`, when the
   * hub knows it, is where `delta` starts in the field: a copy that already has that much (a history read just as
   * it arrived) skips what it has, so a delta is never counted twice.
   */
  | { type: 'item-delta'; turnId: string; itemId: string; field: 'text' | 'output'; delta: string; offset?: number }
  /** The whole item again; replaces what the client has (a plan's steps changed, a patch grew). */
  | { type: 'item-updated'; turnId: string; item: SessionItem }
  | { type: 'item-completed'; turnId: string; item: SessionItem }
  | { type: 'turn-diff'; turnId: string; diff: string }
  | { type: 'approval-asked'; approval: ApprovalRequest }
  /** by: the Journal answered, the agent's own app (or the agent) settled it elsewhere, or the connection was lost with it. */
  | { type: 'approval-resolved'; approvalId: string; decision: ApprovalDecision | null; by: 'journal' | 'elsewhere' | 'lost' }
  | { type: 'state-changed'; state: SessionState; turnId: string | null; reason?: string }
  | { type: 'title-changed'; title: string }
  | { type: 'usage-changed'; tokens?: TokenUsage; limits?: RateLimitSummary }
  /** The client's copy can no longer be brought up to date by events: read the history again. */
  | { type: 'reset'; reason: string };

export type EventType = EventBody['type'];

/** One event of the stream. `seq` rises by one per event within a session; only its order means anything. */
export type SessionEvent = EventBody & { seq: number; session: string; at: number };

/** Applies one event to a turn list in place: what the browser does with the stream. Pure; returns the list. */
export function applyEvent(turns: SessionTurn[], event: EventBody): SessionTurn[] {
  const turnOf = (turnId: string): SessionTurn => {
    let turn = turns.find((t) => t.id === turnId);
    if (!turn) {
      turn = { id: turnId, status: 'running', items: [], error: null, startedAt: null, endedAt: null };
      turns.push(turn);
    }
    return turn;
  };
  const put = (turnId: string, item: SessionItem) => {
    const turn = turnOf(turnId);
    const at = turn.items.findIndex((i) => i.id === item.id);
    if (at >= 0) turn.items[at] = item;
    else turn.items.push(item);
  };
  switch (event.type) {
    case 'turn-started': {
      const turn = turnOf(event.turnId);
      turn.status = 'running';
      turn.startedAt ??= event.at;
      break;
    }
    case 'turn-completed': {
      const turn = turnOf(event.turnId);
      turn.status = event.status;
      turn.error = event.error;
      if (event.limited) turn.limited = true;
      turn.endedAt = event.at;
      break;
    }
    case 'item-started':
    case 'item-updated':
    case 'item-completed':
      put(event.turnId, event.item);
      break;
    case 'item-delta': {
      const item = turnOf(event.turnId).items.find((i) => i.id === event.itemId);
      if (!item) break;
      const grow = (have: string): string => {
        if (typeof event.offset !== 'number') return have + event.delta;
        // Already there (the copy was read after this delta): only what is past its end is added.
        const over = have.length - event.offset;
        if (over >= event.delta.length) return have;
        return have + (over > 0 ? event.delta.slice(over) : event.delta);
      };
      if (event.field === 'output' && item.kind === 'command') item.output = grow(item.output);
      else if (event.field === 'text' && (item.kind === 'agent' || item.kind === 'reasoning' || item.kind === 'plan' || item.kind === 'user')) item.text = grow(item.text);
      break;
    }
    case 'turn-diff':
      turnOf(event.turnId).diff = event.diff;
      break;
    default:
      break;
  }
  return turns;
}

// ---- Small shared helpers.

export function clipLine(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The most of a command's output an item keeps (Codex and the Claude bridge alike). */
export const OUTPUT_MAX = 20_000;

/**
 * A command's output, kept to `limit` characters: its start and its end, whole lines where it can, with a line
 * between that says how much was left out ("… 1,204 lines clipped …").
 */
export function clipOutput(text: string, limit = OUTPUT_MAX): string {
  if (text.length <= limit) return text;
  const keep = Math.max(1, Math.floor((limit - 40) / 2));
  let head = text.slice(0, keep);
  let tail = text.slice(text.length - keep);
  const headEnd = head.lastIndexOf('\n');
  if (headEnd > keep / 2) head = head.slice(0, headEnd + 1);
  const tailStart = tail.indexOf('\n');
  if (tailStart >= 0 && tailStart < keep / 2) tail = tail.slice(tailStart + 1);
  const cut = text.slice(head.length, text.length - tail.length);
  const lines = cut.split('\n').length - (cut.endsWith('\n') ? 1 : 0);
  const what = cut.includes('\n') ? `${lines.toLocaleString('en-US')} lines` : `${cut.length.toLocaleString('en-US')} characters`;
  return `${head.endsWith('\n') ? head : `${head}\n`}… ${what} clipped …\n${tail}`;
}

export const LAST_LINE_MAX = 140;
export const TITLE_MAX = 60;
