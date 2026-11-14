import { NextResponse } from 'next/server';
import { claimTaskWork } from '../actions';
import { taskWorkErrorResponse } from '../errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/tasks/work/claim → { data: null } when there is nothing to do (or OpenClaw's browser is taken), else
 * the task, its brief, the open and answered items, the rules, the compass's For agents text and the lease.
 * One live lease across all tasks; a run claims exactly once.
 */
export async function POST() {
  try {
    return NextResponse.json({ success: true, data: claimTaskWork() });
  } catch (error) {
    return taskWorkErrorResponse(error, 'claim a task');
  }
}
