import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { revokeStanding } from '../actions';
import { taskWorkErrorResponse } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ taskId: z.string().min(1).max(200), on: z.literal(false) });

/**
 * POST /api/tasks/work/standing { taskId, on: false } → { record }. Adamya takes back his standing permission for
 * follow-ups on a task. It is only ever given by approving an email with "and follow-ups" (the answer route).
 */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { taskId, on: false }.' }, { status: 400 });
  try {
    return NextResponse.json({ success: true, data: { record: revokeStanding(parsed.data.taskId) } });
  } catch (error) {
    return taskWorkErrorResponse(error, 'take the permission back');
  }
}
