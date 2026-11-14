// touch-camera.ts: what a finger or two on Sunrise's sky does to the camera, and what still counts as a tap.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {isDoubleTap, isTap, needsRestart, type Point, tapSlop, touchGesture, touchView, type View} from '../src/lib/sunrise/touch-camera.ts'

const fingers = (...points: [number, Point][]) => new Map(points)
// Where a world point is drawn on the stage, and the world point under a stage point.
const toStage = (view: View, world: Point) => ({x: world.x * view.z + view.x, y: world.y * view.z + view.y})
const toWorld = (view: View, stage: Point) => ({x: (stage.x - view.x) / view.z, y: (stage.y - view.y) / view.z})
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`)

test('one finger moves the camera by its own travel, at any zoom, and keeps the zoom', () => {
  const view = {z: 1.5, x: -40, y: 25}
  const gesture = touchGesture(fingers([1, {x: 100, y: 200}]), view)
  assert.deepStrictEqual(touchView(gesture, fingers([1, {x: 130, y: 150}])), {z: 1.5, x: -10, y: -25})
  // Back where it started is the camera it started with.
  assert.deepStrictEqual(touchView(gesture, fingers([1, {x: 100, y: 200}])), view)
})

test('two fingers scale by how far apart they are, and the world point under their midpoint stays under it', () => {
  const view = {z: 1, x: 0, y: 0}
  const a0 = {x: 100, y: 300}, b0 = {x: 200, y: 300}
  const gesture = touchGesture(fingers([1, a0], [2, b0]), view)
  const under = toWorld(view, {x: 150, y: 300})
  // Spread to twice as far apart and moved: twice the zoom, the same world point under the new midpoint.
  const a = {x: 60, y: 420}, b = {x: 260, y: 420}
  const next = touchView(gesture, fingers([1, a], [2, b]))
  close(next.z, 2)
  const seen = toStage(next, under)
  close(seen.x, 160)
  close(seen.y, 420)
  // A clamped scale is still about the midpoint.
  const held = touchView(gesture, fingers([1, a], [2, b]), 1.25)
  close(held.z, 1.25)
  close(toStage(held, under).x, 160)
  close(toStage(held, under).y, 420)
  // Pinched in from a zoomed, moved camera.
  const zoomed = {z: 2.4, x: -310, y: -120}
  const from = touchGesture(fingers([7, {x: 50, y: 50}], [9, {x: 250, y: 250}]), zoomed)
  const point = toWorld(zoomed, {x: 150, y: 150})
  const pinched = touchView(from, fingers([7, {x: 120, y: 90}], [9, {x: 170, y: 140}]))
  close(pinched.z, 0.6)
  close(toStage(pinched, point).x, 145)
  close(toStage(pinched, point).y, 115)
})

test('a finger that lands or lifts mid-gesture starts it again from the camera as it is, with no jump', () => {
  const one = touchGesture(fingers([1, {x: 100, y: 100}]), {z: 1, x: 0, y: 0})
  const moved = touchView(one, fingers([1, {x: 140, y: 80}]))
  // A second finger lands: the fingers are no longer the gesture's, and restarting from here changes nothing.
  const two = fingers([1, {x: 140, y: 80}], [2, {x: 240, y: 180}])
  assert.equal(needsRestart(one, two), true)
  const pinch = touchGesture(two, moved)
  assert.deepStrictEqual(pinch.ids, [1, 2])
  assert.deepStrictEqual(touchView(pinch, two), moved)
  const spread = touchView(pinch, fingers([1, {x: 90, y: 30}], [2, {x: 290, y: 230}]))
  close(spread.z, 2)
  // A third finger is ignored.
  assert.equal(needsRestart(pinch, fingers([1, {x: 90, y: 30}], [2, {x: 290, y: 230}], [3, {x: 10, y: 10}])), false)
  // The first finger lifts: the one left goes on from the camera as it is.
  const left = fingers([2, {x: 290, y: 230}])
  assert.equal(needsRestart(pinch, left), true)
  const again = touchGesture(left, spread)
  assert.deepStrictEqual(touchView(again, left), spread)
  assert.deepStrictEqual(touchView(again, fingers([2, {x: 300, y: 200}])), {z: spread.z, x: spread.x + 10, y: spread.y - 30})
  // Two fingers on one spot only move it.
  const stuck = touchGesture(fingers([1, {x: 5, y: 5}], [2, {x: 5, y: 5}]), {z: 1.3, x: 0, y: 0})
  assert.deepStrictEqual(touchView(stuck, fingers([1, {x: 15, y: 5}], [2, {x: 15, y: 5}])), {z: 1.3, x: 10, y: 0})
})

test('a finger that stays within 8 px is a tap; two taps close in time and place are a double tap', () => {
  assert.equal(tapSlop, 8)
  assert.equal(isTap({x: 10, y: 10}, {x: 10, y: 10}), true)
  assert.equal(isTap({x: 10, y: 10}, {x: 18, y: 10}), true)
  assert.equal(isTap({x: 10, y: 10}, {x: 16, y: 16}), false)
  assert.equal(isTap({x: 10, y: 10}, {x: 10, y: 19}), false)
  const first = {at: 1000, point: {x: 100, y: 100}}
  assert.equal(isDoubleTap(null, first), false)
  assert.equal(isDoubleTap(first, {at: 1250, point: {x: 110, y: 115}}), true)
  assert.equal(isDoubleTap(first, {at: 1350, point: {x: 100, y: 100}}), false)
  assert.equal(isDoubleTap(first, {at: 1100, point: {x: 130, y: 100}}), false)
})
