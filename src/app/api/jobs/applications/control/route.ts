import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import {
  getJobApplicationReadiness,
  mutateJobApplicationsStore,
  readJobApplicationsStore,
} from '../../application-store-utils';
import {
  disableJobApplicationWorker,
  triggerJobApplicationWorker,
} from '../../application-worker-utils';

export const runtime = 'nodejs';

const ControlSchema = z.object({
  action: z.enum(['start', 'pause']),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = ControlSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'action must be start or pause' },
        { status: 400 },
      );
    }

    if (parsed.data.action === 'start') {
      const readiness = getJobApplicationReadiness();
      if (!readiness.ready) {
        return NextResponse.json(
          {
            success: false,
            error: `Missing resume files: ${readiness.missingFiles.join(', ')}`,
            readiness,
          },
          { status: 409 },
        );
      }
      if (readJobApplicationsStore().enabledApplicationCategories.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Select at least one application category before starting' },
          { status: 409 },
        );
      }
      await mutateJobApplicationsStore((store) => {
        store.workerEnabled = true;
      });
      // The flag flip above is the source of truth for claim gating; the slow
      // OpenClaw CLI round-trips (2-5s cold start each) run after the response.
      after(async () => {
        try {
          const worker = await triggerJobApplicationWorker();
          if (!worker.success) {
            console.error('Deferred worker trigger failed:', worker.error);
          }
        } catch (error) {
          console.error('Deferred worker trigger failed:', error);
        }
      });
      return NextResponse.json({ success: true, workerEnabled: true, readiness, deferred: true });
    }

    await mutateJobApplicationsStore((store) => {
      store.workerEnabled = false;
    });
    after(async () => {
      try {
        const worker = await disableJobApplicationWorker();
        if (!worker.success) {
          console.error('Deferred worker disable failed:', worker.error);
        }
      } catch (error) {
        console.error('Deferred worker disable failed:', error);
      }
    });
    return NextResponse.json({ success: true, workerEnabled: false, deferred: true });
  } catch (error) {
    console.error('Error controlling job application worker:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to control job application worker' },
      { status: 500 },
    );
  }
}
