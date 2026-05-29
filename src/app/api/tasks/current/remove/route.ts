import { NextRequest, NextResponse } from 'next/server';
import { ListType } from '@/lib/types';
import { removeTaskFromCurrent } from '../current-store-utils';

export async function POST(request: NextRequest) {
  try {
    const { taskId, listType } = await request.json();
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json({ success: false, error: 'Invalid listType' }, { status: 400 });
    }
    if (typeof taskId !== 'string' || taskId.length === 0) {
      return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 });
    }
    const removed = removeTaskFromCurrent(listType as ListType, taskId);
    return NextResponse.json({ success: true, removed, message: removed ? 'Task removed from Current' : 'Task was not in Current' });
  } catch (error) {
    console.error('Error removing Current task:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
