import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { mutateAgentRecords } from './store';
import { briefAgentDisabled, scheduleBriefFills } from './worker';

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refresh'), taskId: z.string().min(1) }),
  // `fill` is the finishedAt of the fill whose action list the click was made on.
  z.object({ action: z.literal('action-done'), taskId: z.string().min(1), actionId: z.string().min(1), fill: z.string().nullish() }),
]);

/**
 * POST /api/tasks/brief-agent
 * { action: 'refresh', taskId }                 ask OpenClaw to fill this brief again, ahead of the queue
 * { action: 'action-done', taskId, actionId }   a suggested action was carried out; stop offering it
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    const body = parsed.data;

    if (body.action === 'refresh') {
      if (briefAgentDisabled()) return NextResponse.json({ success: false, error: 'Brief fills are turned off here' }, { status: 409 });
      scheduleBriefFills({ force: body.taskId });
      return NextResponse.json({ success: true });
    }

    const found = mutateAgentRecords((records) => {
      const r = records[body.taskId];
      if (!r) return 'missing' as const;
      // Actions are numbered a1, a2… afresh in every fill, so an id from an older fill names a
      // different action now.
      if (body.fill !== undefined && body.fill !== r.finishedAt) return 'refilled' as const;
      if (!r.doneActions.includes(body.actionId)) r.doneActions.push(body.actionId);
      return 'ok' as const;
    });
    if (found === 'refilled') {
      return NextResponse.json({ success: false, error: 'This brief was filled again; its actions have changed.' }, { status: 409 });
    }
    return NextResponse.json({ success: found === 'ok' }, { status: found === 'ok' ? 200 : 404 });
  } catch (error) {
    console.error('Error handling brief-agent request:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
