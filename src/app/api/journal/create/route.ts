import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to the journal directory (relative to project root)
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const FORMAT_PATH = path.join(JOURNAL_DIR, 'format.json');

// Date format regex (MMDDYY)
const DATE_REGEX = /^\d{6}$/;

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
 * POST /api/journal/create
 * Creates a new journal file for the specified date if it doesn't exist
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date } = body;

    if (!date) {
      return NextResponse.json(
        { success: false, error: 'Date parameter is required' },
        { status: 400 }
      );
    }

    if (!isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use MMDDYY format (e.g., 112525)' },
        { status: 400 }
      );
    }

    // Check if journal already exists
    if (journalFileExists(date)) {
      return NextResponse.json({
        success: true,
        alreadyExists: true,
        message: `Journal for ${date} already exists.`,
      });
    }

    // Read the format template
    if (!fs.existsSync(FORMAT_PATH)) {
      return NextResponse.json(
        { success: false, error: 'Format template not found' },
        { status: 500 }
      );
    }

    const template = fs.readFileSync(FORMAT_PATH, 'utf-8');
    const filePath = getJournalFilePath(date);

    // Ensure the journal directory exists
    if (!fs.existsSync(JOURNAL_DIR)) {
      fs.mkdirSync(JOURNAL_DIR, { recursive: true });
    }

    // Write the new journal file
    fs.writeFileSync(filePath, template, 'utf-8');

    return NextResponse.json({
      success: true,
      alreadyExists: false,
      message: `Successfully created journal for ${date}`,
    });
  } catch (error) {
    console.error('Error creating journal:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

