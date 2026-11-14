import { NextRequest, NextResponse } from 'next/server';
import { taskWorkOverview, taskWorkView } from './actions';
import { taskWorkErrorResponse } from './errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks/work?taskId=<id> → { taskId, record | null, summary }   one task, with its state in plain words
 * GET /api/tasks/work               → { needsYou, working, counts }       open items across tasks, oldest first
 */
export async function GET(request: NextRequest) {
  try {
    const taskId = request.nextUrl.searchParams.get('taskId');
    return NextResponse.json({ success: true, data: taskId ? taskWorkView(taskId) : taskWorkOverview() });
  } catch (error) {
    return taskWorkErrorResponse(error, 'read the task work');
  }
}
