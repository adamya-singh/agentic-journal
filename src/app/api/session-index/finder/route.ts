import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { extractJsonObject } from '@/lib/done-at';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { knownHosts, machineName } from '@/lib/proj-hosts';
import { fromThisApp, fromThisAppStrict, journalSelfOrigin } from '@/lib/same-origin';
import { indexedSession } from '@/lib/session-index/find';
import { indexExists } from '@/lib/session-index/store';
import { indexStatus, sessionsFor, toRow } from '@/lib/session-index/view';
import {
  buildFinderTurn, finderAnswer, finderError, newFinderChat, startFinderTurn,
  FINDER_TEXT_MAX, FINDER_TURN_TIMEOUT_MS, type FinderChat, type FinderContext, type FinderView,
} from '@/lib/session-finder';
import { loadTaskBrief } from '../../tasks/brief/build';
import { mutateFinderChats, readFinderChat } from './store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// "Ask OpenClaw" in a task's "+ Link a session" panel (lib/session-finder.ts has the whole story). Sending runs one
// OpenClaw turn behind the answer; the page polls GET for it. OpenClaw only searches; every session it names is
// checked against the index before it is shown, and linking stays his click (POST /api/session-index/feedback).

const TASK_ID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send'), taskId: TASK_ID, text: z.string().trim().min(1).max(FINDER_TEXT_MAX) }).strict(),
  z.object({ action: z.literal('retry'), taskId: TASK_ID }).strict(),
  z.object({ action: z.literal('reset'), taskId: TASK_ID }).strict(),
]);

const ok = (data: unknown) => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
const fail = (status: number, error: string, data?: unknown) => NextResponse.json({ success: false, error, ...(data ? { data } : {}) }, { status, headers: { 'Cache-Control': 'no-store' } });

/** The devices with nothing in the index yet, in the Journal's words. */
function missingDevices(hosts: { host: string }[]): string[] {
  const sent = new Set(hosts.map((h) => h.host));
  return knownHosts().filter((h) => !sent.has(h)).map(machineName);
}

/** The chat as the panel shows it: OpenClaw's picks as session rows, each one the index still holds. */
function viewOf(chat: FinderChat | null): FinderView {
  const status = indexStatus();
  const now = Date.now();
  return {
    messages: (chat?.messages ?? []).map((m) => {
      const sessions = (m.picks ?? []).flatMap((p) => { const s = indexedSession(p.uid); return s ? [toRow(s, 'matched', p.why, now)] : []; });
      return { role: m.role, text: m.text, at: m.at, ...(m.picks ? { sessions } : {}), ...(m.invented ? { invented: m.invented } : {}), ...(m.loose ? { loose: true as const } : {}) };
    }),
    pending: !!chat?.pendingSince, pendingSince: chat?.pendingSince ?? null, error: chat?.error ?? null,
    openclaw: isOpenClawCliAvailable(), indexed: status.indexed, missing: missingDevices(status.hosts),
  };
}

function contextFor(taskId: string, origin: string, now: Date): FinderContext {
  let brief = null;
  try { brief = loadTaskBrief(taskId, now); } catch (error) { console.error('session finder: could not load the brief:', error); }
  const status = indexStatus();
  let linked: string[] = [];
  try { linked = sessionsFor(`task:${taskId}`).rows.map((r) => r.title).slice(0, 12); } catch { /* none known */ }
  return {
    task: {
      title: brief?.title ?? 'a task the Journal could not load',
      ...(brief ? { kind: brief.course ? `${brief.kind} · ${brief.course.name}` : `${brief.kind} · ${brief.group}`, due: brief.when.day } : {}),
      ...(brief?.notesMarkdown ? { notes: brief.notesMarkdown } : {}),
    },
    origin, indexed: status.indexed, devices: status.hosts.map((h) => ({ machine: h.machine, lastSync: h.lastSync })), missing: missingDevices(status.hosts), linked, now,
  };
}

/** GET /api/session-index/finder?taskId=<id>: the task's "Ask OpenClaw" chat, with its picks as session rows. */
export async function GET(request: NextRequest) {
  if (!fromThisApp(request.headers)) return fail(403, 'Only the Journal’s own pages may read this.');
  const taskId = TASK_ID.safeParse(request.nextUrl.searchParams.get('taskId'));
  if (!taskId.success) return fail(400, 'taskId must be a task id.');
  try {
    return ok(viewOf(readFinderChat(taskId.data)));
  } catch (error) {
    console.error('session finder: read failed:', error);
    return fail(500, 'The chat could not be read.');
  }
}

/**
 * POST /api/session-index/finder
 * { action: 'send', taskId, text }   ask OpenClaw (a turn runs behind the answer; poll GET)
 * { action: 'retry', taskId }        send his last message again, after a failed turn
 * { action: 'reset', taskId }        start over in a new OpenClaw session
 * → the chat as GET gives it.
 */
export async function POST(request: NextRequest) {
  if (!fromThisAppStrict(request.headers)) return fail(403, 'Only the Journal’s own pages may ask OpenClaw from here.');
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, 'Send { action: send, taskId, text } or { action: retry | reset, taskId }.');
  const body = parsed.data;
  const now = new Date();
  try {
    if (body.action === 'reset') {
      const chat = mutateFinderChats((chats) => {
        if (chats[body.taskId]?.pendingSince) return 'busy' as const;
        delete chats[body.taskId];
        return null;
      });
      if (chat === 'busy') return fail(409, 'OpenClaw is still looking. Start over when it has answered.', viewOf(readFinderChat(body.taskId)));
      return ok(viewOf(null));
    }
    if (!isOpenClawCliAvailable()) return fail(503, 'OpenClaw isn’t available on this server.', viewOf(readFinderChat(body.taskId)));
    if (!indexExists() || indexStatus().indexed === 0) return fail(409, 'Nothing is indexed yet, so there is nothing for OpenClaw to search.', viewOf(readFinderChat(body.taskId)));
    readFinderChat(body.taskId, now);   // a turn cut off by a restart is settled first
    const turn = mutateFinderChats((chats) => {
      const chat = (chats[body.taskId] ??= newFinderChat(body.taskId, now));
      if (chat.pendingSince) return 'busy' as const;
      const started = startFinderTurn(chat, body.action === 'send' ? body.text : null, now);
      if (!started) return 'nothing' as const;
      // Until OpenClaw has answered once, the turn is the first: it carries everything he has said so far.
      const text = started.first ? chat.messages.filter((m) => m.role === 'you').map((m) => m.text).join('\n\n') : started.text;
      return { sessionKey: chat.sessionKey, sentAt: chat.pendingSince!, first: started.first, text };
    });
    if (turn === 'busy') return fail(409, 'OpenClaw is still looking.', viewOf(readFinderChat(body.taskId)));
    if (turn === 'nothing') return fail(400, 'There is nothing to send again.', viewOf(readFinderChat(body.taskId)));
    const message = buildFinderTurn({ first: turn.first, text: turn.text, context: contextFor(body.taskId, journalSelfOrigin(request.headers.get('host')), now) });
    void answer(body.taskId, turn.sessionKey, turn.sentAt, message);
    return ok(viewOf(readFinderChat(body.taskId)));
  } catch (error) {
    console.error('session finder: send failed:', error);
    return fail(500, 'That could not be sent.');
  }
}

/** The turn, after the response is sent: the answer (checked) or the failure lands in the chat. */
async function answer(taskId: string, sessionKey: string, sentAt: string, message: string): Promise<void> {
  let reply: string | null = null;
  let error: FinderChat['error'] = null;
  try {
    reply = await runOpenClawAgentTurn({ message, sessionKey, timeoutMs: FINDER_TURN_TIMEOUT_MS });
  } catch (err) {
    // Not the whole error: its command line carries the prompt.
    const said = err instanceof Error ? `${(err as { stderr?: unknown }).stderr ?? ''}`.trim() || err.message.split('\n')[0]!.slice(0, 200) : String(err);
    console.error(`session finder ${taskId}: OpenClaw turn failed:`, said.slice(-400));
    error = finderError(err);
  }
  const at = new Date().toISOString();
  const said = reply ? finderAnswer(reply, extractJsonObject, (uid) => !!indexedSession(uid), at) : null;
  mutateFinderChats((chats) => {
    const chat = chats[taskId];
    // Started over meanwhile (a new session), or the turn was given up on: its answer has nowhere to go.
    if (!chat || chat.sessionKey !== sessionKey || chat.pendingSince !== sentAt) return;
    chat.pendingSince = null;
    chat.error = error;
    if (said) chat.messages.push(said);
  });
}
