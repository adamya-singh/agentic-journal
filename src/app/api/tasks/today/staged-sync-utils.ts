import * as fs from 'fs';
import * as path from 'path';
import { ensureDailyJournalExists } from '../due-date-utils';
import {
  ListType,
  Task,
  StagedTaskEntry,
  TaskJournalRangeEntry,
  JournalHourSlot,
  isJournalEntryArray,
  isTaskJournalEntry,
} from '@/lib/types';
import { readCompletedTaskSnapshots, readGeneralTasks, readTodayOverrides } from './today-store-utils';
import { computeTodayTasks } from './today-compute-utils';

interface DayJournal {
  [key: string]: unknown;
  staged?: StagedTaskEntry[];
  ranges?: TaskJournalRangeEntry[];
}

const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;

type TodayTasksByList = {
  'have-to-do': Task[];
  'want-to-do': Task[];
};

function getScheduledTaskIds(journal: DayJournal): Set<string> {
  const scheduledIds = new Set<string>();

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

  if (journal.ranges && Array.isArray(journal.ranges)) {
    for (const range of journal.ranges) {
      if (range.taskId) {
        scheduledIds.add(range.taskId);
      }
    }
  }

  return scheduledIds;
}

export function computeTodayTasksForList(date: string, listType: ListType): Task[] {
  const generalData = readGeneralTasks(listType);
  const overrides = readTodayOverrides(date, listType);
  const completedSnapshots = readCompletedTaskSnapshots(date, listType);

  return computeTodayTasks({
    date,
    generalTasks: generalData.tasks,
    overrides,
    completedSnapshots,
  });
}

export function computeTodayTasksByList(date: string): TodayTasksByList {
  return {
    'have-to-do': computeTodayTasksForList(date, 'have-to-do'),
    'want-to-do': computeTodayTasksForList(date, 'want-to-do'),
  };
}

export function syncComputedTodayTasksToJournalStaged(
  date: string,
  todayByList?: TodayTasksByList,
  options?: { createJournalIfMissing?: boolean }
): boolean {
  const createJournalIfMissing = options?.createJournalIfMissing ?? true;
  if (createJournalIfMissing) {
    ensureDailyJournalExists(date);
  }

  const journalFilePath = path.join(JOURNAL_DIR, `${date}.json`);
  if (!fs.existsSync(journalFilePath)) {
    return false;
  }

  const content = fs.readFileSync(journalFilePath, 'utf-8');
  const journal: DayJournal = JSON.parse(content) as DayJournal;
  if (!journal.staged) {
    journal.staged = [];
  }

  const scheduledTaskIds = getScheduledTaskIds(journal);
  const existingByKey = new Map<string, StagedTaskEntry>();
  for (const entry of journal.staged) {
    if (!scheduledTaskIds.has(entry.taskId)) {
      existingByKey.set(`${entry.taskId}:${entry.listType}`, entry);
    }
  }

  const computed = todayByList ?? computeTodayTasksByList(date);
  const desired: StagedTaskEntry[] = [];
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    for (const task of computed[listType]) {
      if (scheduledTaskIds.has(task.id)) {
        continue;
      }
      const key = `${task.id}:${listType}`;
      desired.push(existingByKey.get(key) ?? { taskId: task.id, listType });
    }
  }

  if (JSON.stringify(journal.staged) === JSON.stringify(desired)) {
    return false;
  }

  journal.staged = desired;
  fs.writeFileSync(journalFilePath, JSON.stringify(journal, null, 2), 'utf-8');
  return true;
}
