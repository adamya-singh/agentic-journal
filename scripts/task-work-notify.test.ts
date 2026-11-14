import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NeedsYouItem, TaskWork } from '../src/lib/task-work';
import type { NotifyDeps } from '../src/app/api/tasks/work/notify';

// The task worker's one Telegram message a day. Every send goes to an injected sender: the real CLI is never called.
const root = mkdtempSync(path.join(tmpdir(), 'agentic-journal-task-notify-'));
const tasksDir = path.join(root, 'backend', 'tasks');
process.env.BACKEND_DATA_DIR = path.join(root, 'backend');
process.env.JOB_APPLICATION_JOBS_DIR = path.join(root, 'jobs');
process.env.OPENCLAW_CLI_PATH = path.join(root, 'missing-openclaw-cli.mjs');
process.env.OPENCLAW_COMPASS_DIR = path.join(root, 'no-compass');
process.env.BRIEF_AGENT_DISABLED = '1';

let notify: typeof import('../src/app/api/tasks/work/notify');
let store: typeof import('../src/app/api/tasks/work/store');

const ORIGIN = 'https://journal.example';
const day = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m);
const item = (id: string, text: string, createdAt: Date, over: Partial<NeedsYouItem> = {}): NeedsYouItem =>
  ({ id, kind: 'question', text, createdAt: createdAt.toISOString(), status: 'pending', ...over });
const record = (items: NeedsYouItem[]): TaskWork =>
  ({ status: 'needs-you', reason: 'handed', grant: 'act-with-approval', items, failures: 0, updatedAt: new Date().toISOString(), history: [] });
const put = (id: string, r: TaskWork) => store.mutateTaskWork((d) => { d.records[id] = r; });

let sent: string[][] = [];
let failNext = 0;
const deps = (over: Partial<NotifyDeps> = {}): NotifyDeps => ({
  available: () => true,
  target: async () => '6420450714',
  send: async (args) => {
    sent.push(args);
    if (failNext > 0) { failNext -= 1; throw new Error('telegram unreachable'); }
    return '{"action":"send"}';
  },
  origin: () => ORIGIN,
  ...over,
});
const messageOf = (args: string[]) => args[args.indexOf('--message') + 1];

before(async () => {
  notify = await import('../src/app/api/tasks/work/notify');
  store = await import('../src/app/api/tasks/work/store');
});

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(path.join(tasksDir, 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [
    { id: 'boom', text: 'Get the rent credit from Boom for the double-charged November utilities bill' },
    { id: 'prof', text: 'Email the professor' },
  ] }));
  writeFileSync(path.join(tasksDir, 'want-to-do.json'), JSON.stringify({ _comment: '', tasks: [] }));
  sent = [];
  failNext = 0;
  delete process.env.TASK_WORKER_NOTIFY_DISABLED;
  delete process.env.TASK_WORKER_DISABLED;
});

describe('the message', () => {
  test('headline, one line per task with its link, at most five, then how many more', () => {
    const at = day(14, 10);
    const tasks = Array.from({ length: 7 }, (_, i) => ({
      taskId: `t${i}`, taskText: i === 0 ? 'A *very* long task title that keeps going well past sixty characters for sure' : `Task ${i}`,
      items: i === 0
        ? [item('a', 'Approve the email to SoCam asking for the $18 credit on the November statement, sent from Gmail', at, { kind: 'approval' }), item('b', 'Which unit?', at)]
        : [item(`i${i}`, 'Did this go out?', at)],
    }));
    const text = notify.buildNeedsYouMessage(tasks, ORIGIN);
    const lines = text.split('\n');
    assert.equal(lines[0], 'OpenClaw needs you on 7 tasks');
    assert.equal(lines.length, 1 + 5 * 2 + 1);
    const body = lines[1].slice(2);
    const cut = body.indexOf(': ');
    const [head, need] = [body.slice(0, cut), body.slice(cut + 2)];
    assert.ok(lines[1].startsWith('• '));
    assert.ok(head.length <= 60 && head.endsWith('…') && !head.includes('*'), head);
    assert.ok(need.length <= 80 && need.startsWith('Approve: ') && need.endsWith(' (+1 more)'), need);
    assert.equal(lines[2], `${ORIGIN}/?task=t0&tab=brief`);
    assert.equal(lines[3], '• Task 1: Did this go out?');
    assert.equal(lines.at(-1), '+ 2 more');
    assert.equal(notify.buildNeedsYouMessage(tasks.slice(0, 1), ORIGIN).split('\n')[0], 'OpenClaw needs you on 1 task');
  });

  test('the argv, and the target the announce crons use', () => {
    assert.deepEqual(notify.telegramSendArgs('6420450714', 'Hi'), ['message', 'send', '--channel', 'telegram', '--target', '6420450714', '--message', 'Hi', '--json']);
    const list = `warning: something\n${JSON.stringify({ jobs: [
      { id: '1', name: 'A', delivery: { mode: 'none', channel: 'last' } },
      { id: '2', name: 'B', delivery: { mode: 'announce', channel: 'telegram', to: '6420450714' } },
      { id: '3', name: 'C', delivery: null },
      { id: '4', name: 'D', delivery: { mode: 'announce', channel: 'telegram', to: '6420450714' } },
      { id: '5', name: 'E', delivery: { mode: 'announce', channel: 'telegram', to: '-100999' } },
    ] })}`;
    assert.equal(notify.announceTargetFromCronList(list), '6420450714');
    assert.equal(notify.announceTargetFromCronList('{"jobs":[]}'), null);
    assert.equal(notify.announceTargetFromCronList('not json'), null);
  });
});

describe('when it is sent', () => {
  test('once a day from 09:00, only for items he was not told about, never at night', async () => {
    put('boom', record([item('q1', 'Which unit?', day(13, 20))]));
    assert.equal((await notify.notifyNeedsYou(day(14, 7, 30), deps())).decision, 'quiet');
    assert.equal((await notify.notifyNeedsYou(day(14, 8, 55), deps())).decision, 'quiet');
    const first = await notify.notifyNeedsYou(day(14, 9, 2), deps());
    assert.equal(first.decision, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0][sent[0].indexOf('--target') + 1], '6420450714');
    assert.match(messageOf(sent[0]), /^OpenClaw needs you on 1 task\n• Get the rent credit from Boom for the double-charged Novemb…: Which unit\?\nhttps:\/\/journal\.example\/\?task=boom&tab=brief$/);
    const file = store.readTaskWorkFile();
    assert.equal(file.meta.lastNotifiedAt, day(14, 9, 2).toISOString());
    assert.equal(file.records.boom.items[0].notifiedAt, day(14, 9, 2).toISOString());

    // A new item later the same day waits for tomorrow.
    put('prof', record([item('q2', 'Which address?', day(14, 15))]));
    assert.equal((await notify.notifyNeedsYou(day(14, 15, 5), deps())).decision, 'sent-today');
    assert.equal((await notify.notifyNeedsYou(day(14, 23, 30), deps())).decision, 'quiet');
    const next = await notify.notifyNeedsYou(day(15, 9, 0), deps());
    assert.equal(next.decision, 'sent');
    // Only the item he has not heard about.
    assert.match(messageOf(sent[1]), /^OpenClaw needs you on 1 task\n• Email the professor: Which address\?/);
    // Nothing new: no message.
    assert.equal((await notify.notifyNeedsYou(day(16, 9, 0), deps())).decision, 'nothing');
    assert.equal(sent.length, 2);
  });

  test('nothing pending, an answered item, or a closed task sends nothing', async () => {
    put('boom', record([item('q1', 'Which unit?', day(13, 20), { status: 'answered' })]));
    put('gone', record([item('q2', 'Which?', day(13, 20))]));
    assert.equal((await notify.notifyNeedsYou(day(14, 10), deps())).decision, 'nothing');
    assert.equal(sent.length, 0);
  });

  test('a failed send is not stamped and is retried next tick, at most three tries a day', async () => {
    put('boom', record([item('q1', 'Which unit?', day(13, 20))]));
    failNext = 5;
    for (let n = 0; n < 3; n++) {
      assert.equal((await notify.notifyNeedsYou(day(14, 9, 5 * n), deps())).decision, 'failed');
    }
    assert.equal((await notify.notifyNeedsYou(day(14, 9, 20), deps())).decision, 'tries-used');
    assert.equal(sent.length, 3);
    const file = store.readTaskWorkFile();
    assert.equal(file.meta.lastNotifiedAt, undefined);
    assert.equal(file.records.boom.items[0].notifiedAt, undefined);
    // The next day it tries again.
    failNext = 0;
    assert.equal((await notify.notifyNeedsYou(day(15, 9), deps())).decision, 'sent');
  });

  test('off-switches, no CLI, no target', async () => {
    put('boom', record([item('q1', 'Which unit?', day(13, 20))]));
    process.env.TASK_WORKER_NOTIFY_DISABLED = '1';
    assert.equal((await notify.notifyNeedsYou(day(14, 10), deps())).decision, 'disabled');
    delete process.env.TASK_WORKER_NOTIFY_DISABLED;
    process.env.TASK_WORKER_DISABLED = '1';
    assert.equal((await notify.notifyNeedsYou(day(14, 10), deps())).decision, 'disabled');
    delete process.env.TASK_WORKER_DISABLED;
    assert.equal((await notify.notifyNeedsYou(day(14, 10), deps({ available: () => false }))).decision, 'no-cli');
    assert.equal((await notify.notifyNeedsYou(day(14, 10), deps({ target: async () => null }))).decision, 'no-target');
    assert.equal(sent.length, 0);
    assert.equal(store.readTaskWorkFile().meta.notifyTries, undefined);
  });

  test('two ticks at once send one message', async () => {
    put('boom', record([item('q1', 'Which unit?', day(13, 20))]));
    const [a, b] = await Promise.all([notify.notifyNeedsYou(day(14, 10), deps()), notify.notifyNeedsYou(day(14, 10), deps())]);
    assert.deepEqual([a.decision, b.decision].sort(), ['busy', 'sent']);
    assert.equal(sent.length, 1);
  });
});
