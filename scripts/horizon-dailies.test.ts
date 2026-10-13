import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildHorizon, fmtMinutes, shortenDaily } from '../src/lib/horizon';
import type { Task } from '../src/lib/types';

describe('Horizon dailies', () => {
  test('daily tasks ride the sun ring, not the zones, with today and the week checked off', () => {
    const now = new Date(2026, 9, 13, 10, 0);
    const haveToDo: Task[] = [
      { id: 'jobs', text: 'apply to jobs (5 apps or 30 minutes)', isDaily: true },
      { id: 'hw', text: '[Regression] Homework 3', dueDate: '2026-10-14' },
      { id: 'gym', text: 'work out for 10 minutes', isDaily: true },
    ];
    const wantToDo: Task[] = [{ id: 'cs336', text: 'do 30 minutes of karpathy videos or Stanford CS336', isDaily: true }];
    const week = [[], ['gym'], [], [], [], ['jobs', 'gym', 'cs336'], ['gym']];

    const data = buildHorizon({ haveToDo, wantToDo, currentHaveToDoIds: [], completed: [], dailyDoneByDay: week, now });

    assert.deepEqual(data.items.map((i) => i.id), ['hw']);
    assert.deepEqual(
      data.dailies.map((d) => [d.id, d.listType, d.short, d.minutes, d.done]),
      [
        ['jobs', 'have-to-do', 'Apply to jobs', 30, false],
        ['gym', 'have-to-do', 'Work out', 10, true],
        ['cs336', 'want-to-do', 'Karpathy videos…', 30, false],
      ],
    );
    assert.deepEqual(data.dailyWeek, [0, 1, 0, 0, 0, 3, 1]);
  });

  test('shortens daily task text and reads its length', () => {
    assert.deepEqual(shortenDaily('do 1 leetcode problem (1 hour)'), { short: '1 leetcode problem', minutes: 60 });
    assert.deepEqual(shortenDaily('work on aviro for 30 minutes'), { short: 'Work on aviro', minutes: 30 });
    assert.deepEqual(shortenDaily('stretch'), { short: 'Stretch', minutes: null });
    assert.equal(fmtMinutes(120), '2h');
    assert.equal(fmtMinutes(90), '1h 30m');
    assert.equal(fmtMinutes(40), '40m');
  });
});
