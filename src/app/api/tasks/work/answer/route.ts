import { NextRequest, NextResponse } from 'next/server';
import { AnswerSchema, answerTaskWork } from '../actions';
import { taskWorkErrorResponse } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tasks/work/answer { taskId, itemId, decision: 'approve' | 'decline' | 'answer', answer?, editedDetail? }
 * → { record, item, completeRequested }. Adamya's answer to one open item. When none are left the task goes back
 * to the worker, or rests if he declined everything. A yes to "Looks done" is only recorded (completeRequested):
 * the caller completes the task through the existing flow.
 */
export async function POST(request: NextRequest) {
  const parsed = AnswerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Send { taskId, itemId, decision: approve | decline | answer, answer?, editedDetail? }.' }, { status: 400 });
  }
  try {
    return NextResponse.json({ success: true, data: answerTaskWork(parsed.data) });
  } catch (error) {
    return taskWorkErrorResponse(error, 'record the answer');
  }
}
