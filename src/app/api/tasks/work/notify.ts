// One Telegram message a day about what the task worker needs from Adamya (docs/task-worker-design.md, "Decided by
// Adamya" 5). Sent at the first five-minute tick from 09:00 that has pending items he has not been told about, never
// in quiet hours (23:00–08:00), at most once a local day; items raised later in the day wait for tomorrow's message.
// Each line links to the task's brief on the home page. A failed send is retried on the next tick, at most three
// tries a day. Sent through the OpenClaw CLI (`openclaw message send --channel telegram`), to
// TASK_WORKER_TELEGRAM_TARGET or else the chat OpenClaw's own announce crons deliver to. TASK_WORKER_NOTIFY_DISABLED=1
// turns it off, as does TASK_WORKER_DISABLED.
import { telegramAvailable, telegramSend, telegramSendArgs, telegramTarget } from '@/lib/telegram';
import { taskLink } from '@/lib/task-link';
import { localDay, pendingItems, quietHours, type NeedsYouItem, type TaskWork, type TaskWorkMeta } from '@/lib/task-work';
import { openTaskRefs } from '../brief/build';
import { taskWorkDisabled } from './actions';
import { mutateTaskWork, readTaskWorkFile } from './store';

export const NOTIFY_FROM_HOUR = 9;
export const NOTIFY_TRIES_PER_DAY = 3;
export const NOTIFY_MAX_TASKS = 5;
const TASK_TEXT_MAX = 60;
const NEED_TEXT_MAX = 80;
// The Journal's public address, as the uptime monitor and the media routes know it.
const DEFAULT_ORIGIN = 'https://ubuntu-laptop.taile85e97.ts.net';

export const journalOrigin = () => (process.env.AGENTIC_JOURNAL_ORIGIN || DEFAULT_ORIGIN).replace(/\/+$/, '');
export const notifyDisabled = () => process.env.TASK_WORKER_NOTIFY_DISABLED === '1' || taskWorkDisabled();

export { announceTargetFromCronList, telegramSendArgs } from '@/lib/telegram';

// ───────────── what to tell, and when ─────────────

export interface UntoldTask { taskId: string; taskText: string; items: NeedsYouItem[] }

/** Pending items on open tasks that no message has told him about yet, oldest task first. */
export function untoldItems(records: Record<string, TaskWork>, openText: Map<string, string>, meta: TaskWorkMeta): UntoldTask[] {
  const after = meta.lastNotifiedAt ?? '';
  const out: UntoldTask[] = [];
  for (const [taskId, record] of Object.entries(records)) {
    const taskText = openText.get(taskId);
    if (taskText === undefined) continue;
    const items = pendingItems(record)
      .filter((i) => !i.notifiedAt && i.createdAt > after)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (items.length) out.push({ taskId, taskText, items });
  }
  return out.sort((a, b) => a.items[0].createdAt.localeCompare(b.items[0].createdAt));
}

export type NotifyDecision = 'send' | 'disabled' | 'quiet' | 'sent-today' | 'tries-used' | 'nothing';

/** Pure: whether to send the day's message now. */
export function decideNotify(input: { now: Date; disabled: boolean; meta: TaskWorkMeta; untold: number }): NotifyDecision {
  const { now, meta } = input;
  if (input.disabled) return 'disabled';
  if (quietHours(now) || now.getHours() < NOTIFY_FROM_HOUR) return 'quiet';
  const today = localDay(now);
  if (meta.lastNotifiedAt && localDay(new Date(meta.lastNotifiedAt)) === today) return 'sent-today';
  if (meta.notifyTries?.date === today && meta.notifyTries.count >= NOTIFY_TRIES_PER_DAY) return 'tries-used';
  if (input.untold === 0) return 'nothing';
  return 'send';
}

// Plain text: no characters a Markdown renderer would act on.
const plain = (s: string) => s.replace(/[*`~]/g, '').replace(/\s+/g, ' ').trim();
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

function need(items: NeedsYouItem[]): string {
  const first = items[0];
  const text = plain(first.kind === 'approval' ? `Approve: ${first.text}` : first.text);
  const more = items.length > 1 ? ` (+${items.length - 1} more)` : '';
  return clip(text, NEED_TEXT_MAX - more.length) + more;
}

/** The message: a headline, then up to five tasks with what each needs and its link, then how many more. */
export function buildNeedsYouMessage(tasks: UntoldTask[], origin: string): string {
  const n = tasks.length;
  const lines = [`OpenClaw needs you on ${n} ${n === 1 ? 'task' : 'tasks'}`];
  for (const t of tasks.slice(0, NOTIFY_MAX_TASKS)) {
    lines.push(`• ${clip(plain(t.taskText), TASK_TEXT_MAX)}: ${need(t.items)}`, `${origin}${taskLink(t.taskId, 'brief')}`);
  }
  if (n > NOTIFY_MAX_TASKS) lines.push(`+ ${n - NOTIFY_MAX_TASKS} more`);
  return lines.join('\n');
}

// ───────────── sending ─────────────

export interface NotifyDeps {
  available: () => boolean;
  target: () => Promise<string | null>;
  send: (args: string[]) => Promise<string>;
  origin: () => string;
}

const STATE = Symbol.for('agentic-journal.task-work-notify');
interface NotifyState { inFlight: boolean; loggedNoTarget: boolean }
function state(): NotifyState {
  const g = globalThis as { [STATE]?: NotifyState };
  return (g[STATE] ??= { inFlight: false, loggedNoTarget: false });
}

const cliDeps: NotifyDeps = { available: telegramAvailable, target: telegramTarget, send: telegramSend, origin: journalOrigin };

export interface NotifyResult { decision: NotifyDecision | 'no-cli' | 'no-target' | 'sent' | 'failed' | 'busy'; tasks?: number; message?: string; error?: string }

/** Sends the day's message when it is due. Never throws; safe to call on every tick. */
export async function notifyNeedsYou(now = new Date(), deps: NotifyDeps = cliDeps): Promise<NotifyResult> {
  const s = state();
  if (s.inFlight) return { decision: 'busy' };
  s.inFlight = true;
  try {
    const data = readTaskWorkFile();
    // The time and the day's count first: the task lists are read only when a message could go.
    const early = decideNotify({ now, disabled: notifyDisabled(), meta: data.meta, untold: 1 });
    if (early !== 'send') return { decision: early };
    const openText = new Map(openTaskRefs().map((r) => [r.task.id, r.task.text]));
    const untold = untoldItems(data.records, openText, data.meta);
    const decision = decideNotify({ now, disabled: notifyDisabled(), meta: data.meta, untold: untold.length });
    if (decision !== 'send') return { decision };
    if (!deps.available()) return { decision: 'no-cli' };
    const target = await deps.target();
    if (!target) {
      if (!s.loggedNoTarget) console.warn('Task worker notify: no Telegram target (set TASK_WORKER_TELEGRAM_TARGET); not sending');
      s.loggedNoTarget = true;
      return { decision: 'no-target' };
    }

    const message = buildNeedsYouMessage(untold, deps.origin());
    const today = localDay(now);
    // Counted before it goes, so a send that hangs or dies still uses one of the day's tries.
    mutateTaskWork((d) => {
      d.meta.notifyTries = { date: today, count: (d.meta.notifyTries?.date === today ? d.meta.notifyTries.count : 0) + 1 };
    });
    try {
      await deps.send(telegramSendArgs(target, message));
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      console.error('Task worker notify: send failed:', text);
      return { decision: 'failed', error: text };
    }
    const told = new Set(untold.flatMap((t) => t.items.map((i) => i.id)));
    const at = now.toISOString();
    mutateTaskWork((d) => {
      d.meta.lastNotifiedAt = at;
      for (const record of Object.values(d.records)) {
        for (const item of record.items) if (told.has(item.id)) item.notifiedAt = at;
      }
    });
    return { decision: 'sent', tasks: untold.length, message };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error('Task worker notify failed:', text);
    return { decision: 'failed', error: text };
  } finally {
    s.inFlight = false;
  }
}
