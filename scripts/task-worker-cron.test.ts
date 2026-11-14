import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { OpenClawCronJob } from '../src/lib/openclaw-cron';
import type { WakeDeps, WakeInputs, WakeState } from '../src/app/api/tasks/work/cron';

// The task worker's cron: declared once, woken only when a task is claimable. Nothing here calls the real CLI.
const root = mkdtempSync(path.join(tmpdir(), 'agentic-journal-task-worker-cron-'));
process.env.BACKEND_DATA_DIR = path.join(root, 'backend');
process.env.JOB_APPLICATION_JOBS_DIR = path.join(root, 'jobs');
process.env.OPENCLAW_CLI_PATH = path.join(root, 'missing-openclaw-cli.mjs');
process.env.OPENCLAW_COMPASS_DIR = path.join(root, 'no-compass');
process.env.BRIEF_AGENT_DISABLED = '1';

let cron: typeof import('../src/app/api/tasks/work/cron');

before(async () => {
  cron = await import('../src/app/api/tasks/work/cron');
});

const M = 60_000;
const T0 = Date.parse('2026-11-14T15:00:00.000Z');

describe('the wake decision', () => {
  const ready: WakeInputs = { now: T0, disabled: false, browserBusy: false, taskLeaseLive: false, claimable: true, running: false };
  const idle = (): WakeState => cron.emptyWakeState();

  test('wakes when a task is claimable and nothing else is going on', () => {
    assert.equal(cron.decideTaskWorkerWake(idle(), ready), 'wake');
  });

  test('each reason not to wake', () => {
    assert.equal(cron.decideTaskWorkerWake(idle(), { ...ready, disabled: true }), 'disabled');
    assert.equal(cron.decideTaskWorkerWake(idle(), { ...ready, claimable: false }), 'nothing');
    assert.equal(cron.decideTaskWorkerWake(idle(), { ...ready, running: true }), 'running');
    assert.equal(cron.decideTaskWorkerWake(idle(), { ...ready, taskLeaseLive: true }), 'running');
    assert.equal(cron.decideTaskWorkerWake(idle(), { ...ready, browserBusy: true }), 'browser-busy');
    assert.equal(cron.decideTaskWorkerWake({ ...idle(), lastWakeAt: T0 - 1 * M }, ready), 'throttled');
    assert.equal(cron.decideTaskWorkerWake({ ...idle(), lastWakeAt: T0 - 2 * M }, ready), 'wake');
    assert.equal(cron.decideTaskWorkerWake({ ...idle(), backoffUntil: T0 + 1 }, ready), 'backed-off');
  });

  test('disabled wins over everything', () => {
    assert.equal(cron.decideTaskWorkerWake({ ...idle(), lastWakeAt: T0 }, { ...ready, disabled: true, browserBusy: true }), 'disabled');
  });

  test('a run that claimed nothing backs off 5 minutes, doubling, at most an hour; a claim starts over', () => {
    let s: WakeState = { ...idle(), lastWakeAt: T0, wakeSettled: false };
    // Still running and young: not judged yet.
    assert.equal(cron.settleLastWake(s, { now: T0 + 3 * M, running: true, claimedSinceWake: false }), s);
    s = cron.settleLastWake(s, { now: T0 + 3 * M, running: false, claimedSinceWake: false });
    assert.equal(s.emptyRuns, 1);
    assert.equal(s.backoffUntil, T0 + 3 * M + cron.WAKE_BACKOFF_MS);
    assert.equal(cron.decideTaskWorkerWake(s, { ...ready, now: T0 + 4 * M }), 'backed-off');
    assert.equal(cron.decideTaskWorkerWake(s, { ...ready, now: T0 + 8 * M }), 'wake');
    // Judged once: a second settle changes nothing.
    assert.equal(cron.settleLastWake(s, { now: T0 + 9 * M, running: false, claimedSinceWake: false }), s);
    s = cron.settleLastWake({ ...s, lastWakeAt: T0 + 9 * M, wakeSettled: false }, { now: T0 + 12 * M, running: false, claimedSinceWake: false });
    assert.equal(s.backoffUntil, T0 + 12 * M + 2 * cron.WAKE_BACKOFF_MS);
    for (let i = 0; i < 6; i++) s = cron.settleLastWake({ ...s, wakeSettled: false }, { now: T0, running: false, claimedSinceWake: false });
    assert.equal(s.backoffUntil, T0 + 60 * M);
    s = cron.settleLastWake({ ...s, wakeSettled: false }, { now: T0, running: false, claimedSinceWake: true });
    assert.equal(s.emptyRuns, 0);
  });

  test('a run still marked running after 35 minutes is judged anyway', () => {
    const s = cron.settleLastWake({ ...idle(), lastWakeAt: T0, wakeSettled: false }, { now: T0 + 36 * M, running: true, claimedSinceWake: false });
    assert.equal(s.emptyRuns, 1);
  });

  test('a failed cron run backs off like an empty run', () => {
    const s = cron.failedWake(idle(), T0);
    assert.equal(s.lastWakeAt, T0);
    assert.equal(s.backoffUntil, T0 + cron.WAKE_BACKOFF_MS);
  });
});

describe('declaring and waking through the CLI (faked)', () => {
  let job: OpenClawCronJob | null;
  let calls: string[][];
  let claimable: boolean;
  let claimed: boolean;
  const deps = (over: Partial<WakeDeps> = {}): WakeDeps => ({
    available: () => true,
    find: async () => job,
    run: async (args) => {
      calls.push(args);
      if (args[1] === 'add') job = { id: 'job-1', name: cron.TASK_WORKER_CRON_NAME, enabled: true, running: false };
      return '{"ok":true}';
    },
    claimable: () => claimable,
    browserBusy: () => false,
    taskLeaseLive: () => false,
    claimedSince: () => claimed,
    ...over,
  });

  beforeEach(() => {
    job = null;
    calls = [];
    claimable = true;
    claimed = false;
    delete process.env.TASK_WORKER_DISABLED;
    Object.assign(cron.wakeState(), cron.emptyWakeState());
  });

  test('declares the cron once, with its declaration key, every 6 h, isolated, no delivery, 30 min timeout', async () => {
    assert.equal(await cron.ensureTaskWorkerCron(deps()), 'added');
    assert.equal(await cron.ensureTaskWorkerCron(deps()), 'exists');
    assert.equal(calls.length, 1);
    const args = calls[0];
    const flag = (name: string) => args[args.indexOf(name) + 1];
    assert.deepEqual(args.slice(0, 2), ['cron', 'add']);
    assert.equal(flag('--name'), 'Agentic Journal Task Worker');
    assert.equal(flag('--declaration-key'), 'agentic-journal.task-worker.v1');
    assert.equal(flag('--every'), '6h');
    assert.equal(flag('--session'), 'isolated');
    assert.equal(flag('--timeout-seconds'), '1800');
    assert.ok(args.includes('--no-deliver'));
    assert.match(flag('--message'), /^Use the agentic-journal-task-worker skill and process exactly one task\./);
  });

  test('never rewrites an existing job, and declares nothing when disabled or without the CLI', async () => {
    job = { id: 'old', name: cron.TASK_WORKER_CRON_NAME, enabled: false, running: false };
    assert.equal(await cron.ensureTaskWorkerCron(deps()), 'exists');
    process.env.TASK_WORKER_DISABLED = '1';
    job = null;
    assert.equal(await cron.ensureTaskWorkerCron(deps()), 'disabled');
    delete process.env.TASK_WORKER_DISABLED;
    assert.equal(await cron.ensureTaskWorkerCron(deps({ available: () => false })), 'disabled');
    assert.equal(calls.length, 0);
  });

  test('wakes with cron run when claimable, declaring the job first if it is missing', async () => {
    const result = await cron.wakeTaskWorker(new Date(T0), deps());
    assert.equal(result.decision, 'wake');
    assert.deepEqual(calls.map((a) => a.slice(0, 2).join(' ')), ['cron add', 'cron run']);
    assert.deepEqual(calls[1], ['cron', 'run', 'job-1']);
  });

  test('throttled for two minutes, then judged: an empty run backs off', async () => {
    job = { id: 'job-1', name: cron.TASK_WORKER_CRON_NAME, enabled: true, running: false };
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps())).decision, 'wake');
    assert.equal((await cron.wakeTaskWorker(new Date(T0 + 1 * M), deps())).decision, 'throttled');
    assert.equal((await cron.wakeTaskWorker(new Date(T0 + 3 * M), deps())).decision, 'backed-off');
    assert.equal((await cron.wakeTaskWorker(new Date(T0 + 7 * M), deps())).decision, 'backed-off');
    assert.equal((await cron.wakeTaskWorker(new Date(T0 + 9 * M), deps())).decision, 'wake');
    claimed = true;
    assert.equal((await cron.wakeTaskWorker(new Date(T0 + 12 * M), deps())).decision, 'wake');
    assert.equal(cron.wakeState().emptyRuns, 0);
    assert.equal(calls.filter((a) => a[1] === 'run').length, 3);
  });

  test('does not wake when nothing is claimable, the cron is running, a job lease or task lease is live, or it is off', async () => {
    job = { id: 'job-1', name: cron.TASK_WORKER_CRON_NAME, enabled: true, running: false };
    claimable = false;
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps())).decision, 'nothing');
    claimable = true;
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps({ browserBusy: () => true }))).decision, 'browser-busy');
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps({ taskLeaseLive: () => true }))).decision, 'running');
    job = { ...job, running: true };
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps())).decision, 'running');
    job = { ...job, running: false, enabled: false };
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps())).decision, 'cron-disabled');
    process.env.TASK_WORKER_DISABLED = '1';
    job = { ...job, enabled: true };
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps())).decision, 'disabled');
    delete process.env.TASK_WORKER_DISABLED;
    assert.equal((await cron.wakeTaskWorker(new Date(T0), deps({ available: () => false }))).decision, 'no-cli');
    assert.equal(calls.length, 0);
  });

  test('a failing cron run is reported, never thrown, and backs off', async () => {
    job = { id: 'job-1', name: cron.TASK_WORKER_CRON_NAME, enabled: true, running: false };
    const failing = deps({ run: async () => { throw new Error('gateway down'); } });
    const result = await cron.wakeTaskWorker(new Date(T0), failing);
    assert.equal(result.decision, 'failed');
    assert.equal(cron.wakeState().backoffUntil, T0 + cron.WAKE_BACKOFF_MS);
    assert.equal((await cron.wakeTaskWorker(new Date(T0 + 3 * M), deps())).decision, 'backed-off');
  });

  test('without the real CLI the default wake does nothing, quietly', async () => {
    assert.equal((await cron.wakeTaskWorker()).decision, 'no-cli');
  });
});
