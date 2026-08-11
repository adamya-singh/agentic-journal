import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { ListType } from '@/lib/types';
import { journalDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { DayJournalWithRanges, PlanAction, TextPlanSource } from '../plan-lifecycle-utils';
import { applyPlanActionInJournal, markMissedPlansForDate } from '../plan-lifecycle-utils';
import { ensureCurrentSystemThroughToday } from '../../tasks/current/current-store-utils';
import { completeTaskForDate } from '../../tasks/today/completion-utils';

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
  return path.join(journalDataDir(), `${date}.json`);
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
  writeJsonFileAtomic(getJournalFilePath(date), journal);
}

// Completing a task from a plan action shares the same core (and open-subtask
// guard) as the Today checkbox; a blocked or missing task simply leaves the
// task uncompleted while the journal plan action still applies.
function ensureTaskCompletedForDate(date: string, taskId: string, listType: ListType): boolean {
  ensureCurrentSystemThroughToday();
  return completeTaskForDate(date, listType, taskId).status === 'completed';
}

export async function POST(request: NextRequest) {
  try {
    ensureCurrentSystemThroughToday();
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
