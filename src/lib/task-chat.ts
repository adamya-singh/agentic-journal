// A short chat with OpenClaw about one task, from the Horizon brief. Each thread is one OpenClaw session,
// so "Continue in OpenClaw" opens the same conversation in the Control UI. The first message carries the
// brief as context; later ones are sent as typed.
// Pure: no filesystem, so the route and the tests share it.
import type { TaskBrief } from '@/lib/task-brief';

export interface TaskChatMessage {
  role: 'you' | 'openclaw';
  text: string;
  at: string;                    // ISO
}

export interface TaskChatThread {
  taskId: string;
  sessionKey: string;
  messages: TaskChatMessage[];
  pendingSince: string | null;   // a turn is out to OpenClaw
  error: string | null;          // the last turn failed
}

export const MAX_CHAT_MESSAGE = 4000;
export const CHAT_TURN_TIMEOUT_MS = 10 * 60_000;
const NOTES_MAX = 1500;

/** One OpenClaw session per thread; a new chat gets a new key. */
export function chatSessionKey(taskId: string, now: Date): string {
  const safe = taskId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 60);
  return `agent:main:journal-chat-${safe}-${now.getTime()}`;
}

/** A turn that was out when the server restarted never comes back; show it as failed. */
export function settleStalePending(thread: TaskChatThread, now: Date): boolean {
  if (!thread.pendingSince || now.getTime() - Date.parse(thread.pendingSince) <= CHAT_TURN_TIMEOUT_MS + 60_000) return false;
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
  }
  lines.push(`Journal task id: ${brief.id} (${brief.listType})`);
  return lines.join('\n');
}

/** What goes to OpenClaw for one turn. Only the first turn of a thread carries the brief. */
export function buildChatTurnMessage(input: { brief: TaskBrief | null; text: string; first: boolean }): string {
  if (!input.first) return input.text;
  const context = input.brief ? briefContext(input.brief) : 'The task could not be loaded.';
  return [
    'Adamya is asking about one of the tasks in the Agentic Journal, from a small chat panel on the task in the Horizon view.',
    'Keep answers short: a few sentences or a short list (markdown is fine). Look things up (Canvas, email, the journal, the web) when that helps.',
    'Do not change the task, the journal or anything else unless Adamya asks you to.',
    '',
    '--- The task, as the Journal knows it ---',
    context,
    '---',
    '',
    'Adamya’s message:',
    input.text,
  ].join('\n');
}
