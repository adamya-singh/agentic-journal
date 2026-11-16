import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { MERGE_NOTE_MAX } from '@/lib/task-merge';
import { MergeError, mergeTasks, undoMerge } from './merge';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.union([
  z.object({ action: z.literal('undo'), mergeId: z.string().min(1).max(40) }),
  z.object({ fromId: z.string().min(1).max(200), intoId: z.string().min(1).max(200), note: z.string().max(MERGE_NOTE_MAX).optional() }),
]);

/**
 * POST /api/tasks/merge
 * { fromId, intoId, note? }
 *     Folds the task `fromId` into the task `intoId` (he dragged the one onto the other in Sunrise and said yes).
 *     The task that stays gets the other's notes, work blocks, chats with OpenClaw, web tabs and what OpenClaw was
 *     waiting on him for; the other leaves his lists (kept with what was let go). OpenClaw is then asked, with his
 *     note, to make one task of the two, and answers in a new chat of the merged task.
 *     → { mergeId, intoId, combining }   (combining: OpenClaw was asked)
 * { action: 'undo', mergeId }
 *     Takes that merge back, within half an hour of it. → { fromId, intoId }
 */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { fromId, intoId, note? } or { action: "undo", mergeId }.' }, { status: 400 });
  const body = parsed.data;
  try {
    if ('action' in body) {
      const record = await undoMerge(body.mergeId);
      return NextResponse.json({ success: true, data: { fromId: record.fromId, intoId: record.intoId } });
    }
    const { record, combining } = await mergeTasks(body.fromId, body.intoId, (body.note ?? '').trim());
    return NextResponse.json({ success: true, data: { mergeId: record.id, intoId: record.intoId, combining } });
  } catch (error) {
    if (error instanceof MergeError) return NextResponse.json({ success: false, error: error.message }, { status: error.status });
    console.error('task merge failed:', error);
    return NextResponse.json({ success: false, error: 'The tasks could not be merged.' }, { status: 500 });
  }
}
