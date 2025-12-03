import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { JournalRangeEntry } from '@/lib/types';

// Path to the journal directory (relative to project root)
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

// Journal with ranges support
type DayJournalWithRanges = {
  [hour: string]: string;
} & {
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
 * Helper function to read a journal file if it exists
 */
function readJournalFile(date: string): DayJournalWithRanges | null {
  const filePath = getJournalFilePath(date);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    const journal = JSON.parse(data) as DayJournalWithRanges;
    // Ensure ranges array exists for backward compatibility
    if (!journal.ranges) {
      journal.ranges = [];
    }
    return journal;
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
    const journals: Record<string, DayJournalWithRanges | null> = {};
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

