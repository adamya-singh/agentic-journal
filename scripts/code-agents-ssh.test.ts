// Coding agents on another device, over ssh (src/lib/code-agents/ssh.ts), against a stand-in `ssh` that runs the
// remote command here, as sshd would, in a "device" of its own: its own home, a login profile that chatters on stdout
// and is the only thing that puts its `codex` and `claude` on the PATH. Its `codex app-server proxy` is a real byte
// pipe (the bridge's proxy mode) to the fake Codex daemon; its `codex app-server` without a daemon is a small
// newline-JSON server; its Claude bridge is the real bridge with the stand-in SDK, reached through the installed
// launcher's `proxy`. What the hub, the adapters and the routes do with such a device, and with one ssh cannot reach.
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { createBridge, type Bridge } from '../bridge/sessions.ts';
import { listenBridge, type BridgeServer } from '../bridge/server.ts';
import { createFakeClaudeSdk } from './code-agents-fake-claude-sdk';
import { DEFAULT_THREAD, startFakeCodex, type FakeCodex } from './code-agents-fake-codex';

const TASK = 'c0de0000-0000-4000-8000-0000000ssh01';
const REPO = path.resolve(import.meta.dirname, '..');
const URL = 'http://127.0.0.1:3000/api/tasks/sessions';
const SAME = { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3000' };
const OWN = { model: null, effort: null, mode: 'own' as const };
let dir: string;
let home: string;
let sshLog: string;
let fake: FakeCodex;
let bridge: Bridge;
let bridgeServer: BridgeServer | null = null;
let ssh: typeof import('../src/lib/code-agents/ssh');
let hub: typeof import('../src/lib/code-agents/hub');
let route: typeof import('../src/app/api/tasks/sessions/route');
const saved = { ...process.env };

const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const write = (file: string, text: string, mode = 0o755) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text, { mode }); };
const daemon = (on: boolean) => { if (on) fs.writeFileSync(path.join(dir, 'daemon-on'), ''); else fs.rmSync(path.join(dir, 'daemon-on'), { force: true }); };
const sshCalls = () => (fs.existsSync(sshLog) ? fs.readFileSync(sshLog, 'utf8').trim().split('\n').filter(Boolean) : []);
const get = (query: string) => route.GET(new NextRequest(`${URL}?${query}`, { headers: SAME }));
const post = (body: unknown) => route.POST(new NextRequest(URL, { method: 'POST', headers: { 'Content-Type': 'application/json', ...SAME }, body: JSON.stringify(body) }));
const json = async (response: Response) => ({ status: response.status, body: await response.json() });

before(async () => {
  dir = fs.realpathSync(fs.mkdtempSync('/tmp/code-ssh-'));
  home = path.join(dir, 'home');
  sshLog = path.join(dir, 'ssh.log');
  fake = await startFakeCodex();
  const bin = path.join(dir, 'device-bin');
  const node = process.execPath;
  // The stand-in ssh: options up to `--`, then the alias and the command. "nowhere" does not resolve; anything else
  // is the device, its command run by its shell with nothing of this process's environment.
  write(path.join(dir, 'ssh'), `#!/bin/sh
printf '%s' "$*" | tr '\\n' ' ' >> ${sh(sshLog)}; echo >> ${sh(sshLog)}
while [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done
shift; alias="$1"; shift
if [ "$alias" = nowhere ]; then echo "ssh: Could not resolve hostname nowhere: Name or service not known" >&2; exit 255; fi
if [ "$alias" = locked ]; then echo "openclaw@locked: Permission denied (publickey)." >&2; exit 255; fi
exec env -i HOME=${sh(home)} PATH=/usr/bin:/bin SHELL=/bin/sh /bin/sh -c "$1"
`);
  write(path.join(home, '.profile'), `echo "Welcome to the device. Have a nice day."\nPATH=${sh(bin)}:$PATH\nexport PATH\n[ -f ${sh(path.join(dir, 'windows-home'))} ] && export CODEX_HOME=/mnt/c/Users/me/.codex\n`, 0o644);
  write(path.join(bin, 'codex'), `#!/bin/sh
case "$*" in
  --version) echo "codex-cli 0.170.0" ;;
  "app-server daemon version") [ -f ${sh(path.join(dir, 'daemon-on'))} ] && echo '{"status":"running","socketPath":"x"}' || { echo "Error: no daemon" >&2; exit 1; } ;;
  "app-server proxy") exec ${sh(node)} --disable-warning=MODULE_TYPELESS_PACKAGE_JSON ${sh(path.join(REPO, 'bridge', 'claude-bridge.ts'))} proxy --socket ${sh(fake.socketPath)} ;;
  app-server) exec ${sh(node)} ${sh(path.join(dir, 'jsonl-codex.mjs'))} ;;
  *) echo "unexpected: $*" >&2; exit 2 ;;
esac
`);
  write(path.join(bin, 'claude'), '#!/bin/sh\necho "2.1.400 (Claude Code)"\n');
  write(path.join(bin, 'node'), `#!/bin/sh\nexec ${sh(node)} "$@"\n`);
  // Codex with no daemon: its app server on stdio, newline JSON.
  write(path.join(dir, 'jsonl-codex.mjs'), `
    import readline from 'node:readline';
    const say = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
    const answers = {
      initialize: { userAgent: 'codex_cli_rs/0.170.0 (stdio)' },
      'account/read': { account: { type: 'chatgpt', planType: 'pro' } },
      'account/rateLimits/read': { rateLimits: null },
      'thread/list': { data: [], nextCursor: null },
    };
    readline.createInterface({ input: process.stdin }).on('line', (line) => {
      const m = JSON.parse(line);
      if (m.id === undefined) return;
      if (m.method in answers) say({ id: m.id, result: answers[m.method] }); else say({ id: m.id, error: { code: -32601, message: 'no ' + m.method } });
    });
  `, 0o644);
  // The bridge as scripts/install-claude-bridge.sh leaves it: a launcher that runs it with this node.
  write(path.join(home, '.local', 'share', 'agentic-journal', 'claude-bridge', 'run'),
    `#!/bin/sh\nexec ${sh(node)} --disable-warning=MODULE_TYPELESS_PACKAGE_JSON ${sh(path.join(REPO, 'bridge', 'claude-bridge.ts'))} "$@"\n`);
  // The proj registry: this machine, the PC (reached as pc-box), one ssh cannot resolve, one that refuses the key.
  const reg = path.join(dir, 'registry');
  write(path.join(reg, 'registry.json'), JSON.stringify({ hosts: { laptop: { alias: 'ubuntu-laptop' }, pc: { alias: 'pc-box' }, far: { alias: 'nowhere' }, shut: { alias: 'locked' } } }), 0o644);
  write(path.join(reg, 'hosts', 'pc.json'), JSON.stringify({ host: 'pc', projects: { repo: { path: '~/projects/repo' } } }), 0o644);
  write(path.join(reg, 'hosts', 'far.json'), JSON.stringify({ host: 'far', projects: { site: { path: '~/projects/site' } } }), 0o644);
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.mkdirSync(path.join(dir, 'workspace'));
  fs.writeFileSync(path.join(dir, 'tasks', 'have-to-do.json'), JSON.stringify({ tasks: [{ id: TASK, text: 'Fix the PC build' }] }));
  Object.assign(process.env, {
    BACKEND_DATA_DIR: dir, OPENCLAW_WORKSPACE_DIR: path.join(dir, 'workspace'), PROJ_REGISTRY_DIR: reg, PROJ_HOST: 'laptop',
    CODE_AGENTS_SSH: path.join(dir, 'ssh'), CODE_AGENTS_SSH_CONTROL: 'none',
    CODEX_APP_SERVER_SOCKET: path.join(dir, 'no-local-codex.sock'), CODEX_APP_SERVER_FALLBACK: 'none', CLAUDE_BRIDGE_SOCKET: path.join(dir, 'no-local-bridge.sock'),
  });
  fake.on('account/read', () => ({ account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true }));
  fake.on('account/rateLimits/read', () => { throw new Error('no limits'); });
  fake.on('model/list', () => ({ data: [{ id: 'gpt-a', model: 'gpt-a', displayName: 'GPT A', description: '', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'low' }], defaultReasoningEffort: 'low', isDefault: true }], nextCursor: null }));
  fake.on('config/read', () => ({ config: {} }));
  fake.on('thread/list', (p) => ({ data: [DEFAULT_THREAD('pc-1', { cwd: p.cwd, name: 'On the PC' })], nextCursor: null }));
  fake.on('thread/start', (p) => ({ thread: DEFAULT_THREAD('pc-new', { cwd: p.cwd }), model: 'gpt-a' }));
  fake.on('thread/name/set', () => ({}));
  fake.on('thread/resume', (p) => ({ thread: DEFAULT_THREAD(p.threadId, { cwd: path.join(home, 'projects', 'repo', 'web') }), model: 'gpt-a', approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } }));
  fake.on('thread/turns/list', () => ({ data: [], nextCursor: null }));
  fake.on('turn/start', () => ({ turn: { id: 'turn-pc', items: [], status: 'inProgress', error: null, startedAt: null, completedAt: null } }));
  fake.on('account/login/start', () => ({ type: 'chatgptDeviceCode', loginId: 'login-pc', verificationUrl: 'https://auth.example/device', userCode: 'ABCD-1234' }));
  ssh = await import('../src/lib/code-agents/ssh');
  hub = await import('../src/lib/code-agents/hub');
  route = await import('../src/app/api/tasks/sessions/route');
});

beforeEach(() => {
  hub.resetHub();
  ssh.forgetProbes();
  daemon(true);
});

after(async () => {
  hub.resetHub();
  await bridge?.close();
  await bridgeServer?.close();
  await fake.close();
  process.env = saved;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function startDeviceBridge() {
  bridge = createBridge({ sdk: createFakeClaudeSdk(), claudePath: '/usr/local/bin/claude', env: {}, authStatus: async () => ({ loggedIn: false }), version: async () => '2.1.400', idleMs: 0, log: () => {} });
  bridgeServer = await listenBridge(bridge, path.join(home, '.local', 'state', 'agentic-journal', 'claude-bridge.sock'));
}

test('ssh never asks, runs in the login shell, keeps one master per device, and is told nothing of the Journal’s environment', () => {
  const args = ssh.sshArgs('macbook', 'true', { control: '/run/aj-ssh' });
  for (const option of ['BatchMode=yes', 'ConnectTimeout=8', 'ServerAliveInterval=15', 'ServerAliveCountMax=4', 'ControlMaster=auto', 'ControlPath=/run/aj-ssh/%C', 'ControlPersist=600']) {
    assert.ok(args.includes(option), option);
  }
  assert.deepEqual(args.slice(0, 3), ['-T', '-e', 'none']);
  assert.deepEqual(args.slice(-3), ['--', 'macbook', 'true']);
  assert.ok(!ssh.sshArgs('macbook', 'true', { control: null }).some((a) => a.startsWith('Control')));
  assert.ok(!ssh.sshArgs('macbook', 'true', { control: `/tmp/${'d'.repeat(70)}` }).some((a) => a.startsWith('Control')), 'too deep for a socket: no reuse');
  assert.equal(ssh.inLoginShell(`echo 'hi'`), `exec "\${SHELL:-/bin/sh}" -lc 'echo '\\''hi'\\'''`);
  const env = ssh.sshEnv({ HOME: '/h', PATH: '/p', SSH_AUTH_SOCK: '/a', LC_ALL: 'C', OPENAI_API_KEY: 'sk-x', CODEX_HOME: '/c', AGENTIC_JOURNAL_TOKEN: 't' });
  assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LC_ALL', 'PATH', 'SSH_AUTH_SOCK']);
  assert.equal(ssh.expandHome('~/projects/x', '/home/u'), '/home/u/projects/x');
  assert.equal(ssh.expandHome('~', '/home/u'), '/home/u');
  assert.equal(ssh.expandHome('/abs', '/home/u'), '/abs');
});

test('a look at a device says what it has, read-only; one ssh cannot reach says why, and is not asked again at once', async () => {
  await startDeviceBridge();
  try {
    const pc = await ssh.probeDevice('pc');
    assert.equal(pc.reachable, true);
    assert.equal(pc.home, home);
    assert.equal(pc.os, 'Linux');
    assert.deepEqual(pc.codex, { version: '0.170.0', daemon: true, home: path.join(home, '.codex') });
    assert.deepEqual(pc.claude, { version: '2.1.400', bridge: 'running' });
    assert.ok(!('home' in ssh.publicStatus(pc)));
    assert.ok(sshCalls().some((c) => c.includes('-- pc-box ')), `by its alias: ${sshCalls().at(-1)}`);
    // Kept a minute: the next look costs no ssh.
    const calls = sshCalls().length;
    await ssh.probeDevice('pc');
    assert.equal(sshCalls().length, calls);
    daemon(false);
    assert.equal((await ssh.probeDevice('pc', { fresh: true })).codex?.daemon, false);
  } finally {
    await bridgeServer?.close();
    bridgeServer = null;
    await bridge.close();
  }
  assert.equal((await ssh.probeDevice('pc', { fresh: true })).claude?.bridge, 'installed');
  const far = await ssh.probeDevice('far');
  assert.equal(far.reachable, false);
  assert.match(far.reason!, /^far can’t be reached: ssh does not know the name “nowhere”/);
  const calls = sshCalls().length;
  assert.equal((await ssh.probeDevice('far')).reason, far.reason);
  assert.equal(sshCalls().length, calls, 'a failed look is kept too');
  assert.match((await ssh.probeDevice('shut')).reason!, /key login to “locked” is refused/);
  // Two looks at once share one ssh.
  ssh.forgetProbes();
  const before = sshCalls().length;
  await Promise.all([ssh.probeDevice('pc'), ssh.probeDevice('pc'), ssh.probeDevice('pc')]);
  assert.equal(sshCalls().length, before + 1);
  // This machine is never looked at.
  assert.deepEqual((await ssh.probeDevice('laptop')).reachable, true);
  assert.equal(sshCalls().length, before + 1);
});

test('Codex on another device through its daemon: status, its own sessions, a session started there in its folder', async () => {
  const status = await hub.agentStatus('codex', 'pc');
  assert.equal(status.state, 'ready');
  assert.deepEqual(status.account, { kind: 'subscription', plan: 'plus' });
  assert.equal(status.host, 'pc');
  // Folders are `~/…` as the PC's proj file writes them; Codex there is given them in full.
  const native = await hub.nativeSessions('codex', 'pc', '~/projects/repo');
  assert.deepEqual(native.map((s) => s.sessionId), ['pc-1']);
  assert.equal(fake.received.filter((m) => m.method === 'thread/list').at(-1)!.params.cwd, path.join(home, 'projects', 'repo'));
  const link = await hub.startSession({ taskId: TASK, agent: 'codex', place: { host: 'pc', cwd: '~/projects/repo' }, text: 'Make the build pass', picks: OWN, brief: null });
  assert.deepEqual([link.host, link.cwd, link.sessionId], ['pc', '~/projects/repo', 'pc-new']);
  assert.equal(fake.received.filter((m) => m.method === 'thread/start').at(-1)!.params.cwd, path.join(home, 'projects', 'repo'));
  await fake.waitFor(() => fake.received.some((m) => m.method === 'turn/start' && m.params.threadId === 'pc-new'));
  // Its events come back over the same pipe.
  fake.notify('turn/started', { threadId: 'pc-new', turn: { id: 'turn-pc', items: [], status: 'inProgress', error: null, startedAt: null, completedAt: null } });
  fake.notify('turn/completed', { threadId: 'pc-new', turn: { id: 'turn-pc', items: [], status: 'completed', error: null, startedAt: null, completedAt: null } });
  await fake.waitFor(() => hub.liveSnapshot(link.id)?.log.some((e) => e.type === 'turn-completed') ?? false);
  assert.equal(hub.liveSnapshot(link.id)!.state, 'idle');
});

test('the connection to a device drops: its sessions read offline, and it is made again', async () => {
  const link = (await hub.adoptSession({ taskId: TASK, agent: 'codex', host: 'pc', sessionId: 'pc-old', picks: OWN }));
  const unsubscribe = hub.subscribeTask(TASK, new Map(), () => {});
  try {
    await fake.waitFor(() => hub.liveSnapshot(link.id)?.state === 'idle');
    const resumes = fake.received.filter((m) => m.method === 'thread/resume').length;
    fake.drop();
    await fake.waitFor(() => hub.liveSnapshot(link.id)?.state === 'offline');
    // Joined again once ssh and the pipe are back (after its first pause, a second).
    await fake.waitFor(() => fake.received.filter((m) => m.method === 'thread/resume').length > resumes, 6000);
    await fake.waitFor(() => hub.liveSnapshot(link.id)?.state === 'idle', 3000);
  } finally {
    unsubscribe();
  }
});

test('Codex on a device with no daemon runs its own app server there, on stdio', async () => {
  daemon(false);
  const status = await hub.agentStatus('codex', 'pc');
  assert.equal(status.state, 'ready');
  assert.deepEqual(status.account, { kind: 'subscription', plan: 'pro' });
  assert.equal(status.version, '0.170.0');
  assert.ok(sshCalls().at(-1)!.includes('exec codex app-server\''), 'plain app-server, not the proxy');
});

test('WSL whose Codex keeps its state in Windows’ folder: no app server is started there, and it says why', async () => {
  daemon(false);
  fs.writeFileSync(path.join(dir, 'windows-home'), '');
  try {
    const calls = sshCalls().length;
    const status = await hub.agentStatus('codex', 'pc');
    assert.equal(status.state, 'offline');
    assert.match(status.reason!, /keeps its state in Windows’ folder \(\/mnt\/c\/Users\/me\/\.codex\)/);
    assert.equal(sshCalls().length, calls + 1, 'only the look, nothing started');
  } finally {
    fs.rmSync(path.join(dir, 'windows-home'));
  }
});

test('Claude Code on another device through its bridge, and what it says when the bridge is not there', async () => {
  assert.match((await hub.agentStatus('claude-code', 'pc')).reason!, /bridge isn’t running on pc\. Start it there/);
  hub.resetHub();
  ssh.forgetProbes();
  await startDeviceBridge();
  try {
    const status = await hub.agentStatus('claude-code', 'pc');
    assert.equal(status.state, 'signed-out');
    assert.equal(status.host, 'pc');
    assert.match(status.reason!, /isn’t signed in on pc/);
    assert.equal(status.version, '2.1.400');
  } finally {
    await bridgeServer?.close();
    bridgeServer = null;
    await bridge.close();
  }
  hub.resetHub();
  ssh.forgetProbes();
  const launcher = path.join(home, '.local', 'share', 'agentic-journal', 'claude-bridge', 'run');
  fs.renameSync(launcher, `${launcher}.off`);
  try {
    assert.match((await hub.agentStatus('claude-code', 'pc')).reason!, /bridge isn’t installed on pc\. Put it there with `scripts\/install-claude-bridge\.sh pc`/);
  } finally {
    fs.renameSync(`${launcher}.off`, launcher);
  }
});

test('routes: devices are listed at once, each device’s agents are asked on their own, and signing in works per device', async () => {
  const t0 = Date.now();
  const list = await json(await get(`id=${TASK}`));
  assert.equal(list.status, 200);
  assert.ok(Date.now() - t0 < 1000, 'the list never waits on a device');
  assert.deepEqual(list.body.data.devices.map((d: any) => [d.host, d.label, d.alias, d.here]), [['laptop', 'laptop', null, true], ['pc', 'pc', 'pc-box', false], ['far', 'far', 'nowhere', false], ['shut', 'shut', 'locked', false]]);
  assert.ok(list.body.data.places.some((p: any) => p.host === 'pc' && p.cwd === '~/projects/repo' && p.available));
  const far = await json(await get(`id=${TASK}&agents=1&host=far`));
  assert.equal(far.body.data.device.reachable, false);
  assert.equal(far.body.data.agents.codex.state, 'offline');
  assert.match(far.body.data.agents.codex.reason, /^far can’t be reached/);
  const pc = await json(await get(`id=${TASK}&agents=1&host=pc`));
  assert.equal(pc.body.data.device.reachable, true);
  assert.equal(pc.body.data.device.home, undefined, 'its home folder is not sent to the page');
  assert.equal(pc.body.data.agents.codex.state, 'ready');
  assert.equal((await json(await get(`id=${TASK}&agents=1&host=pi`))).status, 400);
  assert.equal((await json(await get(`id=${TASK}&models=codex&host=pc`))).body.data.models[0].id, 'gpt-a');
  // Signing in on another device: its Codex is asked, as this machine's would be (here it is signed in: 409).
  assert.equal((await json(await post({ action: 'login', taskId: TASK, agent: 'codex', host: 'pc' }))).status, 409);
  assert.equal((await json(await post({ action: 'login', taskId: TASK, agent: 'codex', host: 'pi' }))).body.error, 'No device is called pi.');
  fake.on('account/read', () => ({ account: null, requiresOpenaiAuth: true }));
  try {
    hub.resetHub();
    const login = await json(await post({ action: 'login', taskId: TASK, agent: 'codex', host: 'pc' }));
    assert.equal(login.status, 200);
    assert.deepEqual([login.body.data.host, login.body.data.code, login.body.data.state], ['pc', 'ABCD-1234', 'waiting']);
    assert.equal((await json(await get(`id=${TASK}&login=codex&host=pc`))).body.data.login.id, 'login-pc');
    assert.equal((await json(await get(`id=${TASK}&login=codex`))).body.data.login, null, 'this machine has none');
  } finally {
    fake.on('account/read', () => ({ account: { type: 'chatgpt', email: null, planType: 'plus' }, requiresOpenaiAuth: true }));
  }
  // A session there continued here keeps its folder as the PC writes it; one outside its projects is refused.
  const adopted = await json(await post({ action: 'adopt', taskId: TASK, agent: 'codex', sessionId: 'pc-web', host: 'pc' }));
  assert.equal(adopted.status, 200);
  assert.equal(adopted.body.data.cwd, '~/projects/repo/web');
  fake.on('thread/resume', (p) => ({ thread: DEFAULT_THREAD(p.threadId, { cwd: path.join(home, 'secrets') }), model: 'gpt-a' }));
  const outside = await json(await post({ action: 'adopt', taskId: TASK, agent: 'codex', sessionId: 'pc-secret', host: 'pc' }));
  assert.equal(outside.status, 400);
  // Its place is taken as written; a folder outside the PC's projects is not.
  assert.equal((await json(await post({ action: 'place', taskId: TASK, place: { host: 'pc', cwd: '~/projects/repo' } }))).status, 200);
  assert.equal((await json(await post({ action: 'place', taskId: TASK, place: { host: 'pc', cwd: '~/elsewhere' } }))).status, 400);
});
