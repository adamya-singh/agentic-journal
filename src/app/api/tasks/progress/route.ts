import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { PROGRESS_LINE_MAX, recordProgress } from '@/lib/task-progress';
import { withCliFileLock } from '@/lib/cli-file-lock';
import { getGeneralTasksFilePath, readGeneralTasks, writeGeneralTasks } from '../today/today-store-utils';
import { scheduleBriefFills } from '../brief-agent/worker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OpenClaw records what it did for a task here (an email it sent, a form it submitted, what comes next and who the
// task now waits on). It lands in the task's own notes under "## Progress", so the brief and the workspace show it,
// and the changed notes have the brief filled again. Only the notes change: never the task's text, date or state.

const line = z.string().trim().max(PROGRESS_LINE_MAX);
const BodySchema = z.object({ taskId: z.string().min(1).max(200), did: line.min(1), next: line.optional(), waitingOn: line.optional() });

/** POST /api/tasks/progress { taskId, did, next?, waitingOn? } → { listType, notesMarkdown } */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { taskId, did, next?, waitingOn? }, each one line.' }, { status: 400 });
  const { taskId, did, next, waitingOn } = parsed.data;
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    // OpenClaw's CLI may be rewriting the same list in the same turn: the read and the write share its lock.
    const notesMarkdown = withCliFileLock(getGeneralTasksFilePath(listType), () => {
      const data = readGeneralTasks(listType);
      const task = data.tasks.find((candidate) => candidate.id === taskId);
      if (!task) return null;
      task.notesMarkdown = recordProgress(task.notesMarkdown, { did, next, waitingOn }, new Date());
      writeGeneralTasks(data, listType);
      return task.notesMarkdown;
    });
    if (notesMarkdown === null) continue;
    scheduleBriefFills({ force: taskId });
    return NextResponse.json({ success: true, data: { listType, notesMarkdown } });
  }
  return NextResponse.json({ success: false, error: `No open task has the id ${taskId}.` }, { status: 404 });
}
