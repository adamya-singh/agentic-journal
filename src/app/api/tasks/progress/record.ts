import { recordProgress, type ProgressEntry } from '@/lib/task-progress';
import type { ListType, Task } from '@/lib/types';
import { withCliFileLock } from '@/lib/cli-file-lock';
import { getGeneralTasksFilePath, readGeneralTasks, writeGeneralTasks } from '../today/today-store-utils';
import { scheduleBriefFills } from '../brief-agent/worker';

/** The task with this id; subtasks are their own entries in the list (with parentTaskId), a nested one is found too. */
function findTask(tasks: Task[], taskId: string): Task | undefined {
  for (const task of tasks) {
    if (task.id === taskId) return task;
    const nested = task.childTasks?.length ? findTask(task.childTasks, taskId) : undefined;
    if (nested) return nested;
  }
  return undefined;
}

/**
 * Adds one entry to a task's "## Progress" notes and has its brief filled again. Shared by POST /api/tasks/progress
 * and the task worker's `progress` update, so both write the same way. Null when no open task has the id.
 */
export function recordTaskProgress(taskId: string, entry: ProgressEntry): { listType: ListType; notesMarkdown: string } | null {
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    // OpenClaw's CLI may be rewriting the same list in the same turn: the read and the write share its lock.
    const notesMarkdown = withCliFileLock(getGeneralTasksFilePath(listType), () => {
      const data = readGeneralTasks(listType);
      const task = findTask(data.tasks, taskId);
      if (!task) return null;
      task.notesMarkdown = recordProgress(task.notesMarkdown, entry, new Date());
      writeGeneralTasks(data, listType);
      return task.notesMarkdown;
    });
    if (notesMarkdown === null) continue;
    scheduleBriefFills({ force: taskId });
    return { listType, notesMarkdown };
  }
  return null;
}
