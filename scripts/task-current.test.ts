import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-current-'));
process.env.BACKEND_DATA_DIR = testRoot;

const tasksDir = path.join(testRoot, 'tasks');
const currentDir = path.join(tasksDir, 'current');
const dailyListsDir = path.join(tasksDir, 'daily-lists');
const journalDir = path.join(testRoot, 'journal');

let store: typeof import('../src/app/api/tasks/current/current-store-utils');

function todayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
}

function snapshotDataDir(): Map<string, string> {
  const files = new Map<string, string>();
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.set(full, readFileSync(full, 'utf-8'));
    }
  };
  walk(testRoot);
  return files;
}

function seedBaseData(): void {
  rmSync(testRoot, { recursive: true, force: true });
  mkdirSync(dailyListsDir, { recursive: true });
  mkdirSync(journalDir, { recursive: true });
  const today = todayISO();
  writeJson(path.join(tasksDir, 'have-to-do.json'), {
    _comment: 'Queue structure - first element is highest priority',
    tasks: [
      { id: 't1', text: 'Task one' },
      { id: 't2', text: 'Task two' },
      { id: 't3', text: 'Task three' },
    ],
  });
  writeJson(path.join(tasksDir, 'want-to-do.json'), { _comment: '', tasks: [] });
  writeJson(path.join(currentDir, 'have-to-do.json'), {
    _comment: 'Running Current queue - first task ID is highest ranked priority',
    schemaVersion: 1,
    taskIds: ['orphan-gone', 't1', 't2'],
  });
  writeJson(path.join(currentDir, 'want-to-do.json'), {
    _comment: 'Running Current queue - first task ID is highest ranked priority',
    schemaVersion: 1,
    taskIds: [],
  });
  writeJson(path.join(currentDir, 'metadata.json'), {
    _comment: 'Running Current queues and dated full-snapshot rollover metadata',
    schemaVersion: 1,
    initializedDate: today,
    lastMaterializedDate: today,
  });
  for (const listType of ['have-to-do', 'want-to-do']) {
    writeJson(path.join(dailyListsDir, `${today}-${listType}.json`), {
      _comment: 'Daily Today snapshot - selected Current tasks plus automatic due-date attention',
      schemaVersion: 3,
      date: today,
      listType,
      selectedTasks: [],
      automaticTasks: [],
    });
  }
}

before(async () => {
  store = await import('../src/app/api/tasks/current/current-store-utils');
});

describe('Current queue integrity', () => {
  test('getCurrentTasks self-heals orphaned queue ids', () => {
    seedBaseData();
    const tasks = store.getCurrentTasks('have-to-do');
    assert.deepEqual(tasks.map((t) => t.id), ['t1', 't2']);
    const queue = readJson(path.join(currentDir, 'have-to-do.json'));
    assert.deepEqual(queue.taskIds, ['t1', 't2']);
  });

  test('addTaskToCurrent applies position against the validated list', () => {
    seedBaseData();
    // Position 1 computed by a UI that sees [t1, t2]; with the orphan still in
    // the raw array the old code would land t3 at visible rank 0.
    const added = store.addTaskToCurrent('have-to-do', 't3', 1);
    assert.equal(added, true);
    const queue = readJson(path.join(currentDir, 'have-to-do.json'));
    assert.deepEqual(queue.taskIds, ['t1', 't3', 't2']);
  });

  test('ensure/refresh perform zero writes when nothing changed', () => {
    seedBaseData();
    store.refreshActiveDailySnapshots();
    const settled = snapshotDataDir();
    store.ensureCurrentSystemThroughToday();
    store.refreshActiveDailySnapshots();
    store.getEffectiveDailySnapshot(todayISO(), 'have-to-do');
    assert.deepEqual(snapshotDataDir(), settled);
  });

  test('metadata loss with existing queues does not reseed rankings', () => {
    seedBaseData();
    rmSync(path.join(currentDir, 'metadata.json'));
    const metadata = store.ensureCurrentSystemThroughToday();
    const queue = readJson(path.join(currentDir, 'have-to-do.json'));
    // Reseeding would have replaced the ranking with computed-today ∪ daily.
    assert.deepEqual(queue.taskIds, ['orphan-gone', 't1', 't2']);
    assert.equal(metadata.lastMaterializedDate, todayISO());
    assert.equal(existsSync(path.join(currentDir, 'metadata.json')), true);
  });

  test('fresh system with no queue files seeds and materializes', () => {
    seedBaseData();
    rmSync(currentDir, { recursive: true, force: true });
    const metadata = store.ensureCurrentSystemThroughToday();
    assert.equal(metadata.lastMaterializedDate, todayISO());
    assert.equal(existsSync(path.join(currentDir, 'have-to-do.json')), true);
  });
});

describe('Completion lifecycle', () => {
  let completeRoute: typeof import('../src/app/api/tasks/today/complete/route');
  let nextServer: typeof import('next/server');

  before(async () => {
    completeRoute = await import('../src/app/api/tasks/today/complete/route');
    nextServer = await import('next/server');
  });

  async function postComplete(taskId: string, date: string): Promise<Record<string, unknown>> {
    const request = new nextServer.NextRequest('http://localhost/api/tasks/today/complete', {
      method: 'POST',
      body: JSON.stringify({ taskId, listType: 'have-to-do', date }),
      headers: { 'content-type': 'application/json' },
    });
    const response = await completeRoute.POST(request);
    return (await response.json()) as Record<string, unknown>;
  }

  test('complete then uncomplete restores General, Current, and Today visibility', async () => {
    seedBaseData();
    const today = todayISO();

    const completed = await postComplete('t1', today);
    assert.equal(completed.success, true);
    assert.equal(completed.completed, true);

    let general = readJson(path.join(tasksDir, 'have-to-do.json'));
    assert.equal((general.tasks as Array<{ id: string }>).some((t) => t.id === 't1'), false);
    let queue = readJson(path.join(currentDir, 'have-to-do.json'));
    assert.equal((queue.taskIds as string[]).includes('t1'), false);
    let daily = readJson(path.join(dailyListsDir, `${today}-have-to-do.json`));
    assert.equal(daily.schemaVersion, 3);
    const allEntries = [
      ...(daily.selectedTasks as Array<Record<string, unknown>>),
      ...(daily.automaticTasks as Array<Record<string, unknown>>),
    ];
    assert.equal(allEntries.some((t) => t.id === 't1' && t.completed === true), true);

    const uncompleted = await postComplete('t1', today);
    assert.equal(uncompleted.success, true);
    assert.equal(uncompleted.completed, false);

    general = readJson(path.join(tasksDir, 'have-to-do.json'));
    assert.equal((general.tasks as Array<{ id: string }>).some((t) => t.id === 't1'), true);
    // Restored at the end of the ranked queue (original rank is not recorded).
    queue = readJson(path.join(currentDir, 'have-to-do.json'));
    assert.deepEqual(queue.taskIds, ['t2', 't1']);
    // Still visible in Today, no longer completed.
    daily = readJson(path.join(dailyListsDir, `${today}-have-to-do.json`));
    const selected = daily.selectedTasks as Array<Record<string, unknown>>;
    const entry = selected.find((t) => t.id === 't1');
    assert.ok(entry, 'uncompleted task must stay visible in the Today snapshot');
    assert.notEqual(entry.completed, true);
  });

  test('removing from Current scrubs future-dated snapshot selections', () => {
    seedBaseData();
    const future = '2099-01-01';
    store.addCurrentTaskToToday(future, 'have-to-do', 't1');
    let futureSnapshot = readJson(path.join(dailyListsDir, `${future}-have-to-do.json`));
    assert.equal(
      (futureSnapshot.selectedTasks as Array<{ id: string }>).some((t) => t.id === 't1'),
      true
    );

    store.removeTaskFromCurrent('have-to-do', 't1');

    futureSnapshot = readJson(path.join(dailyListsDir, `${future}-have-to-do.json`));
    assert.equal(
      (futureSnapshot.selectedTasks as Array<{ id: string }>).some((t) => t.id === 't1'),
      false,
      'future-dated selection must not survive removal from Current'
    );
  });

  test('completion removes the task from journal staged without flapping', async () => {
    seedBaseData();
    const today = todayISO();
    store.addCurrentTaskToToday(today, 'have-to-do', 't1');

    const journalPath = path.join(journalDir, `${today}.json`);
    let journal = readJson(journalPath);
    assert.equal(
      (journal.staged as Array<{ taskId: string }>).some((e) => e.taskId === 't1'),
      true,
      'selected task must be staged'
    );

    const completed = await postComplete('t1', today);
    assert.equal(completed.success, true);
    journal = readJson(journalPath);
    assert.equal(
      (journal.staged as Array<{ taskId: string }>).some((e) => e.taskId === 't1'),
      false,
      'completed task must leave staged'
    );

    // A read-path sync must not re-stage it (the old dual-writer flap).
    const settled = readFileSync(journalPath, 'utf-8');
    store.getEffectiveDailySnapshot(today, 'have-to-do');
    store.syncStagedJournalFromSnapshots(today);
    assert.equal(readFileSync(journalPath, 'utf-8'), settled);
  });

  test('daily task completed today renders completed in Current and toggles correctly', async () => {
    seedBaseData();
    const today = todayISO();
    writeJson(path.join(tasksDir, 'have-to-do.json'), {
      _comment: '',
      tasks: [
        { id: 't-daily', text: 'Daily habit', isDaily: true },
        { id: 't1', text: 'Task one' },
        { id: 't2', text: 'Task two' },
      ],
    });
    writeJson(path.join(currentDir, 'have-to-do.json'), {
      _comment: '',
      schemaVersion: 1,
      taskIds: ['t-daily', 't1', 't2'],
    });

    const completed = await postComplete('t-daily', today);
    assert.equal(completed.success, true);

    // Daily tasks stay in General and in Current after completion.
    const queue = readJson(path.join(currentDir, 'have-to-do.json'));
    assert.equal((queue.taskIds as string[]).includes('t-daily'), true);
    const currentTasks = store.getCurrentTasks('have-to-do');
    const daily = currentTasks.find((t) => t.id === 't-daily');
    assert.ok(daily);
    assert.equal(daily.completed, true, 'completed daily must render checked in the Current section');

    // Second toggle uncompletes — previously it looked unchecked and clicking
    // silently wiped the completion record.
    const uncompleted = await postComplete('t-daily', today);
    assert.equal(uncompleted.success, true);
    assert.equal(uncompleted.completed, false);
    const after = store.getCurrentTasks('have-to-do').find((t) => t.id === 't-daily');
    assert.ok(after);
    assert.notEqual(after.completed, true);
  });
});
