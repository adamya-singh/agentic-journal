import { NextResponse } from 'next/server';
import { buildHorizon } from '@/lib/horizon';
import { getCurrentTasks } from '../current/current-store-utils';
import { readCompletedTaskIndex, readGeneralTasks } from '../today/today-store-utils';

/**
 * GET /api/tasks/horizon
 * The home page's priority horizon: dated tasks sorted into zones (holds, next 48h, this week,
 * next week, later), undated items from the ranked Current queue, and what was cleared this week.
 */
export async function GET() {
  try {
    const currentHaveToDoIds = getCurrentTasks('have-to-do').map((task) => task.id);
    const completed = Object.values(readCompletedTaskIndex().tasks).map((task) => ({
      id: task.id,
      text: task.text,
      completedAt: task.completedAt,
    }));
    const data = buildHorizon({
      haveToDo: readGeneralTasks('have-to-do').tasks,
      wantToDo: readGeneralTasks('want-to-do').tasks,
      currentHaveToDoIds,
      completed,
    });
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error building horizon:', error);
    return NextResponse.json({ success: false, error: 'Failed to build horizon' }, { status: 500 });
  }
}
