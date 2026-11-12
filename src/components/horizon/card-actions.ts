// Answering an action card, shared by Horizon Dawn's far side and Sunrise. Agree with "task" makes the task first,
// so a failed answer can take it back; undo removes the task an agreed card made.
import type { ActionCard, CardOutcome } from '@/lib/action-cards/types';
import { SRC_NAME, type CardDecisionInput } from './ActionCardView';

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());

export type CardDecided = { ok: true; outcome: CardOutcome | undefined } | { ok: false; error: string };

/** Saves Adamya's answer to a card. Nothing is left behind when it fails. */
export async function decideCard(card: ActionCard, d: CardDecisionInput): Promise<CardDecided> {
  let taskId: string | undefined, taskListType: 'have-to-do' | 'want-to-do' | undefined;
  const o = card.outcomes.find((x) => x.kind === d.outcome);
  if (d.verdict === 'agree' && d.outcome === 'task') {
    taskListType = o?.listType ?? 'want-to-do';
    const notes = [`From an action card${card.source === 'x' ? ' (Openclaw folder)' : ` OpenClaw noticed in ${SRC_NAME[card.source]}`}.`, '', card.what, card.post ? `\n${card.post.url}` : card.link ? `\n${card.link}` : '', '', `Why: ${d.reason}`].join('\n');
    const t = await post('/api/tasks/add', { task: card.title, listType: taskListType, ...(o?.due ? { dueDate: o.due } : {}), notesMarkdown: notes });
    if (!t.success) return { ok: false, error: t.error || 'Could not make the task.' };
    taskId = t.taskId;
  }
  const r = await post('/api/action-cards/decide', { id: card.id, verdict: d.verdict, reason: d.reason, ...(d.outcome ? { outcome: d.outcome } : {}), ...(taskId ? { taskId, taskListType } : {}), ...(d.snooze ? { snooze: true } : {}) });
  if (!r.success) {
    if (taskId) await post('/api/tasks/remove', { taskId, listType: taskListType });
    return { ok: false, error: r.error || 'Could not save that answer.' };
  }
  return { ok: true, outcome: o };
}

/** Takes an answer back: the card is open again, and a task it made is removed. */
export async function undoCard(id: string): Promise<void> {
  const r = await post('/api/action-cards/decide', { id, undo: true });
  if (r.success && r.data.removeTask) await post('/api/tasks/remove', { taskId: r.data.removeTask.id, listType: r.data.removeTask.listType });
}
