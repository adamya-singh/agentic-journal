// OpenClaw's brief layers, one record per task, in tasks/brief-agent.json. Only the Next server writes
// this file and every read-modify-write below is synchronous, so writes cannot interleave.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { AgentRecord } from '@/lib/brief-agent';

export type StoredAgentRecord = AgentRecord & { rank: number };   // queue order: lower runs first

interface AgentFile {
  _comment: string;
  schemaVersion: 1;
  records: Record<string, StoredAgentRecord>;
}

export function briefAgentFilePath(): string {
  return path.join(tasksDataDir(), 'brief-agent.json');
}

function read(): AgentFile {
  const empty: AgentFile = {
    _comment: 'OpenClaw background fills for Horizon task briefs, keyed by task id. Merged into /api/tasks/brief.',
    schemaVersion: 1,
    records: {},
  };
  const file = briefAgentFilePath();
  if (!fs.existsSync(file)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as AgentFile;
    return { ...empty, records: data.records && typeof data.records === 'object' ? data.records : {} };
  } catch {
    return empty;
  }
}

export function readAgentRecords(): Record<string, StoredAgentRecord> {
  return read().records;
}

export function readAgentRecord(taskId: string): StoredAgentRecord | undefined {
  return read().records[taskId];
}

export function mutateAgentRecords<T>(fn: (records: Record<string, StoredAgentRecord>) => T): T {
  const data = read();
  const result = fn(data.records);
  writeJsonFileAtomic(briefAgentFilePath(), data);
  return result;
}
