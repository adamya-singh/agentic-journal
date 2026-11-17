'use client';

// A task's coding-agent sessions (Codex, Claude Code) for its workspace, kept in step with the server: the list
// (polled like the OpenClaw chats), the one session that is open (its history from GET ?session=, then the live
// stream), what the chooser needs (places, each agent's status), and every action the routes take. The contract is
// docs/code-sessions-design.md; the routes are /api/tasks/sessions and /api/tasks/sessions/stream.
import React from 'react';
import type {
  AgentKind, AgentLogin, AgentStatus, ApprovalDecision, ApprovalRequest, CodeSessionLink, ModelEntry, NativeSession, OwnSettings, Place, PlaceChoice,
  RateLimitSummary, SessionEvent, SessionPicks, SessionState, SessionSummary, SessionTurn, TokenUsage,
} from '@/lib/code-agents/protocol';
import { applySessionEvent } from '@/lib/code-sessions-ui';

const POLL_BUSY_MS = 2500;
const POLL_OPEN_MS = 8000;
const POLL_QUIET_MS = 20_000;
const DETAIL_POLL_BUSY_MS = 2500;
const DETAIL_POLL_QUIET_MS = 10_000;
const STREAM_RETRY_MS = 3000;
const STREAM_GIVE_UP = 4;
/** Each agent's status is read again at most this often (the server keeps it 15 s too). */
const AGENTS_EVERY_MS = 15_000;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) throw Object.assign(new Error(json.error || 'That did not go through.'), { status: res.status });
  return json.data as T;
}
const post = <T,>(body: object) => call<T>('/api/tasks/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);

interface ListData {
  sessions: SessionSummary[];
  place: Place;
  places: PlaceChoice[];
}

interface DetailData {
  link: CodeSessionLink;
  turns: SessionTurn[];
  older: string | null;
  seq: number;
  state: SessionState;
  turnId: string | null;
  approvals: ApprovalRequest[];
  tokens: TokenUsage | null;
  models: ModelEntry[];
  own?: OwnSettings | null;
}

/** The open session as the pane draws it. */
export interface SessionView {
  link: CodeSessionLink;
  turns: SessionTurn[];
  older: string | null;
  state: SessionState;
  turnId: string | null;
  approvals: ApprovalRequest[];
  tokens: TokenUsage | null;
  limits: RateLimitSummary | null;
  models: ModelEntry[];
  /** What the agent's own settings come to in the session's folder (the `own` mode), when it said. */
  own: OwnSettings | null;
}

export interface CodeSessions {
  taskId: string;
  enabled: boolean;
  loaded: boolean;
  sessions: SessionSummary[];
  place: Place | null;
  places: PlaceChoice[];
  agents: Partial<Record<AgentKind, AgentStatus>>;
  /** Each agent's status has been read once (it comes after the list). */
  agentsLoaded: boolean;
  /** The session that is open (its link id), or null. */
  current: string | null;
  /** The new-chat chooser is showing. */
  choosing: boolean;
  view: SessionView | null;
  /** The history is being read (opening, or after the stream lost its place). */
  reading: boolean;
  /** The stream could not be kept open: the session is read again every few seconds instead. */
  polling: boolean;
  olderLoading: boolean;
  draft: string;
  setDraft: (text: string) => void;
  sending: boolean;
  stopping: boolean;
  /** What he sent that the agent has not shown back yet. */
  outbox: string | null;
  /** Approvals he answered, hidden while the answer is on its way. */
  answering: Set<string>;
  error: string | null;
  clearError: () => void;
  waiting: number;
  working: number;
  open: (linkId: string) => void;
  close: () => void;
  choose: (on: boolean) => void;
  /** confirmFull: he confirmed Full access (picks.mode 'full'); the server refuses it without. */
  start: (input: { agent: AgentKind; place: Place; picks: SessionPicks; text: string; confirmFull?: boolean }) => Promise<boolean>;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  approve: (approvalId: string, decision: ApprovalDecision) => Promise<void>;
  loadOlder: () => Promise<void>;
  setPicks: (picks: SessionPicks, confirmFull?: boolean) => Promise<void>;
  rename: (title: string) => Promise<boolean>;
  archive: () => Promise<boolean>;
  setPlace: (place: Place) => Promise<void>;
  native: (agent: AgentKind, place: Place) => Promise<NativeSession[]>;
  /** The models an agent offers, to pick before a session starts. */
  models: (agent: AgentKind) => Promise<ModelEntry[]>;
  adopt: (agent: AgentKind, sessionId: string, host: string) => Promise<boolean>;
  /** What the agent's own settings come to for sessions in a place (the `own` mode). */
  own: (agent: AgentKind, place: Place) => Promise<OwnSettings>;
  /** Each agent's status read again now (after signing in). */
  refreshAgents: () => void;
  /** Signing in to an agent on this device: the sign-in running (or just ended), start, the pasted code, stop. */
  loginRead: (agent: AgentKind) => Promise<AgentLogin | null>;
  loginStart: (agent: AgentKind) => Promise<AgentLogin>;
  loginCode: (agent: AgentKind, loginId: string, code: string) => Promise<AgentLogin>;
  loginCancel: (agent: AgentKind, loginId: string) => Promise<AgentLogin>;
  refresh: () => void;
}

const viewOf = (d: DetailData, limits: RateLimitSummary | null): SessionView => ({
  link: d.link, turns: d.turns, older: d.older, state: d.state, turnId: d.turnId, approvals: d.approvals, tokens: d.tokens, limits, models: d.models, own: d.own ?? null,
});

/** One event on the open session's view. */
function reduce(view: SessionView, event: SessionEvent): SessionView {
  switch (event.type) {
    case 'turn-started':
      return { ...view, turns: applySessionEvent(view.turns, event), turnId: event.turnId };
    case 'turn-completed':
      return {
        ...view, turns: applySessionEvent(view.turns, event), turnId: view.turnId === event.turnId ? null : view.turnId,
        approvals: view.approvals.filter((a) => a.turnId !== event.turnId),
      };
    case 'item-started': case 'item-updated': case 'item-completed': case 'item-delta': case 'turn-diff':
      return { ...view, turns: applySessionEvent(view.turns, event) };
    case 'approval-asked':
      return { ...view, approvals: [...view.approvals.filter((a) => a.id !== event.approval.id), event.approval] };
    case 'approval-resolved':
      return { ...view, approvals: view.approvals.filter((a) => a.id !== event.approvalId) };
    case 'state-changed':
      return { ...view, state: event.state, turnId: event.turnId };
    case 'title-changed':
      return { ...view, link: { ...view.link, title: event.title } };
    case 'usage-changed':
      return { ...view, ...(event.tokens ? { tokens: event.tokens } : {}), ...(event.limits ? { limits: event.limits } : {}) };
    default:
      return view;
  }
}

/**
 * A newer page of history with the older turns he already loaded kept in front of it. The agent's plan of a turn
 * comes only on the stream (it is not an item of the history), so a turn read again keeps the plan it had, where it was.
 */
function withOlder(was: SessionTurn[], page: SessionTurn[]): SessionTurn[] {
  const ids = new Set(page.map((t) => t.id));
  const firstNew = page[0]?.id;
  const cut = firstNew ? was.findIndex((t) => t.id === firstNew) : -1;
  const before = (cut >= 0 ? was.slice(0, cut) : []).filter((t) => !ids.has(t.id));
  const kept = page.map((turn) => {
    const old = was.find((t) => t.id === turn.id);
    const plans = old?.items.map((item, at) => ({ item, at })).filter(({ item }) => item.kind === 'plan' && !turn.items.some((i) => i.id === item.id)) ?? [];
    if (plans.length === 0) return turn;
    const items = turn.items.slice();
    for (const { item, at } of plans) items.splice(Math.min(at, items.length), 0, item);
    return { ...turn, items };
  });
  return [...before, ...kept];
}

/**
 * The task's coding sessions. `enabled` is false for what is not a task (an action card's workspace). `watching` is
 * true while he can see the open session: only then does a finished turn count as read.
 */
export function useCodeSessions(taskId: string, watching: boolean, enabled = true): CodeSessions {
  const task = encodeURIComponent(taskId);
  const [list, setList] = React.useState<ListData | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [current, setCurrent] = React.useState<string | null>(null);
  const [choosing, setChoosing] = React.useState(false);
  const [view, setView] = React.useState<SessionView | null>(null);
  const [reading, setReading] = React.useState(false);
  const [polling, setPolling] = React.useState(false);
  const [olderLoading, setOlderLoading] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [outbox, setOutbox] = React.useState<string | null>(null);
  const [answering, setAnswering] = React.useState<Set<string>>(() => new Set());
  const [error, setError] = React.useState<string | null>(null);
  const currentRef = React.useRef(current);
  currentRef.current = current;
  const viewRef = React.useRef(view);
  viewRef.current = view;
  const outboxRef = React.useRef(outbox);
  outboxRef.current = outbox;

  // ---- The list, and each agent's status beside it: the list never waits on an agent that is slow to answer.
  const [agents, setAgents] = React.useState<Partial<Record<AgentKind, AgentStatus>>>({});
  const [agentsLoaded, setAgentsLoaded] = React.useState(false);
  const agentsAt = React.useRef(0);
  const loadAgents = React.useCallback(async () => {
    if (!enabled || Date.now() - agentsAt.current < AGENTS_EVERY_MS) return;
    agentsAt.current = Date.now();
    try { setAgents((await call<{ agents: Record<AgentKind, AgentStatus> }>(`/api/tasks/sessions?id=${task}&agents=1`)).agents); } catch { agentsAt.current = 0; }
    setAgentsLoaded(true);
  }, [task, enabled]);
  const reads = React.useRef(0);
  const loadList = React.useCallback(async () => {
    if (!enabled) return;
    void loadAgents();
    const mine = ++reads.current;
    try {
      const data = await call<ListData>(`/api/tasks/sessions?id=${task}`);
      if (mine === reads.current) setList(data);
    } catch { /* keep what we have */ }
    setLoaded(true);
  }, [task, enabled, loadAgents]);
  React.useEffect(() => { void loadList(); }, [loadList]);
  const busy = !!list?.sessions.some((s) => s.state === 'working' || s.state === 'needs-you') || sending;
  React.useEffect(() => {
    if (!enabled) return;
    const every = busy ? POLL_BUSY_MS : watching && current ? POLL_OPEN_MS : POLL_QUIET_MS;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void loadList(); }, every);
    return () => window.clearInterval(timer);
  }, [busy, loadList, watching, current, enabled]);
  // Something changed in a session: the list is read again soon (once, however many events come).
  const soon = React.useRef(0);
  const listSoon = React.useCallback(() => {
    if (soon.current) return;
    soon.current = window.setTimeout(() => { soon.current = 0; void loadList(); }, 400);
  }, [loadList]);
  React.useEffect(() => () => window.clearTimeout(soon.current), []);

  const limitsOf = React.useCallback((agent: AgentKind) => agents[agent]?.limits ?? null, [agents]);
  const limitsRef = React.useRef(limitsOf);
  limitsRef.current = limitsOf;

  // ---- The open session: its history, then its stream.
  const [detailNonce, setDetailNonce] = React.useState(0);
  React.useEffect(() => {
    if (!enabled || !current) return;
    const linkId = current;
    let alive = true;
    let source: EventSource | null = null;
    let retry = 0;
    let pollTimer = 0;
    let errors = 0;
    let seq = 0;
    let resets = 0;
    let pollingNow = false;

    const read = async (): Promise<boolean> => {
      try {
        const data = await call<DetailData>(`/api/tasks/sessions?id=${task}&session=${encodeURIComponent(linkId)}`);
        if (!alive) return false;
        seq = data.seq;
        // What he sent is in the history now: it is shown from there.
        const sent = outboxRef.current;
        if (sent && data.turns.some((t) => t.items.some((i) => i.kind === 'user' && i.text.trim() === sent.trim()))) setOutbox(null);
        const was = viewRef.current;
        const limits = limitsRef.current(data.link.agent);
        setView(was && was.link.id === linkId ? { ...viewOf(data, was.limits ?? limits), turns: withOlder(was.turns, data.turns), older: was.turns.length > data.turns.length ? was.older : data.older } : viewOf(data, limits));
        setError(null);
        return true;
      } catch (err) {
        if (!alive) return false;
        if ((err as { status?: number }).status === 404) { setCurrent(null); setView(null); void loadList(); }
        setError(message(err, 'The session could not be read.'));
        return false;
      } finally {
        if (alive) setReading(false);
      }
    };

    const poll = () => {
      if (pollingNow) return;
      pollingNow = true;
      setPolling(true);
      const tick = async () => {
        if (!alive) return;
        if (document.visibilityState === 'visible') await read();
        const v = viewRef.current;
        pollTimer = window.setTimeout(tick, v && (v.state === 'working' || v.state === 'needs-you') ? DETAIL_POLL_BUSY_MS : DETAIL_POLL_QUIET_MS);
      };
      pollTimer = window.setTimeout(tick, DETAIL_POLL_BUSY_MS);
    };

    const onEvent = (event: SessionEvent) => {
      if (event.session !== linkId) {
        // Another session of this task moved: its row may have changed.
        if (event.type === 'turn-completed' || event.type === 'state-changed' || event.type === 'approval-asked' || event.type === 'title-changed') listSoon();
        return;
      }
      if (event.type === 'reset') {
        // The stream cannot bring this copy up to date: read the history again and follow from there.
        if (++resets > 6) { source?.close(); source = null; poll(); return; }
        void read().then((ok) => { if (ok && alive) openStream(); });
        return;
      }
      if (event.seq <= seq) return;
      seq = event.seq;
      setView((was) => (was && was.link.id === linkId ? reduce(was, event) : was));
      if (event.type === 'approval-resolved') setAnswering((was) => { if (!was.has(event.approvalId)) return was; const next = new Set(was); next.delete(event.approvalId); return next; });
      if (event.type === 'turn-completed') { setStopping(false); setOutbox(null); }
      if (event.type === 'item-started' && event.item.kind === 'user') setOutbox(null);
      if (event.type === 'turn-completed' || event.type === 'state-changed' || event.type === 'title-changed') listSoon();
    };

    const openStream = () => {
      if (!alive || pollingNow) return;
      source?.close();
      window.clearTimeout(retry);
      if (typeof EventSource === 'undefined') { poll(); return; }
      const es = new EventSource(`/api/tasks/sessions/stream?id=${task}&after=${encodeURIComponent(`${linkId}:${seq}`)}`);
      source = es;
      es.addEventListener('open', () => { errors = 0; });
      es.addEventListener('session', (m) => {
        errors = 0;
        try { onEvent(JSON.parse((m as MessageEvent<string>).data) as SessionEvent); } catch { /* a frame that is not an event */ }
      });
      es.onerror = () => {
        if (!alive || source !== es) return;
        errors += 1;
        // It reconnects by itself (with Last-Event-ID) while it can; closed, or failing again and again, it is
        // opened anew from where this copy is, and in the end the session is read every few seconds instead.
        if (errors >= STREAM_GIVE_UP) { es.close(); source = null; poll(); return; }
        if (es.readyState === EventSource.CLOSED) { source = null; retry = window.setTimeout(() => { void read().then((ok) => { if (ok) openStream(); }); }, STREAM_RETRY_MS); }
      };
    };

    setReading(true);
    setPolling(false);
    void read().then((ok) => { if (ok) openStream(); else poll(); });
    return () => {
      alive = false;
      source?.close();
      window.clearTimeout(retry);
      window.clearTimeout(pollTimer);
    };
  }, [enabled, current, task, loadList, listSoon, detailNonce]);

  // He is looking at it: a turn that ended counts as read.
  const summary = list?.sessions.find((s) => s.id === current) ?? null;
  const unseen = watching && summary && summary.unread && summary.state !== 'needs-you' && summary.state !== 'working' ? `${summary.id}|${summary.settledAt ?? ''}` : null;
  React.useEffect(() => {
    if (!unseen) return;
    const linkId = unseen.split('|')[0]!;
    void post<CodeSessionLink>({ action: 'seen', taskId, session: linkId }).then(() => loadList()).catch(() => {});
  }, [unseen, taskId, loadList]);

  // ---- Actions.
  const fail = React.useCallback((err: unknown, fallback: string) => setError(message(err, fallback)), []);

  const open = React.useCallback((linkId: string) => {
    setError(null);
    setChoosing(false);
    setOutbox(null);
    setStopping(false);
    setAnswering(new Set());
    if (currentRef.current === linkId) { setDetailNonce((n) => n + 1); return; }
    setView(null);
    setDraft('');
    setCurrent(linkId);
  }, []);
  const close = React.useCallback(() => { setError(null); setCurrent(null); setView(null); setOutbox(null); setChoosing(false); }, []);
  const choose = React.useCallback((on: boolean) => { setError(null); setChoosing(on); if (on) { setCurrent(null); setView(null); } }, []);

  const start = React.useCallback(async (input: { agent: AgentKind; place: Place; picks: SessionPicks; text: string; confirmFull?: boolean }) => {
    const text = input.text.trim();
    if (!text || sending) return false;
    setSending(true);
    setError(null);
    try {
      const link = await post<CodeSessionLink>({ action: 'start', taskId, agent: input.agent, text, place: input.place, picks: input.picks, ...(input.confirmFull ? { confirmFull: true } : {}) });
      setChoosing(false);
      setView(null);
      setOutbox(text);
      setCurrent(link.id);
      void loadList();
      return true;
    } catch (err) {
      fail(err, 'The session did not start.');
      return false;
    } finally {
      setSending(false);
    }
  }, [taskId, sending, loadList, fail]);

  const send = React.useCallback(async (typed: string) => {
    const text = typed.trim();
    const linkId = currentRef.current;
    const v = viewRef.current;
    if (!text || !linkId || sending) return;
    setSending(true);
    setError(null);
    const steer = !!v && (!!v.turnId || v.state === 'working' || v.state === 'needs-you');
    setOutbox(text);
    try {
      await post<{ turnId: string }>({ action: steer ? 'steer' : 'send', taskId, session: linkId, text });
      setDraft('');
      void loadList();
    } catch (err) {
      setOutbox(null);
      fail(err, 'That did not send.');
    } finally {
      setSending(false);
    }
  }, [taskId, sending, loadList, fail]);

  const stop = React.useCallback(async () => {
    const linkId = currentRef.current;
    if (!linkId) return;
    setStopping(true);
    setError(null);
    try { await post({ action: 'interrupt', taskId, session: linkId }); } catch (err) { setStopping(false); fail(err, 'It could not be stopped.'); }
  }, [taskId, fail]);

  const approve = React.useCallback(async (approvalId: string, decision: ApprovalDecision) => {
    const linkId = currentRef.current;
    if (!linkId) return;
    setError(null);
    setAnswering((was) => new Set(was).add(approvalId));
    try {
      await post({ action: 'approve', taskId, session: linkId, approvalId, decision });
      // The stream says it is settled; this read covers a stream that is not there.
      setView((was) => (was ? { ...was, approvals: was.approvals.filter((a) => a.id !== approvalId) } : was));
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        // Someone answered it first (the agent's own app, another window).
        setView((was) => (was ? { ...was, approvals: was.approvals.filter((a) => a.id !== approvalId) } : was));
        setError('It was already answered somewhere else.');
      } else {
        fail(err, 'The answer did not reach it.');
      }
    } finally {
      setAnswering((was) => { const next = new Set(was); next.delete(approvalId); return next; });
    }
  }, [taskId, fail]);

  const loadOlder = React.useCallback(async () => {
    const v = viewRef.current;
    if (!v?.older || olderLoading) return;
    setOlderLoading(true);
    try {
      const data = await call<DetailData>(`/api/tasks/sessions?id=${task}&session=${encodeURIComponent(v.link.id)}&cursor=${encodeURIComponent(v.older)}`);
      setView((was) => {
        if (!was || was.link.id !== v.link.id) return was;
        const have = new Set(was.turns.map((t) => t.id));
        return { ...was, turns: [...data.turns.filter((t) => !have.has(t.id)), ...was.turns], older: data.older };
      });
    } catch (err) {
      fail(err, 'Earlier turns could not be read.');
    } finally {
      setOlderLoading(false);
    }
  }, [task, olderLoading, fail]);

  const setPicks = React.useCallback(async (picks: SessionPicks, confirmFull?: boolean) => {
    const linkId = currentRef.current;
    if (!linkId) return;
    setError(null);
    const before = viewRef.current?.link.picks;
    setView((was) => (was ? { ...was, link: { ...was.link, picks } } : was));
    try {
      const link = await post<CodeSessionLink>({ action: 'picks', taskId, session: linkId, picks, ...(confirmFull ? { confirmFull: true } : {}) });
      setView((was) => (was && was.link.id === link.id ? { ...was, link: { ...was.link, picks: link.picks } } : was));
    } catch (err) {
      if (before) setView((was) => (was ? { ...was, link: { ...was.link, picks: before } } : was));
      fail(err, 'That could not be picked.');
    }
  }, [taskId, fail]);

  const rename = React.useCallback(async (title: string) => {
    const linkId = currentRef.current;
    if (!linkId || !title.trim()) return false;
    setError(null);
    try {
      const link = await post<CodeSessionLink>({ action: 'rename', taskId, session: linkId, title: title.trim() });
      setView((was) => (was && was.link.id === link.id ? { ...was, link: { ...was.link, title: link.title } } : was));
      void loadList();
      return true;
    } catch (err) { fail(err, 'It could not be renamed.'); return false; }
  }, [taskId, loadList, fail]);

  const archive = React.useCallback(async () => {
    const linkId = currentRef.current;
    if (!linkId) return false;
    setError(null);
    try {
      await post({ action: 'archive', taskId, session: linkId });
      setCurrent(null);
      setView(null);
      void loadList();
      return true;
    } catch (err) { fail(err, 'It could not be archived.'); return false; }
  }, [taskId, loadList, fail]);

  const setPlace = React.useCallback(async (place: Place) => {
    setList((was) => (was ? { ...was, place } : was));
    try { await post({ action: 'place', taskId, place }); } catch (err) { fail(err, 'That place could not be kept.'); }
  }, [taskId, fail]);

  const native = React.useCallback(async (agent: AgentKind, place: Place) => {
    const data = await call<{ sessions: NativeSession[] }>(`/api/tasks/sessions?id=${task}&native=${agent}&cwd=${encodeURIComponent(place.cwd)}&host=${encodeURIComponent(place.host)}`);
    return data.sessions;
  }, [task]);

  const models = React.useCallback(async (agent: AgentKind) => (await call<{ models: ModelEntry[] }>(`/api/tasks/sessions?id=${task}&models=${agent}`)).models, [task]);

  const own = React.useCallback(async (agent: AgentKind, place: Place) =>
    (await call<{ own: OwnSettings }>(`/api/tasks/sessions?id=${task}&own=${agent}&cwd=${encodeURIComponent(place.cwd)}&host=${encodeURIComponent(place.host)}`)).own, [task]);
  const refreshAgents = React.useCallback(() => { agentsAt.current = 0; void loadAgents(); }, [loadAgents]);
  const loginRead = React.useCallback(async (agent: AgentKind) => (await call<{ login: AgentLogin | null }>(`/api/tasks/sessions?id=${task}&login=${agent}`)).login, [task]);
  const loginStart = React.useCallback((agent: AgentKind) => post<AgentLogin>({ action: 'login', taskId, agent }), [taskId]);
  const loginCode = React.useCallback((agent: AgentKind, loginId: string, code: string) => post<AgentLogin>({ action: 'login-code', taskId, agent, loginId, code }), [taskId]);
  const loginCancel = React.useCallback((agent: AgentKind, loginId: string) => post<AgentLogin>({ action: 'login-cancel', taskId, agent, loginId }), [taskId]);

  const adopt = React.useCallback(async (agent: AgentKind, sessionId: string, host: string) => {
    setError(null);
    try {
      const link = await post<CodeSessionLink>({ action: 'adopt', taskId, agent, sessionId, host });
      setChoosing(false);
      setView(null);
      setCurrent(link.id);
      void loadList();
      return true;
    } catch (err) { fail(err, 'That session could not be brought here.'); return false; }
  }, [taskId, loadList, fail]);

  const sessions = enabled ? list?.sessions ?? [] : [];
  return {
    taskId,
    enabled,
    loaded: !enabled || loaded,
    sessions,
    place: list?.place ?? null,
    places: list?.places ?? [],
    agents,
    agentsLoaded: !enabled || agentsLoaded,
    current,
    choosing,
    view: view && view.link.id === current ? view : null,
    reading,
    polling,
    olderLoading,
    draft,
    setDraft,
    sending,
    stopping,
    outbox,
    answering,
    error,
    clearError: () => setError(null),
    waiting: sessions.filter((s) => s.unread || s.state === 'needs-you').length,
    working: sessions.filter((s) => s.state === 'working').length,
    open, close, choose, start, send, stop, approve, loadOlder, setPicks, rename, archive, setPlace, native, models, adopt,
    own, refreshAgents, loginRead, loginStart, loginCode, loginCancel,
    refresh: () => { void loadList(); },
  };
}
