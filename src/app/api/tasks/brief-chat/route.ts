import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { listOpenClawModels, runOpenClawAgentTurn, setOpenClawSessionModel } from '@/lib/openclaw-agent';
import { hasModel, isModelKey } from '@/lib/openclaw-models';
import {
  buildChatTurnMessage,
  chatSummary,
  chatTitle,
  chatView,
  latestChat,
  listChats,
  markChatSeen,
  markChatUnread,
  newChatThread,
  parseSurfaceRef,
  recordChatReply,
  settleStalePending,
  CHAT_TURN_TIMEOUT_MS,
  MAX_CHAT_MESSAGE,
  type TaskChatThread,
} from '@/lib/task-chat';
import { workspaceBrief, workspaceSignature } from '@/lib/task-workspace';
import { loadTaskBrief } from '../brief/build';
import { loadWorkspace } from '../workspace/load';
import { readTaskModel, setTaskModel } from './models';
import { mutateChatThreads, readChatThreads, settleStaleChatTurns } from './store';
import { chatSyncFailed, syncChatThread, syncChatThreadsSoon } from './sync';

// How often an open thread is brought up to date with its OpenClaw session, and how long Dawn's chat waits for that.
const OPEN_THREAD_SYNC_MS = 4000;
const DAWN_SYNC_WAIT_MS = 2500;
/** A thread as the page gets it; `outside` says its session's history could not be read just now. */
const viewOf = (thread: TaskChatThread) => ({ ...chatView(thread), ...(chatSyncFailed(thread.sessionKey) ? { outside: 'unreachable' as const } : {}) });

const BodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('send'), taskId: z.string().min(1), text: z.string().trim().min(1).max(MAX_CHAT_MESSAGE),
    threadId: z.string().min(1).optional(), fresh: z.boolean().optional(), about: z.unknown().optional(),
  }),
  z.object({ action: z.literal('new'), taskId: z.string().min(1), about: z.unknown().optional() }),
  z.object({ action: z.literal('seen'), taskId: z.string().min(1), threadId: z.string().min(1) }),
  z.object({ action: z.literal('unread'), taskId: z.string().min(1), threadId: z.string().min(1) }),
  z.object({ action: z.literal('model'), taskId: z.string().min(1), model: z.string().max(120).nullable(), threadId: z.string().min(1).optional() }),
]);

/**
 * Puts the model picked for the task on one chat's OpenClaw session, when it is not the one already there, so
 * the chat runs on it wherever it is continued and OpenClaw's own app shows it picked. If OpenClaw does not take
 * it, the chat keeps what it had and the next turn tries again.
 */
async function pickSessionModel(taskId: string, threadId: string, sessionKey: string, wanted: string | null): Promise<void> {
  const thread = readChatThreads(taskId).find((t) => t.id === threadId);
  if (!thread || thread.sessionKey !== sessionKey || (thread.modelSet ?? null) === wanted) return;
  if (!(await setOpenClawSessionModel(sessionKey, wanted))) return;
  mutateChatThreads((all) => {
    const t = (all[taskId] ?? []).find((candidate) => candidate.id === threadId);
    if (!t || t.sessionKey !== sessionKey) return;
    if (wanted) t.modelSet = wanted;
    else delete t.modelSet;
  });
}

/**
 * GET /api/tasks/brief-chat?id=<taskId>
 *   The task's most recent chat with OpenClaw, or null before the first message.
 * GET /api/tasks/brief-chat?id=<taskId>&list=1[&thread=<threadId>]
 *   { threads, thread, model }: every chat of the task that has something in it, most recent first, each with its
 *   title, last line and state (working, waiting on him, idle); the one asked for, in full, or null; and the
 *   OpenClaw model picked for the task's chats, or null for OpenClaw's default.
 * Reading never marks a chat as seen.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const taskId = params.get('id');
  if (!taskId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  settleStaleChatTurns(new Date(), taskId);
  const threads = readChatThreads(taskId);
  if (!params.has('list')) {
    // Dawn's chat reads once when it opens: give the session's history a moment to arrive, then answer either way.
    let latest = latestChat(threads);
    if (latest && latest.messages.length > 0) {
      const synced = syncChatThread(latest, OPEN_THREAD_SYNC_MS);
      const changed = await Promise.race([synced, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), DAWN_SYNC_WAIT_MS))]);
      if (changed) latest = latestChat(readChatThreads(taskId));
    }
    return NextResponse.json({ success: true, data: latest ? viewOf(latest) : null });
  }
  const wanted = params.get('thread');
  const thread = wanted ? threads.find((t) => t.id === wanted) : undefined;
  // What was said in these sessions outside the Journal is fetched behind this answer; the next read has it.
  if (thread) void syncChatThread(thread, OPEN_THREAD_SYNC_MS);
  syncChatThreadsSoon(threads);
  return NextResponse.json({ success: true, data: { threads: listChats(threads).map((t) => chatSummary(t)), thread: thread ? viewOf(thread) : null, model: readTaskModel(taskId) } });
}

/**
 * POST /api/tasks/brief-chat
 * { action: 'send', taskId, text, threadId?, fresh?, about? }
 *     Send a message; OpenClaw's answer lands in the thread (poll GET). With threadId it goes to that chat; with
 *     fresh it starts a new one; with neither it goes to the task's most recent chat, or starts the first.
 *     `about` is the surface he was on ({ kind: 'work' | 'web', label, url? }). OpenClaw is told of the task's
 *     workspace with the turn: how it works the first time, how it stands whenever it changed, and the tab he is on.
 * { action: 'new', taskId, about? }      a new, empty chat in a fresh OpenClaw session; the others are kept
 * { action: 'seen', taskId, threadId }   he has this chat open: it no longer waits on him
 * { action: 'unread', taskId, threadId } he marks it unread: it waits on him again until he opens it
 * { action: 'model', taskId, model, threadId? }
 *     Pick the OpenClaw model for this task's chats ("provider/model", one of GET /api/openclaw/models), or null
 *     for OpenClaw's default. Every later message from the task's workspace runs on it. With threadId, that
 *     chat's OpenClaw session is given the pick straight away. → { model }
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid message' }, { status: 400 });
    const body = parsed.data;
    const now = new Date();

    if (body.action === 'seen' || body.action === 'unread') {
      const thread = mutateChatThreads((all) => {
        const t = (all[body.taskId] ?? []).find((candidate) => candidate.id === body.threadId);
        if (t && body.action === 'seen') markChatSeen(t, now);
        else if (t) markChatUnread(t);
        return t;
      });
      if (!thread) return NextResponse.json({ success: false, error: 'That chat is gone.' }, { status: 404 });
      return NextResponse.json({ success: true, data: chatView(thread) });
    }

    if (body.action === 'model') {
      if (body.model !== null) {
        if (!isModelKey(body.model)) return NextResponse.json({ success: false, error: 'That is not a model.' }, { status: 400 });
        const list = await listOpenClawModels();
        if (!list) return NextResponse.json({ success: false, error: 'OpenClaw’s models could not be read. Try again in a moment.' }, { status: 503 });
        if (!hasModel(list, body.model)) return NextResponse.json({ success: false, error: 'OpenClaw is not set up with that model.' }, { status: 400 });
      }
      setTaskModel(body.taskId, body.model);
      // The chat he has open is given the pick now, so "Continue in OpenClaw" finds it there. A chat with a turn
      // out is left alone: its next turn brings the pick.
      const open = body.threadId ? readChatThreads(body.taskId).find((t) => t.id === body.threadId) : undefined;
      if (open && open.messages.length > 0 && !open.pendingSince) void pickSessionModel(body.taskId, open.id, open.sessionKey, body.model);
      return NextResponse.json({ success: true, data: { model: body.model } });
    }

    const about = parseSurfaceRef(body.about);
    if (body.action === 'new') {
      const thread = mutateChatThreads((all) => {
        const list = (all[body.taskId] ??= []);
        // A chat he opened and never wrote in is the new chat: empty ones do not pile up.
        const empty = list.find((t) => t.messages.length === 0 && !t.pendingSince);
        if (empty) { empty.updatedAt = empty.touchedAt = now.toISOString(); empty.about = about; return structuredClone(empty); }
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
      delete thread.unread;
      thread.touchedAt = now.toISOString();
      thread.error = null;
      return { thread: structuredClone(thread), first };
    });
    if (turn === 'gone') return NextResponse.json({ success: false, error: 'That chat is gone.' }, { status: 404 });
    if (turn === 'busy') return NextResponse.json({ success: false, error: 'OpenClaw is still answering.' }, { status: 409 });

    let brief = null;
    if (turn.first) {
      try { brief = loadTaskBrief(body.taskId); } catch (error) { console.error('brief chat: could not load the brief:', error); }
    }
    // The workspace as it stands goes with the turn: in full the first time this chat hears of it (a chat begun
    // before chats knew the workspace is told on its next turn), and again whenever it changed since.
    let workspace: string | null = null;
    try {
      const loaded = loadWorkspace(body.taskId);
      if (loaded) {
        const told = turn.thread.workSeen;
        workspace = workspaceBrief(loaded.view, told === undefined ? 'rules' : told !== workspaceSignature(loaded.view) ? 'state' : 'where', about);
      }
    } catch (error) { console.error('brief chat: could not load the workspace:', error); }
    void answer(body.taskId, turn.thread.id, turn.thread.sessionKey, turn.thread.pendingSince, buildChatTurnMessage({ brief, text: body.text, first: turn.first, about, workspace }), workspace !== null);
    return NextResponse.json({ success: true, data: chatView(turn.thread) });
  } catch (error) {
    console.error('Error handling brief-chat request:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/** Runs the turn after the response is sent; the reply (or the failure) lands in the thread. */
async function answer(taskId: string, threadId: string, sessionKey: string, sentAt: string | null, message: string, toldWorkspace = false): Promise<void> {
  let reply: string | null = null;
  let error: string | null = null;
  try {
    // The model he picked for this task's chats: on the session (so it holds wherever the chat goes on) and on
    // the turn itself (so it holds even if the session could not be told).
    const model = readTaskModel(taskId);
    await pickSessionModel(taskId, threadId, sessionKey, model);
    reply = await runOpenClawAgentTurn({ message, sessionKey, timeoutMs: CHAT_TURN_TIMEOUT_MS, ...(model ? { model } : {}) });
  } catch (err) {
    console.error(`brief chat ${taskId}: OpenClaw turn failed:`, err);
    error = 'OpenClaw couldn’t answer. Try again, or continue in OpenClaw.';
  }
  // What the workspace holds now that the turn is over is what this chat knows: its own changes are not news to it.
  let workSeen: string | null = null;
  if (toldWorkspace && !error) {
    try { const loaded = loadWorkspace(taskId); if (loaded) workSeen = workspaceSignature(loaded.view); } catch { /* it is told again next turn */ }
  }
  mutateChatThreads((all) => {
    const t = (all[taskId] ?? []).find((candidate) => candidate.id === threadId);
    if (!t || t.sessionKey !== sessionKey) return;
    const at = new Date().toISOString();
    if (workSeen) t.workSeen = workSeen;
    // `pendingSince` names the turn that is out. If it is no longer this one, the turn was given
    // up on or a newer one is out: its answer is still recorded, but it settles nothing.
    if (t.pendingSince === sentAt) {
      t.pendingSince = null;
      t.error = error;
    } else if (reply && !t.pendingSince) {
      t.error = null;
    }
    t.updatedAt = at;
    if (reply) recordChatReply(t, reply, at);
  });
  // The turn has settled: pick up anything said in the session meanwhile, from the Journal or not.
  void syncChatThread({ taskId, id: threadId, sessionKey }, 0);
}
