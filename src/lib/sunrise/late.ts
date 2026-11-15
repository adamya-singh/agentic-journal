// Where an overdue task's form sits in Sunrise's sky. It is on no ring (its time has come), and it does not go away:
// it takes the free place nearest the sun, on its subject's side when there is one, and stays there until it is done
// or let go. Pure: the engine gives the sun, the stage and what is already drawn; this gives the form its box.

export type LateRect = {left: number, top: number, right: number, bottom: number}
export type LateBox = {left: number, top: number, width: number, height: number}
export interface LateStage {
  cx: number, cy: number // the sun's centre, on the horizon
  sunR: number // the sun as drawn, with its dailies, in px
  bounds: LateRect // where a form may be: inside the stage's edges, above the horizon
  gap: number // what a form keeps from the sun and from everything else drawn
}

const radians = Math.PI / 180
// How far out it looks, and how fine the places it tries are.
const reach = 420, radiusStep = 8, angleStep = 3
// A place one degree off its subject's direction is worth this many px further from the sun.
const perDegree = 1.2
// It stays where it was unless another free place is this much better: forms do not hop about as the sky changes.
const stay = 40

const rect = (box: LateBox): LateRect => ({left: box.left, top: box.top, right: box.left + box.width, bottom: box.top + box.height})

/** How far a box is from the sun's edge, in px (0 when it touches or covers it). */
export function sunDistance(box: LateBox, stage: Pick<LateStage, 'cx' | 'cy' | 'sunR'>): number {
  const {left, top, right, bottom} = rect(box)
  const dx = Math.max(left - stage.cx, 0, stage.cx - right), dy = Math.max(top - stage.cy, 0, stage.cy - bottom)
  return Math.max(0, Math.hypot(dx, dy) - stage.sunR)
}

/**
 * The box for one overdue form of this size: the free place nearest the sun, leaning toward `angle` (degrees, 180
 * left to 0 right, its subject's direction). `taken` is everything it must keep clear of (the forms on the rings,
 * the corners, the overdue forms placed before it). `was` is where it is now: it stays there while that is still
 * free and nearly as good. null when there is no free place within reach of the sun.
 */
export function placeLate(size: {width: number, height: number}, angle: number, stage: LateStage, taken: readonly LateRect[], was: LateBox | null = null): LateBox | null {
  const {cx, cy, sunR, bounds, gap} = stage
  const width = Math.round(size.width), height = Math.round(size.height)
  const free = (box: LateBox) => {
    const own = rect(box)
    if (own.left < bounds.left || own.right > bounds.right || own.top < bounds.top || own.bottom > bounds.bottom) return false
    if (sunDistance(box, stage) < gap) return false
    return taken.every(other => own.left >= other.right + gap || own.right + gap <= other.left || own.top >= other.bottom + gap || own.bottom + gap <= other.top)
  }
  const cost = (box: LateBox) => {
    const x = box.left + box.width / 2 - cx, y = cy - (box.top + box.height / 2)
    return sunDistance(box, stage) + Math.abs(Math.atan2(y, x) / radians - angle) * perDegree
  }
  let best: {box: LateBox, cost: number} | null = null
  for (let r = sunR + gap; r <= sunR + gap + reach; r += radiusStep) {
    for (let a = angleStep; a < 180; a += angleStep) {
      const box = {left: Math.round(cx + r * Math.cos(a * radians) - width / 2), top: Math.round(cy - r * Math.sin(a * radians) - height / 2), width, height}
      if (!free(box)) continue
      const worth = cost(box)
      if (best === null || worth < best.cost - 1e-9) best = {box, cost: worth}
    }
  }
  if (was !== null && Math.round(was.width) === width && Math.round(was.height) === height) {
    const kept = {left: Math.round(was.left), top: Math.round(was.top), width, height}
    if (free(kept) && (best === null || cost(kept) <= best.cost + stay)) return kept
  }
  return best?.box ?? null
}
