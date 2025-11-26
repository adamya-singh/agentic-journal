import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to the journal directory (relative to project root)
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

// Valid hours of the day
const HOURS = ['8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm'] as const;
type HourOfDay = typeof HOURS[number];
type DayJournal = Record<HourOfDay, string>;

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
 * Helper function to read a journal file if it exists
 */
function readJournalFile(date: string): DayJournal | null {
  const filePath = getJournalFilePath(date);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as DayJournal;
  } catch {
    return null;
  }
}

/**
 * POST /api/journal/read
 * Reads journal entries for multiple dates
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dates } = body;

    if (!dates || !Array.isArray(dates)) {
      return NextResponse.json(
        { success: false, error: 'dates array parameter is required' },
        { status: 400 }
      );
    }

    // Validate all dates
    for (const date of dates) {
      if (!isValidDateFormat(date)) {
        return NextResponse.json(
          { success: false, error: `Invalid date format: ${date}. Please use MMDDYY format` },
          { status: 400 }
        );
      }
    }

    // Read all journal entries
    const journals: Record<string, DayJournal | null> = {};
    for (const date of dates) {
      journals[date] = readJournalFile(date);
    }

    return NextResponse.json({
      success: true,
      journals,
    });
  } catch (error) {
    console.error('Error reading journals:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

