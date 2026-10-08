import type { ListType, Task } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import { computeTodayTasks } from './today-compute-utils';
import type { TaskCompletionSnapshot } from './today-store-utils';
import {
  findLegacyDailyTaskById,
  readCompletedTaskSnapshots,
  readGeneralTasks,
  readTodayOverrides,
  refreshCompletedTaskIndexForTask,
  removeCompletedTaskIndexSnapshot,
  removeCompletedTaskSnapshot,
  upsertCompletedTaskIndexSnapshot,
  upsertCompletedTaskSnapshot,
  writeGeneralTasks,
} from './today-store-utils';
import {
  findTaskInDailySnapshot,
  removeTaskFromCurrent,
  restoreUncompletedTask,
  syncStagedJournalFromSnapshots,
} from '../current/current-store-utils';
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

export function buildCompletionSnapshot(
  task: Task,
  listType: ListType,
  completedAt: string = new Date().toISOString()
): TaskCompletionSnapshot {
  const snapshot: TaskCompletionSnapshot = {
    id: task.id,
    text: task.text,
    completed: true,
    completedAt,
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

// `completedAt` defaults to now; the Horizon "done, but when?" flow passes the real finish time
// (with `date` set to that time's day) so stats and the journal reflect when the work happened.
export function completeTaskForDate(
  date: string,
  listType: ListType,
  taskId: string,
  options: { completedAt?: string } = {}
): CompleteTaskResult {
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

  const completionSnapshot = buildCompletionSnapshot(taskToComplete, listType, options.completedAt);
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
  // Drop the completed task from the journal's staged list for this date;
  // without this, the next today/list read re-staged it and the next rollover
  // removed it again (visible flapping).
  syncStagedJournalFromSnapshots(date);

  return {
    status: 'completed',
    task: taskToComplete,
    generalTasks: generalData.tasks,
    computedTodayTasks,
    childrenByParentId,
    completedTodayIds,
  };
}

function toRestoredTask(snapshot: TaskCompletionSnapshot): Task {
  const task: Task = {
    id: snapshot.id,
    text: snapshot.text,
  };

  if (snapshot.projects && snapshot.projects.length > 0) {
    task.projects = normalizeProjectList(snapshot.projects);
  }

  if (snapshot.notesMarkdown && snapshot.notesMarkdown.length > 0) {
    task.notesMarkdown = snapshot.notesMarkdown;
  }

  if (snapshot.parentTaskId && snapshot.parentTaskId.length > 0) {
    task.parentTaskId = snapshot.parentTaskId;
  }

  if (snapshot.dueDate) {
    task.dueDate = snapshot.dueDate;
  }
  if (snapshot.dueTimeStart) {
    task.dueTimeStart = snapshot.dueTimeStart;
  }
  if (snapshot.dueTimeEnd) {
    task.dueTimeEnd = snapshot.dueTimeEnd;
  }

  if (snapshot.isDaily) {
    task.isDaily = true;
  }

  return task;
}

export type UncompleteTaskResult = { status: 'not-found' } | { status: 'uncompleted'; wasDaily: boolean };

// Reverses completeTaskForDate for one date: drops the snapshot, puts a non-daily task back at the
// top of General and back into Current. Shared by today/complete (toggle) and done-at undo.
export function uncompleteTaskForDate(date: string, listType: ListType, taskId: string): UncompleteTaskResult {
  const existingSnapshot = readCompletedTaskSnapshots(date, listType).find((snapshot) => snapshot.id === taskId) ?? null;
  const { removed, removedSnapshot } = removeCompletedTaskSnapshot(date, listType, taskId);
  if (!removed) {
    return { status: 'not-found' };
  }

  const snapshotToRestore = removedSnapshot ?? existingSnapshot;
  const wasDaily = snapshotToRestore?.isDaily === true;
  removeCompletedTaskIndexSnapshot(taskId);
  refreshCompletedTaskIndexForTask(taskId);

  if (!wasDaily && snapshotToRestore) {
    const generalData = readGeneralTasks(listType);
    if (!generalData.tasks.some((task) => task.id === taskId)) {
      generalData.tasks.unshift(toRestoredTask(snapshotToRestore));
      writeGeneralTasks(generalData, listType);
    }
  }
  restoreUncompletedTask(date, listType, taskId);

  return { status: 'uncompleted', wasDaily };
}
