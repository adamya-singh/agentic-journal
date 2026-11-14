import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { handTaskWork } from '../actions';
import { taskWorkErrorResponse } from '../errors';
import { wakeTaskWorker } from '../cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ taskId: z.string().min(1).max(200), on: z.boolean() });

/** POST /api/tasks/work/hand { taskId, on } → the record. Adamya's Hand to OpenClaw / Hands off switch. */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { taskId, on: true | false }.' }, { status: 400 });
  try {
    const record = handTaskWork(parsed.data.taskId, parsed.data.on);
    // Handed over: OpenClaw starts now rather than on the next five-minute tick. Never throws.
    if (record.status === 'queued') void wakeTaskWorker();
    return NextResponse.json({ success: true, data: record });
  } catch (error) {
    return taskWorkErrorResponse(error, 'hand the task over');
  }
}
