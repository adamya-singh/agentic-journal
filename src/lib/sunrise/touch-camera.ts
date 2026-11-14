// Touch on Sunrise's sky (engine.ts): one finger moves the camera, two pinch it about the point between them. The
// camera for where the fingers are now is a pure function of where they were when the gesture started, the camera
// then, and where they are now. It is not clamped here: the engine keeps the camera inside what is drawn.
export type Point = {x: number, y: number}
/** The camera: the world drawn at `z` times its size, moved by x and y px. */
export type View = {z: number, x: number, y: number}
/** A gesture from where it (re)started: the fingers it follows (the first one or two down), where they were, and the camera then. */
export type TouchGesture = {ids: number[], from: Point[], view: View}
export type Tap = {at: number, point: Point}

/** How far a finger may move, in px, and still be a tap. */
export const tapSlop = 8
/** Two taps this close in time (ms) and place (px) are a double tap. */
export const doubleTapMs = 300
export const doubleTapSlop = 24

export const isTap = (from: Point, to: Point) => Math.hypot(to.x - from.x, to.y - from.y) <= tapSlop
export const isDoubleTap = (first: Tap | null, second: Tap) =>
  first !== null && second.at - first.at <= doubleTapMs && Math.hypot(second.point.x - first.point.x, second.point.y - first.point.y) <= doubleTapSlop

const firstTwo = (points: ReadonlyMap<number, Point>) => [...points.keys()].slice(0, 2)

/**
 * Starts a gesture on the first two fingers down (a third is ignored), from the camera as it is now. A finger that
 * lands or lifts mid-gesture starts it again this way, so the camera picks up where it is and nothing jumps.
 */
export function touchGesture(points: ReadonlyMap<number, Point>, view: View): TouchGesture {
  const ids = firstTwo(points)
  return {ids, from: ids.map(id => ({...points.get(id)!})), view: {...view}}
}

/** Whether the fingers down are no longer the ones the gesture follows, so it must start again. */
export function needsRestart(gesture: TouchGesture, points: ReadonlyMap<number, Point>) {
  const ids = firstTwo(points)
  return ids.length !== gesture.ids.length || ids.some((id, index) => id !== gesture.ids[index])
}

/**
 * The camera for where the fingers are now. One finger moves it by its own travel. Two scale it by how far apart they
 * are now against then, and the world point that was under their midpoint stays under it. `z`, when given, is the
 * scale to use instead (the engine's clamp and snap), still about the midpoint.
 */
export function touchView(gesture: TouchGesture, points: ReadonlyMap<number, Point>, z?: number): View {
  const {view, from} = gesture
  const now = gesture.ids.map(id => points.get(id))
  const [a0, b0] = from
  const [a, b] = now
  if (a0 === undefined || a === undefined || now.some(point => point === undefined)) return {...view}
  if (b0 === undefined || b === undefined) return {z: view.z, x: view.x + a.x - a0.x, y: view.y + a.y - a0.y}
  const apart0 = Math.hypot(b0.x - a0.x, b0.y - a0.y)
  const apart = Math.hypot(b.x - a.x, b.y - a.y)
  // Two fingers that landed on one spot have no distance to compare: they only move the camera.
  const scale = z ?? (apart0 < 1 ? view.z : view.z * apart / apart0)
  const k = scale / view.z
  const m0 = {x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2}
  const m = {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2}
  return {z: scale, x: m.x - (m0.x - view.x) * k, y: m.y - (m0.y - view.y) * k}
}
