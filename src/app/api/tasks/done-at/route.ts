import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { applyDoneAt } from './apply';

const BodySchema = z.object({
  taskId: z.string().min(1),
  listType: z.enum(['have-to-do', 'want-to-do']),
  completedAt: z.string().optional(),
});

/**
 * POST /api/tasks/done-at
 * Completes a task at a given time (default now) and logs it in that day's journal.
 * Body: { taskId, listType, completedAt?: ISO }
 * Returns a receipt for POST /api/tasks/done-at/undo.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'taskId and a valid listType are required' }, { status: 400 });
    }
    const { taskId, listType } = parsed.data;
    const completedAt = parsed.data.completedAt ? new Date(parsed.data.completedAt) : new Date();
    if (Number.isNaN(completedAt.getTime()) || completedAt.getTime() > Date.now() + 5 * 60_000) {
      return NextResponse.json({ success: false, error: 'completedAt must be a time that has already happened' }, { status: 400 });
    }

    const result = applyDoneAt({ taskId, listType, completedAt });
    if (result.status === 'done') return NextResponse.json({ success: true, receipt: result.receipt });
    if (result.status === 'blocked') {
      return NextResponse.json(
        { success: false, error: 'Task has incomplete subtasks', blockedByOpenSubtasks: true, openSubtasks: result.openSubtasks },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { success: false, error: result.status === 'not-found' ? 'Task not found' : 'Task is already completed' },
      { status: result.status === 'not-found' ? 404 : 409 }
    );
  } catch (error) {
    console.error('Error completing task at a time:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
