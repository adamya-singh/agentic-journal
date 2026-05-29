import { NextRequest, NextResponse } from 'next/server';
import { ListType } from '@/lib/types';
import { getCurrentTasks } from '../current-store-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listType = (searchParams.get('listType') || 'have-to-do') as ListType;

    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json({ success: false, error: 'Invalid listType' }, { status: 400 });
    }

    const tasks = getCurrentTasks(listType);
    return NextResponse.json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.error('Error reading Current tasks:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
