// What the task workspace's chat pane works out about coding-agent sessions (Codex, Claude Code) beside the OpenClaw
// chats: one list of both, newest first; the one-line glance of a session; where it runs; a turn's items in blocks
// a long turn can be read by; unified diffs as lines; durations, usage limits and failures in plain words; and the
// sky's count of a task's chats with every agent named. Pure, with no node imports: the browser and the server
// (sunrise/load.ts) both use it.
import {
  AGENT_LABEL, applyEvent, clipLine,
  type AgentKind, type AgentStatus, type ApprovalKind, type CodeSessionLink, type EventBody, type FileEdit, type OwnSettings, type PlaceChoice, type RateLimitSummary,
  type SessionItem, type SessionState, type SessionSummary, type SessionTurn,
} from './code-agents/protocol';
import type { ChatsGlance, ChatsTalk, ChatThreadSummary } from './task-chat';

export { resumeCommand } from './session-index/resume';

// ---- One list.

/** A code session's place in the chats list and in the sky's links: "code:<link id>", so it never meets an OpenClaw thread's id. */
export const CODE_ROW = 'code:';
export const codeRowId = (linkId: string) => `${CODE_ROW}${linkId}`;
export const codeLinkOf = (rowId: string | null | undefined): string | null => (rowId && rowId.startsWith(CODE_ROW) ? rowId.slice(CODE_ROW.length) || null : null);

export type ChatRow =
  | { kind: 'openclaw'; id: string; at: string; thread: ChatThreadSummary }
  | { kind: 'code'; id: string; at: string; session: SessionSummary };

const latest = (...values: (string | null | undefined)[]) => values.filter((v): v is string => !!v).sort().at(-1) ?? '';

/** When a session last had something happen: he wrote in it, a turn started or ended. */
export function sessionActivityAt(s: Pick<CodeSessionLink, 'touchedAt' | 'settledAt' | 'workingSince' | 'createdAt'>): string {
  return latest(s.createdAt, s.touchedAt, s.settledAt, s.workingSince);
}

/** OpenClaw's chats and the coding sessions as one list, the most recent activity first. */
export function mergeChatRows(threads: ChatThreadSummary[], sessions: SessionSummary[]): ChatRow[] {
  const rows: ChatRow[] = [
    ...threads.map((thread): ChatRow => ({ kind: 'openclaw', id: thread.id, at: thread.updatedAt, thread })),
    ...sessions.map((session): ChatRow => ({ kind: 'code', id: codeRowId(session.id), at: sessionActivityAt(session), session })),
  ];
  return rows
    .map((row, i) => ({ row, i, t: Date.parse(row.at) || 0 }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map(({ row }) => row);
}

// ---- A session at a glance.

export type PillTone = 'working' | 'waiting' | 'failed' | 'offline' | 'idle';

/** The word on a session's pill, in the same words the OpenClaw chats use where they mean the same. */
export function sessionPill(s: { state: SessionState; unread?: boolean }): { word: string; tone: PillTone } {
  if (s.state === 'working') return { word: 'Working', tone: 'working' };
  if (s.state === 'needs-you') return { word: 'Needs you', tone: 'waiting' };
  if (s.state === 'failed') return { word: 'Failed', tone: 'failed' };
  if (s.state === 'offline') return { word: 'Offline', tone: 'offline' };
  if (s.unread) return { word: 'Waiting on you', tone: 'waiting' };
  return { word: 'Idle', tone: 'idle' };
}

const ASK_WORDS: Record<ApprovalKind, string> = { command: 'approve a command', 'file-change': 'approve file changes', tool: 'answer a question', other: 'approve more access' };

/** What an approval asks, in a few words: its own title ("Run npm test"), else what kind of thing it is. */
export function askingWords(asking: { kind: ApprovalKind; title: string } | null | undefined): string {
  if (!asking) return 'approve a step';
  return asking.title.trim() || ASK_WORDS[asking.kind];
}

/** The one line under a session's title in the list. */
export function sessionGlance(s: Pick<SessionSummary, 'agent' | 'state' | 'lastLine' | 'asking'>): string {
  const agent = AGENT_LABEL[s.agent];
  if (s.state === 'needs-you') return `Needs you: ${askingWords(s.asking)}`;
  if (s.state === 'working') return `${agent} is working…`;
  if (s.state === 'failed') return s.lastLine ? `Failed: ${s.lastLine}` : 'The last turn failed.';
  if (s.state === 'offline') return `${agent} can’t be reached just now.`;
  return s.lastLine ? `${agent}: ${s.lastLine}` : 'Nothing said yet.';
}

const baseName = (cwd: string) => cwd.replace(/\/+$/, '').split('/').pop() || cwd;

/** "laptop · agentic-journal": the device, then the place's name (its project, the workspace, or the folder's own). */
/** "laptop · agentic-journal", "PC · repo": the device (in his words, from `devices`) and the place's name. */
export function placeLine(host: string, cwd: string, places: PlaceChoice[] = [], devices: { host: string; label: string }[] = []): string {
  const known = places.find((p) => p.host === host && p.cwd === cwd);
  return `${devices.find((d) => d.host === host)?.label ?? host} · ${known ? known.label : baseName(cwd)}`;
}

/** The places as the picker groups them: this device's first (the ones a session can start in), then each other device. */
export function placeGroups(places: PlaceChoice[]): { host: string; places: PlaceChoice[]; available: boolean }[] {
  const groups: { host: string; places: PlaceChoice[]; available: boolean }[] = [];
  for (const p of places) {
    let group = groups.find((g) => g.host === p.host);
    if (!group) groups.push((group = { host: p.host, places: [], available: false }));
    group.places.push(p);
    if (p.available) group.available = true;
  }
  return groups.sort((a, b) => Number(b.available) - Number(a.available));
}

export const placeKey = (p: { host: string; cwd: string }) => `${p.host}\u0000${p.cwd}`;

// ---- Turns as blocks.

/** Items that are steps of the work: one line each, grouped tightly. */
const STEP_KINDS = new Set<SessionItem['kind']>(['command', 'file-change', 'tool', 'web-search', 'reasoning']);
export const isStep = (item: SessionItem) => STEP_KINDS.has(item.kind) || (item.kind === 'notice' && item.level === 'info');

export type TurnBlock =
  | { type: 'user'; item: Extract<SessionItem, { kind: 'user' }> }
  | { type: 'agent'; item: Extract<SessionItem, { kind: 'agent' }>; final: boolean }
  | { type: 'steps'; id: string; items: SessionItem[] }
  | { type: 'plan'; item: Extract<SessionItem, { kind: 'plan' }> }
  | { type: 'notice'; item: Extract<SessionItem, { kind: 'notice' }> };

/**
 * A turn's items as blocks: what he said, what the agent said, and the steps between as one group per run of them.
 * The agent's last message, with no steps after it, is the turn's answer (`final`). Empty agent and reasoning items
 * (just started, nothing streamed yet) are left out.
 */
export function turnBlocks(turn: Pick<SessionTurn, 'items'>): TurnBlock[] {
  const blocks: TurnBlock[] = [];
  for (const item of turn.items) {
    if ((item.kind === 'agent' || item.kind === 'reasoning') && !item.text.trim()) continue;
    if (isStep(item)) {
      const last = blocks.at(-1);
      if (last?.type === 'steps') last.items.push(item);
      else blocks.push({ type: 'steps', id: `steps-${item.id}`, items: [item] });
      continue;
    }
    if (item.kind === 'user') blocks.push({ type: 'user', item });
    else if (item.kind === 'agent') blocks.push({ type: 'agent', item, final: false });
    else if (item.kind === 'plan') blocks.push({ type: 'plan', item });
    else if (item.kind === 'notice') blocks.push({ type: 'notice', item });
  }
  const last = blocks.at(-1);
  if (last?.type === 'agent') last.final = true;
  return blocks;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A group of steps in one line: "Ran 3 commands (1 failed) · Edited 2 files · Used a tool · Searched the web". */
export function stepsSummary(items: SessionItem[]): string {
  let commands = 0, failed = 0, files = 0, tools = 0, searches = 0, thoughts = 0;
  for (const item of items) {
    if (item.kind === 'command') { commands += 1; if (item.status === 'failed' || (item.exitCode !== null && item.exitCode !== 0)) failed += 1; }
    else if (item.kind === 'file-change') files += item.files.length || 1;
    else if (item.kind === 'tool') tools += 1;
    else if (item.kind === 'web-search') searches += 1;
    else if (item.kind === 'reasoning') thoughts += 1;
  }
  const parts: string[] = [];
  if (commands) parts.push(`Ran ${plural(commands, 'command')}${failed ? ` (${failed} failed)` : ''}`);
  if (files) parts.push(`Edited ${plural(files, 'file')}`);
  if (tools) parts.push(tools === 1 ? 'Used a tool' : `Used ${tools} tools`);
  if (searches) parts.push(searches === 1 ? 'Searched the web' : `Searched the web ${searches} times`);
  if (!parts.length && thoughts) parts.push('Thought it through');
  return parts.join(' · ') || plural(items.length, 'step');
}

/** A command's mark: still running, it worked, it failed (with its exit code), or he said no. */
export function commandOutcome(item: Extract<SessionItem, { kind: 'command' }>): { tone: 'running' | 'ok' | 'failed' | 'declined'; word: string } {
  if (item.status === 'declined') return { tone: 'declined', word: 'declined' };
  if (item.status === 'running') return { tone: 'running', word: 'running' };
  if (item.status === 'failed' || (item.exitCode !== null && item.exitCode !== 0)) return { tone: 'failed', word: item.exitCode !== null ? `exit ${item.exitCode}` : 'failed' };
  return { tone: 'ok', word: 'ok' };
}

/** A tool call's input in a few words: a JSON object's values, else the text as it is. */
export function toolInputLine(input: string, limit = 90): string {
  const text = input.trim();
  if (!text) return '';
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parts = Object.entries(parsed as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      return clipLine(parts.join(', '), limit);
    }
  } catch { /* not JSON: as it is */ }
  return clipLine(text, limit);
}

/** Pretty JSON when the text is JSON, else the text. */
export function prettyJson(text: string): string {
  try { return JSON.stringify(JSON.parse(text), null, 2); } catch { return text; }
}

// ---- Diffs.

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  text: string;
  old?: number;
  new?: number;
}

/**
 * A unified diff as lines with their numbers. A new file whose "diff" is only its text (no hunk, no + marks) is all
 * added lines; a header Git writes (diff --git, index, ---/+++) is a meta line.
 */
export function parseDiff(diff: string, change: FileEdit['change'] = 'update'): DiffLine[] {
  if (!diff) return [];
  const raw = diff.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const hasHunk = raw.some((l) => l.startsWith('@@'));
  const marked = raw.some((l) => l.startsWith('+') || l.startsWith('-'));
  if (!hasHunk && !marked) {
    return raw.map((text, i) => (change === 'delete' ? { kind: 'del', text, old: i + 1 } : { kind: 'add', text, new: i + 1 }));
  }
  const out: DiffLine[] = [];
  let oldNo = 1, newNo = 1, inHunk = !hasHunk;
  for (const line of raw) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      out.push({ kind: 'hunk', text: line });
      continue;
    }
    if (!inHunk || /^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(line)) {
      out.push({ kind: 'meta', text: line });
      continue;
    }
    if (line.startsWith('+')) out.push({ kind: 'add', text: line.slice(1), new: newNo++ });
    else if (line.startsWith('-')) out.push({ kind: 'del', text: line.slice(1), old: oldNo++ });
    else if (line.startsWith('\\')) out.push({ kind: 'meta', text: line });
    else out.push({ kind: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line, old: oldNo++, new: newNo++ });
  }
  return out;
}

/** Lines added and taken out. */
export function diffCounts(file: FileEdit): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const line of parseDiff(file.diff, file.change)) {
    if (line.kind === 'add') added += 1;
    else if (line.kind === 'del') removed += 1;
  }
  return { added, removed };
}

/** The path as the row shows it: the last parts, so the file's own name always reads. */
export function shortPath(path: string, cwd = ''): string {
  const rel = cwd && path.startsWith(`${cwd.replace(/\/+$/, '')}/`) ? path.slice(cwd.replace(/\/+$/, '').length + 1) : path;
  return rel;
}

// ---- Links in what an agent wrote.

/** A link to a page of the Journal itself: a path on this site. "//host…" and "/\host…" are other sites (browsers read them so). */
export const isInternalHref = (href: string | null | undefined): boolean => !!href && /^\/(?![/\\])/.test(href);

// ---- Time, limits, failures.

/** "0.4 s", "12 s", "1m 12s", "1h 4m". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '';
  if (ms < 10_000) return `${(Math.round(ms / 100) / 10).toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** "3:20 PM" today, "Tue 9:00 AM" another day. */
export function resetWhen(at: number, now = Date.now()): string {
  const d = new Date(at);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return new Date(now).toDateString() === d.toDateString() ? time : `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
}

/** When the limit that holds the agent back resets: the latest reset among the windows that are full. */
export function limitResetsAt(limits: RateLimitSummary | null | undefined): number | null {
  if (!limits) return null;
  const full = limits.windows.filter((w) => w.usedPercent >= 100 && w.resetsAt);
  const pool = full.length ? full : limits.blocked ? limits.windows.filter((w) => w.resetsAt) : [];
  const times = pool.map((w) => w.resetsAt!).sort((a, b) => a - b);
  return times.length ? times[times.length - 1]! : null;
}

/** The usage limits in one quiet line: "Usage limit reached · resets 3:20 PM", or the fullest window: "5 hours: 62% used". */
export function limitsLine(limits: RateLimitSummary | null | undefined, now = Date.now()): { text: string; blocked: boolean } | null {
  if (!limits || (!limits.windows.length && !limits.blocked)) return null;
  if (limits.blocked) {
    const at = limitResetsAt(limits);
    return { text: `Usage limit reached${at ? ` · resets ${resetWhen(at, now)}` : ''}`, blocked: true };
  }
  const top = [...limits.windows].sort((a, b) => b.usedPercent - a.usedPercent)[0];
  if (!top) return null;
  return { text: `${top.label}: ${Math.round(top.usedPercent)}% used${top.resetsAt && top.usedPercent >= 50 ? ` · resets ${resetWhen(top.resetsAt, now)}` : ''}`, blocked: false };
}

/** What a failed turn says, plainly. A usage-limit failure says when the agent can work again, when that is known. */
export function failureText(agent: AgentKind, turn: Pick<SessionTurn, 'error' | 'limited'>, limits?: RateLimitSummary | null, now = Date.now()): string {
  const label = AGENT_LABEL[agent];
  if (turn.limited) {
    const at = limitResetsAt(limits);
    return `${label} hit its usage limit, so this turn did not run. ${at ? `It can work again at ${resetWhen(at, now)}.` : 'It can work again when the limit resets.'}`;
  }
  return turn.error?.trim() ? turn.error.trim() : `${label} stopped with an error.`;
}

// ---- The agent's own settings, and who is signed in.

const CODEX_SANDBOX_WORDS: Record<string, string> = { 'danger-full-access': 'full access', 'workspace-write': 'edits in its folder', 'read-only': 'read-only' };
const CODEX_APPROVAL_WORDS: Record<string, string> = { never: 'never asks', 'on-request': 'asks when it needs to', untrusted: 'asks before most commands', 'on-failure': 'asks when a command fails', granular: 'asks by its own rules' };
const CLAUDE_MODE_WORDS: Record<string, string> = {
  default: 'asks before changes', acceptEdits: 'edits freely, asks for the rest', plan: 'plans only', bypassPermissions: 'full access, never asks',
  auto: 'decides by itself, asks when unsure', dontAsk: 'never asks, refuses what is not allowed',
};

/**
 * The `own` mode in words, from what the agent says its settings come to: "Your Codex settings (full access, never
 * asks)", "Your Claude Code settings (edits freely, asks for the rest)", or just "Your Codex settings" when it does not
 * say. `full`: those settings let it do anything without asking (shown as such, not confirmed: it is his own choice).
 */
export function ownWords(agent: AgentKind, own: OwnSettings | null | undefined): { label: string; detail: string | null; full: boolean } {
  const head = `Your ${AGENT_LABEL[agent]} settings`;
  let parts: string[] = [];
  let full = false;
  if (agent === 'codex') {
    const sandbox = own?.sandbox ? CODEX_SANDBOX_WORDS[own.sandbox] ?? own.sandbox : null;
    const approval = own?.approvalPolicy ? CODEX_APPROVAL_WORDS[own.approvalPolicy] ?? own.approvalPolicy : null;
    parts = [sandbox, approval].filter((p): p is string => !!p);
    full = own?.sandbox === 'danger-full-access';
  } else {
    const mode = own?.permissionMode ? CLAUDE_MODE_WORDS[own.permissionMode] ?? own.permissionMode : null;
    if (mode) parts = [mode];
    full = own?.permissionMode === 'bypassPermissions';
  }
  const detail = parts.length ? parts.join(', ') : null;
  return { label: detail ? `${head} (${detail})` : head, detail, full };
}

/** "Plus plan", "Max plan": a plan's name as the agent gives it, read as words. */
export function planWords(plan: string | undefined): string | null {
  const clean = plan?.trim().replace(/[_-]+/g, ' ');
  if (!clean || clean === 'unknown') return null;
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)} plan`;
}

/** Who is signed in to the agent on its device, in a few words: "Signed in on laptop · Plus plan", "Not signed in on laptop". */
/** Who is signed in to an agent there, in a line; `device` names the device in his words (PC, Mac), else its host. */
export function accountLine(status: Pick<AgentStatus, 'state' | 'host' | 'account'> | null | undefined, device?: string): string | null {
  if (!status) return null;
  const on = device ?? status.host;
  if (status.state === 'signed-out') return `Not signed in on ${on}`;
  if (status.state !== 'ready') return null;
  const account = status.account;
  if (account?.kind === 'api-key') return `Signed in on ${on} with an API key`;
  const plan = planWords(account?.plan);
  return `Signed in on ${on}${plan ? ` · ${plan}` : ''}`;
}

// ---- The stream, applied without touching what React already drew.

/**
 * applyEvent (protocol.ts) on a copy: the list, the turn the event is about and the item a delta grows are new
 * objects, everything else is shared, so a drawn item that did not change is not drawn again.
 */
export function applySessionEvent(turns: SessionTurn[], event: EventBody): SessionTurn[] {
  const next = turns.slice();
  const turnId = 'turnId' in event && typeof event.turnId === 'string' ? event.turnId : null;
  if (turnId && event.type !== 'state-changed') {
    const at = next.findIndex((t) => t.id === turnId);
    if (at >= 0) {
      const turn = { ...next[at]!, items: next[at]!.items.slice() };
      next[at] = turn;
      if (event.type === 'item-delta') {
        const i = turn.items.findIndex((x) => x.id === event.itemId);
        if (i >= 0) turn.items[i] = { ...turn.items[i]! };
      }
    }
  }
  return applyEvent(next, event);
}

/** The turn running now, if one is: the last turn, while its status says so. */
export function runningTurn(turns: SessionTurn[]): SessionTurn | null {
  const last = turns.at(-1);
  return last && last.status === 'running' ? last : null;
}

// ---- The sky: every agent's chats about a task.

/** A "working" stamp this old is from a turn nobody is watching (as hub.ts WORKING_STALE_MS). */
const WORKING_STALE_MS = 3 * 60 * 60_000;

/** A stored link's state as the list would show it without the hub: an old "working" is idle. */
export function storedState(link: CodeSessionLink, now = Date.now()): SessionState {
  const state = link.lastState;
  if ((state === 'working' || state === 'needs-you') && (!link.workingSince || now - Date.parse(link.workingSince) > WORKING_STALE_MS)) return 'idle';
  return state;
}

/** As hub.ts: it waits on him, or a turn ended since he last looked. */
export function linkUnread(link: CodeSessionLink, state: SessionState): boolean {
  return state === 'needs-you' || (!!link.settledAt && (!link.seenAt || link.settledAt > link.seenAt) && state !== 'working');
}

/** Agents' names joined for a sentence: "Codex", "Codex and OpenClaw", "OpenClaw, Codex and Claude Code". */
export function namesLine(names: string[]): string {
  const unique = [...new Set(names)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} and ${unique.at(-1)}`;
}

/** The sky's count of a task's chats with every agent. `workingWho` and `waitingWho` name who; `asks` means a coding agent waits on an approval. */
export interface SkyChatsGlance extends ChatsGlance {
  workingWho?: string;
  waitingWho?: string;
  asks?: boolean;
}

/** What the sky's bubble says of the chat that waits on him; `who` names a coding agent's. */
export type SkyTalk = Omit<ChatsTalk, 'waiting'> & { waiting: (NonNullable<ChatsTalk['waiting']> & { who?: string }) | null };

const liveLinks = (links: CodeSessionLink[] | undefined) => (links ?? []).filter((l) => !l.archived);

/** OpenClaw's glance with the coding sessions counted in. Exactly OpenClaw's own when there are none. */
export function skyChats(openclaw: ChatsGlance, links: CodeSessionLink[] | undefined, now = Date.now()): SkyChatsGlance {
  const list = liveLinks(links);
  if (list.length === 0) return openclaw;
  const states = list.map((l) => ({ l, state: storedState(l, now) }));
  const waiting = states.filter(({ l, state }) => linkUnread(l, state));
  const working = states.filter(({ state }) => state === 'working');
  const out: SkyChatsGlance = {
    count: openclaw.count + list.length,
    waiting: openclaw.waiting + waiting.length,
    working: openclaw.working + working.length,
  };
  const workers = [...(openclaw.working > 0 ? ['OpenClaw'] : []), ...working.map(({ l }) => AGENT_LABEL[l.agent])];
  if (working.length > 0) out.workingWho = namesLine(workers);
  const waiters = [...(openclaw.waiting > 0 ? ['OpenClaw'] : []), ...waiting.map(({ l }) => AGENT_LABEL[l.agent])];
  if (waiting.length > 0) out.waitingWho = namesLine(waiters);
  if (waiting.some(({ state }) => state === 'needs-you')) out.asks = true;
  return out;
}

/** The sky's bubble: OpenClaw's chat that waits on him first; else a coding session that does, named, with what it asks. */
export function skyTalk(openclaw: ChatsTalk | null, links: CodeSessionLink[] | undefined, now = Date.now()): SkyTalk | null {
  const waiting = liveLinks(links)
    .map((l) => ({ l, state: storedState(l, now) }))
    .filter(({ l, state }) => linkUnread(l, state))
    .sort((a, b) => Number(b.state === 'needs-you') - Number(a.state === 'needs-you') || sessionActivityAt(b.l).localeCompare(sessionActivityAt(a.l)));
  if (waiting.length === 0) return openclaw;
  if (openclaw?.waiting) return { ...openclaw, waiting: { ...openclaw.waiting, more: openclaw.waiting.more + waiting.length } };
  const { l, state } = waiting[0]!;
  const who = AGENT_LABEL[l.agent];
  const text = state === 'needs-you' ? `${who} needs you: ${askingWords(l.asking)}` : `${who}: ${l.lastLine || 'finished its turn.'}`;
  return {
    threads: openclaw?.threads ?? [],
    waiting: { threadId: codeRowId(l.id), title: l.title, text, at: l.settledAt ?? l.touchedAt, more: waiting.length - 1, who },
  };
}

/** The foot of a task's glance on the sky: what its chats are doing, naming the agent when it is not OpenClaw. */
export function chatsState(chats: SkyChatsGlance): string {
  if (chats.waiting > 0) {
    if (chats.asks && chats.waiting === 1 && chats.waitingWho && chats.waitingWho !== 'OpenClaw') return `${chats.waitingWho} needs you`;
    return chats.count === 1 ? 'waiting on you' : `${chats.waiting} waiting on you`;
  }
  if (chats.working > 0) {
    const who = chats.workingWho;
    if (!who || who === 'OpenClaw') return 'OpenClaw is answering';
    return `${who} ${who.includes(' and ') ? 'are' : 'is'} working`;
  }
  return '';
}
