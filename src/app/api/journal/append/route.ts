import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  EntryMode,
  JournalEntry,
  JournalHourSlot,
  isJournalEntryArray,
  isTaskJournalEntry,
  isTextJournalEntry,
} from '@/lib/types';
import {
  DayJournalWithRanges,
  linkLoggedEntryToEarliestActivePlan,
  markMissedPlansForDate,
  normalizePlannedEntry,
  normalizePlannedTaskEntry,
} from '../plan-lifecycle-utils';

// Path to the journal directory
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Valid hours of the day (7am to 6am)
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

function isValidEntryMode(entryMode: unknown): entryMode is EntryMode {
  return entryMode === 'planned' || entryMode === 'logged';
}

function getJournalFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

function journalFileExists(date: string): boolean {
  const filePath = getJournalFilePath(date);
  return fs.existsSync(filePath);
}

function readJournalFile(date: string): DayJournalWithRanges {
  const filePath = getJournalFilePath(date);
  const content = fs.readFileSync(filePath, 'utf-8');
  const journal = JSON.parse(content) as DayJournalWithRanges;
  if (!journal.ranges) {
    journal.ranges = [];
  }
  return journal;
}

function writeJournalFile(date: string, journal: DayJournalWithRanges): void {
  const filePath = getJournalFilePath(date);
  fs.writeFileSync(filePath, JSON.stringify(journal, null, 2), 'utf-8');
}

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
 * Appends to a specific hour's journal entry.
 *
 * Body (text entry):
 * { date: string, hour: string, text: string, entryMode: 'planned' | 'logged' }
 *
 * Body (task reference):
 * { date: string, hour: string, taskId: string, listType: 'have-to-do' | 'want-to-do', entryMode: 'planned' | 'logged' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, hour, text, taskId, listType, entryMode } = body;

    if ('isPlan' in body) {
      return NextResponse.json(
        { success: false, error: 'isPlan is no longer supported. Use entryMode: "planned" | "logged".' },
        { status: 400 }
      );
    }

    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Please use ISO format (YYYY-MM-DD, e.g., 2025-11-25)' },
        { status: 400 }
      );
    }

    if (!hour || !VALID_HOURS.includes(hour)) {
      return NextResponse.json(
        { success: false, error: `Invalid hour. Must be one of: ${VALID_HOURS.join(', ')}` },
        { status: 400 }
      );
    }

    if (!isValidEntryMode(entryMode)) {
      return NextResponse.json(
        { success: false, error: 'entryMode is required and must be "planned" or "logged"' },
        { status: 400 }
      );
    }

    const hasText = text && typeof text === 'string' && text.trim().length > 0;
    const hasTaskRef = taskId && listType && (listType === 'have-to-do' || listType === 'want-to-do');

    if (!hasText && !hasTaskRef) {
      return NextResponse.json(
        { success: false, error: 'Provide either text OR (taskId + listType)' },
        { status: 400 }
      );
    }

    if (!journalFileExists(date)) {
      return NextResponse.json(
        { success: false, error: `No journal exists for date ${date}. Create one first.` },
        { status: 404 }
      );
    }

    const journal = readJournalFile(date);
    const now = new Date();
    markMissedPlansForDate(journal, date, now);
    const currentSlot = journal[hour];
    const nowIso = now.toISOString();

    let updatedSlot: JournalHourSlot;

    if (hasTaskRef) {
      const newTaskEntry: JournalEntry = entryMode === 'planned'
        ? normalizePlannedTaskEntry({ taskId, listType, entryMode }, nowIso)
        : { taskId, listType, entryMode };

      const taskAlreadyExists = (entries: JournalEntry[], mode: EntryMode): boolean => {
        return entries.some(
          (entry) => isTaskJournalEntry(entry) && entry.taskId === taskId && entry.entryMode === mode
        );
      };

      if (!currentSlot || (typeof currentSlot === 'string' && currentSlot.trim() === '')) {
        updatedSlot = newTaskEntry;
      } else if (isJournalEntryArray(currentSlot)) {
        if (entryMode === 'logged' && taskAlreadyExists(currentSlot, 'logged')) {
          return NextResponse.json({
            success: true,
            date,
            hour,
            message: `Logged task already exists at ${hour} on ${date}`,
            updatedEntry: currentSlot,
            skipped: true,
          });
        }
        updatedSlot = [...currentSlot, newTaskEntry];
      } else {
        if (
          entryMode === 'logged' &&
          isTaskJournalEntry(currentSlot) &&
          currentSlot.taskId === taskId &&
          currentSlot.entryMode === 'logged'
        ) {
          return NextResponse.json({
            success: true,
            date,
            hour,
            message: `Logged task already exists at ${hour} on ${date}`,
            updatedEntry: currentSlot,
            skipped: true,
          });
        }
        updatedSlot = [currentSlot, newTaskEntry];
      }
    } else {
      const existingEntries: JournalEntry[] = !currentSlot || (typeof currentSlot === 'string' && currentSlot.trim() === '')
        ? []
        : isJournalEntryArray(currentSlot)
          ? currentSlot
          : [currentSlot];

      const lastTextEntryIndex = existingEntries.length - 1;
      const lastEntry = existingEntries[lastTextEntryIndex];

      if (existingEntries.length === 0) {
        updatedSlot = entryMode === 'planned'
          ? normalizePlannedEntry({ text: text.trim(), entryMode }, nowIso)
          : { text: text.trim(), entryMode };
      } else if (lastEntry && isTaskJournalEntry(lastEntry)) {
        const newTextEntry: JournalEntry = entryMode === 'planned'
          ? normalizePlannedEntry({ text: text.trim(), entryMode }, nowIso)
          : { text: text.trim(), entryMode };
        if (existingEntries.length === 1) {
          updatedSlot = [lastEntry, newTextEntry];
        } else {
          updatedSlot = [...existingEntries, newTextEntry];
        }
      } else {
        const currentText = lastEntry ? getEntryText(lastEntry) : '';
        const nextText = currentText && currentText.trim() !== ''
          ? currentText + '\n' + text.trim()
          : text.trim();
        const appendedTextEntry: JournalEntry = (() => {
          if (entryMode !== 'planned') {
            return { text: nextText, entryMode };
          }
          if (isTextJournalEntry(lastEntry) && lastEntry.entryMode === 'planned') {
            return {
              ...lastEntry,
              text: nextText,
              planUpdatedAt: nowIso,
            };
          }
          return normalizePlannedEntry({ text: nextText, entryMode }, nowIso);
        })();

        if (existingEntries.length === 1) {
          updatedSlot = appendedTextEntry;
        } else {
          updatedSlot = [...existingEntries.slice(0, -1), appendedTextEntry];
        }
      }
    }

    journal[hour] = updatedSlot;
    if (hasTaskRef && entryMode === 'logged') {
      linkLoggedEntryToEarliestActivePlan(
        journal,
        date,
          taskId,
          { date, hour },
          nowIso
        );
      }
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
