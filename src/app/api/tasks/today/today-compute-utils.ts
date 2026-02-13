import { Task } from '@/lib/types';
import { TaskCompletionSnapshot, TodayOverridesData, taskFromCompletionSnapshot } from './today-store-utils';

interface ComputeTodayTasksParams {
  date: string;
  generalTasks: Task[];
  overrides: TodayOverridesData;
  completedSnapshots: TaskCompletionSnapshot[];
}

/**
 * Compute today's tasks from:
 * - General tasks (due today + daily)
 * - Manual include/exclude overrides
 * - Completed snapshots for this date
 */
export function computeTodayTasks({
  date,
  generalTasks,
  overrides,
  completedSnapshots,
}: ComputeTodayTasksParams): Task[] {
  const includedIds = new Set(overrides.includedTaskIds);
  const excludedIds = new Set(overrides.excludedTaskIds);

  const completedById = new Map<string, TaskCompletionSnapshot>();
  for (const snapshot of completedSnapshots) {
    if (!completedById.has(snapshot.id)) {
      completedById.set(snapshot.id, snapshot);
    }
  }

  const results: Task[] = [];
  const seen = new Set<string>();

  for (const task of generalTasks) {
    const isDueToday = task.dueDate === date;
    const isDaily = task.isDaily === true;
    const isManuallyIncluded = includedIds.has(task.id);

    if (!isDueToday && !isDaily && !isManuallyIncluded) {
      continue;
    }

    const isExcluded = excludedIds.has(task.id);
    const exclusionAllowed = !isDueToday && !isDaily;
    if (isExcluded && exclusionAllowed) {
      continue;
    }

    const completedSnapshot = completedById.get(task.id);
    if (completedSnapshot) {
      results.push(taskFromCompletionSnapshot(completedSnapshot));
    } else {
      results.push({ ...task });
    }

    seen.add(task.id);
  }

  // Ensure completed tasks remain visible for the day even if removed from general list.
  for (const snapshot of completedSnapshots) {
    if (seen.has(snapshot.id)) {
      continue;
    }
    results.push(taskFromCompletionSnapshot(snapshot));
    seen.add(snapshot.id);
  }

  return results;
}
