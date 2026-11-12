// grow-layout.ts's program against grow-layout-reference.ts: what sticky, incremental placement promises, then seeded
// random spaces. Every value is a whole or half pixel, so the two agree exactly.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {validateGrids} from '../src/lib/handwired/numeric-ui-core.ts'
import {type GrowBox, type GrowInput, growReference} from '../src/lib/sunrise/grow-layout-reference.ts'
import {createGrowLayout, obstacleCount, spots} from '../src/lib/sunrise/grow-layout.ts'

const layout = createGrowLayout()
function expectMatch(input: GrowInput) {
  const program = layout.run(input)
  assert.deepStrictEqual(program, growReference(input))
  return program
}
const space = {left: 0, top: -600, right: 1400, bottom: 830}
const pill = {x: 700, y: 400, width: 150, height: 30}
const boxOf = (left: number, top: number, width: number, height: number): GrowBox => ({left, top, right: left + width, bottom: top + height})
const base: GrowInput = {bounds: space, gap: 14, box: {width: 280, height: 180}, anchor: pill, current: null, obstacles: [boxOf(625, 385, 150, 30)]}

test('a new structure goes in the nearest free spot beside its anchor: above it, when that is free', () => {
  const placed = expectMatch(base)
  assert.deepStrictEqual(placed.free, true)
  assert.deepStrictEqual(spots[placed.spot - 1]!.slice(0, 2), [0, -1])
  assert.deepStrictEqual([placed.left, placed.top], [700 - 140, 400 - 15 - 14 - 180])
  // Something already above: it takes the next spot instead, still clear of both.
  const blocked = expectMatch({...base, obstacles: [...base.obstacles, boxOf(500, 150, 400, 230)]})
  assert.deepStrictEqual(blocked.free, true)
  assert.ok(blocked.spot > placed.spot)
  assert.deepStrictEqual(blocked.overlapCount, 0)
})

test('it is sticky: a structure keeps its place while that place is free, and moves only when it must', () => {
  const first = expectMatch(base)
  const stays = expectMatch({...base, current: {left: first.left, top: first.top}, obstacles: [...base.obstacles, boxOf(1000, 0, 200, 100)]})
  assert.deepStrictEqual([stays.spot, stays.moved, stays.left, stays.top], [0, false, first.left, first.top])
  // A landmark shrinks in place: a smaller box at the same corner stays too.
  assert.deepStrictEqual(expectMatch({...base, box: {width: 120, height: 32}, current: {left: first.left, top: first.top}}).moved, false)
  // Something new lands on it, or it grows into a neighbour: it moves, to the nearest free spot by its anchor.
  const moved = expectMatch({...base, current: {left: first.left, top: first.top}, obstacles: [...base.obstacles, boxOf(first.left + 40, first.top + 40, 100, 60)]})
  assert.deepStrictEqual(moved.moved, true)
  assert.deepStrictEqual(moved.free, true)
})

test('it stays inside the space, and says so when nothing is free', () => {
  // The anchor near the right edge: the spot right of it is outside, so it goes elsewhere.
  const edge = expectMatch({...base, anchor: {x: 1350, y: 400, width: 80, height: 30}, obstacles: [boxOf(1310, 385, 80, 30), boxOf(1000, 0, 400, 380)]})
  assert.deepStrictEqual(edge.free, true)
  assert.ok(edge.left + 280 <= 1400)
  // Everything full: the fallback is inside the space, and the self-check counts what it covers.
  const full = expectMatch({...base, obstacles: [boxOf(-50, -700, 1500, 1600)]})
  assert.deepStrictEqual(full.free, false)
  assert.deepStrictEqual(full.overlapCount, 1)
  assert.deepStrictEqual(full.outside, false)
})

test('matches the reference on 2,000 seeded random spaces, and keeps its grid promises', {timeout: 60_000}, () => {
  let seed = 31
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
  const integer = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))
  let free = 0
  for (let trial = 0; trial < 2000; trial++) {
    const input: GrowInput = {
      bounds: {left: integer(-200, 100), top: integer(-1200, 0), right: integer(600, 2600), bottom: integer(400, 1600)},
      gap: integer(0, 40),
      box: {width: integer(60, 480), height: integer(24, 360)},
      anchor: {x: integer(-100, 2000), y: integer(-600, 1400), width: integer(0, 260), height: integer(0, 60)},
      current: random() < 0.5 ? null : {left: integer(-400, 2000) + (random() < 0.5 ? 0.5 : 0), top: integer(-1000, 1200) + (random() < 0.5 ? 0.5 : 0)},
      obstacles: Array.from({length: integer(0, obstacleCount)}, () => boxOf(integer(-200, 2400), integer(-1000, 1400), integer(4, 400), integer(4, 260))),
    }
    if (expectMatch(input).free) free += 1
    if (trial % 200 === 0) validateGrids(layout.built.circuit, layout.built.circuit.evaluateReference(layout.write(input)))
  }
  // Both outcomes are exercised.
  assert.ok(free > 200)
  assert.ok(free < 1900)
})
