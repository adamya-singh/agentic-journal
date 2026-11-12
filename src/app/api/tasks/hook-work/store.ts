// Adamya's own text for the started work of each task, in tasks/hook-work.json (see lib/hook-work.ts). Only the
// Next server writes this file and every read-modify-write below is synchronous, so writes cannot interleave.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { HookWorkRecord } from '@/lib/hook-work';

interface HookWorkFile {
  _comment: string;
  schemaVersion: 1;
  records: Record<string, HookWorkRecord>;
}

export function hookWorkFilePath(): string {
  return path.join(tasksDataDir(), 'hook-work.json');
}

function read(): HookWorkFile {
  const empty: HookWorkFile = {
    _comment: 'What Adamya wrote on top of the work OpenClaw started for a task, keyed by task id. Shown by Sunrise.',
    schemaVersion: 1,
    records: {},
  };
  const file = hookWorkFilePath();
  if (!fs.existsSync(file)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as HookWorkFile;
    return { ...empty, records: data.records && typeof data.records === 'object' ? data.records : {} };
  } catch {
    return empty;
  }
}

export function readHookWorkRecords(): Record<string, HookWorkRecord> {
  return read().records;
}

export function readHookWorkRecord(taskId: string): HookWorkRecord | undefined {
  return read().records[taskId];
}

export function mutateHookWorkRecords<T>(fn: (records: Record<string, HookWorkRecord>) => T): T {
  const data = read();
  const result = fn(data.records);
  writeJsonFileAtomic(hookWorkFilePath(), data);
  return result;
}
