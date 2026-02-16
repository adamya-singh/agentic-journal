import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import {
  DayJournalWithRanges,
  markMissedPlansForDate,
  replanTaskEntryInJournal,
} from '../plan-lifecycle-utils';

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

function getJournalFilePath(date: string): string {
  return path.join(JOURNAL_DIR, `${date}.json`);
}

function readJournalFile(date: string): DayJournalWithRanges {
  const content = fs.readFileSync(getJournalFilePath(date), 'utf-8');
  const parsed = JSON.parse(content) as DayJournalWithRanges;
  if (!parsed.ranges) {
    parsed.ranges = [];
  }
  return parsed;
}

function writeJournalFile(date: string, journal: DayJournalWithRanges): void {
  fs.writeFileSync(getJournalFilePath(date), JSON.stringify(journal, null, 2), 'utf-8');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, fromPlanId, to } = body as {
      date?: string;
      fromPlanId?: string;
      to?: { hour?: string; start?: string; end?: string };
    };

    if (!date || !isValidDateFormat(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date format. Use YYYY-MM-DD.' },
        { status: 400 }
      );
    }

    if (!fromPlanId || typeof fromPlanId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'fromPlanId is required.' },
        { status: 400 }
      );
    }

    if (!to || typeof to !== 'object') {
      return NextResponse.json(
        { success: false, error: 'to target is required.' },
        { status: 400 }
      );
    }

    const hasHour = typeof to.hour === 'string';
    const hasRange = typeof to.start === 'string' || typeof to.end === 'string';
    if ((hasHour && hasRange) || (!hasHour && !hasRange)) {
      return NextResponse.json(
        { success: false, error: 'Provide either to.hour or to.start+to.end.' },
        { status: 400 }
      );
    }

    if (hasHour && !VALID_HOURS.includes(to.hour as string)) {
      return NextResponse.json(
        { success: false, error: 'Invalid to.hour value.' },
        { status: 400 }
      );
    }

    if (hasRange) {
      if (
        !to.start ||
        !to.end ||
        !VALID_HOURS.includes(to.start) ||
        !VALID_HOURS.includes(to.end) ||
        VALID_HOURS.indexOf(to.start) >= VALID_HOURS.indexOf(to.end)
      ) {
        return NextResponse.json(
          { success: false, error: 'Invalid to.start/to.end range.' },
          { status: 400 }
        );
      }
    }

    const filePath = getJournalFilePath(date);
    if (!fs.existsSync(filePath)) {
      return NextResponse.json(
        { success: false, error: `No journal exists for date ${date}.` },
        { status: 404 }
      );
    }

    const journal = readJournalFile(date);
    markMissedPlansForDate(journal, date, new Date());

    const result = hasHour
      ? replanTaskEntryInJournal(journal, fromPlanId, { hour: to.hour as string })
      : replanTaskEntryInJournal(journal, fromPlanId, { start: to.start as string, end: to.end as string });

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Plan not found for fromPlanId.' },
        { status: 404 }
      );
    }

    writeJournalFile(date, journal);

    return NextResponse.json({
      success: true,
      date,
      oldPlanId: result.oldPlanId,
      newPlanId: result.newPlanId,
      message: 'Plan successfully replanned.',
    });
  } catch (error) {
    console.error('Error replanning journal entry:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
