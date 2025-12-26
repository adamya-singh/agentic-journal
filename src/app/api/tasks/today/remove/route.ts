import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { Task, TasksData, ListType, TaskJournalEntry, JournalRangeEntry, StagedTaskEntry, JournalEntry } from '@/lib/types';

// Get the path for a date-specific task list
function getDailyTasksFilePath(date: string, listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/daily-lists/${date}-${listType}.json`);
}

interface DayJournal {
  [hour: string]: JournalEntry;
  ranges?: JournalRangeEntry[];
  staged?: StagedTaskEntry[];
}

const HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Get the path for a journal file
function getJournalFilePath(date: string): string {
  return path.join(process.cwd(), `src/backend/data/journal/${date}.json`);
}

/**
 * Helper function to read journal from file
 */
function readJournal(date: string): DayJournal | null {
  const journalFile = getJournalFilePath(date);
  if (!fs.existsSync(journalFile)) {
    return null;
  }
  const content = fs.readFileSync(journalFile, 'utf-8');
  return JSON.parse(content);
}

/**
 * Helper function to write journal to file
 */
function writeJournal(date: string, journal: DayJournal): void {
  const journalFile = getJournalFilePath(date);
  fs.writeFileSync(journalFile, JSON.stringify(journal, null, 2), 'utf-8');
}

/**
 * Remove all journal entries (hour slots, ranges, staged) referencing a task
 */
function removeTaskFromJournal(date: string, taskId: string): boolean {
  const journal = readJournal(date);
  if (!journal) return false;
  
  let modified = false;
  
  // Clear hour slots referencing this task
  for (const hour of HOURS) {
    const entry = journal[hour];
    if (entry && typeof entry === 'object' && 'taskId' in entry && entry.taskId === taskId) {
      journal[hour] = '';
      modified = true;
    }
  }
  
  // Filter out range entries referencing this task
  if (journal.ranges) {
    const before = journal.ranges.length;
    journal.ranges = journal.ranges.filter(r => r.taskId !== taskId);
    if (journal.ranges.length !== before) modified = true;
  }
  
  // Filter out staged entries referencing this task
  if (journal.staged) {
    const before = journal.staged.length;
    journal.staged = journal.staged.filter(s => s.taskId !== taskId);
    if (journal.staged.length !== before) modified = true;
  }
  
  if (modified) {
    writeJournal(date, journal);
  }
  
  return modified;
}

/**
 * Helper function to read daily tasks from file
 */
function readDailyTasks(date: string, listType: ListType): TasksData {
  const tasksFile = getDailyTasksFilePath(date, listType);
  if (!fs.existsSync(tasksFile)) {
    return {
      _comment: 'Queue structure - first element is highest priority',
      tasks: [],
    };
  }
  const content = fs.readFileSync(tasksFile, 'utf-8');
  return JSON.parse(content);
}

/**
 * Helper function to write daily tasks to file
 */
function writeDailyTasks(data: TasksData, date: string, listType: ListType): void {
  const tasksFile = getDailyTasksFilePath(date, listType);
  const dir = path.dirname(tasksFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * POST /api/tasks/today/remove
 * Removes a task from the daily list
 * 
 * Body: { taskId: string, listType: 'have-to-do' | 'want-to-do', date: string }
 * - taskId: The unique ID of the task to remove
 * - listType: Which task list to remove from
 * - date: The date in ISO format (YYYY-MM-DD)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, listType, date } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    // Validate taskId
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskId parameter is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate date
    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { success: false, error: 'date parameter is required and must be a string in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // Read current daily tasks
    const data = readDailyTasks(date, listType);

    // Find and remove the task by ID
    const initialLength = data.tasks.length;
    data.tasks = data.tasks.filter((task) => task.id !== taskId);

    if (data.tasks.length === initialLength) {
      return NextResponse.json({
        success: true,
        removed: false,
        message: 'Task not found in today\'s list',
      });
    }

    // Write updated tasks
    writeDailyTasks(data, date, listType);

    // Clean up journal entries for this task
    const journalCleaned = removeTaskFromJournal(date, taskId);

    return NextResponse.json({
      success: true,
      removed: true,
      message: 'Task removed from today\'s list',
      taskCount: data.tasks.length,
      journalCleaned,
    });
  } catch (error) {
    console.error('Error removing task from daily list:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

