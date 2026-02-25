import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { ListType, Task } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import {
  applyPlanActionInJournal,
  DayJournalWithRanges,
  markMissedPlansForDate,
  PlanAction,
  TextPlanSource,
} from '../plan-lifecycle-utils';
import { computeTodayTasks } from '../../tasks/today/today-compute-utils';
import {
  findLegacyDailyTaskById,
  readCompletedTaskSnapshots,
  readGeneralTasks,
  readTodayOverrides,
  TaskCompletionSnapshot,
  upsertCompletedTaskIndexSnapshot,
  upsertCompletedTaskSnapshot,
  writeGeneralTasks,
} from '../../tasks/today/today-store-utils';

const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_HOURS = [
  '7am', '8am', '9am', '10am', '11am', '12pm',
  '1pm', '2pm', '3pm', '4pm', '5pm', '6pm',
  '7pm', '8pm', '9pm', '10pm', '11pm', '12am',
  '1am', '2am', '3am', '4am', '5am', '6am',
];

function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

function isValidAction(action: unknown): action is PlanAction {
  return action === 'in-progress' || action === 'complete';
}

function parseSource(source: unknown): TextPlanSource | null {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const candidate = source as {
    kind?: unknown;
    hour?: unknown;
    start?: unknown;
    end?: unknown;
  };

  if (candidate.kind === 'hour' && typeof candidate.hour === 'string' && VALID_HOURS.includes(candidate.hour)) {
    return { kind: 'hour', hour: candidate.hour };
  }

  if (
    candidate.kind === 'range' &&
    typeof candidate.start === 'string' &&
    typeof candidate.end === 'string' &&
    VALID_HOURS.includes(candidate.start) &&
    VALID_HOURS.includes(candidate.end) &&
    VALID_HOURS.indexOf(candidate.start) < VALID_HOURS.indexOf(candidate.end)
  ) {
    return {
      kind: 'range',
      start: candidate.start,
      end: candidate.end,
    };
  }

  return null;
}

function getJournalFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

function journalFileExists(date: string): boolean {
  return fs.existsSync(getJournalFilePath(date));
}

function readJournalFile(date: string): DayJournalWithRanges {
  const content = fs.readFileSync(getJournalFilePath(date), 'utf-8');
  const journal = JSON.parse(content) as DayJournalWithRanges;
  if (!journal.ranges) {
    journal.ranges = [];
  }
  return journal;
}

function writeJournalFile(date: string, journal: DayJournalWithRanges): void {
  fs.writeFileSync(getJournalFilePath(date), JSON.stringify(journal, null, 2), 'utf-8');
}

function buildCompletionSnapshot(task: Task, listType: ListType): TaskCompletionSnapshot {
  const snapshot: TaskCompletionSnapshot = {
    id: task.id,
    text: task.text,
    completed: true,
    completedAt: new Date().toISOString(),
    listType,
  };

  if (task.dueDate) {
    snapshot.dueDate = task.dueDate;
  }
  if (task.dueTimeStart) {
    snapshot.dueTimeStart = task.dueTimeStart;
  }
  if (task.dueTimeEnd) {
    snapshot.dueTimeEnd = task.dueTimeEnd;
  }

  if (task.projects && task.projects.length > 0) {
    snapshot.projects = normalizeProjectList(task.projects);
  }

  if (task.notesMarkdown && task.notesMarkdown.trim().length > 0) {
    snapshot.notesMarkdown = task.notesMarkdown.trim();
  }

  if (task.isDaily) {
    snapshot.isDaily = true;
  }

  return snapshot;
}

function ensureTaskCompletedForDate(date: string, taskId: string, listType: ListType): boolean {
  const completedSnapshots = readCompletedTaskSnapshots(date, listType);
  const alreadyCompleted = completedSnapshots.some((snapshot) => snapshot.id === taskId);
  if (alreadyCompleted) {
    return false;
  }

  const generalData = readGeneralTasks(listType);
  const overrides = readTodayOverrides(date, listType);
  const computedTodayTasks = computeTodayTasks({
    date,
    generalTasks: generalData.tasks,
    overrides,
    completedSnapshots,
  });

  const taskFromToday = computedTodayTasks.find((task) => task.id === taskId) ?? null;
  const taskFromGeneral = generalData.tasks.find((task) => task.id === taskId) ?? null;
  const taskFromLegacyDaily = findLegacyDailyTaskById(date, listType, taskId);
  const taskToComplete = taskFromToday ?? taskFromGeneral ?? taskFromLegacyDaily;

  if (!taskToComplete) {
    return false;
  }

  const completionSnapshot = buildCompletionSnapshot(taskToComplete, listType);
  upsertCompletedTaskSnapshot(date, listType, completionSnapshot);
  upsertCompletedTaskIndexSnapshot(taskId, completionSnapshot, date);

  if (!taskToComplete.isDaily) {
    const initialLength = generalData.tasks.length;
    generalData.tasks = generalData.tasks.filter((task) => task.id !== taskId);
    if (generalData.tasks.length !== initialLength) {
      writeGeneralTasks(generalData, listType);
    }
  }

  return true;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, planId, source, action } = body as {
      date?: string;
      planId?: string;
      source?: unknown;
      action?: unknown;
    };

    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    if (!planId || typeof planId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'planId is required.' },
        { status: 400 }
      );
    }

    if (!isValidAction(action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Use "in-progress" or "complete".' },
        { status: 400 }
      );
    }

    const parsedSource = parseSource(source);
    if (!parsedSource) {
      return NextResponse.json(
        { success: false, error: 'Invalid source. Use { kind: "hour", hour } or { kind: "range", start, end }.' },
        { status: 400 }
      );
    }

    if (!journalFileExists(date)) {
      return NextResponse.json(
        { success: false, error: `No journal exists for date ${date}.` },
        { status: 404 }
      );
    }

    const journal = readJournalFile(date);
    const now = new Date();
    markMissedPlansForDate(journal, date, now);

    const result = applyPlanActionInJournal(journal, date, planId, parsedSource, action, now.toISOString());
    if (result.status === 'not-found') {
      return NextResponse.json(
        { success: false, error: 'Plan entry not found for the provided planId/source.' },
        { status: 404 }
      );
    }

    let taskCompletionChanged = false;
    if (action === 'complete' && result.entryType === 'task' && result.task) {
      taskCompletionChanged = ensureTaskCompletedForDate(date, result.task.taskId, result.task.listType);
    }

    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      action,
      entryType: result.entryType,
      loggedCreated: result.loggedCreated,
      planStatus: result.planStatus,
      taskCompletionChanged: result.entryType === 'task' ? taskCompletionChanged : undefined,
      message: action === 'complete'
        ? 'Plan marked complete.'
        : 'Plan marked in progress.',
    });
  } catch (error) {
    console.error('Error applying plan action:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
