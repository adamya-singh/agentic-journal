import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import {
  buildChatTurnMessage,
  chatSessionKey,
  settleStalePending,
  CHAT_TURN_TIMEOUT_MS,
  MAX_CHAT_MESSAGE,
  type TaskChatThread,
} from '@/lib/task-chat';
import { loadTaskBrief } from '../brief/build';
import { mutateChatThreads, readChatThread } from './store';

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), taskId: z.string().min(1), text: z.string().trim().min(1).max(MAX_CHAT_MESSAGE) }),
  z.object({ action: z.literal('new'), taskId: z.string().min(1) }),
]);

function view(thread: TaskChatThread | undefined) {
  if (!thread) return null;
  const { sessionKey, messages, pendingSince, error } = thread;
  return { sessionKey, messages, pending: !!pendingSince, error };
}

/**
 * GET /api/tasks/brief-chat?id=<taskId>
 * The chat with OpenClaw about this task, or null before the first message.
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('id');
  if (!taskId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  let thread = readChatThread(taskId);
  if (thread?.pendingSince) {
    thread = mutateChatThreads((threads) => {
      const t = threads[taskId];
      if (t) settleStalePending(t, new Date());
      return t;
    });
  }
  return NextResponse.json({ success: true, data: view(thread) });
}

/**
 * POST /api/tasks/brief-chat
 * { action: 'send', taskId, text }   send a message; OpenClaw's answer lands in the thread (poll GET)
 * { action: 'new', taskId }          start over in a fresh OpenClaw session
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid message' }, { status: 400 });
    const body = parsed.data;
    const now = new Date();

    if (body.action === 'new') {
      // An answer still out for the old thread is dropped when it lands (see answer()).
      mutateChatThreads((threads) => { delete threads[body.taskId]; });
      return NextResponse.json({ success: true, data: null });
    }

    if (!isOpenClawCliAvailable()) {
      return NextResponse.json({ success: false, error: 'OpenClaw isn’t available here.' }, { status: 503 });
    }
    const turn = mutateChatThreads((threads) => {
      const existing = threads[body.taskId];
      if (existing) settleStalePending(existing, now);
      if (existing?.pendingSince) return null;
      const thread: TaskChatThread = existing ?? {
        taskId: body.taskId, sessionKey: chatSessionKey(body.taskId, now), messages: [], pendingSince: null, error: null,
      };
      const first = thread.messages.length === 0;
      thread.messages.push({ role: 'you', text: body.text, at: now.toISOString() });
      thread.pendingSince = now.toISOString();
      thread.error = null;
      threads[body.taskId] = thread;
      return { thread: structuredClone(thread), first };
    });
    if (!turn) return NextResponse.json({ success: false, error: 'OpenClaw is still answering.' }, { status: 409 });

    let brief = null;
    if (turn.first) {
      try { brief = loadTaskBrief(body.taskId); } catch (error) { console.error('brief chat: could not load the brief:', error); }
    }
    void answer(body.taskId, turn.thread.sessionKey, buildChatTurnMessage({ brief, text: body.text, first: turn.first }));
    return NextResponse.json({ success: true, data: view(turn.thread) });
  } catch (error) {
    console.error('Error handling brief-chat request:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Runs the turn after the response is sent; the reply (or the failure) lands in the thread. */
async function answer(taskId: string, sessionKey: string, message: string): Promise<void> {
  let reply: string | null = null;
  let error: string | null = null;
  try {
    reply = await runOpenClawAgentTurn({ message, sessionKey, timeoutMs: CHAT_TURN_TIMEOUT_MS });
  } catch (err) {
    console.error(`brief chat ${taskId}: OpenClaw turn failed:`, err);
    error = 'OpenClaw couldn’t answer. Try again, or continue in OpenClaw.';
  }
  mutateChatThreads((threads) => {
    const t = threads[taskId];
    if (!t || t.sessionKey !== sessionKey) return;   // started over meanwhile
    t.pendingSince = null;
    t.error = error;
    if (reply) t.messages.push({ role: 'openclaw', text: reply, at: new Date().toISOString() });
  });
}
