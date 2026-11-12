import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { buildHorizon, type HorizonData, type HorizonItem } from '../src/lib/horizon';
import { DAILY_R, DAWN, dawnLayout, pullLayout, type PillSpot } from '../src/components/horizon/dawn-svg';
import type { Task } from '../src/lib/types';

// Roughly Geist at 13px, so pill widths look like the real ones.
const measure = (text: string, weight: number) => text.length * (weight >= 600 ? 7.6 : 7.1);

// What a viewer sees of a pill: the pill itself and the date under it, drawn independently of the layout's own boxes.
type Rect = [number, number, number, number];
function drawn(sp: PillSpot): Rect[] {
  const s = sp.s ?? 1, w = (measure(sp.item.short, sp.item.weight >= 4 ? 600 : 500) + 24) * s, dw = sp.item.day.length * 6.3 * s;
  return [[sp.x - w / 2, sp.y - 14 * s, sp.x + w / 2, sp.y + 14 * s], [sp.x - dw / 2, sp.y + 16 * s, sp.x + dw / 2, sp.y + 28 * s]];
}
const hit = (a: Rect, b: Rect) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

function assertClear(spots: PillSpot[], hidden: HorizonItem[], all: HorizonItem[], data: HorizonData, label: string) {
  assert.deepEqual([...spots.map((s) => s.item.id), ...hidden.map((i) => i.id)].sort(), all.map((i) => i.id).sort(), `${label}: every task placed or held back once`);
  const core = data.dailies.length ? DAILY_R + 6 : DAWN.R[0] + 8;
  const rects = spots.map(drawn);
  rects.forEach((rs, i) => {
    rs.forEach((r) => {
      assert.ok(r[0] >= 0 && r[2] <= DAWN.W && r[1] >= 0 && r[3] <= DAWN.H, `${label}: ${spots[i].item.short} stays on the sky`);
      assert.ok(!hit(r, [DAWN.X - core, DAWN.H - core, DAWN.X + core, DAWN.H]), `${label}: ${spots[i].item.short} stays off the sun`);
    });
    for (let j = i + 1; j < rects.length; j += 1) {
      assert.ok(!rs.some((a) => rects[j].some((b) => hit(a, b))), `${label}: ${spots[i].item.short} overlaps ${spots[j].item.short}`);
    }
  });
}

function rng(seed: number) {
  return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
}

const COURSES = ['Info Viz', 'Regression', 'Stat Learning', 'Data Context', 'Operating Systems', 'Algorithms', 'Linear Algebra', 'Ethics'];
const WORDS = ['Tableau', 'Essential', 'Training', 'Hypothesis', 'Tufte', 'Midterm', 'Exam', 'Homework', 'Peer', 'Feedback', 'Show & Tell', 'Roadrunner', 'intro', 'chat', 'Read', 'Chapter', 'Part 2', 'Lab', 'Project', 'Quiz', 'Reflection', 'Call', 'Guppa', 'Interview'];

function randomHorizon(seed: number, n: number): HorizonData {
  const r = rng(seed);
  const now = new Date(2026, 9, 1 + Math.floor(r() * 28), Math.floor(r() * 24), Math.floor(r() * 60));
  const nCourses = 1 + Math.floor(r() * COURSES.length);
  const task = (i: number): Task => {
    const words = Array.from({ length: 1 + Math.floor(r() * 5) }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
    const tag = r() < 0.75 ? `[${COURSES[Math.floor(r() * nCourses)]}] ` : '';
    // Bunch due dates on a few days, as real weeks do, so many tasks want the very same spot.
    const days = r() < 0.5 ? Math.floor(r() * 3) : Math.floor(r() * 90);
    const due = new Date(now.getTime() + days * 864e5);
    const iso = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
    return { id: `t${i}`, text: `${tag}${words}`, dueDate: iso, ...(r() < 0.6 ? { dueTimeStart: '23:59' } : {}) };
  };
  const haveToDo = Array.from({ length: n }, (_, i) => task(i));
  const wantToDo = Array.from({ length: Math.floor(r() * 4) }, (_, i) => ({ ...task(n + i), id: `w${i}` }));
  if (r() < 0.6) haveToDo.push({ id: 'd1', text: 'work out for 10 minutes', isDaily: true });
  return buildHorizon({ haveToDo, wantToDo, currentHaveToDoIds: [], completed: [], now });
}

describe('Horizon Dawn layout', () => {
  test('tasks due at the same minute in the same slice never cover each other (bf_678ee0ff)', () => {
    // Oct 18: Regression HW3, the Hypothesis and Tableau Essential Training all due 23:59 that night.
    const now = new Date(2026, 9, 18, 17, 30);
    const haveToDo: Task[] = [
      { id: 'reg', text: '[Regression] Homework 3 - MLR, Model Building, Variable Selection', dueDate: '2026-10-18', dueTimeStart: '23:59' },
      { id: 'hyp', text: '[Info Viz] Hypothesis - Tufte Visual Explanations', dueDate: '2026-10-18', dueTimeStart: '23:59' },
      { id: 'tab', text: '[Info Viz] Tableau Essential Training - Chapter/Part 2 & 3', dueDate: '2026-10-18', dueTimeStart: '23:59' },
      { id: 'gup', text: 'Call Guppa', dueDate: '2026-10-19' },
      { id: 'sl', text: '[Stat Learning] Midterm Exam', dueDate: '2026-10-26', dueTimeStart: '14:00' },
      { id: 'dc', text: '[Data Context] Peer Feedback on Final Project', dueDate: '2026-10-30' },
      { id: 'job', text: 'Roadrunner intro chat with recruiter', dueDate: '2026-10-22', dueTimeStart: '10:00' },
      { id: 'd1', text: 'work out for 10 minutes', isDaily: true },
    ];
    const data = buildHorizon({ haveToDo, wantToDo: [], currentHaveToDoIds: [], completed: [], now });
    const today = dawnLayout(data, measure);
    assert.deepEqual(today.hidden, []);
    assertClear(today.spots, today.hidden, data.items, data, 'Oct 18');
    const out = pullLayout(data, measure);
    assertClear(out.spots, out.hidden, data.items.concat(data.further), data, 'Oct 18 pulled back');
  });

  test('no two pills intersect for many random task sets, at rest and pulled back', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const n = 1 + (seed * 7919) % 40;
      const data = randomHorizon(seed, n);
      const today = dawnLayout(data, measure);
      assertClear(today.spots, today.hidden, data.items, data, `seed ${seed}`);
      const out = pullLayout(data, measure);
      assertClear(out.spots, out.hidden, data.items.concat(data.further), data, `seed ${seed} pulled back`);
      // A realistic load always fits: nothing is held back.
      if (data.items.length <= 30) assert.deepEqual(today.hidden.map((i) => i.short), [], `seed ${seed}: all ${data.items.length} fit`);
      if (data.items.length + data.further.length <= 30) assert.deepEqual(out.hidden.map((i) => i.short), [], `seed ${seed} pulled: all fit`);
    }
  });

  test('a crowd too big for the sky shrinks and holds the rest back instead of stacking them', () => {
    const data = randomHorizon(42, 160);
    const today = dawnLayout(data, measure);
    assertClear(today.spots, today.hidden, data.items, data, 'crowd');
    assert.ok(today.spots.length > 40, `placed ${today.spots.length}`);
    assert.ok(today.spots.every((s) => (s.s ?? 1) < 1), 'pills shrink when crowded');
    const out = pullLayout(data, measure);
    assertClear(out.spots, out.hidden, data.items.concat(data.further), data, 'crowd pulled back');
  });

  test('an uncrowded sky keeps pills full size on their own ring and slice', () => {
    const data = randomHorizon(7, 3);
    const today = dawnLayout(data, measure);
    assert.ok(today.spots.every((s) => s.s === undefined));
  });
});
