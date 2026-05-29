import { NextRequest, NextResponse } from 'next/server';
import { ListType } from '@/lib/types';
import { reorderCurrentTask } from '../current-store-utils';

export async function POST(request: NextRequest) {
  try {
    const { taskId, listType, newPosition } = await request.json();
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json({ success: false, error: 'Invalid listType' }, { status: 400 });
    }
    if (typeof taskId !== 'string' || taskId.length === 0 || typeof newPosition !== 'number' || newPosition < 0) {
      return NextResponse.json({ success: false, error: 'taskId and non-negative newPosition are required' }, { status: 400 });
    }
    const reordered = reorderCurrentTask(listType as ListType, taskId, newPosition);
    return NextResponse.json({ success: reordered, message: reordered ? 'Current priority updated' : 'Task was not found in General' }, { status: reordered ? 200 : 404 });
  } catch (error) {
    console.error('Error reordering Current task:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
