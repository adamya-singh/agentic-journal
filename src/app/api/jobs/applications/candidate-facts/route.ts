import { NextRequest, NextResponse } from 'next/server';
import { normalizeCandidateFacts } from '@/lib/candidate-facts';
import { mutateJobApplicationsStore, readJobApplicationsStore } from '../../application-store-utils';
import { wakeJobApplicationWorkerIfEnabled } from '../../application-worker-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ success: true, facts: readJobApplicationsStore().candidateFacts ?? null });
  } catch (error) {
    console.error('Error reading standing facts:', error);
    return NextResponse.json({ success: false, error: 'Failed to read standing facts' }, { status: 500 });
  }
}

/**
 * Saves Adamya's standing facts. Drafted eligibility answers that agree with them stop waiting
 * for his Confirm, so the worker is woken: held applications may be ready to send.
 */
export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    const facts = normalizeCandidateFacts({ ...(typeof body === 'object' && body ? body : {}), confirmedAt: new Date().toISOString() });
    if (!facts) {
      return NextResponse.json({ success: false, error: 'Every standing fact needs one of its listed values' }, { status: 400 });
    }
    await mutateJobApplicationsStore((store) => { store.candidateFacts = facts; });
    await wakeJobApplicationWorkerIfEnabled().catch((error) => console.error('Worker wake after facts save failed:', error));
    return NextResponse.json({ success: true, facts });
  } catch (error) {
    console.error('Error saving standing facts:', error);
    return NextResponse.json({ success: false, error: 'Failed to save standing facts' }, { status: 500 });
  }
}
