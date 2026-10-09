import * as fs from 'fs';
import * as path from 'path';

// The default data dir, as segments rather than one 'src/backend/data' literal: Next's file tracer
// resolves path.join(process.cwd(), '<literal>') at build time and adds every file under it to every
// route that imports this module. With ~145k Omi audio chunks there, that made build memory grow with
// the data until production builds ran out of heap (2026-10-08). A spread array is opaque to it.
// Keep this pattern in any new store that builds a path under the data dir.
export const DEFAULT_DATA_SEGMENTS = ['src', 'backend', 'data'];

// BACKEND_DATA_DIR redirects all task/journal storage; tests point it at a
// temp dir so store modules never touch real data (same pattern as
// JOB_APPLICATION_JOBS_DIR in the jobs store).
export function backendDataDir(): string {
  return process.env.BACKEND_DATA_DIR || path.join(process.cwd(), ...DEFAULT_DATA_SEGMENTS);
}

export function tasksDataDir(): string {
  return path.join(backendDataDir(), 'tasks');
}

export function journalDataDir(): string {
  return path.join(backendDataDir(), 'journal');
}

export function projectsDataDir(): string {
  return path.join(backendDataDir(), 'projects');
}

// JOB_APPLICATION_JOBS_DIR predates BACKEND_DATA_DIR and still wins when set.
export function jobsDataDir(): string {
  return process.env.JOB_APPLICATION_JOBS_DIR || path.join(backendDataDir(), 'jobs');
}

// Atomic replace: concurrent readers (the CLI peer, parallel requests) must
// never observe a torn JSON file. Trailing newline matches the CLI's writer
// so files don't churn bytes when ownership alternates.
export function writeJsonFileAtomic(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = path.join(
    path.dirname(filePath),
    `.tmp-${path.basename(filePath)}-${process.pid}-${Date.now()}`
  );
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmpPath, filePath);
}
