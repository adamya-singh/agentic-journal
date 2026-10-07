import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/lib/types';
import { letGoSince, putBack, takeOut } from '../src/app/api/tasks/let-go/let-go-store';

const now = new Date('2026-10-07T12:00:00Z');
const tasks: Task[] = [
  { id: 'a', text: 'Regression HW2', dueDate: '2026-10-03' },
  { id: 'b', text: 'Grocery list' },
  { id: 'b1', text: 'buy honey', parentTaskId: 'b' },
  { id: 'b2', text: 'buy apples', parentTaskId: 'b' },
  { id: 'd', text: 'Workout', isDaily: true },
  { id: 'c', text: 'Done thing', completed: true },
];

test('letting go removes the task and its subtasks and remembers its Current rank', () => {
  const out = takeOut(tasks, 'b', 'have-to-do', ['a', 'b'], now, '  not needed  ');
  assert.ok(!('error' in out));
  if ('error' in out) return;
  assert.deepEqual([...out.removedIds].sort(), ['b', 'b1', 'b2']);
  assert.deepEqual(out.tasks.map((t) => t.id), ['a', 'd', 'c']);
  assert.equal(out.record.currentRank, 1);
  assert.equal(out.record.reason, 'not needed');
  assert.deepEqual(out.record.subtasks.map((t) => t.id), ['b1', 'b2']);
  assert.equal(out.record.letGoAt, now.toISOString());
});

test('a task outside Current records no rank and no empty reason', () => {
  const out = takeOut(tasks, 'a', 'have-to-do', [], now, '   ');
  assert.ok(!('error' in out));
  if ('error' in out) return;
  assert.equal(out.record.currentRank, null);
  assert.equal('reason' in out.record, false);
});

test('daily, completed and unknown tasks cannot be let go', () => {
  assert.deepEqual(takeOut(tasks, 'd', 'have-to-do', [], now), { error: 'daily' });
  assert.deepEqual(takeOut(tasks, 'c', 'have-to-do', [], now), { error: 'completed' });
  assert.deepEqual(takeOut(tasks, 'zzz', 'have-to-do', [], now), { error: 'not-found' });
});

test('restoring puts the task and subtasks back once, at the end of the list', () => {
  const out = takeOut(tasks, 'b', 'have-to-do', [], now);
  if ('error' in out) throw new Error(out.error);
  const restored = putBack(out.tasks, out.record);
  assert.deepEqual(restored.map((t) => t.id), ['a', 'd', 'c', 'b', 'b1', 'b2']);
  assert.deepEqual(putBack(restored, out.record).map((t) => t.id), restored.map((t) => t.id));
});

test('letGoSince returns recent records newest first', () => {
  const rec = (id: string, at: string) => ({ id, listType: 'have-to-do' as const, letGoAt: at, task: { id, text: id }, subtasks: [], currentRank: null });
  const data = { _comment: '', schemaVersion: 1 as const, records: [rec('old', '2026-09-01T00:00:00Z'), rec('x', '2026-10-05T00:00:00Z'), rec('y', '2026-10-06T00:00:00Z')] };
  assert.deepEqual(letGoSince(data, new Date('2026-09-30T00:00:00Z')).map((r) => r.id), ['y', 'x']);
});
