// Pending "when did you finish it?" conversations with OpenClaw, kept in tasks/done-proposals.json
// until Adamya accepts or declines, so a proposal bubble survives a reload. Only the Next server
// writes this file, and every read-modify-write below is synchronous, so writes cannot interleave.
import * as fs from 'fs';
import * as path from 'path';
import type { ListType } from '@/lib/types';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { DoneProposal, OpenClawDoneReply } from '@/lib/done-at';
import type { DoneReceipt } from '../done-at/apply';

export type ProposalStatus = 'thinking' | 'proposed' | 'needs-more' | 'failed' | 'accepted' | 'declined';

export interface ProposalMessage {
  role: 'you' | 'openclaw';
  text: string;
  at: string;
}

export interface DoneProposalRecord {
  id: string;
  taskId: string;
  listType: ListType;
  short: string;
  title: string;
  due: string | null;
  dueIsImplied: boolean;
  status: ProposalStatus;
  messages: ProposalMessage[];
  proposal: DoneProposal | null;
  question: string | null;
  error: string | null;
  sessionKey: string;
  turn: number;               // bumps on every message sent, so a late OpenClaw answer to an old turn is ignored
  createdAt: string;
  updatedAt: string;
  receipt?: DoneReceipt;
}

interface ProposalsFile {
  _comment: string;
  schemaVersion: 1;
  records: DoneProposalRecord[];
}

export const OPEN_STATUSES: ProposalStatus[] = ['thinking', 'proposed', 'needs-more', 'failed'];
export const THINKING_TIMEOUT_MS = 3 * 60_000;
const KEEP_CLOSED_MS = 30 * 86_400_000;

export function proposalsFilePath(): string {
  return path.join(tasksDataDir(), 'done-proposals.json');
}

function read(): ProposalsFile {
  const file = proposalsFilePath();
  const empty: ProposalsFile = {
    _comment: 'Horizon "done, but when?" proposals from OpenClaw, kept until accepted or declined.',
    schemaVersion: 1,
    records: [],
  };
  if (!fs.existsSync(file)) return empty;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as ProposalsFile;
    return { ...empty, records: Array.isArray(data.records) ? data.records : [] };
  } catch {
    return empty;
  }
}

/** Reads, lets `fn` change the records, expires stuck turns, prunes old closed ones, writes. */
export function mutateProposals<T>(fn: (records: DoneProposalRecord[]) => T, now = new Date()): T {
  const data = read();
  const result = fn(data.records);
  data.records = prune(expireStale(data.records, now), now);
  writeJsonFileAtomic(proposalsFilePath(), data);
  return result;
}

export function readOpenProposals(now = new Date()): DoneProposalRecord[] {
  if (read().records.some((r) => isStale(r, now))) mutateProposals(() => undefined, now);
  return read().records.filter((r) => OPEN_STATUSES.includes(r.status));
}

function isStale(record: DoneProposalRecord, now: Date): boolean {
  return record.status === 'thinking' && now.getTime() - Date.parse(record.updatedAt) > THINKING_TIMEOUT_MS;
}

/** A turn that never came back (server restart, hung CLI) becomes a failed one the user can retry. */
export function expireStale(records: DoneProposalRecord[], now: Date): DoneProposalRecord[] {
  return records.map((r) => (isStale(r, now)
    ? { ...r, status: 'failed', error: 'OpenClaw didn’t answer in time.', updatedAt: now.toISOString() }
    : r));
}

function prune(records: DoneProposalRecord[], now: Date): DoneProposalRecord[] {
  return records.filter((r) => OPEN_STATUSES.includes(r.status) || now.getTime() - Date.parse(r.updatedAt) < KEEP_CLOSED_MS);
}

export function newProposal(input: {
  id: string;
  taskId: string;
  listType: ListType;
  short: string;
  title: string;
  due: string | null;
  dueIsImplied: boolean;
  text: string;
  now: Date;
}): DoneProposalRecord {
  const at = input.now.toISOString();
  return {
    id: input.id,
    taskId: input.taskId,
    listType: input.listType,
    short: input.short,
    title: input.title,
    due: input.due,
    dueIsImplied: input.dueIsImplied,
    status: 'thinking',
    messages: [{ role: 'you', text: input.text, at }],
    proposal: null,
    question: null,
    error: null,
    sessionKey: `agent:main:journal-done-${input.id}`,
    turn: 1,
    createdAt: at,
    updatedAt: at,
  };
}

/** Records a new message from Adamya and starts a new turn. */
export function sendMessage(record: DoneProposalRecord, text: string, now: Date): DoneProposalRecord {
  return {
    ...record,
    status: 'thinking',
    error: null,
    turn: record.turn + 1,
    messages: [...record.messages, { role: 'you', text, at: now.toISOString() }],
    updatedAt: now.toISOString(),
  };
}

/** Applies OpenClaw's answer, unless it belongs to an older turn or the record was closed meanwhile. */
export function receiveReply(record: DoneProposalRecord, turn: number, reply: OpenClawDoneReply, now: Date): DoneProposalRecord {
  if (record.status !== 'thinking' || record.turn !== turn) return record;
  const at = now.toISOString();
  if (reply.kind === 'question') {
    return {
      ...record,
      status: 'needs-more',
      question: reply.question,
      messages: [...record.messages, { role: 'openclaw', text: reply.question, at }],
      updatedAt: at,
    };
  }
  return {
    ...record,
    status: 'proposed',
    proposal: reply.proposal,
    question: null,
    messages: [...record.messages, { role: 'openclaw', text: reply.proposal.note || 'Here’s what I’d record.', at }],
    updatedAt: at,
  };
}

export function failTurn(record: DoneProposalRecord, turn: number, error: string, now: Date): DoneProposalRecord {
  if (record.status !== 'thinking' || record.turn !== turn) return record;
  return { ...record, status: 'failed', error, updatedAt: now.toISOString() };
}
