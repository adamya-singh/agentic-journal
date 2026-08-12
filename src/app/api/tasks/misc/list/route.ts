import { NextResponse } from 'next/server';
import { readMiscTasks } from '../misc-store-utils';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const data = readMiscTasks();
    return NextResponse.json({ success: true, tasks: data.tasks });
  } catch (error) {
    console.error('Error listing misc tasks:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
