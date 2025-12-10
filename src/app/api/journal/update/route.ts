import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { DayJournal, JournalEntry, JournalRangeEntry } from '@/lib/types';

// Path to the journal directory
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

// Journal with ranges support
type DayJournalWithRanges = DayJournal & {
  ranges?: JournalRangeEntry[];
};

/**
 * Helper function to validate date format (MMDDYY)
 */
function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

/**
 * Helper function to get the path to a specific day's journal file
 */
function getJournalFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

/**
 * Helper function to check if a journal file exists for a given date
 */
function journalFileExists(date: string): boolean {
  const filePath = getJournalFilePath(date);
  return fs.existsSync(filePath);
}

/**
 * Helper function to read a journal file
 */
function readJournalFile(date: string): DayJournalWithRanges {
  const filePath = getJournalFilePath(date);
  const content = fs.readFileSync(filePath, 'utf-8');
  const journal = JSON.parse(content) as DayJournalWithRanges;
  // Ensure ranges array exists for backward compatibility
  if (!journal.ranges) {
    journal.ranges = [];
  }
  return journal;
}

/**
 * Helper function to write a journal file
 */
function writeJournalFile(date: string, journal: DayJournalWithRanges): void {
  const filePath = getJournalFilePath(date);
  fs.writeFileSync(filePath, JSON.stringify(journal, null, 2), 'utf-8');
}

/**
 * POST /api/journal/update
 * Updates/replaces a specific hour's journal entry OR adds/updates a range entry
 * 
 * For hourly update:
 * Body: { date: string, hour: string, entry: JournalEntry }
 * 
 * entry can be:
 * - { taskId: string, listType: 'have-to-do' | 'want-to-do' } - task reference
 * - { text: string } - free-form text
 * - string - legacy plain text (for backward compatibility)
 * - '' or null - clears the entry
 * 
 * For range update:
 * Body: { date: string, range: { start: string, end: string, text?: string, taskId?: string, listType?: string } }
 * 
 * For range removal:
 * Body: { date: string, removeRange: { start: string, end: string } }
 * 
 * Legacy format also supported:
 * Body: { date: string, hour: string, text: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, entry, text, taskId, listType, range, removeRange } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)' },
        { status: 400 }
      );
    }

    // Check if journal exists
    if (!journalFileExists(date)) {
      return NextResponse.json(
        { success: false, error: `No journal exists for date ${date}. Create one first.` },
        { status: 404 }
      );
    }

    // Read current journal
    const journal = readJournalFile(date);

    // Handle range removal
    if (removeRange) {
      const { start, end } = removeRange;
      if (!start || !end || !VALID_HOURS.includes(start) || !VALID_HOURS.includes(end)) {
        return NextResponse.json(
          { success: false, error: 'Invalid range. start and end must be valid hours.' },
          { status: 400 }
        );
      }

      const initialLength = journal.ranges?.length || 0;
      journal.ranges = (journal.ranges || []).filter(
        r => !(r.start === start && r.end === end)
      );

      writeJournalFile(date, journal);

      return NextResponse.json({
        success: true,
        date,
        message: `Removed range ${start}-${end} from ${date}`,
        removed: initialLength !== journal.ranges.length,
      });
    }

    // Handle range update/add
    if (range) {
      const { start, end, text: rangeText, taskId: rangeTaskId, listType: rangeListType } = range;
      
      if (!start || !end || !VALID_HOURS.includes(start) || !VALID_HOURS.includes(end)) {
        return NextResponse.json(
          { success: false, error: 'Invalid range. start and end must be valid hours.' },
          { status: 400 }
        );
      }

      // Validate start comes before end
      const startIdx = VALID_HOURS.indexOf(start);
      const endIdx = VALID_HOURS.indexOf(end);
      if (startIdx >= endIdx) {
        return NextResponse.json(
          { success: false, error: 'Range start must be before end' },
          { status: 400 }
        );
      }

      // Determine the range entry to save
      let newRange: JournalRangeEntry;
      if (rangeTaskId && rangeListType) {
        newRange = { start, end, taskId: rangeTaskId, listType: rangeListType };
      } else if (rangeText !== undefined) {
        newRange = { start, end, text: rangeText };
      } else {
        return NextResponse.json(
          { success: false, error: 'Range must have either text or taskId+listType' },
          { status: 400 }
        );
      }

      // Check if range already exists and update it, or add new
      const existingIdx = (journal.ranges || []).findIndex(
        r => r.start === start && r.end === end
      );

      if (existingIdx >= 0) {
        const previousRange = journal.ranges![existingIdx];
        journal.ranges![existingIdx] = newRange;
        writeJournalFile(date, journal);

        return NextResponse.json({
          success: true,
          date,
          message: `Updated range ${start}-${end} on ${date}`,
          previousRange,
          newRange,
        });
      } else {
        journal.ranges = journal.ranges || [];
        journal.ranges.push(newRange);
        writeJournalFile(date, journal);

        return NextResponse.json({
          success: true,
          date,
          message: `Added range ${start}-${end} on ${date}`,
          newRange,
        });
      }
    }

    // Handle hourly update (original behavior)
    if (!hour || !VALID_HOURS.includes(hour)) {
      return NextResponse.json(
        { success: false, error: `Invalid hour. Must be one of: ${VALID_HOURS.join(', ')}` },
        { status: 400 }
      );
    }

    // Determine the entry to save
    let entryToSave: JournalEntry;

    if (entry !== undefined) {
      // New format: entry is provided directly
      entryToSave = entry;
    } else if (taskId !== undefined && listType !== undefined) {
      // Task reference format
      entryToSave = { taskId, listType };
    } else if (text !== undefined) {
      // Legacy format: plain text
      if (text === '' || text === null) {
        entryToSave = '';
      } else if (typeof text === 'string') {
        // Wrap in TextJournalEntry for new format
        entryToSave = { text };
      } else {
        return NextResponse.json(
          { success: false, error: 'Invalid text parameter' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { success: false, error: 'Entry, text, or taskId+listType parameter is required' },
        { status: 400 }
      );
    }

    const previousEntry = journal[hour] || '';

    // Update the entry
    journal[hour] = entryToSave;

    // Write updated journal
    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      date,
      hour,
      message: `Successfully updated journal at ${hour} on ${date}`,
      previousEntry,
      newEntry: journal[hour],
    });
  } catch (error) {
    console.error('Error updating journal:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
