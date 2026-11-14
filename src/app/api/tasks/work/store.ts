// The task worker's record per task, in tasks/task-work.json. Only the Next server writes this file and every
// read-modify-write below is synchronous, so writes cannot interleave. Kept free of other stores' imports so the
// job-application claim can ask whether a task run holds OpenClaw's browser without an import cycle.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { emptyTaskWorkMeta, leaseLive, type TaskWork, type TaskWorkMeta } from '@/lib/task-work';

export interface TaskWorkFile {
  _comment: string;
  version: 1;
  meta: TaskWorkMeta;
  records: Record<string, TaskWork>;
}

export function taskWorkFilePath(): string {
  return path.join(tasksDataDir(), 'task-work.json');
}

function emptyFile(): TaskWorkFile {
  return {
    _comment: 'OpenClaw task worker state, keyed by task id. See docs/task-worker-design.md.',
    version: 1,
    meta: emptyTaskWorkMeta(),
    records: {},
  };
}

export function readTaskWorkFile(): TaskWorkFile {
  const empty = emptyFile();
  const file = taskWorkFilePath();
  if (!fs.existsSync(file)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<TaskWorkFile>;
    const meta = { ...empty.meta, ...(data.meta && typeof data.meta === 'object' ? data.meta : {}) };
    return { ...empty, meta, records: data.records && typeof data.records === 'object' ? data.records : {} };
  } catch {
    return empty;
  }
}

export function readTaskWorkRecord(taskId: string): TaskWork | undefined {
  return readTaskWorkFile().records[taskId];
}

export function mutateTaskWork<T>(fn: (data: TaskWorkFile) => T): T {
  const data = readTaskWorkFile();
  const result = fn(data);
  writeJsonFileAtomic(taskWorkFilePath(), data);
  return result;
}

/** Whether any run claimed a task at or after `sinceMs`: the cron wake's check that its run did something. */
export function taskWorkClaimedSince(sinceMs: number): boolean {
  try {
    return Object.values(readTaskWorkFile().records).some((r) =>
      (r.lease && Date.parse(r.lease.claimedAt) >= sinceMs)
      || r.history.some((h) => h.to === 'working' && Date.parse(h.at) >= sinceMs));
  } catch {
    return false;
  }
}

/** A task run holds OpenClaw's browser: the job-application claim and the brief agent wait for it. */
export function taskWorkLeaseLive(now = new Date()): boolean {
  try {
    return Object.values(readTaskWorkFile().records).some((r) => leaseLive(r, now));
  } catch {
    return false;
  }
}
