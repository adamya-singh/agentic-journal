import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  ListType,
  StagedTaskEntry,
  JournalRangeEntry,
  JournalHourSlot,
  isJournalEntryArray,
  isTaskJournalEntry,
} from '@/lib/types';
import { excludeTaskInTodayOverrides } from '../today-store-utils';

interface DayJournalFile {
  [key: string]: JournalHourSlot | JournalRangeEntry[] | StagedTaskEntry[] | undefined;
  ranges?: JournalRangeEntry[];
  staged?: StagedTaskEntry[];
}

const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

function getJournalFilePath(date: string): string {
  return path.join(process.cwd(), `src/backend/data/journal/${date}.json`);
}

function readJournal(date: string): DayJournalFile | null {
  const journalFile = getJournalFilePath(date);
  if (!fs.existsSync(journalFile)) {
    return null;
  }
  const content = fs.readFileSync(journalFile, 'utf-8');
  return JSON.parse(content) as DayJournalFile;
}

function writeJournal(date: string, journal: DayJournalFile): void {
  const journalFile = getJournalFilePath(date);
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2), 'utf-8');
}

/**
 * Remove all journal entries (hour slots, ranges, staged) referencing a task
 */
function removeTaskFromJournal(date: string, taskId: string): boolean {
  const journal = readJournal(date);
  if (!journal) {
    return false;
  }

  let modified = false;

  for (const hour of HOURS) {
    const slot = journal[hour] as JournalHourSlot;

    if (isJournalEntryArray(slot)) {
      const filtered = slot.filter((entry) => !isTaskJournalEntry(entry) || entry.taskId !== taskId);
      if (filtered.length !== slot.length) {
        modified = true;
        if (filtered.length === 0) {
          journal[hour] = '';
        } else if (filtered.length === 1) {
          journal[hour] = filtered[0];
        } else {
          journal[hour] = filtered;
        }
      }
    } else if (slot && isTaskJournalEntry(slot) && slot.taskId === taskId) {
      journal[hour] = '';
      modified = true;
    }
  }

  if (journal.ranges) {
    const before = journal.ranges.length;
    journal.ranges = journal.ranges.filter((range) => !('taskId' in range) || range.taskId !== taskId);
    if (journal.ranges.length !== before) {
      modified = true;
    }
  }

  if (journal.staged) {
    const before = journal.staged.length;
    journal.staged = journal.staged.filter((entry) => entry.taskId !== taskId);
    if (journal.staged.length !== before) {
      modified = true;
    }
  }

  if (modified) {
    writeJournal(date, journal);
  }

  return modified;
}

/**
 * POST /api/tasks/today/remove
 * Adds a manual exclusion override so a task is removed from the computed today list.
 *
 * Body: { taskId: string, listType: 'have-to-do' | 'want-to-do', date: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, listType, date } = body;

    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskId parameter is required and must be a string' },
        { status: 400 }
      );
    }

    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { success: false, error: 'date parameter is required and must be a string in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const { changed } = excludeTaskInTodayOverrides(date, listType as ListType, taskId);
    const journalCleaned = removeTaskFromJournal(date, taskId);

    return NextResponse.json({
      success: true,
      removed: changed || journalCleaned,
      message: 'Task removed from today\'s list',
      journalCleaned,
    });
  } catch (error) {
    console.error('Error removing task from computed today list:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
