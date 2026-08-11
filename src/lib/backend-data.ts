import * as fs from 'fs';
import * as path from 'path';

// BACKEND_DATA_DIR redirects all task/journal storage; tests point it at a
// temp dir so store modules never touch real data (same pattern as
// JOB_APPLICATION_JOBS_DIR in the jobs store).
export function backendDataDir(): string {
  return process.env.BACKEND_DATA_DIR || path.join(process.cwd(), 'src/backend/data');
}

export function tasksDataDir(): string {
  return path.join(backendDataDir(), 'tasks');
}

export function journalDataDir(): string {
  return path.join(backendDataDir(), 'journal');
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
