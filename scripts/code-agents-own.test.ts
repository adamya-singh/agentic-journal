// The `own` permission mode, the default for new sessions: the agent's own settings on the device. Codex against the
// stand-in app server: nothing is said about approvals or the sandbox on thread/start or turn/start while the thread
// runs on config.toml's own values; a thread moved to another mode is told them to come back; what they come to is
// read from config/read. Claude Code against the real bridge with the stand-in SDK: no permissionMode is given, and
// `settings/own` says what Claude Code's settings name. The routes: `own` needs no confirming, even as full access.
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { DEFAULT_THREAD, startFakeCodex, type FakeCodex } from './code-agents-fake-codex';
import { createFakeClaudeSdk, type FakeClaudeSdk } from './code-agents-fake-claude-sdk';
import { createBridge, type Bridge } from '../bridge/sessions.ts';
import { listenBridge, type BridgeServer } from '../bridge/server.ts';
import { DEFAULT_PICKS, PERMISSION_MODES, type SessionPicks } from '../src/lib/code-agents/protocol';
import { ownWords } from '../src/lib/code-sessions-ui';
import { policyOf, sandboxPolicy } from '../src/lib/code-agents/codex';

const TASK = 'c0de0000-0000-4000-8000-0000000000own';
const URL = 'http://127.0.0.1:3000/api/tasks/sessions';
const SAME = { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3000' };
let fake: FakeCodex;
let sdk: FakeClaudeSdk;
let bridge: Bridge;
let server: BridgeServer;
let dir: string;
let repo: string;
let hub: typeof import('../src/lib/code-agents/hub');
let route: typeof import('../src/app/api/tasks/sessions/route');
const saved = { ...process.env };
const turnStarts: any[] = [];
/** What config.toml says, as config/read answers it. */
let config: Record<string, unknown> = { model: 'gpt-a', model_reasoning_effort: 'low', approval_policy: 'never', sandbox_mode: 'danger-full-access', sandbox_workspace_write: null };
const resumeAnswer: { approvalPolicy: unknown; sandbox: unknown } = { approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite', writableRoots: [], networkAccess: false } };
let turnCount = 0;

const OWN: SessionPicks = { ...DEFAULT_PICKS };
const until = async (ok: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); } };
const post = (body: unknown) => route.POST(new NextRequest(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SAME }, body: JSON.stringify(body) }));
const get = (query: string) => route.GET(new NextRequest(`${URL}?${query}`, { headers: SAME }));
const json = async (response: Response) => ({ status: response.status, body: await response.json() });
const turn = (id: string, status = 'inProgress') => ({ id, items: [], status, error: null, startedAt: 1794900000, completedAt: status === 'inProgress' ? null : 1794900010, durationMs: null });
/** Ends the turn the hub sent last, so the session takes the next one. */
const finish = async (linkId: string, threadId: string) => {
  const id = hub.liveSnapshot(linkId)!.turnId!;
  fake.notify('turn/completed', { threadId, turn: turn(id, 'completed') });
  await until(() => hub.liveSnapshot(linkId)!.state === 'idle');
};

before(async () => {
  fake = await startFakeCodex();
  sdk = createFakeClaudeSdk();
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir().length > 60 ? '/tmp' : os.tmpdir(), 'code-own-')));
  repo = path.join(dir, 'workspace');
  fs.mkdirSync(repo);
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'tasks', 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [{ id: TASK, text: 'Tidy the repo' }] }));
  Object.assign(process.env, {
    BACKEND_DATA_DIR: dir, OPENCLAW_WORKSPACE_DIR: repo, PROJ_REGISTRY_DIR: path.join(dir, 'no-registry'), PROJ_HOST: 'laptop',
    CODEX_APP_SERVER_SOCKET: fake.socketPath, CODEX_APP_SERVER_FALLBACK: 'none', CLAUDE_BRIDGE_SOCKET: path.join(dir, 'bridge.sock'),
  });
  fake.on('account/read', () => ({ account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true }));
  fake.on('account/rateLimits/read', () => { throw new Error('no limits'); });
  fake.on('config/read', () => ({ config, origins: {} }));
  fake.on('model/list', () => ({ data: [{ id: 'gpt-a', model: 'gpt-a', displayName: 'GPT A', description: '', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', isDefault: true }], nextCursor: null }));
  // As the real daemon: thread/start answers with what the thread runs on, config.toml's own values when none are given.
  fake.on('thread/start', (p) => ({
    thread: DEFAULT_THREAD(`th-${Date.now()}`, { cwd: p.cwd }), model: 'gpt-a', reasoningEffort: 'low',
    approvalPolicy: p.approvalPolicy ?? config.approval_policy, sandbox: p.sandbox ?? config.sandbox_mode,
  }));
  fake.on('thread/name/set', () => ({}));
  fake.on('thread/resume', (p) => ({ thread: DEFAULT_THREAD(p.threadId, { cwd: repo, name: 'From the app' }), model: 'gpt-a', reasoningEffort: 'low', ...resumeAnswer }));
  fake.on('thread/turns/list', () => ({ data: [], nextCursor: null }));
  fake.on('turn/start', (p) => { turnStarts.push(p); return { turn: turn(`turn-${++turnCount}`) }; });
  bridge = createBridge({ sdk, claudePath: '/usr/local/bin/claude', env: {}, authStatus: async () => ({ loggedIn: true, subscriptionType: 'max' }), version: async () => '2.1.302', idleMs: 0, log: () => {} });
  server = await listenBridge(bridge, path.join(dir, 'bridge.sock'));
  hub = await import('../src/lib/code-agents/hub');
  route = await import('../src/app/api/tasks/sessions/route');
});

after(async () => {
  hub.resetHub();
  await bridge.close();
  await server.close();
  await fake.close();
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('`own` is the default mode, first in the list', () => {
  assert.equal(DEFAULT_PICKS.mode, 'own');
  assert.deepEqual(PERMISSION_MODES, ['own', 'ask', 'auto-edit', 'plan', 'full']);
  // What a thread runs with, from Codex's record, in either spelling of the sandbox.
  assert.deepEqual(policyOf('never', { type: 'dangerFullAccess' }), { approvalPolicy: 'never', sandbox: 'danger-full-access' });
  assert.deepEqual(policyOf('on-request', 'workspace-write'), { approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  assert.equal(policyOf(null, 'read-only'), undefined);
  assert.equal(policyOf('never', { type: 'externalSandbox' }), undefined);
  // A workspace-write sandbox takes config.toml's own settings for it.
  assert.deepEqual(sandboxPolicy('workspace-write', { writable_roots: ['/data'], network_access: true }), { type: 'workspaceWrite', writableRoots: ['/data'], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false });
});

test('Codex: what its own settings come to, read from config/read for the folder', async () => {
  assert.deepEqual(await hub.agentOwnSettings('codex', 'laptop', repo), { approvalPolicy: 'never', sandbox: 'danger-full-access' });
  assert.deepEqual(fake.received.findLast((m) => m.method === 'config/read')!.params, { cwd: repo });
  assert.deepEqual(ownWords('codex', { approvalPolicy: 'never', sandbox: 'danger-full-access' }), { label: 'Your Codex settings (full access, never asks)', detail: 'full access, never asks', full: true });
  const own = await json(await get(`id=${TASK}&own=codex&cwd=${encodeURIComponent(repo)}`));
  assert.deepEqual([own.status, own.body.data.own], [200, { approvalPolicy: 'never', sandbox: 'danger-full-access' }]);
  assert.equal((await get(`id=${TASK}&own=codex&cwd=/etc`)).status, 400);
  assert.equal((await get(`id=${TASK}&own=gemini&cwd=${encodeURIComponent(repo)}`)).status, 400);
});

let linkId = '';
let threadId = '';

test('Codex: a session in its own settings says nothing of approvals or the sandbox, on thread/start or any turn', async () => {
  const link = await hub.startSession({ taskId: TASK, agent: 'codex', place: { host: 'laptop', cwd: repo }, text: 'Look around', picks: OWN, brief: null });
  linkId = link.id;
  threadId = link.sessionId;
  assert.equal(link.picks.mode, 'own');
  assert.deepEqual(fake.received.findLast((m) => m.method === 'thread/start')!.params, { cwd: repo });
  await until(() => turnStarts.length === 1);
  assert.deepEqual([turnStarts[0].approvalPolicy, turnStarts[0].sandboxPolicy], [undefined, undefined]);
  await until(() => hub.liveSnapshot(linkId)?.turnId === 'turn-1');
  await finish(linkId, threadId);
  await hub.sendToSession(linkId, 'And again');
  assert.deepEqual([turnStarts[1].approvalPolicy, turnStarts[1].sandboxPolicy], [undefined, undefined]);
  await finish(linkId, threadId);
});

test('Codex: moved to another mode it is told so; moved back, it is told its own values once, then nothing', async () => {
  await hub.sendToSession(linkId, 'Carefully now', { model: null, effort: null, mode: 'auto-edit' });
  assert.deepEqual([turnStarts.at(-1).approvalPolicy, turnStarts.at(-1).sandboxPolicy?.type], ['on-request', 'workspaceWrite']);
  await finish(linkId, threadId);
  // Codex keeps a turn's overrides for the turns after it: saying nothing would leave it asking. Its own values bring it back.
  await hub.sendToSession(linkId, 'As you were', OWN);
  assert.deepEqual([turnStarts.at(-1).approvalPolicy, turnStarts.at(-1).sandboxPolicy], ['never', { type: 'dangerFullAccess' }]);
  await finish(linkId, threadId);
  await hub.sendToSession(linkId, 'Once more', OWN);
  assert.deepEqual([turnStarts.at(-1).approvalPolicy, turnStarts.at(-1).sandboxPolicy], [undefined, undefined]);
  await finish(linkId, threadId);
});

test('Codex: a thread from the Codex app left on another mode goes back to its own settings; unknown settings say nothing', async () => {
  hub.resetHub();
  const link = await hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'laptop', sessionId: 'app-1', picks: OWN });
  await hub.sendToSession(link.id, 'Carry on');
  assert.deepEqual([turnStarts.at(-1).approvalPolicy, turnStarts.at(-1).sandboxPolicy], ['never', { type: 'dangerFullAccess' }]);
  await finish(link.id, 'app-1');
  // config.toml names neither: what they come to is unknown, so nothing is said and the thread keeps what it has.
  hub.resetHub();
  config = { model: 'gpt-a' };
  const other = await hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'laptop', sessionId: 'app-2', picks: OWN });
  await hub.sendToSession(other.id, 'Carry on');
  assert.deepEqual([turnStarts.at(-1).approvalPolicy, turnStarts.at(-1).sandboxPolicy], [undefined, undefined]);
  await finish(other.id, 'app-2');
  assert.deepEqual(await hub.agentOwnSettings('codex', 'laptop', repo), { approvalPolicy: null, sandbox: null });
  assert.equal(ownWords('codex', { approvalPolicy: null, sandbox: null }).label, 'Your Codex settings');
  config = { model: 'gpt-a', approval_policy: 'never', sandbox_mode: 'danger-full-access' };
});

test('the routes: `own` needs no confirming, even where it is full access; `full` still does', async () => {
  hub.resetHub();
  const started = await json(await post({ action: 'start', taskId: TASK, agent: 'codex', text: 'Tidy up', picks: OWN }));
  assert.deepEqual([started.status, started.body.data.picks.mode], [200, 'own']);
  // No picks at all: the default, its own settings.
  const plain = await json(await post({ action: 'start', taskId: TASK, agent: 'codex', text: 'And this' }));
  assert.deepEqual([plain.status, plain.body.data.picks.mode], [200, 'own']);
  const session = started.body.data.id;
  assert.equal((await post({ action: 'picks', taskId: TASK, session, picks: { model: null, effort: null, mode: 'ask' } })).status, 200);
  assert.equal((await post({ action: 'picks', taskId: TASK, session, picks: OWN })).status, 200);
  assert.equal((await post({ action: 'picks', taskId: TASK, session, picks: { model: null, effort: null, mode: 'full' } })).status, 400);
  assert.equal((await post({ action: 'adopt', taskId: TASK, agent: 'codex', sessionId: 'app-3', picks: OWN })).status, 200);
  // The session's detail says what its own settings come to, for the picker.
  const detail = await json(await get(`id=${TASK}&session=${session}`));
  assert.deepEqual(detail.body.data.own, { approvalPolicy: 'never', sandbox: 'danger-full-access' });
  // A stored pick is kept as it was; one that cannot be read is "edit freely", never its own settings.
  const store = await import('../src/lib/code-agents/store');
  assert.deepEqual([store.readPicks({ mode: 'own' }).mode, store.readPicks({ mode: 'ask' }).mode, store.readPicks({}).mode, store.readPicks({ mode: 'yolo' }).mode], ['own', 'ask', 'auto-edit', 'auto-edit']);
});

test('Claude Code: its own settings give no permission mode, and the bridge says what its settings name', async () => {
  hub.resetHub();
  sdk.script = async (ctx) => { ctx.text('msg_own', 'Done.'); ctx.result(); };
  const link = await hub.startSession({ taskId: TASK, agent: 'claude-code', place: { host: 'laptop', cwd: repo }, text: 'Look around', picks: OWN, brief: null });
  await until(() => sdk.queries.some((q) => q.inputs.length > 0));
  const q = sdk.queries.find((x) => x.inputs.length > 0)!.options;
  assert.deepEqual([q.permissionMode, q.allowDangerouslySkipPermissions, 'permissionMode' in q], [undefined, undefined, false]);
  assert.ok(q.canUseTool, 'what it asks still comes to the Journal');
  await until(() => hub.liveSnapshot(link.id)?.state === 'idle');
  // Another mode opens Claude Code again with it.
  const count = sdk.queries.length;
  await hub.sendToSession(link.id, 'Plan it', { model: null, effort: null, mode: 'plan' });
  await until(() => sdk.queries.length === count + 1);
  assert.equal(sdk.queries.at(-1)!.options.permissionMode, 'plan');
  await until(() => hub.liveSnapshot(link.id)?.state === 'idle');

  assert.deepEqual(await hub.agentOwnSettings('claude-code', 'laptop', repo), { permissionMode: null });
  assert.equal(sdk.settingsAsked.at(-1), repo);
  assert.equal(ownWords('claude-code', { permissionMode: null }).label, 'Your Claude Code settings');
  sdk.settings = { user: 'acceptEdits' };
  hub.resetHub();
  assert.deepEqual(await hub.agentOwnSettings('claude-code', 'laptop', repo), { permissionMode: 'acceptEdits' });
  assert.equal(ownWords('claude-code', { permissionMode: 'acceptEdits' }).label, 'Your Claude Code settings (edits freely, asks for the rest)');
  // A repo's committed settings cannot raise it (the CLI's own rule), so neither does the label.
  sdk.settings = { user: 'default', project: 'bypassPermissions' };
  assert.deepEqual(await hub.agentOwnSettings('claude-code', 'laptop', repo), { permissionMode: 'default' });
  assert.deepEqual(ownWords('claude-code', { permissionMode: 'bypassPermissions' }), { label: 'Your Claude Code settings (full access, never asks)', detail: 'full access, never asks', full: true });
  // An SDK without resolveSettings: it cannot say.
  const bare = createBridge({ sdk: { ...sdk, resolveSettings: undefined }, claudePath: 'claude', env: {}, authStatus: async () => ({ loggedIn: true }), version: async () => '1', log: () => {} });
  assert.deepEqual(await bare.handle({ id: 5, notify: () => {} }, 'settings/own', { cwd: repo }), { permissionMode: null });
  sdk.settings = {};
});
