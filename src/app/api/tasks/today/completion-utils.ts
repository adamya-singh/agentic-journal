import type { ListType, Task } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import { computeTodayTasks } from './today-compute-utils';
import type { TaskCompletionSnapshot } from './today-store-utils';
import {
  findLegacyDailyTaskById,
  readCompletedTaskSnapshots,
  readGeneralTasks,
  readTodayOverrides,
  upsertCompletedTaskIndexSnapshot,
  upsertCompletedTaskSnapshot,
  writeGeneralTasks,
} from './today-store-utils';
import { findTaskInDailySnapshot, removeTaskFromCurrent } from '../current/current-store-utils';
import { buildChildrenByParentId } from '@/lib/tasks';

export interface OpenSubtask {
  id: string;
  text: string;
  parentTaskId?: string;
  depth: number;
}

// Single completion core shared by today/complete and journal/plan-action so
// the open-subtask guard and General/Current eviction cannot drift between
// the two entry points.
export type CompleteTaskResult =
  | {
      status: 'completed';
      task: Task;
      generalTasks: Task[];
      computedTodayTasks: Task[];
      childrenByParentId: Map<string, Task[]>;
      completedTodayIds: Set<string>;
    }
  | { status: 'already-completed' }
  | { status: 'not-found' }
  | { status: 'blocked'; openSubtasks: OpenSubtask[] };

export function buildCompletionSnapshot(task: Task, listType: ListType): TaskCompletionSnapshot {
  const snapshot: TaskCompletionSnapshot = {
    id: task.id,
    text: task.text,
    completed: true,
    completedAt: new Date().toISOString(),
    listType,
  };

  if (task.dueDate) {
    snapshot.dueDate = task.dueDate;
  }
  if (task.dueTimeStart) {
    snapshot.dueTimeStart = task.dueTimeStart;
  }
  if (task.dueTimeEnd) {
    snapshot.dueTimeEnd = task.dueTimeEnd;
  }

  if (task.projects && task.projects.length > 0) {
    snapshot.projects = normalizeProjectList(task.projects);
  }

  if (task.parentTaskId && task.parentTaskId.trim().length > 0) {
    snapshot.parentTaskId = task.parentTaskId.trim();
  }

  if (task.notesMarkdown && task.notesMarkdown.trim().length > 0) {
    snapshot.notesMarkdown = task.notesMarkdown.trim();
  }

  if (task.isDaily) {
    snapshot.isDaily = true;
  }

  return snapshot;
}

function collectOpenDescendants(
  taskId: string,
  childrenByParentId: Map<string, Task[]>,
  completedTodayIds: Set<string>,
  depth = 1
): OpenSubtask[] {
  const results: OpenSubtask[] = [];
  const children = childrenByParentId.get(taskId) ?? [];

  for (const child of children) {
    if (!completedTodayIds.has(child.id)) {
      results.push({
        id: child.id,
        text: child.text,
        parentTaskId: child.parentTaskId,
        depth,
      });
    }
    results.push(...collectOpenDescendants(child.id, childrenByParentId, completedTodayIds, depth + 1));
  }

  return results;
}

export function completeTaskForDate(date: string, listType: ListType, taskId: string): CompleteTaskResult {
  const generalData = readGeneralTasks(listType);
  const completedSnapshots = readCompletedTaskSnapshots(date, listType);
  if (completedSnapshots.some((snapshot) => snapshot.id === taskId)) {
    return { status: 'already-completed' };
  }

  const computedTodayTasks = computeTodayTasks({
    date,
    generalTasks: generalData.tasks,
    overrides: readTodayOverrides(date, listType),
    completedSnapshots,
  });

  const taskFromToday =
    findTaskInDailySnapshot(date, listType, taskId) ??
    computedTodayTasks.find((task) => task.id === taskId) ??
    null;
  const taskFromGeneral = generalData.tasks.find((task) => task.id === taskId) ?? null;
  const taskFromLegacyDaily = findLegacyDailyTaskById(date, listType, taskId);
  const taskToComplete = taskFromToday ?? taskFromGeneral ?? taskFromLegacyDaily;

  if (!taskToComplete) {
    return { status: 'not-found' };
  }

  const childrenByParentId = buildChildrenByParentId(generalData.tasks);
  const completedTodayIds = new Set(completedSnapshots.map((snapshot) => snapshot.id));

  if (!taskToComplete.parentTaskId) {
    const openSubtasks = collectOpenDescendants(taskToComplete.id, childrenByParentId, completedTodayIds);
    if (openSubtasks.length > 0) {
      return { status: 'blocked', openSubtasks };
    }
  }

  const completionSnapshot = buildCompletionSnapshot(taskToComplete, listType);
  upsertCompletedTaskSnapshot(date, listType, completionSnapshot);
  upsertCompletedTaskIndexSnapshot(taskId, completionSnapshot, date);

  if (!taskToComplete.isDaily) {
    const initialLength = generalData.tasks.length;
    generalData.tasks = generalData.tasks.filter((task) => task.id !== taskId);
    if (generalData.tasks.length !== initialLength) {
      writeGeneralTasks(generalData, listType);
    }
    removeTaskFromCurrent(listType, taskId);
  }

  return {
    status: 'completed',
    task: taskToComplete,
    generalTasks: generalData.tasks,
    computedTodayTasks,
    childrenByParentId,
    completedTodayIds,
  };
}
