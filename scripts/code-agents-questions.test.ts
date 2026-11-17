// Questions an agent asks him, end to end against the stand-ins: Codex's async question (request_user_input_async,
// an agent message the Codex app shows as a choice) and the answer sent the way the Codex app sends it; Codex's
// request_user_input in Plan mode, more access asked for, an MCP server's form and sign-in page, and the time the
// experimental API asks for; Plan mode sent as Codex's collaboration mode; Claude Code's AskUserQuestion through the
// bridge (answered, skipped) and an MCP form there; and the pure mapping both sides share (forms, replies, history).
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_THREAD, REAL, startFakeCodex, type FakeCodex } from './code-agents-fake-codex';
import { createFakeClaudeSdk, type FakeClaudeSdk } from './code-agents-fake-claude-sdk';
import { createBridge, type Bridge } from '../bridge/sessions.ts';
import { listenBridge, type BridgeServer } from '../bridge/server.ts';
import { askResultAnswers, historyTurns } from '../bridge/mapping.ts';
import { codexItem, parseQuestionReply, questionReplyText } from '../src/lib/code-agents/codex';
import { connectRpc, unixSocketTransport, type RpcClient } from '../src/lib/code-agents/transport';
import { answersComplete, formContent, formQuestions, type EventBody, type SessionEvent, type SessionTurn } from '../src/lib/code-agents/protocol';
import { questionReplies, replyEntries } from '../src/lib/code-sessions-ui';

const TASK = 'c0de0000-0000-4000-8000-0000000quest';
const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 5)); } };
const turn = (id: string, status = 'inProgress') => ({ id, items: [], itemsView: 'notLoaded', status, error: null, startedAt: 1794900000, completedAt: status === 'inProgress' ? null : 1794900010, durationMs: null });

let fake: FakeCodex;
let dir: string;
let hub: typeof import('../src/lib/code-agents/hub');
const saved = { ...process.env };
const turnStarts: any[] = [];
let turnCount = 0;
let linkId = '';

/** The async question Codex asked in the session he reported (rollout of 2026-11-17, trimmed). */
const ASYNC = {
  type: 'agentMessage', moderation: null, id: 'call_0a89cfbfb2634127adc343727bc9bacc', phase: 'final_answer', memoryCitation: null, delivery: 'async',
  text: 'Approve this MacBook plan? I’ll launch a separate OpenClaw session…\n- Approve plan\n- Change plan\n- Cancel',
  questions: [{ title: 'Approve this MacBook plan? I’ll launch a separate OpenClaw session…', options: ['Approve plan', 'Change plan', 'Cancel'] }],
};

before(async () => {
  fake = await startFakeCodex();
  dir = fs.mkdtempSync(path.join(os.tmpdir().length > 60 ? '/tmp' : os.tmpdir(), 'code-q-'));
  process.env.BACKEND_DATA_DIR = dir;
  process.env.CODEX_APP_SERVER_SOCKET = fake.socketPath;
  process.env.CODEX_APP_SERVER_FALLBACK = 'none';
  process.env.CLAUDE_BRIDGE_SOCKET = path.join(dir, 'no-claude-bridge.sock');
  fake.on('account/read', () => ({ account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true }));
  fake.on('model/list', () => ({ data: [{ id: 'gpt-a', model: 'gpt-a', displayName: 'GPT A', description: '', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }], defaultReasoningEffort: 'low', isDefault: true }], nextCursor: null }));
  fake.on('config/read', () => ({ config: { approval_policy: 'never', sandbox_mode: 'danger-full-access' } }));
  fake.on('thread/start', (p) => REAL.threadAnswer(DEFAULT_THREAD('th-q', { cwd: p.cwd }), 'gpt-a', 'low', 'never', { type: 'dangerFullAccess' }));
  fake.on('thread/name/set', () => ({}));
  fake.on('thread/resume', (p) => ({ ...REAL.threadAnswer(DEFAULT_THREAD(p.threadId), 'gpt-a', 'low', 'never', { type: 'dangerFullAccess' }), collaborationMode: { mode: 'default', settings: { model: 'gpt-a', reasoning_effort: 'low', developer_instructions: null } } }));
  fake.on('thread/turns/list', () => ({ data: [turn(`turn-${turnCount}`, 'completed')], nextCursor: null }));
  fake.on('turn/start', (p) => { turnStarts.push(p); return { turn: turn(`turn-${++turnCount}`) }; });
  fake.on('turn/steer', (p) => ({ turnId: p.expectedTurnId }));
  fake.on('turn/interrupt', () => ({}));
  fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
  hub = await import('../src/lib/code-agents/hub');
});

after(async () => {
  hub.resetHub();
  await fake.close();
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

const log = () => hub.liveSnapshot(linkId)?.log ?? [];
const finish = async (turnId: string) => {
  fake.notify('turn/completed', { threadId: 'th-q', turn: turn(turnId, 'completed') });
  await until(() => hub.liveSnapshot(linkId)!.turnId === null);
};

test('Codex: the experimental API is asked for, and an async question is a question the pane can answer', async () => {
  const link = await hub.startSession({ taskId: TASK, agent: 'codex', place: { host: 'laptop', cwd: '/repo' }, text: 'Find the sessions', picks: { model: null, effort: null, mode: 'own' }, brief: null });
  linkId = link.id;
  assert.deepEqual(fake.received.find((m) => m.method === 'initialize')!.params.capabilities, { experimentalApi: true });
  await until(() => hub.liveSnapshot(linkId)?.turnId === 'turn-1');
  const T = { threadId: 'th-q', turnId: 'turn-1' };
  fake.notify('item/completed', { ...T, item: ASYNC });
  fake.notify('item/completed', { ...T, item: REAL.agentMessage('msg_after', '**Choose Approve plan above to begin.**') });
  await until(() => log().filter((e) => e.type === 'item-completed').length === 2);
  const asked = log().find((e) => e.type === 'item-completed' && e.item.id === ASYNC.id) as Extract<SessionEvent, { type: 'item-completed' }>;
  assert.deepEqual(asked.item, {
    id: ASYNC.id, startedAt: null, endedAt: null, kind: 'question', via: 'reply', text: ASYNC.text, answers: null, status: 'done',
    questions: [{ id: '0', question: ASYNC.questions[0]!.title, options: [{ label: 'Approve plan' }, { label: 'Change plan' }, { label: 'Cancel' }], other: true }],
  });
  await finish('turn-1');
  // It went on without waiting, so it is no approval: the session is idle, with the question open in the log.
  assert.equal(hub.liveSnapshot(linkId)!.state, 'idle');
  assert.equal(hub.liveSnapshot(linkId)!.approvals.length, 0);
});

test('Codex: the answer goes as the Codex app sends it, as a new turn, or into the turn that runs', async () => {
  const question = ASYNC.questions[0]!.title;
  const { turnId } = await hub.replyToQuestion(linkId, ASYNC.id, [{ questionId: '0', question, answer: 'Approve plan' }]);
  assert.equal(turnId, 'turn-2');
  const sent = turnStarts.at(-1)!;
  assert.equal(sent.turnTrigger, 'send_user_message_async_question');
  // Byte for byte the shape of the Codex app's own answers (its rollouts, 0.169.0).
  assert.equal(sent.input[0].text, `<send_user_message_question_reply>\n[{"questionItemId":"[\\"request_user_input_async\\",\\"${ASYNC.id}\\",0]","question":${JSON.stringify(question)},"answer":"Approve plan"}]\n</send_user_message_question_reply>\n`);
  // Codex's copy of that message reads as his answer, tied to the question.
  const item = codexItem({ type: 'userMessage', id: 'u2', content: [{ type: 'text', text: sent.input[0].text, text_elements: [] }] });
  assert.deepEqual(item, { id: 'u2', startedAt: null, endedAt: null, kind: 'user', text: 'Approve plan', answers: [{ itemId: ASYNC.id, questionId: '0', answer: 'Approve plan' }] });
  // While a turn runs, the answer goes into it.
  await hub.replyToQuestion(linkId, ASYNC.id, [{ questionId: '0', question, answer: 'Change the folder first' }]);
  const steer = fake.received.findLast((m) => m.method === 'turn/steer')!;
  assert.equal(steer.params.expectedTurnId, 'turn-2');
  assert.match(steer.params.input[0].text, /"answer":"Change the folder first"/);
  await finish('turn-2');
});

test('Codex: request_user_input in Plan mode, answered from the Journal; its item shows the answer', async () => {
  await hub.sendToSession(linkId, 'Plan it');
  const id = hub.liveSnapshot(linkId)!.turnId!;
  const ask = fake.request('item/tool/requestUserInput', {
    threadId: 'th-q', turnId: id, itemId: 'rui1', isBlocking: true, autoResolutionMs: null,
    questions: [
      { id: 'scope', header: 'Scope', question: 'How far should it go?', isOther: true, isSecret: false, options: [{ label: 'Just the plan (Recommended)', description: 'Nothing changes yet.' }, { label: 'Plan and build', description: 'It edits files.' }] },
      { id: 'token', header: 'Token', question: 'Paste the token', isOther: false, isSecret: true, options: null },
    ],
  });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  const asked = hub.liveSnapshot(linkId)!.approvals[0]!;
  assert.deepEqual([asked.kind, asked.title, asked.itemId, asked.decisions, hub.liveSnapshot(linkId)!.state], ['question', 'How far should it go?', 'ask-rui1', ['deny', 'cancel'], 'needs-you']);
  assert.deepEqual(asked.questions![0], { id: 'scope', question: 'How far should it go?', header: 'Scope', options: [{ label: 'Just the plan (Recommended)', description: 'Nothing changes yet.' }, { label: 'Plan and build', description: 'It edits files.' }], other: true });
  assert.deepEqual([asked.questions![1]!.secret, asked.questions![1]!.other, asked.questions![1]!.options], [true, true, []]);
  const started = log().find((e) => e.type === 'item-started' && e.item.id === 'ask-rui1') as any;
  assert.deepEqual([started.item.kind, started.item.via, started.item.status], ['question', 'ask', 'running']);
  // Answers it cannot take are refused before Codex hears them.
  await assert.rejects(hub.answerQuestion(linkId, asked.id, { scope: { picked: ['Something else'] } }), (e: unknown) => e instanceof hub.HubError && e.status === 400);
  await assert.rejects(hub.answerQuestion(linkId, asked.id, { scope: { picked: ['Just the plan (Recommended)', 'Plan and build'] } }), (e: unknown) => e instanceof hub.HubError && e.status === 400);
  await assert.rejects(hub.answerQuestion(linkId, asked.id, { nope: { picked: [] } }), (e: unknown) => e instanceof hub.HubError && e.status === 400);
  await hub.answerQuestion(linkId, asked.id, { scope: { picked: ['Just the plan (Recommended)'], other: '' }, token: { picked: [], other: 's3cret' } });
  assert.deepEqual((await ask).result, { answers: { scope: { answers: ['Just the plan (Recommended)'] }, token: { answers: ['s3cret'] } } });
  assert.equal(hub.liveSnapshot(linkId)!.state, 'working');
  const done = log().findLast((e) => e.type === 'item-completed' && e.item.id === 'ask-rui1') as any;
  assert.deepEqual([done.item.status, done.item.answers.scope, done.item.answers.token], ['done', { picked: ['Just the plan (Recommended)'], other: '' }, { picked: [], other: '••••' }]);
  assert.ok(!JSON.stringify(log()).includes('s3cret'), 'a secret answer is not kept in the log');
  // Codex's history leaves the question out: the link keeps it (never the secret), and a page read anew has it.
  const kept = (await import('../src/lib/code-agents/store')).readCodeSessions(TASK)[0]!.answered!;
  assert.deepEqual([kept.length, kept[0]!.turnId, kept[0]!.item.id, kept[0]!.item.answers!.scope!.picked], [1, id, 'ask-rui1', ['Just the plan (Recommended)']]);
  assert.ok(!fs.readFileSync(path.join(dir, 'tasks', 'code-sessions.json'), 'utf-8').includes('s3cret'));
  const read = await hub.sessionDetail(linkId);
  assert.deepEqual(read.turns.find((t) => t.id === id)!.items.map((i) => [i.id, i.kind]), [['ask-rui1', 'question']]);
  await assert.rejects(hub.answerQuestion(linkId, asked.id, { scope: { picked: ['Plan and build'] } }), (e: unknown) => e instanceof hub.HubError && e.status === 404);

  // "Skip and stop": no answers, and the turn is stopped.
  const second = fake.request('item/tool/requestUserInput', { threadId: 'th-q', turnId: id, itemId: 'rui2', isBlocking: true, autoResolutionMs: null, questions: [{ id: 'a', header: 'A', question: 'Which?', isOther: false, isSecret: false, options: [{ label: 'One', description: '' }, { label: 'Two', description: '' }] }] });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  await hub.answerApproval(linkId, hub.liveSnapshot(linkId)!.approvals[0]!.id, 'cancel');
  assert.deepEqual((await second).result, { answers: {} });
  await until(() => fake.received.some((m) => m.method === 'turn/interrupt' && m.params.turnId === id));
  assert.equal((log().findLast((e) => e.type === 'item-completed' && e.item.id === 'ask-rui2') as any).item.status, 'declined');
  await finish(id);
});

test('Codex: more access, an MCP form and sign-in page, and the time it asks for', async () => {
  await hub.sendToSession(linkId, 'Go on');
  const id = hub.liveSnapshot(linkId)!.turnId!;
  const access = fake.request('item/permissions/requestApproval', { threadId: 'th-q', turnId: id, itemId: 'c1', environmentId: null, startedAtMs: 1, cwd: '/repo', reason: 'It needs the network', permissions: { network: { enabled: true }, fileSystem: null } });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  const asked = hub.liveSnapshot(linkId)!.approvals[0]!;
  assert.deepEqual([asked.title, asked.detail, asked.decisions, asked.elsewhere], ['Codex asks for more access', 'It needs the network\n\nNetwork access', ['allow', 'allow-session', 'deny', 'cancel'], undefined]);
  await hub.answerApproval(linkId, asked.id, 'allow-session');
  assert.deepEqual((await access).result, { permissions: { network: { enabled: true } }, scope: 'session' });

  const schema = { type: 'object', properties: { env: { type: 'string', title: 'Environment', enum: ['staging', 'prod'], enumNames: ['Staging', 'Production'] }, count: { type: 'integer', description: 'How many?' }, notify: { type: 'boolean', title: 'Notify' }, tags: { type: 'array', items: { anyOf: [{ const: 'a', title: 'Alpha' }, { const: 'b', title: 'Beta' }] } } }, required: ['env'] };
  const form = fake.request('mcpServer/elicitation/request', { threadId: 'th-q', turnId: id, serverName: 'deployer', mode: 'form', _meta: null, message: 'Where to?', requestedSchema: schema });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  const formAsk = hub.liveSnapshot(linkId)!.approvals[0]!;
  assert.deepEqual([formAsk.kind, formAsk.title, formAsk.detail, formAsk.questions!.map((q) => [q.id, q.options.map((o) => o.label).join('|'), !!q.multi, q.input ?? null])], [
    'question', 'deployer asks for input', 'Where to?', [['env', 'Staging|Production', false, null], ['count', '', false, 'integer'], ['notify', 'Yes|No', false, null], ['tags', 'Alpha|Beta', true, null]],
  ]);
  await hub.answerQuestion(linkId, formAsk.id, { env: { picked: ['Production'] }, count: { picked: [], other: '3' }, notify: { picked: ['No'] }, tags: { picked: ['Beta', 'Alpha'] } });
  assert.deepEqual((await form).result, { action: 'accept', content: { env: 'prod', count: 3, notify: false, tags: ['b', 'a'] }, _meta: null });

  const page = fake.request('mcpServer/elicitation/request', { threadId: 'th-q', turnId: id, serverName: 'github', mode: 'url', _meta: null, message: 'Sign in to GitHub', url: 'https://github.com/login/device', elicitationId: 'e1' });
  await until(() => hub.liveSnapshot(linkId)!.approvals.length === 1);
  const pageAsk = hub.liveSnapshot(linkId)!.approvals[0]!;
  assert.deepEqual([pageAsk.kind, pageAsk.link, pageAsk.decisions], ['other', 'https://github.com/login/device', ['allow', 'deny', 'cancel']]);
  await hub.answerApproval(linkId, pageAsk.id, 'allow');
  assert.equal((await page).result.action, 'accept');

  const time = await fake.request('currentTime/read', { threadId: 'th-q' });
  assert.ok(Math.abs(time.result.currentTimeAt - Date.now() / 1000) < 5);
  await finish(id);
});

test('Codex: “Plan only” is Codex’s Plan mode, and another pick takes it back to Default', async () => {
  await hub.sendToSession(linkId, 'Plan first', { model: null, effort: null, mode: 'plan' });
  assert.deepEqual(turnStarts.at(-1)!.collaborationMode, { mode: 'plan', settings: { model: 'gpt-a', reasoning_effort: 'low', developer_instructions: null } });
  await finish(hub.liveSnapshot(linkId)!.turnId ?? `turn-${turnCount}`);
  await hub.sendToSession(linkId, 'Still planning', { model: null, effort: null, mode: 'plan' });
  assert.equal(turnStarts.at(-1)!.collaborationMode, undefined, 'said once: the thread keeps it');
  await finish(`turn-${turnCount}`);
  await hub.sendToSession(linkId, 'Build it', { model: null, effort: 'high', mode: 'own' });
  assert.deepEqual(turnStarts.at(-1)!.collaborationMode, { mode: 'default', settings: { model: 'gpt-a', reasoning_effort: 'high', developer_instructions: null } });
  await finish(`turn-${turnCount}`);
  await hub.sendToSession(linkId, 'And more', { model: null, effort: 'high', mode: 'own' });
  assert.equal(turnStarts.at(-1)!.collaborationMode, undefined);
  await finish(`turn-${turnCount}`);
});

test('the pane: his answers read back from the messages, which questions are still open, and what is sent', () => {
  const asked = codexItem(ASYNC as never);
  const reply = codexItem({ type: 'userMessage', id: 'u9', content: [{ type: 'text', text: questionReplyText(ASYNC.id, [{ questionId: '0', question: 'Q', answer: 'Approve plan' }]), text_elements: [] }] });
  const turns = (items: unknown[][]): SessionTurn[] => items.map((list, i) => ({ id: `t${i}`, status: 'done', items: list as SessionTurn['items'], error: null, startedAt: null, endedAt: null }));
  // Open until he answers it, or writes something else.
  assert.deepEqual([...questionReplies(turns([[asked]])).open], [ASYNC.id]);
  const answered = questionReplies(turns([[asked], [reply]]));
  assert.deepEqual([answered.open.size, answered.answers.get(ASYNC.id)], [0, { '0': { picked: ['Approve plan'] } }]);
  const free = codexItem({ type: 'userMessage', id: 'u8', content: [{ type: 'text', text: questionReplyText(ASYNC.id, [{ questionId: '0', question: 'Q', answer: 'Not yet' }]), text_elements: [] }] });
  assert.deepEqual(questionReplies(turns([[asked], [free]])).answers.get(ASYNC.id), { '0': { picked: [], other: 'Not yet' } });
  const typed = { id: 'u7', kind: 'user', text: 'something else' };
  assert.equal(questionReplies(turns([[asked], [typed]])).open.size, 0);
  // What the card sends: each question's answer in words, the unanswered left out.
  assert.deepEqual(replyEntries(asked.kind === 'question' ? asked.questions : [], { '0': { picked: [], other: '  Change the folder ' } }), [{ questionId: '0', question: ASYNC.questions[0]!.title, answer: 'Change the folder' }]);
  assert.equal(parseQuestionReply('just text'), null);
  assert.equal(parseQuestionReply('<send_user_message_question_reply>\nnot json\n</send_user_message_question_reply>'), null);
  // A question with options needs an answer; one with none may be left blank unless required.
  assert.equal(answersComplete([{ id: 'a', question: 'A', options: [{ label: 'x' }] }], {}), false);
  assert.equal(answersComplete([{ id: 'a', question: 'A', options: [], other: true }], {}), true);
  assert.equal(formQuestions({ type: 'object', properties: { x: { type: 'object' } } }), null, 'a form the pane cannot ask for');
  assert.deepEqual(formContent({ properties: { s: { type: 'string' } } }, [{ id: 's', question: 's', options: [], other: true }], { s: { picked: [], other: ' hi ' } }), { s: 'hi' });
});

// ---- Claude Code through the bridge.

let sdk: FakeClaudeSdk;
let bridge: Bridge;
let server: BridgeServer;
let socketPath = '';
let rpc: RpcClient;
const heard: { method: string; params: any }[] = [];
const events = (sessionId: string): EventBody[] => heard.filter((h) => h.method === 'session/event' && h.params.sessionId === sessionId).map((h) => h.params.event);

const ASK_INPUT = {
  questions: [
    { question: 'Which library should we use?', header: 'Library', multiSelect: false, options: [{ label: 'date-fns (Recommended)', description: 'Small, tree-shakes.' }, { label: 'Luxon', description: 'Time zones built in.' }] },
    { question: 'Which checks should run?', header: 'Checks', multiSelect: true, options: [{ label: 'Lint', description: '' }, { label: 'Types', description: '' }, { label: 'Tests', description: '' }] },
  ],
};

test('Claude Code: AskUserQuestion is a question card; his answers go back as Claude Code wants them', async () => {
  sdk = createFakeClaudeSdk();
  socketPath = path.join(dir, 'bridge.sock');
  const cwd = path.join(dir, 'repo');
  fs.mkdirSync(cwd, { recursive: true });
  bridge = createBridge({ sdk, claudePath: '/usr/local/bin/claude', env: { PATH: '/usr/bin' }, authStatus: async () => ({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' }), version: async () => '2.1.326', idleMs: 0, interruptGraceMs: 150, log: () => {} });
  server = await listenBridge(bridge, socketPath);
  rpc = await connectRpc(unixSocketTransport(socketPath, 'bridge'));
  rpc.onNotification((method, params) => heard.push({ method, params }));
  assert.equal((await rpc.request<any>('initialize', { clientInfo: { name: 't', title: 't', version: '0' } })).protocol, 3);
  const { sessionId } = await rpc.request<any>('session/start', { cwd, picks: { model: null, effort: null, mode: 'own' }, title: 'Pick a library' });
  const results: any[] = [];
  sdk.script = async (ctx) => {
    ctx.tool('toolu_q', 'AskUserQuestion', ASK_INPUT, 'msg_q', { stream: true });
    const answer = await ctx.ask('AskUserQuestion', ASK_INPUT, { toolUseID: 'toolu_q' });
    results.push(answer);
    if (answer.behavior === 'allow') {
      const given = (answer.updatedInput as { answers: Record<string, string> }).answers;
      ctx.toolResult('toolu_q', `Your questions have been answered: ${Object.entries(given).map(([q, a]) => `"${q}"="${a}"`).join(', ')}. You can now continue with these answers in mind.`, { own: { questions: ASK_INPUT.questions, answers: given } });
    } else ctx.toolResult('toolu_q', answer.message, { isError: true });
    ctx.result();
  };
  await rpc.request('turn/send', { sessionId, text: 'Pick a date library', picks: { model: null, effort: null, mode: 'own' } });
  await until(() => events(sessionId).some((e) => e.type === 'approval-asked'));
  const asked = (events(sessionId).find((e) => e.type === 'approval-asked') as any).approval;
  assert.deepEqual([asked.kind, asked.title, asked.itemId, asked.decisions], ['question', 'Which library should we use?', 'toolu_q', ['deny', 'cancel']]);
  assert.deepEqual(asked.questions, [
    { id: '0', question: 'Which library should we use?', header: 'Library', options: [{ label: 'date-fns (Recommended)', description: 'Small, tree-shakes.' }, { label: 'Luxon', description: 'Time zones built in.' }], other: true },
    { id: '1', question: 'Which checks should run?', header: 'Checks', options: [{ label: 'Lint' }, { label: 'Types' }, { label: 'Tests' }], multi: true, other: true },
  ]);
  // The tool call is a question item in the log, waiting.
  const item = events(sessionId).find((e) => e.type === 'item-started' && e.item.id === 'toolu_q' && e.item.kind === 'question') as any;
  assert.ok(item, 'a question item');
  await assert.rejects(rpc.request('question/answer', { approvalId: 'nope', answers: {} }), /no longer waiting/);
  await rpc.request('question/answer', { approvalId: asked.id, answers: { '0': { picked: ['Luxon'] }, '1': { picked: ['Lint', 'Tests'], other: 'and the build' } } });
  await until(() => events(sessionId).some((e) => e.type === 'turn-completed'));
  assert.deepEqual(results[0], { behavior: 'allow', updatedInput: { ...ASK_INPUT, answers: { 'Which library should we use?': 'Luxon', 'Which checks should run?': 'Lint, Tests, and the build' } } });
  const done = events(sessionId).findLast((e) => e.type === 'item-completed' && e.item.id === 'toolu_q') as any;
  assert.deepEqual([done.item.status, done.item.answers], ['done', { '0': { picked: ['Luxon'] }, '1': { picked: [], other: 'Lint, Tests, and the build' } }]);

  // Skipped: Claude is told he chose not to answer, and the item says so.
  const from = events(sessionId).length;
  await rpc.request('turn/send', { sessionId, text: 'Ask again', picks: { model: null, effort: null, mode: 'own' } });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'approval-asked'));
  await rpc.request('approval/answer', { approvalId: (events(sessionId).slice(from).find((e) => e.type === 'approval-asked') as any).approval.id, decision: 'deny' });
  await until(() => events(sessionId).slice(from).some((e) => e.type === 'turn-completed'));
  assert.match(results[1].message, /chose not to answer/);
  assert.equal((events(sessionId).slice(from).findLast((e) => e.type === 'item-completed' && e.item.id === 'toolu_q') as any).item.status, 'declined');

  // An MCP server's form, through onElicitation.
  const elicited: any[] = [];
  sdk.script = async (ctx) => {
    elicited.push(await ctx.options.onElicitation!({ serverName: 'tracker', message: 'Which board?', mode: 'form', requestedSchema: { type: 'object', properties: { board: { type: 'string', enum: ['Inbox', 'Done'] } }, required: ['board'] } }, { signal: new AbortController().signal }));
    ctx.result();
  };
  const from2 = events(sessionId).length;
  await rpc.request('turn/send', { sessionId, text: 'File it', picks: { model: null, effort: null, mode: 'own' } });
  await until(() => events(sessionId).slice(from2).some((e) => e.type === 'approval-asked'));
  const form = (events(sessionId).slice(from2).find((e) => e.type === 'approval-asked') as any).approval;
  assert.deepEqual([form.kind, form.title, form.detail, form.questions[0].options], ['question', 'tracker asks for input', 'Which board?', [{ label: 'Inbox' }, { label: 'Done' }]]);
  await rpc.request('question/answer', { approvalId: form.id, answers: { board: { picked: ['Done'] } } });
  await until(() => elicited.length === 1);
  assert.deepEqual(elicited[0], { action: 'accept', content: { board: 'Done' } });
  rpc.close();
  await bridge.close();
  await server.close();
});

test('Claude Code: a question read back from the transcript shows what he answered; ExitPlanMode is its plan', () => {
  const questions = [{ id: '0', question: 'How should the override be resolved?', options: [{ label: 'Drop it (Recommended)' }, { label: 'Keep it' }], other: true }, { id: '1', question: 'Which checks?', options: [{ label: 'Lint' }, { label: 'Tests' }], multi: true, other: true }];
  // CLI 2.1.x's words, as a real transcript has them.
  const text = 'Your questions have been answered: "How should the override be resolved?"="Drop it (Recommended)", "Which checks?"="Lint, Tests". You can now continue with these answers in mind.';
  assert.deepEqual(askResultAnswers(questions, text), { '0': { picked: ['Drop it (Recommended)'] }, '1': { picked: ['Lint', 'Tests'] } });
  assert.deepEqual(askResultAnswers(questions.slice(0, 1), 'User has answered your questions: "How should the override be resolved?"="Something of my own". You can now continue with the user\'s answers in mind.'), { '0': { picked: [], other: 'Something of my own' } });
  const at = '2026-11-17T10:00:00.000Z';
  const turns = historyTurns([
    { type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, timestamp: at, message: { role: 'user', content: 'Plan it' } },
    { type: 'assistant', uuid: 'a1', session_id: 's', parent_tool_use_id: null, timestamp: at, message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input: { questions: [{ question: 'How should the override be resolved?', header: 'Override', multiSelect: false, options: [{ label: 'Drop it (Recommended)', description: '' }, { label: 'Keep it', description: '' }] }] } }] } },
    { type: 'user', uuid: 'u2', session_id: 's', parent_tool_use_id: null, timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_ask', content: 'Your questions have been answered: "How should the override be resolved?"="Keep it". You can now continue with these answers in mind.' }] } },
    { type: 'assistant', uuid: 'a2', session_id: 's', parent_tool_use_id: null, timestamp: at, message: { id: 'msg_2', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_plan', name: 'ExitPlanMode', input: { plan: '## Plan\n\n1. Keep the override' } }] } },
  ] as never, '/repo');
  const items = turns[0]!.items;
  const q = items.find((i) => i.id === 'toolu_ask') as any;
  assert.deepEqual([q.kind, q.via, q.status, q.answers, q.questions[0].header], ['question', 'ask', 'done', { '0': { picked: ['Keep it'] } }, 'Override']);
  const plan = items.find((i) => i.id === 'toolu_plan') as any;
  assert.deepEqual([plan.kind, plan.text, plan.steps], ['plan', '## Plan\n\n1. Keep the override', []]);
});
