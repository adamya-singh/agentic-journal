// Chats with OpenClaw about one task, from the task's workspace (and Dawn's brief card). A task can have several;
// each thread is one OpenClaw session, so "Continue in OpenClaw" opens the same conversation in the Control UI.
// The first message of a thread carries the brief as context; later ones are sent as typed, with the page he is
// looking at when that is a page in OpenClaw's browser.
// Pure: no filesystem, so the route and the tests share it.
import type { TaskBrief } from '@/lib/task-brief';
import { pageKey } from '@/lib/task-surfaces';

/** What he was looking at in the task's workspace when he wrote: the work OpenClaw started, or a page in OpenClaw's browser. */
export interface ChatSurfaceRef {
  kind: 'work' | 'web';
  label: string;
  url?: string;                  // a web surface's address
}

export interface TaskChatMessage {
  role: 'you' | 'openclaw';
  text: string;
  at: string;                    // ISO
  about?: ChatSurfaceRef;        // his messages only: the surface he sent it from
  from?: 'app';                  // said in this OpenClaw session outside the Journal (OpenClaw's own app), and read back from it
}

export interface TaskChatThread {
  id: string;
  taskId: string;
  title: string;                 // from its first message
  sessionKey: string;
  messages: TaskChatMessage[];
  pendingSince: string | null;   // a turn is out to OpenClaw
  error: string | null;          // the last turn failed
  createdAt: string;
  updatedAt: string;
  seenAt: string | null;         // when he last had this chat open
  touchedAt: string;             // when he last did something in it (started it, wrote in it); a reply does not count
  outsideRunAt?: string | null;  // when OpenClaw's own history last said a run is in flight that the Journal did not start
  about: ChatSurfaceRef | null;  // the surface it was started from
}

/** working: a turn is out. waiting: OpenClaw answered and he has not looked since. idle: nothing is owed either way. */
export type ChatState = 'working' | 'waiting' | 'idle';

export interface ChatThreadSummary {
  id: string;
  title: string;
  last: string;                  // the last line said, clipped
  lastRole: 'you' | 'openclaw' | null;
  count: number;
  state: ChatState;
  about: ChatSurfaceRef | null;
  ask: string;                   // the last thing he asked in it, clipped
  askAbout: ChatSurfaceRef | null;   // the surface he asked it from
  sessionKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatThreadView extends Omit<ChatThreadSummary, 'last' | 'lastRole' | 'count' | 'ask' | 'askAbout'> {
  messages: TaskChatMessage[];
  pending: boolean;              // a Journal turn is out: he cannot send another yet
  error: string | null;
  outside?: 'unreachable';       // what was said in the session outside the Journal could not be read just now
}

/** What a task's form says about its chats: how many there are and whether one waits on him. */
export interface ChatsGlance { count: number; waiting: number; working: number }

export const CHAT_SCHEMA_VERSION = 2;
export const MAX_CHAT_MESSAGE = 4000;
export const CHAT_TURN_TIMEOUT_MS = 10 * 60_000;
const NOTES_MAX = 1500;
const TITLE_MAX = 60;
const LAST_MAX = 140;
const ASK_MAX = 90;

function clip(text: string, limit: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** One OpenClaw session per thread; a new chat gets a new key. */
export function chatSessionKey(taskId: string, now: Date): string {
  const safe = taskId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60);
  return `agent:main:journal-chat-${safe}-${now.getTime()}`;
}

/** A chat is named by what he first asked. */
export function chatTitle(firstMessage: string): string {
  return clip(firstMessage, TITLE_MAX) || 'New chat';
}

/** A surface reference as it came over the wire, or null when it is not one. */
export function parseSurfaceRef(raw: unknown): ChatSurfaceRef | null {
  if (!raw || typeof raw !== 'object') return null;
  const { kind, label, url } = raw as Record<string, unknown>;
  if ((kind !== 'work' && kind !== 'web') || typeof label !== 'string') return null;
  const name = clip(label, 120);
  if (kind === 'work') return { kind, label: name || 'Work' };
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || url.length > 2000) return null;
  return { kind, label: name || url, url };
}

export function newChatThread(taskId: string, now: Date, about: ChatSurfaceRef | null = null): TaskChatThread {
  const at = now.toISOString();
  return {
    id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    taskId, title: 'New chat', sessionKey: chatSessionKey(taskId, now), messages: [], pendingSince: null, error: null,
    createdAt: at, updatedAt: at, seenAt: at, touchedAt: at, about,
  };
}

/** How long "a run is in flight" from OpenClaw's history is believed without being heard again. */
export const OUTSIDE_RUN_TTL_MS = 90_000;

/** A run the Journal did not start is in flight in the thread's session, as far as its history last said. */
export function outsideRunning(thread: Pick<TaskChatThread, 'outsideRunAt'>, now = Date.now()): boolean {
  return !!thread.outsideRunAt && now - Date.parse(thread.outsideRunAt) < OUTSIDE_RUN_TTL_MS;
}

export function chatState(thread: TaskChatThread, now = Date.now()): ChatState {
  if (thread.pendingSince || outsideRunning(thread, now)) return 'working';
  const last = thread.messages[thread.messages.length - 1];
  if (last?.role === 'openclaw' && (!thread.seenAt || Date.parse(thread.seenAt) < Date.parse(last.at))) return 'waiting';
  return 'idle';
}

export function chatSummary(thread: TaskChatThread): ChatThreadSummary {
  const last = thread.messages[thread.messages.length - 1];
  const asked = thread.messages.findLast((m) => m.role === 'you');
  return {
    id: thread.id, title: thread.title, last: last ? clip(last.text.replace(/[*_`#>]+/g, ''), LAST_MAX) : '', lastRole: last?.role ?? null,
    count: thread.messages.length, state: chatState(thread), about: thread.about,
    ask: asked ? clip(asked.text, ASK_MAX) : '', askAbout: asked?.about ?? null, sessionKey: thread.sessionKey,
    createdAt: thread.createdAt, updatedAt: thread.updatedAt,
  };
}

export function chatView(thread: TaskChatThread): ChatThreadView {
  const { id, title, sessionKey, messages, about, createdAt, updatedAt } = thread;
  return { id, title, sessionKey, messages, about, createdAt, updatedAt, state: chatState(thread), pending: !!thread.pendingSince, error: thread.error };
}

/** A task's chats that have something in them, most recent first. */
export function listChats(threads: TaskChatThread[] | undefined): TaskChatThread[] {
  return (threads ?? []).filter((t) => t.messages.length > 0).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The chat a bare "send" goes to: the one he touched last, empty or not. A reply that lands late in an older chat
 * does not make that chat the latest again.
 */
export function latestChat(threads: TaskChatThread[] | undefined): TaskChatThread | undefined {
  return (threads ?? []).reduce<TaskChatThread | undefined>((best, t) => (!best || t.touchedAt > best.touchedAt ? t : best), undefined);
}

/** What OpenClaw is doing about one surface of the workspace, as far as the chats say. */
export interface SurfaceActivity { state: 'working' | 'answered'; threadId: string; ask: string }

const sameSurface = (a: ChatSurfaceRef, b: ChatSurfaceRef) =>
  a.kind === b.kind && (a.kind === 'work' || (!!a.url && !!b.url && pageKey(a.url) === pageKey(b.url)));

/**
 * The one thing known about OpenClaw and a surface: a chat whose last request was sent from that surface has a turn
 * out (working), or has an answer he has not looked at (answered). Null otherwise. A page counts as the surface
 * under any of the addresses given (the tab's own, and where it has since gone). Working wins over answered, then
 * the most recent chat.
 */
export function surfaceActivity(threads: ChatThreadSummary[], surface: ChatSurfaceRef[]): SurfaceActivity | null {
  let best: { rank: number; t: ChatThreadSummary } | null = null;
  for (const t of threads) {
    if (t.state === 'idle' || !t.askAbout || !surface.some((ref) => sameSurface(ref, t.askAbout!))) continue;
    const rank = t.state === 'working' ? 1 : 0;
    if (!best || rank > best.rank || (rank === best.rank && t.updatedAt > best.t.updatedAt)) best = { rank, t };
  }
  return best ? { state: best.t.state === 'working' ? 'working' : 'answered', threadId: best.t.id, ask: best.t.ask } : null;
}

export function chatsGlance(threads: TaskChatThread[] | undefined): ChatsGlance {
  const listed = listChats(threads);
  const states = listed.map(chatState);
  return { count: listed.length, waiting: states.filter((s) => s === 'waiting').length, working: states.filter((s) => s === 'working').length };
}

/** He has the chat open: what OpenClaw last said counts as read. True when that changed something. */
export function markChatSeen(thread: TaskChatThread, now: Date): boolean {
  if (chatState(thread) !== 'waiting') return false;
  thread.seenAt = now.toISOString();
  return true;
}

function iso(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** One stored thread read back carefully; fields a version-1 thread never had are filled from what it does have. */
function readThread(raw: unknown, taskId: string, index: number): TaskChatThread | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.sessionKey !== 'string' || !Array.isArray(r.messages)) return null;
  const messages: TaskChatMessage[] = [];
  for (const m of r.messages as unknown[]) {
    if (!m || typeof m !== 'object') continue;
    const { role, text, at, about, from } = m as Record<string, unknown>;
    if ((role !== 'you' && role !== 'openclaw') || typeof text !== 'string') continue;
    const said = parseSurfaceRef(about);
    messages.push({ role, text, at: iso(at) ?? new Date(0).toISOString(), ...(said ? { about: said } : {}), ...(from === 'app' ? { from: 'app' as const } : {}) });
  }
  // A version-1 thread has no dates of its own: its session key ends in the moment it began.
  const keyMs = Number(/-(\d{12,14})$/.exec(r.sessionKey)?.[1]);
  const born = iso(r.createdAt) ?? messages[0]?.at ?? (Number.isFinite(keyMs) ? new Date(keyMs).toISOString() : new Date(0).toISOString());
  const last = messages[messages.length - 1];
  const updatedAt = iso(r.updatedAt) ?? iso(r.pendingSince) ?? last?.at ?? born;
  const first = messages.find((m) => m.role === 'you');
  const asked = messages.findLast((m) => m.role === 'you');
  return {
    id: typeof r.id === 'string' && r.id ? r.id : Number.isFinite(keyMs) ? keyMs.toString(36) : `t${index}`,
    taskId,
    title: typeof r.title === 'string' && r.title ? r.title : first ? chatTitle(first.text) : 'New chat',
    sessionKey: r.sessionKey,
    messages,
    pendingSince: iso(r.pendingSince),
    error: typeof r.error === 'string' ? r.error : null,
    createdAt: born,
    updatedAt,
    // Version 1 never recorded a look: what was already there when the chats became a list counts as read.
    seenAt: 'seenAt' in r ? iso(r.seenAt) : updatedAt,
    // Before this was recorded: the last thing he wrote, or the moment he opened it.
    touchedAt: iso(r.touchedAt) ?? asked?.at ?? born,
    ...(iso(r.outsideRunAt) ? { outsideRunAt: iso(r.outsideRunAt) } : {}),
    about: parseSurfaceRef(r.about),
  };
}

/**
 * The chat file as it is on disk, in today's shape: every task's threads as a list. Version 1 kept one thread per
 * task; each becomes the first of its task's list, with nothing dropped.
 */
export function migrateChatThreads(raw: unknown): { threads: Record<string, TaskChatThread[]>; migrated: boolean } {
  const out: Record<string, TaskChatThread[]> = {};
  const file = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const stored = file.threads && typeof file.threads === 'object' ? file.threads as Record<string, unknown> : {};
  for (const [taskId, value] of Object.entries(stored)) {
    const list = (Array.isArray(value) ? value : [value]).map((t, i) => readThread(t, taskId, i)).filter((t): t is TaskChatThread => t !== null);
    // Two threads never share an id within a task.
    const seen = new Set<string>();
    for (const t of list) { while (seen.has(t.id)) t.id = `${t.id}x`; seen.add(t.id); }
    if (list.length > 0) out[taskId] = list;
  }
  return { threads: out, migrated: file.schemaVersion !== CHAT_SCHEMA_VERSION };
}

/**
 * A turn that was out when the server restarted never comes back; show it as failed. `serverStartedAt`
 * settles it at once: a turn sent before this server started has nobody left to bring its answer.
 */
export function settleStalePending(thread: Pick<TaskChatThread, 'pendingSince' | 'error'>, now: Date, serverStartedAt?: number): boolean {
  if (!thread.pendingSince) return false;
  const sent = Date.parse(thread.pendingSince);
  const orphaned = serverStartedAt !== undefined && sent < serverStartedAt;
  if (!orphaned && now.getTime() - sent <= CHAT_TURN_TIMEOUT_MS + 60_000) return false;
  thread.pendingSince = null;
  thread.error = 'OpenClaw never answered.';
  return true;
}

function briefContext(brief: TaskBrief): string {
  const w = brief.when;
  const lines = [`Task: ${brief.title}`];
  lines.push(`Kind: ${brief.kind}${brief.course ? ` · ${brief.course.name}${brief.course.code ? ` (${brief.course.code})` : ''}` : ` · ${brief.group}`}`);
  lines.push(`Due: ${w.day}${w.left ? ` (${w.left})` : ''}${w.implied ? ', assumed' : ''}${w.where ? ` · ${w.where}` : ''}`);
  if (brief.stakes) lines.push(`Stakes: ${brief.stakes}`);
  if (brief.next) lines.push(`Start here: ${brief.next.label}${brief.next.detail ? ` (${brief.next.detail})` : ''}${brief.next.href ? ` ${brief.next.href}` : ''}`);
  if (brief.facts.length) lines.push('Facts:', ...brief.facts.map((f) => `- ${f.k}: ${f.v}`));
  if (brief.steps.length) lines.push('Steps:', ...brief.steps.map((s) => `- [${s.done ? 'x' : ' '}] ${s.text}${s.href ? ` ${s.href}` : ''}`));
  if (brief.flags.length) lines.push('Heads up:', ...brief.flags.map((f) => `- ${f.text}`));
  if (brief.links.length) lines.push('Links:', ...brief.links.map((l) => `- ${l.label}: ${l.href}`));
  if (brief.related.length) lines.push('Connected tasks:', ...brief.related.map((r) => `- ${r.short} (${r.rel}, ${r.day})`));
  if (brief.notesMarkdown) {
    const notes = brief.notesMarkdown.trim();
    lines.push('Notes:', notes.length > NOTES_MAX ? `${notes.slice(0, NOTES_MAX)}…` : notes);
    // What was done so far sits at the end of long notes: it is never the part that is cut.
    const progress = notes.length > NOTES_MAX ? /(^|\n)## Progress\n[\s\S]*?(?=\n#{1,2} |$)/.exec(notes)?.[0].trim() : undefined;
    if (progress) lines.push('Progress so far (from the notes):', progress.length > NOTES_MAX ? `…${progress.slice(-NOTES_MAX)}` : progress);
  }
  lines.push(`Journal task id: ${brief.id} (${brief.listType})`);
  return lines.join('\n');
}

/** What he is looking at, said to OpenClaw so "this page" means something. Empty for anything but a web page. */
function surfaceContext(about: ChatSurfaceRef | null | undefined): string {
  if (about?.kind !== 'web' || !about.url) return '';
  const title = about.label && about.label !== about.url ? `"${about.label}" ` : '';
  return `[Adamya has this page open in your browser, in the Journal's workspace for the task: ${title}${about.url} . When he says "this page", he means that tab: use your browser tool on it.]`;
}

/**
 * The one write a chat always makes: what OpenClaw did for the task goes into the task itself, so the workspace
 * and the next session know it. (POST /api/tasks/progress, src/lib/task-progress.ts.)
 */
function progressRule(taskId: string): string[] {
  const body = JSON.stringify({ taskId, did: '<what you did, one line>', next: '<what comes next>', waitingOn: '<who or what it waits on, and since when>' });
  return [
    'The one exception, which needs no asking: keep the task up to date with what happens in this chat. Each time you do something for the task (send an email, submit or book something, find out a fact that changes what comes next) or he tells you something happened, record it before you answer, for the whole life of this chat:',
    `curl -s -X POST http://127.0.0.1:3000/api/tasks/progress -H 'Content-Type: application/json' -d '${body}'`,
    '"did" names the specifics (who, which address, the subject, the amount). "next" and "waitingOn" are optional and replace the last ones; send "" to clear one. This only adds to the task’s notes under "## Progress".',
    'You are not running between his messages, so never say you will watch, monitor or check back later. When the next step is waiting for something (a reply, a decision, a date), say so in "waitingOn" and tell him the task now records it.',
  ];
}

/**
 * What goes to OpenClaw for one turn. Only the first turn of a thread carries the brief; a turn sent while he is
 * on a web page in OpenClaw's browser also says which page.
 */
export function buildChatTurnMessage(input: { brief: TaskBrief | null; text: string; first: boolean; about?: ChatSurfaceRef | null }): string {
  const page = surfaceContext(input.about);
  if (!input.first) return page ? `${page}\n\n${input.text}` : input.text;
  const context = input.brief ? briefContext(input.brief) : 'The task could not be loaded.';
  return [
    'Adamya is asking about one of the tasks in the Agentic Journal, from the chat in the task’s workspace.',
    'Keep answers short: a few sentences or a short list (markdown is fine). Look things up (Canvas, email, the journal, the web) when that helps.',
    'Do not change the task, the journal or anything else unless Adamya asks you to.',
    ...(input.brief ? progressRule(input.brief.id) : []),
    '',
    '--- The task, as the Journal knows it ---',
    context,
    '---',
    ...(page ? ['', page] : []),
    '',
    'Adamya’s message:',
    input.text,
  ].join('\n');
}


// ---- What was said in the same OpenClaw session outside the Journal.
// A thread is one OpenClaw session, and he can write in that session from OpenClaw's own app too. The Journal
// keeps its own copy of what it sent and what came back; the rest is read from the session's history
// (`openclaw gateway call chat.history`) and merged in, marked as having come from outside.

/** One line of the session's history that is chat: something he said, or something OpenClaw answered in words. */
export interface OutsideMessage { role: 'you' | 'openclaw'; text: string; ms: number }
export interface ChatHistory { messages: OutsideMessage[]; running: boolean }

const MATCH_WINDOW_MS = 10 * 60_000;
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The words of one history message: a plain string, or its text blocks joined. Tool calls and results are not words. */
function historyText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' && typeof (block as { text?: unknown }).text === 'string' ? (block as { text: string }).text : ''))
    .filter((text) => text.trim() !== '')
    .join('\n')
    .trim();
}

/**
 * The chat in what `chat.history` printed: his messages and OpenClaw's answers in words, oldest first. An assistant
 * message that only calls tools, a tool's result and OpenClaw's own bookkeeping ("custom") are left out. `running`
 * is true when the history says a run is in flight. Null when the output is not a history at all.
 */
export function readChatHistory(raw: unknown): ChatHistory | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { messages?: unknown }).messages)) return null;
  const r = raw as Record<string, unknown>;
  const messages: OutsideMessage[] = [];
  for (const m of r.messages as unknown[]) {
    if (!m || typeof m !== 'object') continue;
    const { role, content, timestamp } = m as Record<string, unknown>;
    if (role !== 'user' && role !== 'assistant') continue;
    const ms = typeof timestamp === 'number' ? timestamp : typeof timestamp === 'string' ? Date.parse(timestamp) : NaN;
    const text = historyText(content);
    if (!Number.isFinite(ms) || text === '') continue;
    messages.push({ role: role === 'user' ? 'you' : 'openclaw', text, ms });
  }
  messages.sort((a, b) => a.ms - b.ms);
  // A run is in flight when inputs are queued for the session or it names runs that are active. An idle session
  // still carries `pendingInputs: { items: [], total: 0, queuedCount: 0 }`, which means nothing.
  const listed = (value: unknown) => Array.isArray(value) && value.length > 0;
  const above = (value: unknown) => typeof value === 'number' && value > 0;
  const queue = r.pendingInputs && typeof r.pendingInputs === 'object' && !Array.isArray(r.pendingInputs) ? r.pendingInputs as Record<string, unknown> : {};
  const info = r.sessionInfo && typeof r.sessionInfo === 'object' ? r.sessionInfo as Record<string, unknown> : {};
  const running = listed(queue.items) || above(queue.total) || above(queue.queuedCount) || listed(r.activeRunIds) || listed(info.activeRunIds);
  return { messages, running };
}

/**
 * What he typed, out of what the Journal sent for it: the first turn of a thread carries the brief in front of his
 * message, and a turn sent from a web tab says which page first (buildChatTurnMessage).
 */
export function typedTextOf(sent: string): string {
  const mark = '\nAdamya’s message:\n';
  const at = sent.lastIndexOf(mark);
  if (at >= 0 && sent.startsWith('Adamya is asking about one of the tasks in the Agentic Journal')) return sent.slice(at + mark.length);
  const page = /^\[Adamya has this page open in your browser[\s\S]*?use your browser tool on it\.\]\n\n/.exec(sent);
  return page ? sent.slice(page[0].length) : sent;
}

/**
 * Merges the session's history into the thread. What the Journal already holds stays as it is (his words as he
 * typed them, the surface he was on); each of those is paired with its line in the history so it is not added
 * again, and only what the Journal does not have is added, marked `from: 'app'`. The whole thread is then in the
 * order things were said. Doing it again with the same history changes nothing. Returns whether anything changed.
 *
 * Pairing: a message read from the history earlier is found by its moment; one of his by the text he typed (the
 * history holds it wrapped, see typedTextOf), nearest in time; a reply by its text, or else as the answer of its
 * own turn (the history may hold it in pieces, with tool calls between). While a Journal turn is still out, the
 * answers after its question are left to that turn to record.
 */
export function mergeChatHistory(thread: TaskChatThread, history: ChatHistory, now: Date): boolean {
  const lines = history.messages;
  const used = lines.map(() => false);
  const held = thread.messages;
  const keys: number[] = [];
  let lastAsked = -Infinity;       // where his latest question sits in the history's time
  held.forEach((m, index) => {
    const at = Date.parse(m.at);
    const want = squash(m.text);
    let hit = -1;
    if (m.from === 'app') {
      hit = lines.findIndex((line, i) => !used[i] && line.role === m.role && line.ms === at);
    } else if (m.role === 'you') {
      let best = Infinity;
      lines.forEach((line, i) => {
        if (used[i] || line.role !== 'you') return;
        const gap = Math.abs(line.ms - at);
        if (gap > MATCH_WINDOW_MS) return;
        const exact = squash(typedTextOf(line.text)) === want;
        if (!exact && !squash(line.text).includes(want)) return;
        const score = gap + (exact ? 0 : MATCH_WINDOW_MS);
        if (score < best) { best = score; hit = i; }
      });
    } else {
      // His reply is the answer of its turn: everything OpenClaw said in words between his question and the
      // moment the Journal got the answer back (and a little after, for clocks that disagree).
      const from = Number.isFinite(lastAsked) ? lastAsked : at - MATCH_WINDOW_MS;
      const turn = lines.map((line, i) => i).filter((i) => !used[i] && lines[i].role === 'openclaw' && lines[i].ms >= from && lines[i].ms <= at + 60_000);
      const same = lines.findIndex((line, i) => !used[i] && line.role === 'openclaw' && squash(line.text) === want && Math.abs(line.ms - at) <= MATCH_WINDOW_MS);
      if (same >= 0) {
        hit = same;
        for (const i of turn) if (lines[i].ms <= lines[same].ms && want.includes(squash(lines[i].text))) used[i] = true;
      } else if (turn.length > 0) {
        hit = turn[turn.length - 1];
        for (const i of turn) used[i] = true;
      }
    }
    if (hit >= 0) used[hit] = true;
    const key = Math.max(hit >= 0 ? lines[hit].ms : at, index > 0 ? keys[index - 1] : -Infinity);
    keys.push(key);
    if (m.role === 'you') lastAsked = key;
  });
  // A Journal turn that is still out records its own answer when it comes back.
  const owned = thread.pendingSince ? lastAsked - 1000 : Infinity;
  const added: { message: TaskChatMessage; key: number }[] = [];
  lines.forEach((line, i) => {
    if (used[i] || (line.role === 'openclaw' && line.ms >= owned)) return;
    added.push({ message: { role: line.role, text: line.role === 'you' ? typedTextOf(line.text) : line.text, at: new Date(line.ms).toISOString(), from: 'app' }, key: line.ms });
  });
  const running = history.running && !thread.pendingSince;
  const marked = !!thread.outsideRunAt;
  if (running) thread.outsideRunAt = now.toISOString();
  else if (marked) thread.outsideRunAt = null;
  if (added.length === 0) return running || marked;
  const all = [...held.map((message, i) => ({ message, key: keys[i], order: i })), ...added.map((a, i) => ({ ...a, order: held.length + i }))];
  all.sort((a, b) => a.key - b.key || a.order - b.order);
  thread.messages = all.map((entry) => entry.message);
  const last = thread.messages[thread.messages.length - 1];
  if (last.at > thread.updatedAt) thread.updatedAt = last.at;
  // The turn was given up on ("never answered"), and here is its answer after all.
  if (thread.error && !thread.pendingSince && last.role === 'openclaw') thread.error = null;
  const first = thread.messages.find((m) => m.role === 'you');
  if (thread.title === 'New chat' && first) thread.title = chatTitle(first.text);
  return true;
}

/**
 * Records the answer a Journal turn got back. When the same answer was already read from the session's history
 * (the turn was slow to return, or failed on the way back), that line becomes the Journal's own and is not added
 * a second time.
 */
export function recordChatReply(thread: TaskChatThread, reply: string, at: string): void {
  const asked = thread.messages.findLastIndex((m) => m.role === 'you' && m.from !== 'app');
  const have = thread.messages.find((m, i) => i > asked && m.role === 'openclaw' && m.from === 'app' && squash(m.text) === squash(reply));
  if (have) delete have.from;
  else thread.messages.push({ role: 'openclaw', text: reply, at });
}
