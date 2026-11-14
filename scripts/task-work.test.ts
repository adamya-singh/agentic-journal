import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { TaskSortEntry, TaskSortVerdict, TaskWork, TaskWorkMeta, TaskWorkRef, TaskWorkStatus } from '../src/lib/task-work';

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
/** Every open task sorted with this verdict, as the batched sort would store it. */
const sortAll = (v: TaskSortVerdict, at = new Date()) => store.mutateTaskWork((d) => {
  for (const ref of actions.openTasks().refs) d.sort[ref.taskId] = { v, why: `sorted ${v}`, ...(v === 'ask' ? { q: 'Which one?' } : {}), fingerprint: ref.fingerprint, at: at.toISOString() };
});
const H = 3600_000, D = 864e5;

function writeTasks(): void {
  mkdirSync(tasksDir, { recursive: true });
  writeFileSync(path.join(tasksDir, 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [
    { id: 'boom', text: 'Get the rent credit from Boom' },
    { id: 'prof', text: 'Email the professor', dueDate: '2099-01-01' },
    // Subtasks are their own entries with parentTaskId, as the list files keep them (childTasks is display-only).
    { id: 'parent', text: 'Move out' },
    { id: 'child', text: 'Book the van', parentTaskId: 'parent' },
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
    none: ['queued', 'waiting', 'needs-you', 'off'],
    queued: ['working', 'waiting', 'needs-you', 'off'],
    working: ['waiting', 'needs-you', 'resting', 'queued', 'off'],
    waiting: ['queued', 'needs-you', 'resting', 'off'],
    'needs-you': ['queued', 'resting', 'waiting', 'off'],
    resting: ['queued', 'waiting', 'needs-you', 'off'],
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
  // The batched sort said every one of these has something to prepare.
  const prep = (...ids: string[]): Record<string, TaskSortEntry> =>
    Object.fromEntries(ids.map((id) => [id, { v: 'prepare' as const, why: 'draft it', fingerprint: 'f', at: noon.toISOString() }]));

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
    const sort = prep(...refs.map((r) => r.taskId));
    const order: string[] = [];
    for (;;) {
      const pick = lib.pickNextTaskWork(records, refs, noon, on, sort);
      if (!pick) break;
      order.push(pick.taskId);
      records[pick.taskId] = record({ status: 'off' });
    }
    assert.deepEqual(order, ['cur0', 'cur1', 'soon1', 'soon2', 'list', 'late', 'want']);
  });

  test('the sweep keeps quiet 23:00–08:00 and stops at the daily cap; handed work does not', () => {
    const refs = [ref('fresh'), ref('handed')];
    const handed = { handed: record() };
    const sort = prep('fresh');
    for (const at of [new Date(2026, 10, 14, 23, 30), new Date(2026, 10, 15, 7, 59)]) {
      assert.equal(lib.pickNextTaskWork({}, refs, at, on, sort), null);
      assert.equal(lib.pickNextTaskWork(handed, refs, at, on, sort)?.taskId, 'handed');
    }
    assert.equal(lib.pickNextTaskWork({}, refs, new Date(2026, 10, 15, 8, 0), on, sort)?.taskId, 'fresh');
    const full = { ...on, sweepClaims: { date: '2026-11-14', count: 8 } };
    assert.equal(lib.pickNextTaskWork({}, refs, noon, full, sort), null);
    assert.equal(lib.pickNextTaskWork(handed, refs, noon, full, sort)?.taskId, 'handed');
    assert.equal(lib.pickNextTaskWork({}, refs, noon, { ...full, sweepClaims: { date: '2026-11-13', count: 8 } }, sort)?.taskId, 'fresh');
    const firstDay = { ...on, sweepFirstDay: '2026-11-14', sweepClaims: { date: '2026-11-14', count: 2 } };
    assert.equal(lib.pickNextTaskWork({}, refs, noon, firstDay, sort), null);
    assert.equal(lib.sweepCapToday(firstDay, noon), 2);
    assert.equal(lib.sweepCapToday(firstDay, new Date(2026, 10, 15, 12, 0)), 8);
  });

  test('one live lease across all tasks', () => {
    const records = {
      busy: record({ status: 'working', lease: { token: 't', claimedAt: noon.toISOString(), expiresAt: later(noon, 60_000).toISOString() } }),
      handed: record(),
    };
    assert.equal(lib.pickNextTaskWork(records, [ref('busy'), ref('handed')], noon, on), null);
  });

  test('only a current `prepare` verdict makes an unhandled task a sweep candidate', () => {
    const refs = [ref('a'), ref('b'), ref('c'), ref('d'), ref('e')];
    const at = noon.toISOString();
    const sort: Record<string, TaskSortEntry> = {
      a: { v: 'nothing', why: 'a class', fingerprint: 'f', at },
      b: { v: 'ask', why: 'which unit', q: 'Which unit?', fingerprint: 'f', at },
      c: { v: 'prepare', why: 'find the form', fingerprint: 'old', at },                      // changed since: re-sort first
      d: { v: 'prepare', why: 'find the form', fingerprint: 'f', at: new Date(noon.getTime() - 31 * D).toISOString() },   // aged out
      e: { v: 'prepare', why: 'draft the email', fingerprint: 'f', at },
    };
    assert.deepEqual(lib.pickNextTaskWork({}, refs, noon, on, sort), { taskId: 'e', reason: 'sweep', sweep: true });
    delete sort.e;
    assert.equal(lib.pickNextTaskWork({}, refs, noon, on, sort), null);
    // A task a run already rested is looked at again as before, without a verdict.
    assert.equal(lib.pickNextTaskWork({ a: record({ status: 'resting', fingerprint: 'old' }) }, refs, noon, on, sort)?.taskId, 'a');
  });

  test('claims count against the cap and the env switches stop them', () => {
    store.mutateTaskWork((d) => { d.meta.sweepEnabled = true; });
    sortAll('prepare');
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
    assert.match(view.summary, /^Waiting on Boom support since \w{3} \d+ · looks again \w{3} \d+$/);

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
    assert.equal(view.summary, 'Hands off: OpenClaw will not work on this');
    actions.handTaskWork('boom', true);
    assert.equal(rec('boom')!.status, 'queued');
    assert.equal(lib.taskWorkSummary(rec('boom'), new Date()), 'Handed to OpenClaw · it starts on its next run');
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
    assert.equal(lib.taskWorkSummary(rec('boom'), new Date()), 'Needs you: 2 things below');
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

describe('subtasks are real open tasks', () => {
  // The list files keep a subtask as its own entry with parentTaskId: progress, the switch, the claim and the views
  // all find it the same way as a top-level task.
  test('progress from a chat lands in the subtask\'s own notes', async () => {
    const res = await json(await post(progressRoute, { taskId: 'child', did: 'Asked U-Haul for a quote', waitingOn: 'U-Haul' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.listType, 'have-to-do');
    assert.match(res.body.data.notesMarkdown, /## Progress[\s\S]*Asked U-Haul for a quote/);
    assert.equal(rec('child')!.status, 'waiting');
  });

  test('a subtask is handed, claimed, worked on and viewed', async () => {
    assert.equal((await json(await post(handRoute, { taskId: 'child', on: true }))).status, 200);
    const c = actions.claimTaskWork()!;
    assert.equal(c.taskId, 'child');
    assert.equal(c.task.parent?.text, 'Move out');
    const progress = await json(await post(updateRoute, { taskId: 'child', token: c.lease.token, action: 'progress', did: 'Found two van rentals' }));
    assert.equal(progress.status, 200);
    assert.match(progress.body.data.notesMarkdown, /Found two van rentals/);
    await post(updateRoute, { taskId: 'child', token: c.lease.token, action: 'ask', questions: ['Which day do you move?'] });
    const view = await json(await viewRoute.GET(new NextRequest('http://localhost/api/tasks/work?taskId=child')));
    assert.equal(view.body.data.record.status, 'needs-you');
    const overview = await json(await viewRoute.GET(new NextRequest('http://localhost/api/tasks/work')));
    assert.deepEqual(overview.body.data.needsYou.map((n: { taskId: string }) => n.taskId), ['child']);
  });

  test('a nested childTasks entry is still found by progress', async () => {
    writeFileSync(path.join(tasksDir, 'want-to-do.json'), JSON.stringify({ _comment: '', tasks: [
      { id: 'trip', text: 'Plan the trip', childTasks: [{ id: 'hotel', text: 'Book the hotel', parentTaskId: 'trip' }] },
    ] }));
    const res = await json(await post(progressRoute, { taskId: 'hotel', did: 'Compared three hotels' }));
    assert.equal(res.status, 200);
    assert.equal(res.body.data.listType, 'want-to-do');
  });
});

describe('a wait on Adamya himself is a question, not a reply check', () => {
  test('waitsOnAdamya: clear cases are him; anyone outside is not', () => {
    for (const yes of [
      'Adamya\'s approval of the 3 lenses (since Nov 14)', 'you to confirm', 'your decision', 'Adamya',
      'Adamya’s OK on the draft', 'approval from Adamya', 'Adamya to pick a date', 'the user', 'my answer', 'You',
    ]) assert.equal(lib.waitsOnAdamya(yes), true, yes);
    for (const no of [
      'SoCam and Boom, since Nov 13', 'Prof. Yu\'s reply', 'the registrar', 'Adamya\'s landlord', 'your landlord',
      'Boom support (since Nov 13)', '', 'the review of your essay by the TA',
    ]) assert.equal(lib.waitsOnAdamya(no), false, no);
    assert.equal(lib.withoutSince('Adamya\'s approval of the 3 lenses (since Nov 14)'), 'Adamya\'s approval of the 3 lenses');
    assert.equal(lib.withoutSince('SoCam and Boom, since Nov 13'), 'SoCam and Boom');
  });

  test('a chat that says it waits on Adamya asks him instead of scheduling a reply check', async () => {
    await post(progressRoute, { taskId: 'boom', did: 'Drafted three lenses', waitingOn: 'Adamya\'s approval of the 3 lenses (since Nov 14)' });
    let r = rec('boom')!;
    assert.equal(r.status, 'needs-you');
    assert.equal(r.waiting, undefined);
    assert.deepEqual(lib.pendingItems(r).map((i) => [i.kind, i.text]), [['question', 'OpenClaw is waiting on you: Adamya\'s approval of the 3 lenses']]);
    // Said again: still one question.
    await post(progressRoute, { taskId: 'boom', did: 'Reminded him', waitingOn: 'Adamya\'s approval of the 3 lenses' });
    assert.equal(lib.pendingItems(rec('boom')).length, 1);
    // His answer goes to the worker like any other.
    actions.answerTaskWork({ taskId: 'boom', itemId: lib.pendingItems(rec('boom'))[0].id, decision: 'answer', answer: 'Lens 2' });
    assert.equal(rec('boom')!.status, 'queued');
    assert.equal(rec('boom')!.reason, 'answered');

    // From waiting on someone outside, and from resting.
    await post(progressRoute, { taskId: 'prof', did: 'Emailed', waitingOn: 'the professor' });
    assert.equal(rec('prof')!.status, 'waiting');
    await post(progressRoute, { taskId: 'prof', did: 'Drafted the reply', waitingOn: 'you to confirm' });
    r = rec('prof')!;
    assert.equal(r.status, 'needs-you');
    assert.equal(r.waiting, undefined);
    put('want', record({ status: 'resting' }));
    await post(progressRoute, { taskId: 'want', did: 'Compared gyms', waitingOn: 'your decision' });
    assert.equal(rec('want')!.status, 'needs-you');
  });

  test('the worker\'s own `waiting` on Adamya closes as a question', () => {
    actions.handTaskWork('boom', true);
    const c = actions.claimTaskWork()!;
    actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'waiting', on: 'Adamya' });
    const r = rec('boom')!;
    assert.equal(r.status, 'needs-you');
    assert.equal(r.waiting, undefined);
    assert.equal(r.lease, undefined);
    assert.equal(lib.pendingItems(r)[0].text, 'OpenClaw is waiting on you: Adamya');
  });

  test('reconcile turns an existing waiting-on-Adamya record into a question', () => {
    // The record production had on Nov 14, as a fixture.
    put('boom', record({
      status: 'waiting', reason: 'handed',
      waiting: { on: 'Adamya\'s approval of the 3 lenses (since Nov 14)', since: '2026-11-14T22:27:27.137Z', checks: 0, checkAfter: '2026-11-15T22:27:27.137Z' },
    }));
    put('prof', record({ status: 'waiting', waiting: { on: 'SoCam and Boom, since Nov 13', since: '2026-11-13T15:00:00.000Z', checks: 0, checkAfter: '2099-01-01T00:00:00.000Z' } }));
    assert.equal(actions.reconcileTaskWork().changed, true);
    const r = rec('boom')!;
    assert.equal(r.status, 'needs-you');
    assert.equal(r.waiting, undefined);
    assert.equal(lib.pendingItems(r)[0].text, 'OpenClaw is waiting on you: Adamya\'s approval of the 3 lenses');
    assert.equal(rec('prof')!.status, 'waiting');
    assert.equal(actions.reconcileTaskWork().changed, false);
  });
});

describe('the sweep switch and the overview', () => {
  const sweepRoute = () => import('../src/app/api/tasks/work/sweep/route');

  test('turning it on makes today the first day (cap 2); off leaves records alone', async () => {
    const route = await sweepRoute();
    assert.equal((await json(await post(route, { enabled: 'yes' }))).status, 400);
    put('boom', record({ status: 'resting' }));
    const on = await json(await post(route, { enabled: true }));
    assert.equal(on.status, 200);
    assert.deepEqual(on.body.data, {
      enabled: true, cap: 2, claimsToday: 0, quietNow: lib.quietHours(new Date()),
      sort: { sorted: 0, unsorted: 4, prepare: 0, nothing: 0, ask: 0 },
    });
    assert.equal(store.readTaskWorkFile().meta.sweepFirstDay, lib.localDay(new Date()));
    // Already on: the first day stays where it was.
    store.mutateTaskWork((d) => { d.meta.sweepFirstDay = '2026-11-01'; });
    actions.setSweepEnabled(true);
    assert.equal(store.readTaskWorkFile().meta.sweepFirstDay, '2026-11-01');
    assert.equal(actions.setSweepEnabled(true).cap, 8);
    const before = structuredClone(store.readTaskWorkFile().records);
    const off = await json(await post(route, { enabled: false }));
    assert.equal(off.body.data.enabled, false);
    assert.deepEqual(store.readTaskWorkFile().records, before);
    // Off again then on again: a new first day.
    actions.setSweepEnabled(true);
    assert.equal(store.readTaskWorkFile().meta.sweepFirstDay, lib.localDay(new Date()));
    process.env.TASK_WORKER_SWEEP_DISABLED = '1';
    assert.equal(actions.setSweepEnabled(true).enabled, false);
  });

  test('a first day claims two sweep tasks, then stops', () => {
    actions.setSweepEnabled(true);
    sortAll('prepare');
    const noon = new Date(); noon.setHours(12, 0, 0, 0);
    for (let n = 0; n < 2; n++) {
      const c = actions.claimTaskWork(noon)!;
      assert.equal(c.reason, 'sweep');
      assert.equal(c.sweepHint, 'sorted prepare');
      actions.updateTaskWork({ taskId: c.taskId, token: c.lease.token, action: 'rest', why: 'nothing yet' }, noon);
    }
    assert.equal(actions.claimTaskWork(noon), null);
    assert.equal(actions.taskWorkClaimable(noon), false);
    assert.equal(actions.taskWorkOverview(noon).sweep.claimsToday, 2);
  });

  test('GET: needsYou, working, counts, sweep, waiting soonest first, couldAsk Current queue first', async () => {
    const at = '2026-11-13T10:00:00.000Z';
    put('boom', record({ status: 'needs-you', items: [
      { id: 'q2', kind: 'question', text: 'Later', createdAt: '2026-11-13T12:00:00.000Z', status: 'pending' },
      { id: 'q1', kind: 'question', text: 'Earlier', createdAt: at, status: 'pending' },
      { id: 'q0', kind: 'question', text: 'Answered', createdAt: at, status: 'answered' },
    ] }));
    put('prof', record({ status: 'waiting', waiting: { on: 'the professor', since: at, checks: 0, checkAfter: '2026-11-20T10:00:00.000Z' } }));
    put('parent', record({ status: 'waiting', waiting: { on: 'U-Haul', since: at, checks: 0, checkAfter: '2026-11-16T10:00:00.000Z' } }));
    sortAll('ask');
    mkdirSync(path.join(tasksDir, 'current'), { recursive: true });
    writeFileSync(path.join(tasksDir, 'current', 'want-to-do.json'), JSON.stringify({ taskIds: ['want'] }));
    const data = (await json(await viewRoute.GET(new NextRequest('http://localhost/api/tasks/work')))).body.data;
    assert.deepEqual(Object.keys(data).sort(), ['couldAsk', 'counts', 'needsYou', 'sweep', 'waiting', 'working']);
    assert.deepEqual(data.needsYou, [{ taskId: 'boom', taskText: 'Get the rent credit from Boom', listType: 'have-to-do', items: [
      { id: 'q1', kind: 'question', text: 'Earlier', createdAt: at, status: 'pending' },
      { id: 'q2', kind: 'question', text: 'Later', createdAt: '2026-11-13T12:00:00.000Z', status: 'pending' },
    ] }]);
    assert.equal(data.working, null);
    assert.deepEqual(data.waiting.map((w: { taskId: string }) => w.taskId), ['parent', 'prof']);
    assert.deepEqual(data.waiting[1], { taskId: 'prof', taskText: 'Email the professor', listType: 'have-to-do', on: 'the professor', since: at, checkAfter: '2026-11-20T10:00:00.000Z' });
    assert.deepEqual(Object.keys(data.sweep).sort(), ['cap', 'claimsToday', 'enabled', 'quietNow', 'sort']);
    assert.deepEqual(data.sweep.sort, { sorted: 2, unsorted: 0, prepare: 0, nothing: 0, ask: 2 });
    // want is on the Current queue, so it leads although its list comes second.
    assert.deepEqual(data.couldAsk.map((c: { taskId: string }) => c.taskId), ['want', 'child']);
    assert.deepEqual(data.couldAsk.find((c: { taskId: string }) => c.taskId === 'child'), { taskId: 'child', taskText: 'Book the van', listType: 'have-to-do', q: 'Which one?', why: 'sorted ask' });

    actions.handTaskWork('want', true);
    assert.equal(actions.claimTaskWork()?.taskId, 'want');
    const after = actions.taskWorkOverview();
    assert.deepEqual(after.working, { taskId: 'want', taskText: 'Find a climbing gym', since: rec('want')!.lease!.claimedAt });
    assert.equal(after.couldAsk.some((x) => x.taskId === 'want'), false);
  });
});
