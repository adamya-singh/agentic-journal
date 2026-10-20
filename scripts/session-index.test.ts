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
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-index-test-'));
  process.env.BACKEND_DATA_DIR = dir;
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
  ], [{ cli: 'rc', title: 'Remote one', bridge: ['session_01XYZ'] }]);
  ingest();
  const rows = Object.fromEntries(sessionsFor(parseTarget(`task:${TASK}`)!, NOW).rows.map((r) => [r.uid, r]));
  assert.equal(rows['openclaw:oc'].key, `agent:main:journal-chat-${TASK}-1`);
  assert.equal(rows['openclaw:oc'].live, true);
  assert.equal(rows['claude-code:rc'].href, 'https://claude.ai/code/session_01XYZ');
  assert.equal(rows['claude-code:cc'].resume, `cd '/home/x/it'\\''s here' && claude --resume cc`);
  assert.equal(rows['codex:cx'].resume, `cd '/home/x/projects/SO-ARM-101' && codex resume cx`);
  assert.equal(rows['codex:cx'].machine, 'PC');
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
