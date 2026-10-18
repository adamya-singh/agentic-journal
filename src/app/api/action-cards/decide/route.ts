import { NextRequest, NextResponse } from 'next/server';
import { ActionCardError, decide, undo } from '@/lib/action-cards/store';
import { authorized } from '@/app/api/bugs-features/route-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/action-cards/decide
 * { id, verdict: 'agree' | 'dismiss', reason, outcome?, taskId?, taskListType?, snooze? }, or { id, undo: true }.
 * A reason is always required. Undo returns the task to remove when agreeing had made one.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, error: 'A same-origin request is required.' }, { status: 403 });
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && body.undo === true) {
      return NextResponse.json({ success: true, data: undo(String(body.id ?? '')) });
    }
    return NextResponse.json({ success: true, data: { card: decide(body) } });
  } catch (e) {
    const status = e instanceof ActionCardError ? e.status : e instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Could not save that answer.' }, { status });
  }
}
