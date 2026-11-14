import { NextResponse } from 'next/server';
import { TaskWorkError } from '@/lib/task-work';

/** A refusal from the rules keeps its status (404, 409, 400); anything else is the server's fault. */
export function taskWorkErrorResponse(error: unknown, what: string) {
  if (error instanceof TaskWorkError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
  console.error(`Task work ${what} failed:`, error);
  return NextResponse.json({ success: false, error: `Failed to ${what}` }, { status: 500 });
}
