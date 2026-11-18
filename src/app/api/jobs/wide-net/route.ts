import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { WIDE_NET_QUEUE_TARGET } from '@/lib/job-wide-net';
import { readJobListings } from '../job-store-utils';
import { countWideNetWaiting, readWideNetState, runWideNetImport, writeWideNetState } from './store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = () => ({
  ...readWideNetState(),
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
]);

export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'action must be run or set-enabled' }, { status: 400 });
    }
    if (parsed.data.action === 'set-enabled') {
      writeWideNetState({ ...readWideNetState(), enabled: parsed.data.enabled });
    } else {
      await runWideNetImport('manual');
    }
    return NextResponse.json({ success: true, wideNet: view(), listings: readJobListings().listings });
  } catch (error) {
    console.error('Error updating the wide net:', error);
    return NextResponse.json({ success: false, error: 'Failed to update the wide net' }, { status: 500 });
  }
}
