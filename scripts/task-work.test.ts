import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { TaskWork, TaskWorkMeta, TaskWorkRef, TaskWorkStatus } from '../src/lib/task-work';

// The task worker's record and rules (docs/task-worker-design.md, stage 1): nothing here calls OpenClaw.
const root = mkdtempSync(path.join(tmpdir(), 'agentic-journal-task-work-'));
const backend = path.join(root, 'backend');
const tasksDir = path.join(backend, 'tasks');
const jobsDir = path.join(root, 'jobs');
const resumeDir = path.join(root, 'resumes');
process.env.BACKEND_DATA_DIR = backend;
process.env.JOB_APPLICATION_JOBS_DIR = jobsDir;
process.env.JOB_APPLICATION_RESUME_DIR = resumeDir;
process.env.OPENCLAW_CLI_PATH = path.join(root, 'missing-openclaw-cli.mjs');
process.env.OPENCLAW_COMPASS_DIR = path.join(root, 'no-compass');
process.env.BRIEF_AGENT_DISABLED = '1';

let lib: typeof import('../src/lib/task-work');
let actions: typeof import('../src/app/api/tasks/work/actions');
let store: typeof import('../src/app/api/tasks/work/store');
let jobs: typeof import('../src/app/api/jobs/application-store-utils');
let claimRoute: typeof import('../src/app/api/tasks/work/claim/route');
let updateRoute: typeof import('../src/app/api/tasks/work/update/route');
let handRoute: typeof import('../src/app/api/tasks/work/hand/route');
let answerRoute: typeof import('../src/app/api/tasks/work/answer/route');
let viewRoute: typeof import('../src/app/api/tasks/work/route');
let progressRoute: typeof import('../src/app/api/tasks/progress/route');

const post = (route: { POST: (r: NextRequest) => Promise<Response> }, body: unknown) =>
  route.POST(new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }));
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const rec = (id: string) => store.readTaskWorkRecord(id);
const put = (id: string, record: TaskWork) => store.mutateTaskWork((d) => { d.records[id] = record; });
const later = (from: Date, ms: number) => new Date(from.getTime() + ms);
const H = 3600_000, D = 864e5;

function writeTasks(): void {
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(path.join(tasksDir, 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [
    { id: 'boom', text: 'Get the rent credit from Boom' },
    { id: 'prof', text: 'Email the professor', dueDate: '2099-01-01' },
    { id: 'parent', text: 'Move out', childTasks: [{ id: 'child', text: 'Book the van', parentTaskId: 'parent' }] },
    { id: 'daily', text: 'Lift', isDaily: true },
  ] }));
  writeFileSync(path.join(tasksDir, 'want-to-do.json'), JSON.stringify({ _comment: '', tasks: [{ id: 'want', text: 'Find a climbing gym' }] }));
}

function record(over: Partial<TaskWork> = {}): TaskWork {
  return { status: 'queued', reason: 'handed', grant: 'act-with-approval', items: [], failures: 0, updatedAt: new Date().toISOString(), history: [], ...over };
}

before(async () => {
  lib = await import('../src/lib/task-work');
  actions = await import('../src/app/api/tasks/work/actions');
  store = await import('../src/app/api/tasks/work/store');
  jobs = await import('../src/app/api/jobs/application-store-utils');
  claimRoute = await import('../src/app/api/tasks/work/claim/route');
  updateRoute = await import('../src/app/api/tasks/work/update/route');
  handRoute = await import('../src/app/api/tasks/work/hand/route');
  answerRoute = await import('../src/app/api/tasks/work/answer/route');
  viewRoute = await import('../src/app/api/tasks/work/route');
  progressRoute = await import('../src/app/api/tasks/progress/route');
});

beforeEach(() => {
  rmSync(root, { recursive: true, force: true });
  writeTasks();
  delete process.env.TASK_WORKER_DISABLED;
  delete process.env.TASK_WORKER_SWEEP_DISABLED;
});

describe('transitions', () => {
  const ALL: TaskWorkStatus[] = ['queued', 'working', 'waiting', 'needs-you', 'resting', 'off'];
  const allowed: Record<string, TaskWorkStatus[]> = {
    none: ['queued', 'waiting', 'off'],
    queued: ['working', 'waiting', 'off'],
    working: ['waiting', 'needs-you', 'resting', 'queued', 'off'],
    waiting: ['queued', 'needs-you', 'resting', 'off'],
    'needs-you': ['queued', 'resting', 'waiting', 'off'],
    resting: ['queued', 'waiting', 'off'],
    off: ['queued'],
  };

  test('every move in the table is allowed and every other one refused', () => {
    for (const from of ['none', ...ALL] as const) {
      for (const to of ALL) {
        const ok = allowed[from].includes(to);
        assert.equal(lib.canTransition(from, to), ok, `${from} → ${to}`);
        const now = new Date();
        if (from === 'none') {
          const make = () => lib.createTaskWork(to, { reason: 'handed', grant: 'prepare', why: 't', now, by: 'adamya' });
          if (ok) assert.equal(make().status, to); else assert.throws(make, /cannot go/);
          continue;
        }
        const r = record({ status: from });
        if (ok) {
          lib.setTaskWorkStatus(r, to, 'test', now, 'adamya');
          assert.equal(r.status, to);
          assert.deepEqual(r.history.at(-1), { at: now.toISOString(), from, to, why: 'test' });
        } else {
          assert.throws(() => lib.setTaskWorkStatus(r, to, 'test', now, 'adamya'), /cannot go/);
          assert.equal(r.status, from);
        }
      }
    }
  });

  test('only Adamya turns a task off or back on', () => {
    const now = new Date();
    for (const by of ['worker', 'journal'] as const) {
      assert.throws(() => lib.setTaskWorkStatus(record({ status: 'working' }), 'off', 'x', now, by), /Only Adamya/);
      assert.throws(() => lib.setTaskWorkStatus(record({ status: 'off' }), 'queued', 'x', now, by), /Only Adamya/);
      assert.throws(() => lib.createTaskWork('off', { reason: 'handed', grant: 'prepare', why: 'x', now, by }), /Only Adamya/);
    }
  });

  test('history keeps the last 30 moves', () => {
    const r = record({ status: 'queued' });
    for (let i = 0; i < 40; i++) lib.setTaskWorkStatus(r, r.status === 'queued' ? 'working' : 'queued', `m${i}`, new Date());
    assert.equal(r.history.length, 30);
    assert.equal(r.history.at(-1)!.why, 'm39');
  });
});

describe('claim order', () => {
  const noon = new Date(2026, 10, 14, 12, 0);
  const ref = (taskId: string, over: Partial<TaskWorkRef> = {}): TaskWorkRef =>
    ({ taskId, listType: 'have-to-do', listIndex: 0, currentRank: null, fingerprint: 'f', ...over });
  const on: TaskWorkMeta = { sweepEnabled: true, sweepCap: 8, sweepClaims: { date: '', count: 0 } };

  test('handed or answered, then due reply checks, then due retries, then the sweep', () => {
    const iso = (ms: number) => new Date(noon.getTime() + ms).toISOString();
    const records: Record<string, TaskWork> = {
      handed: record({ reason: 'handed', updatedAt: iso(-H) }),
      answered: record({ reason: 'answered', updatedAt: iso(-2 * H) }),
      reply: record({ status: 'waiting', waiting: { on: 'Boom', since: iso(-2 * D), checkAfter: iso(-H), checks: 0 } }),
      notYet: record({ status: 'waiting', waiting: { on: 'X', since: iso(-H), checkAfter: iso(H), checks: 0 } }),
      retry: record({ reason: 'retry', nextRetryAt: iso(-1000) }),
      retryLater: record({ reason: 'retry', nextRetryAt: iso(H) }),
      changed: record({ status: 'resting', fingerprint: 'old' }),
      same: record({ status: 'resting', fingerprint: 'f', lookAgainAfter: iso(D) }),
    };
    const refs = Object.keys(records).map((id, i) => ref(id, { listIndex: i }));
    const order: string[] = [];
    for (;;) {
      const pick = lib.pickNextTaskWork(records, refs, noon, on);
      if (!pick) break;
      order.push(`${pick.taskId}:${pick.reason}`);
      records[pick.taskId].status = 'off';
    }
    assert.deepEqual(order, ['answered:answered', 'handed:handed', 'reply:reply-check', 'retry:retry', 'changed:sweep']);
  });

  test('the sweep is off by default; reasons 1–3 still run', () => {
    const records = { handed: record() };
    const refs = [ref('handed'), ref('fresh')];
    const meta = lib.emptyTaskWorkMeta();
    assert.equal(meta.sweepEnabled, false);
    assert.equal(lib.pickNextTaskWork(records, refs, noon, meta)?.taskId, 'handed');
    records.handed.status = 'resting';
    assert.equal(lib.pickNextTaskWork(records, refs, noon, meta), null);
  });

  test('the sweep: Current first, then due within 14 days, then list order; daily and subtasks of an off parent skipped', () => {
    const records: Record<string, TaskWork> = { parent: record({ status: 'off' }) };
    const refs = [
      ref('daily', { isDaily: true, listIndex: 0 }),
      ref('child', { parentTaskId: 'parent', listIndex: 1 }),
      ref('want', { listType: 'want-to-do', listIndex: 0 }),
      ref('late', { listIndex: 5, dueDate: '2099-01-01' }),
      ref('list', { listIndex: 4 }),
      ref('soon2', { listIndex: 3, dueDate: '2026-11-20' }),
      ref('soon1', { listIndex: 6, dueDate: '2026-11-16' }),
      ref('cur1', { listIndex: 8, currentRank: 1 }),
      ref('cur0', { listIndex: 9, currentRank: 0 }),
    ];
    const order: string[] = [];
    for (;;) {
      const pick = lib.pickNextTaskWork(records, refs, noon, on);
      if (!pick) break;
      order.push(pick.taskId);
      records[pick.taskId] = record({ status: 'off' });
    }
    assert.deepEqual(order, ['cur0', 'cur1', 'soon1', 'soon2', 'list', 'late', 'want']);
  });

  test('the sweep keeps quiet 23:00–08:00 and stops at the daily cap; handed work does not', () => {
    const refs = [ref('fresh'), ref('handed')];
    const handed = { handed: record() };
    for (const at of [new Date(2026, 10, 14, 23, 30), new Date(2026, 10, 15, 7, 59)]) {
      assert.equal(lib.pickNextTaskWork({}, refs, at, on), null);
      assert.equal(lib.pickNextTaskWork(handed, refs, at, on)?.taskId, 'handed');
    }
    assert.equal(lib.pickNextTaskWork({}, refs, new Date(2026, 10, 15, 8, 0), on)?.taskId, 'fresh');
    const full = { ...on, sweepClaims: { date: '2026-11-14', count: 8 } };
    assert.equal(lib.pickNextTaskWork({}, refs, noon, full), null);
    assert.equal(lib.pickNextTaskWork(handed, refs, noon, full)?.taskId, 'handed');
    assert.equal(lib.pickNextTaskWork({}, refs, noon, { ...full, sweepClaims: { date: '2026-11-13', count: 8 } })?.taskId, 'fresh');
    const firstDay = { ...on, sweepFirstDay: '2026-11-14', sweepClaims: { date: '2026-11-14', count: 2 } };
    assert.equal(lib.pickNextTaskWork({}, refs, noon, firstDay), null);
  });

  test('one live lease across all tasks', () => {
    const records = {
      busy: record({ status: 'working', lease: { token: 't', claimedAt: noon.toISOString(), expiresAt: later(noon, 60_000).toISOString() } }),
      handed: record(),
    };
    assert.equal(lib.pickNextTaskWork(records, [ref('busy'), ref('handed')], noon, on), null);
  });

  test('claims count against the cap and the env switches stop them', () => {
    store.mutateTaskWork((d) => { d.meta.sweepEnabled = true; });
    const at = new Date(2026, 10, 14, 12, 0);
    const first = actions.claimTaskWork(at);
    assert.equal(first?.reason, 'sweep');
    assert.equal(first?.grant, 'prepare');
    assert.deepEqual(store.readTaskWorkFile().meta.sweepClaims, { date: '2026-11-14', count: 1 });
    actions.updateTaskWork({ taskId: first!.taskId, token: first!.lease.token, action: 'rest', why: 'nothing to do' }, at);

    process.env.TASK_WORKER_SWEEP_DISABLED = '1';
    assert.equal(actions.claimTaskWork(at), null);
    actions.handTaskWork('want', true, at);
    process.env.TASK_WORKER_DISABLED = '1';
    assert.equal(actions.claimTaskWork(at), null);
    assert.equal(actions.taskWorkClaimable(at), false);
    delete process.env.TASK_WORKER_DISABLED;
    assert.equal(actions.taskWorkClaimable(at), true);
    assert.equal(actions.claimTaskWork(at)?.taskId, 'want');
  });
});

describe('claim and updates', () => {
  test('claim hands over the task, rules, mark and lease; a second claim gets nothing', async () => {
    assert.equal((await json(await claimRoute.POST())).body.data, null);
    assert.equal((await json(await post(handRoute, { taskId: 'boom', on: true }))).status, 200);
    const { body } = await json(await claimRoute.POST());
    const c = body.data;
    assert.equal(c.taskId, 'boom');
    assert.equal(c.listType, 'have-to-do');
    assert.equal(c.reason, 'handed');
    assert.equal(c.grant, 'act-with-approval');
    assert.equal(c.mark, '[aj:task:boom]');
    assert.equal(c.task.text, 'Get the rent credit from Boom');
    assert.ok(c.rules.some((r: string) => /Never/.test(r)) && c.rules.some((r: string) => /Coursework: prepare only/.test(r)));
    assert.equal(typeof c.compassForAgents, 'string');
    assert.ok(Date.parse(c.lease.expiresAt) - Date.now() > 29 * 60_000);
    assert.equal(rec('boom')!.status, 'working');
    await post(handRoute, { taskId: 'prof', on: true });
    assert.equal((await json(await claimRoute.POST())).body.data, null);
  });

  test('a claim carries parent and subtasks', () => {
    actions.handTaskWork('child', true);
    const c = actions.claimTaskWork()!;
    assert.equal(c.task.parent?.id, 'parent');
    actions.updateTaskWork({ taskId: 'child', token: c.lease.token, action: 'release' });
    store.mutateTaskWork((d) => { delete d.records.child; });
    actions.handTaskWork('parent', true);
    assert.deepEqual(actions.claimTaskWork()!.task.subtasks.map((s) => s.id), ['child']);
  });

  test('every update needs the live lease token', async () => {
    actions.handTaskWork('boom', true);
    const at = new Date();
    const c = actions.claimTaskWork(at)!;
    const bad = await json(await post(updateRoute, { taskId: 'boom', token: 'nope', action: 'rest', why: 'x' }));
    assert.equal(bad.status, 409);
    assert.throws(() => actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'rest', why: 'x' }, later(at, 31 * 60_000)), /expired/);
    const ok = await json(await post(updateRoute, { taskId: 'boom', token: c.lease.token, action: 'waiting', on: 'Boom' }));
    assert.equal(ok.status, 200);
    assert.equal(rec('boom')!.status, 'waiting');
    assert.equal(rec('boom')!.lease, undefined);
    assert.equal((await json(await post(updateRoute, { taskId: 'boom', token: c.lease.token, action: 'rest', why: 'x' }))).status, 409);
  });

  test('closing actions land where they should', () => {
    const cases = [
      [{ action: 'rest', why: 'nothing to do' }, 'resting'],
      [{ action: 'continue' }, 'queued'],
      [{ action: 'ask', questions: ['Which unit?'] }, 'needs-you'],
      [{ action: 'propose', approvals: [{ text: 'Email Boom', detail: { to: 'help@boom.com', subject: 'Rent credit', body: 'Hi' } }] }, 'needs-you'],
      [{ action: 'looks-done', text: 'the credit shows on the November statement' }, 'needs-you'],
    ] as const;
    for (const [update, status] of cases) {
      store.mutateTaskWork((d) => { delete d.records.boom; });
      actions.handTaskWork('boom', true);
      const c = actions.claimTaskWork()!;
      actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, ...update } as never);
      const r = rec('boom')!;
      assert.equal(r.status, status, update.action);
      assert.equal(r.lease, undefined);
      assert.ok(r.lookedAt && r.fingerprint);
    }
    assert.equal(rec('boom')!.items.at(-1)!.text, 'Looks done: the credit shows on the November statement');
  });

  test('outward acts: only on an approved item, never twice, and closing waits for progress', async () => {
    actions.handTaskWork('boom', true);
    let c = actions.claimTaskWork()!;
    const token = () => c.lease.token;
    assert.throws(() => actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'attempted', what: 'send the email' }), /approval item/);
    actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'propose', approvals: [{ text: 'Email Boom', detail: { to: 'help@boom.com', body: 'Hi' } }] });
    const itemId = rec('boom')!.items[0].id;

    // Pending is not approved.
    store.mutateTaskWork((d) => { lib.setTaskWorkStatus(d.records.boom, 'queued', 't', new Date()); });
    c = actions.claimTaskWork()!;
    assert.throws(() => actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'attempted', what: 'send', itemId }), /not approved/);
    actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'release' });
    store.mutateTaskWork((d) => { d.records.boom.status = 'needs-you'; });

    const answered = await json(await post(answerRoute, { taskId: 'boom', itemId, decision: 'approve', editedDetail: { to: 'help@boom.com', body: 'Hello' } }));
    assert.equal(answered.status, 200);
    assert.equal(rec('boom')!.status, 'queued');
    assert.equal(rec('boom')!.reason, 'answered');
    c = actions.claimTaskWork()!;
    assert.equal(c.items[0].editedDetail?.body, 'Hello');
    actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'attempted', what: 'send the email', itemId });
    assert.throws(() => actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'attempted', what: 'again', itemId }), /still unreported/);
    assert.throws(() => actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'waiting', on: 'Boom' }), /post progress first/);
    const p = actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'progress', did: 'Emailed Boom about the credit', itemId });
    assert.match((p as { notesMarkdown: string }).notesMarkdown, /## Progress[\s\S]*Emailed Boom/);
    assert.ok(rec('boom')!.items[0].consumedAt);
    assert.equal(rec('boom')!.attempted, undefined);
    assert.throws(() => actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'attempted', what: 'send again', itemId }), /never acted on twice/);
    actions.updateTaskWork({ taskId: 'boom', token: token(), action: 'waiting', on: 'Boom' });
    assert.equal(rec('boom')!.status, 'waiting');
  });

  test('a run that dies after attempted asks "Did this go out?" and is never retried', () => {
    const at = new Date();
    put('boom', record({ status: 'needs-you', items: [{ id: 'a1', kind: 'approval', text: 'Email Boom', createdAt: at.toISOString(), status: 'pending' }] }));
    actions.answerTaskWork({ taskId: 'boom', itemId: 'a1', decision: 'approve' }, at);
    const c = actions.claimTaskWork(at)!;
    actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'attempted', what: 'send the email', itemId: 'a1' }, at);
    const after = later(at, 31 * 60_000);
    assert.equal(actions.reconcileTaskWork(after).changed, true);
    const r = rec('boom')!;
    assert.equal(r.status, 'needs-you');
    assert.equal(r.failures, 0);
    assert.equal(r.nextRetryAt, undefined);
    assert.ok(r.items.find((i) => i.id === 'a1')!.consumedAt);
    const check = r.items.find((i) => i.kind === 'sent-check')!;
    assert.match(check.text, /^Did this go out\? send the email/);
    assert.equal(actions.claimTaskWork(later(after, 2 * D)), null);
  });

  test('retry and release while attempted take the same "Did this go out?" path', () => {
    for (const action of ['retry', 'release'] as const) {
      const at = new Date();
      put('boom', record({ status: 'queued', reason: 'answered', items: [{ id: 'a1', kind: 'approval', text: 'Email', createdAt: at.toISOString(), status: 'approved' }] }));
      const c = actions.claimTaskWork(at)!;
      actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'attempted', what: 'send', itemId: 'a1' }, at);
      actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action, why: 'browser crashed' }, at);
      assert.equal(rec('boom')!.status, 'needs-you', action);
      assert.ok(rec('boom')!.items.some((i) => i.kind === 'sent-check'));
    }
  });

  test('a run that dies with nothing attempted retries after 30 min, 2 h, then asks', () => {
    actions.handTaskWork('boom', true);
    let at = new Date();
    const expected = [30 * 60_000, 2 * H];
    for (let n = 1; n <= 3; n++) {
      actions.claimTaskWork(at);
      at = later(at, 31 * 60_000);
      actions.reconcileTaskWork(at);
      const r = rec('boom')!;
      assert.equal(r.failures, n);
      if (n < 3) {
        assert.equal(r.status, 'queued');
        assert.equal(Date.parse(r.nextRetryAt!) - at.getTime(), expected[n - 1]);
        assert.equal(actions.claimTaskWork(later(at, expected[n - 1] - 1000)), null);
        at = later(at, expected[n - 1]);
      } else {
        assert.equal(r.status, 'needs-you');
        assert.match(r.items.at(-1)!.text, /^OpenClaw could not finish this three times: the run claimed/);
      }
    }
    // The retry update follows the same ladder, with its own reason.
    put('prof', record({ failures: 2 }));
    const c = actions.claimTaskWork()!;
    assert.equal(c.taskId, 'prof');
    actions.updateTaskWork({ taskId: 'prof', token: c.lease.token, action: 'retry', why: 'Canvas was down' });
    assert.equal(rec('prof')!.items.at(-1)!.text, 'OpenClaw could not finish this three times: Canvas was down');
  });
});

describe('waiting on a reply', () => {
  test('checks a day after, every two days for a week, then weekly', () => {
    const since = '2026-11-13T15:00:00.000Z';
    const days = [0, 1, 2, 3, 4, 5].map((n) => (Date.parse(lib.replyCheckAfter(since, n)) - Date.parse(since)) / D);
    assert.deepEqual(days, [1, 3, 5, 7, 14, 21]);
  });

  test('a due check is claimed as a reply check and keeps its clock', () => {
    const since = new Date(Date.now() - 2 * D).toISOString();
    put('boom', record({ status: 'waiting', waiting: { on: 'Boom', since, checkAfter: new Date(Date.now() - H).toISOString(), checks: 0 } }));
    const c = actions.claimTaskWork()!;
    assert.equal(c.reason, 'reply-check');
    assert.equal(c.waiting?.checks, 1);
    actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'waiting', on: 'boom' });
    const w = rec('boom')!.waiting!;
    assert.equal(w.since, since);
    assert.equal(w.checkAfter, lib.replyCheckAfter(since, 1));
  });

  test('after three weeks of silence the next check asks instead', () => {
    const since = new Date(Date.now() - 22 * D).toISOString();
    put('boom', record({ status: 'waiting', waiting: { on: 'SoCam', since, checkAfter: new Date(Date.now() - H).toISOString(), checks: 5 } }));
    assert.equal(actions.taskWorkClaimable(), false);
    assert.equal(actions.claimTaskWork(), null);
    const r = rec('boom')!;
    assert.equal(r.status, 'needs-you');
    assert.match(r.items[0].text, /^No reply from SoCam since \w{3} \d+\. Follow up, or stop waiting\?$/);
  });

  test('progress with waitingOn from a chat starts the watch; empty stops it; off and working are left alone', async () => {
    const res = await json(await post(progressRoute, { taskId: 'boom', did: 'Emailed Boom twice', waitingOn: 'Boom support' }));
    assert.equal(res.status, 200);
    const r = rec('boom')!;
    assert.equal(r.status, 'waiting');
    assert.equal(r.grant, 'act-with-approval');
    assert.equal(r.reason, 'handed');
    assert.equal(r.waiting!.checks, 0);
    assert.equal(Date.parse(r.waiting!.checkAfter) - Date.parse(r.waiting!.since), D);
    const view = (await json(await viewRoute.GET(new NextRequest('http://localhost/api/tasks/work?taskId=boom')))).body.data;
    assert.match(view.summary, /^Waiting on Boom support since \w{3} \d+, looks again \w{3} \d+$/);

    await post(progressRoute, { taskId: 'boom', did: 'Boom replied', waitingOn: '' });
    assert.equal(rec('boom')!.status, 'resting');
    assert.equal(rec('boom')!.waiting, undefined);

    await post(progressRoute, { taskId: 'boom', did: 'Heard nothing', next: 'call them' });
    assert.equal(rec('boom')!.status, 'resting');

    actions.handTaskWork('prof', false);
    await post(progressRoute, { taskId: 'prof', did: 'Sent it', waitingOn: 'the professor' });
    assert.equal(rec('prof')!.status, 'off');

    actions.handTaskWork('want', true);
    actions.claimTaskWork();
    await post(progressRoute, { taskId: 'want', did: 'Looked', waitingOn: 'the gym' });
    assert.equal(rec('want')!.status, 'working');
  });
});

describe('answers, the switch, the views', () => {
  const items = (at: string) => [
    { id: 'q', kind: 'question' as const, text: 'Which unit?', createdAt: at, status: 'pending' as const },
    { id: 'a', kind: 'approval' as const, text: 'Email Boom', createdAt: at, status: 'pending' as const },
  ];
  const ready = () => {
    const at = new Date().toISOString();
    put('boom', record({ status: 'needs-you', items: items(at), history: [{ at, from: 'working', to: 'needs-you', why: 't' }] }));
  };

  test('answered or approved goes back to the worker; everything declined rests', async () => {
    ready();
    actions.answerTaskWork({ taskId: 'boom', itemId: 'q', decision: 'decline' });
    assert.equal(rec('boom')!.status, 'needs-you');
    actions.answerTaskWork({ taskId: 'boom', itemId: 'a', decision: 'approve' });
    assert.equal(rec('boom')!.status, 'queued');
    assert.equal(rec('boom')!.reason, 'answered');

    ready();
    actions.answerTaskWork({ taskId: 'boom', itemId: 'q', decision: 'decline' });
    actions.answerTaskWork({ taskId: 'boom', itemId: 'a', decision: 'decline' });
    assert.equal(rec('boom')!.status, 'resting');

    ready();
    assert.equal((await json(await post(answerRoute, { taskId: 'boom', itemId: 'q', decision: 'answer' }))).status, 400);
    assert.equal((await json(await post(answerRoute, { taskId: 'boom', itemId: 'q', decision: 'answer', answer: 'Unit 4' }))).status, 200);
    assert.equal((await json(await post(answerRoute, { taskId: 'boom', itemId: 'q', decision: 'answer', answer: 'Unit 5' }))).status, 409);
    assert.equal(rec('boom')!.items[0].answer, 'Unit 4');
  });

  test('a yes to "Looks done" is only recorded, with completeRequested', () => {
    const at = new Date().toISOString();
    put('boom', record({ status: 'needs-you', items: [{ id: 'd', kind: 'done', text: 'Looks done: credited', createdAt: at, status: 'pending' }], history: [{ at, from: 'working', to: 'needs-you', why: 't' }] }));
    const out = actions.answerTaskWork({ taskId: 'boom', itemId: 'd', decision: 'approve' });
    assert.equal(out.completeRequested, true);
    assert.equal(rec('boom')!.status, 'resting');
  });

  test('the switch: 404 for a task that is not open; off stops a run; on queues it', async () => {
    assert.equal((await json(await post(handRoute, { taskId: 'nope', on: true }))).status, 404);
    assert.equal((await json(await post(handRoute, { taskId: 'daily', on: true }))).status, 404);
    actions.handTaskWork('boom', true);
    const c = actions.claimTaskWork()!;
    actions.handTaskWork('boom', false);
    assert.equal(rec('boom')!.status, 'off');
    assert.equal(rec('boom')!.lease, undefined);
    assert.throws(() => actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'rest', why: 'x' }), /lease/);
    const view = (await json(await viewRoute.GET(new NextRequest('http://localhost/api/tasks/work?taskId=boom')))).body.data;
    assert.equal(view.summary, 'Hands off');
    actions.handTaskWork('boom', true);
    assert.equal(rec('boom')!.status, 'queued');
    assert.equal(lib.taskWorkSummary(rec('boom'), new Date()), 'Handed to OpenClaw, not started');
  });

  test('the overview lists open items oldest first and the working run', async () => {
    put('boom', record({ status: 'needs-you', items: items('2026-11-13T10:00:00.000Z') }));
    put('prof', record({ status: 'needs-you', items: items('2026-11-12T10:00:00.000Z') }));
    put('gone', record({ status: 'needs-you', items: items('2026-11-11T10:00:00.000Z') }));
    actions.handTaskWork('want', true);
    actions.claimTaskWork();
    const data = (await json(await viewRoute.GET(new NextRequest('http://localhost/api/tasks/work')))).body.data;
    assert.deepEqual(data.needsYou.map((n: { taskId: string }) => n.taskId), ['prof', 'boom']);
    assert.equal(data.working.taskId, 'want');
    assert.equal(data.counts.pendingItems, 4);
    assert.equal(lib.taskWorkSummary(rec('boom'), new Date()), 'Needs you: 2 items');
  });

  test('records of closed tasks are pruned, unless a run still holds the lease', () => {
    put('gone', record({ status: 'resting' }));
    put('held', record({ status: 'working', lease: { token: 't', claimedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() } }));
    put('boom', record({ status: 'resting' }));
    assert.deepEqual(actions.reconcileTaskWork().pruned, ['gone']);
    assert.deepEqual(Object.keys(store.readTaskWorkFile().records).sort(), ['boom', 'held']);
    assert.equal(actions.reconcileTaskWork().changed, false);
  });
});

describe('OpenClaw\'s browser is shared with the job worker', () => {
  const setupJobs = () => {
    mkdirSync(jobsDir, { recursive: true });
    mkdirSync(resumeDir, { recursive: true });
    writeFileSync(path.join(resumeDir, 'Adamya_Singh_Resume_SWE.pdf'), '%PDF-test');
    writeFileSync(path.join(resumeDir, 'Adamya_Singh_Resume_MLE.pdf'), '%PDF-test');
    const at = '2026-11-01T12:00:00.000Z';
    writeFileSync(path.join(jobsDir, 'listings.json'), JSON.stringify({ schemaVersion: 2, listings: [{
      id: 'job1', title: 'Engineer', company: 'Acme', url: 'https://example.com/job1', status: 'saved',
      applicationCategories: ['new-grad'], statusHistory: [], createdAt: at, updatedAt: at, savedAt: at,
    }] }));
    jobs.writeJobApplicationsStore({ ...jobs.getEmptyJobApplicationsStore(), workerEnabled: true, enabledApplicationCategories: ['new-grad'] });
  };

  test('a live job lease blocks the task claim', async () => {
    setupJobs();
    const job = await jobs.claimNextJobApplication();
    assert.equal(job?.listing.id, 'job1');
    actions.handTaskWork('boom', true);
    assert.equal(actions.claimTaskWork(), null);
    assert.equal(actions.taskWorkClaimable(), false);
    await jobs.mutateJobApplicationsStore((d) => { jobs.releaseApplicationLease(d.applications.job1); });
    assert.equal(actions.claimTaskWork()?.taskId, 'boom');
  });

  test('a live task lease blocks the job claim', async () => {
    setupJobs();
    actions.handTaskWork('boom', true);
    const c = actions.claimTaskWork()!;
    assert.equal(await jobs.claimNextJobApplication(), null);
    actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'rest', why: 'done for now' });
    assert.equal((await jobs.claimNextJobApplication())?.listing.id, 'job1');
  });
});
