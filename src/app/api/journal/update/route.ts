import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayJournal,
  EntryMode,
  JournalRangeEntry,
  StagedTaskEntry,
} from '@/lib/types';

// Path to the journal directory
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Journal with ranges and staged support
type DayJournalWithRanges = DayJournal & {
  ranges?: JournalRangeEntry[];
  staged?: StagedTaskEntry[];
};

function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

function isValidEntryMode(entryMode: unknown): entryMode is EntryMode {
  return entryMode === 'planned' || entryMode === 'logged';
}

function isValidListType(listType: unknown): listType is 'have-to-do' | 'want-to-do' {
  return listType === 'have-to-do' || listType === 'want-to-do';
}

function getJournalFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

function journalFileExists(date: string): boolean {
  const filePath = getJournalFilePath(date);
  return fs.existsSync(filePath);
}

function readJournalFile(date: string): DayJournalWithRanges {
  const filePath = getJournalFilePath(date);
  const content = fs.readFileSync(filePath, 'utf-8');
  const journal = JSON.parse(content) as DayJournalWithRanges;
  if (!journal.ranges) {
    journal.ranges = [];
  }
  return journal;
}

function writeJournalFile(date: string, journal: DayJournalWithRanges): void {
  const filePath = getJournalFilePath(date);
  fs.writeFileSync(filePath, JSON.stringify(journal, null, 2), 'utf-8');
}

/**
 * POST /api/journal/update
 * Adds/removes journal range entries.
 *
 * Hourly update payloads are intentionally rejected.
 *
 * Range add payload:
 * { date, range: { start, end, entryMode, text? | taskId+listType } }
 *
 * Range remove payload:
 * { date, removeRange: { start, end } }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, entry, text, taskId, listType, range, removeRange, entryMode, entryIndex } = body;

    if ('isPlan' in body) {
      return NextResponse.json(
        { success: false, error: 'isPlan is no longer supported. Use entryMode: "planned" | "logged".' },
        { status: 400 }
      );
    }

    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
        { status: 400 }
      );
    }

    if (!journalFileExists(date)) {
      return NextResponse.json(
        { success: false, error: `No journal exists for date ${date}. Create one first.` },
        { status: 404 }
      );
    }

    if (
      hour !== undefined ||
      entry !== undefined ||
      text !== undefined ||
      taskId !== undefined ||
      listType !== undefined ||
      entryMode !== undefined ||
      entryIndex !== undefined
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Hourly overwrite/update is disabled. Use /api/journal/append to add entries. To replace, call /api/journal/delete first, then /api/journal/append.',
        },
        { status: 409 }
      );
    }

    const journal = readJournalFile(date);

    if (removeRange) {
      const { start, end } = removeRange;
      if (!start || !end || !VALID_HOURS.includes(start) || !VALID_HOURS.includes(end)) {
        return NextResponse.json(
          { success: false, error: 'Invalid range. start and end must be valid hours.' },
          { status: 400 }
        );
      }

      const initialLength = journal.ranges?.length || 0;
      journal.ranges = (journal.ranges || []).filter((r) => !(r.start === start && r.end === end));

      writeJournalFile(date, journal);

      return NextResponse.json({
        success: true,
        date,
        message: `Removed range ${start}-${end} from ${date}`,
        removed: initialLength !== journal.ranges.length,
      });
    }

    if (range) {
      if ('isPlan' in range) {
        return NextResponse.json(
          { success: false, error: 'range.isPlan is no longer supported. Use range.entryMode.' },
          { status: 400 }
        );
      }

      const {
        start,
        end,
        text: rangeText,
        taskId: rangeTaskId,
        listType: rangeListType,
        entryMode: rangeEntryMode,
      } = range as {
        start: string;
        end: string;
        text?: string;
        taskId?: string;
        listType?: string;
        entryMode?: EntryMode;
      };

      if (!start || !end || !VALID_HOURS.includes(start) || !VALID_HOURS.includes(end)) {
        return NextResponse.json(
          { success: false, error: 'Invalid range. start and end must be valid hours.' },
          { status: 400 }
        );
      }

      const startIdx = VALID_HOURS.indexOf(start);
      const endIdx = VALID_HOURS.indexOf(end);
      if (startIdx >= endIdx) {
        return NextResponse.json(
          { success: false, error: 'Range start must be before end' },
          { status: 400 }
        );
      }

      if (!isValidEntryMode(rangeEntryMode)) {
        return NextResponse.json(
          { success: false, error: 'range.entryMode is required and must be "planned" or "logged"' },
          { status: 400 }
        );
      }

      let newRange: JournalRangeEntry;
      if (rangeTaskId && rangeListType) {
        if (!isValidListType(rangeListType)) {
          return NextResponse.json(
            { success: false, error: 'Invalid range.listType. Must be "have-to-do" or "want-to-do".' },
            { status: 400 }
          );
        }
        newRange = { start, end, taskId: rangeTaskId, listType: rangeListType, entryMode: rangeEntryMode };
      } else if (rangeText !== undefined) {
        newRange = { start, end, text: rangeText, entryMode: rangeEntryMode };
      } else {
        return NextResponse.json(
          { success: false, error: 'Range must have either text or taskId+listType' },
          { status: 400 }
        );
      }

      const duplicateRangeExists = (journal.ranges || []).some((r) => r.start === start && r.end === end);
      if (duplicateRangeExists) {
        return NextResponse.json(
          {
            success: false,
            error: `Range ${start}-${end} already exists. Remove it first with removeRange, then add the replacement.`,
          },
          { status: 409 }
        );
      }

      journal.ranges = journal.ranges || [];
      journal.ranges.push(newRange);

      if (rangeTaskId && journal.staged && Array.isArray(journal.staged)) {
        journal.staged = journal.staged.filter((stagedEntry) => stagedEntry.taskId !== rangeTaskId);
      }

      writeJournalFile(date, journal);

      return NextResponse.json({
        success: true,
        date,
        message: `Added range ${start}-${end} on ${date}`,
        newRange,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Invalid payload. Use { date, range: {...} } to add a range or { date, removeRange: {...} } to remove one.',
      },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error updating journal:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
