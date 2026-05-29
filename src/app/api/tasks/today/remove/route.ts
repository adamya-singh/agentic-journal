import { NextRequest, NextResponse } from 'next/server';
import { ListType } from '@/lib/types';
import { removeTaskFromTodaySelection } from '../../current/current-store-utils';
import { syncComputedTodayTasksToJournalStaged } from '../staged-sync-utils';

/**
 * POST /api/tasks/today/remove
 * Removes a selected Current task from the dated Today snapshot.
 *
 * Body: { taskId: string, listType: 'have-to-do' | 'want-to-do', date: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, listType, date } = body;

    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskId parameter is required and must be a string' },
        { status: 400 }
      );
    }

    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { success: false, error: 'date parameter is required and must be a string in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const changed = removeTaskFromTodaySelection(date, listType as ListType, taskId);
    syncComputedTodayTasksToJournalStaged(date);

    return NextResponse.json({
      success: true,
      removed: changed,
      message: 'Task removed from today\'s list',
      journalCleaned: false,
    });
  } catch (error) {
    console.error('Error removing task from computed today list:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
