import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayJournal,
  JournalEntry,
  JournalRangeEntry,
  JournalHourSlot,
  ResolvedJournalEntry,
  ResolvedJournalRangeEntry,
  ResolvedStagedEntry,
  StagedTaskEntry,
  ListType,
  Task,
  isTaskJournalEntry,
  isTextJournalEntry,
  isTaskJournalRangeEntry,
  isJournalEntryArray,
} from '@/lib/types';
import {
  ensureCompletedIndexForTask,
  findLegacyDailyTaskById,
  getCompletedTaskFromIndex,
  readCompletedTaskSnapshots,
  readGeneralTasks,
  taskFromCompletionSnapshot,
} from '../../tasks/today/today-store-utils';

// Path to the journal directory (relative to project root)
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Valid hours of the day
const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;

// Journal with ranges and staged support
type DayJournalWithRanges = DayJournal & {
  ranges?: JournalRangeEntry[];
  staged?: StagedTaskEntry[];
};

// Resolved hour slot can be single entry, array of entries, or null
type ResolvedHourSlot = ResolvedJournalEntry | ResolvedJournalEntry[] | null;

// Resolved journal with ranges and staged
type ResolvedDayJournalWithRanges = {
  [hour: string]: ResolvedHourSlot;
} & {
  ranges?: ResolvedJournalRangeEntry[];
  staged?: ResolvedStagedEntry[];
  indicators?: number; // 0-4 indicators per day
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
 * Find a task by ID across completion history, general tasks, and legacy daily files.
 */
function findTaskById(taskId: string, listType: ListType, date: string): Task | null {
  // First prefer date-scoped completion snapshots (historical truth for completed tasks).
  const completionSnapshot = readCompletedTaskSnapshots(date, listType).find(
    (snapshot) => snapshot.id === taskId
  );
  if (completionSnapshot) {
    return taskFromCompletionSnapshot(completionSnapshot);
  }

  // Fall back to general list (source of truth for non-completed task details).
  const generalTask = readGeneralTasks(listType).tasks.find((task) => task.id === taskId);
  if (generalTask) {
    return generalTask;
  }

  // Global completion index handles cross-date references after one-off tasks are removed from general lists.
  const indexedTask = getCompletedTaskFromIndex(taskId);
  if (indexedTask) {
    return indexedTask;
  }

  // Lazy historical backfill from daily-lists if index is stale/missing.
  const rebuiltIndexedTask = ensureCompletedIndexForTask(taskId);
  if (rebuiltIndexedTask) {
    return rebuiltIndexedTask;
  }

  // Last fallback for historical compatibility with legacy daily-list schema.
  const legacyTask = findLegacyDailyTaskById(date, listType, taskId);
  if (legacyTask) {
    return legacyTask;
  }

  return null;
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
    // Ensure ranges and staged arrays exist for backward compatibility
    if (!journal.ranges) {
      journal.ranges = [];
    }
    if (!journal.staged) {
      journal.staged = [];
    }
    return journal;
  } catch {
    return null;
  }
}

/**
 * Resolve a journal entry to displayable format
 */
function resolveEntry(hour: string, entry: JournalEntry, date: string): ResolvedJournalEntry | null {
  // Handle task reference entries
  if (isTaskJournalEntry(entry)) {
    const task = findTaskById(entry.taskId, entry.listType, date);
    if (task) {
      return {
        hour,
        text: task.text,
        type: 'task',
        entryMode: entry.entryMode,
        taskId: entry.taskId,
        listType: entry.listType,
        completed: task.completed,
      };
    }
    // Task not found - return placeholder
    return {
      hour,
      text: '[Task not found]',
      type: 'task',
      entryMode: entry.entryMode,
      taskId: entry.taskId,
      listType: entry.listType,
      completed: false,
    };
  }

  // Handle text entries
  if (isTextJournalEntry(entry)) {
    if (!entry.text || entry.text.trim() === '') {
      return null;
    }
    return {
      hour,
      text: entry.text,
      type: 'text',
      entryMode: entry.entryMode,
    };
  }

  // Handle legacy string entries
  if (typeof entry === 'string') {
    if (!entry || entry.trim() === '') {
      return null;
    }
    return {
      hour,
      text: entry,
      type: 'text',
      entryMode: 'logged',
    };
  }

  return null;
}

/**
 * Resolve a range entry to displayable format
 */
function resolveRangeEntry(entry: JournalRangeEntry, date: string): ResolvedJournalRangeEntry {
  if (isTaskJournalRangeEntry(entry)) {
    const task = findTaskById(entry.taskId, entry.listType, date);
    if (task) {
      return {
        start: entry.start,
        end: entry.end,
        text: task.text,
        type: 'task',
        entryMode: entry.entryMode,
        taskId: entry.taskId,
        listType: entry.listType,
        completed: task.completed,
      };
    }
    // Task not found - return placeholder
    return {
      start: entry.start,
      end: entry.end,
      text: '[Task not found]',
      type: 'task',
      entryMode: entry.entryMode,
      taskId: entry.taskId,
      listType: entry.listType,
      completed: false,
    };
  }

  // Text range entry
  return {
    start: entry.start,
    end: entry.end,
    text: entry.text,
    type: 'text',
    entryMode: entry.entryMode,
  };
}

/**
 * Resolve a staged entry to displayable format
 */
function resolveStagedEntry(entry: StagedTaskEntry, date: string): ResolvedStagedEntry | null {
  const task = findTaskById(entry.taskId, entry.listType, date);
  if (task) {
    return {
      text: task.text,
      taskId: entry.taskId,
      listType: entry.listType,
      completed: task.completed,
    };
  }
  // Task not found - return placeholder
  return {
    text: '[Task not found]',
    taskId: entry.taskId,
    listType: entry.listType,
    completed: false,
  };
}

/**
 * Resolve a single entry or an array of entries for an hour slot
 */
function resolveHourSlot(hour: string, slot: JournalHourSlot | undefined, date: string): ResolvedHourSlot {
  if (!slot) {
    return null;
  }
  
  if (isJournalEntryArray(slot)) {
    // Handle array of entries
    const resolved = slot
      .map(entry => resolveEntry(hour, entry, date))
      .filter((e): e is ResolvedJournalEntry => e !== null);
    
    if (resolved.length === 0) {
      return null;
    }
    if (resolved.length === 1) {
      // Return single entry if only one (for backward compatibility)
      return resolved[0];
    }
    return resolved;
  }
  
  // Single entry
  return resolveEntry(hour, slot as JournalEntry, date);
}

/**
 * Resolve all entries in a journal
 */
function resolveJournal(journal: DayJournalWithRanges, date: string): ResolvedDayJournalWithRanges {
  const resolved: ResolvedDayJournalWithRanges = {};
  
  for (const hour of HOURS) {
    const slot = journal[hour];
    resolved[hour] = resolveHourSlot(hour, slot, date);
  }

  // Resolve range entries
  if (journal.ranges && journal.ranges.length > 0) {
    resolved.ranges = journal.ranges.map(r => resolveRangeEntry(r, date));
  } else {
    resolved.ranges = [];
  }

  // Resolve staged entries
  if (journal.staged && journal.staged.length > 0) {
    resolved.staged = journal.staged
      .map(s => resolveStagedEntry(s, date))
      .filter((s): s is ResolvedStagedEntry => s !== null);
  } else {
    resolved.staged = [];
  }

  // Preserve indicators field
  const journalRecord = journal as Record<string, unknown>;
  if (typeof journalRecord.indicators === 'number' && journalRecord.indicators > 0) {
    resolved.indicators = journalRecord.indicators;
  }
  
  return resolved;
}

/**
 * POST /api/journal/read
 * Reads journal entries for multiple dates
 * 
 * Body: { dates: string[], resolve?: boolean }
 * - dates: Array of dates in ISO format (YYYY-MM-DD)
 * - resolve: If true, resolves task IDs to full task objects (default: false)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { dates, resolve = false } = body;

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
          { success: false, error: `Invalid date format: ${date}. Please use ISO format (YYYY-MM-DD)` },
          { status: 400 }
        );
      }
    }

    if (resolve) {
      // Return resolved journals with task details
      const resolvedJournals: Record<string, ResolvedDayJournalWithRanges | null> = {};
      for (const date of dates) {
        const journal = readJournalFile(date);
        if (journal) {
          resolvedJournals[date] = resolveJournal(journal, date);
        } else {
          resolvedJournals[date] = null;
        }
      }

      return NextResponse.json({
        success: true,
        journals: resolvedJournals,
        resolved: true,
      });
    } else {
      // Return raw journals
      const journals: Record<string, DayJournalWithRanges | null> = {};
      for (const date of dates) {
        journals[date] = readJournalFile(date);
      }

      return NextResponse.json({
        success: true,
        journals,
        resolved: false,
      });
    }
  } catch (error) {
    console.error('Error reading journals:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
