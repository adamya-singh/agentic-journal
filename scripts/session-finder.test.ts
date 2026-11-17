// Finding a session to link to a task: the read-only search OpenClaw is given over the session index, what it is told
// and how its answer is read and checked (no uid the index does not hold is ever shown), the "Ask OpenClaw" route,
// and "Check again" (a short sync under the index's lock, shared by presses that come together).
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { collect } from '../src/lib/session-index/collect.ts';
import { appOf, boundOf, findSessions, hostOf, sessionDetail } from '../src/lib/session-index/find.ts';
import { ingest } from '../src/lib/session-index/ingest.ts';
import { syncLockFile, syncLockHolder, trySyncLock } from '../src/lib/session-index/lock.ts';
import { deviceProblem, readSyncOutput, refreshIndex, resetRefreshState } from '../src/lib/session-index/refresh.ts';
import { closeIndex } from '../src/lib/session-index/store.ts';
import type { SessionDigest } from '../src/lib/session-index/types.ts';
import { parseTarget, searchSessions, sessionsFor, setFeedback } from '../src/lib/session-index/view.ts';
import { extractJsonObject } from '../src/lib/done-at.ts';
import { journalSelfOrigin } from '../src/lib/same-origin.ts';
import {
  buildFinderTurn, checkFinderPicks, finderAnswer, finderError, newFinderChat, readFinderFile, readFinderReply, settleFinder, startFinderTurn, withoutIds,
  type FinderContext, type FinderView,
} from '../src/lib/session-finder.ts';
import * as findRoute from '../src/app/api/session-index/find/route.ts';
import * as finderRoute from '../src/app/api/session-index/finder/route.ts';
import * as refreshRoute from '../src/app/api/session-index/refresh/route.ts';

const TASK = '16dec41f-2a34-4d36-9ab4-47c902bbc1fd';
const OTHER = '11111111-1111-4111-8111-111111111111';
const SAME = { 'sec-fetch-site': 'same-origin', host: '127.0.0.1:3111', origin: 'http://127.0.0.1:3111' };

let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV = ['BACKEND_DATA_DIR', 'PROJ_REGISTRY_DIR', 'PROJ_HOST', 'OPENCLAW_CLI_PATH', 'SESSION_INDEX_CLI', 'CODE_AGENTS_SSH', 'CODE_AGENTS_SSH_CONTROL', 'BRIEF_AGENT_DISABLED', 'TASK_WORKER_DISABLED'];

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-finder-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  process.env.BRIEF_AGENT_DISABLED = '1';
  process.env.TASK_WORKER_DISABLED = '1';
  // The proj registry knows the laptop (this machine), the PC and the Mac; only the first two have sent sessions.
  fs.mkdirSync(path.join(dir, 'proj', 'hosts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'proj', 'registry.json'), JSON.stringify({ hosts: { laptop: { alias: 'ubuntu-laptop' }, wsl: { alias: 'win11' }, mac: { alias: 'macbook' } } }));
  process.env.PROJ_REGISTRY_DIR = path.join(dir, 'proj');
  process.env.PROJ_HOST = 'laptop';
  fs.mkdirSync(path.join(dir, 'tasks'));
  fs.writeFileSync(path.join(dir, 'tasks', 'have-to-do.json'), JSON.stringify({ tasks: [
    { id: TASK, text: 'Flash the ESC firmware on the drone', notesMarkdown: `Parts list in ${OTHER}. See ac_1a2b3c4d.` },
    { id: OTHER, text: 'Other task' },
  ] }));
  resetRefreshState();
});

afterEach(() => {
  closeIndex();
  resetRefreshState();
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  fs.rmSync(dir, { recursive: true, force: true });
});

const digest = (over: Partial<SessionDigest> & { id: string }): SessionDigest => ({
  v: 1, app: 'codex', host: 'wsl', path: `/x/${over.id}.jsonl`, key: null, title: '', cwd: '/home/x/projects/drone',
  project: 'drone', branch: 'main', started: '2026-11-10T10:00:00Z', ended: '2026-11-10T11:00:00Z', turns: 3, files: [],
  refs: [], msgs: [['user', 'hello'], ['agent', 'hi']], cut: false, redactions: 0, ...over,
});

function send(host: string, digests: SessionDigest[]) {
  const inbox = path.join(dir, 'session-index', 'inbox', host);
  fs.mkdirSync(inbox, { recursive: true });
  for (const d of digests) fs.writeFileSync(path.join(inbox, `${d.app}-${d.id}.json`), JSON.stringify(d));
  fs.writeFileSync(path.join(inbox, `apps-${host}.json`), JSON.stringify({ v: 1, host, records: [] }));
}

/** An index with sessions on the PC and the laptop, one of them the Journal's own finder chat. */
function seed() {
  send('wsl', [
    digest({ id: 'esc-mac', host: 'wsl', title: 'Flash BLHeli ESC firmware', started: '2026-11-09T10:00:00Z', ended: '2026-11-09T12:00:00Z', msgs: [['user', 'the ESC firmware flashing keeps failing on motor 3'], ['agent', 'Reflashed with BLHeli_S 16.7']] }),
    digest({ id: 'esc-old', host: 'wsl', app: 'claude-code', title: 'ESC wiring', started: '2026-10-01T10:00:00Z', ended: '2026-10-01T11:00:00Z', msgs: [['user', 'how do I wire the ESC'], ['agent', 'Solder the pads']] }),
    digest({ id: 'gripper', host: 'wsl', title: 'Gripper camera mount', project: 'SO-ARM-101', cwd: '/home/x/projects/SO-ARM-101', msgs: [['user', 'fix the mujoco camera mount'], ['agent', 'done']] }),
  ]);
  send('laptop', [
    digest({ id: 'journal', host: 'laptop', app: 'claude-code', title: 'Sunrise polish', project: 'agentic-journal', cwd: '/home/o/projects/agentic-journal', msgs: [['user', 'polish the sunrise sky firmware joke'], ['agent', 'ok']] }),
    digest({ id: 'finder', host: 'laptop', app: 'openclaw', key: `agent:main:cron:journal-find-${TASK}-1792000000000`, title: 'find ESC firmware session', refs: [TASK], msgs: [['user', 'Adamya is looking for an ESC firmware session'], ['agent', '{}']] }),
  ]);
  ingest();
}

// ---- The search OpenClaw is given.

test('find: words over title and text, every word first, then most of them; filters narrow it', () => {
  seed();
  assert.deepEqual(findSessions({ q: 'ESC firmware' }).map((s) => s.uid).slice(0, 1), ['codex:esc-mac']);
  // "firmware" alone: the finder chat itself is never a hit.
  assert.ok(!findSessions({ q: 'firmware' }).some((s) => s.uid.startsWith('openclaw:')));
  // Most of the words: "ESC soldering" has no session with both, but ESC sessions follow.
  assert.ok(findSessions({ q: 'ESC soldering' }).some((s) => s.uid === 'claude-code:esc-old'));
  assert.deepEqual(findSessions({ q: 'ESC', app: 'claude-code' }).map((s) => s.uid), ['claude-code:esc-old']);
  assert.deepEqual(findSessions({ q: 'ESC', before: '2026-10-15' }).map((s) => s.uid), ['claude-code:esc-old']);
  assert.deepEqual(findSessions({ q: 'ESC', after: '2026-11-01', host: 'wsl' }).map((s) => s.uid), ['codex:esc-mac']);
  assert.deepEqual(findSessions({ folder: 'so-arm' }).map((s) => s.uid), ['codex:gripper']);
  assert.deepEqual(findSessions({ q: 'ESC', host: 'mac' }), []);
  // No words: the latest sessions that fit, newest first.
  assert.equal(findSessions({ host: 'wsl', limit: 2 }).length, 2);
  const hit = findSessions({ q: 'motor' })[0]!;
  assert.equal(hit.device, 'PC');
  assert.match(hit.match ?? '', /«motor»/);
  assert.equal(hit.first, 'the ESC firmware flashing keeps failing on motor 3');
});

test('find: one session in detail; the names he uses for apps, devices and dates', () => {
  seed();
  const d = sessionDetail('codex:esc-mac')!;
  assert.match(d.text, /BLHeli_S 16\.7/);
  assert.equal(d.cut, false);
  assert.equal(sessionDetail('codex:nope'), null);
  assert.equal(sessionDetail(`openclaw:finder`), null);
  assert.deepEqual(['Codex', 'claude', 'CC', 'openclaw', 'vim'].map(appOf), ['codex', 'claude-code', 'claude-code', 'openclaw', null]);
  assert.deepEqual(['PC', 'Mac', 'laptop', 'windows', ''].map(hostOf), ['wsl', 'mac', 'laptop', 'wsl', null]);
  assert.equal(boundOf('2026-11-09', true), '2026-11-09T23:59:59.999Z');
  assert.equal(boundOf('soon', false), null);
});

test('the finder chat is not work on the task, and is not offered in the manual search', () => {
  seed();
  const rows = sessionsFor(parseTarget(`task:${TASK}`)!).rows;
  assert.ok(!rows.some((r) => r.uid === 'openclaw:finder'));
  assert.ok(!searchSessions('firmware').some((r) => r.uid === 'openclaw:finder'));
});

test('GET /api/session-index/find: the search and the detail, parameters checked, other sites refused', async () => {
  seed();
  const get = (q: string, headers: Record<string, string> = {}) => findRoute.GET(new NextRequest(`http://127.0.0.1:3111/api/session-index/find?${q}`, { headers }));
  const found = await (await get('q=ESC+firmware&device=PC&app=codex')).json();
  assert.equal(found.success, true);
  assert.equal(found.data[0].uid, 'codex:esc-mac');
  assert.equal((await (await get('uid=codex:esc-mac')).json()).data.title, 'Flash BLHeli ESC firmware');
  assert.equal((await get('uid=codex:made-up')).status, 404);
  assert.equal((await get('app=vim')).status, 400);
  assert.equal((await get('after=whenever')).status, 400);
  assert.equal((await get('text=ESC')).status, 400);   // not a parameter it has
  assert.equal((await get('q=ESC', { 'sec-fetch-site': 'cross-site' })).status, 403);
  assert.equal((await get('q=ESC', SAME)).status, 200);
});

// ---- What OpenClaw is told, and how its answer is read.

const context = (over: Partial<FinderContext> = {}): FinderContext => ({
  task: { title: 'Flash the ESC firmware on the drone', kind: 'errand · Personal', due: 'Fri Nov 20', notes: `Parts in ${OTHER}; card ac_1a2b3c4d; [aj:task:${OTHER}]` },
  origin: 'http://127.0.0.1:3111', indexed: 1412, devices: [{ machine: 'laptop', lastSync: '2026-11-17T19:28:10Z' }, { machine: 'PC', lastSync: '2026-11-17T19:31:02Z' }],
  missing: ['Mac'], linked: ['Drone parts order'], now: new Date('2026-11-17T20:00:00Z'), ...over,
});

test('the first turn says the task, the search, what it may not do and the exact reply; ids are never in it', () => {
  const first = buildFinderTurn({ first: true, text: `the Codex one on the PC for task ${TASK}`, context: context() });
  assert.match(first, /The task: “Flash the ESC firmware on the drone”/);
  assert.match(first, /curl -s 'http:\/\/127\.0\.0\.1:3111\/api\/session-index\/find\?q=/);
  assert.match(first, /do not link anything/);
  assert.match(first, /Nothing from Mac is indexed yet/);
  assert.match(first, /do not offer these\): “Drone parts order”/);
  assert.match(first, /\{"message": .*"sessions": \[\{"uid":/);
  assert.match(first, /Tuesday, November 17, 2026/);
  assert.ok(first.endsWith(`Adamya’s message:\nthe Codex one on the PC for task [id]`));
  for (const id of [TASK, OTHER, 'ac_1a2b3c4d', 'aj:task']) assert.ok(!first.includes(id), id);
  const later = buildFinderTurn({ first: false, text: 'no, the earlier one', context: context() });
  assert.ok(later.startsWith('Adamya’s message:\nno, the earlier one'));
  assert.match(later, /only uids the index returned/);
  assert.equal(withoutIds('x ac_deadbeef y'), 'x [card] y');
});

test('a reply is read as JSON; uids the index does not hold are dropped and counted', () => {
  assert.equal(readFinderReply(null), null);
  assert.equal(readFinderReply({ answer: 'x' }), null);
  assert.deepEqual(readFinderReply({ message: ' Found it. ', sessions: [{ uid: ' codex:a ', why: 'the Mac one' }, { uid: 'codex:a', why: 'dup' }, { uid: 'codex:b' }] }),
    { message: 'Found it.', picks: [{ uid: 'codex:a', why: 'the Mac one' }, { uid: 'codex:b', why: '' }] });
  const known = (uid: string) => uid === 'codex:a' || uid === 'claude-code:c';
  assert.deepEqual(checkFinderPicks([{ uid: 'codex:a', why: '' }, { uid: 'codex:zzz', why: '' }, { uid: 'rm -rf:/', why: '' }, { uid: 'claude-code:c', why: '' }], known),
    { picks: [{ uid: 'codex:a', why: '' }, { uid: 'claude-code:c', why: '' }], invented: 2 });
  const at = '2026-11-17T20:00:00Z';
  const said = finderAnswer('```json\n{"message":"Two fit.","sessions":[{"uid":"codex:a","why":"Mac, last week"},{"uid":"codex:made-up","why":"x"}]}\n```', extractJsonObject, known, at);
  assert.deepEqual(said, { role: 'openclaw', text: 'Two fit.', at, picks: [{ uid: 'codex:a', why: 'Mac, last week' }], invented: 1 });
  const loose = finderAnswer('I think it was the session about codex:a', extractJsonObject, known, at);
  assert.equal(loose.loose, true);
  assert.equal(loose.picks, undefined);
  assert.equal(finderAnswer('{"message":"","sessions":[]}', extractJsonObject, known, at).text, 'I found nothing that fits.');
});

test('a turn: the first carries everything until OpenClaw answers; retry resends; stale turns settle; errors in words', () => {
  const now = new Date('2026-11-17T20:00:00Z');
  const chat = newFinderChat(TASK, now);
  assert.match(chat.sessionKey, new RegExp(`^agent:main:cron:journal-find-${TASK}-\\d+$`));
  assert.equal(startFinderTurn(chat, null, now), null);
  assert.deepEqual(startFinderTurn(chat, ' the ESC one ', now), { first: true, text: 'the ESC one' });
  chat.pendingSince = null;
  assert.deepEqual(startFinderTurn(chat, null, now), { first: true, text: 'the ESC one' });
  assert.equal(chat.messages.length, 1);
  chat.messages.push({ role: 'openclaw', text: 'x', at: now.toISOString() });
  assert.equal(startFinderTurn(chat, 'earlier', now)!.first, false);
  assert.equal(settleFinder(chat, new Date(now.getTime() + 60_000)), false);
  assert.equal(settleFinder(chat, new Date(now.getTime() + 7 * 60_000)), true);
  assert.equal(chat.error?.kind, 'lost');
  assert.equal(finderError(new Error('connect ECONNREFUSED 127.0.0.1:18789')).kind, 'unavailable');
  assert.equal(finderError(new Error('OpenClaw agent turn failed: rate limit')).kind, 'busy');
  assert.equal(finderError(new Error('boom')).text, 'OpenClaw couldn’t answer.');
  assert.deepEqual(readFinderFile({ chats: { [TASK]: { ...chat, messages: [...chat.messages, { role: 'x', text: 1 }] }, bad: { sessionKey: 3 } } })[TASK]!.messages.length, 3);
  assert.equal(journalSelfOrigin('127.0.0.1:3111'), 'http://127.0.0.1:3111');
  assert.equal(journalSelfOrigin('ubuntu-laptop.taile85e97.ts.net'), 'http://127.0.0.1:3000');
  assert.equal(journalSelfOrigin('evil.example:3000'), 'http://127.0.0.1:3000');
});

// ---- The "Ask OpenClaw" route, with a stand-in for OpenClaw.

function stubOpenClaw(answers: string[]) {
  const stub = path.join(dir, 'openclaw-stub.js');
  const log = path.join(dir, 'openclaw-calls.jsonl');
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(answers));
  fs.writeFileSync(stub, `
    const fs = require('fs');
    const args = process.argv.slice(2);
    if (args[0] !== 'agent') process.exit(1);
    const calls = fs.existsSync(${JSON.stringify(log)}) ? fs.readFileSync(${JSON.stringify(log)}, 'utf8').trim().split('\\n').length : 0;
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ key: args[args.indexOf('--session-key') + 1], message: args[args.indexOf('--message') + 1] }) + '\\n');
    const answer = JSON.parse(fs.readFileSync(${JSON.stringify(path.join(dir, 'answers.json'))}, 'utf8'))[calls];
    if (answer === 'FAIL') { process.stderr.write('connect ECONNREFUSED 127.0.0.1:18789'); process.exit(1); }
    process.stdout.write(JSON.stringify({ status: 'ok', result: { payloads: [{ text: answer }] } }));
  `);
  process.env.OPENCLAW_CLI_PATH = stub;
  return () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { key: string; message: string }) : []);
}

const finderGet = async () => (await (await finderRoute.GET(new NextRequest(`http://127.0.0.1:3111/api/session-index/finder?taskId=${TASK}`, { headers: SAME }))).json()).data as FinderView;
const finderPost = (body: unknown, headers: Record<string, string> = SAME) => finderRoute.POST(new NextRequest('http://127.0.0.1:3111/api/session-index/finder', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}));
async function settled(): Promise<FinderView> {
  for (let i = 0; i < 100; i++) {
    const view = await finderGet();
    if (!view.pending) return view;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('the turn never settled');
}

test('POST /api/session-index/finder: asks, shows only indexed sessions as rows, follows up in the same session', async () => {
  seed();
  const calls = stubOpenClaw([
    JSON.stringify({ message: 'The PC one from Nov 9 fits best.', sessions: [{ uid: 'codex:esc-mac', why: 'ESC flashing failing on motor 3' }, { uid: 'codex:invented', why: 'x' }] }),
    JSON.stringify({ message: 'The earlier one is the wiring session.', sessions: [{ uid: 'claude-code:esc-old', why: 'Oct 1, ESC wiring' }] }),
  ]);
  const sent = await finderPost({ action: 'send', taskId: TASK, text: 'the Codex session where I fixed the ESC flashing' });
  assert.equal(sent.status, 200);
  assert.equal(((await sent.json()).data as FinderView).pending, true);
  let view = await settled();
  assert.deepEqual(view.missing, ['Mac']);
  const answer = view.messages[1]!;
  assert.equal(answer.text, 'The PC one from Nov 9 fits best.');
  assert.deepEqual(answer.sessions!.map((r) => [r.uid, r.why, r.machine, r.tier]), [['codex:esc-mac', 'ESC flashing failing on motor 3', 'PC', 'matched']]);
  assert.equal(answer.invented, 1);
  // Nothing was linked by OpenClaw.
  assert.ok(!sessionsFor(parseTarget(`task:${TASK}`)!).rows.some((r) => r.uid === 'codex:esc-mac'));

  await finderPost({ action: 'send', taskId: TASK, text: 'no, the earlier one' });
  view = await settled();
  assert.equal(view.messages.length, 4);
  assert.equal(view.messages[3]!.sessions![0]!.uid, 'claude-code:esc-old');
  const [one, two] = calls();
  assert.equal(one!.key, two!.key);
  assert.match(one!.message, /The task: “Flash the ESC firmware on the drone”/);
  assert.match(one!.message, /http:\/\/127\.0\.0\.1:3111\/api\/session-index\/find/);
  assert.ok(!one!.message.includes(TASK) && !one!.message.includes(OTHER));
  assert.ok(two!.message.startsWith('Adamya’s message:\nno, the earlier one'));
  // Not one of the task's chats.
  assert.ok(!fs.existsSync(path.join(dir, 'tasks', 'brief-chats.json')));

  // Linking stays his: the same feedback the manual search sends.
  setFeedback(parseTarget(`task:${TASK}`)!, 'claude-code:esc-old', 'link');
  assert.ok(sessionsFor(parseTarget(`task:${TASK}`)!).rows.some((r) => r.uid === 'claude-code:esc-old'));

  // Start over: a new session next time.
  assert.equal((await finderPost({ action: 'reset', taskId: TASK })).status, 200);
  assert.deepEqual((await finderGet()).messages, []);
});

test('POST /api/session-index/finder: a failed turn can be retried; busy, no OpenClaw, no index, bad input, other sites', async () => {
  seed();
  const calls = stubOpenClaw(['FAIL', JSON.stringify({ message: 'Found nothing.', sessions: [] })]);
  await finderPost({ action: 'send', taskId: TASK, text: 'the ESC one' });
  let view = await settled();
  assert.deepEqual(view.error, { kind: 'unavailable', text: 'OpenClaw’s gateway isn’t answering right now.' });
  await finderPost({ action: 'retry', taskId: TASK });
  view = await settled();
  assert.equal(view.error, null);
  assert.equal(view.messages.length, 2);
  assert.equal(view.messages[1]!.text, 'Found nothing.');
  assert.equal(view.messages[1]!.sessions, undefined);
  // The retry was the first turn again: OpenClaw had never answered.
  assert.match(calls()[1]!.message, /The task:/);

  // Busy while a turn is out.
  fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(['', '', '{}']));
  const slow = path.join(dir, 'openclaw-stub.js');
  fs.writeFileSync(slow, `setTimeout(() => process.stdout.write(JSON.stringify({ status: 'ok', result: { payloads: [{ text: '{"message":"x","sessions":[]}' }] } })), 400);`);
  assert.equal((await finderPost({ action: 'send', taskId: TASK, text: 'again' })).status, 200);
  assert.equal((await finderPost({ action: 'send', taskId: TASK, text: 'and again' })).status, 409);
  assert.equal((await finderPost({ action: 'reset', taskId: TASK })).status, 409);
  await settled();

  assert.equal((await finderPost({ action: 'send', taskId: TASK, text: 'x' }, { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:3111' })).status, 403);
  assert.equal((await finderPost({ action: 'send', taskId: TASK, text: 'x' }, { host: '127.0.0.1:3111' })).status, 403);   // says nothing of where it is from
  assert.equal((await finderPost({ action: 'send', taskId: 'nope', text: 'x' })).status, 400);
  assert.equal((await finderPost({ action: 'send', taskId: TASK, text: '' })).status, 400);
  assert.equal((await finderPost({ action: 'send', taskId: TASK, text: 'x', link: 'codex:a' })).status, 400);
  process.env.OPENCLAW_CLI_PATH = path.join(dir, 'no-such-openclaw');
  const off = await finderPost({ action: 'send', taskId: TASK, text: 'x' });
  assert.equal(off.status, 503);
  assert.equal(((await off.json()).data as FinderView).openclaw, false);
});

test('POST /api/session-index/finder with nothing indexed says so and asks nobody', async () => {
  const calls = stubOpenClaw(['{}']);
  const res = await finderPost({ action: 'send', taskId: TASK, text: 'x' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Nothing is indexed yet/);
  assert.deepEqual(calls(), []);
});

// ---- "Check again".

test('the index lock: one holder; a dead or old holder does not keep it; the CLI skips while it is held', () => {
  const lock = trySyncLock('test')!;
  assert.ok(lock);
  assert.equal(trySyncLock('other'), null);
  assert.equal(syncLockHolder()?.by, 'test');
  const out = execFileSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', path.join(import.meta.dirname, 'session-index.ts'), 'ingest'], { env: process.env, encoding: 'utf8' });
  assert.match(JSON.parse(out).data.skipped, /another sync/);
  lock.release();
  assert.equal(syncLockHolder(), null);
  fs.writeFileSync(syncLockFile(), JSON.stringify({ pid: 2 ** 22 + 12345, by: 'gone', since: new Date().toISOString(), token: 'x' }));
  const taken = trySyncLock('test');
  assert.ok(taken);
  taken!.release();
  fs.writeFileSync(syncLockFile(), JSON.stringify({ pid: process.pid, by: 'old', since: new Date(Date.now() - 31 * 60_000).toISOString(), token: 'y' }));
  assert.ok(trySyncLock('test'));
});

test('collect: a device whose listing does not answer in time is given up on; one whose turn comes too late is not asked', async () => {
  const ssh = path.join(dir, 'ssh');
  fs.writeFileSync(ssh, '#!/bin/sh\nsleep 2\nexit 255\n', { mode: 0o755 });
  process.env.CODE_AGENTS_SSH = ssh;
  process.env.CODE_AGENTS_SSH_CONTROL = 'none';
  const started = Date.now();
  const got = await collect({ hosts: ['wsl', 'mac'], listTimeoutMs: 200, stopAfterMs: 100 });
  assert.ok(Date.now() - started < 1500);
  assert.deepEqual(got.map((h) => [h.host, h.reachable, !!h.skipped]), [['wsl', false, false], ['mac', false, true]]);
  assert.match(got[0]!.error!, /too long/);
  assert.equal(deviceProblem(got[0]!.error), 'did not answer in time');
  assert.equal(deviceProblem(got[1]!.error), 'was not asked this time (no time left)');
  assert.equal(deviceProblem('ssh: Could not resolve hostname macbook'), 'could not be reached');
});

test('a sync’s output read as a refresh: devices, what changed, a run that was skipped', () => {
  const at = new Date('2026-11-17T20:00:00Z');
  const done = readSyncOutput(JSON.stringify({ success: true, data: { collected: [
    { host: 'laptop', reachable: true, read: 2, pending: 0, sessions: 900 },
    { host: 'mac', reachable: false, error: 'ssh: connect to host macbook port 22: Connection refused', read: 0, pending: 0, sessions: 0 },
    { host: 'wsl', reachable: true, read: 1, pending: 40, sessions: 300 },
  ], ingested: { changed: 3 } } }, null, 2), at)!;
  assert.equal(done.state, 'done');
  assert.equal(done.changed, 3);
  assert.deepEqual(done.devices.map((d) => [d.machine, d.reachable, d.error ?? null, d.pending]), [['laptop', true, null, 0], ['Mac', false, 'could not be reached', 0], ['PC', true, null, 40]]);
  assert.equal(readSyncOutput(JSON.stringify({ success: true, data: { skipped: 'another sync of the session index is running' } }), at)!.state, 'busy');
  assert.equal(readSyncOutput('not json', at), null);
});

function stubSync(delayMs = 200) {
  const stub = path.join(dir, 'sync-stub.mjs');
  const log = path.join(dir, 'sync-calls.txt');
  fs.writeFileSync(stub, `
    import fs from 'node:fs';
    fs.appendFileSync(${JSON.stringify(log)}, process.argv.slice(2).join(' ') + '\\n');
    setTimeout(() => console.log(JSON.stringify({ success: true, data: { collected: [{ host: 'laptop', reachable: true, read: 1, pending: 0, sessions: 5 }, { host: 'mac', reachable: false, error: 'ssh: Could not resolve hostname macbook', read: 0, pending: 0, sessions: 0 }], ingested: { changed: 1 } } })), ${delayMs});
  `);
  process.env.SESSION_INDEX_CLI = stub;
  return () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : []);
}

const refreshPost = (body: unknown, headers: Record<string, string> = SAME) => refreshRoute.POST(new NextRequest('http://127.0.0.1:3111/api/session-index/refresh', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
}));

test('POST /api/session-index/refresh: presses together share one short sync; one just after reuses it; then the list', async () => {
  seed();
  const calls = stubSync();
  const [a, b] = await Promise.all([refreshPost({ target: `task:${TASK}` }), refreshPost({ target: `task:${TASK}` })]);
  const [ja, jb] = [await a.json(), await b.json()];
  assert.equal(calls().length, 1);
  assert.match(calls()[0]!, /^sync --budget 5 --list-timeout 12 --stop-after 45 --by journal refresh$/);
  assert.equal(ja.data.refresh.state, 'done');
  assert.deepEqual(ja.data.refresh.devices.map((d: { machine: string; error?: string }) => [d.machine, d.error ?? null]), [['laptop', null], ['Mac', 'could not be reached']]);
  assert.deepEqual(jb.data.refresh, ja.data.refresh);
  assert.ok(Array.isArray(ja.data.view.rows));
  assert.ok(ja.data.view.checkedAt);
  const again = await (await refreshPost({ target: `task:${TASK}` })).json();
  assert.equal(again.data.refresh.reused, true);
  assert.equal(calls().length, 1);
});

test('POST /api/session-index/refresh: while the timer’s run holds the index it waits, then shows the list; other sites refused', async () => {
  seed();
  const calls = stubSync();
  const lock = trySyncLock('timer')!;
  setTimeout(() => lock.release(), 300);
  const res = await (await refreshPost({ target: `task:${TASK}` })).json();
  assert.equal(res.data.refresh.state, 'done');
  assert.match(res.data.refresh.message, /regular run/);
  assert.equal(calls().length, 0);
  assert.equal((await refreshPost({ target: `task:${TASK}` }, { 'sec-fetch-site': 'cross-site', host: '127.0.0.1:3111' })).status, 403);
  assert.equal((await refreshPost({ target: `task:${TASK}` }, { host: 'evil.example:3111', origin: 'http://evil.example:3111' })).status, 403);
  assert.equal((await refreshPost({ target: 'task:nope' })).status, 400);
  // A failing sync is said in words, not thrown.
  resetRefreshState();
  fs.writeFileSync(process.env.SESSION_INDEX_CLI!, 'process.exit(3)');
  assert.equal((await refreshIndex()).state, 'failed');
});
