import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPlanActionInJournal,
  type DayJournalWithRanges,
} from '../src/app/api/journal/plan-lifecycle-utils';

const date = '2026-11-12';
const now = '2026-11-12T15:00:00.000Z';
const plan = (over: Record<string, unknown> = {}) => ({
  taskId: 't1', listType: 'have-to-do' as const, entryMode: 'planned' as const, planId: 'p1', planStatus: 'active' as const, ...over,
});
const entries = (journal: DayJournalWithRanges, hour: string) => {
  const slot = (journal as Record<string, unknown>)[hour];
  return (Array.isArray(slot) ? slot : slot ? [slot] : []) as Array<Record<string, unknown>>;
};

test('acting on a task plan fulfils it and logs the task in the same hour', () => {
  for (const action of ['in-progress', 'complete'] as const) {
    const journal = { '2pm': plan() } as unknown as DayJournalWithRanges;
    const result = applyPlanActionInJournal(journal, date, 'p1', { kind: 'hour', hour: '2pm' }, action, now);
    assert.equal(result.status, 'applied');
    assert.equal(result.loggedCreated, true);
    const slot = entries(journal, '2pm');
    assert.equal(slot.find((entry) => entry.entryMode === 'planned')?.planStatus, 'completed');
    assert.deepEqual(slot.find((entry) => entry.entryMode === 'planned')?.completedByLogRef, { date, hour: '2pm' });
    assert.equal(slot.filter((entry) => entry.entryMode === 'logged' && entry.taskId === 't1').length, 1);
    // Pressing again adds no second log.
    assert.equal(applyPlanActionInJournal(journal, date, 'p1', { kind: 'hour', hour: '2pm' }, action, now).loggedCreated, false);
    assert.equal(entries(journal, '2pm').filter((entry) => entry.entryMode === 'logged').length, 1);
  }
});

test('a task range plan logs the same range', () => {
  const journal = { ranges: [plan({ start: '1pm', end: '3pm' })] } as unknown as DayJournalWithRanges;
  const result = applyPlanActionInJournal(journal, date, 'p1', { kind: 'range', start: '1pm', end: '3pm' }, 'complete', now);
  assert.equal(result.loggedCreated, true);
  const logged = (journal.ranges ?? []).filter((range) => range.entryMode === 'logged');
  assert.equal(logged.length, 1);
  assert.deepEqual([logged[0].start, logged[0].end], ['1pm', '3pm']);
});

test('a plan that was replanned or cancelled is not acted on', () => {
  for (const planStatus of ['rescheduled', 'canceled'] as const) {
    const journal = { '2pm': plan({ planStatus }) } as unknown as DayJournalWithRanges;
    const result = applyPlanActionInJournal(journal, date, 'p1', { kind: 'hour', hour: '2pm' }, 'complete', now);
    assert.equal(result.status, 'not-actionable');
    assert.equal(entries(journal, '2pm')[0].planStatus, planStatus);
    assert.equal(entries(journal, '2pm').length, 1);
  }
});

test('a missed plan can still be done late', () => {
  const journal = { '9am': plan({ planStatus: 'missed', missedAt: now }) } as unknown as DayJournalWithRanges;
  assert.equal(applyPlanActionInJournal(journal, date, 'p1', { kind: 'hour', hour: '9am' }, 'complete', now).status, 'applied');
});
