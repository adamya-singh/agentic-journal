import { NextRequest, NextResponse } from 'next/server';
import { ensureDailyJournalExists, addTaskToStaged } from '../../due-date-utils';
import { ListType } from '@/lib/types';
import { includeTaskInTodayOverrides } from '../today-store-utils';

/**
 * POST /api/tasks/today/add
 * Adds a manual inclusion override so an existing task appears in the computed today list.
 *
 * Body: { taskId: string, taskText: string, listType: 'have-to-do' | 'want-to-do', date: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, taskText, listType, date } = body;

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

    if (!taskText || typeof taskText !== 'string' || taskText.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'taskText parameter is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { success: false, error: 'date parameter is required and must be a string in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const { changed } = includeTaskInTodayOverrides(date, listType as ListType, taskId);

    // Keep journal staged behavior compatible with existing UI.
    ensureDailyJournalExists(date);
    addTaskToStaged(date, taskId, listType as ListType);

    return NextResponse.json({
      success: true,
      alreadyExists: !changed,
      message: changed ? 'Task added to today\'s list' : 'Task already in today\'s list',
    });
  } catch (error) {
    console.error('Error adding task to computed today list:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
