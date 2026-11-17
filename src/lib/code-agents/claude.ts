// The Claude Code adapter: Claude Code sessions through the Claude bridge (bridge/claude-bridge.ts), a small daemon
// on this device that runs them with the Claude Agent SDK on the installed `claude` and its subscription login.
// The bridge already speaks the Journal's own shapes (protocol.ts), so this is a thin pass-through over the same
// JSON-RPC-over-WebSocket client as Codex (transport.ts). The bridge protocol is in docs/code-sessions-design.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ApprovalGoneError, type AdapterConfig, type AgentAdapter, type HistoryPage, type LoginStarted, type NativeState, type ResumeResult } from './adapter';
import type { AgentStatus, EventBody, ModelEntry, NativeSession, OwnSettings, RateLimitSummary } from './protocol';
import { expandHome, isRemote, probeDevice, REMOTE, sshPipe } from './ssh';
import { connectRpc, RpcError, unixSocketTransport, webSocketTransport, type MessageTransport, type RpcClient } from './transport';
import { machineName } from '@/lib/proj-hosts';

/** The bridge's "no such session or approval" (BRIDGE_ERROR.notFound in bridge/sessions.ts). */
const BRIDGE_NOT_FOUND = -32004;

const CLIENT_INFO = { name: 'agentic_journal', title: 'Agentic Journal', version: '0.1.0' };
/** 2: the `own` mode, its settings (`settings/own`) and signing in (`login/*`). */
const BRIDGE_PROTOCOL = 2;
const MODELS_TTL_MS = 5 * 60_000;

export const BRIDGE_NOT_RUNNING = 'The Claude Code bridge isn’t running on this device. Start it with `systemctl --user start agentic-journal-claude-bridge`.';

/** The bridge's socket. CLAUDE_BRIDGE_SOCKET points elsewhere (the tests' bridge). */
export function claudeBridgeSocketPath(): string {
  return process.env.CLAUDE_BRIDGE_SOCKET || path.join(os.homedir(), '.local', 'state', 'agentic-journal', 'claude-bridge.sock');
}

/**
 * How to reach the Claude bridge on another device, over ssh (ssh.ts): its `proxy` mode there pipes ssh's stdio to the
 * bridge's socket, so the Journal speaks the same WebSocket as here. Throws why it cannot (device, Claude Code or the
 * bridge not there, or the bridge not running).
 */
export async function remoteBridgeTransport(host: string): Promise<MessageTransport> {
  const device = await probeDevice(host);
  const name = machineName(host);
  if (!device.reachable) throw new Error(device.reason ?? `${name} can’t be reached.`);
  if (!device.claude) throw new Error(`Claude Code isn’t installed on ${name} (no \`claude\` in its login shell’s PATH).`);
  if (device.claude.bridge === 'missing') throw new Error(`The Claude Code bridge isn’t installed on ${name}. Put it there with \`scripts/install-claude-bridge.sh ${host}\` from the Journal’s folder on this machine.`);
  if (device.claude.bridge === 'installed') throw new Error(`The Claude Code bridge isn’t running on ${name}. Start it there with \`systemctl --user start agentic-journal-claude-bridge\` (on a Mac: \`launchctl kickstart gui/$(id -u)/com.agentic-journal.claude-bridge\`).`);
  return webSocketTransport({ label: `claude bridge on ${host}`, url: 'ws://bridge/', openTimeoutMs: 25_000, createConnection: () => sshPipe(host, REMOTE.claudeProxy) });
}

export function createClaudeAdapter(config: AdapterConfig): AgentAdapter {
  const { host, sink } = config;
  const remote = isRemote(host);
  /** A folder as the bridge there needs it: `~/…` (how the proj registry writes another device's folders) in full. */
  const there = async (cwd: string) => (remote && cwd.startsWith('~') ? expandHome(cwd, (await probeDevice(host)).home) : cwd);
  let client: RpcClient | null = null;
  let connecting: Promise<RpcClient> | null = null;
  let modelCache: { at: number; list: ModelEntry[] } | null = null;
  const joined = new Set<string>();                                      // sessions this connection started or resumed
  const approvals = new Map<string, { sessionId: string; turnId: string | null }>();   // approvals the bridge asked, still waiting
  const answering = new Set<string>();                                   // answers on their way to the bridge

  const onEvent = (sessionId: string, event: EventBody) => {
    if (event.type === 'approval-asked') approvals.set(event.approval.id, { sessionId, turnId: event.approval.turnId });
    else if (event.type === 'approval-resolved') approvals.delete(event.approvalId);
    else if (event.type === 'turn-completed') for (const [id, a] of approvals) if (a.sessionId === sessionId && a.turnId === event.turnId) approvals.delete(id);
    sink.event(sessionId, event);
  };

  const logins = new Set<string>();                                       // sign-ins this connection started, not ended

  const onNotification = (method: string, raw: unknown) => {
    const p = (raw ?? {}) as { sessionId?: unknown; event?: unknown; state?: unknown; limits?: unknown; loginId?: unknown; success?: unknown; cancelled?: unknown; error?: unknown };
    if (method === 'session/event' && typeof p.sessionId === 'string' && p.event && typeof p.event === 'object') onEvent(p.sessionId, p.event as EventBody);
    else if (method === 'session/state' && typeof p.sessionId === 'string' && typeof p.state === 'string') sink.nativeState(p.sessionId, p.state as NativeState);
    else if (method === 'account/limits' && p.limits && typeof p.limits === 'object') sink.limits(p.limits as RateLimitSummary);
    else if (method === 'login/completed' && typeof p.loginId === 'string' && logins.delete(p.loginId)) {
      modelCache = null;
      sink.login({ loginId: p.loginId, state: p.success === true ? 'done' : p.cancelled === true ? 'cancelled' : 'failed', ...(p.success !== true && typeof p.error === 'string' ? { error: p.error } : {}) });
    }
  };

  const dropped = (reason: string) => {
    client = null;
    joined.clear();
    // The bridge keeps them waiting and asks again when the session is joined anew; to the hub they are gone.
    for (const [approvalId, a] of approvals) sink.event(a.sessionId, { type: 'approval-resolved', approvalId, decision: null, by: 'lost' });
    approvals.clear();
    // The bridge ends a sign-in whose connection went (its `claude auth login` is stopped).
    for (const loginId of logins) sink.login({ loginId, state: 'failed', error: 'The connection to the Claude Code bridge dropped while you were signing in. Try again.' });
    logins.clear();
    sink.connection(false, reason);
  };

  const rpc = async (): Promise<RpcClient> => {
    if (client && !client.closed) return client;
    if (connecting) return connecting;
    connecting = (async () => {
      let next: RpcClient;
      if (remote) {
        next = await connectRpc(await remoteBridgeTransport(host));
      } else {
        const socket = claudeBridgeSocketPath();
        if (!fs.existsSync(socket)) throw new Error(BRIDGE_NOT_RUNNING);
        try { next = await connectRpc(unixSocketTransport(socket, 'claude bridge')); } catch { throw new Error(BRIDGE_NOT_RUNNING); }
      }
      next.onNotification(onNotification);
      try {
        const init = await next.request<{ protocol?: number }>('initialize', { clientInfo: CLIENT_INFO }, { timeoutMs: 10_000 });
        if (init?.protocol !== BRIDGE_PROTOCOL) {
          throw new Error(`The Claude Code bridge${remote ? ` on ${machineName(host)}` : ''} speaks protocol ${String(init?.protocol)}; the Journal needs ${BRIDGE_PROTOCOL}. ${remote ? `Update it with \`scripts/install-claude-bridge.sh ${host}\`.` : 'Restart the bridge after a deploy.'}`);
        }
        next.notify('initialized', {});
      } catch (error) {
        next.close();
        throw error;
      }
      next.onClose(dropped);
      client = next;
      sink.connection(true);
      return next;
    })();
    try { return await connecting; } finally { connecting = null; }
  };

  const join = async (sessionId: string): Promise<ResumeResult> => {
    const c = await rpc();
    const answer = await c.request<ResumeResult>('session/resume', { sessionId });
    joined.add(sessionId);
    return { state: answer?.state ?? 'idle', turnId: answer?.turnId ?? null, title: answer?.title ?? null, cwd: answer?.cwd ?? null };
  };

  return {
    agent: 'claude-code',
    host,
    async connect() { await rpc(); },
    get connected() { return !!client && !client.closed; },
    close() { client?.close(); },

    async status(): Promise<AgentStatus> {
      let c: RpcClient;
      try {
        c = await rpc();
      } catch (error) {
        return { agent: 'claude-code', host, state: 'offline', reason: error instanceof Error ? error.message : String(error) };
      }
      try {
        const status = await c.request<AgentStatus>('status', undefined, { timeoutMs: 20_000 });
        // The bridge speaks of "this device", its own; from here it is that device by name.
        const reason = remote && status.reason ? status.reason.replace(/on this device/g, `on ${machineName(host)}`).replace(/in a terminal\./, 'in a terminal there.') : status.reason;
        return { ...status, agent: 'claude-code', host, ...(reason ? { reason } : {}) };
      } catch (error) {
        return { agent: 'claude-code', host, state: 'offline', reason: `The Claude Code bridge did not answer: ${error instanceof Error ? error.message : String(error)}` };
      }
    },

    async models() {
      if (modelCache && Date.now() - modelCache.at < MODELS_TTL_MS) return modelCache.list;
      const c = await rpc();
      const answer = await c.request<{ models: ModelEntry[] }>('models', undefined, { timeoutMs: 40_000 });
      modelCache = { at: Date.now(), list: answer?.models ?? [] };
      return modelCache.list;
    },

    async listNative(cwd, limit = 50): Promise<NativeSession[]> {
      const c = await rpc();
      return (await c.request<{ sessions: NativeSession[] }>('sessions/list', { cwd: await there(cwd), limit }))?.sessions ?? [];
    },

    async start({ cwd, picks, title }) {
      const c = await rpc();
      const answer = await c.request<{ sessionId: string; title: string }>('session/start', { cwd: await there(cwd), picks, title });
      joined.add(answer.sessionId);
      return { sessionId: answer.sessionId, title: answer.title || title };
    },

    resume: join,

    async history(sessionId, cursor, limit = 20): Promise<HistoryPage> {
      const c = await rpc();
      const page = await c.request<HistoryPage>('session/history', { sessionId, limit, ...(cursor ? { cursor } : {}) }, { timeoutMs: 60_000 });
      return { turns: page?.turns ?? [], older: page?.older ?? null };
    },

    async send(sessionId, text, picks) {
      if (!joined.has(sessionId)) await join(sessionId);
      const c = await rpc();
      // Opening Claude Code for a session that was let go takes a few seconds.
      return c.request<{ turnId: string }>('turn/send', { sessionId, text, picks }, { timeoutMs: 60_000 });
    },

    async steer(sessionId, turnId, text) {
      if (!joined.has(sessionId)) await join(sessionId);
      const c = await rpc();
      return c.request<{ turnId: string }>('turn/steer', { sessionId, turnId, text });
    },

    async interrupt(sessionId, turnId) {
      if (!joined.has(sessionId)) await join(sessionId);
      const c = await rpc();
      await c.request('turn/interrupt', { sessionId, turnId });
    },

    async answer(approvalId, decision) {
      // One answer per approval: a second, while the first is on its way or after it, is told it is gone, as Codex's is.
      if (!approvals.has(approvalId) || answering.has(approvalId)) throw new ApprovalGoneError();
      answering.add(approvalId);
      try {
        const c = await rpc();
        await c.request('approval/answer', { approvalId, decision });
      } catch (error) {
        if (error instanceof RpcError && error.code === BRIDGE_NOT_FOUND) throw new ApprovalGoneError();
        throw error;
      } finally {
        answering.delete(approvalId);
      }
    },

    async rename(sessionId, title) {
      const c = await rpc();
      await c.request('session/rename', { sessionId, title });
    },

    async archive(sessionId) {
      const c = await rpc();
      await c.request('session/archive', { sessionId });
      joined.delete(sessionId);
    },

    async ownSettings(cwd): Promise<OwnSettings> {
      const c = await rpc();
      const answer = await c.request<{ permissionMode?: string | null }>('settings/own', cwd ? { cwd: await there(cwd) } : {}, { timeoutMs: 10_000 });
      return { permissionMode: typeof answer?.permissionMode === 'string' ? answer.permissionMode : null };
    },

    async loginStart(): Promise<LoginStarted> {
      const c = await rpc();
      // The bridge runs `claude auth login` and answers once it has printed where to sign in.
      const answer = await c.request<{ loginId?: string; url?: string }>('login/start', {}, { timeoutMs: 40_000 });
      if (!answer?.loginId || !answer.url) throw new Error('Claude Code did not say where to sign in.');
      logins.add(answer.loginId);
      return { loginId: answer.loginId, method: 'paste-code', url: answer.url };
    },

    async loginCode(loginId, code) {
      const c = await rpc();
      await c.request('login/code', { loginId, code });
    },

    async loginCancel(loginId) {
      const c = client;
      if (c && !c.closed) {
        try { await c.request('login/cancel', { loginId }); } catch (error) { if (!(error instanceof RpcError && error.code === BRIDGE_NOT_FOUND)) throw error; }
      }
      if (logins.delete(loginId)) sink.login({ loginId, state: 'cancelled' });
    },
  };
}
