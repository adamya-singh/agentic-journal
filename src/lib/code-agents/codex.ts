// The Codex adapter: Codex sessions ("threads") through Codex's own app server, the server the Codex desktop app
// and the VS Code extension use. On this laptop a Codex daemon is always running and shared with the desktop app,
// so threads made here are native Codex threads, listed in `codex resume` and the apps. Without the daemon, a
// private `codex app-server` child is started instead (its turns end when the Journal stops).
// Everything Codex-specific lives here; the hub sees only protocol.ts. Wire types: codex-types.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApprovalGoneError, type AdapterConfig, type AgentAdapter, type HistoryPage, type LoginStarted, type NativeState, type ResumeResult } from './adapter';
import type {
  CodexAccountReadResult, CodexApprovalDecision, CodexAskForApproval, CodexCommandApprovalParams, CodexConfigReadResult, CodexElicitationParams,
  CodexFileChangeApprovalParams, CodexInitializeResult, CodexLoginCancelResult, CodexLoginStartResult, CodexModel, CodexModelListResult, CodexNotificationParams,
  CodexPermissionsApprovalParams, CodexRateLimitSnapshot, CodexRateLimitsReadResult, CodexSandboxMode, CodexSandboxPolicy,
  CodexThread, CodexThreadItem, CodexThreadListResult, CodexThreadResumeResult, CodexThreadStartResult, CodexThreadStatus,
  CodexTurn, CodexTurnStartResult, CodexTurnSteerResult, CodexTurnsListResult, CodexUserInputParams, CodexUserInputQuestion, CodexPermissionProfile,
} from './codex-types';
import {
  clipLine, clipOutput, formContent, formQuestions, isExplicitMode, PERMISSION_MAPPING, TITLE_MAX,
  type AgentQuestion, type AgentStatus, type ApprovalDecision, type ApprovalRequest, type ItemStatus, type LimitWindow, type ModelEntry,
  type NativeSession, type OwnSettings, type QuestionAnswers, type RateLimitSummary, type SessionItem, type SessionPicks, type SessionTurn, type TurnStatus,
} from './protocol';
import { expandHome, isRemote, probeDevice, REMOTE, sshCommand, sshPipe } from './ssh';
import { connectRpc, RPC_METHOD_NOT_FOUND, RpcError, stdioJsonlTransport, unixSocketTransport, webSocketTransport, type MessageTransport, type RpcClient, type RpcId } from './transport';
import { machineName } from '@/lib/proj-hosts';

const CLIENT_INFO = { name: 'agentic_journal', title: 'Agentic Journal', version: '0.1.0' };
const MODELS_TTL_MS = 5 * 60_000;
/** config.toml read for what "its own settings" are; kept a minute (per folder: a project can add a layer). */
const OWN_TTL_MS = 60_000;
const INPUT_MAX = 400;
const RESULT_MAX = 2000;

/** The daemon's control socket. CODEX_APP_SERVER_SOCKET points elsewhere (the tests' fake server). */
export function codexSocketPath(): string {
  return process.env.CODEX_APP_SERVER_SOCKET || path.join(os.homedir(), '.codex', 'app-server-control', 'app-server-control.sock');
}

const CHILD_ENV_KEYS = new Set(['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TZ', 'TMPDIR', 'SSH_AUTH_SOCK', 'CODEX_HOME']);

/**
 * What a `codex app-server` child of the Journal runs with: the basics a shell needs (home, path, user, language,
 * the XDG folders, the ssh agent, CODEX_HOME), never the Journal's own settings and secrets (what Next loaded from
 * .env: API keys, tokens).
 */
export function codexChildEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (CHILD_ENV_KEYS.has(key) || key.startsWith('XDG_') || key.startsWith('LC_')) out[key] = value;
  }
  return out;
}

/**
 * How to reach Codex: its daemon's socket when there is one; otherwise a `codex app-server` child of the Journal,
 * unless CODEX_APP_SERVER_FALLBACK=none (the tests, so they never start a real Codex).
 */
export function codexTransport(): MessageTransport | null {
  const socket = codexSocketPath();
  if (fs.existsSync(socket)) return unixSocketTransport(socket, 'codex');
  if (process.env.CODEX_APP_SERVER_FALLBACK === 'none') return null;
  return stdioJsonlTransport({ label: 'codex app-server', command: process.env.CODEX_CLI_PATH || 'codex', args: ['app-server'], env: codexChildEnv() as NodeJS.ProcessEnv });
}

/**
 * How to reach Codex on another device, over ssh (ssh.ts): its daemon through `codex app-server proxy` when one runs
 * there (the WebSocket the daemon speaks, carried on ssh's stdio, so threads are shared with that device's Codex
 * apps), else `codex app-server` there on stdio for as long as the connection lasts. The `codex` is the one the look
 * found: on the PATH, else an app's own copy. Throws why it cannot.
 */
export async function remoteCodexTransport(host: string): Promise<MessageTransport> {
  const device = await probeDevice(host);
  if (!device.reachable) throw new Error(device.reason ?? `${machineName(host)} can’t be reached.`);
  if (!device.codex) throw new Error(`Codex isn’t installed on ${machineName(host)} (no \`codex\` in its login shell’s PATH, and none of the Codex or ChatGPT apps’ own copies).`);
  // `bin`: Codex is not on its PATH there but an app carries its own (the Mac's ChatGPT.app); that copy is run.
  const bin = device.codex.bin;
  if (device.codex.daemon) {
    return webSocketTransport({ label: `codex on ${host}`, url: 'ws://codex/', openTimeoutMs: 25_000, createConnection: () => sshPipe(host, REMOTE.codexProxy(bin)) });
  }
  // WSL with Codex's home in Windows' own folder (CODEX_HOME=/mnt/c/…): an app server started there cannot open its
  // state over the Windows mount (checked on the PC, 2026-11-17: "failed to initialize sqlite state runtime"), and the
  // Windows Codex app writes the same files. Nothing is started; he can point CODEX_HOME at a WSL folder or run a daemon.
  if (/^\/mnt\/[a-z]\//i.test(device.codex.home ?? '')) {
    throw new Error(`Codex on ${machineName(host)} keeps its state in Windows’ folder (${device.codex.home}), where no Codex app server can run from WSL, and no Codex daemon runs there. Set CODEX_HOME to a folder inside WSL, or start a daemon with \`codex app-server daemon start\` there.`);
  }
  const run = sshCommand(host, REMOTE.codexStdio(bin));
  return stdioJsonlTransport({ label: `codex app-server on ${host}`, ...run });
}

// ---- From Codex's shapes to the Journal's.

const ms = (seconds: number | null | undefined) => (typeof seconds === 'number' ? seconds * 1000 : null);

function itemStatus(status: string | undefined): ItemStatus {
  if (status === 'completed') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'declined') return 'declined';
  return 'running';
}

function turnStatus(status: string | undefined): TurnStatus {
  if (status === 'completed') return 'done';
  if (status === 'interrupted') return 'interrupted';
  if (status === 'failed') return 'failed';
  return 'running';
}

const compact = (value: unknown, limit: number) => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
};

/** Text parts of a list of content blocks ({type:'text'|'inputText', text}); other blocks are named. */
function contentText(blocks: unknown[] | null | undefined): string {
  if (!Array.isArray(blocks)) return '';
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return '';
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (typeof text === 'string') return text;
    return typeof type === 'string' ? `[${type}]` : '';
  }).filter(Boolean).join('\n');
}

/**
 * A command as he would have typed it. Codex runs every command as `/bin/bash -lc '<script>'` (the script quoted
 * in single and double quotes as it needs); its own apps show the script, so the Journal does too. A command that
 * is not one quoted word after `-lc` comes back as it is.
 */
export function unwrapShell(command: string): string {
  const head = /^(?:\/usr)?(?:\/bin\/)?(?:bash|zsh|sh) -l?c /.exec(command);
  if (!head) return command;
  const rest = command.slice(head[0].length);
  let out = '';
  for (let i = 0; i < rest.length;) {
    const c = rest[i]!;
    if (c === "'") {
      const end = rest.indexOf("'", i + 1);
      if (end < 0) return command;
      out += rest.slice(i + 1, end);
      i = end + 1;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < rest.length && rest[j] !== '"'; j++) {
        if (rest[j] === '\\' && j + 1 < rest.length && '"\\$`\n'.includes(rest[j + 1]!)) { out += rest[j + 1]; j++; } else out += rest[j];
      }
      if (j >= rest.length) return command;
      i = j + 1;
    } else if (c === '\\' && i + 1 < rest.length) {
      out += rest[i + 1];
      i += 2;
    } else if (/\s/.test(c)) {
      return command;   // more than one word: not a plain wrapper
    } else {
      out += c;
      i += 1;
    }
  }
  return out.trim() ? out : command;
}

// ---- Questions.

/** The tool Codex asks a question with when it does not wait for the answer (its id is in the answer's message). */
const ASYNC_QUESTION_TOOL = 'request_user_input_async';
const REPLY_OPEN = '<send_user_message_question_reply>';
const REPLY_CLOSE = '</send_user_message_question_reply>';
/** What the Codex app says started the turn of such an answer (`turn_trigger` in its rollouts). */
export const QUESTION_REPLY_TRIGGER = 'send_user_message_async_question';

/** A question of request_user_input_async. Its options are labels only; a free-text answer is always allowed. */
function asyncQuestion(q: { title: string; options: string[] | null }, index: number): AgentQuestion {
  return { id: String(index), question: q.title ?? '', options: (q.options ?? []).filter((o) => typeof o === 'string' && o).map((label) => ({ label })), other: true };
}

/** A question of request_user_input (Plan mode), which waits for the answer. */
export function userInputQuestion(q: CodexUserInputQuestion): AgentQuestion {
  return {
    id: q.id, question: q.question ?? '', ...(q.header ? { header: q.header } : {}),
    options: (q.options ?? []).map((o) => ({ label: o.label, ...(o.description ? { description: o.description } : {}) })),
    // With no options, the answer can only be written.
    other: q.isOther === true || !(q.options ?? []).length,
    ...(q.isSecret ? { secret: true } : {}),
  };
}

/**
 * His answer to an async question as the message the Codex app sends for it (seen in its rollouts, 0.169.0): each
 * question named by `["request_user_input_async", <the question item's id>, <its place>]`, with its words and the answer.
 */
export function questionReplyText(itemId: string, entries: { questionId: string; question: string; answer: string }[]): string {
  const list = entries.map((e) => ({ questionItemId: JSON.stringify([ASYNC_QUESTION_TOOL, itemId, Number(e.questionId) || 0]), question: e.question, answer: e.answer }));
  return `${REPLY_OPEN}\n${JSON.stringify(list)}\n${REPLY_CLOSE}\n`;
}

/** The answers in such a message, or null when it is not one. */
export function parseQuestionReply(text: string): { itemId: string; questionId: string; question: string; answer: string }[] | null {
  const t = text.trim();
  if (!t.startsWith(REPLY_OPEN) || !t.endsWith(REPLY_CLOSE)) return null;
  try {
    const list = JSON.parse(t.slice(REPLY_OPEN.length, t.length - REPLY_CLOSE.length).trim()) as unknown;
    if (!Array.isArray(list)) return null;
    const out: { itemId: string; questionId: string; question: string; answer: string }[] = [];
    for (const entry of list as { questionItemId?: unknown; question?: unknown; answer?: unknown }[]) {
      const ref = typeof entry?.questionItemId === 'string' ? JSON.parse(entry.questionItemId) as unknown : null;
      if (!Array.isArray(ref) || typeof ref[1] !== 'string') continue;
      out.push({ itemId: ref[1], questionId: String(ref[2] ?? 0), question: typeof entry.question === 'string' ? entry.question : '', answer: typeof entry.answer === 'string' ? entry.answer : '' });
    }
    return out.length ? out : null;
  } catch {
    return null;
  }
}

/** What more a command asks to reach, in words. */
function permissionsWords(profile: CodexPermissionProfile | null | undefined): string {
  const parts: string[] = [];
  if (profile?.network?.enabled) parts.push('Network access');
  const fs = profile?.fileSystem;
  if (fs?.write?.length) parts.push(`Write: ${fs.write.join(', ')}`);
  if (fs?.read?.length) parts.push(`Read: ${fs.read.join(', ')}`);
  if (!fs?.write?.length && !fs?.read?.length && fs?.entries?.length) parts.push(`Files: ${fs.entries.map((e) => (e && typeof e === 'object' && 'path' in e ? String((e as { path: unknown }).path) : JSON.stringify(e))).join(', ')}`);
  return parts.join('\n');
}

/** What was asked, granted as asked: only the parts it asked for (a null part is left out). */
function granted(profile: CodexPermissionProfile | null | undefined): Record<string, unknown> {
  return {
    ...(profile?.network ? { network: profile.network } : {}),
    ...(profile?.fileSystem ? { fileSystem: profile.fileSystem } : {}),
  };
}

/** One Codex thread item as a Journal item. Kinds Codex adds later become a short notice rather than being lost. */
export function codexItem(item: CodexThreadItem): SessionItem {
  const base = { id: item.id, startedAt: item.startedAtMs ?? null, endedAt: item.completedAtMs ?? null };
  switch (item.type) {
    case 'userMessage': {
      const text = (item.content ?? []).map((part) => {
        if (part.type === 'text') return part.text;
        if (part.type === 'localImage') return `[image: ${part.path}]`;
        if (part.type === 'image') return '[image]';
        if (part.type === 'skill' || part.type === 'mention') return `@${part.name}`;
        return `[${part.type}]`;
      }).join('\n');
      // His answer to a question Codex asked without waiting: shown as the answer, tied to the question.
      const reply = parseQuestionReply(text);
      if (reply) return { ...base, kind: 'user', text: reply.map((r) => r.answer).join('\n'), answers: reply.map(({ itemId, questionId, answer }) => ({ itemId, questionId, answer })) };
      return { ...base, kind: 'user', text };
    }
    case 'agentMessage':
      // A question asked with request_user_input_async: Codex goes on (or ends the turn) without waiting, and the
      // answer comes as his next message. Its `text` is the same question as plain text (the question, then a bullet
      // per option), for a client that cannot show it.
      if (item.delivery === 'async' && item.questions?.length) {
        return { ...base, kind: 'question', via: 'reply', questions: item.questions.map(asyncQuestion), text: item.text ?? '', answers: null, status: 'done' };
      }
      return { ...base, kind: 'agent', text: item.text ?? '' };
    case 'reasoning':
      return { ...base, kind: 'reasoning', text: (item.summary?.length ? item.summary : item.content ?? []).join('\n\n') };
    case 'plan':
      return { ...base, kind: 'plan', text: item.text ?? '', steps: [] };
    case 'commandExecution':
      return { ...base, kind: 'command', command: unwrapShell(item.command ?? ''), cwd: item.cwd ?? '', output: clipOutput(item.aggregatedOutput ?? ''), exitCode: item.exitCode ?? null, status: itemStatus(item.status), durationMs: item.durationMs ?? null };
    case 'fileChange':
      return {
        ...base, kind: 'file-change', status: itemStatus(item.status),
        files: (item.changes ?? []).map((change) => ({
          path: change.path,
          change: change.kind?.type === 'add' ? 'add' : change.kind?.type === 'delete' ? 'delete' : 'update',
          ...(change.kind?.type === 'update' && change.kind.move_path ? { movedTo: change.kind.move_path } : {}),
          diff: change.diff ?? '',
        })),
      };
    case 'mcpToolCall':
      return {
        ...base, kind: 'tool', name: `${item.server}.${item.tool}`, input: compact(item.arguments, INPUT_MAX), status: itemStatus(item.status),
        result: item.error?.message ? `Error: ${item.error.message}` : compact(contentText(item.result?.content) || item.result?.structuredContent, RESULT_MAX),
      };
    case 'dynamicToolCall':
      return {
        ...base, kind: 'tool', name: item.namespace ? `${item.namespace}.${item.tool}` : item.tool, input: compact(item.arguments, INPUT_MAX),
        status: item.status === 'completed' && item.success === false ? 'failed' : itemStatus(item.status), result: compact(contentText(item.contentItems), RESULT_MAX),
      };
    case 'functionCallOutput':
      return { ...base, kind: 'tool', name: item.namespace ? `${item.namespace}.${item.name}` : item.name, input: '', status: 'done', result: compact(typeof item.output === 'string' ? item.output : contentText(item.output), RESULT_MAX) };
    case 'collabAgentToolCall':
      return { ...base, kind: 'tool', name: `agent.${item.tool}`, input: compact(item.prompt, INPUT_MAX), status: itemStatus(item.status), result: (item.receiverThreadIds ?? []).join(', ') };
    case 'webSearch': {
      const action = item.action;
      const query = item.query || (action?.type === 'search' ? action.query ?? action.queries?.join(' · ') : action?.type === 'open_page' || action?.type === 'find_in_page' ? action.url : '') || '';
      return { ...base, kind: 'web-search', query, status: base.endedAt ? 'done' : 'running' };
    }
    case 'imageView':
      return { ...base, kind: 'tool', name: 'view image', input: item.path, status: 'done', result: '' };
    case 'imageGeneration':
      return { ...base, kind: 'tool', name: 'image generation', input: compact(item.revisedPrompt, INPUT_MAX), status: item.status === 'failed' ? 'failed' : item.savedPath || item.status === 'completed' ? 'done' : 'running', result: item.savedPath ?? '' };
    case 'sleep':
      return { ...base, kind: 'notice', level: 'info', text: `Waited ${Math.round((item.durationMs ?? 0) / 1000)} s.` };
    case 'hookPrompt':
      return { ...base, kind: 'notice', level: 'info', text: `A hook added: ${clipLine((item.fragments ?? []).map((f) => f.text).join(' '), 300)}` };
    case 'subAgentActivity':
      return { ...base, kind: 'notice', level: 'info', text: `Sub-agent ${item.agentPath}: ${item.kind}` };
    case 'enteredReviewMode':
      return { ...base, kind: 'notice', level: 'info', text: `Review started: ${clipLine(item.review ?? '', 300)}` };
    case 'exitedReviewMode':
      return { ...base, kind: 'notice', level: 'info', text: `Review finished: ${clipLine(item.review ?? '', 300)}` };
    case 'contextCompaction':
      return { ...base, kind: 'notice', level: 'info', text: 'The conversation was compacted to fit.' };
    default: {
      const unknown = item as { id?: unknown; type?: unknown };
      return { ...base, id: typeof unknown.id === 'string' ? unknown.id : `item-${Date.now()}`, kind: 'notice', level: 'info', text: `(${String(unknown.type)})` };
    }
  }
}

/** The agent hit its usage limit (or rate limit): what it says is the whole story, and retrying will not help yet. */
function limitedBy(error: { codexErrorInfo?: unknown } | null | undefined): boolean {
  return error?.codexErrorInfo === 'usageLimitExceeded' || error?.codexErrorInfo === 'rateLimitExceeded';
}

export function codexTurn(turn: CodexTurn): SessionTurn {
  return {
    id: turn.id,
    status: turnStatus(turn.status),
    items: (turn.items ?? []).map(codexItem),
    error: turn.error?.message ?? null,
    ...(limitedBy(turn.error) ? { limited: true } : {}),
    startedAt: ms(turn.startedAt),
    endedAt: ms(turn.completedAt),
  };
}

export function codexNativeState(status: CodexThreadStatus | undefined): NativeState {
  switch (status?.type) {
    case 'idle': return 'idle';
    case 'systemError': return 'failed';
    case 'active': return status.activeFlags?.length ? 'needs-you' : 'working';
    default: return 'not-loaded';
  }
}

function windowLabel(minutes: number | null): string {
  if (!minutes) return 'window';
  if (minutes % 10080 === 0) return minutes === 10080 ? 'week' : `${minutes / 10080} weeks`;
  if (minutes % 1440 === 0) return minutes === 1440 ? 'day' : `${minutes / 1440} days`;
  if (minutes % 60 === 0) return minutes === 60 ? 'hour' : `${minutes / 60} hours`;
  return `${minutes} minutes`;
}

export function codexLimits(snapshot: CodexRateLimitSnapshot | null | undefined, ordinaryUsageAllowed?: boolean | null): RateLimitSummary | undefined {
  if (!snapshot) return undefined;
  const windows: LimitWindow[] = [snapshot.primary, snapshot.secondary]
    .filter((w): w is NonNullable<typeof w> => !!w && typeof w.usedPercent === 'number')
    .map((w) => ({ label: windowLabel(w.windowDurationMins), usedPercent: w.usedPercent, resetsAt: ms(w.resetsAt) }));
  return { windows, blocked: ordinaryUsageAllowed === false || !!snapshot.rateLimitReachedType || windows.some((w) => w.usedPercent >= 100) };
}

export function codexModel(model: CodexModel): ModelEntry {
  return {
    id: model.id,
    label: model.displayName || model.id,
    ...(model.description ? { description: model.description } : {}),
    efforts: (model.supportedReasoningEfforts ?? []).map((e) => e.reasoningEffort),
    defaultEffort: model.defaultReasoningEffort ?? null,
    isDefault: model.isDefault === true,
  };
}

export function codexNative(thread: CodexThread): NativeSession {
  const source = typeof thread.source === 'string' ? thread.source : thread.source && typeof thread.source === 'object' ? Object.keys(thread.source)[0] : undefined;
  return {
    sessionId: thread.id,
    title: thread.name?.trim() || clipLine(thread.preview ?? '', TITLE_MAX) || 'Untitled',
    preview: clipLine(thread.preview ?? '', 200),
    cwd: thread.cwd,
    createdAt: (thread.createdAt ?? 0) * 1000,
    updatedAt: (thread.updatedAt ?? 0) * 1000,
    ...(source ? { source } : {}),
  };
}

type WorkspaceWrite = NonNullable<NonNullable<CodexConfigReadResult['config']>['sandbox_workspace_write']>;

/** The sandbox a mode runs in, as turn/start takes it. A workspace-write sandbox takes config.toml's own settings for it when it has them. */
export function sandboxPolicy(mode: CodexSandboxMode, workspace?: WorkspaceWrite | null): CodexSandboxPolicy {
  if (mode === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (mode === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite', writableRoots: workspace?.writable_roots ?? [], networkAccess: workspace?.network_access ?? false,
    excludeTmpdirEnvVar: workspace?.exclude_tmpdir_env_var ?? false, excludeSlashTmp: workspace?.exclude_slash_tmp ?? false,
  };
}

/** An approval policy and a sandbox: what a thread runs with, or what a turn asks for. */
export interface CodexPolicy { approvalPolicy: CodexAskForApproval; sandbox: CodexSandboxMode }

/** What a thread runs with, from Codex's own record of it (thread/start, thread/resume): sandbox as a mode or a policy. */
export function policyOf(approvalPolicy: unknown, sandbox: unknown): CodexPolicy | undefined {
  const type = sandbox && typeof sandbox === 'object' ? (sandbox as { type?: unknown }).type : sandbox;
  const mode = type === 'dangerFullAccess' ? 'danger-full-access' : type === 'readOnly' ? 'read-only' : type === 'workspaceWrite' ? 'workspace-write' : type;
  if (mode !== 'danger-full-access' && mode !== 'read-only' && mode !== 'workspace-write') return undefined;
  if (approvalPolicy === null || approvalPolicy === undefined) return undefined;
  if (typeof approvalPolicy !== 'string' && typeof approvalPolicy !== 'object') return undefined;
  return { approvalPolicy: approvalPolicy as CodexAskForApproval, sandbox: mode };
}

const samePolicy = (a: CodexPolicy | undefined, b: CodexPolicy | undefined) =>
  !!a && !!b && a.sandbox === b.sandbox && JSON.stringify(a.approvalPolicy) === JSON.stringify(b.approvalPolicy);

/** config.toml's approval policy as one word for the picker: a granular policy is "granular". */
const policyWord = (policy: CodexAskForApproval | null | undefined): string | null =>
  policy === null || policy === undefined ? null : typeof policy === 'string' ? policy : 'granular';

const CODEX_DECISION: Record<ApprovalDecision, CodexApprovalDecision> = { allow: 'accept', 'allow-session': 'acceptForSession', deny: 'decline', cancel: 'cancel' };

interface HeldApproval {
  rpcId: RpcId; method: string; threadId: string; turnId: string | null;
  questions?: AgentQuestion[];       // a question (request_user_input, an MCP form)
  schema?: unknown;                  // an MCP form's own schema, for the values it wants back
  itemId?: string;                   // the question's item in the log, ended with his answer
  askedAt?: number;                  // when it was asked (ms): the item's start
  permissions?: CodexPermissionProfile | null;
}
/**
 * What a thread runs with, as Codex last said (thread/start, thread/resume) or as the Journal last sent it: its
 * model, effort, approval policy and sandbox, and its folder (for config.toml's project layers).
 */
interface Applied { model: string | undefined; effort: string | undefined; policy: CodexPolicy | undefined; cwd: string | undefined; collab?: string | undefined }
type OwnConfig = { policy: CodexPolicy | undefined; own: OwnSettings; workspace: WorkspaceWrite | null };

let approvalCounter = 0;

export function createCodexAdapter(config: AdapterConfig): AgentAdapter {
  const { host, sink } = config;
  const remote = isRemote(host);
  /** A folder as Codex there knows it: `~/…` (how the proj registry writes another device's folders) in full. */
  const there = async (cwd: string) => (remote && cwd.startsWith('~') ? expandHome(cwd, (await probeDevice(host)).home) : cwd);
  let client: RpcClient | null = null;
  let connecting: Promise<RpcClient> | null = null;
  let version: string | undefined;
  let modelCache: { at: number; list: ModelEntry[] } | null = null;
  const joined = new Set<string>();                       // threads this connection has started or resumed
  const applied = new Map<string, Applied>();             // what each thread last ran with, as far as this process knows
  const approvals = new Map<string, HeldApproval>();      // Journal approval id → the server's request
  const byRpc = new Map<string, string>();                // the server's request id → Journal approval id
  const reasoningPart = new Map<string, number>();        // reasoning item id → the summary part its deltas are on
  const patchFiles = new Map<string, string[]>();          // file-change item id → its paths (its approval names none)
  const ownCache = new Map<string, { at: number; config: OwnConfig }>();   // folder ('' for none) → config.toml's permissions
  const logins = new Set<string>();                       // sign-ins started on this connection, not ended yet

  const askApproval = (rpcId: RpcId, method: string, threadId: string, approval: Omit<ApprovalRequest, 'id' | 'at'>, extra: Partial<HeldApproval> = {}) => {
    const id = `cx${Date.now().toString(36)}${(approvalCounter++).toString(36)}`;
    approvals.set(id, { rpcId, method, threadId, turnId: approval.turnId, ...extra });
    byRpc.set(String(rpcId), id);
    sink.event(threadId, { type: 'approval-asked', approval: { ...approval, id, at: Date.now() } });
  };

  /** A waiting question's item in the log, ended: with his answers, or settled elsewhere (answers unknown), or declined. */
  const endQuestion = (held: HeldApproval, answers: QuestionAnswers | null, status: ItemStatus) => {
    if (!held.itemId || !held.questions || !held.turnId) return;
    sink.event(held.threadId, { type: 'item-completed', turnId: held.turnId, item: { id: held.itemId, kind: 'question', via: 'ask', questions: held.questions, text: held.questions.map((q) => q.question).join('\n'), answers, status, startedAt: held.askedAt ?? null, endedAt: Date.now() } });
  };

  const onRequest = (rpc: RpcClient, id: RpcId, method: string, raw: unknown) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    switch (method) {
      case 'item/commandExecution/requestApproval': {
        const q = p as unknown as CodexCommandApprovalParams;
        const command = unwrapShell(q.command ?? '');
        askApproval(id, method, q.threadId, {
          turnId: q.turnId ?? null, itemId: q.itemId ?? null, kind: 'command',
          title: command ? `Run ${clipLine(command, 80)}` : 'Run a command',
          ...(command ? { command } : {}),
          ...(q.reason ? { detail: q.reason } : {}),
          ...(q.cwd ? { cwd: q.cwd } : {}),
          decisions: ['allow', 'allow-session', 'deny', 'cancel'],
        });
        return;
      }
      case 'item/fileChange/requestApproval': {
        const q = p as unknown as CodexFileChangeApprovalParams;
        askApproval(id, method, q.threadId, {
          turnId: q.turnId ?? null, itemId: q.itemId ?? null, kind: 'file-change',
          title: q.grantRoot ? `Write files under ${q.grantRoot}` : 'Change files',
          ...(q.reason ? { detail: q.reason } : {}),
          // The request names no files: they are on the item, which a page read anew has not got (history lists
          // only finished items), so its paths come along.
          ...(patchFiles.get(q.itemId)?.length ? { files: patchFiles.get(q.itemId) } : {}),
          decisions: ['allow', 'allow-session', 'deny', 'cancel'],
        });
        return;
      }
      case 'item/permissions/requestApproval': {
        // More access for a command (network, folders outside the sandbox): granted as asked, for the turn or the session.
        const q = p as unknown as CodexPermissionsApprovalParams;
        const wants = permissionsWords(q.permissions);
        askApproval(id, method, q.threadId, {
          turnId: q.turnId ?? null, itemId: q.itemId ?? null, kind: 'other', title: 'Codex asks for more access',
          ...([q.reason, wants].filter(Boolean).length ? { detail: [q.reason, wants].filter(Boolean).join('\n\n') } : {}), ...(q.cwd ? { cwd: q.cwd } : {}),
          decisions: ['allow', 'allow-session', 'deny', 'cancel'],
        }, { permissions: q.permissions ?? null });
        return;
      }
      case 'item/tool/requestUserInput': {
        // request_user_input, offered to the model in Plan mode only: it waits for the answer.
        const q = p as unknown as CodexUserInputParams;
        const questions = (q.questions ?? []).map(userInputQuestion);
        const itemId = `ask-${q.itemId ?? String(id)}`;
        const turnId = q.turnId ?? null;
        // The question stays in the turn as an item, so what he answered is there to see after it is settled.
        const askedAt = Date.now();
        if (turnId) sink.event(q.threadId, { type: 'item-started', turnId, item: { id: itemId, kind: 'question', via: 'ask', questions, text: questions.map((x) => x.question).join('\n'), answers: null, status: 'running', startedAt: askedAt, endedAt: null } });
        askApproval(id, method, q.threadId, {
          turnId, itemId, kind: 'question', title: clipLine(questions[0]?.question || questions[0]?.header || 'Codex has a question for you', 120),
          questions, decisions: ['deny', 'cancel'],
        }, { questions, itemId, askedAt });
        return;
      }
      case 'mcpServer/elicitation/request': {
        // An MCP server asks for something: a form (as questions), or a page to open (a sign-in).
        const q = p as unknown as CodexElicitationParams;
        const questions = q.mode === 'url' ? null : formQuestions(q.requestedSchema);
        const base = { turnId: q.turnId ?? null, itemId: null, ...(q.message ? { detail: q.message } : {}) };
        if (q.mode === 'url' && q.url) {
          askApproval(id, method, q.threadId, { ...base, kind: 'other', title: `${q.serverName} asks you to open a page`, link: q.url, decisions: ['allow', 'deny', 'cancel'] });
        } else if (questions) {
          askApproval(id, method, q.threadId, { ...base, kind: 'question', title: `${q.serverName} asks for input`, questions, decisions: ['deny', 'cancel'] }, { questions, schema: q.requestedSchema });
        } else {
          askApproval(id, method, q.threadId, { ...base, kind: 'tool', title: `${q.serverName} asks for input`, decisions: ['deny', 'cancel'], elsewhere: true });
        }
        return;
      }
      case 'currentTime/read':
        // The experimental API asks the client for the time (a turn's clock).
        try { rpc.respond(id, { currentTimeAt: Math.floor(Date.now() / 1000) }); } catch { /* the connection is gone */ }
        return;
      case 'execCommandApproval':
      case 'applyPatchApproval': {
        // The old protocol's approvals; v2 threads use the ones above. Shown, and only declinable here.
        const threadId = typeof p.conversationId === 'string' ? p.conversationId : '';
        const command = Array.isArray(p.command) ? p.command.join(' ') : '';
        askApproval(id, method, threadId, { turnId: null, itemId: typeof p.callId === 'string' ? p.callId : null, kind: method === 'execCommandApproval' ? 'command' : 'file-change', title: method === 'execCommandApproval' ? `Run ${clipLine(command, 80)}` : 'Change files', ...(method === 'execCommandApproval' && command ? { command } : {}), decisions: ['deny', 'cancel'], elsewhere: true });
        return;
      }
      default:
        // Tools the Journal never offered, and the login and attestation calls the desktop app answers.
        try { rpc.respondError(id, RPC_METHOD_NOT_FOUND, `The Agentic Journal does not handle ${method}.`); } catch { /* the connection is gone */ }
    }
  };

  const onNotification = (method: string, raw: unknown) => {
    const p = raw as never;
    switch (method) {
      case 'turn/started': {
        const q = p as CodexNotificationParams['turn/started'];
        sink.event(q.threadId, { type: 'turn-started', turnId: q.turn.id, at: ms(q.turn.startedAt) ?? Date.now() });
        return;
      }
      case 'turn/completed': {
        const q = p as CodexNotificationParams['turn/completed'];
        sink.event(q.threadId, { type: 'turn-completed', turnId: q.turn.id, status: turnStatus(q.turn.status), error: q.turn.error?.message ?? null, ...(limitedBy(q.turn.error) ? { limited: true } : {}), at: ms(q.turn.completedAt) ?? Date.now() });
        return;
      }
      case 'item/started':
      case 'item/completed': {
        const q = p as CodexNotificationParams['item/started'];
        if (!q.item) return;
        const item = codexItem(q.item);
        if (method === 'item/completed') { reasoningPart.delete(item.id); patchFiles.delete(item.id); }
        else if (item.kind === 'file-change') patchFiles.set(item.id, item.files.map((f) => f.path));
        sink.event(q.threadId, { type: method === 'item/started' ? 'item-started' : 'item-completed', turnId: q.turnId, item });
        return;
      }
      case 'item/agentMessage/delta':
      case 'item/plan/delta': {
        const q = p as CodexNotificationParams['item/agentMessage/delta'];
        sink.event(q.threadId, { type: 'item-delta', turnId: q.turnId, itemId: q.itemId, field: 'text', delta: q.delta ?? '' });
        return;
      }
      case 'item/reasoning/summaryTextDelta': {
        const q = p as CodexNotificationParams['item/reasoning/summaryTextDelta'];
        const part = reasoningPart.get(q.itemId);
        reasoningPart.set(q.itemId, q.summaryIndex ?? 0);
        const gap = part !== undefined && (q.summaryIndex ?? 0) > part ? '\n\n' : '';
        sink.event(q.threadId, { type: 'item-delta', turnId: q.turnId, itemId: q.itemId, field: 'text', delta: gap + (q.delta ?? '') });
        return;
      }
      case 'item/commandExecution/outputDelta': {
        const q = p as CodexNotificationParams['item/commandExecution/outputDelta'];
        sink.event(q.threadId, { type: 'item-delta', turnId: q.turnId, itemId: q.itemId, field: 'output', delta: q.delta ?? '' });
        return;
      }
      case 'item/fileChange/patchUpdated': {
        const q = p as CodexNotificationParams['item/fileChange/patchUpdated'];
        patchFiles.set(q.itemId, (q.changes ?? []).map((c) => c.path));
        sink.event(q.threadId, { type: 'item-updated', turnId: q.turnId, item: codexItem({ type: 'fileChange', id: q.itemId, changes: q.changes ?? [], status: 'inProgress' }) });
        return;
      }
      case 'turn/plan/updated': {
        const q = p as CodexNotificationParams['turn/plan/updated'];
        sink.event(q.threadId, {
          type: 'item-updated', turnId: q.turnId,
          item: {
            id: `plan-${q.turnId}`, kind: 'plan', text: '',
            steps: (q.plan ?? []).map((s) => ({ text: s.step, status: s.status === 'completed' ? 'done' : s.status === 'inProgress' ? 'running' : 'pending' })),
            ...(q.explanation ? { explanation: q.explanation } : {}),
          },
        });
        return;
      }
      case 'turn/diff/updated': {
        const q = p as CodexNotificationParams['turn/diff/updated'];
        sink.event(q.threadId, { type: 'turn-diff', turnId: q.turnId, diff: q.diff ?? '' });
        return;
      }
      case 'thread/tokenUsage/updated': {
        const q = p as CodexNotificationParams['thread/tokenUsage/updated'];
        const u = q.tokenUsage;
        if (!u?.total) return;
        sink.event(q.threadId, { type: 'usage-changed', tokens: { total: u.total.totalTokens, input: u.total.inputTokens, output: u.total.outputTokens, contextWindow: u.modelContextWindow ?? null, ...(u.last ? { lastTurn: u.last.totalTokens } : {}) } });
        return;
      }
      case 'thread/name/updated': {
        const q = p as CodexNotificationParams['thread/name/updated'];
        if (q.threadName) sink.event(q.threadId, { type: 'title-changed', title: q.threadName });
        return;
      }
      case 'thread/status/changed': {
        const q = p as CodexNotificationParams['thread/status/changed'];
        sink.nativeState(q.threadId, codexNativeState(q.status));
        return;
      }
      case 'error': {
        // A failure that ends the turn arrives again with turn/completed; only one Codex retries is worth a line.
        const q = p as CodexNotificationParams['error'];
        if (q.willRetry && q.turnId) sink.event(q.threadId, { type: 'item-updated', turnId: q.turnId, item: { id: `retry-${q.turnId}`, kind: 'notice', level: 'warning', text: `Retrying: ${clipLine(q.error?.message ?? 'Codex hit an error', 300)}` } });
        return;
      }
      case 'serverRequest/resolved': {
        const q = p as CodexNotificationParams['serverRequest/resolved'];
        const approvalId = byRpc.get(String(q.requestId));
        const held = approvalId ? approvals.get(approvalId) : undefined;
        if (!approvalId || !held) return;
        approvals.delete(approvalId);
        byRpc.delete(String(q.requestId));
        // One answered here is gone from the list already: this one the desktop app (or Codex) settled.
        sink.event(held.threadId, { type: 'approval-resolved', approvalId, decision: null, by: 'elsewhere' });
        endQuestion(held, null, 'done');
        return;
      }
      case 'account/rateLimits/updated': {
        const q = p as CodexNotificationParams['account/rateLimits/updated'];
        const limits = codexLimits(q.rateLimits);
        if (limits) sink.limits(limits);
        return;
      }
      case 'account/login/completed': {
        // Only a sign-in this connection started (the desktop app's own end here too).
        const q = p as CodexNotificationParams['account/login/completed'];
        if (!q.loginId || !logins.delete(q.loginId)) return;
        modelCache = null;
        sink.login({ loginId: q.loginId, state: q.success ? 'done' : 'failed', ...(q.success ? {} : { error: clipLine(q.error || 'Codex could not sign in.', 300) }) });
        return;
      }
      default:
        // configWarning, warning, remoteControl/status/changed, account/updated, mcpServer/startupStatus/updated, ...
        return;
    }
  };

  const dropped = (reason: string) => {
    client = null;
    joined.clear();
    reasoningPart.clear();
    patchFiles.clear();
    for (const [approvalId, held] of approvals) sink.event(held.threadId, { type: 'approval-resolved', approvalId, decision: null, by: 'lost' });
    approvals.clear();
    byRpc.clear();
    for (const loginId of logins) sink.login({ loginId, state: 'failed', error: 'The connection to Codex dropped while you were signing in. Try again.' });
    logins.clear();
    sink.connection(false, reason);
  };

  const rpc = async (): Promise<RpcClient> => {
    if (client && !client.closed) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      const transport = remote ? await remoteCodexTransport(host) : codexTransport();
      if (!transport) throw new Error('Codex is not running here: its app server has no socket.');
      const next = await connectRpc(transport);
      next.onNotification(onNotification);
      next.onRequest((id, method, params) => onRequest(next, id, method, params));
      try {
        // The experimental API: Codex's own apps use it, and without it a thread cannot be put in Plan mode, the one
        // mode whose model is offered request_user_input (the question that waits for its answer).
        const init = await next.request<CodexInitializeResult>('initialize', { clientInfo: CLIENT_INFO, capabilities: { experimentalApi: true } }, { timeoutMs: 10_000 });
        version = /\/(\d+\.\d+\.\d+)/.exec(init?.userAgent ?? '')?.[1];
        next.notify('initialized', {});
      } catch (error) {
        next.close();
        throw error;
      }
      next.onClose(dropped);
      client = next;
      sink.connection(true);
      return next;
    })();
    try { return await connecting; } finally { connecting = null; }
  };

  const models = async (): Promise<ModelEntry[]> => {
    if (modelCache && Date.now() - modelCache.at < MODELS_TTL_MS) return modelCache.list;
    const c = await rpc();
    const list: ModelEntry[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const answer: CodexModelListResult = await c.request<CodexModelListResult>('model/list', { limit: 100, ...(cursor ? { cursor } : {}) });
      for (const m of answer?.data ?? []) if (!m.hidden) list.push(codexModel(m));
      cursor = answer?.nextCursor ?? null;
      if (!cursor) break;
    }
    // A thread with no model or effort picked runs on what config.toml says, which can differ from the model list's
    // own defaults (config: gpt-6.1-sol at medium; the list: low). The default the Journal names is the real one.
    try {
      const config = (await c.request<CodexConfigReadResult>('config/read', {}))?.config;
      const model = typeof config?.model === 'string' ? list.find((m) => m.id === config.model) : undefined;
      if (model) for (const m of list) m.isDefault = m === model;
      const effort = config?.model_reasoning_effort;
      const def = list.find((m) => m.isDefault);
      if (def && typeof effort === 'string' && (def.efforts.length === 0 || def.efforts.includes(effort))) def.defaultEffort = effort;
    } catch { /* an older Codex without config/read: the list's own defaults */ }
    modelCache = { at: Date.now(), list };
    return list;
  };

  /**
   * What config.toml says about permissions (for a folder, with its project layers): what `own` comes to. A value it
   * does not set is unknown, and then the Journal says nothing to Codex about it.
   */
  const ownConfig = async (asked?: string | null): Promise<OwnConfig> => {
    const cwd = asked ? await there(asked) : asked;
    const key = cwd ?? '';
    const have = ownCache.get(key);
    if (have && Date.now() - have.at < OWN_TTL_MS) return have.config;
    const c = await rpc();
    const config = (await c.request<CodexConfigReadResult>('config/read', cwd ? { cwd } : {}))?.config ?? null;
    const approvalPolicy = config?.approval_policy ?? null;
    const sandbox = config?.sandbox_mode ?? null;
    const out: OwnConfig = {
      policy: policyOf(approvalPolicy, sandbox),
      own: { approvalPolicy: policyWord(approvalPolicy), sandbox },
      workspace: config?.sandbox_workspace_write ?? null,
    };
    ownCache.set(key, { at: Date.now(), config: out });
    return out;
  };

  const join = async (threadId: string): Promise<CodexThreadResumeResult> => {
    const c = await rpc();
    const answer = await c.request<CodexThreadResumeResult>('thread/resume', { threadId, excludeTurns: true });
    joined.add(threadId);
    // What the thread runs with now, in Codex's own record: its last turn's model, effort, approval policy and sandbox
    // (a turn's picks stay with the thread, and the desktop app may have run one since).
    applied.set(threadId, {
      model: answer.model || undefined, effort: answer.reasoningEffort || undefined, policy: policyOf(answer.approvalPolicy, answer.sandbox), cwd: answer.thread?.cwd || undefined,
      // Its collaboration mode (Plan or Default), which the experimental API reports; unknown from an older Codex.
      collab: typeof answer.collaborationMode?.mode === 'string' ? answer.collaborationMode.mode : undefined,
    });
    return answer;
  };

  /** The turn running in a thread now, if one is. */
  const runningTurn = async (threadId: string): Promise<string | null> => {
    const c = await rpc();
    const page = await c.request<CodexTurnsListResult>('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' });
    const last = page?.data?.[0];
    return last && last.status === 'inProgress' ? last.id : null;
  };

  return {
    agent: 'codex',
    host,
    async connect() { await rpc(); },
    get connected() { return !!client && !client.closed; },
    close() { client?.close(); },

    async status(): Promise<AgentStatus> {
      let c: RpcClient;
      try {
        c = await rpc();
      } catch (error) {
        const why = error instanceof Error ? error.message : String(error);
        // Another device's reason names the device already ("PC can’t be reached: …").
        return { agent: 'codex', host, state: 'offline', reason: remote ? why : `Codex can’t be reached: ${why}` };
      }
      const status: AgentStatus = { agent: 'codex', host, state: 'ready', ...(version ? { version } : {}) };
      try {
        const account = await c.request<CodexAccountReadResult>('account/read', { refreshToken: false });
        if (!account?.account) return { ...status, state: 'signed-out', reason: remote ? `Codex isn’t signed in on ${machineName(host)}. Sign in here, or run \`codex login\` in a terminal there.` : 'Codex isn’t signed in on this device. Sign in here, or run `codex login` in a terminal.' };
        status.account = account.account.type === 'chatgpt'
          ? { kind: 'subscription', plan: account.account.planType }
          : { kind: account.account.type === 'apiKey' ? 'api-key' : 'other' };
      } catch (error) {
        return { ...status, state: 'offline', reason: `Codex did not say who is signed in: ${error instanceof Error ? error.message : String(error)}` };
      }
      try {
        const limits = await c.request<CodexRateLimitsReadResult>('account/rateLimits/read');
        const summary = codexLimits(limits?.rateLimits, limits?.ordinaryUsageAllowed);
        if (summary) status.limits = summary;
      } catch { /* an API-key login has no limits to read */ }
      return status;
    },

    models,

    async listNative(asked, limit = 50) {
      const c = await rpc();
      const cwd = await there(asked);
      const answer = await c.request<CodexThreadListResult>('thread/list', { cwd, limit, sortKey: 'updated_at', archived: false });
      // thread/list can name a thread more than once; the first is the most recent.
      const seen = new Set<string>();
      const out: NativeSession[] = [];
      for (const thread of answer?.data ?? []) {
        if (!thread?.id || seen.has(thread.id)) continue;
        seen.add(thread.id);
        out.push(codexNative(thread));
      }
      return out;
    },

    async start({ cwd: given, picks, title }) {
      const c = await rpc();
      const cwd = await there(given);
      // Its own settings: nothing is said, so the thread runs on config.toml's approval policy and sandbox, as one
      // started in the Codex app does. An explicit mode is said.
      const asked = isExplicitMode(picks.mode) ? PERMISSION_MAPPING[picks.mode].codex : null;
      const answer = await c.request<CodexThreadStartResult>('thread/start', { cwd, ...(asked ? { approvalPolicy: asked.approvalPolicy, sandbox: asked.sandbox } : {}), ...(picks.model ? { model: picks.model } : {}) });
      const threadId = answer.thread.id;
      joined.add(threadId);
      applied.set(threadId, {
        model: answer.model || undefined, effort: answer.reasoningEffort || undefined,
        policy: policyOf(answer.approvalPolicy, answer.sandbox) ?? (asked ? { approvalPolicy: asked.approvalPolicy, sandbox: asked.sandbox } : undefined),
        cwd: answer.thread.cwd || cwd,
      });
      let named = answer.thread.name ?? title;
      if (title) {
        try { await c.request('thread/name/set', { threadId, name: title }); named = title; } catch (error) { console.warn('codex: could not name the thread:', error instanceof Error ? error.message : error); }
      }
      return { sessionId: threadId, title: named || title };
    },

    async resume(sessionId): Promise<ResumeResult> {
      const answer = await join(sessionId);
      let state = codexNativeState(answer.thread?.status);
      let turnId: string | null = null;
      if (state === 'working' || state === 'needs-you') {
        turnId = await runningTurn(sessionId);
        if (!turnId) state = 'idle';
      }
      return { state, turnId, title: answer.thread?.name ?? null, cwd: answer.thread?.cwd ?? null };
    },

    async history(sessionId, cursor, limit = 20): Promise<HistoryPage> {
      const c = await rpc();
      const page = await c.request<CodexTurnsListResult>('thread/turns/list', { threadId: sessionId, limit, sortDirection: 'desc', itemsView: 'full', ...(cursor ? { cursor } : {}) });
      return { turns: (page?.data ?? []).map(codexTurn).reverse(), older: page?.nextCursor ?? null };
    },

    async send(sessionId, text, picks: SessionPicks, options) {
      if (!joined.has(sessionId)) await join(sessionId);
      const c = await rpc();
      const had: Applied = applied.get(sessionId) ?? { model: undefined, effort: undefined, policy: undefined, cwd: undefined };
      const params: Record<string, unknown> = { threadId: sessionId, input: [{ type: 'text', text, text_elements: [] }], ...(options?.trigger ? { turnTrigger: options.trigger } : {}) };
      // Codex keeps a turn's overrides for the turns after it, so what the thread runs with is said whenever it is
      // not what he picked. No pick means Codex's default (config.toml's, as the picker names it), not whatever an
      // earlier pick left on the thread: saying nothing would keep that.
      let list: ModelEntry[] = [];
      try { list = await models(); } catch { /* without the list, only explicit picks are said */ }
      const model = picks.model ?? list.find((m) => m.isDefault)?.id;
      const effort = picks.effort ?? list.find((m) => m.id === model)?.defaultEffort ?? undefined;
      if (model && model !== had.model) params.model = model;
      if (effort && effort !== had.effort) params.effort = effort;
      // The same for permissions. An explicit mode is said when the thread runs on something else. Its own settings
      // say nothing while the thread runs on them (a thread started with them, or already moved back); only a thread
      // left on another mode (picked earlier, or run so in the Codex app) is told config.toml's own values, the one
      // way back to them. When config.toml does not say, nothing is said.
      let target: CodexPolicy | undefined;
      let workspace: WorkspaceWrite | null = null;
      if (isExplicitMode(picks.mode)) target = PERMISSION_MAPPING[picks.mode].codex;
      else {
        try { ({ policy: target, workspace } = await ownConfig(had.cwd)); } catch { /* unknown: say nothing */ }
      }
      if (target && !samePolicy(target, had.policy)) {
        params.approvalPolicy = target.approvalPolicy;
        params.sandboxPolicy = sandboxPolicy(target.sandbox, workspace);
      }
      // "Plan only" is Codex's own Plan mode too (a collaboration mode, kept for the turns after it, like the rest):
      // there Codex plans before it acts and may ask him questions it waits on. Any other pick takes a thread the
      // Journal or the Codex app left in Plan mode back to Default. The mode names the model and effort it runs with.
      const collab = picks.mode === 'plan' ? 'plan' : 'default';
      const collabModel = model ?? had.model;
      if (collabModel && collab !== had.collab && (collab === 'plan' || had.collab === 'plan')) {
        params.collaborationMode = { mode: collab, settings: { model: collabModel, reasoning_effort: effort ?? had.effort ?? null, developer_instructions: null } };
      }
      const answer = await c.request<CodexTurnStartResult>('turn/start', params);
      applied.set(sessionId, { model: model ?? had.model, effort: effort ?? had.effort, policy: target ?? had.policy, cwd: had.cwd, collab: params.collaborationMode ? collab : had.collab });
      return { turnId: answer.turn.id };
    },

    async steer(sessionId, turnId, text) {
      if (!joined.has(sessionId)) await join(sessionId);
      const c = await rpc();
      const answer = await c.request<CodexTurnSteerResult>('turn/steer', { threadId: sessionId, input: [{ type: 'text', text, text_elements: [] }], expectedTurnId: turnId });
      return { turnId: answer?.turnId ?? turnId };
    },

    async interrupt(sessionId, turnId) {
      if (!joined.has(sessionId)) await join(sessionId);
      const c = await rpc();
      await c.request('turn/interrupt', { threadId: sessionId, turnId });
    },

    async answer(approvalId, decision) {
      // Taken off the list before anything else, with no wait between: a second answer to the same request (a
      // double press, two windows) finds it gone, so Codex is answered once. The request belongs to the connection
      // it came on; with that one gone, it was reported lost already.
      const held = approvals.get(approvalId);
      if (!held) throw new ApprovalGoneError();
      const c = client;
      if (!c || c.closed) throw new Error('The connection it was asked on is gone.');
      approvals.delete(approvalId);
      byRpc.delete(String(held.rpcId));
      let result: unknown;
      switch (held.method) {
        case 'item/commandExecution/requestApproval':
        case 'item/fileChange/requestApproval':
          result = { decision: CODEX_DECISION[decision] };
          break;
        case 'item/permissions/requestApproval':
          // Allowed: what it asked for, for this turn or the rest of the session. Otherwise nothing is granted.
          result = decision === 'allow' || decision === 'allow-session' ? { permissions: granted(held.permissions), scope: decision === 'allow-session' ? 'session' : 'turn' } : { permissions: {}, scope: 'turn' };
          break;
        case 'item/tool/requestUserInput':
          // Not answered: no answers (Codex goes on without them). "Skip and stop" stops the turn too, below.
          result = { answers: {} };
          break;
        case 'mcpServer/elicitation/request':
          result = { action: decision === 'cancel' ? 'cancel' : decision === 'allow' ? 'accept' : 'decline', content: null, _meta: null };
          break;
        default:
          result = { decision: decision === 'cancel' ? 'abort' : { denied: { rejection: 'Declined from the Agentic Journal.' } } };
      }
      try {
        c.respond(held.rpcId, result);
      } catch (error) {
        sink.event(held.threadId, { type: 'approval-resolved', approvalId, decision: null, by: 'lost' });
        throw error;
      }
      sink.event(held.threadId, { type: 'approval-resolved', approvalId, decision, by: 'journal' });
      if (held.questions) {
        endQuestion(held, null, 'declined');
        if (decision === 'cancel' && held.method === 'item/tool/requestUserInput' && held.turnId) {
          await c.request('turn/interrupt', { threadId: held.threadId, turnId: held.turnId }).catch(() => undefined);
        }
      }
    },

    async answerQuestion(approvalId, answers) {
      const held = approvals.get(approvalId);
      if (!held) throw new ApprovalGoneError();
      if (!held.questions) throw new Error('That is not a question.');
      const c = client;
      if (!c || c.closed) throw new Error('The connection it was asked on is gone.');
      approvals.delete(approvalId);
      byRpc.delete(String(held.rpcId));
      const result = held.method === 'mcpServer/elicitation/request'
        ? { action: 'accept', content: formContent(held.schema, held.questions, answers), _meta: null }
        // request_user_input: each question's answers as words: the options chosen, then what he wrote.
        : { answers: Object.fromEntries(held.questions.map((q) => [q.id, { answers: [...(answers[q.id]?.picked ?? []), ...(answers[q.id]?.other?.trim() ? [answers[q.id]!.other!.trim()] : [])] }])) };
      try {
        c.respond(held.rpcId, result);
      } catch (error) {
        sink.event(held.threadId, { type: 'approval-resolved', approvalId, decision: null, by: 'lost' });
        throw error;
      }
      sink.event(held.threadId, { type: 'approval-resolved', approvalId, decision: 'allow', by: 'journal' });
      // A secret answer is not kept in the log.
      endQuestion(held, Object.fromEntries(held.questions.map((q) => [q.id, q.secret ? { picked: [], other: '••••' } : answers[q.id] ?? { picked: [] }])), 'done');
    },

    questionReply(itemId, entries) {
      return { text: questionReplyText(itemId, entries), trigger: QUESTION_REPLY_TRIGGER };
    },

    async rename(sessionId, title) {
      const c = await rpc();
      await c.request('thread/name/set', { threadId: sessionId, name: title });
    },

    async archive(sessionId) {
      const c = await rpc();
      await c.request('thread/archive', { threadId: sessionId });
      joined.delete(sessionId);
    },

    async ownSettings(cwd) {
      return (await ownConfig(cwd)).own;
    },

    async loginStart(): Promise<LoginStarted> {
      // The device-code way: a link and a code he enters there, from any device; nothing opens a browser here.
      const c = await rpc();
      const answer = await c.request<CodexLoginStartResult>('account/login/start', { type: 'chatgptDeviceCode' }, { timeoutMs: 30_000 });
      if (answer?.type !== 'chatgptDeviceCode' || !('verificationUrl' in answer) || !answer.loginId || !answer.verificationUrl || !answer.userCode) {
        throw new Error('Codex did not offer a code to sign in with.');
      }
      logins.add(answer.loginId);
      return { loginId: answer.loginId, method: 'device-code', url: answer.verificationUrl, code: answer.userCode };
    },

    async loginCancel(loginId) {
      const c = client;
      const mine = logins.delete(loginId);
      if (c && !c.closed) {
        // One Codex no longer knows (it ended meanwhile) is an error: it is cancelled all the same.
        try { await c.request<CodexLoginCancelResult>('account/login/cancel', { loginId }); } catch (error) { if (!(error instanceof RpcError)) throw error; }
      }
      if (mine) sink.login({ loginId, state: 'cancelled' });
    },
  };
}
