import { NextRequest, NextResponse } from 'next/server';
import { removeMiscTask } from '../misc-store-utils';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { taskId?: unknown };
    const taskId = typeof body.taskId === 'string' ? body.taskId.trim() : '';
    if (!taskId) {
      return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 });
    }

    const removed = removeMiscTask(taskId);
    if (!removed) {
      return NextResponse.json({ success: true, removed: false, message: 'Task not found in misc notes' });
    }
    return NextResponse.json({ success: true, removed: true, removedTask: removed });
  } catch (error) {
    console.error('Error removing misc task:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
