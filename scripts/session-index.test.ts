import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { ingest } from '../src/lib/session-index/ingest.ts';
import { closeIndex, openIndex } from '../src/lib/session-index/store.ts';
import { parseTarget, searchSessions, sessionsFor, setFeedback } from '../src/lib/session-index/view.ts';
import { redact } from '../src/lib/session-index/redact.ts';
import type { SessionDigest } from '../src/lib/session-index/types.ts';
import { GET as cardRoute } from '../src/app/api/session-index/card/route.ts';
import { POST as feedbackRoute } from '../src/app/api/session-index/feedback/route.ts';

const TASK = '16dec41f-2a34-4d36-9ab4-47c902bbc1fd';
const OTHER_TASKS = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
const CARD = 'ac_1a2b3c4d';
const CARD_TASK = '77777777-7777-4777-8777-777777777777';
const NOW = Date.parse('2026-10-20T18:00:00Z');

let dir: string, previous: string | undefined;
const savedProj = { PROJ_REGISTRY_DIR: process.env.PROJ_REGISTRY_DIR, PROJ_HOST: process.env.PROJ_HOST };
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-index-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  // The proj registry: this machine is the laptop; the PC (wsl) is reached over ssh as win11.
  fs.mkdirSync(path.join(dir, 'proj', 'hosts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proj', 'registry.json'), JSON.stringify({ hosts: { laptop: { alias: 'ubuntu-laptop' }, wsl: { alias: 'win11' }, mac: { alias: 'macbook' } } }));
  process.env.PROJ_REGISTRY_DIR = path.join(dir, 'proj');
  process.env.PROJ_HOST = 'laptop';
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'tasks', 'have-to-do.json'), JSON.stringify({ tasks: [TASK, ...OTHER_TASKS, CARD_TASK].map((id) => ({ id, text: 'x' })) }));
  fs.mkdirSync(path.join(dir, 'action-cards'));
  fs.writeFileSync(path.join(dir, 'action-cards', 'cards.json'), JSON.stringify({ version: 1, cards: [
    { id: CARD, decision: { verdict: 'agree', taskId: CARD_TASK } },
    { id: 'ac_99999999' },
  ] }));
});
afterEach(() => {
  closeIndex();
  for (const [key, value] of Object.entries(savedProj)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

const digest = (over: Partial<SessionDigest> & { id: string }): SessionDigest => ({
  v: 1, app: 'claude-code', host: 'wsl', path: `/x/${over.id}.jsonl`, key: null, title: '', cwd: '/home/x/projects/SO-ARM-101',
  project: 'SO-ARM-101', branch: 'main', started: '2026-10-19T10:00:00Z', ended: '2026-10-19T11:00:00Z', turns: 1, files: [],
  refs: [], msgs: [['user', 'hello'], ['agent', 'hi']], cut: false, redactions: 0, ...over,
});

function send(host: string, digests: SessionDigest[], apps: unknown[] = []) {
  const inbox = path.join(dir, 'session-index', 'inbox', host);
  fs.mkdirSync(inbox, { recursive: true });
  for (const d of digests) fs.writeFileSync(path.join(inbox, `${d.app}-${d.id}-${host}.json`), JSON.stringify(d));
  fs.writeFileSync(path.join(inbox, `apps-${host}.json`), JSON.stringify({ v: 1, host, records: apps }));
}

const titles = (target: string) => sessionsFor(parseTarget(target)!, NOW).rows.map((r) => `${r.title} · ${r.why}`);

test('ingest keeps the newest copy of a session, takes the app title, and skips unchanged ones', () => {
  send('wsl', [digest({ id: 'aaa', title: 'old summary', ended: '2026-10-19T11:00:00Z', turns: 2 })],
    [{ cli: 'aaa', title: 'Hourly checkin screenshots', bridge: ['session_01ABC'], active: 5 }]);
  send('laptop', [digest({ id: 'aaa', host: 'laptop', ended: '2026-10-19T12:00:00Z', turns: 3 })]);
  const first = ingest();
  assert.equal(first.sessions, 1);
  assert.deepEqual(first.hosts, ['laptop', 'wsl']);
  const row = openIndex().prepare('select * from sessions').get() as { host: string; title: string; turns: number; bridge: string };
  assert.deepEqual([row.host, row.title, row.turns, row.bridge], ['laptop', 'Hourly checkin screenshots', 3, 'session_01ABC']);
  assert.equal(ingest().changed, 0);
});

test('a brief pasted into many sessions is not indexed, and text is redacted again', () => {
  const brief = 'SHARED RULES FOR ALL WORKERS. ' + 'Read the repo conventions and keep changes minimal. '.repeat(5);
  const key = 'sk-' + 'ant-' + 'api03-' + 'Z'.repeat(30);
  send('wsl', [1, 2, 3].map((i) => digest({ id: `s${i}`, msgs: [['user', `${brief}\n\nTask ${i}: fix the gripper ${i === 1 ? key : ''}`]] })));
  ingest();
  const text = (openIndex().prepare('select group_concat(text) as t from chunks').get() as { t: string }).t;
  assert.doesNotMatch(text, /SHARED RULES/);
  assert.match(text, /Task 2: fix the gripper/);
  assert.ok(!text.includes(key));
});

test('OpenClaw keys link a task to its brief run (latest only) and its chat', () => {
  send('laptop', [
    digest({ id: 'b1', app: 'openclaw', host: 'laptop', key: `agent:main:journal-brief-${TASK}-1792000000000`, ended: '2026-10-18T10:00:00Z' }),
    digest({ id: 'b2', app: 'openclaw', host: 'laptop', key: `agent:main:journal-brief-${TASK}-1792100000000`, ended: '2026-10-19T10:00:00Z', title: 'brief run 2' }),
    digest({ id: 'c1', app: 'openclaw', host: 'laptop', key: `agent:main:journal-chat-${TASK}-1792200000000`, title: 'Ask about checkins' }),
    digest({ id: 'x', app: 'openclaw', host: 'laptop', key: `agent:main:journal-chat-${OTHER_TASKS[0]}-1792200000000` }),
  ]);
  ingest();
  const v = sessionsFor(parseTarget(`task:${TASK}`)!, NOW);
  assert.deepEqual(v.rows.map((r) => [r.title, r.why, r.key?.slice(-13)]), [
    ['Ask about checkins', 'Your chat with OpenClaw about this task', '1792200000000'],
    ['brief run 2', 'OpenClaw filled in this brief', '1792100000000'],
  ]);
  assert.equal(v.indexed, 4);
});

test('a card links its own chat and the sessions of the task it became', () => {
  send('laptop', [
    digest({ id: 'cc', app: 'openclaw', host: 'laptop', key: 'agent:main:journal-chat-card-ac-1a2b3c4d-1792500000000', title: 'Card chat' }),
    digest({ id: 'tc', app: 'openclaw', host: 'laptop', key: `agent:main:journal-chat-${CARD_TASK}-1792600000000`, title: 'Task chat' }),
  ]);
  ingest();
  assert.deepEqual(titles(`card:${CARD}`).sort(), ['Card chat · Your chat with OpenClaw about this card', 'Task chat · Your chat with OpenClaw about its task']);
  assert.deepEqual(titles(`task:${CARD_TASK}`).sort(), ['Card chat · Your chat with OpenClaw about its action card', 'Task chat · Your chat with OpenClaw about this task']);
});

test('naming the id links a session, except surveys of many ids and the Journal’s own development', () => {
  send('wsl', [
    digest({ id: 'work', title: 'Checkin screenshots', refs: [TASK] }),
    digest({ id: 'hub', title: 'Plan my day', refs: [TASK, ...OTHER_TASKS] }),
    digest({ id: 'started', title: 'Started from card', refs: [TASK, ...OTHER_TASKS, `aj:task:${TASK}`] }),
    digest({ id: 'dev', title: 'Debug cards', refs: [TASK], project: 'agentic-journal-022da82c7b35aaa6' }),
    digest({ id: 'near', title: 'Near miss', refs: ['ac_1a2b3c4dX'] }),
  ]);
  ingest();
  assert.deepEqual(titles(`task:${TASK}`).sort(), ['Checkin screenshots · Works on this task by its id', 'Started from card · Started from this task']);
  assert.deepEqual(titles(`card:${CARD}`), []);
});

test('Adamya can link a session by hand and say "not this" to any', () => {
  send('wsl', [digest({ id: 'work', title: 'Checkin screenshots', refs: [TASK] }), digest({ id: 'other', title: 'Gripper camera mount', msgs: [['user', 'fix the mujoco camera mount']] })]);
  ingest();
  const target = parseTarget(`task:${TASK}`)!;
  setFeedback(target, 'claude-code:other', 'link');
  assert.deepEqual(titles(target), ['Gripper camera mount · You linked it', 'Checkin screenshots · Works on this task by its id']);
  setFeedback(target, 'claude-code:work', 'not');
  assert.deepEqual(titles(target), ['Gripper camera mount · You linked it']);
  setFeedback(target, 'claude-code:work', 'clear');
  assert.equal(titles(target).length, 2);
  assert.throws(() => setFeedback(target, 'codex:nope', 'link'), /not in the index/);
});

test('rows carry the way back in: Control UI key, claude.ai link, or a resume command', () => {
  send('wsl', [
    digest({ id: 'oc', app: 'openclaw', key: `agent:main:journal-chat-${TASK}-1`, ended: '2026-10-20T17:50:00Z' }),
    digest({ id: 'cc', refs: [TASK], cwd: "/home/x/it's here" }),
    digest({ id: 'rc', refs: [TASK] }),
    digest({ id: 'cx', app: 'codex', refs: [TASK], cwd: '/home/x/projects/SO-ARM-101' }),
    digest({ id: 'lx', app: 'codex', host: 'laptop', refs: [TASK], cwd: '/home/openclaw/projects/site' }),
  ], [{ cli: 'rc', title: 'Remote one', bridge: ['session_01XYZ'] }]);
  ingest();
  const rows = Object.fromEntries(sessionsFor(parseTarget(`task:${TASK}`)!, NOW).rows.map((r) => [r.uid, r]));
  assert.equal(rows['openclaw:oc'].key, `agent:main:journal-chat-${TASK}-1`);
  assert.equal(rows['openclaw:oc'].live, true);
  assert.equal(rows['claude-code:rc'].href, 'https://claude.ai/code/session_01XYZ');
  // On another device, the command runs there: ssh by its alias, in its login shell (its own codex and claude).
  assert.equal(rows['codex:cx'].resume, `ssh -t win11 'exec "$SHELL" -lc "cd /home/x/projects/SO-ARM-101 && codex resume cx"'`);
  assert.equal(rows['claude-code:cc'].resume, `ssh -t win11 'exec "$SHELL" -lc '\\''cd '\\''\\'\\'''\\''/home/x/it'\\''\\'\\'''\\''\\'\\''\\'\\'''\\'''\\''\\'\\'''\\''s here'\\''\\'\\'''\\'' && claude --resume cc'\\'''`);
  assert.equal(rows['codex:cx'].machine, 'PC');
  assert.equal(rows['codex:lx'].resume, `cd '/home/openclaw/projects/site' && codex resume lx`);
});

test('search finds sessions by words in their title or text', () => {
  send('wsl', [digest({ id: 'a', title: 'Capture thought button image pasting' }), digest({ id: 'b', msgs: [['user', 'tune the mujoco gripper camera']] })]);
  ingest();
  assert.deepEqual(searchSessions('capture past').map((r) => r.uid), ['claude-code:a']);
  assert.deepEqual(searchSessions('gripper').map((r) => r.uid), ['claude-code:b']);
  assert.deepEqual(searchSessions('  '), []);
});

test('redaction removes keys, tokens and passwords', () => {
  const s = redact(['sk-' + 'proj-' + 'A1'.repeat(15), 'gh' + 'p_' + 'a1B2'.repeat(9), 'DB_PASS' + 'WORD=hunter22secret', 'task-creation-flow stays'].join(' '));
  assert.equal(s, '[api key] [github token] DB_PASSWORD=[redacted] task-creation-flow stays');
});

test('the API checks the target and saves feedback', async () => {
  send('wsl', [digest({ id: 'work', refs: [TASK] })]);
  ingest();
  const bad = await cardRoute(new NextRequest('http://x/api/session-index/card?target=task:nope'));
  assert.equal(bad.status, 400);
  const ok = await (await cardRoute(new NextRequest(`http://x/api/session-index/card?target=task:${TASK}`))).json();
  assert.equal(ok.data.rows.length, 1);
  const res = await feedbackRoute(new NextRequest('http://x/api/session-index/feedback', {
    method: 'POST', body: JSON.stringify({ target: `task:${TASK}`, uid: 'claude-code:work', verdict: 'not' }),
  }));
  assert.equal((await res.json()).data.rows.length, 0);
});

// ---- The task's own coding sessions (Codex, Claude Code started from its chats or brought into them).

function codeSessions(byTask: Record<string, object[]>) {
  fs.writeFileSync(path.join(dir, 'tasks', 'code-sessions.json'), JSON.stringify({ schemaVersion: 1, sessions: byTask }));
}
const codeLink = (over: Record<string, unknown>) => ({
  id: `cs${Math.random().toString(36).slice(2, 8)}`, agent: 'codex', host: 'laptop', cwd: '/home/openclaw/projects/site', sessionId: 'th-1', title: 'Make the tests pass',
  picks: { model: null, effort: null, mode: 'own' }, createdAt: '2026-10-20T16:00:00Z', touchedAt: '2026-10-20T16:30:00Z', seenAt: null,
  lastState: 'idle', lastLine: '', settledAt: '2026-10-20T16:40:00Z', ...over,
});

test('a task’s own coding sessions are on it exactly, with no index on this server at all', () => {
  codeSessions({
    [TASK]: [
      codeLink({ sessionId: 'th-started', title: 'Make the tests pass' }),
      codeLink({ agent: 'claude-code', sessionId: 'cc-adopted', title: 'Fix the gripper', adopted: true, cwd: '/home/x/it', workingSince: '2026-10-20T17:55:00Z' }),
      codeLink({ sessionId: 'th-archived', title: 'An old try', archived: true }),
    ],
    [OTHER_TASKS[0]]: [codeLink({ sessionId: 'th-other', title: 'Not this task' })],
  });
  const v = sessionsFor(parseTarget(`task:${TASK}`)!, NOW);
  assert.equal(v.indexed, 0);
  assert.deepEqual(v.rows.map((r) => [r.uid, r.why, r.live]), [
    ['claude-code:cc-adopted', 'Brought into this task’s chats', true],
    ['codex:th-started', 'Started from this task’s chats', false],
    ['codex:th-archived', 'Was one of this task’s chats', false],
  ]);
  const started = v.rows.find((r) => r.uid === 'codex:th-started')!;
  assert.deepEqual([started.title, started.machine, started.started, started.ended, started.turns, started.project], ['Make the tests pass', 'laptop', '2026-10-20T16:00:00Z', '2026-10-20T16:40:00Z', 0, 'site']);
  assert.equal(started.resume, `cd '/home/openclaw/projects/site' && codex resume th-started`);
  // Touched a moment ago is not "running now": only a turn that runs is.
  codeSessions({ [TASK]: [codeLink({ sessionId: 'th-started', touchedAt: '2026-10-20T17:59:00Z', settledAt: '2026-10-20T17:59:00Z' })] });
  assert.equal(sessionsFor(parseTarget(`task:${TASK}`)!, NOW).rows[0]!.live, false);
  // Another task, and a card with no task, have none of them; nor does the index's own file get made by reading.
  assert.deepEqual(titles(`task:${OTHER_TASKS[1]}`), []);
  assert.equal(fs.existsSync(path.join(dir, 'session-index', 'index.db')), false);
});

test('a coding session the index also found is one row: the index’s record, the link’s reason', () => {
  codeSessions({ [TASK]: [codeLink({ sessionId: 'th-1', title: 'Journal title' })] });
  // Its transcript carries the [aj:task:…] mark of its first turn, so the index links it too, by itself.
  send('laptop', [digest({ id: 'th-1', app: 'codex', host: 'laptop', title: 'Codex’s own title', turns: 7, refs: [`aj:task:${TASK}`] })]);
  ingest();
  const v = sessionsFor(parseTarget(`task:${TASK}`)!, NOW);
  assert.deepEqual(v.rows.map((r) => [r.uid, r.title, r.why, r.turns]), [['codex:th-1', 'Codex’s own title', 'Started from this task’s chats', 7]]);
  assert.equal(v.indexed, 1);
  // Its last message a moment ago does not make it "running now" either: only the hub's stamp does (seen live:
  // an idle Claude Code session finished two minutes before read as running).
  send('laptop', [digest({ id: 'th-1', app: 'codex', host: 'laptop', title: 'Codex’s own title', turns: 7, refs: [`aj:task:${TASK}`], ended: new Date(NOW - 60_000).toISOString() })]);
  ingest();
  assert.equal(sessionsFor(parseTarget(`task:${TASK}`)!, NOW).rows[0]!.live, false);
  codeSessions({ [TASK]: [codeLink({ sessionId: 'th-1', workingSince: new Date(NOW - 60_000).toISOString() })] });
  assert.equal(sessionsFor(parseTarget(`task:${TASK}`)!, NOW).rows[0]!.live, true);
});

test('the card a task came from shows the task’s coding sessions too', () => {
  codeSessions({ [CARD_TASK]: [codeLink({ sessionId: 'th-card', title: 'From the card’s task' })] });
  assert.deepEqual(titles(`card:${CARD}`), ['From the card’s task · Started from its task’s chats']);
  assert.deepEqual(titles('card:ac_99999999'), []);
});

test('"Not this" takes a coding session off the task even before the index has it, and can be undone', async () => {
  codeSessions({ [TASK]: [codeLink({ sessionId: 'th-1' }), codeLink({ sessionId: 'th-2', title: 'Second' })] });
  const target = parseTarget(`task:${TASK}`)!;
  setFeedback(target, 'codex:th-1', 'not');
  assert.deepEqual(titles(target), ['Second · Started from this task’s chats']);
  setFeedback(target, 'codex:th-1', 'clear');
  assert.equal(titles(target).length, 2);
  // Only the task's own sessions: a session of another task, not in the index, still cannot be linked or refused.
  assert.throws(() => setFeedback(parseTarget(`task:${OTHER_TASKS[0]}`)!, 'codex:th-1', 'not'), /not in the index/);
  assert.throws(() => setFeedback(target, 'codex:th-3', 'link'), /not in the index/);
  // Through the API, as the brief cards do.
  const res = await feedbackRoute(new NextRequest('http://x/api/session-index/feedback', {
    method: 'POST', body: JSON.stringify({ target: `task:${TASK}`, uid: 'codex:th-2', verdict: 'not' }),
  }));
  assert.deepEqual((await res.json()).data.rows.map((r: { uid: string }) => r.uid), ['codex:th-1']);
});
