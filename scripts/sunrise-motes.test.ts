// Sunrise's motes: every open task with no form of its own still has a place in the sky, and no two names touch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHorizon } from '../src/lib/horizon';
import { rings } from '../src/lib/sunrise/geometry';
import { lateThrough, moteCell, placeMotes, type MoteItem, type MoteStage } from '../src/lib/sunrise/motes';

const stage: MoteStage = {
  cx: 700, cy: 800, kx: 1.1, ky: 1.1, core: 80,
  outerR: 1100, outerRy: 1100, underK: 1.1, underKy: 1.1, underPush: 64,
  sectors: [{ name: 'Data Context', a0: 174, a1: 120 }, { name: 'Regression', a0: 118, a1: 60 }, { name: 'Other', a0: 58, a1: 6 }],
  tracks: [{ name: 'Recharge', a0: 174, a1: 130 }, { name: 'Level Up', a0: 128, a1: 50 }, { name: 'Life', a0: 48, a1: 6 }],
};
const mote = (id: string, kind: MoteItem['kind'], group: string, hours = 0): MoteItem => ({ id, kind, name: id, title: id, group, hours });
const angleOf = (p: { x: number; y: number }, below = false) => Math.atan2(below ? p.y - stage.cy : stage.cy - p.y, p.x - stage.cx) * 180 / Math.PI;
const radiusOf = (p: { x: number; y: number }) => Math.hypot(p.x - stage.cx, p.y - stage.cy);

test('what is overdue lies on the horizon, on its subject’s side, further out the longer it has been due', () => {
  const items = [mote('day', 'late', 'Data Context', -20), mote('week', 'late', 'Data Context', -8 * 24), mote('months', 'late', 'Data Context', -70 * 24), mote('right', 'late', 'Other', -3 * 24)];
  const at = placeMotes(items, stage);
  for (const id of ['day', 'week', 'months', 'right']) assert.equal(at.get(id)!.y, stage.cy - 1, id);
  // Data Context's slice is left of the sun, Other's right of it.
  assert.ok(at.get('day')!.x < stage.cx && at.get('right')!.x > stage.cx);
  assert.ok(at.get('day')!.x > at.get('week')!.x && at.get('week')!.x > at.get('months')!.x, 'later is further from the sun');
  // Nothing lies on the sun, or past Orbit's edge.
  assert.ok(stage.cx - at.get('day')!.x > stage.core);
  assert.ok(stage.cx - at.get('months')!.x <= rings[4] * stage.kx + 1);
  assert.ok(lateThrough(0) === 0 && lateThrough(24 * 400) === 1);
  // Many due the same day do not pile onto one point.
  const same = placeMotes(Array.from({ length: 12 }, (_, i) => mote(`s${i}`, 'late', 'Data Context', -30 * 24)), stage);
  const xs = [...same.values()].map((p) => p.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) assert.ok(xs[i] - xs[i - 1] >= 13 - 1e-6);
});

test('tasks with no date are stars past the last ring, over their subject’s slice, and no two names touch', () => {
  const items = [
    ...Array.from({ length: 40 }, (_, i) => mote(`other${i}`, 'nodate', 'Other')),
    ...Array.from({ length: 5 }, (_, i) => mote(`data${i}`, 'nodate', 'Data Context')),
    mote('lone', 'nodate', 'A subject with no slice'),
  ];
  const at = placeMotes(items, stage);
  assert.equal(at.size, items.length, 'every one has a place');
  for (const [id, p] of at) {
    assert.ok(p.y < stage.cy, `${id} is above the horizon`);
    assert.ok(radiusOf(p) >= stage.outerR + 30, `${id} is past the last ring`);
  }
  // A subject's first stars stand over its own slice.
  assert.ok(angleOf(at.get('data0')!) > 118 && angleOf(at.get('other0')!) < 60);
  // Names run to the right of their lights: on one row two lights are a name apart, and rows are a name's height apart.
  const points = [...at.values()];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const dx = Math.abs(points[i].x - points[j].x), dy = Math.abs(points[i].y - points[j].y);
    assert.ok(dy >= moteCell.row - 1e-6 || dx >= moteCell.width - 1e-6, `stars ${i} and ${j} would overlap`);
  }
  // The same tasks land in the same places.
  assert.deepEqual([...placeMotes(items, stage)], [...at]);
});

test('the rest of each section sits deeper under the sun, in its slice, in the order of the queue', () => {
  const items = [
    ...Array.from({ length: 100 }, (_, i) => mote(`up${i}`, 'want', 'Level Up')),
    ...Array.from({ length: 30 }, (_, i) => mote(`life${i}`, 'want', 'Life')),
  ];
  const at = placeMotes(items, stage);
  assert.equal(at.size, 130);
  const edge = rings[4] * stage.underK + stage.underPush;
  for (const [id, p] of at) {
    assert.ok(p.y > stage.cy, `${id} is under the horizon`);
    assert.ok(radiusOf(p) >= edge + 30, `${id} is deeper than the forms`);
  }
  // The top of the queue is nearest the forms; the bottom is furthest down.
  assert.ok(radiusOf(at.get('up0')!) < radiusOf(at.get('up99')!));
  const life = angleOf(at.get('life0')!, true);
  assert.ok(life < 50, `Life's first is in its slice (${life.toFixed(0)}°)`);
  const points = [...at.values()];
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const dx = Math.abs(points[i].x - points[j].x), dy = Math.abs(points[i].y - points[j].y);
    assert.ok(dy >= moteCell.row - 1e-6 || dx >= moteCell.width - 1e-6);
  }
});

test('a part of the sky that is not drawn holds no motes, and a dated task with no form keeps its distance', () => {
  const items = [mote('star', 'nodate', 'Other'), mote('want', 'want', 'Life'), mote('late', 'late', 'Other', -48), mote('soon', 'far', 'Regression', 5 * 24), mote('year', 'far', 'Regression', 200 * 24)];
  const bare = placeMotes(items, { ...stage, outerR: 0, outerRy: 0, underK: 0, underKy: 0 });
  assert.deepEqual([...bare.keys()], ['late']);
  const at = placeMotes(items, stage);
  assert.equal(at.size, 5);
  // Due this week: inside today's rings. Due in most of a year: out on the outer rings, short of the stars.
  assert.ok(radiusOf(at.get('soon')!) < rings[4] * stage.kx);
  assert.ok(radiusOf(at.get('year')!) > rings[4] * stage.kx + 40 && radiusOf(at.get('year')!) < stage.outerR);
  assert.ok(Math.abs(angleOf(at.get('soon')!) - 89) < 12, 'in its subject’s slice');
});

test('an undated task carries its subject, so its star has a slice to stand over', () => {
  const data = buildHorizon({
    haveToDo: [{ id: 'a', text: '[Data Context] Read the syllabus' }, { id: 'b', text: 'Call the bank' }],
    wantToDo: [], completed: [], currentHaveToDoIds: ['a'], dailies: [], now: new Date(2026, 10, 15, 12, 0),
  } as unknown as Parameters<typeof buildHorizon>[0]);
  assert.deepEqual(data.undated.map((u) => [u.id, u.group]), [['a', 'Data Context']]);
  assert.deepEqual(data.undatedRest.map((u) => [u.id, u.group]), [['b', 'Other']]);
});

test('a group of tasks takes two cells, so its longer name is clear of the next light', () => {
  const items = [
    { ...mote('group', 'want', 'Level Up'), wide: true },
    ...Array.from({ length: 60 }, (_, i) => mote(`w${i}`, 'want', 'Level Up')),
  ];
  const at = placeMotes(items, stage);
  assert.equal(at.size, 61);
  const group = at.get('group')!;
  for (const [id, p] of at) {
    if (id === 'group' || Math.abs(p.y - group.y) > 1e-6) continue
    assert.ok(p.x < group.x - moteCell.width + 1e-6 || p.x >= group.x + 2 * moteCell.width - 1e-6, `${id} sits in the group's name`);
  }
  // It is where the section's first task would be: nearest the forms.
  assert.ok(radiusOf(group) <= Math.min(...[...at].filter(([id]) => id !== 'group').map(([, p]) => radiusOf(p))) + moteCell.width);
});

test('a want carries the project it is filed under, which is what a group is made from', () => {
  const data = buildHorizon({
    haveToDo: [], completed: [], currentHaveToDoIds: [], dailies: [], now: new Date(2026, 10, 15, 12, 0),
    wantToDo: [{ id: 'a', text: 'A1 tokenizer pass 1', projects: ['stanford-cs336-summer'] }, { id: 'b', text: 'Visit cursor cafe' }],
  } as unknown as Parameters<typeof buildHorizon>[0]);
  const all = Object.values(data.wantsBySection).flat();
  assert.equal(all.find((w) => w.id === 'a')?.project, 'stanford-cs336-summer');
  assert.equal('project' in all.find((w) => w.id === 'b')!, false);
});
