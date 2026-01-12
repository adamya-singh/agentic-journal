import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayJournal,
  JournalHourSlot,
  JournalEntry,
  isTaskJournalEntry,
  isJournalEntryArray,
} from '@/lib/types';

// Path to the journal directory
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

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
function readJournalFile(date: string): DayJournal {
  const filePath = getJournalFilePath(date);
  const content = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Helper function to write a journal file
 */
function writeJournalFile(date: string, journal: DayJournal): void {
  const filePath = getJournalFilePath(date);
  fs.writeFileSync(filePath, JSON.stringify(journal, null, 2), 'utf-8');
}

/**
 * POST /api/journal/delete
 * Deletes/clears a specific hour's journal entry or a specific task within an hour
 * 
 * Body: { date: string, hour: string, taskId?: string }
 * 
 * - Without taskId: Clears the entire hour slot
 * - With taskId: Removes only the task with that ID from the hour slot
 *   (useful when multiple tasks are logged for the same hour)
 */
/**
 * Helper to check if a slot is empty
 */
function isSlotEmpty(slot: JournalHourSlot | null | undefined): boolean {
  if (!slot) return true;
  if (typeof slot === 'string' && slot.trim() === '') return true;
  if (Array.isArray(slot) && slot.length === 0) return true;
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, taskId } = body;

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

    // Check if journal exists
    if (!journalFileExists(date)) {
      return NextResponse.json(
        { success: false, error: `No journal exists for date ${date}.` },
        { status: 404 }
      );
    }

    // Read current journal
    const journal = readJournalFile(date);
    const currentSlot = journal[hour];

    // Check if entry was already empty
    if (isSlotEmpty(currentSlot)) {
      return NextResponse.json({
        success: true,
        date,
        hour,
        message: `Entry at ${hour} on ${date} was already empty.`,
        deletedEntry: null,
      });
    }

    // Handle taskId-specific deletion
    if (taskId && typeof taskId === 'string') {
      let deletedEntry: JournalEntry | null = null;
      let updatedSlot: JournalHourSlot;

      if (isJournalEntryArray(currentSlot)) {
        // Array of entries - find and remove the task
        const taskIndex = currentSlot.findIndex(
          e => isTaskJournalEntry(e) && e.taskId === taskId
        );
        
        if (taskIndex === -1) {
          return NextResponse.json({
            success: false,
            error: `Task ${taskId} not found at ${hour} on ${date}`,
          }, { status: 404 });
        }

        deletedEntry = currentSlot[taskIndex];
        const newArray = [...currentSlot.slice(0, taskIndex), ...currentSlot.slice(taskIndex + 1)];
        
        if (newArray.length === 0) {
          updatedSlot = '';
        } else if (newArray.length === 1) {
          updatedSlot = newArray[0];
        } else {
          updatedSlot = newArray;
        }
      } else if (isTaskJournalEntry(currentSlot) && currentSlot.taskId === taskId) {
        // Single task entry that matches - remove it
        deletedEntry = currentSlot;
        updatedSlot = '';
      } else {
        return NextResponse.json({
          success: false,
          error: `Task ${taskId} not found at ${hour} on ${date}`,
        }, { status: 404 });
      }

      journal[hour] = updatedSlot;
      writeJournalFile(date, journal);

      return NextResponse.json({
        success: true,
        date,
        hour,
        taskId,
        message: `Successfully deleted task ${taskId} at ${hour} on ${date}`,
        deletedEntry,
        remainingEntries: journal[hour],
      });
    }

    // No taskId - clear the entire hour slot (original behavior)
    const deletedEntry = currentSlot;
    journal[hour] = '';

    // Write updated journal
    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      date,
      hour,
      message: `Successfully deleted entry at ${hour} on ${date}`,
      deletedEntry,
    });
  } catch (error) {
    console.error('Error deleting journal entry:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

