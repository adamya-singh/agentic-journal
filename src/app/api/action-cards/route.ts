import { NextResponse } from 'next/server';
import { ActionCardError, farSideView } from '@/lib/action-cards/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/action-cards: what the far side of Horizon Dawn shows (live cards and recent answers). */
export async function GET() {
  try {
    return NextResponse.json({ success: true, data: farSideView() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const status = e instanceof ActionCardError ? e.status : 500;
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Could not read action cards.' }, { status });
  }
}
