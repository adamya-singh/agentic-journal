// Signing in to each agent from the Journal, through the routes. Codex against the stand-in app server: its
// device-code way (a link and a code), the end Codex reports, a stop, a dropped connection, and no start while it
// is signed in. Claude Code against the real bridge with a stand-in `claude` (a script that behaves as CLI 2.1.302
// did without a terminal: prints the link, reads a pasted code, fails on a wrong one): the link, the pasted code, a
// wrong code, a stop, and the environment it runs in. Nothing secret is logged or written to the data folder.
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { startFakeCodex, type FakeCodex } from './code-agents-fake-codex';
import { createFakeClaudeSdk } from './code-agents-fake-claude-sdk';
import { createBridge, loginEnv, loginFailure, loginUrlOf, type Bridge } from '../bridge/sessions.ts';
import { listenBridge, type BridgeServer } from '../bridge/server.ts';
import { cleanChildEnv } from '../bridge/claude-bridge.ts';
import { accountLine, planWords } from '../src/lib/code-sessions-ui';

const TASK = 'c0de0000-0000-4000-8000-00000000login';
const URL = 'http://127.0.0.1:3000/api/tasks/sessions';
const SAME = { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3000' };
const DEVICE_CODE = 'FAKE-0DE1';
const CLAUDE_CODE = 'PASTED-CODE-1234#state';
let fake: FakeCodex;
let bridge: Bridge;
let server: BridgeServer;
let dir: string;
let route: typeof import('../src/app/api/tasks/sessions/route');
let hub: typeof import('../src/lib/code-agents/hub');
const saved = { ...process.env };
let codexSignedIn = false;
let claudeSignedFile = '';
let envOut = '';
const logged: string[] = [];
const consoleWas = { log: console.log, warn: console.warn, error: console.error, info: console.info };

const until = async (ok: () => boolean | Promise<boolean>, ms = 4000) => { const end = Date.now() + ms; while (!(await ok())) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 15)); } };
const post = (body: unknown, headers: Record<string, string> = SAME) => route.POST(new NextRequest(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const get = (query: string, headers: Record<string, string> = SAME) => route.GET(new NextRequest(`${URL}?${query}`, { headers }));
const json = async (response: Response) => ({ status: response.status, body: await response.json() });
const loginNow = async (agent: string) => (await json(await get(`id=${TASK}&login=${agent}`))).body.data.login;

/** A stand-in `claude`: `auth login` as CLI 2.1.302 behaves on plain pipes. Its link comes in two writes, as output can. */
const FAKE_CLAUDE = (node: string) => `#!${node}
const fs = require('fs');
if (process.argv.slice(2).join(' ') !== 'auth login --claudeai') { process.stderr.write('unexpected: ' + process.argv.slice(2).join(' ') + '\\n'); process.exit(2); }
if (process.env.FAKE_CLAUDE_ENV_OUT) fs.writeFileSync(process.env.FAKE_CLAUDE_ENV_OUT, JSON.stringify({ keys: Object.keys(process.env).sort(), browser: process.env.BROWSER }));
if (process.env.FAKE_CLAUDE_MODE === 'broken') { process.stderr.write('Error: no config dir\\n'); process.exit(3); }
process.stdout.write('Opening browser to sign in…\\n');
process.stdout.write("If the browser didn't open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=fake");
setTimeout(() => process.stdout.write('&state=fake\\nPaste code here if prompted > '), 40);
let got = '';
process.stdin.on('data', (d) => {
  got += d;
  const at = got.indexOf('\\n');
  if (at < 0) return;
  const code = got.slice(0, at);
  if (code === ${JSON.stringify(CLAUDE_CODE)}) { fs.writeFileSync(process.env.FAKE_CLAUDE_SIGNED, '1'); process.stdout.write('Login successful.\\n'); process.exit(0); }
  // A wrong code. (The real one does not repeat the code; this one does, so the bridge is seen to leave it out.)
  process.stderr.write('Login failed: Request failed with status code 400 for ' + code + '\\n');
  process.exit(1);
});
process.on('SIGTERM', () => process.exit(143));
setInterval(() => {}, 1000);
`;

/** Every file under the data folder, read whole: none may hold a code. */
function dataText(root: string): string {
  let out = '';
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out += dataText(full);
    else if (entry.isFile() && !entry.name.endsWith('.sock')) out += fs.readFileSync(full, 'utf8');
  }
  return out;
}

async function startBridge(mode = '') {
  const claudePath = path.join(dir, 'fake-claude.cjs');
  bridge = createBridge({
    sdk: createFakeClaudeSdk(), claudePath,
    env: { PATH: process.env.PATH, HOME: dir, CLAUDE_CODE_ENTRYPOINT: 'agentic-journal', CLAUDE_CODE_OAUTH_TOKEN: 'deliberate-token', FAKE_CLAUDE_SIGNED: claudeSignedFile, FAKE_CLAUDE_ENV_OUT: envOut, ...(mode ? { FAKE_CLAUDE_MODE: mode } : {}) },
    authStatus: async () => ({ loggedIn: fs.existsSync(claudeSignedFile), ...(fs.existsSync(claudeSignedFile) ? { authMethod: 'claude.ai', subscriptionType: 'max' } : {}) }),
    version: async () => '2.1.302', idleMs: 0, loginMaxMs: 60_000, log: (line) => logged.push(line),
  });
  server = await listenBridge(bridge, path.join(dir, 'bridge.sock'));
}

before(async () => {
  for (const level of ['log', 'warn', 'error', 'info'] as const) console[level] = (...args: unknown[]) => { logged.push(args.map(String).join(' ')); };
  fake = await startFakeCodex();
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir().length > 60 ? '/tmp' : os.tmpdir(), 'code-login-')));
  // The data folder holds only what the Journal writes; the stand-in claude and its notes are beside it.
  fs.mkdirSync(path.join(dir, 'data', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'workspace'));
  claudeSignedFile = path.join(dir, 'claude-signed');
  envOut = path.join(dir, 'claude-env.json');
  fs.writeFileSync(path.join(dir, 'fake-claude.cjs'), FAKE_CLAUDE(process.execPath), { mode: 0o755 });
  Object.assign(process.env, {
    BACKEND_DATA_DIR: path.join(dir, 'data'), OPENCLAW_WORKSPACE_DIR: path.join(dir, 'workspace'), PROJ_REGISTRY_DIR: path.join(dir, 'no-registry'), PROJ_HOST: 'laptop',
    CODEX_APP_SERVER_SOCKET: fake.socketPath, CODEX_APP_SERVER_FALLBACK: 'none', CLAUDE_BRIDGE_SOCKET: path.join(dir, 'bridge.sock'),
  });
  fake.on('account/read', () => ({ account: codexSignedIn ? { type: 'chatgpt', email: null, planType: 'plus' } : null, requiresOpenaiAuth: true }));
  fake.on('account/rateLimits/read', () => { throw new Error('no limits'); });
  let logins = 0;
  fake.on('account/login/start', (p) => {
    if (p.type !== 'chatgptDeviceCode') throw new Error(`asked for ${p.type}`);
    logins += 1;
    return { type: 'chatgptDeviceCode', loginId: `lg-${logins}`, verificationUrl: 'https://auth.example/codex/device', userCode: DEVICE_CODE };
  });
  fake.on('account/login/cancel', (p) => {
    if (p.loginId === 'lg-gone') throw Object.assign(new Error(`invalid login id: ${p.loginId}`), { code: -32600 });
    return { status: 'canceled' };
  });
  await startBridge();
  route = await import('../src/app/api/tasks/sessions/route');
  hub = await import('../src/lib/code-agents/hub');
});

after(async () => {
  Object.assign(console, consoleWas);
  hub.resetHub();
  await bridge.close();
  await server.close();
  await fake.close();
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('who is signed in, in words', () => {
  assert.equal(accountLine({ state: 'ready', host: 'laptop', account: { kind: 'subscription', plan: 'plus' } }), 'Signed in on laptop · Plus plan');
  assert.equal(accountLine({ state: 'ready', host: 'laptop', account: { kind: 'subscription' } }), 'Signed in on laptop');
  assert.equal(accountLine({ state: 'ready', host: 'laptop', account: { kind: 'api-key' } }), 'Signed in on laptop with an API key');
  assert.equal(accountLine({ state: 'signed-out', host: 'mac' }), 'Not signed in on mac');
  assert.equal(accountLine({ state: 'offline', host: 'laptop' }), null);
  assert.deepEqual([planWords('max'), planWords('team_pro'), planWords('unknown'), planWords(undefined)], ['Max plan', 'Team pro plan', null, null]);
});

test('`claude auth login` runs without anything that points it at another login, and opens no browser here', () => {
  const env = loginEnv(cleanChildEnv({ PATH: '/usr/bin', HOME: '/home/me', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'u', CLAUDE_CODE_OAUTH_TOKEN: 'inherited', CLAUDECODE: '1', CLAUDE_CONFIG_DIR: '/elsewhere', CLAUDE_BRIDGE_OAUTH_TOKEN: 'deliberate' }));
  assert.deepEqual(Object.keys(env).sort(), ['BROWSER', 'CLAUDE_CODE_ENTRYPOINT', 'HOME', 'PATH']);
  assert.equal(env.BROWSER, 'true');
  // Where to sign in: the link after "visit:", only once all of it has come.
  assert.equal(loginUrlOf("Opening…\nIf the browser didn't open, visit: https://claude.com/cai/oauth/authorize?a=1&b=2\nPaste code here if prompted > "), 'https://claude.com/cai/oauth/authorize?a=1&b=2');
  assert.equal(loginUrlOf("If the browser didn't open, visit: https://claude.com/cai/oauth/auth"), null);
  assert.equal(loginUrlOf('nothing here\n'), null);
  // A failure line is shown without the code he pasted, and without links.
  assert.equal(loginFailure('Login failed: bad SECRET-1 at https://x.example/a?b\n', 'SECRET-1'), 'Login failed: bad … at (link)');
});

test('Codex: no sign-in starts while it is signed in; other devices are not offered yet', async () => {
  codexSignedIn = true;
  const refused = await json(await post({ action: 'login', taskId: TASK, agent: 'codex' }));
  assert.deepEqual([refused.status, refused.body.error], [409, 'Codex is signed in on laptop already.']);
  assert.ok(!fake.received.some((m) => m.method === 'account/login/start'));
  assert.equal((await post({ action: 'login', taskId: TASK, agent: 'codex', host: 'mac' })).status, 400);
  assert.equal((await get(`id=${TASK}&login=codex&host=mac`)).status, 400);
  assert.equal((await post({ action: 'login', taskId: TASK, agent: 'codex' }, {})).status, 403);
  assert.equal(await loginNow('codex'), null);
});

test('Codex: the device-code way in, and the end Codex reports', async () => {
  codexSignedIn = false;
  hub.resetHub();
  const status = (await json(await get(`id=${TASK}&agents=1`))).body.data.agents.codex;
  assert.equal(status.state, 'signed-out');
  const started = await json(await post({ action: 'login', taskId: TASK, agent: 'codex' }));
  assert.equal(started.status, 200);
  const login = started.body.data;
  assert.deepEqual([login.agent, login.host, login.method, login.state, login.url, login.code], ['codex', 'laptop', 'device-code', 'waiting', 'https://auth.example/codex/device', DEVICE_CODE]);
  assert.deepEqual(fake.received.findLast((m) => m.method === 'account/login/start')!.params, { type: 'chatgptDeviceCode' });
  // Asked again while it waits: the same sign-in, not a second.
  assert.equal((await json(await post({ action: 'login', taskId: TASK, agent: 'codex' }))).body.data.id, login.id);
  assert.equal(fake.received.filter((m) => m.method === 'account/login/start').length, 1);
  // Codex takes no pasted code.
  assert.equal((await post({ action: 'login-code', taskId: TASK, agent: 'codex', loginId: login.id, code: 'x' })).status, 400);
  // He finishes on the page: Codex says so, and the status is read anew.
  codexSignedIn = true;
  fake.notify('account/login/completed', { loginId: 'someone-elses', success: true, error: null, onboardingEntrypoint: null });
  fake.notify('account/login/completed', { loginId: login.id, success: true, error: null, onboardingEntrypoint: null });
  await until(async () => (await loginNow('codex'))?.state === 'done');
  const after = (await json(await get(`id=${TASK}&agents=1`))).body.data.agents.codex;
  assert.deepEqual([after.state, after.account], ['ready', { kind: 'subscription', plan: 'plus' }]);
});

test('Codex: a sign-in stopped, one that fails, and one whose connection drops', async () => {
  codexSignedIn = false;
  hub.resetHub();
  const first = (await json(await post({ action: 'login', taskId: TASK, agent: 'codex' }))).body.data;
  const cancelled = await json(await post({ action: 'login-cancel', taskId: TASK, agent: 'codex', loginId: first.id }));
  assert.deepEqual([cancelled.status, cancelled.body.data.state], [200, 'cancelled']);
  assert.deepEqual(fake.received.findLast((m) => m.method === 'account/login/cancel')!.params, { loginId: first.id });
  assert.equal((await post({ action: 'login-cancel', taskId: TASK, agent: 'codex', loginId: 'nope' })).status, 404);

  const second = (await json(await post({ action: 'login', taskId: TASK, agent: 'codex' }))).body.data;
  assert.notEqual(second.id, first.id);
  fake.notify('account/login/completed', { loginId: second.id, success: false, error: 'The code expired.', onboardingEntrypoint: null });
  await until(async () => (await loginNow('codex'))?.state === 'failed');
  assert.equal((await loginNow('codex')).error, 'The code expired.');

  const third = (await json(await post({ action: 'login', taskId: TASK, agent: 'codex' }))).body.data;
  fake.drop();
  await until(async () => (await loginNow('codex'))?.state === 'failed');
  const dropped = await loginNow('codex');
  assert.deepEqual([dropped.id, dropped.error], [third.id, 'The connection to Codex dropped while you were signing in. Try again.']);
});

test('Claude Code: the bridge runs `claude auth login`, shows its link, and takes the pasted code', async () => {
  hub.resetHub();
  const status = (await json(await get(`id=${TASK}&agents=1`))).body.data.agents['claude-code'];
  assert.equal(status.state, 'signed-out');
  const started = await json(await post({ action: 'login', taskId: TASK, agent: 'claude-code' }));
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const login = started.body.data;
  assert.deepEqual([login.method, login.state, login.url, login.code], ['paste-code', 'waiting', 'https://claude.com/cai/oauth/authorize?code=true&client_id=fake&state=fake', undefined]);
  // It ran with the sessions' environment, without the deliberate token, and with no browser to open.
  const ran = JSON.parse(fs.readFileSync(envOut, 'utf8'));
  assert.ok(!ran.keys.includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.equal(ran.browser, 'true');
  // A code that is not one is refused before it reaches Claude Code.
  assert.equal((await post({ action: 'login-code', taskId: TASK, agent: 'claude-code', loginId: login.id, code: '   ' })).status, 400);
  assert.equal((await post({ action: 'login-code', taskId: TASK, agent: 'claude-code', loginId: 'other', code: 'x' })).status, 404);
  const checking = await json(await post({ action: 'login-code', taskId: TASK, agent: 'claude-code', loginId: login.id, code: CLAUDE_CODE }));
  assert.equal(checking.status, 200);
  assert.ok(['checking', 'done'].includes(checking.body.data.state));
  await until(async () => (await loginNow('claude-code'))?.state === 'done');
  const after = (await json(await get(`id=${TASK}&agents=1`))).body.data.agents['claude-code'];
  assert.deepEqual([after.state, after.account], ['ready', { kind: 'subscription', plan: 'max' }]);
  // Signed in: no second sign-in starts.
  assert.equal((await post({ action: 'login', taskId: TASK, agent: 'claude-code' })).status, 409);
});

test('Claude Code: a wrong code, a sign-in stopped, and one Claude Code cannot begin', async () => {
  // Signed out again (a new bridge: the last one keeps what `claude auth status` said for 30 s).
  fs.rmSync(claudeSignedFile, { force: true });
  hub.resetHub();
  await bridge.close();
  await server.close();
  await startBridge();
  const wrong = (await json(await post({ action: 'login', taskId: TASK, agent: 'claude-code' }))).body.data;
  await post({ action: 'login-code', taskId: TASK, agent: 'claude-code', loginId: wrong.id, code: 'WRONG-CODE-99' });
  await until(async () => (await loginNow('claude-code'))?.state === 'failed');
  const failed = await loginNow('claude-code');
  assert.match(failed.error, /^Claude Code could not sign in \(Login failed: Request failed with status code 400 for …\)\. Start again/);
  assert.ok(!failed.error.includes('WRONG-CODE-99'));

  const stopped = (await json(await post({ action: 'login', taskId: TASK, agent: 'claude-code' }))).body.data;
  assert.notEqual(stopped.id, wrong.id);
  const cancelled = await json(await post({ action: 'login-cancel', taskId: TASK, agent: 'claude-code', loginId: stopped.id }));
  assert.equal(cancelled.body.data.state, 'cancelled');
  assert.equal((await post({ action: 'login-code', taskId: TASK, agent: 'claude-code', loginId: stopped.id, code: CLAUDE_CODE })).status, 404);

  // The Journal goes away with a sign-in waiting: the bridge stops it rather than leave it running.
  const orphan = (await json(await post({ action: 'login', taskId: TASK, agent: 'claude-code' }))).body.data;
  hub.resetHub();
  await until(async () => ((await bridge.handle({ id: 77, notify: () => {} }, 'login/status', { loginId: orphan.id })) as any).login?.state === 'cancelled');

  await bridge.close();
  await server.close();
  await startBridge('broken');
  hub.resetHub();
  const broken = await json(await post({ action: 'login', taskId: TASK, agent: 'claude-code' }));
  assert.deepEqual([broken.status, broken.body.error], [502, 'Claude Code could not start signing in: Error: no config dir']);
});

test('nothing secret was logged or written to the data folder', () => {
  const text = dataText(path.join(dir, 'data')) + logged.join('\n');
  for (const secret of [DEVICE_CODE, CLAUDE_CODE, 'WRONG-CODE-99', 'deliberate-token', 'oauth/authorize', 'auth.example/codex/device']) {
    assert.ok(!text.includes(secret), `"${secret.slice(0, 6)}…" is nowhere on disk or in the logs`);
  }
});
