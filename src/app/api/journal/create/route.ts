import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { journalDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { ensureCurrentSystemThroughToday } from '../../tasks/current/current-store-utils';

// The blank-day template lives alongside the dated journal files.
function getFormatPath(): string {
  return path.join(journalDataDir(), 'format.json');
}

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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
  return path.join(journalDataDir(), `${date}.json`);
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
    ensureCurrentSystemThroughToday();
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
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
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
    const formatPath = getFormatPath();
    if (!fs.existsSync(formatPath)) {
      return NextResponse.json(
        { success: false, error: 'Format template not found' },
        { status: 500 }
      );
    }

    const template = JSON.parse(fs.readFileSync(formatPath, 'utf-8'));
    const filePath = getJournalFilePath(date);

    // Write the new journal file (creates the journal directory if needed)
    writeJsonFileAtomic(filePath, template);

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
