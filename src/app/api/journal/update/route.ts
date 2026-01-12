import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { DayJournal, JournalEntry, JournalRangeEntry, JournalHourSlot, isJournalEntryArray } from '@/lib/types';

// Path to the journal directory
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Journal with ranges support
type DayJournalWithRanges = DayJournal & {
  ranges?: JournalRangeEntry[];
};

/**
 * Helper function to validate date format (ISO: YYYY-MM-DD)
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
 * Body: { date: string, hour: string, entry: JournalEntry, isPlan?: boolean, entryIndex?: number }
 * 
 * entry can be:
 * - { taskId: string, listType: 'have-to-do' | 'want-to-do', isPlan?: boolean } - task reference
 * - { text: string, isPlan?: boolean } - free-form text
 * - string - legacy plain text (for backward compatibility)
 * - '' or null - clears the entry (or removes entry at entryIndex if provided)
 * 
 * entryIndex: Optional. If the hour slot contains an array of entries:
 *   - Specifying entryIndex updates only that specific entry in the array
 *   - Without entryIndex, replaces the entire hour slot
 * 
 * For range update:
 * Body: { date: string, range: { start: string, end: string, text?: string, taskId?: string, listType?: string, isPlan?: boolean } }
 * 
 * For range removal:
 * Body: { date: string, removeRange: { start: string, end: string } }
 * 
 * Legacy format also supported:
 * Body: { date: string, hour: string, text: string, isPlan?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, entry, text, taskId, listType, range, removeRange, isPlan, entryIndex } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
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
      const { start, end, text: rangeText, taskId: rangeTaskId, listType: rangeListType, isPlan: rangeIsPlan } = range;
      
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
      const isPlanFlag = rangeIsPlan ?? isPlan;
      if (rangeTaskId && rangeListType) {
        newRange = { start, end, taskId: rangeTaskId, listType: rangeListType, ...(isPlanFlag ? { isPlan: isPlanFlag } : {}) };
      } else if (rangeText !== undefined) {
        newRange = { start, end, text: rangeText, ...(isPlanFlag ? { isPlan: isPlanFlag } : {}) };
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
      // If isPlan is provided at top level, merge it into the entry
      if (isPlan !== undefined && typeof entry === 'object' && entry !== null) {
        entryToSave = { ...entry, isPlan };
      } else {
        entryToSave = entry;
      }
    } else if (taskId !== undefined && listType !== undefined) {
      // Task reference format
      entryToSave = { taskId, listType, ...(isPlan ? { isPlan } : {}) };
    } else if (text !== undefined) {
      // Legacy format: plain text
      if (text === '' || text === null) {
        entryToSave = '';
      } else if (typeof text === 'string') {
        // Wrap in TextJournalEntry for new format
        entryToSave = { text, ...(isPlan ? { isPlan } : {}) };
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

    const currentSlot = journal[hour];
    let previousEntry: JournalHourSlot = currentSlot || '';
    let updatedSlot: JournalHourSlot;

    // Handle entryIndex for array operations
    if (typeof entryIndex === 'number' && entryIndex >= 0) {
      if (!isJournalEntryArray(currentSlot)) {
        // Current slot is not an array
        if (entryIndex === 0 && currentSlot) {
          // Updating the single entry at index 0
          previousEntry = currentSlot;
          // If entryToSave is empty, remove this entry (clear the slot)
          if (entryToSave === '' || entryToSave === null) {
            updatedSlot = '';
          } else {
            updatedSlot = entryToSave;
          }
        } else {
          return NextResponse.json(
            { success: false, error: `Invalid entryIndex ${entryIndex}. Hour slot has only 1 entry (or is empty).` },
            { status: 400 }
          );
        }
      } else {
        // Current slot is an array
        if (entryIndex >= currentSlot.length) {
          return NextResponse.json(
            { success: false, error: `Invalid entryIndex ${entryIndex}. Hour slot has ${currentSlot.length} entries.` },
            { status: 400 }
          );
        }
        previousEntry = currentSlot[entryIndex];
        
        // If entryToSave is empty, remove this entry from the array
        if (entryToSave === '' || entryToSave === null) {
          const newArray = [...currentSlot.slice(0, entryIndex), ...currentSlot.slice(entryIndex + 1)];
          if (newArray.length === 0) {
            updatedSlot = '';
          } else if (newArray.length === 1) {
            updatedSlot = newArray[0];
          } else {
            updatedSlot = newArray;
          }
        } else {
          // Update the entry at index
          const newArray = [...currentSlot];
          newArray[entryIndex] = entryToSave;
          updatedSlot = newArray;
        }
      }
    } else {
      // No entryIndex - replace entire slot (original behavior)
      updatedSlot = entryToSave;
    }

    // Update the entry
    journal[hour] = updatedSlot;

    // Write updated journal
    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      date,
      hour,
      message: `Successfully updated journal at ${hour} on ${date}`,
      previousEntry,
      newEntry: journal[hour],
      ...(typeof entryIndex === 'number' ? { entryIndex } : {}),
    });
  } catch (error) {
    console.error('Error updating journal:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
