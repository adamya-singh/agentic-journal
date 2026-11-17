// The Claude Code adapter (src/lib/code-agents/claude.ts) and the hub against a running test bridge (the real bridge
// with a stand-in SDK, ./code-agents-fake-claude-sdk.ts): no bridge running says so plainly; status, models, the
// folder's own sessions; a session started from a task through the hub, its turn, an approval answered from the
// Journal; the bridge going away mid-approval and coming back; and the bridge's `proxy` mode carrying the same
// protocol over stdio, as `ssh <host> …` will.
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Duplex } from 'node:stream';
import { createBridge, type Bridge } from '../bridge/sessions.ts';
import { listenBridge, type BridgeServer } from '../bridge/server.ts';
import { createFakeClaudeSdk, type FakeClaudeSdk } from './code-agents-fake-claude-sdk';
import type { AdapterSink, NativeState } from '../src/lib/code-agents/adapter';
import type { EventBody, SessionEvent } from '../src/lib/code-agents/protocol';
import { connectRpc, webSocketTransport } from '../src/lib/code-agents/transport';

const TASK = 'c0de0000-0000-4000-8000-0000000claud';
let sdk: FakeClaudeSdk;
let bridge: Bridge;
let server: BridgeServer | null = null;
let dir: string;
let cwd: string;
let socketPath: string;
let claude: typeof import('../src/lib/code-agents/claude');
let hub: typeof import('../src/lib/code-agents/hub');
let store: typeof import('../src/lib/code-agents/store');
const saved = { ...process.env };
const PICKS = { model: null, effort: null, mode: 'auto-edit' as const };

const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };

async function startBridge() {
  bridge = createBridge({ sdk, claudePath: '/usr/local/bin/claude', env: {}, authStatus: async () => ({ loggedIn: true, subscriptionType: 'max' }), version: async () => '2.1.302', idleMs: 0, log: () => {} });
  server = await listenBridge(bridge, socketPath);
}
async function stopBridge() {
  await bridge.close();
  await server?.close();
  server = null;
}

function recordingSink() {
  const events: [string, EventBody][] = [];
  const states: [string, NativeState][] = [];
  const connections: [boolean, string | undefined][] = [];
  const sink: AdapterSink = {
    event: (id, body) => events.push([id, body]),
    nativeState: (id, state) => states.push([id, state]),
    limits: () => {},
    connection: (up, reason) => connections.push([up, reason]),
    login: () => {},
  };
  return { sink, events, states, connections };
}

before(async () => {
  sdk = createFakeClaudeSdk();
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir().length > 60 ? '/tmp' : os.tmpdir(), 'claude-adapter-')));
  cwd = path.join(dir, 'repo');
  fs.mkdirSync(cwd);
  fs.mkdirSync(path.join(dir, 'tasks'));
  socketPath = path.join(dir, 'bridge.sock');
  Object.assign(process.env, { BACKEND_DATA_DIR: dir, CLAUDE_BRIDGE_SOCKET: socketPath, CODEX_APP_SERVER_SOCKET: path.join(dir, 'no-codex.sock'), CODEX_APP_SERVER_FALLBACK: 'none' });
  claude = await import('../src/lib/code-agents/claude');
  hub = await import('../src/lib/code-agents/hub');
  store = await import('../src/lib/code-agents/store');
});

after(async () => {
  hub.resetHub();
  if (server) await stopBridge();
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('with no bridge running, the status says how to start it', async () => {
  const { sink } = recordingSink();
  const adapter = claude.createClaudeAdapter({ host: 'laptop', sink });
  assert.deepEqual(await adapter.status(), { agent: 'claude-code', host: 'laptop', state: 'offline', reason: claude.BRIDGE_NOT_RUNNING });
  await assert.rejects(adapter.connect(), /bridge isn’t running/);
  // Through the hub, the routes' answer: offline with that reason, and a start is refused as unreachable.
  assert.deepEqual(await hub.agentStatus('claude-code', 'laptop'), { agent: 'claude-code', host: 'laptop', state: 'offline', reason: claude.BRIDGE_NOT_RUNNING });
  await assert.rejects(hub.agentModels('claude-code', 'laptop'), (e: unknown) => e instanceof hub.HubError && e.status === 503);
  hub.resetHub();
});

test('the adapter against a running bridge: status, models, a session, its turn and an approval', async () => {
  await startBridge();
  const { sink, events, states, connections } = recordingSink();
  const adapter = claude.createClaudeAdapter({ host: 'laptop', sink });
  assert.deepEqual(await adapter.status(), { agent: 'claude-code', host: 'laptop', state: 'ready', version: '2.1.302', account: { kind: 'subscription', plan: 'max' } });
  assert.deepEqual(connections, [[true, undefined]]);
  assert.deepEqual((await adapter.models()).map((m) => m.id), ['opus', 'haiku']);

  const { sessionId, title } = await adapter.start({ cwd, picks: PICKS, title: 'From the adapter' });
  assert.equal(title, 'From the adapter');
  sdk.script = async (ctx) => {
    ctx.tool('toolu_1', 'Bash', { command: 'ls' });
    const answer = await ctx.ask('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' });
    ctx.toolResult('toolu_1', answer.behavior === 'allow' ? 'a.txt' : 'no', { isError: answer.behavior !== 'allow' });
    ctx.text('msg_1', 'There is one file.', { stream: true });
    ctx.result();
  };
  const { turnId } = await adapter.send(sessionId, 'What is here?', PICKS);
  await until(() => events.some(([, e]) => e.type === 'approval-asked'));
  const asked = events.find(([, e]) => e.type === 'approval-asked')![1] as Extract<EventBody, { type: 'approval-asked' }>;
  assert.deepEqual([asked.approval.turnId, asked.approval.title], [turnId, 'Run ls']);
  assert.deepEqual(states.at(-1), [sessionId, 'needs-you']);
  await adapter.answer(asked.approval.id, 'allow');
  await until(() => events.some(([, e]) => e.type === 'turn-completed'));
  await assert.rejects(adapter.answer(asked.approval.id, 'allow'), /no longer waiting/);
  assert.deepEqual(states.at(-1), [sessionId, 'idle']);
  assert.ok(events.every(([id]) => id === sessionId));
  assert.ok(events.some(([, e]) => e.type === 'item-delta'));

  const page = await adapter.history(sessionId);
  assert.deepEqual(page.turns.map((t) => [t.id, t.items.map((i) => i.kind)]), [[turnId, ['user', 'command', 'agent']]]);
  assert.equal(page.older, null);
  assert.deepEqual((await adapter.listNative(cwd)).map((s) => [s.sessionId, s.title]), [[sessionId, 'From the adapter']]);
  assert.deepEqual(await adapter.resume(sessionId), { state: 'idle', turnId: null, title: 'From the adapter', cwd });
  await adapter.rename(sessionId, 'Renamed');
  assert.deepEqual(sdk.renames.at(-1), [sessionId, 'Renamed']);
  adapter.close();
});

test('the connection drops with an approval waiting; a new one is asked it again', async () => {
  const { sink, events, connections } = recordingSink();
  const adapter = claude.createClaudeAdapter({ host: 'laptop', sink });
  const { sessionId } = await adapter.start({ cwd, picks: PICKS, title: 'Drops' });
  let answered: any = null;
  sdk.script = async (ctx) => { answered = await ctx.ask('Bash', { command: 'make' }, { toolUseID: 'toolu_x' }); ctx.result(); };
  await adapter.send(sessionId, 'Build it', PICKS);
  await until(() => events.some(([, e]) => e.type === 'approval-asked'));
  const asked = events.find(([, e]) => e.type === 'approval-asked')![1] as Extract<EventBody, { type: 'approval-asked' }>;
  // The connection drops (the bridge keeps running): to the hub the approval is lost.
  adapter.close();
  await until(() => connections.some(([up]) => !up));
  // A new connection that joins the session is asked again, and its answer reaches Claude Code.
  const again = recordingSink();
  const next = claude.createClaudeAdapter({ host: 'laptop', sink: again.sink });
  const resumed = await next.resume(sessionId);
  assert.equal(resumed.state, 'needs-you');
  await until(() => again.events.some(([, e]) => e.type === 'approval-asked'));
  await next.answer(asked.approval.id, 'deny');
  await until(() => again.events.some(([, e]) => e.type === 'turn-completed'));
  assert.equal(answered.behavior, 'deny');

  // The bridge itself stops: the adapter says the connection went, with what it held lost.
  sdk.script = async (ctx) => { await ctx.ask('Bash', { command: 'sleep' }, { toolUseID: 'toolu_y' }); ctx.result(); };
  await next.send(sessionId, 'Again', PICKS);
  await until(() => again.events.filter(([, e]) => e.type === 'approval-asked').length === 2);
  const held = (again.events.filter(([, e]) => e.type === 'approval-asked').at(-1)![1] as Extract<EventBody, { type: 'approval-asked' }>).approval.id;
  // The socket goes (the bridge is killed, say): what the adapter held is lost to the hub.
  await server!.close();
  server = null;
  await until(() => again.connections.some(([up]) => !up));
  assert.ok(again.events.some(([, e]) => e.type === 'approval-resolved' && e.approvalId === held && e.by === 'lost'));
  assert.equal(next.connected, false);
  assert.deepEqual(await next.status(), { agent: 'claude-code', host: 'laptop', state: 'offline', reason: claude.BRIDGE_NOT_RUNNING });
  await bridge.close();
});

test('through the hub: a Claude Code session started from a task', async () => {
  await startBridge();
  hub.resetHub();
  sdk.script = async (ctx) => { ctx.text('msg_h', 'All three tests pass now.', { stream: true }); ctx.result(); };
  const link = await hub.startSession({ taskId: TASK, agent: 'claude-code', place: { host: 'laptop', cwd }, text: 'Make the tests pass', picks: PICKS, brief: null });
  assert.equal(link.agent, 'claude-code');
  const seen: SessionEvent[] = [];
  const stop = hub.subscribeTask(TASK, new Map(), (e) => seen.push(e));
  await until(() => seen.some((e) => e.type === 'turn-completed'));
  stop();
  // The first turn carries the task's mark; the hub shows only what he typed.
  const sent = sdk.queries.at(-1)!.inputs[0]!.message.content;
  assert.match(sent, new RegExp(`^\\[aj:task:${TASK}\\]`));
  const user = seen.find((e) => e.type === 'item-completed' && e.item.kind === 'user') as any;
  assert.deepEqual([user.item.text, user.item.framed], ['Make the tests pass', true]);
  await until(() => store.readCodeSessions(TASK)[0]?.lastLine === 'All three tests pass now.');
  const detail = await hub.sessionDetail(link.id);
  assert.deepEqual([detail.state, detail.turns.length, detail.turns[0]!.items.map((i) => i.kind)], ['idle', 1, ['user', 'agent']]);
  assert.equal(detail.turns[0]!.items[0]!.kind === 'user' && detail.turns[0]!.items[0]!.text, 'Make the tests pass');
  assert.equal((await hub.agentStatus('claude-code', 'laptop')).state, 'ready');

  // An approval answered twice: once at the same moment, once after. Both extra answers hear "already answered"
  // (404), as with Codex, not that the answer failed to arrive.
  const heredoc = "cat > notes.md <<'EOF'\n# Notes\n\nMore.\nEOF";
  let answers = 0;
  sdk.script = async (ctx) => {
    ctx.tool('toolu_2', 'Bash', { command: heredoc });
    await ctx.ask('Bash', { command: heredoc, description: 'Write the notes' }, { toolUseID: 'toolu_2' });
    answers += 1;
    ctx.toolResult('toolu_2', 'ok');
    ctx.result();
  };
  const watch = hub.subscribeTask(TASK, new Map(), () => {});
  await hub.sendToSession(link.id, 'Write the notes');
  await until(() => hub.liveSnapshot(link.id)!.approvals.length === 1);
  const asked = hub.liveSnapshot(link.id)!.approvals[0]!;
  assert.deepEqual([asked.command, asked.detail], [heredoc, 'Write the notes']);
  const both = await Promise.allSettled([hub.answerApproval(link.id, asked.id, 'allow'), hub.answerApproval(link.id, asked.id, 'allow')]);
  assert.deepEqual(both.map((r) => r.status), ['fulfilled', 'rejected']);
  const second = (both[1] as PromiseRejectedResult).reason;
  assert.ok(second instanceof hub.HubError && second.status === 404, String(second));
  await until(() => hub.liveSnapshot(link.id)!.state === 'idle');
  await assert.rejects(hub.answerApproval(link.id, asked.id, 'allow'), (e: unknown) => e instanceof hub.HubError && e.status === 404);
  // The adapter on its own says so in a way the hub knows (ApprovalGoneError, as is the bridge's "no such approval").
  const { sink } = recordingSink();
  const direct = claude.createClaudeAdapter({ host: 'laptop', sink });
  await assert.rejects(direct.answer(asked.id, 'allow'), (e: unknown) => e instanceof Error && e.name === 'ApprovalGoneError');
  direct.close();
  assert.equal(answers, 1);
  watch();
  hub.resetHub();
});

test('proxy mode carries the protocol over stdio', async () => {
  const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(import.meta.dirname, '..', 'bridge', 'claude-bridge.ts'), 'proxy', '--socket', socketPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    // ws speaks over any byte pipe that looks enough like a socket.
    const pipe = Object.assign(Duplex.from({ readable: child.stdout, writable: child.stdin }), { setTimeout() { return this; }, setNoDelay() { return this; }, setKeepAlive() { return this; } });
    const rpc = await connectRpc(webSocketTransport({ label: 'proxy', url: 'ws://bridge/', createConnection: () => pipe as never }));
    const init = await rpc.request<any>('initialize', { clientInfo: { name: 'proxy-test', title: 'x', version: '0' } });
    assert.equal(init.protocol, 3);
    assert.equal((await rpc.request<any>('status')).state, 'ready');
    rpc.close();
    pipe.destroy();
  } finally {
    child.kill();
  }
  // With no bridge there, it says so and ends.
  const lonely = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(import.meta.dirname, '..', 'bridge', 'claude-bridge.ts'), 'proxy', '--socket', path.join(dir, 'none.sock')], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  lonely.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise<number | null>((resolve) => lonely.once('exit', resolve));
  assert.equal(code, 1);
  assert.match(stderr, /can’t be reached/);
});
