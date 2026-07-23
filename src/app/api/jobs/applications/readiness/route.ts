import { NextResponse } from 'next/server';
import { getJobApplicationReadiness, readJobApplicationsStore } from '../../application-store-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      workerEnabled: readJobApplicationsStore().workerEnabled,
      readiness: getJobApplicationReadiness(),
    });
  } catch (error) {
    console.error('Error reading job application readiness:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read job application readiness' },
      { status: 500 }
    );
  }
}
