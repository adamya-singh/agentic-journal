// The coding-session routes, called directly: only the Journal's own pages may reach them; the list with each
// agent's status and the places; starting a session (and what is refused); its history; the agent's own sessions;
// and the live stream of events.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { DEFAULT_THREAD, startFakeCodex, type FakeCodex } from './code-agents-fake-codex';

const TASK = 'c0de0000-0000-4000-8000-000000route1';
const URL = 'http://127.0.0.1:3000/api/tasks/sessions';
const SAME = { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3000' };
let fake: FakeCodex;
let dir: string;
let workspace: string;
let route: typeof import('../src/app/api/tasks/sessions/route');
let stream: typeof import('../src/app/api/tasks/sessions/stream/route');
const saved = { ...process.env };

const get = (query: string, headers: Record<string, string> = SAME) => route.GET(new NextRequest(`${URL}?${query}`, { headers }));
const post = (body: unknown, headers: Record<string, string> = SAME) => route.POST(new NextRequest(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const json = async (response: Response) => ({ status: response.status, body: await response.json() });

before(async () => {
  fake = await startFakeCodex();
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-routes-')));
  workspace = path.join(dir, 'workspace');
  fs.mkdirSync(workspace);
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'tasks', 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [{ id: TASK, text: 'Fix the flaky test' }] }));
  Object.assign(process.env, {
    BACKEND_DATA_DIR: dir, OPENCLAW_WORKSPACE_DIR: workspace, PROJ_REGISTRY_DIR: path.join(dir, 'no-registry'), PROJ_HOST: 'laptop',
    CODEX_APP_SERVER_SOCKET: fake.socketPath, CODEX_APP_SERVER_FALLBACK: 'none', CLAUDE_BRIDGE_SOCKET: path.join(dir, 'no-claude-bridge.sock'),
  });
  fake.on('account/read', () => ({ account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true }));
  fake.on('account/rateLimits/read', () => { throw new Error('no limits'); });
  fake.on('model/list', () => ({ data: [{ id: 'gpt-a', model: 'gpt-a', displayName: 'GPT A', description: '', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', isDefault: true }], nextCursor: null }));
  fake.on('thread/list', (p) => ({ data: [DEFAULT_THREAD('n-1', { cwd: p.cwd, name: 'Mine' })], nextCursor: null }));
  fake.on('thread/start', (p) => ({ thread: DEFAULT_THREAD('th-r', { cwd: p.cwd }), model: 'gpt-a' }));
  fake.on('thread/name/set', () => ({}));
  fake.on('thread/resume', (p) => ({ thread: DEFAULT_THREAD(p.threadId, { cwd: workspace }), model: 'gpt-a', approvalPolicy: 'on-request', sandbox: { type: 'workspaceWrite' } }));
  fake.on('thread/turns/list', () => ({ data: [], nextCursor: null }));
  fake.on('turn/start', () => ({ turn: { id: 'turn-r', items: [], status: 'inProgress', error: null, startedAt: null, completedAt: null } }));
  route = await import('../src/app/api/tasks/sessions/route');
  stream = await import('../src/app/api/tasks/sessions/stream/route');
});

after(async () => {
  (await import('../src/lib/code-agents/hub')).resetHub();
  await fake.close();
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a request that is not from one of the Journal’s own pages is refused', async () => {
  assert.equal((await get(`id=${TASK}`, {})).status, 403);
  assert.equal((await get(`id=${TASK}`, { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await post({ action: 'seen', taskId: TASK, session: 'x' }, {})).status, 403);
  assert.equal((await post({ action: 'seen', taskId: TASK, session: 'x' }, { origin: 'https://evil.example', host: '127.0.0.1:3000' })).status, 403);
  assert.equal((await stream.GET(new NextRequest(`${URL}/stream?id=${TASK}`))).status, 403);
  // A page that pointed its own name at this machine (DNS rebinding): its Origin matches the Host it asked.
  const rebound = { origin: 'http://evil.example:3000', host: 'evil.example:3000' };
  assert.equal((await get(`id=${TASK}`, rebound)).status, 403);
  assert.equal((await stream.GET(new NextRequest(`${URL}/stream?id=${TASK}`, { headers: rebound }))).status, 403);
});

test('the list: no sessions yet, where sessions run; each agent’s status on its own', async () => {
  const { status, body } = await json(await get(`id=${TASK}`));
  assert.equal(status, 200);
  assert.deepEqual(body.data.sessions, []);
  assert.deepEqual(body.data.place, { host: 'laptop', cwd: workspace });
  assert.deepEqual(body.data.places.map((p: { label: string }) => p.label), ['OpenClaw workspace']);
  // The list does not wait on the agents: their status is a request of its own.
  assert.equal(body.data.agents, undefined);
  const agents = (await json(await get(`id=${TASK}&agents=1`))).body.data.agents;
  assert.deepEqual([agents.codex.state, agents.codex.account], ['ready', { kind: 'subscription', plan: 'plus' }]);
  assert.equal(agents['claude-code'].state, 'offline');
  assert.match(agents['claude-code'].reason, /bridge isn’t running/);
  assert.equal((await get('')).status, 400);
});

let linkId = '';

test('starting a session, and what is refused', async () => {
  assert.equal((await post({ action: 'place', taskId: TASK, place: { host: 'laptop', cwd: dir } })).status, 400);
  assert.equal((await post({ action: 'place', taskId: TASK, place: { host: 'mac', cwd: '~/x' } })).status, 400);
  assert.deepEqual((await json(await post({ action: 'place', taskId: TASK, place: { host: 'laptop', cwd: workspace } }))).body.data, { host: 'laptop', cwd: workspace });

  const claude = await json(await post({ action: 'start', taskId: TASK, agent: 'claude-code', text: 'Hi' }));
  assert.deepEqual([claude.status, claude.body.success], [503, false]);
  assert.match(claude.body.error, /Claude Code/);
  assert.equal((await post({ action: 'start', taskId: 'no-such-task', agent: 'codex', text: 'Hi' })).status, 404);
  assert.equal((await post({ action: 'start', taskId: TASK, agent: 'codex', text: 'Hi', picks: { model: 'gpt-z', effort: null, mode: 'ask' } })).status, 400);
  assert.equal((await post({ action: 'start', taskId: TASK, agent: 'codex', text: 'Hi', picks: { model: 'gpt-a', effort: 'ultra', mode: 'ask' } })).status, 400);
  assert.equal((await post({ action: 'start', taskId: TASK, agent: 'codex', text: '   ' })).status, 400);

  const started = await json(await post({ action: 'start', taskId: TASK, agent: 'codex', text: 'Find why the test flakes', picks: { model: 'gpt-a', effort: 'low', mode: 'ask' } }));
  assert.equal(started.status, 200);
  linkId = started.body.data.id;
  assert.deepEqual([started.body.data.sessionId, started.body.data.cwd, started.body.data.picks.mode], ['th-r', workspace, 'ask']);
  assert.deepEqual(fake.received.find((m) => m.method === 'thread/start')!.params, { cwd: workspace, approvalPolicy: 'untrusted', sandbox: 'workspace-write', model: 'gpt-a' });
  await fake.waitFor(() => fake.received.some((m) => m.method === 'turn/start'));
  const first = fake.received.find((m) => m.method === 'turn/start')!.params.input[0].text as string;
  assert.ok(first.includes('Task: Fix the flaky test') && first.endsWith('Find why the test flakes'));

  // While its turn runs, a new message is refused: it is a steer.
  const busy = await json(await post({ action: 'send', taskId: TASK, session: linkId, text: 'And another' }));
  assert.equal(busy.status, 409);
  assert.equal((await post({ action: 'send', taskId: TASK, session: 'nope', text: 'x' })).status, 404);
  assert.equal((await post({ action: 'approve', taskId: TASK, session: linkId, approvalId: 'a', decision: 'maybe' })).status, 400);
  assert.equal((await post({ action: 'approve', taskId: TASK, session: linkId, approvalId: 'a', decision: 'allow' })).status, 404);

  const list = (await json(await get(`id=${TASK}`))).body.data.sessions;
  assert.deepEqual(list.map((s: { id: string; state: string }) => [s.id, s.state]), [[linkId, 'working']]);
});

test('one session’s history and picks; the agent’s own sessions in a folder', async () => {
  const detail = await json(await get(`id=${TASK}&session=${linkId}`));
  assert.equal(detail.status, 200);
  assert.deepEqual([detail.body.data.turns, detail.body.data.state, detail.body.data.models.map((m: { id: string }) => m.id)], [[], 'working', ['gpt-a']]);
  assert.equal(typeof detail.body.data.seq, 'number');
  assert.equal((await get(`id=other&session=${linkId}`)).status, 404);
  // Full access only with his confirmation: a request without it (crafted, or replayed from before) is refused.
  const full = { model: null, effort: null, mode: 'full' };
  const unconfirmed = await json(await post({ action: 'picks', taskId: TASK, session: linkId, picks: full }));
  assert.deepEqual([unconfirmed.status, unconfirmed.body.error], [400, 'Full access lets the agent do anything on this machine without asking. Confirm it in the pane first.']);
  assert.equal((await post({ action: 'start', taskId: TASK, agent: 'codex', text: 'Hi', picks: full })).status, 400);
  assert.equal((await post({ action: 'send', taskId: TASK, session: linkId, text: 'Hi', picks: full })).status, 400);
  assert.equal((await post({ action: 'adopt', taskId: TASK, agent: 'codex', sessionId: 'n-1', picks: full })).status, 400);
  assert.equal((await post({ action: 'picks', taskId: TASK, session: linkId, picks: full, confirmFull: false })).status, 400);
  const picks = await json(await post({ action: 'picks', taskId: TASK, session: linkId, picks: full, confirmFull: true }));
  assert.deepEqual(picks.body.data.picks, full);
  // Already in full access, another model needs no confirming again.
  assert.equal((await post({ action: 'picks', taskId: TASK, session: linkId, picks: { ...full, model: 'gpt-a' } })).status, 200);
  assert.equal((await post({ action: 'picks', taskId: TASK, session: linkId, picks: full })).status, 200);
  // Attaching a session from another device is refused before the agent is asked anything.
  const asked = fake.received.length;
  assert.equal((await post({ action: 'adopt', taskId: TASK, agent: 'codex', sessionId: 'n-1', host: 'mac' })).status, 400);
  assert.equal(fake.received.length, asked);
  const seen = await json(await post({ action: 'seen', taskId: TASK, session: linkId }));
  assert.ok(seen.body.data.seenAt);

  const native = await json(await get(`id=${TASK}&native=codex&cwd=${encodeURIComponent(workspace)}`));
  assert.deepEqual(native.body.data.sessions.map((s: { sessionId: string; title: string }) => [s.sessionId, s.title]), [['n-1', 'Mine']]);
  assert.equal((await get(`id=${TASK}&native=codex&cwd=/etc`)).status, 400);
  assert.equal((await get(`id=${TASK}&native=gemini&cwd=${encodeURIComponent(workspace)}`)).status, 400);
  // Attaching one checks its folder is a place a session may run.
  const adopted = await json(await post({ action: 'adopt', taskId: TASK, agent: 'codex', sessionId: 'n-1' }));
  assert.deepEqual([adopted.status, adopted.body.data.adopted], [200, true]);
});

test('the stream sends what happens, as server-sent events', async () => {
  const abort = new AbortController();
  const response = await stream.GET(new NextRequest(`${URL}/stream?id=${TASK}`, { headers: SAME, signal: abort.signal }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.match(response.headers.get('cache-control')!, /no-transform/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  const read = async (until: (t: string) => boolean) => {
    while (!until(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value);
    }
  };
  await read((t) => t.includes(': open'));
  fake.notify('item/completed', { threadId: 'th-r', turnId: 'turn-r', item: { type: 'agentMessage', id: 'a1', text: 'Found it.' } });
  await read((t) => t.includes('Found it.'));
  const frame = text.split('\n\n').find((f) => f.includes('Found it.'))!;
  const id = /^id: (.+)$/m.exec(frame)![1]!;
  const data = JSON.parse(/^data: (.+)$/m.exec(frame)![1]!);
  assert.match(frame, /^event: session$/m);
  assert.deepEqual([data.type, data.session, data.item.text, id], ['item-completed', linkId, 'Found it.', `${linkId}:${data.seq}`]);
  abort.abort();
  await read(() => false);   // the stream ends once the request is gone

  // Picking up where it left off, by Last-Event-ID: only what came after.
  fake.notify('item/completed', { threadId: 'th-r', turnId: 'turn-r', item: { type: 'agentMessage', id: 'a2', text: 'Fixed it.' } });
  const again = new AbortController();
  const resumed = await stream.GET(new NextRequest(`${URL}/stream?id=${TASK}`, { headers: { ...SAME, 'last-event-id': id }, signal: again.signal }));
  const reader2 = resumed.body!.getReader();
  let text2 = '';
  while (!text2.includes('Fixed it.')) text2 += decoder.decode((await reader2.read()).value);
  assert.ok(!text2.includes('Found it.'));
  again.abort();
});
