// Finishing a task at a chosen time: completes it for the day it was finished, with that
// completedAt, and logs a done entry in that day's journal. Used by the pad's "Done now" and
// "On time" buttons and by accepting an OpenClaw proposal.
import * as fs from 'fs';
import * as path from 'path';
import type { ListType } from '@/lib/types';
import { journalDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { journalSlotFor, type JournalSlot } from '@/lib/done-at';
import {
  logTaskDoneInJournal,
  unlogTaskDoneInJournal,
  type DayJournalWithRanges,
} from '../../journal/plan-lifecycle-utils';
import { ensureDailyJournalExists } from '../due-date-utils';
import { ensureCurrentSystemThroughToday } from '../current/current-store-utils';
import { completeTaskForDate, uncompleteTaskForDate, type OpenSubtask } from '../today/completion-utils';

/** Everything undo needs to reverse a done-at. */
export interface DoneReceipt {
  taskId: string;
  listType: ListType;
  completedAt: string;
  slot: JournalSlot;
  journalEntryId: string;
}

export type ApplyDoneResult =
  | { status: 'done'; receipt: DoneReceipt }
  | { status: 'not-found' | 'already-completed' }
  | { status: 'blocked'; openSubtasks: OpenSubtask[] };

function journalPath(date: string): string {
  return path.join(journalDataDir(), `${date}.json`);
}

function readJournal(date: string): DayJournalWithRanges {
  return JSON.parse(fs.readFileSync(journalPath(date), 'utf-8')) as DayJournalWithRanges;
}

export function applyDoneAt(input: {
  taskId: string;
  listType: ListType;
  completedAt: Date;
  rangeStart?: Date | null;
}): ApplyDoneResult {
  ensureCurrentSystemThroughToday();
  const slot = journalSlotFor(input.completedAt, input.rangeStart);
  const completedAt = input.completedAt.toISOString();
  const result = completeTaskForDate(slot.date, input.listType, input.taskId, { completedAt });
  if (result.status === 'blocked') return { status: 'blocked', openSubtasks: result.openSubtasks };
  if (result.status !== 'completed') return { status: result.status };

  ensureDailyJournalExists(slot.date);
  const journal = readJournal(slot.date);
  const { journalEntryId } = logTaskDoneInJournal(journal, slot, input.taskId, input.listType);
  writeJsonFileAtomic(journalPath(slot.date), journal);

  return { status: 'done', receipt: { taskId: input.taskId, listType: input.listType, completedAt, slot, journalEntryId } };
}

export function undoDoneAt(receipt: DoneReceipt): { status: 'undone' | 'not-found' } {
  const result = uncompleteTaskForDate(receipt.slot.date, receipt.listType, receipt.taskId);
  if (fs.existsSync(journalPath(receipt.slot.date))) {
    const journal = readJournal(receipt.slot.date);
    if (unlogTaskDoneInJournal(journal, receipt.slot, receipt.taskId, receipt.journalEntryId)) {
      writeJsonFileAtomic(journalPath(receipt.slot.date), journal);
    }
  }
  return { status: result.status === 'uncompleted' ? 'undone' : 'not-found' };
}
