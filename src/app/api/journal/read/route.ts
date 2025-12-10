import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayJournal,
  JournalEntry,
  JournalRangeEntry,
  ResolvedJournalEntry,
  ResolvedJournalRangeEntry,
  ListType,
  Task,
  TasksData,
  isTaskJournalEntry,
  isTextJournalEntry,
  isTaskJournalRangeEntry,
} from '@/lib/types';

// Path to the journal directory (relative to project root)
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const TASKS_DIR = path.join(process.cwd(), 'src/backend/data/tasks');

// Date format regex (ISO: YYYY-MM-DD)
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Valid hours of the day
const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;
type HourOfDay = typeof HOURS[number];

// Journal with ranges support
type DayJournalWithRanges = DayJournal & {
  ranges?: JournalRangeEntry[];
};

// Resolved journal with ranges
type ResolvedDayJournalWithRanges = {
  [hour: string]: ResolvedJournalEntry | null;
} & {
  ranges?: ResolvedJournalRangeEntry[];
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
 * Get the path for a date-specific task list
 */
function getDailyTasksFilePath(date: string, listType: ListType): string {
  return path.join(TASKS_DIR, `daily-lists/${date}-${listType}.json`);
}

/**
 * Get the path for the general task list
 */
function getGeneralTasksFilePath(listType: ListType): string {
  return path.join(TASKS_DIR, `${listType}.json`);
}

/**
 * Read tasks from a file
 */
function readTasksFile(filePath: string): Task[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as TasksData;
    return data.tasks || [];
  } catch {
    return [];
  }
}

/**
 * Find a task by ID across daily and general lists
 */
function findTaskById(taskId: string, listType: ListType, date: string): Task | null {
  // First check the daily list for this date
  const dailyTasks = readTasksFile(getDailyTasksFilePath(date, listType));
  const dailyTask = dailyTasks.find(t => t.id === taskId);
  if (dailyTask) {
    return dailyTask;
  }

  // Fall back to general list
  const generalTasks = readTasksFile(getGeneralTasksFilePath(listType));
  const generalTask = generalTasks.find(t => t.id === taskId);
  if (generalTask) {
    return generalTask;
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
        taskId: entry.taskId,
        listType: entry.listType,
        completed: task.completed,
        isPlan: entry.isPlan,
      };
    }
    // Task not found - return placeholder
    return {
      hour,
      text: '[Task not found]',
      type: 'task',
      taskId: entry.taskId,
      listType: entry.listType,
      completed: false,
      isPlan: entry.isPlan,
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
      isPlan: entry.isPlan,
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
        taskId: entry.taskId,
        listType: entry.listType,
        completed: task.completed,
        isPlan: entry.isPlan,
      };
    }
    // Task not found - return placeholder
    return {
      start: entry.start,
      end: entry.end,
      text: '[Task not found]',
      type: 'task',
      taskId: entry.taskId,
      listType: entry.listType,
      completed: false,
      isPlan: entry.isPlan,
    };
  }

  // Text range entry
  return {
    start: entry.start,
    end: entry.end,
    text: entry.text,
    type: 'text',
    isPlan: entry.isPlan,
  };
}

/**
 * Resolve all entries in a journal
 */
function resolveJournal(journal: DayJournalWithRanges, date: string): ResolvedDayJournalWithRanges {
  const resolved: ResolvedDayJournalWithRanges = {};
  
  for (const hour of HOURS) {
    const entry = journal[hour];
    if (entry) {
      resolved[hour] = resolveEntry(hour, entry as JournalEntry, date);
    } else {
      resolved[hour] = null;
    }
  }

  // Resolve range entries
  if (journal.ranges && journal.ranges.length > 0) {
    resolved.ranges = journal.ranges.map(r => resolveRangeEntry(r, date));
  } else {
    resolved.ranges = [];
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
