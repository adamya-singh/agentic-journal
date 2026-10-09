// Carries out a fix OpenClaw suggested in a brief, through the same endpoints the rest of the app uses
// (the plan modal, the task editor, let go). Each one is confirmed on the card first.
import type { BriefAction, TaskBrief } from '@/lib/task-brief';
import { formatWhen } from '@/lib/done-at';

async function post(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.error || 'That didn’t work.');
}

// "Fri Oct 9" for a date, "Fri Oct 9, 5 PM" with a time.
function dayOf(date: string, time?: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const text = formatWhen(new Date(y, m - 1, d, hh, mm));
  return time ? text : text.replace(/, 12 AM$/, '');
}

/** The question the confirm step asks. */
export function confirmText(action: BriefAction, brief: TaskBrief): string {
  switch (action.kind) {
    case 'plan':
      return `Plan ${brief.short} on ${dayOf(action.date)}, ${action.end ? `${action.start}–${action.end}` : action.start}?`;
    case 'add-task':
      return `Add “${action.text}”${action.dueDate ? `, due ${dayOf(action.dueDate, action.dueTimeStart)}` : ''}?`;
    case 'set-due':
      return `Change the due date to ${dayOf(action.dueDate, action.dueTimeStart)}?`;
    case 'save-notes':
      return 'Add this to the task’s notes?';
    case 'merge':
      return `Let go of ${action.titles.map((t) => `“${t}”`).join(', ')} and note them on this task?`;
  }
}

export async function runBriefAction(action: BriefAction, brief: TaskBrief): Promise<void> {
  const { id: taskId, listType } = brief;
  switch (action.kind) {
    case 'plan':
      await post('/api/journal/create', { date: action.date });
      if (action.end) {
        await post('/api/journal/update', { date: action.date, range: { start: action.start, end: action.end, taskId, listType, entryMode: 'planned' } });
      } else {
        await post('/api/journal/append', { date: action.date, hour: action.start, taskId, listType, entryMode: 'planned' });
      }
      return;
    case 'add-task':
      await post('/api/tasks/add', {
        task: action.text,
        listType: action.listType,
        ...(action.dueDate ? { dueDate: action.dueDate } : {}),
        ...(action.dueTimeStart ? { dueTimeStart: action.dueTimeStart } : {}),
        ...(action.notesMarkdown ? { notesMarkdown: action.notesMarkdown } : {}),
      });
      return;
    case 'set-due':
      await post('/api/tasks/update', { taskId, listType, dueDate: action.dueDate, ...(action.dueTimeStart ? { dueTimeStart: action.dueTimeStart } : {}) });
      return;
    case 'save-notes':
      await post('/api/tasks/update', {
        taskId, listType,
        notesMarkdown: brief.notesMarkdown ? `${brief.notesMarkdown.trimEnd()}\n\n${action.markdown}` : action.markdown,
      });
      return;
    case 'merge': {
      for (const [i, otherId] of action.taskIds.entries()) {
        await post('/api/tasks/let-go', { taskId: otherId, listType: action.listTypes[i] ?? listType, reason: `Merged into “${brief.short}”` });
      }
      const merged = `**Merged in:**\n${action.titles.map((t) => `- ${t}`).join('\n')}`;
      await post('/api/tasks/update', {
        taskId, listType,
        notesMarkdown: brief.notesMarkdown ? `${brief.notesMarkdown.trimEnd()}\n\n${merged}` : merged,
      });
      return;
    }
  }
}
