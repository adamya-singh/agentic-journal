import { NextRequest, NextResponse } from 'next/server';
import { parseTarget, sessionsFor } from '@/lib/session-index/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/session-index/card?target=task:<id>|card:<ac_id>: the sessions that worked on it. */
export async function GET(req: NextRequest) {
  const target = parseTarget(req.nextUrl.searchParams.get('target'));
  if (!target) return NextResponse.json({ success: false, error: 'target must be task:<id> or card:<ac_id>.' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: sessionsFor(target) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Could not read the session index.' }, { status: 500 });
  }
}
