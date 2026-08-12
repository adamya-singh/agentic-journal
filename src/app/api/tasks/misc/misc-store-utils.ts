import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { Task, TasksData } from '@/lib/types';

// Misc Notes is the unclassified-capture fallback: a General-only backlog whose
// tasks are never referenced by Current, Today, the journal, or roadmaps. That
// invariant is what makes promote-by-remove+add (fresh id) safe.
const MISC_COMMENT = 'Misc Notes - unclassified quick captures awaiting triage';

function miscFilePath(): string {
  return path.join(tasksDataDir(), 'misc-notes.json');
}

export function readMiscTasks(): TasksData {
  const filePath = miscFilePath();
  if (!fs.existsSync(filePath)) {
    return { _comment: MISC_COMMENT, tasks: [] };
  }
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as TasksData;
    return { _comment: MISC_COMMENT, tasks: Array.isArray(data.tasks) ? data.tasks : [] };
  } catch {
    return { _comment: MISC_COMMENT, tasks: [] };
  }
}

export function writeMiscTasks(data: TasksData): void {
  writeJsonFileAtomic(miscFilePath(), data);
}

export function addMiscTask(text: string): Task {
  const data = readMiscTasks();
  const task: Task = { id: randomUUID(), text };
  data.tasks.push(task);
  writeMiscTasks(data);
  return task;
}

export function removeMiscTask(taskId: string): Task | null {
  const data = readMiscTasks();
  const index = data.tasks.findIndex((task) => task.id === taskId);
  if (index < 0) {
    return null;
  }
  const [removed] = data.tasks.splice(index, 1);
  writeMiscTasks(data);
  return removed;
}
