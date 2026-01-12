import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { ensureDailyJournalExists } from '../../due-date-utils';
import { Task, TasksData, ListType, StagedTaskEntry, TaskJournalEntry, TaskJournalRangeEntry, JournalHourSlot, isJournalEntryArray, isTaskJournalEntry } from '@/lib/types';

// Get the path for a date-specific task list
function getDailyTasksFilePath(date: string, listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/daily-lists/${date}-${listType}.json`);
}

// Get the path for the general task list
function getGeneralTasksFilePath(listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/${listType}.json`);
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
 * Helper function to read general tasks from file
 */
function readGeneralTasks(listType: ListType): TasksData {
  const tasksFile = getGeneralTasksFilePath(listType);
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
 * Auto-add tasks from general list that are due on the given date OR are daily tasks
 * Returns the updated daily tasks data
 */
function autoAddDueTasks(date: string, listType: ListType): TasksData {
  const dailyData = readDailyTasks(date, listType);
  const generalData = readGeneralTasks(listType);
  
  const existingTaskIds = new Set(dailyData.tasks.map(t => t.id));
  
  // Find tasks that should be auto-added:
  // 1. Tasks due on this date that aren't already in today's list
  // 2. Daily tasks (isDaily === true) that aren't already in today's list
  const tasksToAdd = generalData.tasks.filter(
    task => !existingTaskIds.has(task.id) && (task.dueDate === date || task.isDaily === true)
  );
  
  if (tasksToAdd.length > 0) {
    // Add due/daily tasks to the beginning of the list (they're urgent)
    dailyData.tasks = [...tasksToAdd, ...dailyData.tasks];
    writeDailyTasks(dailyData, date, listType);
  }
  
  return dailyData;
}

interface DayJournal {
  [key: string]: unknown;
  staged?: StagedTaskEntry[];
  ranges?: TaskJournalRangeEntry[];
}

const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

/**
 * Collect all task IDs that are scheduled to specific time slots (hours or ranges)
 */
function getScheduledTaskIds(journal: DayJournal): Set<string> {
  const scheduledIds = new Set<string>();
  
  // Check hour slots (supports both single entries and arrays)
  for (const hour of VALID_HOURS) {
    const slot = journal[hour] as JournalHourSlot;
    
    if (isJournalEntryArray(slot)) {
      // Multiple entries for this hour
      for (const entry of slot) {
        if (isTaskJournalEntry(entry)) {
          scheduledIds.add(entry.taskId);
        }
      }
    } else if (isTaskJournalEntry(slot)) {
      // Single task entry
      scheduledIds.add(slot.taskId);
    }
  }
  
  // Check ranges
  if (journal.ranges && Array.isArray(journal.ranges)) {
    for (const range of journal.ranges) {
      if (range.taskId) {
        scheduledIds.add(range.taskId);
      }
    }
  }
  
  return scheduledIds;
}

/**
 * Sync all tasks from the today list to the journal's staged section.
 * - Adds tasks from today list that aren't staged AND aren't scheduled to a time
 * - Removes tasks from staged that ARE scheduled to a specific time slot
 */
function syncTodayTasksToJournalStaged(date: string, listType: ListType, dailyData: TasksData): void {
  ensureDailyJournalExists(date);
  
  const journalFilePath = path.join(JOURNAL_DIR, `${date}.json`);
  
  if (!fs.existsSync(journalFilePath)) {
    return; // Journal should exist from ensureDailyJournalExists
  }
  
  const content = fs.readFileSync(journalFilePath, 'utf-8');
  const journal: DayJournal = JSON.parse(content);
  
  // Ensure staged array exists
  if (!journal.staged) {
    journal.staged = [];
  }
  
  // Get all task IDs that are scheduled to specific times
  const scheduledTaskIds = getScheduledTaskIds(journal);
  
  // Remove scheduled tasks from staged
  const originalStagedLength = journal.staged.length;
  journal.staged = journal.staged.filter(entry => !scheduledTaskIds.has(entry.taskId));
  
  // Find tasks in today's list that aren't staged AND aren't scheduled
  const existingStagedIds = new Set(journal.staged.map(entry => entry.taskId));
  const tasksToStage = dailyData.tasks.filter(
    task => !existingStagedIds.has(task.id) && !scheduledTaskIds.has(task.id)
  );
  
  // Add missing tasks to staged area
  for (const task of tasksToStage) {
    journal.staged.push({
      taskId: task.id,
      listType,
      isPlan: true,
    });
  }
  
  // Write if there were any changes
  const hasChanges = journal.staged.length !== originalStagedLength || tasksToStage.length > 0;
  if (hasChanges) {
    fs.writeFileSync(journalFilePath, JSON.stringify(journal, null, 2), 'utf-8');
  }
}

/**
 * GET /api/tasks/today/list
 * Returns the tasks for a specific date
 * 
 * Query params:
 * - listType: 'have-to-do' | 'want-to-do' (defaults to 'have-to-do')
 * - date: The date in ISO format (YYYY-MM-DD) (required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listType = (searchParams.get('listType') || 'have-to-do') as ListType;
    const date = searchParams.get('date');

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    // Validate date
    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date parameter is required in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    // Auto-add tasks that are due on this date, then return the list
    const data = autoAddDueTasks(date, listType);
    
    // Sync today's tasks to journal's staged/unscheduled section
    syncTodayTasksToJournalStaged(date, listType, data);

    return NextResponse.json({
      success: true,
      tasks: data.tasks,
      date,
    });
  } catch (error) {
    console.error('Error reading daily tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

