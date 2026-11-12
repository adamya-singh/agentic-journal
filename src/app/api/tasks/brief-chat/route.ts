import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import {
  buildChatTurnMessage,
  chatSummary,
  chatTitle,
  chatView,
  latestChat,
  listChats,
  markChatSeen,
  newChatThread,
  parseSurfaceRef,
  settleStalePending,
  CHAT_TURN_TIMEOUT_MS,
  MAX_CHAT_MESSAGE,
  type TaskChatThread,
} from '@/lib/task-chat';
import { loadTaskBrief } from '../brief/build';
import { mutateChatThreads, readChatThreads } from './store';

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send'), taskId: z.string().min(1), text: z.string().trim().min(1).max(MAX_CHAT_MESSAGE),
    threadId: z.string().min(1).optional(), fresh: z.boolean().optional(), about: z.unknown().optional(),
  }),
  z.object({ action: z.literal('new'), taskId: z.string().min(1), about: z.unknown().optional() }),
  z.object({ action: z.literal('seen'), taskId: z.string().min(1), threadId: z.string().min(1) }),
]);

/**
 * GET /api/tasks/brief-chat?id=<taskId>
 *   The task's most recent chat with OpenClaw, or null before the first message.
 * GET /api/tasks/brief-chat?id=<taskId>&list=1[&thread=<threadId>]
 *   { threads, thread }: every chat of the task that has something in it, most recent first, each with its title,
 *   last line and state (working, waiting on him, idle); and the one asked for, in full, or null.
 * Reading never marks a chat as seen.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const taskId = params.get('id');
  if (!taskId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  let threads = readChatThreads(taskId);
  if (threads.some((t) => t.pendingSince)) {
    const now = new Date();
    threads = mutateChatThreads((all) => {
      for (const t of all[taskId] ?? []) settleStalePending(t, now);
      return all[taskId] ?? [];
    });
  }
  if (!params.has('list')) {
    const latest = latestChat(threads);
    return NextResponse.json({ success: true, data: latest ? chatView(latest) : null });
  }
  const wanted = params.get('thread');
  const thread = wanted ? threads.find((t) => t.id === wanted) : undefined;
  return NextResponse.json({ success: true, data: { threads: listChats(threads).map(chatSummary), thread: thread ? chatView(thread) : null } });
}

/**
 * POST /api/tasks/brief-chat
 * { action: 'send', taskId, text, threadId?, fresh?, about? }
 *     Send a message; OpenClaw's answer lands in the thread (poll GET). With threadId it goes to that chat; with
 *     fresh it starts a new one; with neither it goes to the task's most recent chat, or starts the first.
 *     `about` is the surface he was on ({ kind: 'work' | 'web', label, url? }); a web page is told to OpenClaw.
 * { action: 'new', taskId, about? }      a new, empty chat in a fresh OpenClaw session; the others are kept
 * { action: 'seen', taskId, threadId }   he has this chat open: it no longer waits on him
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid message' }, { status: 400 });
    const body = parsed.data;
    const now = new Date();

    if (body.action === 'seen') {
      const thread = mutateChatThreads((all) => {
        const t = (all[body.taskId] ?? []).find((candidate) => candidate.id === body.threadId);
        if (t) markChatSeen(t, now);
        return t;
      });
      if (!thread) return NextResponse.json({ success: false, error: 'That chat is gone.' }, { status: 404 });
      return NextResponse.json({ success: true, data: chatView(thread) });
    }

    const about = parseSurfaceRef(body.about);
    if (body.action === 'new') {
      const thread = mutateChatThreads((all) => {
        const list = (all[body.taskId] ??= []);
        // A chat he opened and never wrote in is the new chat: empty ones do not pile up.
        const empty = list.find((t) => t.messages.length === 0 && !t.pendingSince);
        if (empty) { empty.updatedAt = now.toISOString(); empty.about = about; return structuredClone(empty); }
        const made = newChatThread(body.taskId, now, about);
        list.push(made);
        return structuredClone(made);
      });
      return NextResponse.json({ success: true, data: chatView(thread) });
    }

    if (!isOpenClawCliAvailable()) {
      return NextResponse.json({ success: false, error: 'OpenClaw isn’t available here.' }, { status: 503 });
    }
    const turn = mutateChatThreads((all) => {
      const list = (all[body.taskId] ??= []);
      let thread: TaskChatThread | undefined;
      if (body.threadId) {
        thread = list.find((t) => t.id === body.threadId);
        if (!thread) return 'gone' as const;
      } else if (!body.fresh) {
        thread = latestChat(list);
      }
      if (thread) settleStalePending(thread, now);
      if (thread?.pendingSince) return 'busy' as const;
      if (!thread) {
        thread = newChatThread(body.taskId, now, about);
        list.push(thread);
      }
      const first = thread.messages.length === 0;
      if (first) { thread.title = chatTitle(body.text); thread.about = about ?? thread.about; }
      thread.messages.push({ role: 'you', text: body.text, at: now.toISOString(), ...(about ? { about } : {}) });
      thread.pendingSince = now.toISOString();
      thread.updatedAt = now.toISOString();
      thread.seenAt = now.toISOString();
      thread.error = null;
      return { thread: structuredClone(thread), first };
    });
    if (turn === 'gone') return NextResponse.json({ success: false, error: 'That chat is gone.' }, { status: 404 });
    if (turn === 'busy') return NextResponse.json({ success: false, error: 'OpenClaw is still answering.' }, { status: 409 });

    let brief = null;
    if (turn.first) {
      try { brief = loadTaskBrief(body.taskId); } catch (error) { console.error('brief chat: could not load the brief:', error); }
    }
    void answer(body.taskId, turn.thread.id, turn.thread.sessionKey, buildChatTurnMessage({ brief, text: body.text, first: turn.first, about }));
    return NextResponse.json({ success: true, data: chatView(turn.thread) });
  } catch (error) {
    console.error('Error handling brief-chat request:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Runs the turn after the response is sent; the reply (or the failure) lands in the thread. */
async function answer(taskId: string, threadId: string, sessionKey: string, message: string): Promise<void> {
  let reply: string | null = null;
  let error: string | null = null;
  try {
    reply = await runOpenClawAgentTurn({ message, sessionKey, timeoutMs: CHAT_TURN_TIMEOUT_MS });
  } catch (err) {
    console.error(`brief chat ${taskId}: OpenClaw turn failed:`, err);
    error = 'OpenClaw couldn’t answer. Try again, or continue in OpenClaw.';
  }
  mutateChatThreads((all) => {
    const t = (all[taskId] ?? []).find((candidate) => candidate.id === threadId);
    if (!t || t.sessionKey !== sessionKey) return;
    const at = new Date().toISOString();
    t.pendingSince = null;
    t.error = error;
    t.updatedAt = at;
    if (reply) t.messages.push({ role: 'openclaw', text: reply, at });
  });
}
