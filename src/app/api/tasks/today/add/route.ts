import { NextRequest, NextResponse } from 'next/server';
import { ListType } from '@/lib/types';
import { addCurrentTaskToToday } from '../../current/current-store-utils';
import { syncComputedTodayTasksToJournalStaged } from '../staged-sync-utils';

/**
 * POST /api/tasks/today/add
 * Selects an existing Current task into the dated Today snapshot.
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

    const added = addCurrentTaskToToday(date, listType as ListType, taskId);
    if (!added) {
      return NextResponse.json(
        { success: false, error: 'Task must be in Current before it can be selected for Today' },
        { status: 404 }
      );
    }
    syncComputedTodayTasksToJournalStaged(date);

    return NextResponse.json({
      success: true,
      message: 'Task selected for today',
    });
  } catch (error) {
    console.error('Error adding task to computed today list:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
