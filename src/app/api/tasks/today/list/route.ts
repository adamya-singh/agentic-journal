import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { ensureDailyJournalExists } from '../../due-date-utils';
import {
  ListType,
  Task,
  StagedTaskEntry,
  TaskJournalRangeEntry,
  JournalHourSlot,
  isJournalEntryArray,
  isTaskJournalEntry,
} from '@/lib/types';
import { readCompletedTaskSnapshots, readGeneralTasks, readTodayOverrides } from '../today-store-utils';
import { computeTodayTasks } from '../today-compute-utils';

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
      for (const entry of slot) {
        if (isTaskJournalEntry(entry)) {
          scheduledIds.add(entry.taskId);
        }
      }
    } else if (isTaskJournalEntry(slot)) {
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
 * Sync all computed today tasks to the journal's staged section.
 * - Adds tasks that aren't staged AND aren't scheduled to a time
 * - Removes tasks from staged that ARE scheduled to a specific time slot
 */
function syncTodayTasksToJournalStaged(date: string, listType: ListType, todayTasks: Task[]): void {
  ensureDailyJournalExists(date);

  const journalFilePath = path.join(JOURNAL_DIR, `${date}.json`);
  if (!fs.existsSync(journalFilePath)) {
    return;
  }

  const content = fs.readFileSync(journalFilePath, 'utf-8');
  const journal: DayJournal = JSON.parse(content) as DayJournal;

  if (!journal.staged) {
    journal.staged = [];
  }

  const scheduledTaskIds = getScheduledTaskIds(journal);
  const originalStagedLength = journal.staged.length;

  // Keep only unscheduled staged entries.
  journal.staged = journal.staged.filter((entry) => !scheduledTaskIds.has(entry.taskId));

  const existingStagedIds = new Set(journal.staged.map((entry) => entry.taskId));
  const tasksToStage = todayTasks.filter(
    (task) => !existingStagedIds.has(task.id) && !scheduledTaskIds.has(task.id)
  );

  for (const task of tasksToStage) {
    journal.staged.push({ taskId: task.id, listType });
  }

  const hasChanges = journal.staged.length !== originalStagedLength || tasksToStage.length > 0;
  if (hasChanges) {
    fs.writeFileSync(journalFilePath, JSON.stringify(journal, null, 2), 'utf-8');
  }
}

/**
 * GET /api/tasks/today/list
 * Returns the computed tasks for a specific date.
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

    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date parameter is required in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const generalData = readGeneralTasks(listType);
    const overrides = readTodayOverrides(date, listType);
    const completedSnapshots = readCompletedTaskSnapshots(date, listType);

    const todayTasks = computeTodayTasks({
      date,
      generalTasks: generalData.tasks,
      overrides,
      completedSnapshots,
    });

    syncTodayTasksToJournalStaged(date, listType, todayTasks);

    return NextResponse.json({
      success: true,
      tasks: todayTasks,
      date,
    });
  } catch (error) {
    console.error('Error computing daily tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
