import { NextRequest, NextResponse } from 'next/server';
import { ActionCardError, decide, getCard, undo } from '@/lib/action-cards/store';
import { cardHandText } from '@/lib/action-cards/hand';
import { handTaskWork, unhandFromCard } from '@/app/api/tasks/work/actions';
import { wakeTaskWorker } from '@/app/api/tasks/work/cron';
import { openTaskRefs } from '@/app/api/tasks/brief/build';
import { TaskWorkError } from '@/lib/task-work';
import { authorized } from '@/app/api/bugs-features/route-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/action-cards/decide
 * { id, verdict: 'agree' | 'dismiss', reason, outcome?, taskId?, taskListType?, snooze? }, or { id, undo: true }.
 * A reason is always required. Undo returns the task to remove when agreeing had made one.
 *
 * Agreeing to a hand-off gives a task to OpenClaw's task worker: the task the caller just made (taskId), or the
 * open task the outcome names. With neither it answers 409 { needsTask: true } and nothing is saved, so the caller
 * makes the task and asks again. Undo takes back a hand-off nothing has come of yet.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ success: false, error: 'A same-origin request is required.' }, { status: 403 });
  try {
    const body = await req.json();
    if (body && typeof body === 'object' && body.undo === true) {
      const undone = undo(String(body.id ?? ''));
      // A task the card made is removed by the caller; a task that was already there only loses the hand-off.
      if (undone.handedTaskId && !undone.removeTask) {
        try { unhandFromCard(undone.handedTaskId, undone.card.id); } catch (e) { console.error('Action card undo: could not take the hand-off back:', e); }
      }
      return NextResponse.json({ success: true, data: undone });
    }
    if (body && typeof body === 'object' && body.verdict === 'agree' && body.outcome === 'hand') {
      const before = getCard(String(body.id ?? ''));
      const outcome = before.outcomes.find((o) => o.kind === 'hand');
      const open = new Set(openTaskRefs().map((r) => r.task.id));
      const made = typeof body.taskId === 'string' && body.taskId ? body.taskId : undefined;
      const target = made ?? (outcome?.taskId && open.has(outcome.taskId) ? outcome.taskId : undefined);
      if (!target || !open.has(target)) {
        return NextResponse.json({ success: false, needsTask: true, error: 'A hand-off needs a task for OpenClaw to work on.' }, { status: 409 });
      }
      const card = decide({ ...body, handedTaskId: target });
      try {
        handTaskWork(target, true, new Date(), { text: cardHandText(before, String(body.reason ?? '')), cardId: card.id });
      } catch (e) {
        // The answer is not kept when OpenClaw was not given the task.
        undo(card.id);
        throw e;
      }
      void wakeTaskWorker();
      return NextResponse.json({ success: true, data: { card } });
    }
    return NextResponse.json({ success: true, data: { card: decide(body) } });
  } catch (e) {
    const status = e instanceof ActionCardError || e instanceof TaskWorkError ? e.status : e instanceof SyntaxError ? 400 : 500;
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Could not save that answer.' }, { status });
  }
}
