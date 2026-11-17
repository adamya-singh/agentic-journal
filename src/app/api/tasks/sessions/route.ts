import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  adoptSession, agentLogin, agentModels, agentOwnSettings, agentStatus, answerApproval, archiveSession, cancelLogin, HubError, interruptSession, markSessionSeen,
  nativeSessions, refreshTask, renameSession, sendLoginCode, sendToSession, sessionDetail, sessionSummaries, setSessionPicks, startLogin, startSession, steerSession,
} from '@/lib/code-agents/hub';
import { defaultPlace, placesFor, thisHost, validatePlace } from '@/lib/code-agents/places';
import {
  AGENT_KINDS, APPROVAL_DECISIONS, DEFAULT_PICKS, PERMISSION_MODES,
  type AgentKind, type AgentStatus, type ModelEntry, type OwnSettings, type SessionPicks,
} from '@/lib/code-agents/protocol';
import { readCodeSessions, readTaskPlace, setTaskPlace } from '@/lib/code-agents/store';
import { fromThisAppStrict } from '@/lib/same-origin';
import { loadTaskBrief } from '../brief/build';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Coding-agent sessions (Codex now, Claude Code next) started from a task's workspace or attached to it. The Journal
// keeps only the link (lib/code-agents/store.ts); the session itself runs in the agent's own server, through the hub
// (lib/code-agents/hub.ts), so it is a real session the agent's apps list too. Live events come from
// ./stream. Only this app's own pages may reach these routes, since they run code on his machine.
// docs/code-sessions-design.md has the whole contract.

const STATUS_WAIT_MS = 4000;
const TEXT_MAX = 20_000;

const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
const ok = (data: unknown) => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
const refused = () => fail(403, 'Only the Journal’s own pages may reach coding sessions.');

const taskId = z.string().min(1).max(200);
const session = z.string().min(1).max(80);
const agent = z.enum(AGENT_KINDS as [AgentKind, ...AgentKind[]]);
const text = z.string().trim().min(1).max(TEXT_MAX);
const PicksSchema = z.object({
  model: z.string().trim().min(1).max(120).nullable(),
  effort: z.string().trim().min(1).max(40).nullable(),
  mode: z.enum(PERMISSION_MODES as [string, ...string[]]),
}) as z.ZodType<SessionPicks>;
const PlaceSchema = z.object({ host: z.string().min(1).max(40), cwd: z.string().min(1).max(1000) });
/** Sent only when he confirmed "Full access" in the pane. A request that moves a session into it without this fails. */
const confirmFull = z.literal(true).optional();
const host = z.string().min(1).max(40).optional();
const loginId = z.string().min(1).max(200);
/** The code the sign-in page shows him, pasted. Never logged, stored or sent back. */
const loginCode = z.string().trim().min(1).max(2000);

const BodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start'), taskId, agent, text, place: PlaceSchema.optional(), picks: PicksSchema.optional(), confirmFull }),
  z.object({ action: z.literal('send'), taskId, session, text, picks: PicksSchema.optional(), confirmFull }),
  z.object({ action: z.literal('steer'), taskId, session, text }),
  z.object({ action: z.literal('interrupt'), taskId, session }),
  z.object({ action: z.literal('approve'), taskId, session, approvalId: z.string().min(1).max(80), decision: z.enum(APPROVAL_DECISIONS as [string, ...string[]]) }),
  z.object({ action: z.literal('adopt'), taskId, agent, sessionId: z.string().min(1).max(200), host: z.string().min(1).max(40).optional(), picks: PicksSchema.optional(), confirmFull }),
  z.object({ action: z.literal('rename'), taskId, session, title: z.string().trim().min(1).max(120) }),
  z.object({ action: z.literal('archive'), taskId, session }),
  z.object({ action: z.literal('picks'), taskId, session, picks: PicksSchema, confirmFull }),
  z.object({ action: z.literal('seen'), taskId, session }),
  z.object({ action: z.literal('place'), taskId, place: PlaceSchema }),
  z.object({ action: z.literal('login'), taskId, agent, host }),
  z.object({ action: z.literal('login-code'), taskId, agent, host, loginId, code: loginCode }),
  z.object({ action: z.literal('login-cancel'), taskId, agent, host, loginId }),
]);

/** Signing in works on this device only for now (Stage 4 adds the others). */
const loginHostRefused = (wanted: string | null | undefined) => (wanted && wanted !== thisHost() ? `Signing in on ${wanted} is not available yet.` : null);

/** Each agent's status, without waiting long on one that does not answer. */
async function statuses(host: string): Promise<Record<AgentKind, AgentStatus>> {
  const one = (kind: AgentKind) => Promise.race([
    agentStatus(kind, host).catch((error): AgentStatus => ({ agent: kind, host, state: 'offline', reason: error instanceof Error ? error.message : String(error) })),
    new Promise<AgentStatus>((resolve) => setTimeout(() => resolve({ agent: kind, host, state: 'offline', reason: 'It did not answer in time.' }), STATUS_WAIT_MS)),
  ]);
  const list = await Promise.all(AGENT_KINDS.map(one));
  return Object.fromEntries(list.map((s) => [s.agent, s])) as Record<AgentKind, AgentStatus>;
}

/** A model and effort the agent offers, or why not. Null model and effort (the agent's default) always do. */
async function checkPicks(kind: AgentKind, host: string, picks: SessionPicks): Promise<string | null> {
  if (picks.model === null && picks.effort === null) return null;
  let list: ModelEntry[];
  try { list = await agentModels(kind, host); } catch { return 'The agent’s models could not be read. Try again in a moment.'; }
  const model = picks.model === null ? list.find((m) => m.isDefault) : list.find((m) => m.id === picks.model);
  if (picks.model !== null && !model) return 'The agent does not offer that model.';
  if (picks.effort !== null && model && model.efforts.length > 0 && !model.efforts.includes(picks.effort)) return 'This model cannot think at that effort.';
  return null;
}

const FULL_UNCONFIRMED = 'Full access lets the agent do anything on this machine without asking. Confirm it in the pane first.';

/** Full access is refused unless he confirmed it, when it is new: a session starting in it, or moving into it. */
const fullRefused = (picks: SessionPicks | undefined, confirmed: boolean | undefined, had: SessionPicks | null) =>
  picks?.mode === 'full' && !confirmed && had?.mode !== 'full';

const linkOf = (task: string, id: string) => readCodeSessions(task).find((l) => l.id === id) ?? null;

/**
 * GET /api/tasks/sessions?id=<taskId>
 *   { sessions, place, places }: the task's sessions (most recent first, each with its live state, unread and
 *   approvals waiting), where its sessions run, and every place on offer. It does not wait on the agents.
 * GET /api/tasks/sessions?id=<taskId>&agents
 *   { agents }: each agent's status (each waits at most 4 s).
 * GET /api/tasks/sessions?id=<taskId>&session=<linkId>[&cursor=<older>]
 *   { link, turns, older, seq, state, turnId, approvals, tokens, models }: one session's history, newest page
 *   first (older: the cursor for the page before), the stream's seq to follow it from, and the agent's models.
 * GET /api/tasks/sessions?id=<taskId>&native=<agent>&cwd=<folder>
 *   { sessions }: the agent's own sessions in that folder, to attach one (each says the task it is on, if any).
 * GET /api/tasks/sessions?id=<taskId>&models=<agent>
 *   { models }: the models the agent offers on this machine, to pick before a session starts.
 * GET /api/tasks/sessions?id=<taskId>&own=<agent>&cwd=<folder>[&host=]
 *   { own }: what the agent's own settings come to for sessions in that folder (the `own` mode, in words in the pane).
 * GET /api/tasks/sessions?id=<taskId>&login=<agent>[&host=]
 *   { login }: the sign-in running on that device (or one just ended), else null. Polled while he signs in.
 */
export async function GET(request: NextRequest) {
  if (!fromThisAppStrict(request.headers)) return refused();
  const params = request.nextUrl.searchParams;
  const id = params.get('id');
  if (!id) return fail(400, 'Missing id');
  try {
    const native = params.get('native');
    if (native !== null) {
      const kind = agent.safeParse(native);
      if (!kind.success) return fail(400, 'That is not an agent.');
      const place = validatePlace({ host: params.get('host') ?? thisHost(), cwd: params.get('cwd') ?? '' });
      if (!place.ok) return fail(400, place.error);
      return ok({ sessions: await nativeSessions(kind.data, place.place.host, place.place.cwd) });
    }
    const modelsOf = params.get('models');
    if (modelsOf !== null) {
      // The models an agent offers, for picking them before a session is started.
      const kind = agent.safeParse(modelsOf);
      if (!kind.success) return fail(400, 'That is not an agent.');
      return ok({ models: await agentModels(kind.data, thisHost()) });
    }
    const ownOf = params.get('own');
    if (ownOf !== null) {
      const kind = agent.safeParse(ownOf);
      if (!kind.success) return fail(400, 'That is not an agent.');
      const place = validatePlace({ host: params.get('host') ?? thisHost(), cwd: params.get('cwd') ?? '' });
      if (!place.ok) return fail(400, place.error);
      return ok({ own: await agentOwnSettings(kind.data, place.place.host, place.place.cwd) });
    }
    const loginOf = params.get('login');
    if (loginOf !== null) {
      const kind = agent.safeParse(loginOf);
      if (!kind.success) return fail(400, 'That is not an agent.');
      const refusedHost = loginHostRefused(params.get('host'));
      if (refusedHost) return fail(400, refusedHost);
      return ok({ login: agentLogin(kind.data, thisHost()) });
    }
    const wanted = params.get('session');
    if (wanted !== null) {
      const link = linkOf(id, wanted);
      if (!link) return fail(404, 'That session is gone.');
      const detail = await sessionDetail(link.id, params.get('cursor'));
      const [models, own] = await Promise.all([
        agentModels(link.agent, link.host).catch(() => [] as ModelEntry[]),
        agentOwnSettings(link.agent, link.host, link.cwd).catch((): OwnSettings | null => null),
      ]);
      return ok({ ...detail, models, own });
    }
    if (params.get('agents') !== null) return ok({ agents: await statuses(thisHost()) });
    // The list answers at once; each agent's status (which can take seconds) is read on its own, with &agents.
    refreshTask(id);
    const place = readTaskPlace(id);
    return ok({ sessions: sessionSummaries(id), place: place ?? defaultPlace(), places: placesFor(place) });
  } catch (error) {
    if (error instanceof HubError) return fail(error.status, error.message);
    console.error('Error reading coding sessions:', error);
    return fail(500, 'Internal server error');
  }
}

/**
 * POST /api/tasks/sessions
 * Picks with mode 'full' need confirmFull: true when the session starts in it or moves into it (start, adopt, send, picks).
 * { action: 'start', taskId, agent, text, place?, picks? }   a new session in the place (else the task's place), its
 *     first turn sent behind the answer with the task's brief in front of his text. → the link
 * { action: 'send', taskId, session, text, picks? }          a new turn; 409 while one runs (steer it) → { turnId }
 * { action: 'steer', taskId, session, text }                 add to the turn that runs → { turnId }
 * { action: 'interrupt', taskId, session }                   stop the turn that runs
 * { action: 'approve', taskId, session, approvalId, decision }   decision: allow | allow-session | deny | cancel
 * { action: 'adopt', taskId, agent, sessionId, host?, picks? }   attach one of the agent's own sessions → the link
 * { action: 'rename', taskId, session, title }               renamed in the agent too → the link
 * { action: 'archive', taskId, session }                     archived in the agent, off the task's list
 * { action: 'picks', taskId, session, picks }                model, effort, permission mode for its next turns → the link
 * { action: 'seen', taskId, session }                        he has it open → the link
 * { action: 'place', taskId, place }                         where the task's new sessions run → the place
 * { action: 'login', taskId, agent, host? }                  start signing in on that device (409 when signed in) → the login
 * { action: 'login-code', taskId, agent, host?, loginId, code }   the code from the sign-in page (Claude Code) → the login
 * { action: 'login-cancel', taskId, agent, host?, loginId }  stop signing in → the login
 * Mode 'own' (the agent's own settings) needs no confirming, even where those settings are full access: they are
 * his standing choice, made in the agent's own config.
 */
export async function POST(request: NextRequest) {
  if (!fromThisAppStrict(request.headers)) return refused();
  try {
    const parsed = BodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return fail(400, 'Invalid request');
    const body = parsed.data;

    if (body.action === 'place') {
      const place = validatePlace(body.place);
      if (!place.ok) return fail(400, place.error);
      setTaskPlace(body.taskId, place.place);
      return ok(place.place);
    }

    if (body.action === 'login' || body.action === 'login-code' || body.action === 'login-cancel') {
      const refusedHost = loginHostRefused(body.host);
      if (refusedHost) return fail(400, refusedHost);
      if (body.action === 'login') return ok(await startLogin(body.agent, thisHost()));
      if (body.action === 'login-code') return ok(await sendLoginCode(body.agent, thisHost(), body.loginId, body.code));
      return ok(await cancelLogin(body.agent, thisHost(), body.loginId));
    }

    if (body.action === 'start') {
      const place = validatePlace(body.place ?? readTaskPlace(body.taskId) ?? defaultPlace());
      if (!place.ok) return fail(400, place.error);
      const brief = loadTaskBrief(body.taskId);
      if (!brief) return fail(404, `No open task has the id ${body.taskId}.`);
      const picks = body.picks ?? DEFAULT_PICKS;
      if (fullRefused(picks, body.confirmFull, null)) return fail(400, FULL_UNCONFIRMED);
      const wrong = await checkPicks(body.agent, place.place.host, picks);
      if (wrong) return fail(400, wrong);
      if (body.place) setTaskPlace(body.taskId, place.place);
      return ok(await startSession({ taskId: body.taskId, agent: body.agent, place: place.place, text: body.text, picks, brief }));
    }

    if (body.action === 'adopt') {
      // Only this machine's sessions can be attached for now: refused before anything is asked of the agent.
      const host = body.host ?? thisHost();
      if (host !== thisHost()) return fail(400, `Sessions on ${host} are not available yet.`);
      if (fullRefused(body.picks, body.confirmFull, null)) return fail(400, FULL_UNCONFIRMED);
      // Its turns run in its own folder, which must be one of the places on offer like any other session's.
      const allow = (cwd: string) => { const place = validatePlace({ host, cwd }); return place.ok ? null : place.error; };
      const link = await adoptSession({ taskId: body.taskId, agent: body.agent, host, sessionId: body.sessionId, picks: body.picks ?? DEFAULT_PICKS, allow });
      return ok(link);
    }

    const link = linkOf(body.taskId, body.session);
    if (!link) return fail(404, 'That session is gone.');
    switch (body.action) {
      case 'send': {
        if (fullRefused(body.picks, body.confirmFull, link.picks)) return fail(400, FULL_UNCONFIRMED);
        if (body.picks) {
          const wrong = await checkPicks(link.agent, link.host, body.picks);
          if (wrong) return fail(400, wrong);
        }
        return ok(await sendToSession(link.id, body.text, body.picks));
      }
      case 'steer':
        return ok(await steerSession(link.id, body.text));
      case 'interrupt':
        await interruptSession(link.id);
        return ok(null);
      case 'approve':
        await answerApproval(link.id, body.approvalId, body.decision as (typeof APPROVAL_DECISIONS)[number]);
        return ok(null);
      case 'rename':
        return ok(await renameSession(link.id, body.title));
      case 'archive':
        await archiveSession(link.id);
        return ok(null);
      case 'picks': {
        if (fullRefused(body.picks, body.confirmFull, link.picks)) return fail(400, FULL_UNCONFIRMED);
        const wrong = await checkPicks(link.agent, link.host, body.picks);
        if (wrong) return fail(400, wrong);
        return ok(setSessionPicks(link.id, body.picks));
      }
      case 'seen':
        return ok(markSessionSeen(link.id));
    }
  } catch (error) {
    if (error instanceof HubError) return fail(error.status, error.message);
    console.error('Error handling a coding-session request:', error);
    return fail(500, 'Internal server error');
  }
}
