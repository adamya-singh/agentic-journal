import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { WIDE_NET_QUEUE_TARGET } from '@/lib/job-wide-net';
import { readJobListings } from '../job-store-utils';
import { addTurnedDownPosting, countWideNetWaiting, isWideNetRunning, readWideNetState, runWideNetImport, writeWideNetState } from './store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How many turned-down postings the board lists, newest first. */
const TURNED_DOWN_SHOWN = 40;

const view = () => {
  const { turnedDown = {}, ...state } = readWideNetState();
  const entries = Object.entries(turnedDown).map(([key, entry]) => ({ key, ...entry }));
  return {
    ...state,
    running: isWideNetRunning(),
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
]);

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'action must be run, set-enabled or add' }, { status: 400 });
    }
    if (parsed.data.action === 'set-enabled') {
      writeWideNetState({ ...readWideNetState(), enabled: parsed.data.enabled });
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
