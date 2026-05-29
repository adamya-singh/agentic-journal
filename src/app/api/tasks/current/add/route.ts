import { NextRequest, NextResponse } from 'next/server';
import { ListType } from '@/lib/types';
import { addTaskToCurrent } from '../current-store-utils';

export async function POST(request: NextRequest) {
  try {
    const { taskId, listType, position } = await request.json();
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json({ success: false, error: 'Invalid listType' }, { status: 400 });
    }
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 });
    }
    if (position !== undefined && (typeof position !== 'number' || position < 0)) {
      return NextResponse.json({ success: false, error: 'position must be non-negative' }, { status: 400 });
    }
    const added = addTaskToCurrent(listType as ListType, taskId, position);
    return NextResponse.json({
      success: added,
      message: added ? 'Task added to Current' : 'Task was not found in General',
    }, { status: added ? 200 : 404 });
  } catch (error) {
    console.error('Error adding Current task:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
