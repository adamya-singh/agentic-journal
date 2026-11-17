// The hub and the Codex adapter against a stand-in Codex app server (./code-agents-fake-codex.ts): a session started
// from a task, its first turn, streamed items, an approval answered from the Journal and one settled elsewhere, a
// steer and a stop, a usage-limit failure, the numbered event log and its replay, and a dropped connection that is
// made again with the working session joined anew.
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_THREAD, REAL, startFakeCodex, type FakeCodex } from './code-agents-fake-codex';
import { applyEvent, type SessionEvent } from '../src/lib/code-agents/protocol';

const TASK = 'c0de0000-0000-4000-8000-00000000hub1';
let fake: FakeCodex;
let dir: string;
let hub: typeof import('../src/lib/code-agents/hub');
let store: typeof import('../src/lib/code-agents/store');
const saved = { ...process.env };
const turnStarts: any[] = [];
const resumes: string[] = [];
let threadStatus: Record<string, unknown> = { type: 'idle' };
let turnCount = 0;

const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
const log = (linkId: string) => hub.liveSnapshot(linkId)?.log ?? [];
const types = (events: SessionEvent[]) => events.map((e) => e.type);
const turn = (id: string, status = 'inProgress', error: unknown = null) => ({ id, rootTurnId: id, items: [], itemsView: 'notLoaded', status, error, startedAt: 1794900000, completedAt: status === 'inProgress' ? null : 1794900010, durationMs: null });

before(async () => {
  fake = await startFakeCodex();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'code-hub-'));
  process.env.BACKEND_DATA_DIR = dir;
  process.env.CODEX_APP_SERVER_SOCKET = fake.socketPath;
  process.env.CODEX_APP_SERVER_FALLBACK = 'none';
  process.env.CLAUDE_BRIDGE_SOCKET = path.join(dir, 'no-claude-bridge.sock');
  fake.on('account/read', () => ({ account: { type: 'chatgpt', email: 'x@example.com', planType: 'plus' }, requiresOpenaiAuth: true }));
  fake.on('account/rateLimits/read', () => ({ ordinaryUsageAllowed: true, rateLimits: { limitId: 'codex', primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: 1794856885 }, secondary: null, planType: 'plus', rateLimitReachedType: null } }));
  fake.on('model/list', () => ({ data: [
    { id: 'gpt-a', model: 'gpt-a', displayName: 'GPT A', description: '', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low', isDefault: true },
    { id: 'gpt-hidden', model: 'gpt-hidden', displayName: 'Hidden', description: '', hidden: true, supportedReasoningEfforts: [], defaultReasoningEffort: 'low', isDefault: false },
  ], nextCursor: null }));
  fake.on('thread/list', (p) => ({ data: [DEFAULT_THREAD('old-1', { cwd: p.cwd, name: 'Earlier work' }), DEFAULT_THREAD('old-1', { cwd: p.cwd }), DEFAULT_THREAD('old-2', { cwd: p.cwd, preview: 'Second' })], nextCursor: null }));
  fake.on('thread/start', (p) => ({ thread: DEFAULT_THREAD('th-1', { cwd: p.cwd }), model: 'gpt-a', approvalPolicy: p.approvalPolicy, sandbox: { type: 'workspaceWrite' } }));
  fake.on('thread/name/set', (p) => { fake.notify('thread/name/updated', { threadId: p.threadId, threadName: p.name }); return {}; });
  fake.on('thread/resume', (p) => { resumes.push(p.threadId); return { thread: DEFAULT_THREAD(p.threadId, { status: threadStatus, name: 'Resumed' }), model: 'gpt-a', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } }; });
  fake.on('thread/turns/list', (p) => (p.itemsView === 'notLoaded'
    ? { data: [turn(`turn-${turnCount}`, (threadStatus as { type: string }).type === 'active' ? 'inProgress' : 'completed')], nextCursor: null }
    : { data: [{ ...turn('turn-1', 'completed'), itemsView: 'full', items: [
      { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: turnStarts[0]?.input[0].text ?? 'hi', text_elements: [] }] },
      { type: 'agentMessage', id: 'a1', text: 'Hello there' },
    ] }], nextCursor: 'older-cursor' }));
  fake.on('turn/start', (p) => { turnStarts.push(p); return { turn: turn(`turn-${++turnCount}`) }; });
  fake.on('turn/steer', (p) => ({ turnId: p.expectedTurnId }));
  fake.on('turn/interrupt', (p) => { setTimeout(() => fake.notify('turn/completed', { threadId: p.threadId, turn: turn(p.turnId, 'interrupted') }), 5); return {}; });
  fake.on('thread/archive', () => ({}));
  fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  hub = await import('../src/lib/code-agents/hub');
  store = await import('../src/lib/code-agents/store');
});

after(async () => {
  hub.resetHub();
  await fake.close();
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('status, models and the agent’s own sessions for a folder', async () => {
  const status = await hub.agentStatus('codex', 'laptop');
  assert.deepEqual(status, { agent: 'codex', host: 'laptop', state: 'ready', version: '0.169.0', account: { kind: 'subscription', plan: 'plus' }, limits: { windows: [{ label: '5 hours', usedPercent: 40, resetsAt: 1794856885000 }], blocked: false } });
  // The Journal says who it is when it connects.
  const init = fake.received.find((m) => m.method === 'initialize')!;
  assert.deepEqual(init.params, { clientInfo: { name: 'agentic_journal', title: 'Agentic Journal', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  assert.ok(fake.received.some((m) => m.method === 'initialized' && m.id === undefined));
  assert.deepEqual((await hub.agentModels('codex', 'laptop')).map((m) => m.id), ['gpt-a']);
  // A thread listed twice is shown once.
  assert.deepEqual((await hub.nativeSessions('codex', 'laptop', '/repo')).map((s) => [s.sessionId, s.title]), [['old-1', 'Earlier work'], ['old-2', 'Second']]);
  // Claude Code's bridge is not running here: it says so plainly.
  const claude = await hub.agentStatus('claude-code', 'laptop');
  assert.equal(claude.state, 'offline');
  assert.match(claude.reason ?? '', /bridge isn’t running/);
  await assert.rejects(hub.agentModels('claude-code', 'laptop'), (e: unknown) => e instanceof hub.HubError && e.status === 503);
});

let linkId = '';

test('a session started from a task: its first turn, its items, an approval and its end', async () => {
  const link = await hub.startSession({ taskId: TASK, agent: 'codex', place: { host: 'laptop', cwd: '/repo' }, text: 'Make the tests pass', picks: { model: null, effort: 'high', mode: 'auto-edit' }, brief: null });
  linkId = link.id;
  assert.deepEqual([link.sessionId, link.title, link.lastState, store.readCodeSessions(TASK).length], ['th-1', 'Make the tests pass', 'working', 1]);
  const started = fake.received.find((m) => m.method === 'thread/start')!;
  assert.deepEqual(started.params, { cwd: '/repo', approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  await until(() => turnStarts.length === 1);
  // The first turn carries the task's mark and the brief; the effort picked goes with it; the mode was set at the start.
  assert.match(turnStarts[0].input[0].text, new RegExp(`^\\[aj:task:${TASK}\\]`));
  assert.ok(turnStarts[0].input[0].text.endsWith('Make the tests pass'));
  assert.deepEqual([turnStarts[0].effort, turnStarts[0].model, turnStarts[0].approvalPolicy], ['high', undefined, undefined]);
  await until(() => hub.liveSnapshot(linkId)?.turnId === 'turn-1');
  assert.equal(hub.liveSnapshot(linkId)!.state, 'working');

  const seen: SessionEvent[] = [];
  const stop = hub.subscribeTask(TASK, new Map(), (e) => seen.push(e));
  const T = { threadId: 'th-1', turnId: 'turn-1' };
  fake.notify('turn/started', { threadId: 'th-1', turn: turn('turn-1') });
  fake.notify('item/started', { ...T, item: { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: turnStarts[0].input[0].text, text_elements: [] }] } });
  fake.notify('item/started', { ...T, item: { type: 'agentMessage', id: 'a1', text: '' } });
  fake.notify('item/agentMessage/delta', { ...T, itemId: 'a1', delta: 'Running ' });
  fake.notify('item/agentMessage/delta', { ...T, itemId: 'a1', delta: 'the tests.' });
  fake.notify('item/completed', { ...T, item: { type: 'agentMessage', id: 'a1', text: 'Running the tests.' } });
  fake.notify('item/started', { ...T, item: { type: 'commandExecution', id: 'c1', command: 'npm test', cwd: '/repo', status: 'inProgress', aggregatedOutput: null, exitCode: null, durationMs: null } });
  const decision = fake.request('item/commandExecution/requestApproval', { ...T, itemId: 'c1', startedAtMs: 1, command: 'npm test', cwd: '/repo', reason: 'Needs the network' });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  const approval = hub.liveSnapshot(linkId)!.approvals[0]!;
  assert.deepEqual([approval.kind, approval.title, approval.cwd, approval.decisions], ['command', 'Run npm test', '/repo', ['allow', 'allow-session', 'deny', 'cancel']]);
  assert.equal(hub.liveSnapshot(linkId)!.state, 'needs-you');
  assert.equal(store.readCodeSessions(TASK)[0]!.lastState, 'needs-you');
  // Only an answer it offers is taken.
  await assert.rejects(hub.answerApproval(linkId, 'nope', 'allow'), (e: unknown) => e instanceof hub.HubError && e.status === 404);
  await hub.answerApproval(linkId, approval.id, 'allow');
  assert.deepEqual((await decision).result, { decision: 'accept' });
  assert.equal(hub.liveSnapshot(linkId)!.state, 'working');
  fake.notify('serverRequest/resolved', { threadId: 'th-1', requestId: 1000 });
  fake.notify('item/commandExecution/outputDelta', { ...T, itemId: 'c1', delta: 'pass 3\n' });
  fake.notify('item/completed', { ...T, item: { type: 'commandExecution', id: 'c1', command: 'npm test', cwd: '/repo', status: 'completed', aggregatedOutput: 'pass 3\n', exitCode: 0, durationMs: 900 } });
  fake.notify('item/completed', { ...T, item: { type: 'fileChange', id: 'f1', status: 'completed', changes: [{ path: 'src/a.ts', kind: { type: 'update', move_path: null }, diff: '-a\n+b' }] } });
  fake.notify('turn/plan/updated', { ...T, explanation: null, plan: [{ step: 'Run tests', status: 'completed' }, { step: 'Fix', status: 'inProgress' }] });
  fake.notify('turn/diff/updated', { ...T, diff: 'diff --git a/src/a.ts' });
  fake.notify('thread/tokenUsage/updated', { ...T, tokenUsage: { total: { totalTokens: 900, inputTokens: 800, outputTokens: 100 }, last: { totalTokens: 900 }, modelContextWindow: 200000 } });
  fake.notify('configWarning', { summary: 'ignored' });
  fake.notify('item/completed', { ...T, item: { type: 'agentMessage', id: 'a2', text: 'All **3** tests pass now.' } });
  fake.notify('turn/completed', { threadId: 'th-1', turn: turn('turn-1', 'completed') });
  await until(() => hub.liveSnapshot(linkId)!.state === 'idle');
  stop();

  const events = log(linkId);
  // Numbered one by one, in the order they happened; the subscriber saw the same ones.
  for (let i = 1; i < events.length; i++) assert.equal(events[i]!.seq, events[i - 1]!.seq + 1);
  assert.deepEqual(seen.map((e) => e.seq), events.filter((e) => e.seq >= seen[0]!.seq).map((e) => e.seq));
  assert.ok(types(events).includes('approval-asked') && types(events).includes('approval-resolved'));
  assert.equal(types(events).filter((t) => t === 'approval-resolved').length, 1, 'resolved once, by the Journal');
  // The first message shows only what he typed.
  const user = events.find((e) => e.type === 'item-started' && e.item.kind === 'user') as Extract<SessionEvent, { type: 'item-started' }>;
  assert.deepEqual([user.item.kind === 'user' && user.item.text, user.item.kind === 'user' && user.item.framed], ['Make the tests pass', true]);
  assert.deepEqual(events.filter((e) => e.type === 'item-delta').map((e) => (e as { delta: string }).delta), ['Running ', 'the tests.', 'pass 3\n']);
  const plan = events.find((e) => e.type === 'item-updated') as Extract<SessionEvent, { type: 'item-updated' }>;
  assert.deepEqual(plan.item.kind === 'plan' && plan.item.steps, [{ text: 'Run tests', status: 'done' }, { text: 'Fix', status: 'running' }]);
  assert.deepEqual((events.find((e) => e.type === 'usage-changed') as { tokens: unknown }).tokens, { total: 900, input: 800, output: 100, contextWindow: 200000, lastTurn: 900 });
  assert.deepEqual(events.filter((e) => e.type === 'state-changed').map((e) => (e as { state: string }).state), ['needs-you', 'working', 'idle']);
  // The store keeps the glance, never the transcript.
  const stored = store.readCodeSessions(TASK)[0]!;
  assert.deepEqual([stored.lastState, stored.lastLine, stored.workingSince ?? null, !!stored.settledAt], ['idle', 'All 3 tests pass now.', null, true]);
  assert.ok(!fs.readFileSync(store.codeSessionsFilePath(), 'utf8').includes('Running the tests'));
  assert.equal(hub.sessionSummaries(TASK)[0]!.unread, true);
  hub.markSessionSeen(linkId);
  assert.equal(hub.sessionSummaries(TASK)[0]!.unread, false);
});

test('a client that saw part of the stream is given the rest, or told to read the history again', async () => {
  const events = log(linkId);
  const mid = events[5]!.seq;
  const replay: SessionEvent[] = [];
  hub.subscribeTask(TASK, new Map([[linkId, mid]]), (e) => replay.push(e))();
  assert.deepEqual(replay.map((e) => e.seq), events.filter((e) => e.seq > mid).map((e) => e.seq));
  // A seq from before this server started (or after: another server's), or older than the log keeps: a reset.
  for (const bad of [events[0]!.seq - 50, events.at(-1)!.seq + 10]) {
    const got: SessionEvent[] = [];
    hub.subscribeTask(TASK, new Map([[linkId, bad]]), (e) => got.push(e))();
    assert.deepEqual(got.map((e) => e.type), ['reset']);
  }
  assert.deepEqual([...hub.parseAfter('a:1,b:22,bad,c:-1,d:x').entries()], [['a', 1], ['b', 22]]);
});

test('history comes from the agent, with the first message as he typed it', async () => {
  const detail = await hub.sessionDetail(linkId);
  assert.deepEqual(detail.turns.map((t) => t.items.map((i) => [i.kind, 'text' in i ? i.text : ''])), [[['user', 'Make the tests pass'], ['agent', 'Hello there']]]);
  assert.equal(detail.older, 'older-cursor');
  assert.equal(detail.seq, hub.liveSnapshot(linkId)!.seq);
  assert.equal(detail.state, 'idle');
});

test('the next turn, a steer, a stop, picks that changed, and an approval settled in the desktop app', async () => {
  await hub.sendToSession(linkId, 'Now fix the lint', { model: 'gpt-a', effort: 'high', mode: 'plan' });
  // Only what differs from what the thread runs is said: the new mode, as a sandbox. The model picked is the one the
  // thread already runs (thread/start said so), and the effort was sent with the first turn.
  assert.deepEqual([turnStarts[1].model, turnStarts[1].effort, turnStarts[1].approvalPolicy, turnStarts[1].sandboxPolicy], [undefined, undefined, 'on-request', { type: 'readOnly', networkAccess: false }]);
  assert.equal(turnStarts[1].input[0].text, 'Now fix the lint');
  assert.equal(hub.liveSnapshot(linkId)!.turnId, 'turn-2');
  await assert.rejects(hub.sendToSession(linkId, 'again'), (e: unknown) => e instanceof hub.HubError && e.status === 409);
  await hub.steerSession(linkId, 'Only the src folder');
  assert.deepEqual(fake.received.findLast((m) => m.method === 'turn/steer')!.params, { threadId: 'th-1', input: [{ type: 'text', text: 'Only the src folder', text_elements: [] }], expectedTurnId: 'turn-2' });

  // The desktop app answers an approval first: it leaves the Journal's list, and says it was settled elsewhere.
  const answer = fake.request('item/fileChange/requestApproval', { threadId: 'th-1', turnId: 'turn-2', itemId: 'f2', startedAtMs: 1, reason: 'Write outside', grantRoot: '/etc' });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  assert.equal(hub.liveSnapshot(linkId)!.approvals[0]!.title, 'Write files under /etc');
  fake.notify('serverRequest/resolved', { threadId: 'th-1', requestId: 1001 });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 0);
  assert.deepEqual(log(linkId).findLast((e) => e.type === 'approval-resolved'), { ...log(linkId).findLast((e) => e.type === 'approval-resolved')!, decision: null, by: 'elsewhere' });
  void answer;

  // A question it waits on (request_user_input, Plan mode), skipped from here: no answers go back.
  const question = fake.request('item/tool/requestUserInput', { threadId: 'th-1', turnId: 'turn-2', itemId: 'q', questions: [{ id: 'a', header: 'Pick', question: 'Which one?', isOther: false, isSecret: false, options: [{ label: 'One', description: '' }, { label: 'Two', description: '' }] }], isBlocking: true, autoResolutionMs: null });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  const asked = hub.liveSnapshot(linkId)!.approvals[0]!;
  assert.deepEqual([asked.kind, asked.elsewhere, asked.decisions], ['question', undefined, ['deny', 'cancel']]);
  await assert.rejects(hub.answerApproval(linkId, asked.id, 'allow'), (e: unknown) => e instanceof hub.HubError && e.status === 400);
  await hub.answerApproval(linkId, asked.id, 'deny');
  assert.deepEqual((await question).result, { answers: {} });

  await hub.interruptSession(linkId);
  await until(() => hub.liveSnapshot(linkId)!.state === 'idle');
  assert.equal((log(linkId).findLast((e) => e.type === 'turn-completed') as { status: string }).status, 'interrupted');
  await assert.rejects(hub.interruptSession(linkId), (e: unknown) => e instanceof hub.HubError && e.status === 409);
});

test('a turn that fails on the usage limit leaves the session failed, with Codex’s words', async () => {
  await hub.sendToSession(linkId, 'One more');
  const id = hub.liveSnapshot(linkId)!.turnId!;
  const error = { message: 'You’ve hit your usage limit. Try again at 2:21 PM.', codexErrorInfo: 'usageLimitExceeded', additionalDetails: null };
  fake.notify('error', { error, willRetry: false, threadId: 'th-1', turnId: id });
  fake.notify('account/rateLimits/updated', { rateLimits: { limitId: 'codex', primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1794856885 }, secondary: null, planType: 'plus', rateLimitReachedType: 'rate_limit_reached' } });
  fake.notify('turn/completed', { threadId: 'th-1', turn: turn(id, 'failed', error) });
  await until(() => hub.liveSnapshot(linkId)!.state === 'failed');
  const done = log(linkId).findLast((e) => e.type === 'turn-completed') as Extract<SessionEvent, { type: 'turn-completed' }>;
  assert.deepEqual([done.status, done.error, done.limited], ['failed', error.message, true]);
  assert.equal((log(linkId).findLast((e) => e.type === 'usage-changed') as { limits: { blocked: boolean } }).limits.blocked, true);
  assert.equal(store.readCodeSessions(TASK)[0]!.lastLine, error.message);
  assert.equal((await hub.agentStatus('codex', 'laptop')).limits?.windows[0]!.usedPercent, 100, 'the status takes the newer limits');
});

test('a dropped connection: the session reads offline, its approval is lost, and it is joined again', async () => {
  const seen: SessionEvent[] = [];
  const stop = hub.subscribeTask(TASK, new Map(), (e) => seen.push(e));
  await hub.sendToSession(linkId, 'Keep going');
  const id = hub.liveSnapshot(linkId)!.turnId!;
  void fake.request('item/commandExecution/requestApproval', { threadId: 'th-1', turnId: id, itemId: 'c9', startedAtMs: 1, command: 'make' });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  const resumedBefore = resumes.length;
  threadStatus = { type: 'active', activeFlags: [] };
  fake.drop();
  await until(() => hub.liveSnapshot(linkId)!.state === 'offline');
  assert.equal(hub.liveSnapshot(linkId)!.approvals.length, 0);
  assert.equal((seen.findLast((e) => e.type === 'approval-resolved') as { by: string }).by, 'lost');
  // Made again after a pause, the working session is joined anew and its clients read the history again.
  await until(() => resumes.length > resumedBefore && hub.liveSnapshot(linkId)!.state === 'working', 5000);
  assert.equal(hub.liveSnapshot(linkId)!.turnId, id);
  await until(() => seen.some((e) => e.type === 'reset'));
  // The turn ends while it is connected again.
  fake.notify('turn/completed', { threadId: 'th-1', turn: turn(id, 'completed') });
  threadStatus = { type: 'idle' };
  await until(() => hub.liveSnapshot(linkId)!.state === 'idle');
  stop();
});

test('rename, adopt and archive', async () => {
  const renamed = await hub.renameSession(linkId, 'Tests and lint');
  assert.equal(renamed.title, 'Tests and lint');
  assert.deepEqual(fake.received.findLast((m) => m.method === 'thread/name/set')!.params, { threadId: 'th-1', name: 'Tests and lint' });
  const adopted = await hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'laptop', sessionId: 'old-2', picks: { model: null, effort: null, mode: 'auto-edit' } });
  assert.deepEqual([adopted.adopted, adopted.title, adopted.cwd], [true, 'Resumed', '/tmp']);
  // Attached twice to the same task is the same link; to another task, refused.
  assert.equal((await hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'laptop', sessionId: 'old-2', picks: { model: null, effort: null, mode: 'auto-edit' } })).id, adopted.id);
  await assert.rejects(hub.adoptSession({ taskId: 'other', agent: 'codex', host: 'laptop', sessionId: 'old-2', picks: { model: null, effort: null, mode: 'auto-edit' } }), (e: unknown) => e instanceof hub.HubError && e.status === 409);
  await assert.rejects(hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'laptop', sessionId: 'old-1', picks: { model: null, effort: null, mode: 'auto-edit' }, allow: () => 'Not here.' }), /Not here/);
  await hub.archiveSession(adopted.id);
  assert.deepEqual(hub.sessionSummaries(TASK).map((s) => s.id), [linkId]);
  assert.ok(fake.received.some((m) => m.method === 'thread/archive' && m.params.threadId === 'old-2'));
});

test('real shapes: a thread left on another model goes back to the default, and a file-change approval names its files', async () => {
  // A fresh process (as after a Journal restart): it knows nothing it sent before. config.toml names the default
  // model and its effort, which the model list does not.
  hub.resetHub();
  fake.on('config/read', () => ({ config: { model: 'gpt-a', model_reasoning_effort: 'high' }, origins: {} }));
  fake.on('thread/resume', (p) => REAL.threadAnswer(DEFAULT_THREAD(p.threadId, { name: 'On another model' }), 'gpt-other', 'low', 'on-request', { type: 'workspaceWrite', writableRoots: [], networkAccess: false }));
  const models = await hub.agentModels('codex', 'laptop');
  assert.deepEqual(models.map((m) => [m.id, m.isDefault, m.defaultEffort]), [['gpt-a', true, 'high']]);
  const link = await hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'laptop', sessionId: 'old-3', picks: { model: null, effort: null, mode: 'auto-edit' } });
  const before = turnStarts.length;
  const { turnId } = await hub.sendToSession(link.id, 'Carry on');
  // No pick is Codex's default, named, since the thread's own record says it runs on something else.
  assert.deepEqual([turnStarts[before].model, turnStarts[before].effort, turnStarts[before].approvalPolicy], ['gpt-a', 'high', undefined]);

  const T = { threadId: 'old-3', turnId };
  fake.notify('turn/started', { threadId: 'old-3', turn: turn(turnId) });
  fake.notify('item/started', { ...T, item: REAL.commandItem('c1', 'wc -l notes.txt') });
  const asked = fake.request('item/commandExecution/requestApproval', REAL.commandApproval('old-3', turnId, 'c1', 'wc -l notes.txt', 'The sandbox failed; run it outside?'));
  await until(() => hub.liveSnapshot(link.id)!.approvals.length === 1);
  const command = hub.liveSnapshot(link.id)!.approvals[0]!;
  assert.deepEqual([command.title, command.command, command.detail, command.cwd], ['Run wc -l notes.txt', 'wc -l notes.txt', 'The sandbox failed; run it outside?', '/spike']);
  await hub.answerApproval(link.id, command.id, 'allow-session');
  assert.deepEqual((await asked).result, { decision: 'acceptForSession' });
  await until(() => hub.liveSnapshot(link.id)!.approvals.length === 0);

  fake.notify('item/started', { ...T, item: REAL.fileChangeItem('f1') });
  const patch = fake.request('item/fileChange/requestApproval', REAL.fileChangeApproval('old-3', turnId, 'f1'));
  await until(() => hub.liveSnapshot(link.id)!.approvals.length === 1);
  const files = hub.liveSnapshot(link.id)!.approvals[0]!;
  assert.deepEqual([files.kind, files.title, files.files], ['file-change', 'Change files', ['/spike/README.md', '/spike/hello.py']]);
  await hub.answerApproval(link.id, files.id, 'deny');
  assert.deepEqual((await patch).result, { decision: 'decline' });
  fake.notify('item/completed', { ...T, item: REAL.fileChangeItem('f1', 'declined') });
  fake.notify('item/completed', { ...T, item: REAL.agentMessage('a1', 'Counted, and left the files alone.') });
  fake.notify('turn/completed', { threadId: 'old-3', turn: turn(turnId, 'completed') });
  await until(() => hub.liveSnapshot(link.id)!.state === 'idle');
  // Interrupted, Codex can still finish a command after the turn: it lands on the turn it belongs to.
  fake.notify('item/completed', { ...T, item: REAL.commandItem('c1', 'wc -l notes.txt', 'completed', { exitCode: 0, aggregatedOutput: '4 notes.txt\n' }) });
  await until(() => log(link.id).some((e) => e.type === 'item-completed' && e.item.id === 'c1'));
  const done = log(link.id).findLast((e) => e.type === 'item-completed' && e.item.id === 'c1') as Extract<SessionEvent, { type: 'item-completed' }>;
  assert.deepEqual([done.turnId, done.item.kind === 'command' && done.item.command], [turnId, 'wc -l notes.txt']);
  assert.equal(store.readCodeSessions(TASK).find((l) => l.id === link.id)!.lastLine, 'Counted, and left the files alone.');
});

test('events that come in while the history is read are replayed, and replaying what the copy has does no harm', async () => {
  hub.resetHub();
  const link = await hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'laptop', sessionId: 'th-h', picks: { model: null, effort: null, mode: 'auto-edit' } });
  const { turnId } = await hub.sendToSession(link.id, 'Build it');
  const T = { threadId: 'th-h', turnId };
  fake.notify('turn/started', { threadId: 'th-h', turn: turn(turnId) });
  await until(() => log(link.id).some((e) => e.type === 'turn-started'));
  const user = { type: 'userMessage', id: 'u9', content: [{ type: 'text', text: 'Build it', text_elements: [] }] };
  fake.on('thread/turns/list', async (p) => {
    if (p.itemsView === 'notLoaded') return { data: [turn(turnId)], nextCursor: null };
    // While the history is read: an agent message begins and streams a little, and a command starts.
    const had = log(link.id).length;
    fake.notify('item/started', { ...T, item: REAL.agentMessage('a9', '') });
    fake.notify('item/agentMessage/delta', { ...T, itemId: 'a9', delta: 'Hel' });
    fake.notify('item/started', { ...T, item: REAL.commandItem('c9', 'make') });
    await until(() => log(link.id).length >= had + 3);
    // The history read just after: it has the message so far, and (as Codex does) not the running command.
    return { data: [{ ...turn(turnId), itemsView: 'full', items: [user, REAL.agentMessage('a9', 'Hel')] }], nextCursor: null };
  });
  const detail = await hub.sessionDetail(link.id);
  fake.notify('item/agentMessage/delta', { ...T, itemId: 'a9', delta: 'lo' });
  fake.notify('item/commandExecution/outputDelta', { ...T, itemId: 'c9', delta: 'built\n' });
  fake.notify('turn/completed', { threadId: 'th-h', turn: turn(turnId, 'completed') });
  await until(() => log(link.id).some((e) => e.type === 'turn-completed'));
  // The client opens the stream from the detail's seq: everything since, the events during the read included.
  const replay = log(link.id).filter((e) => e.seq > detail.seq);
  assert.ok(replay.some((e) => e.type === 'item-started' && e.item.id === 'a9'), 'the item that began during the read is replayed');
  assert.ok(replay.some((e) => e.type === 'item-started' && e.item.id === 'c9'));
  const turns = structuredClone(detail.turns);
  for (const event of replay) applyEvent(turns, event);
  const items = turns.find((t) => t.id === turnId)!.items;
  assert.equal((items.find((i) => i.id === 'a9') as { text: string }).text, 'Hello', 'no delta counted twice');
  assert.equal((items.find((i) => i.id === 'c9') as { output: string }).output, 'built\n', 'no delta lost');
  assert.equal(turns.find((t) => t.id === turnId)!.status, 'done');
  // The hub numbers where each delta starts once it saw its item begin.
  assert.deepEqual(log(link.id).filter((e) => e.type === 'item-delta').map((e) => (e as { offset?: number }).offset), [0, 3, 0]);
  fake.on('thread/turns/list', () => ({ data: [], nextCursor: null }));
});

test('an approval answered twice at once reaches Codex once; the second hears it is already answered', async () => {
  const link = hub.sessionSummaries(TASK).find((s) => s.sessionId === 'th-h')!;
  const { turnId } = await hub.sendToSession(link.id, 'Write the notes');
  // A command with a blank line in it (a heredoc): carried whole, apart from the reason.
  const script = 'cat > notes.md <<EOF\n# Notes\n\nSecond paragraph.\nEOF\nwc -l notes.md';
  const reply = fake.request('item/commandExecution/requestApproval', REAL.commandApproval('th-h', turnId, 'c10', script, 'The sandbox failed; run it outside?'));
  await until(() => hub.liveSnapshot(link.id)!.approvals.length === 1);
  const asked = hub.liveSnapshot(link.id)!.approvals[0]!;
  assert.deepEqual([asked.command, asked.detail, asked.title], [script, 'The sandbox failed; run it outside?', 'Run cat > notes.md <<EOF # Notes Second paragraph. EOF wc -l notes.md']);
  const answers = () => fake.received.filter((m) => m.method === undefined && m.result && 'decision' in m.result).length;
  const before = answers();
  const both = await Promise.allSettled([hub.answerApproval(link.id, asked.id, 'allow'), hub.answerApproval(link.id, asked.id, 'deny')]);
  assert.deepEqual(both.map((r) => r.status), ['fulfilled', 'rejected']);
  const second = (both[1] as PromiseRejectedResult).reason;
  assert.ok(second instanceof hub.HubError && second.status === 404, String(second));
  assert.deepEqual((await reply).result, { decision: 'accept' });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(answers() - before, 1, 'one answer on the wire');
  await assert.rejects(hub.answerApproval(link.id, asked.id, 'allow'), (e: unknown) => e instanceof hub.HubError && e.status === 404);
  fake.notify('turn/completed', { threadId: 'th-h', turn: turn(turnId, 'completed') });
  await until(() => hub.liveSnapshot(link.id)!.state === 'idle');
});

test('the hub keeps each log small, and lets go of sessions nobody has open', async () => {
  const link = hub.sessionSummaries(TASK).find((s) => s.sessionId === 'th-h')!;
  const { turnId } = await hub.sendToSession(link.id, 'Talk a lot');
  const first = hub.liveSnapshot(link.id)!.log[0]!.seq;
  const big = 'x'.repeat(100_000);
  for (let i = 0; i < 30; i++) fake.notify('item/completed', { threadId: 'th-h', turnId, item: REAL.agentMessage(`big-${i}`, big) });
  fake.notify('turn/completed', { threadId: 'th-h', turn: turn(turnId, 'completed') });
  await until(() => hub.liveSnapshot(link.id)!.state === 'idle');
  const kept = hub.liveSnapshot(link.id)!.log;
  const chars = kept.reduce((n, e) => n + JSON.stringify(e).length, 0);
  assert.ok(chars <= 2_000_000, `kept under its size (${chars})`);
  assert.ok(kept[0]!.seq > first, 'the oldest went first');
  assert.ok(kept.length < 30);
  // A client from before what is kept is told to read the history again.
  const got: SessionEvent[] = [];
  hub.subscribeTask(TASK, new Map([[link.id, first]]), (e) => got.push(e))();
  assert.equal(got.find((e) => e.session === link.id)?.type, 'reset');

  // Quiet a long while, nothing running, nobody watching: let go. Watched, it is kept.
  const stop = hub.subscribeTask(TASK, new Map(), () => {});
  assert.equal(hub.evictIdle(Date.now() + 31 * 60_000), 0);
  stop();
  // (Once the join the stream asked for is done.)
  await until(() => hub.evictIdle(Date.now() + 31 * 60_000) >= 1);
  assert.equal(hub.liveSnapshot(link.id), null);
  // Opened again, it is joined and read from history anew, and its events flow again.
  const detail = await hub.sessionDetail(link.id);
  assert.equal(detail.state, 'idle');
  const again = await hub.sendToSession(link.id, 'Back again');
  fake.notify('turn/completed', { threadId: 'th-h', turn: turn(again.turnId, 'completed') });
  await until(() => hub.liveSnapshot(link.id)?.log.some((e) => e.type === 'turn-completed') ?? false);
});
