import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fromThisAppStrict } from '@/lib/same-origin';
import { refreshIndex } from '@/lib/session-index/refresh';
import { parseTarget, sessionsFor } from '@/lib/session-index/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({ target: z.string().min(1).max(80) }).strict();

/**
 * POST /api/session-index/refresh { target: task:<id> | card:<ac_id> }
 *   "Check again": collect what the devices have now (this machine, then the others within a short budget) and fold it
 *   in (lib/session-index/refresh.ts), then the target's sessions as /api/session-index/card gives them.
 *   → { view, refresh: { state: done | busy | failed, at, devices, changed, message?, reused? } }
 * Only the Journal's own pages may ask: it runs ssh to his devices (read-only).
 */
export async function POST(req: NextRequest) {
  if (!fromThisAppStrict(req.headers)) return NextResponse.json({ success: false, error: 'Only the Journal’s own pages may refresh the session index.' }, { status: 403 });
  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  const target = parsed.success ? parseTarget(parsed.data.target) : null;
  if (!target) return NextResponse.json({ success: false, error: 'Send { target: task:<id> | card:<ac_id> }.' }, { status: 400 });
  try {
    const refresh = await refreshIndex();
    return NextResponse.json({ success: true, data: { view: sessionsFor(target), refresh } }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'The session index could not be refreshed.' }, { status: 500 });
  }
}
