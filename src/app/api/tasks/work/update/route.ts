import { NextRequest, NextResponse } from 'next/server';
import { UpdateSchema, updateTaskWork } from '../actions';
import { taskWorkErrorResponse } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tasks/work/update { taskId, token, action, ... }
 * The claiming run's writes; every one needs its live lease token (409 otherwise). `attempted` and `progress` keep
 * the lease; waiting, rest, continue, ask, propose, looks-done, retry and release close the run.
 */
export async function POST(request: NextRequest) {
  const parsed = UpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, data: updateTaskWork(parsed.data) });
  } catch (error) {
    return taskWorkErrorResponse(error, 'update the task work');
  }
}
