// The Claude bridge (bridge/sessions.ts, bridge/server.ts) against a stand-in Agent SDK
// (./code-agents-fake-claude-sdk.ts), over its real unix socket: status and models; a session started and its
// streamed first turn; a tool call with a permission prompt answered allow, allow for the session and deny; a stop;
// a second turn; a turn that fails; the bridge restarted and the session resumed; a transcript changed in a Claude
// app; two clients on one session; a message sent while it works; listing, history pages, rename and archive.
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBridge, SIGNED_OUT_REASON, type AuthInfo, type Bridge } from '../bridge/sessions.ts';
import { listenBridge, type BridgeServer } from '../bridge/server.ts';
import { DENY_MESSAGE, STOP_MESSAGE } from '../bridge/mapping.ts';
import { createFakeClaudeSdk, REAL, type FakeClaudeSdk } from './code-agents-fake-claude-sdk';
import { connectRpc, unixSocketTransport, type RpcClient } from '../src/lib/code-agents/transport';
import { applyEvent, type EventBody, type SessionTurn } from '../src/lib/code-agents/protocol';

let sdk: FakeClaudeSdk;
let bridge: Bridge;
let server: BridgeServer;
let dir: string;
let cwd: string;
let socketPath: string;
let auth: AuthInfo = { loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' };
const clients: RpcClient[] = [];

interface Heard { method: string; params: any }
const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };

async function open(): Promise<{ rpc: RpcClient; heard: Heard[]; events: (sessionId: string) => EventBody[] }> {
  const rpc = await connectRpc(unixSocketTransport(socketPath, 'bridge'));
  clients.push(rpc);
  const heard: Heard[] = [];
  rpc.onNotification((method, params) => heard.push({ method, params }));
  await rpc.request('initialize', { clientInfo: { name: 'test', title: 'Test', version: '0' } });
  return { rpc, heard, events: (sessionId) => heard.filter((h) => h.method === 'session/event' && h.params.sessionId === sessionId).map((h) => h.params.event) };
}

async function startBridge(): Promise<void> {
  bridge = createBridge({ sdk, claudePath: '/usr/local/bin/claude', env: { PATH: '/usr/bin', CLAUDE_CODE_ENTRYPOINT: 'agentic-journal' }, authStatus: async () => auth, version: async () => '2.1.302', idleMs: 0, interruptGraceMs: 150, log: () => {} });
  server = await listenBridge(bridge, socketPath);
}

async function stopBridge(): Promise<void> {
  await bridge.close();
  await server.close();
}

const PICKS: { model: string | null; effort: string | null; mode: string } = { model: null, effort: null, mode: 'auto-edit' };

before(async () => {
  sdk = createFakeClaudeSdk();
  dir = fs.mkdtempSync(path.join(os.tmpdir().length > 60 ? '/tmp' : os.tmpdir(), 'claude-bridge-'));
  cwd = path.join(dir, 'repo');
  fs.mkdirSync(cwd);
  socketPath = path.join(dir, 'bridge.sock');
  await startBridge();
});

after(async () => {
  for (const c of clients) c.close();
  await stopBridge();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('it says who it is, whether Claude Code is signed in, and its models', async () => {
  const { rpc } = await open();
  assert.equal(fs.statSync(socketPath).mode & 0o777, 0o600);
  const status = await rpc.request<any>('status');
  assert.deepEqual([status.state, status.account, status.version], ['ready', { kind: 'subscription', plan: 'max' }, '2.1.302']);
  const { models } = await rpc.request<any>('models');
  // The "default" row is not a model: the model it resolves to is the default.
  assert.deepEqual(models.map((m: any) => [m.id, m.isDefault, m.efforts.length]), [['opus', true, 5], ['haiku', false, 0]]);
  // The models query runs no turn and keeps no transcript.
  assert.equal(sdk.queries.at(-1)!.options.persistSession, false);
  await assert.rejects(rpc.request('nope'), /no method nope/);
  await assert.rejects(rpc.request('session/start', { cwd: path.join(dir, 'missing'), picks: PICKS, title: 'x' }), /There is no folder/);
});

let sessionId = '';
let firstTurn = '';

test('a session: started, its first turn streamed, and a second turn on the same Claude Code process', async () => {
  const { rpc, heard, events } = await open();
  const started = await rpc.request<any>('session/start', { cwd, picks: PICKS, title: 'Fix the flaky test' });
  sessionId = started.sessionId;
  assert.equal(started.title, 'Fix the flaky test');
  const before = sdk.queries.length;
  sdk.script = async (ctx) => { ctx.text('msg_a', 'Hello there', { stream: true }); ctx.result({ usage: { input_tokens: 100, cache_read_input_tokens: 20, output_tokens: 7 } }); };
  const { turnId } = await rpc.request<any>('turn/send', { sessionId, text: 'Make the tests pass', picks: PICKS });
  firstTurn = turnId;
  await until(() => events(sessionId).some((e) => e.type === 'turn-completed'));
  // A new session: its id and title go to Claude Code, which runs as the user's own apps do.
  const q = sdk.queries[before]!;
  assert.equal(sdk.queries.length, before + 1);
  assert.deepEqual(
    [q.options.sessionId, q.options.resume, q.options.title, q.options.cwd, q.options.permissionMode, q.options.pathToClaudeCodeExecutable, q.options.includePartialMessages],
    [sessionId, undefined, 'Fix the flaky test', cwd, 'acceptEdits', '/usr/local/bin/claude', true],
  );
  assert.deepEqual(q.options.settingSources, ['user', 'project', 'local']);
  assert.deepEqual(q.options.systemPrompt, { type: 'preset', preset: 'claude_code' });
  assert.deepEqual(q.options.disallowedTools, ['AskUserQuestion']);
  assert.equal(q.options.env?.CLAUDE_CODE_ENTRYPOINT, 'agentic-journal');
  assert.equal(q.options.allowDangerouslySkipPermissions, undefined);
  // His message carries the turn's id, so the transcript and the live turn agree.
  assert.deepEqual(q.inputs[0], { type: 'user', message: { role: 'user', content: 'Make the tests pass' }, parent_tool_use_id: null, session_id: '', uuid: turnId });

  const seen = events(sessionId);
  assert.deepEqual(seen.map((e) => e.type), ['turn-started', 'item-completed', 'item-started', 'item-delta', 'item-delta', 'item-completed', 'usage-changed', 'turn-completed']);
  assert.deepEqual(seen.filter((e) => e.type === 'item-delta').map((e: any) => [e.itemId, e.delta]), [['msg_a:0', 'Hello '], ['msg_a:0', 'there']]);
  assert.deepEqual((seen[6] as any).tokens, { total: 127, input: 120, output: 7, contextWindow: 200000, lastTurn: 127 });
  assert.deepEqual(seen.at(-1), { ...(seen.at(-1) as any), type: 'turn-completed', turnId, status: 'done', error: null });
  const states = heard.filter((h) => h.method === 'session/state').map((h) => h.params.state);
  assert.deepEqual(states, ['working', 'idle']);

  // The second turn goes into the same query.
  sdk.script = async (ctx) => { ctx.text('msg_b', 'Again'); ctx.result(); };
  const second = await rpc.request<any>('turn/send', { sessionId, text: 'Once more', picks: PICKS });
  await until(() => events(sessionId).filter((e) => e.type === 'turn-completed').length === 2);
  assert.equal(sdk.queries.length, before + 1);
  assert.equal(q.inputs.length, 2);

  // History reads the same turns, with the same ids, as the events built.
  const history = await rpc.request<any>('session/history', { sessionId });
  assert.deepEqual(history.turns.map((t: SessionTurn) => [t.id, t.status, t.items.map((i) => `${i.kind}:${i.id}`)]), [
    [turnId, 'done', [`user:${turnId}`, 'agent:msg_a:0']],
    [second.turnId, 'done', [`user:${second.turnId}`, 'agent:msg_b:0']],
  ]);
  const replayed = events(sessionId).reduce((turns, e) => applyEvent(turns, e), [] as SessionTurn[]);
  assert.deepEqual(replayed.map((t) => t.items.map((i) => (i.kind === 'agent' || i.kind === 'user' ? i.text : i.kind))), [['Make the tests pass', 'Hello there'], ['Once more', 'Again']]);
  // A turn is refused while one runs.
  sdk.script = async (ctx) => { await ctx.interrupted; ctx.result(); };
  await rpc.request('turn/send', { sessionId, text: 'Long one', picks: PICKS });
  await assert.rejects(rpc.request('turn/send', { sessionId, text: 'Too soon', picks: PICKS }), /still working/);
  await rpc.request('turn/interrupt', { sessionId });
  await until(() => events(sessionId).filter((e) => e.type === 'turn-completed').length === 3);
});

test('a permission prompt answered allow, allow for this session, and deny', async () => {
  const { rpc, heard, events } = await open();
  await rpc.request('session/resume', { sessionId });
  const answers: any[] = [];
  const suggestions = [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test' }], behavior: 'allow', destination: 'localSettings' }];
  sdk.script = async (ctx) => {
    ctx.tool('toolu_1', 'Bash', { command: 'npm test', description: 'Run the tests' });
    const answer = await ctx.ask('Bash', { command: 'npm test' }, { toolUseID: 'toolu_1', suggestions, decisionReason: 'Not on the allow list' });
    answers.push(answer);
    if (answer.behavior === 'allow') ctx.toolResult('toolu_1', '3 passing', { own: { stdout: '3 passing', stderr: '' } });
    else ctx.toolResult('toolu_1', answer.message, { isError: true });
    ctx.result();
  };
  const run = async (decision: string) => {
    const from = events(sessionId).length;
    const said = heard.length;
    await rpc.request('turn/send', { sessionId, text: `Run the tests (${decision})`, picks: PICKS });
    await until(() => events(sessionId).slice(from).some((e) => e.type === 'approval-asked'));
    const asked: any = events(sessionId).slice(from).find((e) => e.type === 'approval-asked');
    await until(() => heard.slice(said).some((h) => h.method === 'session/state' && h.params.state === 'needs-you'));
    await rpc.request('approval/answer', { approvalId: asked.approval.id, decision });
    await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
    const command: any = events(sessionId).slice(from).filter((e: any) => e.type === 'item-completed' && e.item.kind === 'command').at(-1);
    return { asked: asked.approval, resolved: events(sessionId).slice(from).find((e) => e.type === 'approval-resolved'), command: command.item };
  };

  const allow = await run('allow');
  assert.deepEqual([allow.asked.kind, allow.asked.title, allow.asked.itemId, allow.asked.cwd, allow.asked.decisions], ['command', 'Run npm test', 'toolu_1', cwd, ['allow', 'allow-session', 'deny', 'cancel']]);
  assert.match(allow.asked.detail, /Not on the allow list/);
  assert.deepEqual(answers[0], { behavior: 'allow', updatedInput: { command: 'npm test' } });
  assert.deepEqual(allow.resolved, { type: 'approval-resolved', approvalId: allow.asked.id, decision: 'allow', by: 'journal' });
  assert.deepEqual([allow.command.status, allow.command.exitCode, allow.command.output, allow.command.command], ['done', 0, '3 passing', 'npm test']);

  // "Allow for this session": Claude Code's own suggestions, kept for this session only.
  await run('allow-session');
  assert.deepEqual(answers[1].updatedPermissions, [{ ...suggestions[0], destination: 'session' }]);

  const deny = await run('deny');
  assert.deepEqual(answers[2], { behavior: 'deny', message: DENY_MESSAGE });
  assert.equal(deny.command.status, 'declined');
  await assert.rejects(rpc.request('approval/answer', { approvalId: deny.asked.id, decision: 'allow' }), /no longer waiting/);
});

test('stopping a turn: a waiting approval is cancelled, and a turn that does not end is ended', async () => {
  const { rpc, events } = await open();
  await rpc.request('session/resume', { sessionId });
  let answer: any = null;
  sdk.script = async (ctx) => {
    ctx.text('msg_s', 'Working', { stream: true });
    answer = await ctx.ask('Write', { file_path: `${cwd}/a.txt`, content: 'x' }, { toolUseID: 'toolu_w' });
    await ctx.interrupted;
    ctx.result({ subtype: 'error_during_execution', is_error: true });
  };
  const from = events(sessionId).length;
  const { turnId } = await rpc.request<any>('turn/send', { sessionId, text: 'Write a file', picks: PICKS });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'approval-asked'));
  const asked: any = events(sessionId).slice(from).find((e) => e.type === 'approval-asked');
  assert.deepEqual([asked.approval.kind, asked.approval.title, asked.approval.files], ['file-change', 'Write a.txt', [`${cwd}/a.txt`]]);
  await rpc.request('turn/interrupt', { sessionId, turnId });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  assert.deepEqual(answer, { behavior: 'deny', message: STOP_MESSAGE, interrupt: true });
  assert.deepEqual(events(sessionId).slice(from).find((e) => e.type === 'approval-resolved'), { type: 'approval-resolved', approvalId: asked.approval.id, decision: 'cancel', by: 'journal' });
  assert.deepEqual((events(sessionId).slice(from).find((e) => e.type === 'turn-completed') as any).status, 'interrupted');

  // Claude Code does not end the turn: the bridge closes its process after a grace period.
  sdk.script = async () => { await new Promise(() => {}); };
  const queries = sdk.queries.length;
  const from2 = events(sessionId).length;
  await rpc.request('turn/send', { sessionId, text: 'Hang', picks: PICKS });
  await rpc.request('turn/interrupt', { sessionId });
  await until(() => events(sessionId).slice(from2).some((e) => e.type === 'turn-completed'));
  assert.equal((events(sessionId).slice(from2).find((e) => e.type === 'turn-completed') as any).status, 'interrupted');
  assert.equal(sdk.queries.at(-1)!.closed, true);
  // The next turn resumes the session in a new process.
  sdk.script = async (ctx) => { ctx.text('msg_after', 'Back'); ctx.result(); };
  await rpc.request('turn/send', { sessionId, text: 'Are you there?', picks: PICKS });
  await until(() => events(sessionId).filter((e) => e.type === 'turn-completed').length >= 3);
  assert.equal(sdk.queries.length, queries + 1);
  assert.equal(sdk.queries.at(-1)!.options.resume, sessionId);
  assert.equal(sdk.queries.at(-1)!.options.sessionId, undefined);
});

test('a turn that fails, then one that works; a sign-in failure says so in the status', async () => {
  const { rpc, events } = await open();
  await rpc.request('session/resume', { sessionId });
  sdk.script = async (ctx) => { ctx.fail('API Error: 500 {"type":"error"}'); };
  let from = events(sessionId).length;
  await rpc.request('turn/send', { sessionId, text: 'Break', picks: PICKS });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  const done: any = events(sessionId).slice(from).find((e) => e.type === 'turn-completed');
  assert.deepEqual([done.status, done.error, done.limited], ['failed', 'API Error: 500 {"type":"error"}', undefined]);
  assert.ok(events(sessionId).slice(from).some((e: any) => e.type === 'item-completed' && e.item.kind === 'notice' && e.item.level === 'error'));
  // The SDK threw after the error result: the session still works, on a resumed process.
  await until(() => !bridge.snapshot().sessions.find((s) => s.id === sessionId)!.live);
  sdk.script = async (ctx) => { ctx.text('msg_ok', 'Fine'); ctx.result(); };
  from = events(sessionId).length;
  await rpc.request('turn/send', { sessionId, text: 'Again', picks: PICKS });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  assert.equal((events(sessionId).slice(from).find((e) => e.type === 'turn-completed') as any).status, 'done');

  // The usage limit.
  sdk.script = async (ctx) => { ctx.fail('Claude AI usage limit reached|1794900000', 'rate_limit'); };
  from = events(sessionId).length;
  await rpc.request('turn/send', { sessionId, text: 'More', picks: PICKS });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  assert.equal((events(sessionId).slice(from).find((e) => e.type === 'turn-completed') as any).limited, true);

  // Signed out: the turn fails, and the status says what to do.
  sdk.script = async (ctx) => { ctx.fail('Failed to authenticate: OAuth session expired and could not be refreshed', 'authentication_failed'); };
  from = events(sessionId).length;
  await rpc.request('turn/send', { sessionId, text: 'Hello?', picks: PICKS });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  const status = await rpc.request<any>('status');
  assert.deepEqual([status.state, status.reason], ['signed-out', SIGNED_OUT_REASON]);
});

test('picks that change open Claude Code again with them; a transcript changed in a Claude app is resumed first', async () => {
  const { rpc, events } = await open();
  await rpc.request('session/resume', { sessionId });
  sdk.script = async (ctx) => { ctx.text(`msg_${Date.now()}`, 'ok'); ctx.result(); };
  const send = async (text: string, picks = PICKS) => {
    const from = events(sessionId).length;
    await rpc.request('turn/send', { sessionId, text, picks });
    await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  };
  await send('Warm up');
  const count = sdk.queries.length;
  await send('Same picks');
  assert.equal(sdk.queries.length, count);
  await send('Full access, Haiku, low effort', { model: 'haiku', effort: 'low', mode: 'full' });
  assert.equal(sdk.queries.length, count + 1);
  assert.equal(sdk.queries[count - 1]!.closed, true);
  const q = sdk.queries.at(-1)!.options;
  assert.deepEqual([q.resume, q.model, q.effort, q.permissionMode, q.allowDangerouslySkipPermissions], [sessionId, 'haiku', 'low', 'bypassPermissions', true]);
  // "Allow for this session" (answered in an earlier test) outlives the Claude Code process it was told to: the
  // query opened again carries it.
  assert.deepEqual(q.allowedTools, ['Bash(npm test)']);
  await send('Plan only', { model: null, effort: null, mode: 'plan' });
  assert.equal(sdk.queries.at(-1)!.options.permissionMode, 'plan');
  assert.deepEqual(sdk.queries.at(-1)!.options.allowedTools, ['Bash(npm test)']);
  // Claude Code's own writes after a turn's result move the transcript's size but are not a change made elsewhere:
  // the same query takes the next turn.
  const kept = sdk.queries.length;
  sdk.trailingWrite(sessionId);
  await send('After its own write', { model: null, effort: null, mode: 'plan' });
  sdk.trailingWrite(sessionId);
  await send('And again', { model: null, effort: null, mode: 'plan' });
  assert.equal(sdk.queries.length, kept);
  const now = sdk.queries.length;
  sdk.touchElsewhere(sessionId);
  await send('After the app', { model: null, effort: null, mode: 'plan' });
  assert.equal(sdk.queries.length, now + 1);
  assert.equal(sdk.queries.at(-1)!.options.resume, sessionId);
});

test('two clients on one session both hear it; one that joins late is asked the waiting approval', async () => {
  const a = await open();
  const b = await open();
  await a.rpc.request('session/resume', { sessionId });
  let answered: any = null;
  sdk.script = async (ctx) => {
    ctx.tool('toolu_m', 'mcp__github__create_issue', { title: 'Bug' });
    answered = await ctx.ask('mcp__github__create_issue', { title: 'Bug' }, { toolUseID: 'toolu_m', title: 'Claude wants to create an issue' });
    ctx.toolResult('toolu_m', 'Created #12');
    ctx.result();
  };
  const fromA = a.events(sessionId).length;
  await a.rpc.request('turn/send', { sessionId, text: 'File the bug', picks: PICKS });
  await until(() => a.events(sessionId).slice(fromA).some((e) => e.type === 'approval-asked'));
  // b joins while the approval waits: it is told the turn running and asked the approval too.
  const resumed = await b.rpc.request<any>('session/resume', { sessionId });
  assert.equal(resumed.state, 'needs-you');
  assert.ok(resumed.turnId);
  await until(() => b.events(sessionId).some((e) => e.type === 'approval-asked'));
  const asked: any = b.events(sessionId).find((e) => e.type === 'approval-asked');
  assert.deepEqual([asked.approval.kind, asked.approval.title, asked.approval.decisions], ['tool', 'Claude wants to create an issue', ['allow', 'deny', 'cancel']]);
  await b.rpc.request('approval/answer', { approvalId: asked.approval.id, decision: 'allow' });
  await until(() => a.events(sessionId).slice(fromA).some((e) => e.type === 'turn-completed') && b.events(sessionId).some((e) => e.type === 'turn-completed'));
  assert.equal(answered.behavior, 'allow');
  const tool: any = a.events(sessionId).slice(fromA).filter((e: any) => e.type === 'item-completed' && e.item.kind === 'tool').at(-1);
  assert.deepEqual([tool.item.name, tool.item.result, tool.item.status], ['github.create_issue', 'Created #12', 'done']);
  // a leaving does not end the session for b.
  a.rpc.close();
  await until(() => server.clients() === clients.filter((c) => !c.closed).length);
  sdk.script = async (ctx) => { ctx.text('msg_b2', 'Still here'); ctx.result(); };
  const fromB = b.events(sessionId).length;
  await b.rpc.request('turn/send', { sessionId, text: 'Ping', picks: PICKS });
  await until(() => b.events(sessionId).slice(fromB).some((e) => e.type === 'turn-completed'));
});

test('a message sent while it works goes into the running turn', async () => {
  const { rpc, events } = await open();
  await rpc.request('session/resume', { sessionId });
  let steered: any = null;
  sdk.script = async (ctx) => {
    ctx.text('msg_st1', 'Starting');
    steered = await ctx.nextInput();
    ctx.text('msg_st2', `Also: ${steered.message.content}`);
    ctx.result();
  };
  const from = events(sessionId).length;
  const { turnId } = await rpc.request<any>('turn/send', { sessionId, text: 'Do the thing', picks: PICKS });
  const answer = await rpc.request<any>('turn/steer', { sessionId, turnId, text: 'and the other thing' });
  assert.equal(answer.turnId, turnId);
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  const users = events(sessionId).slice(from).filter((e: any) => e.type === 'item-completed' && e.item.kind === 'user').map((e: any) => [e.turnId, e.item.text]);
  assert.deepEqual(users, [[turnId, 'Do the thing'], [turnId, 'and the other thing']]);
  // What went into Claude Code carries the id of the item that shows it.
  const steerItem: any = events(sessionId).slice(from).filter((e: any) => e.type === 'item-completed' && e.item.kind === 'user')[1];
  assert.equal(steered.uuid, steerItem.item.id);
  await assert.rejects(rpc.request('turn/steer', { sessionId, turnId, text: 'late' }), /Nothing is running/);
  // Read back, it is still one turn: the transcript marks the message taken in (isQueuedCommand).
  const last = (await rpc.request<any>('session/history', { sessionId })).turns.at(-1);
  assert.deepEqual([last.id, last.items.filter((i: any) => i.kind === 'user').map((i: any) => i.text)], [turnId, ['Do the thing', 'and the other thing']]);
});

test('the bridge restarts: the session is found on disk, resumed, and its history read', async () => {
  const turnsBefore = (await (await open()).rpc.request<any>('session/history', { sessionId, limit: 100 })).turns.length;
  for (const c of clients) c.close();
  clients.length = 0;
  await stopBridge();
  await startBridge();
  const { rpc, events } = await open();
  const resumed = await rpc.request<any>('session/resume', { sessionId });
  assert.deepEqual(resumed, { state: 'idle', turnId: null, title: 'Fix the flaky test', cwd });
  const history = await rpc.request<any>('session/history', { sessionId, limit: 100 });
  assert.equal(history.turns.length, turnsBefore);
  assert.equal(history.turns[0].id, firstTurn);
  sdk.script = async (ctx) => { ctx.text('msg_r', 'Resumed'); ctx.result(); };
  await rpc.request('turn/send', { sessionId, text: 'After the restart', picks: PICKS });
  await until(() => events(sessionId).some((e) => e.type === 'turn-completed'));
  assert.equal(sdk.queries.at(-1)!.options.resume, sessionId);
  await assert.rejects(rpc.request('session/resume', { sessionId: '00000000-0000-4000-8000-000000000000' }), /no session with that id/);
});

test('listing a folder, history a page at a time, rename and archive', async () => {
  const { rpc, events } = await open();
  // Another session in the folder, and one elsewhere.
  const other = await rpc.request<any>('session/start', { cwd, picks: PICKS, title: 'Second' });
  sdk.script = async (ctx) => { ctx.text('msg_o', 'ok'); ctx.result(); };
  await rpc.request('turn/send', { sessionId: other.sessionId, text: 'Hello', picks: PICKS });
  await until(() => events(other.sessionId).some((e) => e.type === 'turn-completed'));
  const listed = await rpc.request<any>('sessions/list', { cwd });
  assert.deepEqual(listed.sessions.map((s: any) => s.title).sort(), ['Fix the flaky test', 'Second']);
  assert.equal(listed.sessions[0].cwd, cwd);
  assert.deepEqual((await rpc.request<any>('sessions/list', { cwd: dir })).sessions, []);

  const all = (await rpc.request<any>('session/history', { sessionId, limit: 100 })).turns;
  const page = await rpc.request<any>('session/history', { sessionId, limit: 2 });
  assert.deepEqual(page.turns.map((t: any) => t.id), all.slice(-2).map((t: any) => t.id));
  assert.equal(page.older, String(all.length - 2));
  const before = await rpc.request<any>('session/history', { sessionId, limit: 2, cursor: page.older });
  assert.deepEqual(before.turns.map((t: any) => t.id), all.slice(-4, -2).map((t: any) => t.id));

  await rpc.request('session/rename', { sessionId: other.sessionId, title: 'Renamed' });
  assert.deepEqual(sdk.renames.at(-1), [other.sessionId, 'Renamed']);
  assert.ok(events(other.sessionId).some((e: any) => e.type === 'title-changed' && e.title === 'Renamed'));

  await rpc.request('session/archive', { sessionId: other.sessionId });
  assert.equal(sdk.transcripts.get(other.sessionId)!.archived, true);
  assert.deepEqual((await rpc.request<any>('sessions/list', { cwd })).sessions.map((s: any) => s.title), ['Fix the flaky test']);
});

test('a session whose info names no folder is found by its transcript', async () => {
  const { rpc } = await open();
  const id = '11111111-2222-4333-8444-555555555555';
  sdk.transcripts.set(id, { cwd, title: 'Old one', messages: [], extra: 0 });
  sdk.hideCwd.add(id);
  // This bridge has no way to find it.
  await assert.rejects(rpc.request('session/resume', { sessionId: id }), /did not say which folder/);
  const found = createBridge({ sdk, claudePath: 'claude', env: {}, authStatus: async () => auth, version: async () => '1', findCwd: async (sid) => (sid === id ? cwd : null), log: () => {} });
  const me = { id: 99, notify: () => {} };
  assert.deepEqual(await found.handle(me, 'session/resume', { sessionId: id }), { state: 'idle', turnId: null, title: 'Old one', cwd });
});

test('signed out, and an API key', async () => {
  const me = { id: 1, notify: () => {} };
  const make = (info: AuthInfo) => createBridge({ sdk, claudePath: 'claude', env: {}, authStatus: async () => info, version: async () => '2.1.302', log: () => {} });
  assert.deepEqual(await make({ loggedIn: false }).handle(me, 'status', {}), { agent: 'claude-code', host: os.hostname(), state: 'signed-out', reason: SIGNED_OUT_REASON, version: '2.1.302' });
  assert.deepEqual(((await make({ loggedIn: true, authMethod: 'api_key' }).handle(me, 'status', {})) as any).account, { kind: 'api-key' });
  const missing = createBridge({ sdk, claudePath: '/nope/claude', env: {}, authStatus: async () => auth, version: async () => null, log: () => {} });
  assert.match(((await missing.handle(me, 'status', {})) as any).reason, /can’t be run here/);
});

// ---- Shapes the real CLI sent (2.1.302 / 2.1.326, the live check of 2026-11-17), through the stand-in.

/** A new session in `cwd` with one turn run by `script`; returns the events of that turn and its id. */
async function oneTurn(script: FakeClaudeSdk['script'], picks = PICKS, title = 'Real shapes') {
  const c = await open();
  const { sessionId: id } = await c.rpc.request<any>('session/start', { cwd, picks, title });
  sdk.script = script;
  const { turnId } = await c.rpc.request<any>('turn/send', { sessionId: id, text: 'Go', picks });
  await until(() => c.events(id).some((e) => e.type === 'turn-completed'));
  return { ...c, id, turnId };
}

test('a real turn: summaries asked for, empty thinking not shown, the task list as one plan, ToolSearch hidden, usage windows', async () => {
  const { id, turnId, events, heard, rpc } = await oneTurn(async (ctx) => {
    ctx.thinking('msg_t1', '');                                   // what the CLI sends without summaries
    ctx.tool('toolu_ts', 'ToolSearch', { query: 'select:TaskCreate,TaskUpdate', max_results: 5 }, 'msg_t1', { stream: true, index: 1 });
    ctx.toolResult('toolu_ts', '[tool_reference]', { own: { matches: ['TaskCreate', 'TaskUpdate'] } });
    ctx.thinking('msg_t2', 'I will make the two tasks first.');
    ctx.tool('toolu_c1', 'TaskCreate', { subject: 'Run date', description: 'Run date', activeForm: 'Running date' }, 'msg_t2', { stream: true, index: 1 });
    ctx.tool('toolu_c2', 'TaskCreate', { subject: 'Run uname', description: 'Run uname', activeForm: 'Running uname' }, 'msg_t2');
    const one = REAL.taskCreated('1', 'Run date');
    ctx.toolResult('toolu_c1', one.text, { own: one.own });
    const two = REAL.taskCreated('2', 'Run uname');
    ctx.toolResult('toolu_c2', two.text, { own: two.own });
    ctx.tool('toolu_u1', 'TaskUpdate', { taskId: '1', status: 'in_progress' }, 'msg_t3');
    const upd = REAL.taskUpdated('1', 'pending', 'in_progress');
    ctx.toolResult('toolu_u1', upd.text, { own: upd.own });
    ctx.emit(REAL.rateLimit);
    ctx.tool('toolu_u2', 'TaskUpdate', { taskId: '1', status: 'completed' }, 'msg_t4');
    ctx.toolResult('toolu_u2', 'Updated task #1 status');
    ctx.text('msg_t5', 'Done.');
    ctx.result();
  });
  // Summaries are asked for (his settings do not turn them off), and nothing else about thinking is changed.
  assert.deepEqual(sdk.queries.at(-1)!.options.extraArgs, { 'thinking-display': 'summarized' });
  const items = events(id).filter((e: any) => e.type === 'item-started' || e.type === 'item-completed').map((e: any) => e.item);
  // The thinking that came without its text is no item at all; the summary is one, begun with its first words.
  assert.ok(!items.some((i: any) => i.id === 'msg_t1:0'), 'no empty thought');
  assert.ok(events(id).some((e: any) => e.type === 'item-delta' && e.itemId === 'msg_t2:0' && e.delta === 'I will make the two tasks first.'));
  assert.ok(!items.some((i: any) => i.kind === 'tool'), 'no ToolSearch or task tool items');
  const plan = items.filter((i: any) => i.kind === 'plan').at(-1);
  assert.equal(plan.id, `tasks:${turnId}`);
  assert.deepEqual(plan.steps, [{ text: 'Run date', status: 'done' }, { text: 'Run uname', status: 'pending' }]);
  const replayed = events(id).reduce((turns, e) => applyEvent(turns, e), [] as SessionTurn[]);
  assert.deepEqual(replayed[0]!.items.map((i) => i.kind), ['user', 'reasoning', 'plan', 'agent']);
  assert.equal((replayed[0]!.items[1] as any).text, 'I will make the two tasks first.');
  // The usage window is in unifiedWindows, a fraction, its reset in seconds.
  const limits = heard.filter((h) => h.method === 'account/limits').at(-1)!.params.limits;
  assert.deepEqual(limits, { windows: [{ label: 'week', usedPercent: 21, resetsAt: 1795244400000 }], blocked: false });
  // History reads the same items: the list kept across the transcript, numbered from the results' text.
  const history = await rpc.request<any>('session/history', { sessionId: id });
  assert.deepEqual(history.turns[0].items.map((i: any) => i.kind), ['user', 'reasoning', 'plan', 'agent']);
  assert.deepEqual(history.turns[0].items[2].steps, plan.steps);

  // A later turn (a new Claude Code process) updates a task the first one made: it is found by its number.
  sdk.script = async (ctx) => {
    ctx.tool('toolu_u3', 'TaskUpdate', { taskId: '2', status: 'in_progress' }, 'msg_t6');
    ctx.toolResult('toolu_u3', 'Updated task #2 status');
    ctx.result();
  };
  const from = events(id).length;
  const { turnId: second } = await rpc.request<any>('turn/send', { sessionId: id, text: 'Next', picks: { ...PICKS, effort: 'high' } });
  await until(() => events(id).slice(from).some((e) => e.type === 'turn-completed'));
  const later: any = events(id).slice(from).filter((e: any) => e.type === 'item-completed' && e.item.kind === 'plan').at(-1);
  assert.deepEqual([later.item.id, later.item.steps], [`tasks:${second}`, [{ text: 'Run date', status: 'done' }, { text: 'Running uname', status: 'running' }]]);
});

test('his settings turn thinking summaries off: none are asked for', async () => {
  sdk.settings = { showThinkingSummaries: false };
  try {
    await oneTurn(async (ctx) => { ctx.text('msg_n', 'ok'); ctx.result(); });
    assert.equal(sdk.queries.at(-1)!.options.extraArgs, undefined);
  } finally {
    sdk.settings = {};
  }
});

test('"allow for this session" on an edit moves the mode, and keeps it for a query opened again; leaving plan mode too', async () => {
  const c = await open();
  const ask = { ...PICKS, mode: 'ask' };
  const { sessionId: id } = await c.rpc.request<any>('session/start', { cwd, picks: ask, title: 'Modes' });
  const answers: any[] = [];
  const turn = async (picks: typeof PICKS, script: FakeClaudeSdk['script'], decide?: string) => {
    sdk.script = script;
    const from = c.events(id).length;
    await c.rpc.request('turn/send', { sessionId: id, text: 'Go', picks });
    if (decide) {
      await until(() => c.events(id).slice(from).some((e) => e.type === 'approval-asked'));
      const asked: any = c.events(id).slice(from).find((e) => e.type === 'approval-asked');
      await c.rpc.request('approval/answer', { approvalId: asked.approval.id, decision: decide });
    }
    await until(() => c.events(id).slice(from).some((e) => e.type === 'turn-completed'));
    return sdk.queries.at(-1)!.options;
  };
  const write = async (ctx: any) => {
    ctx.tool('toolu_w1', 'Write', { file_path: `${cwd}/x.txt`, content: 'hi\n' });
    answers.push(await ctx.ask('Write', { file_path: `${cwd}/x.txt`, content: 'hi\n' }, { toolUseID: 'toolu_w1', ...REAL.writeAsk }));
    ctx.toolResult('toolu_w1', 'File created', { own: { type: 'create', filePath: `${cwd}/x.txt`, structuredPatch: [] } });
    ctx.result();
  };
  const first = await turn(ask, write, 'allow-session');
  assert.equal(first.permissionMode, 'default');
  // Claude Code's own suggestion is a mode for the session.
  assert.deepEqual(answers[0].updatedPermissions, [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }]);
  // The approval's words say the file once (Claude Code's description of a Write is its name).
  const asked: any = c.events(id).find((e) => e.type === 'approval-asked');
  assert.deepEqual([asked.approval.title, asked.approval.detail], ['Write x.txt', undefined]);
  // New picks open Claude Code again: the session keeps the mode it was moved to.
  const reopened = await turn({ ...ask, effort: 'high' }, async (ctx: any) => { ctx.text('msg_m1', 'ok'); ctx.result(); });
  assert.equal(reopened.permissionMode, 'acceptEdits');
  // A mode he picks wins over it.
  const picked = await turn({ ...ask, mode: 'auto-edit' }, async (ctx: any) => { ctx.text('msg_m2', 'ok'); ctx.result(); });
  assert.equal(picked.permissionMode, 'acceptEdits');
  const back = await turn(ask, async (ctx: any) => { ctx.text('msg_m3', 'ok'); ctx.result(); });
  assert.equal(back.permissionMode, 'default');

  // Plan only: leaving plan mode (allowed) leaves it for the session, also for a query opened again.
  const plan = { ...PICKS, mode: 'plan' };
  await turn(plan, async (ctx: any) => {
    ctx.tool('toolu_p', 'ExitPlanMode', { plan: '1. Write p.txt' });
    answers.push(await ctx.ask('ExitPlanMode', { plan: '1. Write p.txt' }, { toolUseID: 'toolu_p', ...REAL.exitPlanAsk }));
    ctx.toolResult('toolu_p', 'User has approved your plan.');
    ctx.result();
  }, 'allow');
  assert.equal(sdk.queries.at(-1)!.options.permissionMode, 'plan');
  const afterPlan = await turn({ ...plan, effort: 'low' }, async (ctx: any) => { ctx.text('msg_m4', 'ok'); ctx.result(); });
  assert.equal(afterPlan.permissionMode, 'default');
});

test('a command allowed for the session is not asked again after Claude Code is opened again', async () => {
  const c = await open();
  const ask = { ...PICKS, mode: 'ask' };
  const { sessionId: id } = await c.rpc.request<any>('session/start', { cwd, picks: ask, title: 'Rules' });
  sdk.script = async (ctx) => {
    ctx.tool('toolu_b', 'Bash', { command: 'touch y.txt && rm y.txt', description: 'Create and remove y.txt' });
    await ctx.ask('Bash', { command: 'touch y.txt && rm y.txt', description: 'Create and remove y.txt' }, { toolUseID: 'toolu_b', ...REAL.bashAsk });
    ctx.toolResult('toolu_b', '', { own: { stdout: '', stderr: '' } });
    ctx.result();
  };
  await c.rpc.request('turn/send', { sessionId: id, text: 'Go', picks: ask });
  await until(() => c.events(id).some((e) => e.type === 'approval-asked'));
  const asked: any = c.events(id).find((e) => e.type === 'approval-asked');
  // Its description is the command's own: said once.
  assert.equal(asked.approval.detail, 'Create and remove y.txt');
  await c.rpc.request('approval/answer', { approvalId: asked.approval.id, decision: 'allow-session' });
  await until(() => c.events(id).some((e) => e.type === 'turn-completed'));
  sdk.script = async (ctx) => { ctx.text('msg_r2', 'ok'); ctx.result(); };
  await c.rpc.request('turn/send', { sessionId: id, text: 'Again', picks: { ...ask, model: 'haiku' } });
  await until(() => c.events(id).filter((e) => e.type === 'turn-completed').length === 2);
  assert.deepEqual(sdk.queries.at(-1)!.options.allowedTools, ['Bash(touch y.txt)', 'Bash(rm y.txt)']);
});

test('Stop in the middle of a command: it reads stopped, not declined, live and in history', async () => {
  const c = await open();
  const { sessionId: id } = await c.rpc.request<any>('session/start', { cwd, picks: PICKS, title: 'Stop' });
  sdk.script = async (ctx) => {
    ctx.tool('toolu_long', 'Bash', { command: "python3 -c 'import time; time.sleep(60)'" }, 'msg_l', { stream: true });
    await ctx.interrupted;
    ctx.stoppedTool('toolu_long');
    ctx.result({ subtype: 'error_during_execution', is_error: true });
  };
  const { turnId } = await c.rpc.request<any>('turn/send', { sessionId: id, text: 'Sleep', picks: PICKS });
  await until(() => c.events(id).some((e: any) => e.type === 'item-updated' && e.item.id === 'toolu_long'));
  await c.rpc.request('turn/interrupt', { sessionId: id, turnId });
  await until(() => c.events(id).some((e) => e.type === 'turn-completed'));
  const live: any = c.events(id).filter((e: any) => e.type === 'item-completed' && e.item.id === 'toolu_long').at(-1);
  assert.equal(live.item.status, 'failed');
  // Claude Code writes "No response requested." when the next message comes: not shown, and not the stopped turn's end.
  sdk.transcripts.get(id)!.messages.push({ type: 'assistant', uuid: 'syn1', session_id: id, parent_tool_use_id: null, timestamp: new Date(Date.now() + 3_600_000).toISOString(), message: { id: 'syn', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: 'No response requested.' }] } });
  const history = await c.rpc.request<any>('session/history', { sessionId: id });
  const t = history.turns[0];
  assert.deepEqual([t.status, t.items.map((i: any) => `${i.kind}:${i.status ?? ''}`)], ['interrupted', ['user:', 'command:failed']]);
  assert.ok(t.endedAt - t.startedAt < 60_000);
});
