// Sunrise's overdue forms: each keeps a place by the sun, clear of everything else drawn, on its subject's side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeLate, sunDistance, type LateBox, type LateRect, type LateStage } from '../src/lib/sunrise/late';

const stage: LateStage = { cx: 750, cy: 840, sunR: 80, bounds: { left: 10, top: 10, right: 1490, bottom: 834 }, gap: 12 };
const size = { width: 250, height: 54 };
const rect = (box: LateBox): LateRect => ({ left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height });
const apart = (a: LateRect, b: LateRect, gap: number) => a.left >= b.right + gap || a.right + gap <= b.left || a.top >= b.bottom + gap || a.bottom + gap <= b.top;
const side = (box: LateBox) => box.left + box.width / 2 - stage.cx;

test('with the sky empty it sits right by the sun, on its subject’s side', () => {
  const left = placeLate(size, 150, stage, [])!;
  const right = placeLate(size, 30, stage, [])!;
  const above = placeLate(size, 90, stage, [])!;
  for (const box of [left, right, above]) {
    assert.ok(sunDistance(box, stage) >= stage.gap, 'clear of the sun');
    assert.ok(sunDistance(box, stage) <= stage.gap + 30, `by the sun (${sunDistance(box, stage).toFixed(0)} px off)`);
    assert.ok(rect(box).bottom <= stage.bounds.bottom && rect(box).top >= stage.bounds.top, 'above the horizon');
  }
  assert.ok(side(left) < -40 && side(right) > 40, 'each on its own side');
  assert.ok(Math.abs(side(above)) < 40, 'a subject with no side stands over the sun');
});

test('it keeps clear of what is already drawn, and several overdue forms do not touch', () => {
  // Two forms on the ring nearest the sun, where it would otherwise go.
  const ring: LateRect[] = [{ left: 390, top: 757, right: 645, bottom: 812 }, { left: 620, top: 690, right: 880, bottom: 745 }];
  const taken = [...ring];
  const placed: LateBox[] = [];
  for (const angle of [150, 150, 40, 90]) {
    const box = placeLate(size, angle, stage, taken)!;
    assert.ok(box, 'there is room for each');
    for (const other of taken) assert.ok(apart(rect(box), other, stage.gap), 'it touches nothing');
    assert.ok(sunDistance(box, stage) <= 220, `still near the sun (${sunDistance(box, stage).toFixed(0)} px off)`);
    taken.push(rect(box));
    placed.push(box);
  }
  // The two that lean left are left of the sun, the one that leans right is right of it.
  assert.ok(side(placed[0]!) < 0 && side(placed[1]!) < 0 && side(placed[2]!) > 0);
});

test('it stays where it was while that place is free, and moves when something takes it', () => {
  const first = placeLate(size, 120, stage, [])!;
  // Something new appears elsewhere: it does not hop to a slightly better place.
  const nudged = { ...first, left: first.left + 18, top: first.top - 10 };
  assert.deepEqual(placeLate(size, 120, stage, [{ left: 1100, top: 300, right: 1300, bottom: 360 }], nudged), nudged);
  // A form lands on it: it moves clear.
  const moved = placeLate(size, 120, stage, [rect(first)], first)!;
  assert.ok(apart(rect(moved), rect(first), stage.gap));
  // Its size changed (the forms were drawn smaller): it is placed afresh.
  const smaller = placeLate({ width: 200, height: 44 }, 120, stage, [], first)!;
  assert.equal(smaller.width, 200);
});

test('with no free place within reach of the sun it has none', () => {
  const wall: LateRect[] = [{ left: -100, top: -100, right: 1600, bottom: 900 }];
  assert.equal(placeLate(size, 90, stage, wall), null);
  // A phone's narrow stage still finds one above the sun.
  const phone: LateStage = { cx: 195, cy: 740, sunR: 40, bounds: { left: 6, top: 200, right: 384, bottom: 734 }, gap: 8 };
  const bubble = placeLate({ width: 118, height: 46 }, 160, phone, [{ left: 140, top: 640, right: 260, bottom: 690 }])!;
  assert.ok(bubble && rect(bubble).right <= 384 && bubble.left >= 6);
});
