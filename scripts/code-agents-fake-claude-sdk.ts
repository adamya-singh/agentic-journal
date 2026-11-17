// A stand-in for the Claude Agent SDK, for the Claude bridge tests: query() runs a script the test sets for each turn
// instead of Claude Code, and the session helpers read and write in-memory transcripts. The script emits the SDK
// messages a real turn would (stream events, assistant blocks, tool results, the result), asks permission through
// the bridge's canUseTool, and can wait for an interrupt or a message sent while it works.
// Shapes follow what the real CLI sent through the real SDK (2.1.302 and 2.1.326, 2026-11-17, recorded in the live
// check of docs/code-sessions-design.md): `REAL` below, the empty signed thinking it streams unless asked for
// summaries, `thinking_tokens`, `status` and `command_lifecycle` messages around a turn, tool calls streamed with an
// empty input first, a steer kept in the transcript as `isQueuedCommand`, and the words a stopped tool ends with.
// Not a test file itself (the runner only picks up *.test.ts).
import crypto from 'node:crypto';
import type {
  ClaudeSdk, SdkCanUseToolOptions, SdkContentBlock, SdkMessage, SdkModelInfo, SdkPermissionResult, SdkQuery, SdkQueryOptions, SdkSessionInfo,
  SdkSessionMessage, SdkUserInput,
} from '../bridge/sdk-types.ts';

export interface FakeTranscript {
  cwd: string;
  title?: string;
  archived?: boolean;
  messages: SdkSessionMessage[];
  extra: number;                      // bytes written by someone else (a Claude app)
}

export interface TurnContext {
  sessionId: string;
  input: SdkUserInput;
  options: SdkQueryOptions;
  /** Sends one SDK message out of the query; assistant and user messages also go into the transcript. */
  emit(message: Partial<SdkMessage> & { type: string }): void;
  /** A text block: streamed as deltas first when `stream` is set, then the whole assistant message. */
  text(messageId: string, text: string, options?: { stream?: boolean; index?: number }): void;
  /** A tool call (an assistant message with one tool_use block); `stream` sends its stream events first, as live. */
  tool(id: string, name: string, input: Record<string, unknown>, messageId?: string, options?: { stream?: boolean; index?: number }): void;
  /**
   * A thinking block as the real CLI streams it: its start, deltas, the signature and the whole message. Without
   * `--thinking-display summarized` the text is empty (only `thinking_tokens` estimates say it thinks).
   */
  thinking(messageId: string, summary: string, options?: { index?: number }): void;
  /** A tool cut short by Stop, as Claude Code ends it: the tool's error result in its own words. */
  stoppedTool(toolUseId: string): void;
  /** A tool's result (a user message with one tool_result block). */
  toolResult(toolUseId: string, content: string, options?: { isError?: boolean; own?: unknown }): void;
  /** Asks the bridge, as Claude Code asks its host. */
  ask(toolName: string, input: Record<string, unknown>, options?: Partial<SdkCanUseToolOptions>): Promise<SdkPermissionResult>;
  result(extra?: Partial<SdkMessage>): void;
  /** The way a real error turn ends: Claude Code's own message, an error result, then the iterator throws. */
  fail(text: string, kind?: string): never;
  /** Resolves when interrupt() is called on the query. */
  interrupted: Promise<void>;
  /** The next message sent into the query while this turn runs. */
  nextInput(): Promise<SdkUserInput>;
}

export type TurnScript = (ctx: TurnContext) => Promise<void>;

export interface FakeQueryRecord {
  options: SdkQueryOptions;
  inputs: SdkUserInput[];
  closed: boolean;
  interrupts: number;
}

export interface FakeClaudeSdk extends ClaudeSdk {
  transcripts: Map<string, FakeTranscript>;
  queries: FakeQueryRecord[];
  models: SdkModelInfo[];
  /** What the next turn does. Defaults to a one-line reply. */
  script: TurnScript;
  renames: [string, string][];
  /** Info leaves out the folder for these sessions (as the SDK does for a long first message). */
  hideCwd: Set<string>;
  /** A Claude app wrote to the session: his message there and its answer. */
  touchElsewhere(sessionId: string): void;
  /** Claude Code itself wrote to the transcript after a turn's result (a title, a summary): bytes, no message. */
  trailingWrite(sessionId: string): void;
  /** permissions.defaultMode in the user's settings and a project's committed settings (resolveSettings). */
  settings: { user?: string; project?: string; showThinkingSummaries?: boolean };
  /** The folders resolveSettings was asked about. */
  settingsAsked: string[];
}

class Inbox<T> {
  private items: T[] = [];
  private waiters: ((item: T | null) => void)[] = [];
  private ended = false;
  private emptied: (() => void)[] = [];
  put(item: T) { const w = this.waiters.shift(); if (w) w(item); else this.items.push(item); }
  /** Resolves once everything put has been taken (what the reader has seen, Claude Code has sent). */
  drained(): Promise<void> {
    if (!this.items.length) return new Promise((resolve) => setImmediate(resolve));
    return new Promise((resolve) => this.emptied.push(resolve));
  }
  end() { this.ended = true; for (const w of this.waiters.splice(0)) w(null); }
  take(): Promise<T | null> {
    if (this.items.length) {
      const item = this.items.shift()!;
      if (!this.items.length) for (const done of this.emptied.splice(0)) setImmediate(done);
      return Promise.resolve(item);
    }
    if (this.ended) return Promise.resolve(null);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}

/** Messages and option shapes as the real CLI sent them (2026-11-17), for the tests to use as they are. */
export const REAL = {
  /** What a tool cut short by Stop ends with (and a tool he refused in a Claude app). */
  stoppedText: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
  /** The transcript's mark after a Stop mid-tool. */
  interruptedText: '[Request interrupted by user for tool use]',
  /** canUseTool for a Write in default mode: "don't ask again" is a mode. */
  writeAsk: { suggestions: [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }], displayName: 'Write', description: 'x.txt' },
  /** canUseTool for a Bash command: rules for each part of it, offered for the local settings file. */
  bashAsk: {
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'touch y.txt' }, { toolName: 'Bash', ruleContent: 'rm y.txt' }], behavior: 'allow', destination: 'localSettings' }],
    decisionReasonType: 'subcommandResults', displayName: 'Bash', description: 'Create and remove y.txt',
  },
  /** canUseTool for ExitPlanMode: no suggestions. */
  exitPlanAsk: { displayName: 'ExitPlanMode', requiresUserInteraction: true },
  /** A rate_limit_event on a Max plan (2.1.326 adds each window's status). */
  rateLimit: {
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed', resetsAt: 1795244400, rateLimitType: 'seven_day', overageStatus: 'rejected', overageDisabledReason: 'org_level_disabled', isUsingOverage: false,
      unifiedWindows: { seven_day: { utilization: 0.21, resetsAt: 1795244400, status: 'allowed' } },
    },
  } as SdkMessage,
  /** TaskCreate's result: the text the transcript keeps, and the tool's own output live. */
  taskCreated: (id: string, subject: string) => ({ text: `Task #${id} created successfully: ${subject}`, own: { task: { id, subject } } }),
  taskUpdated: (id: string, from: string, to: string) => ({ text: `Updated task #${id} status`, own: { success: true, taskId: id, updatedFields: ['status'], statusChange: { from, to } } }),
};

const sizeOf = (t: FakeTranscript) => JSON.stringify(t.messages).length + t.extra + (t.title?.length ?? 0);

export function createFakeClaudeSdk(): FakeClaudeSdk {
  const transcripts = new Map<string, FakeTranscript>();
  const queries: FakeQueryRecord[] = [];

  const fake: FakeClaudeSdk = {
    transcripts,
    queries,
    renames: [],
    hideCwd: new Set(),
    models: [
      { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: 'Use the default model', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
      { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku', description: 'Haiku 5.5', supportsEffort: false },
    ],
    script: async (ctx) => { ctx.text(`msg_${crypto.randomUUID().slice(0, 8)}`, 'ok'); ctx.result(); },
    touchElsewhere(sessionId) {
      const t = transcripts.get(sessionId);
      if (!t) return;
      const at = new Date().toISOString();
      t.messages.push({ type: 'user', uuid: crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null, timestamp: at, message: { role: 'user', content: 'Asked in the app' } });
      t.messages.push({ type: 'assistant', uuid: crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null, timestamp: at, message: { role: 'assistant', content: [{ type: 'text', text: 'Answered in the app' }] } });
    },
    trailingWrite(sessionId) { const t = transcripts.get(sessionId); if (t) t.extra += 40; },
    settings: {},
    settingsAsked: [],
    async resolveSettings({ cwd } = {}) {
      fake.settingsAsked.push(cwd ?? '');
      const { user, project, showThinkingSummaries } = fake.settings;
      const mode = project ?? user;
      return {
        effective: { ...(mode ? { permissions: { defaultMode: mode } } : {}), ...(showThinkingSummaries !== undefined ? { showThinkingSummaries } : {}) },
        sources: [...(user ? [{ source: 'user', settings: { permissions: { defaultMode: user } } }] : []), ...(project ? [{ source: 'project', settings: { permissions: { defaultMode: project } } }] : [])],
      };
    },
    filterEscalatingDefaultMode(resolved) {
      // As the CLI: an escalating mode from a repo's committed settings is dropped (the user's own then holds).
      const { user, project } = fake.settings;
      if (project && ['bypassPermissions', 'auto', 'acceptEdits'].includes(project)) return user ? { permissions: { defaultMode: user } } : {};
      return resolved.effective;
    },

    query({ prompt, options }): SdkQuery {
      const record: FakeQueryRecord = { options, inputs: [], closed: false, interrupts: 0 };
      queries.push(record);
      const out = new Inbox<SdkMessage | { thrown: Error }>();
      const inbox = new Inbox<SdkUserInput>();
      let interruptNow: (() => void) | null = null;
      let interrupted = new Promise<void>((resolve) => { interruptNow = resolve; });
      const abort = new AbortController();
      const sessionId = options.resume ?? options.sessionId ?? crypto.randomUUID();
      const persist = options.persistSession !== false;

      const transcript = (): FakeTranscript => {
        let t = transcripts.get(sessionId);
        if (!t) { t = { cwd: options.cwd, ...(options.title ? { title: options.title } : {}), messages: [], extra: 0 }; if (persist) transcripts.set(sessionId, t); }
        return t;
      };
      const write = (message: SdkMessage) => {
        if (!persist || (message.type !== 'user' && message.type !== 'assistant') || !message.message) return;
        transcript().messages.push({ type: message.type, uuid: message.uuid ?? crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: message.parent_tool_use_id ?? null, timestamp: new Date().toISOString(), message: message.message });
      };
      const send = (message: Partial<SdkMessage> & { type: string }) => {
        const full = { session_id: sessionId, uuid: crypto.randomUUID(), parent_tool_use_id: null, ...message } as SdkMessage;
        write(full);
        out.put(full);
      };

      // Reads what the bridge sends in, and runs one turn per message (others wait, or are taken by the turn).
      void (async () => {
        if (options.resume && !transcripts.has(options.resume)) { out.put({ thrown: new Error(`No conversation found with session ID: ${options.resume}`) }); return; }
        const reader = (async () => { for await (const input of prompt) { record.inputs.push(input); inbox.put(input); } inbox.end(); })();
        while (true) {
          const input = await inbox.take();
          if (!input) break;
          const t = transcript();
          t.messages.push({ type: 'user', uuid: input.uuid ?? crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null, timestamp: new Date().toISOString(), message: input.message });
          send({ type: 'command_lifecycle', command_uuid: input.uuid, state: 'started' });
          send({ type: 'system', subtype: 'init', model: 'claude-opus-5-5', permissionMode: options.permissionMode ?? 'default', claude_code_version: '2.1.326', apiKeySource: 'none', cwd: options.cwd });
          send({ type: 'system', subtype: 'status', status: 'requesting', user_message_uuids: [input.uuid] });
          const ctx: TurnContext = {
            sessionId, input, options,
            emit: send,
            text(messageId, text, opts = {}) {
              const index = opts.index ?? 0;
              if (opts.stream) {
                send({ type: 'stream_event', event: { type: 'message_start', message: { id: messageId } } });
                send({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } });
                const half = Math.ceil(text.length / 2);
                for (const part of [text.slice(0, half), text.slice(half)]) if (part) send({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: part } } });
                send({ type: 'stream_event', event: { type: 'content_block_stop', index } });
              }
              send({ type: 'assistant', message: { id: messageId, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'text', text }] } });
            },
            tool(id, name, input, messageId = `msg_${id}`, opts = {}) {
              if (opts.stream) {
                const index = opts.index ?? 0;
                if (!index) send({ type: 'stream_event', event: { type: 'message_start', message: { id: messageId } } });
                send({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'tool_use', id, name, input: {}, caller: { type: 'direct' } } as SdkContentBlock } });
                send({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } } });
              }
              send({ type: 'assistant', message: { id: messageId, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
            },
            thinking(messageId, summary, opts = {}) {
              const index = opts.index ?? 0;
              if (!index) send({ type: 'stream_event', event: { type: 'message_start', message: { id: messageId } } });
              send({ type: 'stream_event', event: { type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } as SdkContentBlock } });
              send({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, estimated_tokens_delta: 50, user_message_uuid: input.uuid });
              send({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: '' } } });
              if (summary) send({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: summary } } });
              send({ type: 'stream_event', event: { type: 'content_block_delta', index, delta: { type: 'signature_delta' } } });
              send({ type: 'assistant', message: { id: messageId, model: 'claude-opus-5-5', role: 'assistant', content: [{ type: 'thinking', thinking: summary, signature: 'sig' } as SdkContentBlock] } });
              send({ type: 'stream_event', event: { type: 'content_block_stop', index } });
            },
            stoppedTool(toolUseId) {
              send({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: REAL.stoppedText, is_error: true }] }, tool_result_meta: [{ id: toolUseId, non_execution_kind: 'user-rejected' }] });
              transcript().messages.push({ type: 'user', uuid: crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null, timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text: REAL.interruptedText }] } });
            },
            toolResult(toolUseId, content, opts = {}) {
              const block: SdkContentBlock = { type: 'tool_result', tool_use_id: toolUseId, content, ...(opts.isError ? { is_error: true } : {}) };
              send({ type: 'user', message: { role: 'user', content: [block] }, ...(opts.own !== undefined ? { tool_use_result: opts.own } : {}) });
            },
            async ask(toolName, toolInput, extra = {}) {
              if (!options.canUseTool) throw new Error('no canUseTool');
              // Claude Code asks after the tool call it asks about has gone out.
              await out.drained();
              return options.canUseTool(toolName, toolInput, { signal: abort.signal, toolUseID: extra.toolUseID ?? `toolu_${crypto.randomUUID().slice(0, 6)}`, requestId: crypto.randomUUID(), ...extra });
            },
            result(extra = {}) {
              send({ type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 10, output_tokens: 5 }, modelUsage: { 'claude-opus-5-5': { contextWindow: 200000 } }, ...extra });
              send({ type: 'command_lifecycle', command_uuid: input.uuid, state: 'completed' });
            },
            fail(text, kind = 'server_error') {
              send({ type: 'assistant', error: kind, message: { id: `err_${crypto.randomUUID().slice(0, 6)}`, model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }] } });
              send({ type: 'result', subtype: 'success', is_error: true, result: text });
              throw Object.assign(new Error(`Claude Code returned an error result: ${text}`), { fatal: true });
            },
            interrupted,
            async nextInput() {
              const next = await inbox.take();
              if (!next) throw new Error('the query ended');
              // Taken into the running turn: the transcript marks it (CLI 2.1.302, "absorbed mid-turn").
              transcript().messages.push({ type: 'user', uuid: next.uuid ?? crypto.randomUUID(), session_id: sessionId, parent_tool_use_id: null, timestamp: new Date().toISOString(), message: next.message, isQueuedCommand: true });
              return next;
            },
          };
          try {
            await fake.script(ctx);
          } catch (error) {
            out.put({ thrown: error as Error });
            return;
          }
          interrupted = new Promise<void>((resolve) => { interruptNow = resolve; });
          ctx.interrupted = interrupted;
        }
        await reader;
        out.end();
      })();

      const iterator: AsyncIterator<SdkMessage> = {
        async next() {
          if (record.closed) return { done: true, value: undefined };
          const item = await out.take();
          if (!item || record.closed) return { done: true, value: undefined };
          if ('thrown' in item) throw item.thrown;
          return { done: false, value: item };
        },
      };
      return {
        [Symbol.asyncIterator]: () => iterator,
        async interrupt() { record.interrupts++; interruptNow?.(); abort.abort(); return undefined; },
        close() { record.closed = true; abort.abort(); out.end(); inbox.end(); },
        async supportedModels() { return fake.models; },
        async accountInfo() { return { subscriptionType: 'max', tokenSource: 'claude.ai' }; },
      };
    },

    async listSessions({ dir, limit }) {
      const list: SdkSessionInfo[] = [];
      for (const [id] of transcripts) {
        const info = await fake.getSessionInfo(id, { dir });
        if (info && (!dir || info.cwd === dir)) list.push(info);
      }
      return list.slice(0, limit ?? 50);
    },

    async getSessionInfo(sessionId, opts) {
      const t = transcripts.get(sessionId);
      if (!t || (opts?.dir && t.cwd !== opts.dir)) return undefined;
      const first = t.messages.find((m) => m.type === 'user');
      const firstPrompt = typeof first?.message.content === 'string' ? first.message.content : '';
      return {
        sessionId, summary: t.title ?? firstPrompt, lastModified: Date.now(), fileSize: sizeOf(t), firstPrompt, createdAt: Date.now() - 1000,
        ...(t.title ? { customTitle: t.title } : {}), ...(fake.hideCwd.has(sessionId) && !opts?.dir ? {} : { cwd: t.cwd }), ...(t.archived ? { archived: true } : {}),
      };
    },

    async getSessionMessages(sessionId) {
      return [...(transcripts.get(sessionId)?.messages ?? [])];
    },

    async renameSession(sessionId, title) {
      const t = transcripts.get(sessionId);
      if (!t) throw new Error('no such session');
      t.title = title;
      fake.renames.push([sessionId, title]);
    },

    async archiveSession(sessionId) {
      const t = transcripts.get(sessionId);
      if (t) t.archived = true;
    },
  };
  return fake;
}
