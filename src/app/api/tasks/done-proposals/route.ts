import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildDonePrompt, buildDoneReplyPrompt, extractJsonObject, validateReply } from '@/lib/done-at';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import { applyDoneAt } from '../done-at/apply';
import {
  failTurn,
  mutateProposals,
  newProposal,
  OPEN_STATUSES,
  readOpenProposals,
  receiveReply,
  sendMessage,
  type DoneProposalRecord,
} from './store';

const text = z.string().trim().min(1).max(1000);
const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    taskId: z.string().min(1),
    listType: z.enum(['have-to-do', 'want-to-do']),
    short: z.string().min(1),
    title: z.string().min(1),
    due: z.string().nullable(),
    dueIsImplied: z.boolean().default(false),
    text,
  }),
  z.object({ action: z.literal('reply'), id: z.string().min(1), text }),
  z.object({ action: z.literal('retry'), id: z.string().min(1) }),
  z.object({ action: z.literal('accept'), id: z.string().min(1) }),
  z.object({ action: z.literal('decline'), id: z.string().min(1) }),
]);

function updateRecord(id: string, fn: (record: DoneProposalRecord) => DoneProposalRecord): DoneProposalRecord | null {
  return mutateProposals((records) => {
    const index = records.findIndex((r) => r.id === id);
    if (index < 0) return null;
    records[index] = fn(records[index]);
    return records[index];
  });
}

/** Asks OpenClaw for this turn and stores its answer. Runs after the response is sent. */
async function runTurn(record: DoneProposalRecord): Promise<void> {
  const turn = record.turn;
  const lastText = record.messages.filter((m) => m.role === 'you').at(-1)?.text ?? '';
  const now = new Date();
  // The first turn carries the task context; later turns continue the same OpenClaw session.
  const message = record.messages.some((m) => m.role === 'openclaw')
    ? buildDoneReplyPrompt({ now, text: lastText })
    : buildDonePrompt({
        title: record.title,
        due: record.due ? new Date(record.due) : null,
        dueIsImplied: record.dueIsImplied,
        now,
        text: record.messages.filter((m) => m.role === 'you').map((m) => m.text).join(' / '),
      });
  try {
    if (!isOpenClawCliAvailable()) throw new Error('OpenClaw CLI not found');
    const replyText = await runOpenClawAgentTurn({ message, sessionKey: record.sessionKey });
    const checked = validateReply(extractJsonObject(replyText), { now: new Date() });
    if (!checked.ok) {
      console.warn(`done-proposal ${record.id}: unusable OpenClaw reply (${checked.error}):`, replyText.slice(0, 500));
      updateRecord(record.id, (r) => failTurn(r, turn, 'OpenClaw couldn’t read that.', new Date()));
      return;
    }
    updateRecord(record.id, (r) => receiveReply(r, turn, checked.reply, new Date()));
  } catch (error) {
    console.error(`done-proposal ${record.id}: OpenClaw turn failed:`, error);
    updateRecord(record.id, (r) => failTurn(r, turn, 'OpenClaw couldn’t be reached.', new Date()));
  }
}

/**
 * GET /api/tasks/done-proposals
 * Open proposals (thinking, proposed, needs-more, failed), oldest first.
 */
export async function GET() {
  try {
    return NextResponse.json({ success: true, records: readOpenProposals() });
  } catch (error) {
    console.error('Error reading done proposals:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/done-proposals
 * { action: 'create', taskId, listType, short, title, due, dueIsImplied, text }  ask OpenClaw when it was done
 * { action: 'reply', id, text }   add more; OpenClaw revises in the same session
 * { action: 'retry', id }         rerun a failed turn
 * { action: 'accept', id }        complete the task at the proposed time; returns a done-at receipt
 * { action: 'decline', id }       drop the proposal; the task is untouched
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }
    const body = parsed.data;
    const now = new Date();

    if (body.action === 'create') {
      const record = newProposal({ id: crypto.randomUUID(), ...body, now });
      mutateProposals((records) => {
        // One conversation per task: starting over closes the previous one.
        for (const r of records) {
          if (r.taskId === body.taskId && OPEN_STATUSES.includes(r.status)) {
            Object.assign(r, { status: 'declined', updatedAt: now.toISOString() });
          }
        }
        records.push(record);
      });
      after(() => runTurn(record));
      return NextResponse.json({ success: true, record });
    }

    const existing = readOpenProposals().find((r) => r.id === body.id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'That proposal is no longer open' }, { status: 404 });
    }

    if (body.action === 'reply' || body.action === 'retry') {
      if (existing.status === 'thinking') {
        return NextResponse.json({ success: false, error: 'OpenClaw is still answering' }, { status: 409 });
      }
      const record = body.action === 'reply'
        ? updateRecord(body.id, (r) => sendMessage(r, body.text, now))
        : updateRecord(body.id, (r) => ({ ...r, status: 'thinking', error: null, turn: r.turn + 1, updatedAt: now.toISOString() }));
      if (record) after(() => runTurn(record));
      return NextResponse.json({ success: true, record });
    }

    if (body.action === 'decline') {
      updateRecord(body.id, (r) => ({ ...r, status: 'declined', updatedAt: now.toISOString() }));
      return NextResponse.json({ success: true });
    }

    // accept
    if (existing.status !== 'proposed' || !existing.proposal) {
      return NextResponse.json({ success: false, error: 'There is no proposal to accept yet' }, { status: 409 });
    }
    const result = applyDoneAt({
      taskId: existing.taskId,
      listType: existing.listType,
      completedAt: new Date(existing.proposal.completedAt),
      rangeStart: existing.proposal.rangeStart ? new Date(existing.proposal.rangeStart) : null,
    });
    if (result.status !== 'done') {
      const error = result.status === 'blocked'
        ? 'Finish its subtasks first'
        : result.status === 'not-found' ? 'That task is no longer on your lists' : 'That task is already done';
      return NextResponse.json({ success: false, error }, { status: 409 });
    }
    updateRecord(body.id, (r) => ({ ...r, status: 'accepted', receipt: result.receipt, updatedAt: now.toISOString() }));
    return NextResponse.json({ success: true, receipt: result.receipt });
  } catch (error) {
    console.error('Error handling done proposal:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
