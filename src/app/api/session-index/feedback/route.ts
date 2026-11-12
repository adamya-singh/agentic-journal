import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { parseTarget, sessionsFor, setFeedback } from '@/lib/session-index/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const body = z.object({ target: z.string(), uid: z.string().min(3).max(200), verdict: z.enum(['link', 'not', 'clear']) }).strict();

/** POST /api/session-index/feedback: link a session to a card by hand, say it is not this one, or undo that. */
export async function POST(req: NextRequest) {
  const parsed = body.safeParse(await req.json().catch(() => null));
  const target = parsed.success ? parseTarget(parsed.data.target) : null;
  if (!parsed.success || !target) return NextResponse.json({ success: false, error: 'Send { target, uid, verdict: link | not | clear }.' }, { status: 400 });
  try {
    setFeedback(target, parsed.data.uid, parsed.data.verdict);
    return NextResponse.json({ success: true, data: sessionsFor(target) });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'That did not save.' }, { status: 400 });
  }
}
