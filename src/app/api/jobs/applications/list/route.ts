import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { buildJobApplicationsView } from '../../application-store-utils';
import { reconcileAndWakeJobApplicationWorker } from '../../application-worker-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const view = buildJobApplicationsView();
    // Fast-path self-heal: if the view exposes a run stranded behind an
    // expired lease, recover it after the response. The reconcile is
    // throttled and swallows its own errors; instrumentation.ts covers the
    // closed-tab case.
    const hasStaleLease = Object.values(view.applications).some(
      (application) =>
        application.status === 'in-progress' &&
        application.lease &&
        Date.parse(application.lease.expiresAt) <= Date.now(),
    );
    if (hasStaleLease) {
      after(() => reconcileAndWakeJobApplicationWorker());
    }
    return NextResponse.json({ success: true, ...view });
  } catch (error) {
    console.error('Error reading job applications:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read job applications' },
      { status: 500 },
    );
  }
}
