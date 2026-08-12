import * as fs from 'fs';
import * as path from 'path';
import { backendDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { ListType } from '@/lib/types';

// Ledger of quick captures awaiting agent prioritization into Current.
// The app writes "requested"; the OpenClaw agent (via the agentic-journal
// skill CLI) resolves entries to "prioritized" or "skipped".
export type CapturePriorityStatus = 'requested' | 'prioritized' | 'skipped';

export interface CapturePriorityRequest {
  status: CapturePriorityStatus;
  listType: ListType;
  text: string;
  requestSource: string;
  requestedAt: string;
  updatedAt: string;
  rank?: number;
  reason?: string;
}

export interface CapturePriorityLedger {
  schemaVersion: number;
  date: string;
  requests: Record<string, CapturePriorityRequest>;
}

function ledgerDir(): string {
  return path.join(backendDataDir(), 'capture-priority');
}

export function todayInNewYork(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function readLedger(date: string): CapturePriorityLedger {
  const filePath = path.join(ledgerDir(), `${date}.json`);
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: 1, date, requests: {} };
  }
  try {
    const ledger = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as CapturePriorityLedger;
    return {
      schemaVersion: typeof ledger.schemaVersion === 'number' ? ledger.schemaVersion : 1,
      date,
      requests: ledger.requests && typeof ledger.requests === 'object' ? ledger.requests : {},
    };
  } catch {
    return { schemaVersion: 1, date, requests: {} };
  }
}

export function recordCapturePriorityRequest(params: {
  taskId: string;
  listType: ListType;
  text: string;
}): void {
  const date = todayInNewYork();
  const ledger = readLedger(date);
  const nowIso = new Date().toISOString();
  ledger.requests[params.taskId] = {
    status: 'requested',
    listType: params.listType,
    text: params.text,
    requestSource: 'quick-capture',
    requestedAt: nowIso,
    updatedAt: nowIso,
  };
  writeJsonFileAtomic(path.join(ledgerDir(), `${date}.json`), ledger);
}
