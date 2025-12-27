import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to the journal directory
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Maximum number of indicators allowed per day
const MAX_INDICATORS = 4;

// Default journal template
const DEFAULT_JOURNAL = {
  "7am": "", "8am": "", "9am": "", "10am": "", "11am": "", "12pm": "",
  "1pm": "", "2pm": "", "3pm": "", "4pm": "", "5pm": "", "6pm": "",
  "7pm": "", "8pm": "", "9pm": "", "10pm": "", "11pm": "", "12am": "",
  "1am": "", "2am": "", "3am": "", "4am": "", "5am": "", "6am": "",
  "ranges": [],
  "staged": [],
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
function readJournalFile(date: string): Record<string, unknown> {
  const filePath = getJournalFilePath(date);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Helper function to write a journal file
 */
function writeJournalFile(date: string, journal: Record<string, unknown>): void {
  const filePath = getJournalFilePath(date);
  fs.writeFileSync(filePath, JSON.stringify(journal, null, 2), 'utf-8');
}

/**
 * POST /api/journal/indicator
 * Updates the indicator count for a specific day
 * 
 * Body: { date: string, action: 'add' | 'remove' | 'set', count?: number }
 * 
 * - date: ISO format date (YYYY-MM-DD)
 * - action: 'add' to increment, 'remove' to decrement, 'set' to set a specific count
 * - count: (optional) When action is 'set', the exact count to set (0-4)
 * 
 * If no journal exists for the date, one will be created.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, action, count } = body;

    // Validate date
    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
        { status: 400 }
      );
    }

    // Validate action
    if (!action || !['add', 'remove', 'set'].includes(action)) {
      return NextResponse.json(
        { success: false, error: "Action must be 'add', 'remove', or 'set'" },
        { status: 400 }
      );
    }

    // Validate count for 'set' action
    if (action === 'set') {
      if (typeof count !== 'number' || count < 0 || count > MAX_INDICATORS) {
        return NextResponse.json(
          { success: false, error: `Count must be a number between 0 and ${MAX_INDICATORS}` },
          { status: 400 }
        );
      }
    }

    // Read existing journal or create new one
    let journal: Record<string, unknown>;
    if (journalFileExists(date)) {
      journal = readJournalFile(date);
    } else {
      journal = { ...DEFAULT_JOURNAL };
    }

    const previousIndicators = typeof journal.indicators === 'number' ? journal.indicators : 0;
    let newIndicators: number;

    // Calculate new indicator count based on action
    switch (action) {
      case 'add':
        newIndicators = Math.min(previousIndicators + 1, MAX_INDICATORS);
        break;
      case 'remove':
        newIndicators = Math.max(previousIndicators - 1, 0);
        break;
      case 'set':
        newIndicators = count as number;
        break;
      default:
        newIndicators = previousIndicators;
    }

    // Update the indicators
    if (newIndicators > 0) {
      journal.indicators = newIndicators;
    } else {
      // Remove the indicators field if 0 to keep files clean
      delete journal.indicators;
    }

    // Write updated journal
    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      date,
      indicators: newIndicators,
      message: `Successfully updated indicators for ${date} to ${newIndicators}`,
      previousIndicators,
    });
  } catch (error) {
    console.error('Error updating indicator:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

