import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayJournal,
  JournalEntry,
  JournalRangeEntry,
  isTaskJournalEntry,
  isTextJournalEntry,
} from '@/lib/types';

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
 * Appends text to a specific hour's journal entry
 * 
 * Body: { date: string, hour: string, text: string }
 * 
 * Note: Cannot append to task reference entries. Use the update endpoint
 * to change a task entry to a text entry if you need to add notes.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, text } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)' },
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

    // Validate text
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Text parameter is required and cannot be empty' },
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
    const currentEntry = journal[hour];

    // Check if current entry is a task reference - cannot append to task entries
    if (currentEntry && isTaskJournalEntry(currentEntry)) {
      return NextResponse.json(
        { success: false, error: 'Cannot append text to a task reference entry. Use the update endpoint to replace it with a text entry.' },
        { status: 400 }
      );
    }

    // Get the current text content
    const currentText = currentEntry ? getEntryText(currentEntry) : '';

    // Determine the new entry
    let newEntry: JournalEntry;
    if (currentText && currentText.trim() !== '') {
      // Append with newline separation
      newEntry = { text: currentText + '\n' + text.trim() };
    } else {
      // Start fresh
      newEntry = { text: text.trim() };
    }

    // Update the entry
    journal[hour] = newEntry;

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
