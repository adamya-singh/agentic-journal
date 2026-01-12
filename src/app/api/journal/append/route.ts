import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayJournal,
  JournalEntry,
  JournalRangeEntry,
  JournalHourSlot,
  isTaskJournalEntry,
  isTextJournalEntry,
  isJournalEntryArray,
} from '@/lib/types';

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
 * Get the text content from a journal entry
 */
function getEntryText(entry: JournalEntry): string {
  if (typeof entry === 'string') {
    return entry;
  }
  if (isTextJournalEntry(entry)) {
    return entry.text;
  }
  return '';
}

/**
 * POST /api/journal/append
 * Appends to a specific hour's journal entry
 * 
 * Body (text entry): { date: string, hour: string, text: string, isPlan?: boolean }
 * Body (task reference): { date: string, hour: string, taskId: string, listType: 'have-to-do' | 'want-to-do', isPlan?: boolean }
 * 
 * For text entries: appends to existing text content with newline separation.
 * For task references: adds the task to the hour slot. If an entry already exists,
 *   converts to an array and appends (supports multiple tasks per hour).
 *   Skips if the same taskId already exists in that hour.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, text, taskId, listType, isPlan } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
        { status: 400 }
      );
    }

    // Validate hour
    if (!hour || !VALID_HOURS.includes(hour)) {
      return NextResponse.json(
        { success: false, error: `Invalid hour. Must be one of: ${VALID_HOURS.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate: must have text OR (taskId + listType)
    const hasText = text && typeof text === 'string' && text.trim().length > 0;
    const hasTaskRef = taskId && listType && (listType === 'have-to-do' || listType === 'want-to-do');

    if (!hasText && !hasTaskRef) {
      return NextResponse.json(
        { success: false, error: 'Provide either text OR (taskId + listType)' },
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
    const currentSlot = journal[hour];

    let updatedSlot: JournalHourSlot;

    if (hasTaskRef) {
      // Task reference entry - append to array instead of replacing
      const newTaskEntry: JournalEntry = { taskId, listType, ...(isPlan !== undefined ? { isPlan } : {}) };
      
      // Helper to check if a task entry with the same taskId already exists
      const taskAlreadyExists = (entries: JournalEntry[]): boolean => {
        return entries.some(e => isTaskJournalEntry(e) && e.taskId === taskId);
      };
      
      if (!currentSlot || (typeof currentSlot === 'string' && currentSlot.trim() === '')) {
        // Empty slot - just set the new entry (not as array for efficiency)
        updatedSlot = newTaskEntry;
      } else if (isJournalEntryArray(currentSlot)) {
        // Already an array - check for duplicate and push if not present
        if (taskAlreadyExists(currentSlot)) {
          return NextResponse.json({
            success: true,
            date,
            hour,
            message: `Task already exists at ${hour} on ${date}`,
            updatedEntry: currentSlot,
            skipped: true,
          });
        }
        updatedSlot = [...currentSlot, newTaskEntry];
      } else {
        // Single entry exists - convert to array and append
        // Check if the existing entry is the same task
        if (isTaskJournalEntry(currentSlot) && currentSlot.taskId === taskId) {
          return NextResponse.json({
            success: true,
            date,
            hour,
            message: `Task already exists at ${hour} on ${date}`,
            updatedEntry: currentSlot,
            skipped: true,
          });
        }
        updatedSlot = [currentSlot, newTaskEntry];
      }
    } else {
      // Text entry - can append to existing text entries
      // For text entries, we handle arrays differently - append to the last text entry or create new
      
      // Get existing entries as array for easier processing
      const existingEntries: JournalEntry[] = !currentSlot || (typeof currentSlot === 'string' && currentSlot.trim() === '')
        ? []
        : isJournalEntryArray(currentSlot)
          ? currentSlot
          : [currentSlot];
      
      // Find the last text entry to append to
      const lastTextEntryIndex = existingEntries.length - 1;
      const lastEntry = existingEntries[lastTextEntryIndex];
      
      // Check if we can append to an existing text entry
      if (existingEntries.length === 0) {
        // No entries - create new text entry
        updatedSlot = { text: text.trim(), ...(isPlan !== undefined ? { isPlan } : {}) };
      } else if (lastEntry && isTaskJournalEntry(lastEntry)) {
        // Last entry is a task - add text as new entry in the array
        const newTextEntry: JournalEntry = { text: text.trim(), ...(isPlan !== undefined ? { isPlan } : {}) };
        if (existingEntries.length === 1) {
          updatedSlot = [lastEntry, newTextEntry];
        } else {
          updatedSlot = [...existingEntries, newTextEntry];
        }
      } else {
        // Last entry is text - append to it
        const currentText = lastEntry ? getEntryText(lastEntry) : '';
        const currentIsPlan = lastEntry && isTextJournalEntry(lastEntry) ? lastEntry.isPlan : undefined;
        const finalIsPlan = isPlan ?? currentIsPlan;
        
        const appendedTextEntry: JournalEntry = currentText && currentText.trim() !== ''
          ? { text: currentText + '\n' + text.trim(), ...(finalIsPlan !== undefined ? { isPlan: finalIsPlan } : {}) }
          : { text: text.trim(), ...(finalIsPlan !== undefined ? { isPlan: finalIsPlan } : {}) };
        
        if (existingEntries.length === 1) {
          updatedSlot = appendedTextEntry;
        } else {
          // Replace last entry in array with appended version
          updatedSlot = [...existingEntries.slice(0, -1), appendedTextEntry];
        }
      }
    }

    // Update the entry
    journal[hour] = updatedSlot;

    // Write updated journal
    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      date,
      hour,
      message: `Successfully appended to ${hour} on ${date}`,
      updatedEntry: journal[hour],
    });
  } catch (error) {
    console.error('Error appending to journal:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
