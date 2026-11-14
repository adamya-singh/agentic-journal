import assert from 'node:assert/strict';
import { before, beforeEach, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TaskSortEntry, TaskWork, TaskWorkRef } from '../src/lib/task-work';
import type { SortDeps } from '../src/app/api/tasks/work/sort';

// The task worker's batched sort (stage 3): which tasks nobody handed over are worth a sweep run. Nothing here calls
// OpenClaw: the runner gets an injected turn.
const root = mkdtempSync(path.join(tmpdir(), 'agentic-journal-task-sort-'));
const tasksDir = path.join(root, 'backend', 'tasks');
process.env.BACKEND_DATA_DIR = path.join(root, 'backend');
process.env.JOB_APPLICATION_JOBS_DIR = path.join(root, 'jobs');
process.env.OPENCLAW_CLI_PATH = path.join(root, 'missing-openclaw-cli.mjs');
process.env.OPENCLAW_COMPASS_DIR = path.join(root, 'no-compass');
process.env.BRIEF_AGENT_DISABLED = '1';

let sort: typeof import('../src/lib/task-sort');
let lib: typeof import('../src/lib/task-work');
let runner: typeof import('../src/app/api/tasks/work/sort');
let store: typeof import('../src/app/api/tasks/work/store');
let actions: typeof import('../src/app/api/tasks/work/actions');

const M = 60_000, D = 864e5;
const noon = new Date(2026, 10, 14, 12, 0);
const ref = (taskId: string, over: Partial<TaskWorkRef> = {}): TaskWorkRef =>
  ({ taskId, listType: 'have-to-do', listIndex: 0, currentRank: null, fingerprint: 'f', ...over });
const record = (over: Partial<TaskWork> = {}): TaskWork =>
  ({ status: 'resting', reason: 'handed', grant: 'prepare', items: [], failures: 0, updatedAt: noon.toISOString(), history: [], ...over });

before(async () => {
  sort = await import('../src/lib/task-sort');
  lib = await import('../src/lib/task-work');
  runner = await import('../src/app/api/tasks/work/sort');
  store = await import('../src/app/api/tasks/work/store');
  actions = await import('../src/app/api/tasks/work/actions');
});

describe('the batch, the prompt and the reply', () => {
  const tasks = Array.from({ length: 33 }, (_, i) => ({
    taskId: `id-${i}`, text: `Task ${i}`, fingerprint: `fp${i}`,
    ...(i === 0 ? { dueDate: '2026-11-20', projects: ['CS 112'], notesMarkdown: `Line one\n\n${'x'.repeat(600)}` } : {}),
  }));

  test('at most 30 tasks, under aliases t1…t30', () => {
    const batch = sort.buildSortBatch(tasks);
    assert.equal(batch.tasks.length, 30);
    assert.equal(batch.aliases.t1, 'id-0');
    assert.equal(batch.aliases.t30, 'id-29');
    assert.equal(batch.aliases.t31, undefined);
  });

  test('the prompt: no tools, the three verdicts, the rules, the compass, only aliases and the first 400 chars of notes', () => {
    const batch = sort.buildSortBatch(tasks);
    const prompt = sort.buildSortPrompt(batch, { now: noon, forAgents: 'Exams first; nothing social until Dec 12.' });
    assert.match(prompt, /Use no tools: no browsing/);
    assert.match(prompt, /Change nothing anywhere and message no one/);
    assert.match(prompt, /"nothing": only Adamya can do it \(attend a class, exercise, read, study, be somewhere\)/);
    assert.match(prompt, /"prepare": there is a concrete first step OpenClaw could prepare that only Adamya would see/);
    assert.match(prompt, /"ask": one answer from Adamya would unlock it/);
    assert.match(prompt, /Coursework: prepare only, never the work itself\. Job applications and online assessments belong to other workers: nothing\./);
    assert.match(prompt, /Exams first; nothing social until Dec 12\./);
    assert.match(prompt, /\{"id":"t1","task":"Task 0","due":"2026-11-20","project":"CS 112","notes":"Line one x+…"\}/);
    const notes = /"notes":"([^"]*)"/.exec(prompt)![1];
    assert.equal(notes.length, 401);
    assert.doesNotMatch(prompt, /id-0/);
    assert.doesNotMatch(prompt, /\bt31\b/);
    assert.doesNotMatch(sort.buildSortPrompt(batch, { now: noon, forAgents: '' }), /guidance for agents/);
  });

  test('the reply is read item by item through the aliases', () => {
    const aliases = { t1: 'a', t2: 'b', t3: 'c', t4: 'd', t5: 'e' };
    const check = sort.validateSortReply({
      T1: { v: 'nothing', why: 'a class' },
      t2: { v: 'prepare', why: 'find the form\nand list its fields' },
      t3: { v: 'ask', why: 'needs the unit', q: 'Which unit?' },
      t4: { v: 'maybe', why: 'unsure' },              // wrong verdict
      t5: { v: 'ask', why: 'no question given' },     // ask without q
      t9: { v: 'nothing', why: 'not sent' },          // unknown alias
      'id-x': { v: 'prepare', why: 'a real-looking id' },
    }, aliases);
    assert.deepEqual(check.verdicts, {
      a: { v: 'nothing', why: 'a class' },
      b: { v: 'prepare', why: 'find the form and list its fields' },
      c: { v: 'ask', why: 'needs the unit', q: 'Which unit?' },
    });
    assert.deepEqual(check.missing, ['d', 'e']);
    assert.equal(check.problems.length, 4);
    assert.deepEqual(sort.validateSortReply(null, aliases).missing, ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(sort.validateSortReply([1, 2], aliases).verdicts, {});
    // A prototype key is not an alias.
    assert.deepEqual(sort.validateSortReply({ constructor: { v: 'nothing', why: 'x' } }, aliases).verdicts, {});
  });

  test('outcome: verdicts stored with their fingerprint; missing ones count, and the third rests as nothing for a day', () => {
    const data = { sort: {} as Record<string, TaskSortEntry>, sortFailures: {} as Record<string, number> };
    const sent = [{ taskId: 'a', fingerprint: 'fa' }, { taskId: 'b', fingerprint: 'fb' }, { taskId: 'gone', fingerprint: 'fg' }, { taskId: 'edited', fingerprint: 'old' }];
    const current = (id: string) => ({ a: 'fa', b: 'fb', edited: 'new' } as Record<string, string>)[id] ?? null;
    let out = sort.applySortOutcome(data, sent, { verdicts: { a: { v: 'prepare', why: 'draft it' } } }, current, noon);
    assert.deepEqual(out, { sorted: 1, failed: 1, rested: 0 });
    assert.deepEqual(data.sort.a, { v: 'prepare', why: 'draft it', fingerprint: 'fa', at: noon.toISOString() });
    assert.deepEqual(data.sortFailures, { b: 1 });
    sort.applySortOutcome(data, sent, { verdicts: {} }, current, noon);
    out = sort.applySortOutcome(data, sent, { verdicts: {} }, current, noon);
    assert.equal(out.rested, 1);
    assert.equal(data.sort.b.v, 'nothing');
    assert.equal(data.sort.b.again, new Date(noon.getTime() + D).toISOString());
    assert.deepEqual(data.sortFailures, { a: 2 });
    assert.equal(lib.sortVerdict(data.sort.b, 'fb', new Date(noon.getTime() + D - 1)), 'nothing');
    assert.equal(lib.sortVerdict(data.sort.b, 'fb', new Date(noon.getTime() + D)), null);
  });
});

describe('verdicts and the candidates', () => {
  const at = noon.toISOString();

  test('re-sorted when the task changes or after 30 days; tasks with a record, dailies and children of off parents never', () => {
    const refs = [
      ref('fresh'), ref('nothing'), ref('changed', { fingerprint: 'new' }), ref('old'), ref('handed'),
      ref('daily', { isDaily: true }), ref('child', { parentTaskId: 'off' }), ref('off'), ref('cur', { currentRank: 0, listIndex: 9 }),
    ];
    const entries: Record<string, TaskSortEntry> = {
      nothing: { v: 'nothing', why: 'a class', fingerprint: 'f', at },
      changed: { v: 'nothing', why: 'a class', fingerprint: 'f', at },
      old: { v: 'nothing', why: 'a class', fingerprint: 'f', at: new Date(noon.getTime() - 30 * D).toISOString() },
    };
    const records = { handed: record({ status: 'queued' }), off: record({ status: 'off' }) };
    assert.deepEqual(sort.sortCandidates(records, refs, entries, noon).map((r) => r.taskId), ['cur', 'fresh', 'changed', 'old']);
    assert.deepEqual(sort.sortCounts(records, refs, entries, noon), { sorted: 1, unsorted: 4, prepare: 0, nothing: 1, ask: 0 });
    // 29 days and 23 hours later it still holds; at 30 days it does not.
    assert.equal(lib.sortVerdict(entries.nothing, 'f', new Date(noon.getTime() + 30 * D - 1)), 'nothing');
    assert.equal(lib.sortVerdict(entries.nothing, 'f', new Date(noon.getTime() + 30 * D)), null);
  });
});

describe('pacing', () => {
  const base = { now: noon, disabled: false, sweepEnabled: true, running: false, runs: undefined, candidates: 40 };

  test('one batch per 10 minutes, 12 a day, never at night, only with the sweep on, never two at once', () => {
    assert.equal(sort.decideSortBatch(base), 'run');
    assert.equal(sort.decideSortBatch({ ...base, disabled: true }), 'disabled');
    assert.equal(sort.decideSortBatch({ ...base, sweepEnabled: false }), 'sweep-off');
    assert.equal(sort.decideSortBatch({ ...base, now: new Date(2026, 10, 14, 23, 0) }), 'quiet');
    assert.equal(sort.decideSortBatch({ ...base, now: new Date(2026, 10, 14, 7, 59) }), 'quiet');
    assert.equal(sort.decideSortBatch({ ...base, running: true }), 'running');
    const runs = { date: '2026-11-14', count: 3, lastAt: new Date(noon.getTime() - 9 * M).toISOString() };
    assert.equal(sort.decideSortBatch({ ...base, runs }), 'paced');
    assert.equal(sort.decideSortBatch({ ...base, runs: { ...runs, lastAt: new Date(noon.getTime() - 10 * M).toISOString() } }), 'run');
    assert.equal(sort.decideSortBatch({ ...base, runs: { date: '2026-11-14', count: 12, lastAt: '2026-11-14T00:00:00.000Z' } }), 'daily-limit');
    assert.equal(sort.decideSortBatch({ ...base, runs: { date: '2026-11-13', count: 12, lastAt: '2026-11-13T00:00:00.000Z' } }), 'run');
    assert.equal(sort.decideSortBatch({ ...base, candidates: 0 }), 'nothing');
    assert.deepEqual(sort.countSortRun({ date: '2026-11-13', count: 12 }, noon), { date: '2026-11-14', count: 1, lastAt: noon.toISOString() });
  });
});

describe('the runner', () => {
  // Five open tasks: boom has something to prepare, gym is a workout, unit needs an answer, oa is an assessment.
  const writeTasks = () => {
    rmSync(root, { recursive: true, force: true });
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(path.join(tasksDir, 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [
      { id: 'boom', text: 'Get the rent credit from Boom', notesMarkdown: 'Charged $18 twice.' },
      { id: 'gym', text: 'Lift legs' },
      { id: 'unit', text: 'Fix the sink', projects: ['Apartment'] },
      { id: 'oa', text: 'Acme online assessment', dueDate: '2026-11-18' },
      { id: 'daily', text: 'Read', isDaily: true },
    ] }));
    writeFileSync(path.join(tasksDir, 'want-to-do.json'), JSON.stringify({ _comment: '', tasks: [] }));
  };
  const turns: { message: string; sessionKey: string; timeoutMs: number }[] = [];
  const replying = (reply: (message: string) => string): SortDeps => ({
    available: () => true,
    forAgents: () => 'Exams first.',
    turn: async (input) => { turns.push(input); return reply(input.message); },
  });
  /** Answers every alias in the prompt from what the task says. */
  const judge = (message: string) => {
    const out: Record<string, unknown> = {};
    for (const m of message.matchAll(/\{"id":"(t\d+)","task":"([^"]+)"/g)) {
      const [, alias, text] = m;
      out[alias] = /Boom/.test(text) ? { v: 'prepare', why: 'draft the dispute email' }
        : /sink/.test(text) ? { v: 'ask', why: 'needs the unit', q: 'Which unit is it?' }
        : { v: 'nothing', why: 'only Adamya can do it' };
    }
    return `Here you go:\n\`\`\`json\n${JSON.stringify(out)}\n\`\`\``;
  };
  const on = () => store.mutateTaskWork((d) => { d.meta.sweepEnabled = true; d.meta.sweepFirstDay = '2026-11-01'; });

  beforeEach(() => {
    writeTasks();
    turns.length = 0;
    for (const k of ['TASK_SORT_DISABLED', 'TASK_WORKER_DISABLED', 'TASK_WORKER_SWEEP_DISABLED']) delete process.env[k];
  });

  test('does nothing while the sweep is off, without the CLI, or under any off-switch', async () => {
    assert.equal((await runner.runTaskSortIfDue(noon, replying(judge))).decision, 'sweep-off');
    on();
    assert.equal((await runner.runTaskSortIfDue(noon, { ...replying(judge), available: () => false })).decision, 'no-cli');
    for (const k of ['TASK_SORT_DISABLED', 'TASK_WORKER_DISABLED', 'TASK_WORKER_SWEEP_DISABLED']) {
      process.env[k] = '1';
      assert.equal((await runner.runTaskSortIfDue(noon, replying(judge))).decision, 'disabled', k);
      delete process.env[k];
    }
    assert.equal(turns.length, 0);
  });

  test('one batch sorts every task, then the sweep claims only the `prepare` one', async () => {
    on();
    const result = await runner.runTaskSortIfDue(noon, replying(judge));
    assert.equal(result.decision, 'sorted');
    assert.equal(result.sorted, 4);
    assert.equal(turns.length, 1);
    assert.match(turns[0].sessionKey, /^agent:main:cron:journal-sort-\d+$/);
    assert.equal(turns[0].timeoutMs, 5 * M);
    assert.match(turns[0].message, /Exams first\./);
    assert.doesNotMatch(turns[0].message, /"Read"/);
    const file = store.readTaskWorkFile();
    assert.deepEqual(Object.fromEntries(Object.entries(file.sort).map(([id, e]) => [id, e.v])), { boom: 'prepare', gym: 'nothing', unit: 'ask', oa: 'nothing' });
    assert.equal(file.meta.sortRuns?.count, 1);
    assert.equal(file.version, 1);

    // Paced: nothing left to sort, and in any case not within 10 minutes.
    assert.equal((await runner.runTaskSortIfDue(new Date(noon.getTime() + 5 * M), replying(judge))).decision, 'paced');
    assert.equal((await runner.runTaskSortIfDue(new Date(noon.getTime() + 11 * M), replying(judge))).decision, 'nothing');

    const c = actions.claimTaskWork(noon)!;
    assert.equal(c.taskId, 'boom');
    assert.equal(c.reason, 'sweep');
    assert.equal(c.sweepHint, 'draft the dispute email');
    actions.updateTaskWork({ taskId: 'boom', token: c.lease.token, action: 'rest', why: 'drafted' }, noon);
    assert.equal(actions.claimTaskWork(noon), null);
    const overview = actions.taskWorkOverview(noon);
    assert.deepEqual(overview.couldAsk, [{ taskId: 'unit', taskText: 'Fix the sink', listType: 'have-to-do', q: 'Which unit is it?', why: 'needs the unit' }]);
    assert.deepEqual(overview.sweep.sort, { sorted: 3, unsorted: 0, prepare: 0, nothing: 2, ask: 1 });
  });

  test('an edited task is sorted again; a bad reply counts a failure for every task in the batch', async () => {
    on();
    await runner.runTaskSortIfDue(noon, replying(judge));
    writeFileSync(path.join(tasksDir, 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [
      { id: 'boom', text: 'Get the rent credit from Boom', notesMarkdown: 'Charged $18 twice.' },
      { id: 'gym', text: 'Lift legs, then email the coach about the schedule' },
    ] }));
    let t = new Date(noon.getTime() + 11 * M);
    const bad = await runner.runTaskSortIfDue(t, replying(() => 'I could not decide.'));
    assert.equal(bad.decision, 'sorted');
    assert.equal(bad.failed, 1);
    assert.match(turns.at(-1)!.message, /Lift legs, then email the coach/);
    assert.doesNotMatch(turns.at(-1)!.message, /rent credit/);
    assert.deepEqual(store.readTaskWorkFile().sortFailures, { gym: 1 });
    for (let n = 0; n < 2; n++) {
      t = new Date(t.getTime() + 11 * M);
      await runner.runTaskSortIfDue(t, { ...replying(judge), turn: async () => { throw new Error('gateway down'); } });
    }
    const entry = store.readTaskWorkFile().sort.gym;
    assert.equal(entry.v, 'nothing');
    assert.equal(entry.why, 'OpenClaw could not sort it 3 times');
    assert.deepEqual(store.readTaskWorkFile().sortFailures, {});
    // A day later it is tried again.
    assert.equal((await runner.runTaskSortIfDue(new Date(t.getTime() + 11 * M), replying(judge))).decision, 'nothing');
    const next = await runner.runTaskSortIfDue(new Date(t.getTime() + D + M), replying(judge));
    assert.equal(next.decision, 'sorted');
    assert.equal(store.readTaskWorkFile().sort.gym.v, 'nothing');
    assert.equal(store.readTaskWorkFile().sort.gym.why, 'only Adamya can do it');
  });

  test('at most 12 batches a day, never two at once', async () => {
    on();
    store.mutateTaskWork((d) => { d.meta.sortRuns = { date: '2026-11-14', count: 12, lastAt: '2026-11-14T09:00:00.000Z' }; });
    assert.equal((await runner.runTaskSortIfDue(noon, replying(judge))).decision, 'daily-limit');
    store.mutateTaskWork((d) => { delete d.meta.sortRuns; });
    let release!: (s: string) => void;
    const slow: SortDeps = { ...replying(judge), turn: (input) => new Promise((resolve) => { turns.push(input); release = resolve; }) };
    const first = runner.runTaskSortIfDue(noon, slow);
    // The first batch is in flight (its pacing is stamped too): a second call does not start another turn.
    assert.match((await runner.runTaskSortIfDue(new Date(noon.getTime() + 20 * M), replying(judge))).decision, /^(running|paced)$/);
    store.mutateTaskWork((d) => { delete d.meta.sortRuns; });
    assert.equal((await runner.runTaskSortIfDue(new Date(noon.getTime() + 20 * M), replying(judge))).decision, 'running');
    release(judge(turns[0].message));
    assert.equal((await first).decision, 'sorted');
    assert.equal(turns.length, 1);
  });
});
