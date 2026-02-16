import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { JournalRangeEntry, StagedTaskEntry } from '@/lib/types';
import {
  completeTextPlanInJournal,
  DayJournalWithRanges,
  markMissedPlansForDate,
  TextPlanSource,
} from '../plan-lifecycle-utils';

const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const VALID_HOURS = [
  '7am', '8am', '9am', '10am', '11am', '12pm',
  '1pm', '2pm', '3pm', '4pm', '5pm', '6pm',
  '7pm', '8pm', '9pm', '10pm', '11pm', '12am',
  '1am', '2am', '3am', '4am', '5am', '6am',
];

type DayJournalWithRangesAndStaged = DayJournalWithRanges & {
  ranges?: JournalRangeEntry[];
  staged?: StagedTaskEntry[];
};

function isValidDateFormat(date: string): boolean {
  return DATE_REGEX.test(date);
}

function getJournalFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

function journalFileExists(date: string): boolean {
  return fs.existsSync(getJournalFilePath(date));
}

function readJournalFile(date: string): DayJournalWithRangesAndStaged {
  const content = fs.readFileSync(getJournalFilePath(date), 'utf-8');
  const journal = JSON.parse(content) as DayJournalWithRangesAndStaged;
  if (!journal.ranges) {
    journal.ranges = [];
  }
  return journal;
}

function writeJournalFile(date: string, journal: DayJournalWithRangesAndStaged): void {
  fs.writeFileSync(getJournalFilePath(date), JSON.stringify(journal, null, 2), 'utf-8');
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

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, planId, source } = body as {
      date?: string;
      planId?: string;
      source?: unknown;
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

    const result = completeTextPlanInJournal(journal, date, planId, parsedSource, now.toISOString());

    if (result.status === 'not-found') {
      return NextResponse.json(
        { success: false, error: 'Text plan not found for the provided planId/source.' },
        { status: 404 }
      );
    }

    if (result.status === 'already-completed') {
      return NextResponse.json(
        { success: false, error: 'Text plan is already completed.' },
        { status: 409 }
      );
    }

    if (result.status === 'not-completable') {
      return NextResponse.json(
        { success: false, error: 'Text plan is not in a completable state.' },
        { status: 409 }
      );
    }

    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      date,
      planId,
      source: parsedSource,
      loggedCreated: result.loggedCreated,
      message: result.loggedCreated
        ? 'Text plan marked complete and logged entry created.'
        : 'Text plan marked complete.',
    });
  } catch (error) {
    console.error('Error completing text plan:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
