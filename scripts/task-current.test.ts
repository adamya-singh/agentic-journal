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
