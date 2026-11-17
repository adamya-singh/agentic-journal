// From the Claude Agent SDK's shapes to the Journal's (src/lib/code-agents/protocol.ts). Pure: no SDK, no files.
// One TurnBuilder turns the messages of one turn into items, the same way for a turn running now (it then says what
// changed, as protocol events) and for a turn read back from the transcript, so both get the same item ids:
//   text and thinking blocks: `<API message id>:<block index>`; a tool call: its tool_use id; his message: its uuid.
import type {
  AgentQuestion, ApprovalDecision, ApprovalRequest, EventBody, FileEdit, ItemStatus, LimitWindow, ModelEntry, NativeSession, QuestionAnswers, RateLimitSummary,
  SessionItem, SessionTurn, TurnStatus,
} from '../src/lib/code-agents/protocol.ts';
import { answerText, clipLine, clipOutput, formQuestions, TITLE_MAX } from '../src/lib/code-agents/protocol.ts';
import type {
  SdkAskUserQuestionInput, SdkCanUseToolOptions, SdkContentBlock, SdkElicitationRequest, SdkMessage, SdkModelInfo, SdkPermissionMode, SdkPermissionUpdate, SdkRateLimitInfo, SdkSessionInfo, SdkSessionMessage, SdkStreamEvent,
} from './sdk-types.ts';

const INPUT_MAX = 400;
const RESULT_MAX = 2000;
const DIFF_MAX = 40_000;

/** What the bridge tells Claude when he declines or stops a tool from the Journal. */
export const DENY_MESSAGE = 'The user declined this from the Agentic Journal.';
export const STOP_MESSAGE = 'The user stopped this turn from the Agentic Journal.';

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/**
 * Claude Code's task list (CLI 2.1.x; TodoWrite before it): one call per change. They are not shown one by one; the
 * list they keep is, as one plan item per turn.
 */
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
/** Plumbing Claude Code's own apps do not show either: loading a deferred tool (CLI 2.1.x). */
const HIDDEN_TOOLS = new Set(['ToolSearch']);
const shownTool = (name: string | undefined) => !TASK_TOOLS.has(name ?? '') && !HIDDEN_TOOLS.has(name ?? '');

/**
 * A session's task list as TaskCreate and TaskUpdate keep it. Claude Code numbers the tasks itself and says the
 * number in the result ("Task #3 created successfully: …", or `{task: {id}}` live), so a task is held under its
 * call's id until then. One tracker lives as long as the session's turns are built with it, so a later turn's
 * updates find the tasks an earlier turn made.
 */
export class TaskTracker {
  private readonly tasks = new Map<string, { subject: string; activeForm: string; status: 'pending' | 'running' | 'done' }>();

  get size(): number { return this.tasks.size; }

  /** A tool call; true when it was one of the task tools (and so is not an item of its own). */
  call(block: SdkContentBlock): boolean {
    const name = block.name ?? '';
    if (!TASK_TOOLS.has(name)) return false;
    const input = block.input ?? {};
    if (name === 'TaskCreate') {
      this.tasks.set(`call:${block.id}`, { subject: str(input.subject) || str(input.description) || 'A task', activeForm: str(input.activeForm), status: 'pending' });
    } else if (name === 'TaskUpdate') {
      const id = str(input.taskId) || String(input.taskId ?? '');
      if (!id) return true;
      if (input.status === 'deleted') { this.tasks.delete(id); return true; }
      const had = this.tasks.get(id) ?? { subject: `Task #${id}`, activeForm: '', status: 'pending' as const };
      const status = input.status === 'completed' ? 'done' : input.status === 'in_progress' ? 'running' : input.status === 'pending' ? 'pending' : had.status;
      this.tasks.set(id, { subject: str(input.subject) || had.subject, activeForm: str(input.activeForm) || had.activeForm, status });
    }
    return true;
  }

  /** A TaskCreate's result: the number Claude Code gave the task. */
  created(toolUseId: string, resultText: string, own: unknown): void {
    const key = `call:${toolUseId}`;
    const task = this.tasks.get(key);
    if (!task) return;
    const ownId = own && typeof own === 'object' ? (own as { task?: { id?: unknown } }).task?.id : undefined;
    const id = typeof ownId === 'string' || typeof ownId === 'number' ? String(ownId) : /Task #(\S+?) created/.exec(resultText)?.[1];
    if (!id) return;
    // Kept in the order made: rebuilt with the new key in the same place.
    const entries = [...this.tasks.entries()].map(([k, v]) => (k === key ? [id, v] as const : [k, v] as const));
    this.tasks.clear();
    for (const [k, v] of entries) this.tasks.set(k, v);
  }

  /** A failed TaskCreate made nothing. */
  failed(toolUseId: string): void { this.tasks.delete(`call:${toolUseId}`); }

  steps(): { text: string; status: 'pending' | 'running' | 'done' }[] {
    return [...this.tasks.values()].map((t) => ({ text: t.status === 'running' && t.activeForm ? t.activeForm : t.subject, status: t.status }));
  }
}

/** How Claude Code words the failures it writes into a transcript as its own messages. */
const API_ERROR_TEXT = /^(API Error|Failed to authenticate|OAuth|Invalid API key|Credit balance|Prompt is too long|Request timed out|Claude AI usage limit|You['’]ve (hit|reached) your|.*usage limit)/i;

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit - 1)}…` : text);

const compact = (value: unknown, limit: number) => {
  if (value === null || value === undefined) return '';
  return clip(typeof value === 'string' ? value : JSON.stringify(value), limit);
};

const str = (value: unknown) => (typeof value === 'string' ? value : '');

export const msOf = (iso: string | undefined | null): number | null => {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
};

/** The text of a message's content: a string, or its text blocks (other blocks named). */
export function blocksText(content: string | SdkContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((block) => {
    if (block.type === 'text') return block.text ?? '';
    if (block.type === 'image') return '[image]';
    if (block.type === 'tool_result' || block.type === 'tool_use') return '';
    return `[${block.type}]`;
  }).filter(Boolean).join('\n');
}

/** `mcp__server__tool` → `server.tool`. */
function toolLabel(name: string): string {
  if (name.startsWith('mcp__')) {
    const [, server, ...rest] = name.split('__');
    return rest.length ? `${server}.${rest.join('__')}` : name;
  }
  return name;
}

/** A short line saying what a tool was asked to do. */
function toolInputSummary(name: string, input: Record<string, unknown>): string {
  if (name === 'Read') return str(input.file_path);
  if (name === 'Grep') return [str(input.pattern), str(input.path)].filter(Boolean).join(' in ');
  if (name === 'Glob') return str(input.pattern);
  if (name === 'Task' || name === 'Agent') return clip([str(input.subagent_type), str(input.description) || str(input.prompt)].filter(Boolean).join(': '), INPUT_MAX);
  if (name === 'Skill') return str(input.skill) || str(input.command);
  return compact(input, INPUT_MAX);
}

// ---- Diffs for file changes, from the tool's input (or the tool's own patch when it gives one).

function relative(file: string, cwd: string): string {
  return cwd && file.startsWith(`${cwd}/`) ? file.slice(cwd.length + 1) : file;
}

const lines = (text: string) => (text === '' ? [] : text.replace(/\n$/, '').split('\n'));

function replaceDiff(oldText: string, newText: string): string[] {
  const minus = lines(oldText).map((l) => `-${l}`);
  const plus = lines(newText).map((l) => `+${l}`);
  return [`@@ -1,${minus.length} +1,${plus.length} @@`, ...minus, ...plus];
}

interface StructuredHunk { oldStart?: number; oldLines?: number; newStart?: number; newLines?: number; lines?: string[] }

function hunksDiff(hunks: StructuredHunk[]): string[] {
  return hunks.flatMap((h) => [`@@ -${h.oldStart ?? 1},${h.oldLines ?? 0} +${h.newStart ?? 1},${h.newLines ?? 0} @@`, ...(h.lines ?? [])]);
}

/** The files a file tool changes, each with a unified diff. `result` is the tool's own output, when there is one. */
export function fileEdits(name: string, input: Record<string, unknown>, cwd: string, result?: unknown): FileEdit[] {
  const file = str(input.file_path) || str(input.notebook_path);
  const shown = relative(file, cwd);
  const own = result && typeof result === 'object' ? result as { type?: unknown; structuredPatch?: unknown } : null;
  const patch = Array.isArray(own?.structuredPatch) && own.structuredPatch.length ? hunksDiff(own.structuredPatch as StructuredHunk[]) : null;
  let change: FileEdit['change'] = 'update';
  let body: string[];
  if (name === 'Write') {
    change = own?.type === 'update' ? 'update' : 'add';
    body = patch ?? (change === 'add' ? (() => { const plus = lines(str(input.content)).map((l) => `+${l}`); return [`@@ -0,0 +1,${plus.length} @@`, ...plus]; })() : replaceDiff('', str(input.content)));
  } else if (name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits as { old_string?: unknown; new_string?: unknown }[] : [];
    body = patch ?? edits.flatMap((e) => replaceDiff(str(e.old_string), str(e.new_string)));
  } else if (name === 'NotebookEdit') {
    const mode = str(input.edit_mode);
    body = mode === 'delete' ? ['@@ cell deleted @@'] : replaceDiff('', str(input.new_source));
  } else {
    body = patch ?? replaceDiff(str(input.old_string), str(input.new_string));
  }
  const [a, b] = shown.startsWith('/') ? [shown, shown] : [`a/${shown}`, `b/${shown}`];
  const head = change === 'add' ? ['--- /dev/null', `+++ ${b}`] : [`--- ${a}`, `+++ ${b}`];
  return [{ path: file, change, diff: clip([...head, ...body].join('\n'), DIFF_MAX) }];
}

// ---- Questions (AskUserQuestion).

/** The questions of an AskUserQuestion call, each by its place in the list. Claude Code offers "Other" with each. */
export function askQuestions(input: Record<string, unknown>): AgentQuestion[] {
  const list = Array.isArray((input as SdkAskUserQuestionInput).questions) ? (input as SdkAskUserQuestionInput).questions! : [];
  return list.map((q, i) => ({
    id: String(i), question: str(q?.question), ...(str(q?.header) ? { header: str(q?.header) } : {}),
    options: (Array.isArray(q?.options) ? q.options : []).map((o) => ({ label: str(o?.label), ...(str(o?.description) ? { description: str(o?.description) } : {}) })).filter((o) => o.label),
    ...(q?.multiSelect === true ? { multi: true } : {}),
    other: true,
  }));
}

/** His answers as AskUserQuestion takes them: question text → the answer in words (a multi-select's labels joined by ", "). */
export function askAnswers(questions: AgentQuestion[], answers: QuestionAnswers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const q of questions) {
    const text = answerText(answers[q.id]);
    if (text) out[q.question] = text;
  }
  return out;
}

/**
 * What he answered, read back from the tool's result: its own `answers` (live), else its text ("Your questions have
 * been answered: "<question>"="<answer>", …" in CLI 2.1.x; "User has answered your questions: …" before). An answer
 * that is one of the options is that option; anything else is what he wrote.
 */
export function askResultAnswers(questions: AgentQuestion[], text: string, own?: unknown): QuestionAnswers | null {
  const given = own && typeof own === 'object' && (own as { answers?: unknown }).answers && typeof (own as { answers: unknown }).answers === 'object'
    ? (own as { answers: Record<string, unknown> }).answers : null;
  const out: QuestionAnswers = {};
  for (const [i, q] of questions.entries()) {
    let said: string | null = typeof given?.[q.question] === 'string' ? given[q.question] as string : null;
    if (said === null) {
      const key = `"${q.question}"="`;
      const at = text.indexOf(key);
      if (at < 0) continue;
      const from = at + key.length;
      // It runs to the next question's key, else to the closing words.
      const next = questions.slice(i + 1).map((n) => text.indexOf(`", "${n.question}"="`, from)).find((n) => n >= 0);
      const end = next ?? (() => { const close = text.lastIndexOf('". '); return close >= from ? close : text.lastIndexOf('"'); })();
      if (end < from) continue;
      said = text.slice(from, end);
    }
    const labels = q.options.map((o) => o.label);
    if (labels.includes(said)) { out[q.id] = { picked: [said] }; continue; }
    // A multi-select: its labels joined by ", ".
    const parts = q.multi ? said.split(', ') : [];
    if (parts.length > 1 && parts.every((p) => labels.includes(p))) out[q.id] = { picked: parts };
    else out[q.id] = { picked: [], other: said };
  }
  return Object.keys(out).length ? out : null;
}

/** An MCP server's request for input, as the Journal asks it: a form as questions, a page to open as a link. */
export function elicitationFor(request: SdkElicitationRequest): Omit<ApprovalRequest, 'id' | 'at' | 'turnId' | 'itemId'> {
  const who = request.displayName || request.serverName;
  const detail = [request.message, request.description].filter(Boolean).join('\n\n');
  if (request.mode === 'url' && request.url) {
    return { kind: 'other', title: request.title || `${who} asks you to open a page`, link: request.url, ...(detail ? { detail } : {}), decisions: ['allow', 'deny', 'cancel'] };
  }
  const questions = formQuestions(request.requestedSchema);
  if (!questions) return { kind: 'tool', title: request.title || `${who} asks for input`, ...(detail ? { detail } : {}), decisions: ['deny', 'cancel'], elsewhere: true };
  return { kind: 'question', title: request.title || `${who} asks for input`, ...(detail ? { detail } : {}), questions, decisions: ['deny', 'cancel'] };
}

// ---- Tool calls as items.

/** What a tool call looks like when it starts. */
export function toolItem(block: SdkContentBlock, cwd: string, at: number | null): SessionItem {
  const id = block.id ?? `tool-${at ?? Date.now()}`;
  const name = block.name ?? 'tool';
  const input = block.input ?? {};
  const base = { id, startedAt: at, endedAt: null };
  if (name === 'Bash') return { ...base, kind: 'command', command: str(input.command), cwd, output: '', exitCode: null, status: 'running', durationMs: null };
  if (FILE_TOOLS.has(name)) return { ...base, kind: 'file-change', files: str(input.file_path) || str(input.notebook_path) ? fileEdits(name, input, cwd) : [], status: 'running' };
  if (name === 'TodoWrite') {
    const todos = Array.isArray(input.todos) ? input.todos as { content?: unknown; activeForm?: unknown; status?: unknown }[] : [];
    return {
      ...base, kind: 'plan', text: '',
      steps: todos.map((t) => ({ text: str(t.content) || str(t.activeForm), status: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'running' : 'pending' })),
    };
  }
  if (name === 'AskUserQuestion') {
    const questions = askQuestions(input);
    return { ...base, kind: 'question', via: 'ask', questions, text: questions.map((q) => q.question).join('\n'), answers: null, status: 'running' };
  }
  // The plan Claude asks to leave plan mode with: shown as the plan it is (markdown), not as a tool call.
  if (name === 'ExitPlanMode' && str(input.plan)) return { ...base, kind: 'plan', text: str(input.plan), steps: [] };
  if (name === 'WebSearch') return { ...base, kind: 'web-search', query: str(input.query), status: 'running' };
  if (name === 'WebFetch') return { ...base, kind: 'web-search', query: str(input.url), status: 'running' };
  return { ...base, kind: 'tool', name: toolLabel(name), input: toolInputSummary(name, input), result: '', status: 'running' };
}

/** A tool call, ended by its result. `own` is the tool's own output object (live turns only). */
export function toolDone(item: SessionItem, block: SdkContentBlock, own: unknown, declined: boolean, at: number | null, call?: SdkContentBlock, cwd = '', stopping = false): SessionItem {
  const text = blocksText(block.content);
  const failed = block.is_error === true;
  // Claude Code ends a tool cut short by Stop with the same words as one he refused in its own app ("The user
  // doesn't want to proceed…", seen live): while the turn is being stopped it was stopped, not declined.
  const refused = failed && (text.startsWith(DENY_MESSAGE) || text.startsWith(STOP_MESSAGE) || (!stopping && REFUSED_TEXT.test(text)));
  const status: ItemStatus = declined || refused ? 'declined' : failed ? 'failed' : 'done';
  const ended = { endedAt: at };
  switch (item.kind) {
    case 'command': {
      const bash = own && typeof own === 'object' ? own as { stdout?: unknown; stderr?: unknown } : null;
      const output = bash && (typeof bash.stdout === 'string' || typeof bash.stderr === 'string')
        ? [str(bash.stdout), str(bash.stderr)].filter(Boolean).join('\n')
        : text;
      const code = /^Exit code (\d+)/.exec(text);
      return {
        ...item, ...ended, status, output: clipOutput(output),
        exitCode: status === 'done' ? 0 : code ? Number(code[1]) : null,
        durationMs: item.startedAt && at ? Math.max(0, at - item.startedAt) : null,
      };
    }
    case 'file-change': {
      const files = call && own ? fileEdits(call.name ?? 'Edit', call.input ?? {}, cwd, own) : item.files;
      return { ...item, ...ended, status, files };
    }
    case 'tool':
      return { ...item, ...ended, status, result: clip(text, RESULT_MAX) };
    case 'web-search':
      return { ...item, ...ended, status };
    case 'question': {
      const answers = status === 'done' ? askResultAnswers(item.questions, text, own) : null;
      return { ...item, ...ended, status, answers };
    }
    default:
      return { ...item, ...ended };
  }
}

const RUNNING_KINDS = new Set(['command', 'file-change', 'tool', 'web-search', 'question']);
const REFUSED_TEXT = /doesn['’]t want to proceed/;

// ---- One turn, item by item.

type Emit = (body: EventBody) => void;

/**
 * Builds one turn's items from SDK messages. With `emit`, it says each change as a protocol event (a turn running
 * now); without, it only builds (a turn read from the transcript).
 */
export class TurnBuilder {
  readonly turn: SessionTurn;
  /** The failure Claude Code reported in the turn itself (an API error it wrote as a message). */
  apiError: { kind: string | null; text: string } | null = null;
  readonly declined = new Set<string>();
  /** Set while the turn is being stopped (live); a tool cut short then reads failed, not declined. */
  stopping = false;
  private readonly cwd: string;
  private readonly emit: Emit | null;
  private readonly blockCount = new Map<string, number>();
  private readonly calls = new Map<string, SdkContentBlock>();
  private streamMessage: string | null = null;
  private readonly streamItems = new Map<number, { id: string; kind: 'agent' | 'reasoning' }>();
  private readonly tasks: TaskTracker;

  constructor(id: string, cwd: string, startedAt: number | null, emit?: Emit, tasks?: TaskTracker) {
    this.turn = { id, status: 'running', items: [], error: null, startedAt, endedAt: null };
    this.cwd = cwd;
    this.emit = emit ?? null;
    this.tasks = tasks ?? new TaskTracker();
  }

  /** The task list as it stands, as this turn's plan item. */
  private putTasks(at: number | null): void {
    const id = `tasks:${this.turn.id}`;
    const had = this.item(id);
    this.put({ id, kind: 'plan', text: '', steps: this.tasks.steps(), startedAt: had?.startedAt ?? at, endedAt: at }, 'item-completed');
  }

  private item(id: string): SessionItem | undefined {
    return this.turn.items.find((i) => i.id === id);
  }

  private put(item: SessionItem, type: 'item-started' | 'item-updated' | 'item-completed'): void {
    const at = this.turn.items.findIndex((i) => i.id === item.id);
    if (at >= 0) this.turn.items[at] = item;
    else this.turn.items.push(item);
    this.emit?.({ type, turnId: this.turn.id, item });
  }

  /** His message (the turn's first, or one sent while it runs). */
  user(id: string, text: string, at: number | null): void {
    this.put({ id, kind: 'user', text, startedAt: at, endedAt: at }, 'item-completed');
  }

  notice(id: string, level: 'info' | 'warning' | 'error', text: string, at: number | null): void {
    this.put({ id, kind: 'notice', level, text, startedAt: at, endedAt: at }, 'item-updated');
  }

  /** One streaming event of the main conversation (live turns only). */
  stream(event: SdkStreamEvent | undefined, at: number): void {
    if (!event) return;
    if (event.type === 'message_start') {
      this.streamMessage = event.message?.id ?? null;
      this.streamItems.clear();
      return;
    }
    if (!this.streamMessage || typeof event.index !== 'number') return;
    const id = `${this.streamMessage}:${event.index}`;
    if (event.type === 'content_block_start') {
      const block = event.content_block;
      // A text or thinking item is begun with its first words: thinking often streams none at all (Claude Code
      // asks for it without its text unless thinking summaries are on), and an empty block is nothing to show.
      if (block?.type === 'text' || block?.type === 'thinking') {
        this.streamItems.set(event.index, { id, kind: block.type === 'text' ? 'agent' : 'reasoning' });
        const text = (block.type === 'text' ? block.text : block.thinking) ?? '';
        if (text) this.put({ id, kind: block.type === 'text' ? 'agent' : 'reasoning', text, startedAt: at, endedAt: null }, 'item-started');
      } else if (block?.type === 'tool_use' && block.id && !this.item(block.id) && shownTool(block.name)) this.put(toolItem(block, this.cwd, at), 'item-started');
      return;
    }
    if (event.type === 'content_block_delta') {
      const open = this.streamItems.get(event.index);
      const delta = event.delta?.type === 'text_delta' ? event.delta.text : event.delta?.type === 'thinking_delta' ? event.delta.thinking : undefined;
      if (!open || !delta) return;
      let item: SessionItem | undefined = this.item(open.id);
      if (!item) {
        const begun: SessionItem = { id: open.id, kind: open.kind, text: '', startedAt: at, endedAt: null };
        this.put(begun, 'item-started');
        item = begun;
      }
      if (item.kind !== 'agent' && item.kind !== 'reasoning') return;
      item.text += delta;
      this.emit?.({ type: 'item-delta', turnId: this.turn.id, itemId: item.id, field: 'text', delta });
    }
  }

  /** One assistant message of the main conversation: usually one content block of a longer API message. */
  assistant(message: Pick<SdkMessage, 'message' | 'error' | 'uuid'>, at: number | null): void {
    const api = message.message;
    if (!api) return;
    const msgId = api.id || message.uuid || `m${Date.now()}`;
    const blocks = typeof api.content === 'string' ? [{ type: 'text', text: api.content }] : api.content ?? [];
    const synthetic = api.model === '<synthetic>' || !!message.error;
    for (const block of blocks) {
      const index = this.blockCount.get(msgId) ?? 0;
      this.blockCount.set(msgId, index + 1);
      const id = `${msgId}:${index}`;
      if (block.type === 'text') {
        if (synthetic) {
          // A message Claude Code wrote itself. A failure (sign-in, usage limit, ...) is the turn's error, shown as
          // one; the transcript keeps no error flag, so there it is told by its words. Others ("No response
          // requested.") are not shown.
          const text = block.text ?? '';
          if (message.error || API_ERROR_TEXT.test(text)) {
            this.apiError = { kind: message.error ?? null, text };
            this.put({ id, kind: 'notice', level: 'error', text, startedAt: at, endedAt: at }, 'item-completed');
          }
          continue;
        }
        const had = this.item(id);
        this.put({ id, kind: 'agent', text: block.text ?? '', startedAt: had?.startedAt ?? at, endedAt: at }, 'item-completed');
      } else if (block.type === 'thinking') {
        const had = this.item(id);
        const text = block.thinking || (had?.kind === 'reasoning' ? had.text : '');
        // Thinking without its text (signed but empty, as Claude Code asks for it by default): nothing to show.
        if (!text) continue;
        this.put({ id, kind: 'reasoning', text, startedAt: had?.startedAt ?? at, endedAt: at }, 'item-completed');
      } else if (block.type === 'tool_use' && block.id) {
        this.calls.set(block.id, block);
        if (this.tasks.call(block)) { if (block.name !== 'TaskList' && block.name !== 'TaskGet') this.putTasks(at); continue; }
        if (HIDDEN_TOOLS.has(block.name ?? '')) continue;
        const had = this.item(block.id);
        const item = toolItem(block, this.cwd, had?.startedAt ?? at);
        this.put(item, item.kind === 'plan' ? 'item-completed' : had ? 'item-updated' : 'item-started');
      }
      // redacted_thinking, server tool blocks and the rest are not shown.
    }
  }

  /** The results of tool calls (a user message of tool_result blocks). `own` is the tool's own output object. */
  toolResults(content: string | SdkContentBlock[] | undefined, own: unknown, at: number | null): void {
    if (!Array.isArray(content)) return;
    const results = content.filter((b) => b.type === 'tool_result' && b.tool_use_id);
    for (const block of results) {
      const call = this.calls.get(block.tool_use_id!);
      if (call?.name === 'TaskCreate') {
        if (block.is_error) this.tasks.failed(block.tool_use_id!);
        else this.tasks.created(block.tool_use_id!, blocksText(block.content), results.length === 1 ? own : undefined);
        this.putTasks(at);
        continue;
      }
      const item = this.item(block.tool_use_id!);
      if (!item) continue;
      const done = toolDone(item, block, results.length === 1 ? own : undefined, this.declined.has(block.tool_use_id!), at, this.calls.get(block.tool_use_id!), this.cwd, this.stopping);
      this.put(done, 'item-completed');
    }
  }

  /** A message from inside a sub-agent: shown as progress on the tool call that started it. */
  subagent(parentToolUseId: string, message: SdkMessage): void {
    const parent = this.item(parentToolUseId);
    if (!parent || parent.kind !== 'tool' || parent.status !== 'running') return;
    const blocks = Array.isArray(message.message?.content) ? message.message!.content as SdkContentBlock[] : [];
    const call = blocks.find((b) => b.type === 'tool_use');
    if (!call) return;
    const line = `Working: ${toolLabel(call.name ?? 'tool')} ${toolInputSummary(call.name ?? '', call.input ?? {})}`.trim();
    this.put({ ...parent, result: clip(line, RESULT_MAX) }, 'item-updated');
  }

  /** The turn was stopped (read back from a transcript): a tool it cut short reads failed, not declined. */
  wasStopped(): void {
    for (const item of this.turn.items) {
      if ((item.kind === 'command' && item.status === 'declined' && REFUSED_TEXT.test(item.output) && !this.declined.has(item.id))
        || (item.kind === 'tool' && item.status === 'declined' && REFUSED_TEXT.test(item.result))) {
        (item as { status: ItemStatus }).status = 'failed';
      }
    }
  }

  /** Ends the turn. Tool calls still open end with it. Says nothing of the turn itself: the caller does. */
  finish(status: TurnStatus, error: string | null, limited: boolean, at: number | null): SessionTurn {
    for (const item of [...this.turn.items]) {
      if (!RUNNING_KINDS.has(item.kind) || (item as { status?: ItemStatus }).status !== 'running') continue;
      // A question still open when the turn ended was never answered.
      this.put({ ...item, status: item.kind === 'question' ? 'declined' : status === 'done' ? 'done' : 'failed', endedAt: at } as SessionItem, 'item-completed');
    }
    this.turn.status = status;
    this.turn.error = error;
    if (limited) this.turn.limited = true;
    this.turn.endedAt = at;
    return this.turn;
  }
}

/** A failure that is the usage limit: retrying will not help until it resets. */
export function isLimited(kind: string | null | undefined, text: string | null | undefined): boolean {
  return kind === 'rate_limit' || /usage limit|rate limit|limit reached|out of (extra )?usage/i.test(text ?? '');
}

// ---- A whole transcript as turns.

const INTERRUPTED = /^\[Request interrupted by user/;

/** His text in a user message, or null when the message is only tool results. */
function userText(message: SdkSessionMessage): string | null {
  const content = message.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || !content.some((b) => b.type !== 'tool_result')) return null;
  return blocksText(content);
}

/**
 * The turns of a transcript (getSessionMessages), oldest first. A turn starts at each message he sent and holds what
 * came after it. Messages from inside sub-agents are left out. A turn reads done unless Claude Code wrote a failure
 * into it or it was interrupted; the bridge marks the one running now itself.
 */
export function historyTurns(messages: SdkSessionMessage[], cwd: string, tasks = new TaskTracker()): SessionTurn[] {
  const turns: SessionTurn[] = [];
  let builder: TurnBuilder | null = null;
  let last: number | null = null;
  const close = () => {
    if (!builder) return;
    const t = builder.turn;
    const status = t.status === 'interrupted' ? 'interrupted' : builder.apiError ? 'failed' : 'done';
    const error = status === 'failed' ? builder.apiError?.text ?? 'The turn failed.' : null;
    builder.finish(status, error, status === 'failed' && isLimited(builder.apiError?.kind, error), last);
    turns.push(builder.turn);
    builder = null;
  };
  for (const message of messages) {
    if (message.parent_tool_use_id) continue;
    const at = msOf(message.timestamp);
    if (message.type === 'user') {
      const text = userText(message);
      if (text === null) { builder?.toolResults(message.message?.content, undefined, at); last = at ?? last; continue; }
      if (INTERRUPTED.test(text)) {
        if (builder) { builder.turn.status = 'interrupted'; builder.wasStopped(); }
        last = at ?? last;
        continue;
      }
      // Sent while Claude worked and taken into that turn (a steer): his words in it, as the live turn showed them.
      if (message.isQueuedCommand && builder && !text.startsWith('<task-notification>')) {
        builder.user(message.uuid, text, at);
        last = at ?? last;
        continue;
      }
      close();
      builder = new TurnBuilder(message.uuid, cwd, at, undefined, tasks);
      if (text.startsWith('<task-notification>') || (message.origin?.kind && message.origin.kind !== 'human' && message.origin.kind !== 'peer')) {
        builder.notice(message.uuid, 'info', 'A background task reported back.', at);
      } else builder.user(message.uuid, text, at);
      last = at;
      continue;
    }
    if (message.type === 'assistant') {
      // Claude Code's own words that are not a failure ("No response requested.", written when the next message
      // comes after a Stop) are not shown, and do not stretch the turn to their time.
      if (message.message?.model === '<synthetic>' && !API_ERROR_TEXT.test(blocksText(message.message.content))) continue;
      if (!builder) builder = new TurnBuilder(message.uuid, cwd, at, undefined, tasks);
      builder.assistant(message, at);
      last = at ?? last;
    }
  }
  close();
  return turns;
}

// ---- Approvals.

/** How a permission prompt from Claude Code reads in the Journal. */
export function approvalFor(toolName: string, input: Record<string, unknown>, options: Pick<SdkCanUseToolOptions, 'title' | 'displayName' | 'description' | 'decisionReason' | 'blockedPath' | 'suggestions' | 'suppressAlwaysAllowRule'>, cwd: string): Omit<ApprovalRequest, 'id' | 'at' | 'turnId' | 'itemId'> {
  const decisions: ApprovalDecision[] = options.suggestions?.length && !options.suppressAlwaysAllowRule ? ['allow', 'allow-session', 'deny', 'cancel'] : ['allow', 'deny', 'cancel'];
  const why = [options.description, options.decisionReason, options.blockedPath ? `It touches ${options.blockedPath}.` : ''].filter(Boolean) as string[];
  if (toolName === 'Bash') {
    const command = str(input.command);
    return {
      kind: 'command', title: command ? `Run ${clipLine(command, 80)}` : 'Run a command',
      ...(command ? { command } : {}),
      // Claude Code's description of a command is the command's own description (seen live): said once.
      ...(str(input.description) || why.length ? { detail: [...new Set([str(input.description), ...why].filter(Boolean))].join('\n\n') } : {}), cwd, decisions,
    };
  }
  if (FILE_TOOLS.has(toolName)) {
    const file = str(input.file_path) || str(input.notebook_path);
    // Claude Code's description of a file tool is the file's name, which the title says already.
    if (file && options.description && (options.description === relative(file, cwd) || file.endsWith(`/${options.description}`))) why.shift();
    return {
      kind: 'file-change', title: options.title || (file ? `${toolName === 'Write' ? 'Write' : 'Edit'} ${relative(file, cwd)}` : 'Change a file'),
      ...(why.length ? { detail: why.join('\n\n') } : {}), cwd, ...(file ? { files: [file] } : {}), decisions,
    };
  }
  if (toolName === 'ExitPlanMode') {
    const plan = str(input.plan);
    return {
      kind: 'other', title: 'Claude is ready to leave plan mode and start',
      ...(plan ? { plan: clip(plan, 20_000) } : why.length ? { detail: why.join('\n\n') } : {}), cwd, decisions: ['allow', 'deny', 'cancel'],
    };
  }
  if (toolName === 'EnterPlanMode') {
    // Claude asks to go into plan mode first (read and plan, change nothing, then ask to leave it with a plan).
    return { kind: 'other', title: 'Claude wants to plan first, in plan mode', ...(why.length ? { detail: why.join('\n\n') } : {}), cwd, decisions: ['allow', 'deny', 'cancel'] };
  }
  if (toolName === 'AskUserQuestion') {
    const questions = askQuestions(input);
    return { kind: 'question', title: clipLine(questions[0]?.question || questions[0]?.header || 'Claude has a question for you', 120), questions, cwd, decisions: ['deny', 'cancel'] };
  }
  const summary = toolInputSummary(toolName, input);
  return {
    kind: 'tool', title: options.title || `Use ${options.displayName || toolLabel(toolName)}`,
    detail: [summary, ...why].filter(Boolean).join('\n\n'), cwd, decisions,
  };
}

/**
 * The "allow for this session" answers given so far, as options for a query opened again (after the idle release,
 * new picks, or a change made in a Claude app): their allow rules as `allowedTools`, their folders as
 * `additionalDirectories`. Claude Code keeps session rules only in the process that was told them.
 */
export function sessionRuleOptions(updates: SdkPermissionUpdate[]): { allowedTools?: string[]; additionalDirectories?: string[]; permissionMode?: SdkPermissionMode } {
  const tools = new Set<string>();
  const dirs = new Set<string>();
  // An edit's "don't ask again" is a mode, not a rule (CLI 2.1.302: `{type:'setMode', mode:'acceptEdits'}`): the
  // last one given is the mode a query opened again starts in. Full access never comes this way.
  let mode: SdkPermissionMode | undefined;
  for (const u of updates) {
    if (u.type === 'setMode' && typeof u.mode === 'string' && SESSION_MODES.has(u.mode)) { mode = u.mode as SdkPermissionMode; continue; }
    if ((u.type === 'addRules' || u.type === 'replaceRules') && u.behavior === 'allow' && Array.isArray(u.rules)) {
      for (const rule of u.rules as { toolName?: unknown; ruleContent?: unknown }[]) {
        if (typeof rule?.toolName !== 'string' || !rule.toolName) continue;
        tools.add(typeof rule.ruleContent === 'string' && rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName);
      }
    } else if (u.type === 'addDirectories' && Array.isArray(u.directories)) {
      for (const d of u.directories) if (typeof d === 'string' && d) dirs.add(d);
    }
  }
  return { ...(tools.size ? { allowedTools: [...tools] } : {}), ...(dirs.size ? { additionalDirectories: [...dirs] } : {}), ...(mode ? { permissionMode: mode } : {}) };
}

const SESSION_MODES = new Set(['default', 'acceptEdits', 'plan', 'dontAsk', 'auto']);

// ---- Lists, models, limits.

export function nativeSession(info: SdkSessionInfo, cwd: string): NativeSession {
  return {
    sessionId: info.sessionId,
    title: info.customTitle?.trim() || clipLine(info.summary || info.firstPrompt || '', TITLE_MAX) || 'Untitled',
    preview: clipLine(info.firstPrompt || info.summary || '', 200),
    cwd: info.cwd || cwd,
    createdAt: info.createdAt ?? info.lastModified,
    updatedAt: info.lastModified,
  };
}

/**
 * Claude Code's models as the Journal lists them. Its "default" row is not a model of its own: the model it
 * resolves to is marked as the default instead (a null pick means "Claude Code's default").
 */
export function modelEntries(list: SdkModelInfo[]): ModelEntry[] {
  const fallback = list.find((m) => m.value === 'default');
  const out: ModelEntry[] = [];
  let marked = false;
  for (const m of list) {
    if (m.value === 'default') continue;
    const isDefault = !marked && !!fallback?.resolvedModel && m.resolvedModel === fallback.resolvedModel;
    if (isDefault) marked = true;
    out.push({
      id: m.value, label: m.displayName || m.value, ...(m.description ? { description: m.description } : {}),
      efforts: m.supportsEffort === false ? [] : [...(m.supportedEffortLevels ?? [])], defaultEffort: null, isDefault,
    });
  }
  if (!marked && out[0] && fallback) out[0].isDefault = true;
  return out;
}

const WINDOW_LABEL: Record<string, string> = {
  five_hour: '5 hours', seven_day: 'week', seven_day_opus: 'week (Opus)', seven_day_sonnet: 'week (Sonnet)',
  seven_day_overage_included: 'week', overage: 'extra usage',
};

type Window = LimitWindow & { type: string; rejected: boolean };

const percent = (utilization: unknown) => (typeof utilization === 'number' ? (utilization <= 1.5 ? utilization * 100 : utilization) : null);
const msOfEpoch = (at: unknown) => (typeof at === 'number' ? (at < 1e12 ? at * 1000 : at) : null);

/** One usage window from a rate_limit_event. utilization is read as a fraction when it is 1.5 or less. */
export function limitWindow(info: SdkRateLimitInfo): Window | null {
  const type = info.rateLimitType ?? 'unknown';
  const used = percent(info.utilization) ?? (info.status === 'rejected' ? 100 : null);
  if (used === null) return null;
  return { type, label: WINDOW_LABEL[type] ?? type.replace(/_/g, ' '), usedPercent: Math.round(used), resetsAt: msOfEpoch(info.resetsAt), rejected: info.status === 'rejected' };
}

/**
 * Every usage window a rate_limit_event tells of. Seen live (CLI 2.1.302, Max): the usage is not on the event
 * itself but per window in `unifiedWindows` (`{seven_day: {utilization: 0.21, resetsAt: <seconds>, status?}}`), with
 * `rateLimitType` naming the window `status` is about.
 */
export function limitWindows(info: SdkRateLimitInfo): Window[] {
  const out = new Map<string, Window>();
  const own = limitWindow(info);
  if (own) out.set(own.type, own);
  const unified = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : {};
  for (const [type, w] of Object.entries(unified)) {
    const used = percent(w?.utilization);
    if (used === null) continue;
    // CLI 2.1.326 gives each window its own status too.
    const rejected = w?.status === 'rejected' || (info.status === 'rejected' && info.rateLimitType === type);
    out.set(type, { type, label: WINDOW_LABEL[type] ?? type.replace(/_/g, ' '), usedPercent: Math.round(used), resetsAt: msOfEpoch(w?.resetsAt) ?? (type === info.rateLimitType ? msOfEpoch(info.resetsAt) : null), rejected });
  }
  return [...out.values()];
}

export function limitSummary(windows: Iterable<LimitWindow & { rejected: boolean }>): RateLimitSummary {
  const list = [...windows];
  return { windows: list.map(({ label, usedPercent, resetsAt }) => ({ label, usedPercent, resetsAt })), blocked: list.some((w) => w.rejected || w.usedPercent >= 100) };
}
