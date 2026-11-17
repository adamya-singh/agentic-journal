// From the Claude Agent SDK's shapes to the Journal's (src/lib/code-agents/protocol.ts). Pure: no SDK, no files.
// One TurnBuilder turns the messages of one turn into items, the same way for a turn running now (it then says what
// changed, as protocol events) and for a turn read back from the transcript, so both get the same item ids:
//   text and thinking blocks: `<API message id>:<block index>`; a tool call: its tool_use id; his message: its uuid.
import type {
  ApprovalDecision, ApprovalRequest, EventBody, FileEdit, ItemStatus, LimitWindow, ModelEntry, NativeSession, RateLimitSummary,
  SessionItem, SessionTurn, TurnStatus,
} from '../src/lib/code-agents/protocol.ts';
import { clipLine, clipOutput, TITLE_MAX } from '../src/lib/code-agents/protocol.ts';
import type {
  SdkCanUseToolOptions, SdkContentBlock, SdkMessage, SdkModelInfo, SdkPermissionUpdate, SdkRateLimitInfo, SdkSessionInfo, SdkSessionMessage, SdkStreamEvent,
} from './sdk-types.ts';

const INPUT_MAX = 400;
const RESULT_MAX = 2000;
const DIFF_MAX = 40_000;

/** What the bridge tells Claude when he declines or stops a tool from the Journal. */
export const DENY_MESSAGE = 'The user declined this from the Agentic Journal.';
export const STOP_MESSAGE = 'The user stopped this turn from the Agentic Journal.';

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

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
  if (name === 'WebSearch') return { ...base, kind: 'web-search', query: str(input.query), status: 'running' };
  if (name === 'WebFetch') return { ...base, kind: 'web-search', query: str(input.url), status: 'running' };
  return { ...base, kind: 'tool', name: toolLabel(name), input: toolInputSummary(name, input), result: '', status: 'running' };
}

/** A tool call, ended by its result. `own` is the tool's own output object (live turns only). */
export function toolDone(item: SessionItem, block: SdkContentBlock, own: unknown, declined: boolean, at: number | null, call?: SdkContentBlock, cwd = ''): SessionItem {
  const text = blocksText(block.content);
  const failed = block.is_error === true;
  const status: ItemStatus = declined || (failed && (text.startsWith(DENY_MESSAGE) || text.startsWith(STOP_MESSAGE) || /doesn['’]t want to proceed/.test(text))) ? 'declined' : failed ? 'failed' : 'done';
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
    default:
      return { ...item, ...ended };
  }
}

const RUNNING_KINDS = new Set(['command', 'file-change', 'tool', 'web-search']);

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
  private readonly cwd: string;
  private readonly emit: Emit | null;
  private readonly blockCount = new Map<string, number>();
  private readonly calls = new Map<string, SdkContentBlock>();
  private streamMessage: string | null = null;
  private readonly streamItems = new Map<number, string>();

  constructor(id: string, cwd: string, startedAt: number | null, emit?: Emit) {
    this.turn = { id, status: 'running', items: [], error: null, startedAt, endedAt: null };
    this.cwd = cwd;
    this.emit = emit ?? null;
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
      if (block?.type === 'text') { this.streamItems.set(event.index, id); this.put({ id, kind: 'agent', text: block.text ?? '', startedAt: at, endedAt: null }, 'item-started'); }
      else if (block?.type === 'thinking') { this.streamItems.set(event.index, id); this.put({ id, kind: 'reasoning', text: block.thinking ?? '', startedAt: at, endedAt: null }, 'item-started'); }
      else if (block?.type === 'tool_use' && block.id && !this.item(block.id)) this.put(toolItem(block, this.cwd, at), 'item-started');
      return;
    }
    if (event.type === 'content_block_delta') {
      const itemId = this.streamItems.get(event.index);
      const item = itemId ? this.item(itemId) : undefined;
      const delta = event.delta?.type === 'text_delta' ? event.delta.text : event.delta?.type === 'thinking_delta' ? event.delta.thinking : undefined;
      if (!item || !delta || (item.kind !== 'agent' && item.kind !== 'reasoning')) return;
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
        // The transcript keeps thinking signed but empty: nothing to show.
        if (!text && !had) continue;
        this.put({ id, kind: 'reasoning', text, startedAt: had?.startedAt ?? at, endedAt: at }, 'item-completed');
      } else if (block.type === 'tool_use' && block.id) {
        this.calls.set(block.id, block);
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
      const item = this.item(block.tool_use_id!);
      if (!item) continue;
      const done = toolDone(item, block, results.length === 1 ? own : undefined, this.declined.has(block.tool_use_id!), at, this.calls.get(block.tool_use_id!), this.cwd);
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

  /** Ends the turn. Tool calls still open end with it. Says nothing of the turn itself: the caller does. */
  finish(status: TurnStatus, error: string | null, limited: boolean, at: number | null): SessionTurn {
    for (const item of [...this.turn.items]) {
      if (!RUNNING_KINDS.has(item.kind) || (item as { status?: ItemStatus }).status !== 'running') continue;
      this.put({ ...item, status: status === 'done' ? 'done' : 'failed', endedAt: at } as SessionItem, 'item-completed');
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
export function historyTurns(messages: SdkSessionMessage[], cwd: string): SessionTurn[] {
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
        if (builder) builder.turn.status = 'interrupted';
        last = at ?? last;
        continue;
      }
      close();
      builder = new TurnBuilder(message.uuid, cwd, at);
      if (text.startsWith('<task-notification>') || (message.origin?.kind && message.origin.kind !== 'human' && message.origin.kind !== 'peer')) {
        builder.notice(message.uuid, 'info', 'A background task reported back.', at);
      } else builder.user(message.uuid, text, at);
      last = at;
      continue;
    }
    if (message.type === 'assistant') {
      if (!builder) builder = new TurnBuilder(message.uuid, cwd, at);
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
      ...(str(input.description) || why.length ? { detail: [str(input.description), ...why].filter(Boolean).join('\n\n') } : {}), cwd, decisions,
    };
  }
  if (FILE_TOOLS.has(toolName)) {
    const file = str(input.file_path) || str(input.notebook_path);
    return {
      kind: 'file-change', title: options.title || (file ? `${toolName === 'Write' ? 'Write' : 'Edit'} ${relative(file, cwd)}` : 'Change a file'),
      ...(why.length ? { detail: why.join('\n\n') } : {}), cwd, ...(file ? { files: [file] } : {}), decisions,
    };
  }
  if (toolName === 'ExitPlanMode') {
    return { kind: 'other', title: 'Claude is ready to leave plan mode and start', detail: clip(str(input.plan) || why.join('\n\n'), 4000), cwd, decisions: ['allow', 'deny', 'cancel'] };
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
export function sessionRuleOptions(updates: SdkPermissionUpdate[]): { allowedTools?: string[]; additionalDirectories?: string[] } {
  const tools = new Set<string>();
  const dirs = new Set<string>();
  for (const u of updates) {
    if ((u.type === 'addRules' || u.type === 'replaceRules') && u.behavior === 'allow' && Array.isArray(u.rules)) {
      for (const rule of u.rules as { toolName?: unknown; ruleContent?: unknown }[]) {
        if (typeof rule?.toolName !== 'string' || !rule.toolName) continue;
        tools.add(typeof rule.ruleContent === 'string' && rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName);
      }
    } else if (u.type === 'addDirectories' && Array.isArray(u.directories)) {
      for (const d of u.directories) if (typeof d === 'string' && d) dirs.add(d);
    }
  }
  return { ...(tools.size ? { allowedTools: [...tools] } : {}), ...(dirs.size ? { additionalDirectories: [...dirs] } : {}) };
}

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

/** One usage window from a rate_limit_event. utilization is read as a fraction when it is 1.5 or less. */
export function limitWindow(info: SdkRateLimitInfo): (LimitWindow & { type: string; rejected: boolean }) | null {
  const type = info.rateLimitType ?? 'unknown';
  const used = typeof info.utilization === 'number' ? (info.utilization <= 1.5 ? info.utilization * 100 : info.utilization) : info.status === 'rejected' ? 100 : null;
  if (used === null) return null;
  const resets = typeof info.resetsAt === 'number' ? (info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt) : null;
  return { type, label: WINDOW_LABEL[type] ?? type.replace(/_/g, ' '), usedPercent: Math.round(used), resetsAt: resets, rejected: info.status === 'rejected' };
}

export function limitSummary(windows: Iterable<LimitWindow & { rejected: boolean }>): RateLimitSummary {
  const list = [...windows];
  return { windows: list.map(({ label, usedPercent, resetsAt }) => ({ label, usedPercent, resetsAt })), blocked: list.some((w) => w.rejected || w.usedPercent >= 100) };
}
