import type { ListType } from '@/lib/types';

// Shared task-action helpers. The complete+log sequence previously lived in
// three near-identical copies (TaskLists, WeekView, the Library page); new
// surfaces should use this module.

const VALID_HOURS = [
  '7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm',
  '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am',
];

export function getCurrentHourLabel(): string {
  const hours = new Date().getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  return `${hours % 12 || 12}${ampm}`;
}

export function checkIfTaskLogged(
  journal: Record<string, unknown> | null | undefined,
  taskId: string,
): boolean {
  if (!journal) return false;
  const isLoggedRef = (entry: unknown): boolean =>
    !!entry &&
    typeof entry === 'object' &&
    (entry as { taskId?: unknown }).taskId === taskId &&
    (entry as { entryMode?: unknown }).entryMode === 'logged';
  for (const hour of VALID_HOURS) {
    const slot = journal[hour];
    if (!slot) continue;
    const entries = Array.isArray(slot) ? slot : [slot];
    if (entries.some(isLoggedRef)) return true;
  }
  const ranges = (journal as { ranges?: unknown }).ranges;
  if (Array.isArray(ranges) && ranges.some(isLoggedRef)) return true;
  return false;
}

export interface CompleteTaskResult {
  success: boolean;
  completed?: boolean;
  blockedByOpenSubtasks?: boolean;
  openSubtasks?: Array<{ id: string; text: string }>;
  promptToCompleteParent?: boolean;
  parentTask?: { id: string; text: string; listType: ListType };
  error?: string;
}

/**
 * Toggles a task's completion and, on a fresh completion, logs it to today's
 * journal at the current hour unless a logged entry already exists.
 */
export async function completeTaskWithLogging(params: {
  taskId: string;
  listType: ListType;
  date: string;
  /** The task's completion state BEFORE the toggle — logging happens only on a fresh completion. */
  wasCompleted: boolean;
}): Promise<CompleteTaskResult> {
  const { wasCompleted, ...body } = params;
  const response = await fetch('/api/tasks/today/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await response.json()) as CompleteTaskResult;
  if (!response.ok || !data.success) {
    return data;
  }

  if (!wasCompleted) {
    try {
      const journalRes = await fetch('/api/journal/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: [params.date], resolve: false }),
      });
      const journalData = await journalRes.json();
      if (!checkIfTaskLogged(journalData.journals?.[params.date], params.taskId)) {
        await fetch('/api/journal/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: params.date,
            hour: getCurrentHourLabel(),
            taskId: params.taskId,
            listType: params.listType,
            entryMode: 'logged',
          }),
        });
      }
    } catch (error) {
      console.error('Failed to log completion to journal:', error);
    }
  }

  return data;
}
