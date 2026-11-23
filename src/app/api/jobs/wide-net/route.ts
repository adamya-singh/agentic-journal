import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { WIDE_NET_QUEUE_TARGET } from '@/lib/job-wide-net';
import { readJobListings } from '../job-store-utils';
import {
  addTurnedDownPosting, countWideNetWaiting, isWideNetRunning, offerPostings, readWideNetState, runWideNetImport,
  writeWideNetState,
} from './store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many turned-down postings the board lists, newest first. */
const TURNED_DOWN_SHOWN = 40;

const view = () => {
  const { turnedDown = {}, offered = {}, ...state } = readWideNetState();
  const entries = Object.entries(turnedDown).map(([key, entry]) => ({ key, ...entry }));
  return {
    ...state,
    running: isWideNetRunning(),
    /** Postings searches handed in that are waiting to be judged. */
    offeredCount: Object.keys(offered).length,
    turnedDownCount: entries.length,
    turnedDown: entries.sort((first, second) => second.at.localeCompare(first.at)).slice(0, TURNED_DOWN_SHOWN),
    ...queue(),
  };
};

const queue = () => ({
  waiting: countWideNetWaiting(readJobListings().listings),
  queueTarget: WIDE_NET_QUEUE_TARGET,
});

export async function GET() {
  try {
    return NextResponse.json({ success: true, wideNet: view() });
  } catch (error) {
    console.error('Error reading the wide net:', error);
    return NextResponse.json({ success: false, error: 'Failed to read the wide net' }, { status: 500 });
  }
}

const BodySchema = z.union([
  z.object({ action: z.literal('run') }),
  z.object({ action: z.literal('set-enabled'), enabled: z.boolean() }),
  z.object({ action: z.literal('add'), key: z.string().min(1) }),
  z.object({
    action: z.literal('offer'),
    postings: z.array(z.object({
      company: z.string().trim().min(1).max(200),
      title: z.string().trim().min(1).max(300),
      location: z.string().trim().min(1).max(400),
      link: z.string().trim().url().regex(/^https?:\/\//i).max(2000),
      source: z.string().trim().min(1).max(120),
      postedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })).min(1).max(60),
  }),
]);

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'action must be run, set-enabled, add or offer (with its postings)' }, { status: 400 });
    }
    if (parsed.data.action === 'set-enabled') {
      writeWideNetState({ ...readWideNetState(), enabled: parsed.data.enabled });
    } else if (parsed.data.action === 'offer') {
      // Judged by the next check, within minutes: see runWideNetImportIfDue.
      const { outcomes, waiting } = offerPostings(parsed.data.postings);
      return NextResponse.json({ success: true, outcomes, waitingToBeJudged: waiting });
    } else if (parsed.data.action === 'add') {
      if (!(await addTurnedDownPosting(parsed.data.key))) {
        return NextResponse.json({ success: false, error: 'That posting is no longer in the turned-down list' }, { status: 404 });
      }
    } else {
      // OpenClaw's judging takes minutes: the check runs on, and the board asks again until it is over.
      void runWideNetImport('manual');
    }
    return NextResponse.json({ success: true, wideNet: view(), listings: readJobListings().listings });
  } catch (error) {
    console.error('Error updating the wide net:', error);
    return NextResponse.json({ success: false, error: 'Failed to update the wide net' }, { status: 500 });
  }
}
