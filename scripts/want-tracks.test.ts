import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHorizon } from '../src/lib/horizon';
import { PERMANENT_TRACKS, readWantTracks, trackFor, trackOrder } from '../src/lib/want-tracks';
import type { Task } from '../src/lib/types';

const now = new Date(2026, 10, 13, 12, 0);
const tracks = readWantTracks({ tracks: [{ name: 'level up', projects: ['Stanford-CS336', 'so-arm-101'] }, { name: 'Recharge', projects: ['ps4-homebrew'] }, { name: 'Made up', projects: ['x'] }] });

test('the two permanent sections are always there, with the projects the file lists for them', () => {
  assert.deepEqual(readWantTracks(null).map((t) => [t.name, t.projects]), [['Recharge', []], ['Level Up', []]]);
  assert.deepEqual(tracks.map((t) => [t.name, t.projects]), [['Recharge', ['ps4-homebrew']], ['Level Up', ['stanford-cs336', 'so-arm-101']]]);
});

test('a task is in a section by its bracket label, then by its projects, else Life', () => {
  assert.equal(trackFor({}, 'Level Up', tracks), 'Level Up');
  assert.equal(trackFor({}, 'fun', tracks), 'Recharge');
  assert.equal(trackFor({ projects: ['so-arm-101'] }, '', tracks), 'Level Up');
  assert.equal(trackFor({ projects: ['openclaw'] }, '', tracks), 'Life');
  assert.equal(trackFor({ projects: ['so-arm-101'] }, 'Reading', tracks), 'Reading');
  assert.deepEqual(trackOrder(['Life', 'Reading', 'Level Up'], PERMANENT_TRACKS), ['Recharge', 'Level Up', 'Reading', 'Life']);
});

test('under the sun: undated want-to-do tasks by section, the top of his queue first, a turn for each section', () => {
  const want = (id: string, text: string, extra: Partial<Task> = {}): Task => ({ id, text, ...extra });
  const wantToDo = [
    ...Array.from({ length: 20 }, (_, i) => want(`cs${i}`, `CS336 step ${i}`, { projects: ['stanford-cs336'] })),
    want('poster', 'Get a poster'),
    want('games', '[Recharge] Make PS4 games'),
    want('dated', 'Go to Bryant Park', { dueDate: '2026-11-20' }),
    want('daily', 'Karpathy videos', { isDaily: true }),
    want('done', 'Old thing', { completed: true }),
  ];
  const data = buildHorizon({ haveToDo: [], wantToDo, currentHaveToDoIds: [], currentWantToDoIds: ['cs7'], wantTracks: tracks, completed: [], now });
  assert.deepEqual(data.wantTracks.map((t) => [t.name, t.open, t.permanent]), [['Recharge', 1, true], ['Level Up', 20, true], ['Life', 1, false]]);
  assert.equal(data.wants.length, 12);
  assert.deepEqual(data.wants.slice(0, 4).map((w) => [w.id, w.track]), [['games', 'Recharge'], ['cs7', 'Level Up'], ['poster', 'Life'], ['cs0', 'Level Up']]);
  assert.ok(!data.wants.some((w) => ['dated', 'daily', 'done'].includes(w.id)));
  assert.ok(data.items.some((i) => i.id === 'dated'), 'a dated want-to-do task stays on the rings above');
  // Each section's tray lists every open task in it, not only the ones drawn, in queue order.
  assert.deepEqual(Object.keys(data.wantsBySection), ['Recharge', 'Level Up', 'Life']);
  assert.deepEqual(data.wantsBySection['Level Up']!.map((w) => w.id), ['cs7', ...Array.from({ length: 20 }, (_, i) => `cs${i}`).filter((id) => id !== 'cs7')]);
  assert.deepEqual(data.wantsBySection['Recharge']!.map((w) => [w.id, w.short, w.track]), [['games', 'Make PS4 games', 'Recharge']]);
  assert.deepEqual(data.wantsBySection['Life']!.map((w) => w.id), ['poster']);
});

test("a section's tray list is capped, and its count is still every open task", () => {
  const wantToDo: Task[] = Array.from({ length: 75 }, (_, i) => ({ id: `lu${i}`, text: `[Level Up] Paper ${i}` }));
  const data = buildHorizon({ haveToDo: [], wantToDo, currentHaveToDoIds: [], currentWantToDoIds: ['lu70', 'lu3'], wantTracks: tracks, completed: [], now });
  assert.equal(data.wantTracks.find((t) => t.name === 'Level Up')?.open, 75);
  assert.equal(data.wantsBySection['Level Up']!.length, 60);
  assert.deepEqual(data.wantsBySection['Level Up']!.slice(0, 3).map((w) => w.id), ['lu70', 'lu3', 'lu0']);
});

test('a permanent section with nothing in it is still listed', () => {
  const data = buildHorizon({ haveToDo: [], wantToDo: [], currentHaveToDoIds: [], completed: [], now });
  assert.deepEqual(data.wantTracks.map((t) => [t.name, t.open]), [['Recharge', 0], ['Level Up', 0]]);
  assert.deepEqual(data.wants, []);
  assert.deepEqual(data.wantsBySection, { Recharge: [], 'Level Up': [] });
});
