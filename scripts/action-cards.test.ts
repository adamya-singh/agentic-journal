import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { answers, decide, farSideView, readCards, undo, upsertCard, validateCards, withdraw } from '../src/lib/action-cards/store.ts';
import { digest } from '../src/lib/action-cards/digest.ts';
import { POST as decideRoute } from '../src/app/api/action-cards/decide/route.ts';

let dir: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'action-cards-test-'));
  process.env.BACKEND_DATA_DIR = dir;
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

const card = (key = 'inbox:netic-coderbyte', extra: Record<string, unknown> = {}) => ({
  key,
  source: 'inbox',
  evidence: [{ source: 'inbox', text: 'Netic AI invited you to a Coderbyte technical assessment.' }],
  kind: 'Assessment',
  short: 'Netic Coderbyte',
  title: 'Take the Netic AI Coderbyte assessment',
  what: 'An agent-platform new-grad role answered with a take-home.',
  why: { tone: 'bet', label: 'Bet 1 · job pipeline', text: 'Assessments are the rarest signal in the pipeline.' },
  next: 'Block an hour on a build day',
  estimate: '≈ 1 h',
  bet: 'bet1',
  betLabel: 'Bet 1 · Jobs',
  when: 'now',
  weight: 0.93,
  reasons: { agree: ['Rare signal, take it'], dismiss: ["Don't want the role", 'Not before Oct 26'] },
  outcomes: [{ kind: 'task', label: 'Make it a task', detail: 'Wed Oct 21', due: '2026-10-21' }, { kind: 'hand', label: 'OpenClaw finds the deadline first' }],
  ...extra,
});

test('upsert by key updates instead of duplicating', () => {
  const a = upsertCard(card(), new Date('2026-10-18T10:00:00Z'));
  const b = upsertCard(card('inbox:netic-coderbyte', { short: 'Netic take-home' }), new Date('2026-10-18T11:00:00Z'));
  assert.equal(a.id, b.id);
  assert.equal(readCards().length, 1);
  assert.equal(readCards()[0].short, 'Netic take-home');
  assert.equal(readCards()[0].createdAt, '2026-10-18T10:00:00.000Z');
  assert.match(a.id, /^ac_[0-9a-f]{8}$/);
});

test('a writer cannot set status, and bad cards are rejected', () => {
  assert.throws(() => upsertCard({ ...card(), status: 'agreed' }), /Unrecognized key/);
  assert.throws(() => upsertCard({ ...card(), when: 'tomorrow' }), /when/);
  assert.throws(() => upsertCard({ ...card(), reasons: { agree: [], dismiss: ['x'] } }), /reasons.agree/);
  assert.deepEqual(readCards(), []);
});

test('agreeing needs a reason and an outcome; a task outcome needs its task', () => {
  const c = upsertCard(card());
  assert.throws(() => decide({ id: c.id, verdict: 'agree', reason: ' ' }), /reason/);
  assert.throws(() => decide({ id: c.id, verdict: 'agree', reason: 'Rare signal' }), /a task, a hand-off or a move/);
  assert.throws(() => decide({ id: c.id, verdict: 'agree', reason: 'Rare signal', outcome: 'task' }), /needs the task/);
  const done = decide({ id: c.id, verdict: 'agree', reason: 'Rare signal', outcome: 'task', taskId: 't-1' }, new Date('2026-10-18T12:00:00Z'));
  assert.equal(done.status, 'agreed');
  assert.equal(done.decision?.taskListType, 'want-to-do');
  assert.deepEqual(farSideView().cards, []);
  assert.deepEqual(answers().map((a) => [a.short, a.verdict, a.reason]), [['Netic Coderbyte', 'agree', 'Rare signal']]);
  assert.throws(() => decide({ id: c.id, verdict: 'dismiss', reason: 'again' }), /already has an answer/);
});

test('rewording a decided card keeps the decision', () => {
  const c = upsertCard(card());
  decide({ id: c.id, verdict: 'dismiss', reason: "Don't want the role" });
  upsertCard(card('inbox:netic-coderbyte', { short: 'Netic again' }));
  assert.equal(readCards()[0].status, 'dismissed');
});

test('handing off keeps the card on the far side', () => {
  const c = upsertCard(card());
  decide({ id: c.id, verdict: 'agree', reason: 'Find the deadline', outcome: 'hand' });
  assert.equal(farSideView().cards[0].status, 'handed');
});

test('a "not now" dismissal snoozes, and comes back when its day arrives', () => {
  const c = upsertCard(card('compass:cuda', { snoozeUntil: '2026-10-26' }));
  decide({ id: c.id, verdict: 'dismiss', reason: 'Not before Oct 26', snooze: true }, new Date(2026, 9, 18, 12));
  assert.equal(readCards()[0].decision?.snoozeUntil, '2026-10-26');
  assert.deepEqual(farSideView(new Date(2026, 9, 25, 12)).cards, []);
  const back = farSideView(new Date(2026, 9, 26, 9)).cards;
  assert.equal(back.length, 1);
  assert.equal(back[0].status, 'open');
  // without a date of its own, a snooze lasts two weeks
  const d = upsertCard(card('jobs:other'));
  decide({ id: d.id, verdict: 'dismiss', reason: 'Not this week', snooze: true }, new Date(2026, 9, 18, 12));
  assert.equal(readCards()[1].decision?.snoozeUntil, '2026-11-01');
});

test('undo reopens the card, keeps the history, and names the task to remove', () => {
  const c = upsertCard(card());
  decide({ id: c.id, verdict: 'agree', reason: 'Rare signal', outcome: 'task', taskId: 't-9' });
  const r = undo(c.id);
  assert.equal(r.card.status, 'open');
  assert.deepEqual(r.removeTask, { id: 't-9', listType: 'want-to-do' });
  assert.equal(r.card.history.length, 1);
  assert.ok(r.card.history[0].undone);
  assert.deepEqual(answers(), []);
  assert.throws(() => undo(c.id), /nothing to undo/);
});

test('the decide route needs a same-origin request', async () => {
  const c = upsertCard(card());
  const post = (origin: string | null, body: unknown) => decideRoute(new NextRequest('http://127.0.0.1:3000/api/action-cards/decide', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: '127.0.0.1:3000', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  }));
  assert.equal((await post(null, { id: c.id, verdict: 'dismiss', reason: 'x' })).status, 403);
  const ok = await post('http://127.0.0.1:3000', { id: c.id, verdict: 'dismiss', reason: 'Not my thing' });
  assert.equal(ok.status, 200);
  assert.equal(readCards()[0].status, 'dismissed');
  const bad = await post('http://127.0.0.1:3000', { id: 'ac_00000000', verdict: 'dismiss', reason: 'x' });
  assert.equal(bad.status, 404);
});

test('OpenClaw can withdraw a card whose signal went away; it reopens if the signal comes back', () => {
  const c = upsertCard(card());
  assert.throws(() => withdraw(c.key, ' '), /why/);
  assert.equal(withdraw(c.key, 'Assessment submitted').status, 'withdrawn');
  assert.deepEqual(farSideView().cards, []);
  assert.deepEqual(answers(), []);
  assert.equal(upsertCard(card()).status, 'open');
  // answered cards are not OpenClaw's to withdraw
  decide({ id: c.id, verdict: 'dismiss', reason: 'Not my thing' });
  assert.equal(withdraw(c.key, 'resolved').status, 'dismissed');
});

test('validate reports what an upsert would do without writing', () => {
  const a = upsertCard(card('inbox:a'));
  upsertCard(card('inbox:b'));
  decide({ id: a.id, verdict: 'dismiss', reason: 'No' });
  withdraw('inbox:b', 'resolved');
  const r = validateCards([card('inbox:a'), card('inbox:b'), card('inbox:c'), { ...card('inbox:d'), when: 'soon' }]);
  assert.deepEqual(r.map((x) => [x.key, x.action]), [['inbox:a', 'keep-answered'], ['inbox:b', 'reopen'], ['inbox:c', 'add'], ['inbox:d', 'invalid']]);
  assert.equal(readCards().length, 2);
});

test('validate warns, without blocking, when a card links to a course home or front page', () => {
  const [home, item, none] = validateCards([
    card('tasks:hw3', { link: 'https://rutgers.instructure.com/courses/408919' }),
    card('tasks:hw3b', { link: 'https://rutgers.instructure.com/courses/408919/assignments/4589249' }),
    card('tasks:hw3c'),
  ]);
  assert.equal(home.action, 'add');
  assert.match(home.warning ?? '', /home or list page/);
  assert.equal(item.warning, undefined);
  assert.equal(none.warning, undefined);
});

test('the digest lists the Openclaw folder, marks posts with cards, and spaces X refreshes 3 days apart', () => {
  const b = path.join(dir, 'bookmarks');
  fs.mkdirSync(b, { recursive: true });
  const src = (id: string, publishedAt: string) => ({ id, accountId: '42', text: `post ${id}`, url: `https://x.com/i/status/${id}`, importedAt: publishedAt, publishedAt, author: { id: '7', name: 'A', username: 'a', avatar: 'https://pbs.twimg.com/p_normal.jpg' }, media: [], links: [] });
  fs.writeFileSync(path.join(b, 'sources.json'), JSON.stringify({ '42:1': src('1', '2026-10-10T00:00:00Z'), '42:2': src('2', '2026-10-12T00:00:00Z'), '42:3': src('3', '2026-10-11T00:00:00Z') }));
  fs.writeFileSync(path.join(b, 'folders.json'), JSON.stringify({ accountId: '42', syncedAt: '2026-10-15T00:00:00Z', folders: [{ id: '100', name: 'Openclaw' }, { id: '200', name: 'Other' }], membership: { '1': ['100'], '2': ['100'], '3': ['200'] } }));
  fs.writeFileSync(path.join(b, 'state.json'), JSON.stringify({ version: 1, accountId: '42', usage: { '2026-10': 1.2 }, history: [] }));
  upsertCard(card('x:42:1', { source: 'x', bookmarkKey: '42:1', evidence: [] }));
  const d = digest(new Date('2026-10-17T12:00:00Z'));
  assert.deepEqual(d.openclawFolder?.posts.map((p) => [p.key, p.card?.status ?? null]), [['42:2', null], ['42:1', 'open']]);
  assert.equal(d.openclawFolder?.posts[0].avatar, 'https://pbs.twimg.com/p_bigger.jpg');
  assert.equal(d.xRefresh.due, false);
  assert.equal(digest(new Date('2026-10-18T00:00:01Z')).xRefresh.due, true);
  // a single-folder refresh counts, and an almost-spent budget blocks it
  const f = JSON.parse(fs.readFileSync(path.join(b, 'folders.json'), 'utf8'));
  fs.writeFileSync(path.join(b, 'folders.json'), JSON.stringify({ ...f, folderSyncedAt: { '100': '2026-10-17T00:00:00Z' } }));
  assert.equal(digest(new Date('2026-10-19T12:00:00Z')).xRefresh.due, false);
  fs.writeFileSync(path.join(b, 'state.json'), JSON.stringify({ version: 1, accountId: '42', usage: { '2026-10': 4.7 }, history: [] }));
  assert.equal(digest(new Date('2026-10-25T12:00:00Z')).xRefresh.due, false);
});

test('the action-cards cron is added once, twice a day, and skipped when disabled or already there', async () => {
  const { ensureActionCardsCron, ACTION_CARDS_CRON_NAME } = await import('../src/lib/action-cards/cron.ts');
  const calls: string[][] = [];
  const deps = (exists: boolean, available = true) => ({
    available: () => available,
    find: async () => (exists ? { id: 'j1', name: ACTION_CARDS_CRON_NAME, enabled: true, running: false } : null),
    run: async (args: string[]) => { calls.push(args); return '{}'; },
  });
  assert.equal(await ensureActionCardsCron(deps(false, false)), 'disabled');
  assert.equal(await ensureActionCardsCron(deps(true)), 'exists');
  process.env.ACTION_CARDS_CRON_DISABLED = '1';
  assert.equal(await ensureActionCardsCron(deps(false)), 'disabled');
  delete process.env.ACTION_CARDS_CRON_DISABLED;
  assert.equal(calls.length, 0);
  assert.equal(await ensureActionCardsCron(deps(false)), 'added');
  const args = calls[0];
  const val = (flag: string) => args[args.indexOf(flag) + 1];
  assert.equal(val('--name'), ACTION_CARDS_CRON_NAME);
  assert.equal(val('--cron'), '30 7,17 * * *');
  assert.equal(val('--session'), 'isolated');
  assert.ok(args.includes('--no-deliver'));
  assert.match(val('--message'), /agentic-journal-action-cards/);
  assert.match(val('--message'), /xRefresh\.due/);
});

test('only Focus-bet slices can claim a bet, and a slice keeps its first name', () => {
  assert.throws(() => upsertCard(card('x:1', { bet: 'learning', betLabel: 'Learning' })), /tone is "bet"/);
  assert.equal(validateCards([card('x:2', { bet: 'life', betLabel: 'Life' })])[0].action, 'invalid');
  upsertCard(card('x:3', { bet: 'learning', betLabel: 'Learning', why: { tone: 'park', label: 'Not now', text: 'Later.' } }));
  const b = upsertCard(card('x:4', { bet: 'learning', betLabel: 'Learning · Tools', why: { tone: 'park', label: 'Not now', text: 'Later.' } }));
  assert.equal(b.betLabel, 'Learning');
});
