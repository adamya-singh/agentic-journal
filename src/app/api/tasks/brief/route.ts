import { NextRequest, NextResponse } from 'next/server';
import { loadTaskBrief } from './build';

/**
 * GET /api/tasks/brief?id=<taskId>
 * Everything known about one task, organized to start it: when and where, the next action, steps,
 * facts, links, warnings, connected tasks, notes sections and journal history, plus what OpenClaw
 * found in the background (see brief-agent) and the state of that fill.
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('id');
  if (!taskId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  try {
    const brief = loadTaskBrief(taskId);
    if (!brief) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: brief });
  } catch (error) {
    console.error('Error building task brief:', error);
    return NextResponse.json({ success: false, error: 'Failed to build the brief' }, { status: 500 });
  }
}
