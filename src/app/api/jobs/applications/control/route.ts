import { NextRequest, NextResponse } from 'next/server';
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
      await mutateJobApplicationsStore((store) => { store.workerEnabled = true; });
      const worker = await triggerJobApplicationWorker();
      if (!worker.success) {
        await mutateJobApplicationsStore((store) => { store.workerEnabled = false; });
        return NextResponse.json({ success: false, error: worker.error, worker }, { status: 503 });
      }
      return NextResponse.json({ success: true, workerEnabled: true, readiness, worker });
    }

    const worker = await disableJobApplicationWorker();
    if (!worker.success) {
      return NextResponse.json({ success: false, error: worker.error, worker }, { status: 503 });
    }
    await mutateJobApplicationsStore((store) => { store.workerEnabled = false; });
    return NextResponse.json({ success: true, workerEnabled: false, worker });
  } catch (error) {
    console.error('Error controlling job application worker:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to control job application worker' },
      { status: 500 },
    );
  }
}
