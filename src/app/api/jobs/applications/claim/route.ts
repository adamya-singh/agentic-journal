import { NextResponse } from 'next/server';
import {
  claimNextJobApplication,
  getJobApplicationReadiness,
  readJobApplicationsStore,
} from '../../application-store-utils';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const store = readJobApplicationsStore();
    if (!store.workerEnabled) {
      return NextResponse.json(
        { success: false, error: 'Job application worker is paused' },
        { status: 409 },
      );
    }
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
    const claim = await claimNextJobApplication();
    return NextResponse.json({ success: true, claim });
  } catch (error) {
    console.error('Error claiming job application:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to claim the next job application' },
      { status: 500 },
    );
  }
}
