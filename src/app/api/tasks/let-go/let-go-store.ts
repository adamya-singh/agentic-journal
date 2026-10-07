// "Let go": deciding a task is no longer worth doing, without pretending it was done.
// A let-go task leaves the General list (with its subtasks), Current and Today the same way a
// completed or deleted task does, so every reader of the task files keeps working unchanged.
// The task itself is kept here, in tasks/let-go.json, so it can be restored to its old Current rank.
import * as fs from 'fs';
import * as path from 'path';
import type { ListType, Task } from '@/lib/types';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { buildChildrenByParentId, getDescendantTaskIds } from '@/lib/tasks';

export interface LetGoRecord {
  id: string;                 // the top-level task's id
  listType: ListType;
  letGoAt: string;
  reason?: string;
  task: Task;
  subtasks: Task[];           // descendants, in their original list order
  currentRank: number | null; // index in the Current queue when let go, if it was queued
}

export interface LetGoData {
  _comment: string;
  schemaVersion: 1;
  records: LetGoRecord[];
}

const EMPTY: LetGoData = {
  _comment: 'Tasks let go: no longer worth doing. Not counted as completed. Restorable.',
  schemaVersion: 1,
  records: [],
};

export function letGoFilePath(): string {
  return path.join(tasksDataDir(), 'let-go.json');
}

export function readLetGo(): LetGoData {
  const file = letGoFilePath();
  if (!fs.existsSync(file)) return { ...EMPTY, records: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as LetGoData;
  return { ...EMPTY, ...data, records: Array.isArray(data.records) ? data.records : [] };
}

export function writeLetGo(data: LetGoData): void {
  writeJsonFileAtomic(letGoFilePath(), data);
}

export type LetGoError = 'not-found' | 'daily' | 'completed';

/** Takes a task and its subtasks out of a General list. Pure: returns the new list and the record. */
export function takeOut(
  tasks: Task[],
  taskId: string,
  listType: ListType,
  currentIds: string[],
  now: Date,
  reason?: string,
): { error: LetGoError } | { tasks: Task[]; record: LetGoRecord; removedIds: string[] } {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return { error: 'not-found' };
  if (task.isDaily) return { error: 'daily' };
  if (task.completed) return { error: 'completed' };
  const descendantIds = getDescendantTaskIds(taskId, buildChildrenByParentId(tasks));
  const removedIds = [taskId, ...descendantIds];
  const removed = new Set(removedIds);
  const rank = currentIds.indexOf(taskId);
  const record: LetGoRecord = {
    id: taskId,
    listType,
    letGoAt: now.toISOString(),
    ...(reason?.trim() ? { reason: reason.trim() } : {}),
    task,
    subtasks: tasks.filter((t) => descendantIds.includes(t.id)),
    currentRank: rank >= 0 ? rank : null,
  };
  return { tasks: tasks.filter((t) => !removed.has(t.id)), record, removedIds };
}

/** Puts a let-go task back at the end of its General list. Skips ids already present. Pure. */
export function putBack(tasks: Task[], record: LetGoRecord): Task[] {
  const present = new Set(tasks.map((t) => t.id));
  return [...tasks, ...[record.task, ...record.subtasks].filter((t) => !present.has(t.id))];
}

/** Records let go since the given time, newest first. */
export function letGoSince(data: LetGoData, since: Date): LetGoRecord[] {
  return data.records
    .filter((r) => new Date(r.letGoAt).getTime() >= since.getTime())
    .sort((a, b) => b.letGoAt.localeCompare(a.letGoAt));
}
