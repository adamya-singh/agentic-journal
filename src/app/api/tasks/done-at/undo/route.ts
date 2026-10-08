import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { undoDoneAt } from '../apply';

const ReceiptSchema = z.object({
  taskId: z.string().min(1),
  listType: z.enum(['have-to-do', 'want-to-do']),
  completedAt: z.string(),
  journalEntryId: z.string().min(1),
  slot: z.union([
    z.object({ kind: z.literal('hour'), date: z.string(), hour: z.string() }),
    z.object({ kind: z.literal('range'), date: z.string(), start: z.string(), end: z.string() }),
  ]),
});

/**
 * POST /api/tasks/done-at/undo
 * Body: the receipt returned by /api/tasks/done-at (or by accepting a proposal).
 * Un-completes the task and removes the journal entry it logged.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = ReceiptSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'A done receipt is required' }, { status: 400 });
    }
    const result = undoDoneAt(parsed.data);
    return NextResponse.json({ success: result.status === 'undone', status: result.status });
  } catch (error) {
    console.error('Error undoing done-at:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
