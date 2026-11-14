import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PROGRESS_LINE_MAX } from '@/lib/task-progress';
import { recordTaskProgress } from './record';
import { noteChatProgress } from '../work/actions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OpenClaw records what it did for a task here (an email it sent, a form it submitted, what comes next and who the
// task now waits on). It lands in the task's own notes under "## Progress", so the brief and the workspace show it,
// and the changed notes have the brief filled again. Only the notes change: never the task's text, date or state.
// A "Waiting on" also has the task worker watch for the reply (an empty one stops that).

const line = z.string().trim().max(PROGRESS_LINE_MAX);
const BodySchema = z.object({ taskId: z.string().min(1).max(200), did: line.min(1), next: line.optional(), waitingOn: line.optional() });

/** POST /api/tasks/progress { taskId, did, next?, waitingOn? } → { listType, notesMarkdown } */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { taskId, did, next?, waitingOn? }, each one line.' }, { status: 400 });
  const { taskId, did, next, waitingOn } = parsed.data;
  const written = recordTaskProgress(taskId, { did, next, waitingOn });
  if (!written) return NextResponse.json({ success: false, error: `No open task has the id ${taskId}.` }, { status: 404 });
  try {
    noteChatProgress(taskId, waitingOn);
  } catch (error) {
    // The notes are written; a watch that could not be set must not turn that into an error.
    console.error('Task work: progress could not set waiting:', error);
  }
  return NextResponse.json({ success: true, data: written });
}
