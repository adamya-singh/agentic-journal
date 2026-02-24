import { NextRequest, NextResponse } from 'next/server';
import { ListType } from '@/lib/types';
import { computeTodayTasksForList, computeTodayTasksByList, syncComputedTodayTasksToJournalStaged } from '../staged-sync-utils';

/**
 * GET /api/tasks/today/list
 * Returns the computed tasks for a specific date.
 *
 * Query params:
 * - listType: 'have-to-do' | 'want-to-do' (defaults to 'have-to-do')
 * - date: The date in ISO format (YYYY-MM-DD) (required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listType = (searchParams.get('listType') || 'have-to-do') as ListType;
    const date = searchParams.get('date');

    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date parameter is required in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const todayByList = computeTodayTasksByList(date);
    syncComputedTodayTasksToJournalStaged(date, todayByList);
    const todayTasks = todayByList[listType] ?? computeTodayTasksForList(date, listType);

    return NextResponse.json({
      success: true,
      tasks: todayTasks,
      date,
    });
  } catch (error) {
    console.error('Error computing daily tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
