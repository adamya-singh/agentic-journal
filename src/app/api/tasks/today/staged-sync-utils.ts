import type { ListType, Task } from '@/lib/types';
import { getEffectiveDailySnapshot } from '../current/current-store-utils';

type TodayTasksByList = {
  'have-to-do': Task[];
  'want-to-do': Task[];
};

// Journal `staged` writes live in current-store-utils
// (syncStagedJournalFromSnapshots) — the single writer. These helpers only
// compute effective Today membership for read paths.
export function computeTodayTasksForList(date: string, listType: ListType): Task[] {
  const snapshot = getEffectiveDailySnapshot(date, listType);
  return [...snapshot.selectedTasks, ...snapshot.automaticTasks];
}

export function computeTodayTasksByList(date: string): TodayTasksByList {
  return {
    'have-to-do': computeTodayTasksForList(date, 'have-to-do'),
    'want-to-do': computeTodayTasksForList(date, 'want-to-do'),
  };
}
