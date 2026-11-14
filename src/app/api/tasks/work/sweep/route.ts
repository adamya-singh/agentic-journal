import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { setSweepEnabled } from '../actions';
import { taskWorkErrorResponse } from '../errors';
import { wakeTaskWorker } from '../cron';
import { runTaskSortIfDue } from '../sort';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ enabled: z.boolean() });

/**
 * POST /api/tasks/work/sweep { enabled } → the sweep's state (the overview's `sweep` field). Adamya's switch for
 * OpenClaw looking at tasks nobody handed over. Turning it on starts sorting now rather than on the next tick; the
 * worker is woken once a batch has found something to prepare. Turning it off never touches the records.
 */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { enabled: true | false }.' }, { status: 400 });
  try {
    const sweep = setSweepEnabled(parsed.data.enabled);
    if (sweep.enabled) {
      // Neither throws.
      void runTaskSortIfDue().then((result) => { if (result.decision === 'sorted') void wakeTaskWorker(); });
    }
    return NextResponse.json({ success: true, data: sweep });
  } catch (error) {
    return taskWorkErrorResponse(error, 'switch the sweep');
  }
}
