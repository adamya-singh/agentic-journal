// The merges that were made, in tasks/merges.json: each with both tasks as they were (so a merge can be taken
// back, and nothing either task held is lost), and where the id of a task that was folded in now leads. Only the
// Next server writes this file, synchronously.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { MergeRecord } from '@/lib/task-merge';

const COMMENT = 'Tasks merged into one from Sunrise: each merge with both tasks as they were, and `aliases` (the id of a task that was folded in → the task it is in now).';
const KEPT = 60;

interface MergeFile { _comment: string; schemaVersion: 1; records: MergeRecord[]; aliases: Record<string, string> }

export function mergesFilePath(): string {
  return path.join(tasksDataDir(), 'merges.json');
}

function read(): MergeFile {
  const empty: MergeFile = { _comment: COMMENT, schemaVersion: 1, records: [], aliases: {} };
  try {
    const stored = JSON.parse(fs.readFileSync(mergesFilePath(), 'utf-8')) as Partial<MergeFile>;
    return {
      ...empty,
      records: Array.isArray(stored.records) ? stored.records : [],
      aliases: stored.aliases && typeof stored.aliases === 'object' ? stored.aliases : {},
    };
  } catch {
    return empty;
  }
}

export function readMerge(id: string): MergeRecord | undefined {
  return read().records.find((record) => record.id === id);
}

export function mutateMerges<T>(fn: (file: MergeFile) => T): T {
  const file = read();
  const result = fn(file);
  file.records = file.records.slice(-KEPT);
  writeJsonFileAtomic(mergesFilePath(), { ...file, _comment: COMMENT, schemaVersion: 1 });
  return result;
}

/**
 * The task an id leads to now: itself, or the task it was folded into (and on, if that one was folded in too).
 * A chat OpenClaw began in a task that has since been merged still names the old id when it writes to the Journal.
 */
export function mergedInto(taskId: string): string {
  let aliases: Record<string, string>;
  try {
    if (!fs.existsSync(mergesFilePath())) return taskId;
    aliases = read().aliases;
  } catch {
    return taskId;
  }
  let id = taskId;
  for (let hop = 0; hop < 8 && typeof aliases[id] === 'string' && aliases[id] !== id; hop++) id = aliases[id]!;
  return id;
}
