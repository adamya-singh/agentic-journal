// grow-layout.ts's placement of one structure in plain JavaScript. Every value is a whole or half pixel, so the
// program and this reference make the same choice and land on the same corner exactly.
import {spots} from './geometry.ts'

export type GrowBox = {left: number, top: number, right: number, bottom: number}
export type GrowInput = {
  bounds: GrowBox // where structures may go: between the edges, above the horizon, up into the pulled-back sky
  gap: number // what a structure keeps from everything else
  box: {width: number, height: number} // the structure's size, whole px
  anchor: {x: number, y: number, width: number, height: number} // what it's about: its centre and size, whole px
  current: {left: number, top: number} | null // where it is now, on a 1/2 px grid, if it has a place
  obstacles: GrowBox[] // home's pills, the sun and edges, the other structures and landmarks: whole px, at most 40
}
export type GrowPlacement = {left: number, top: number, spot: number, free: boolean, moved: boolean, overlapCount: number, outside: boolean}

export function growReference(input: GrowInput): GrowPlacement {
  const {bounds, gap, box, anchor, current} = input
  const obstacles = input.obstacles.slice(0, 40)
  const corner = (centre: number, extent: number, own: number, side: number) =>
    side > 0 ? centre + extent / 2 + gap : side < 0 ? centre - extent / 2 - gap - own : centre - own / 2
  const candidates = [
    {left: current?.left ?? 0, top: current?.top ?? 0, active: current !== null},
    ...spots.map(([sx, sy, ox, oy]) => ({
      left: corner(anchor.x, anchor.width, box.width, sx) + ox, top: corner(anchor.y, anchor.height, box.height, sy) + oy, active: true,
    })),
  ]
  const isInside = (left: number, top: number) =>
    left >= bounds.left && left + box.width <= bounds.right && top >= bounds.top && top + box.height <= bounds.bottom
  const hits = (left: number, top: number) => obstacles.filter(o =>
    left < o.right + gap && left + box.width + gap > o.left && top < o.bottom + gap && top + box.height + gap > o.top).length
  let spot = candidates.findIndex(c => c.active && isInside(c.left, c.top) && hits(c.left, c.top) === 0)
  const free = spot >= 0
  if (!free) spot = candidates.findIndex(c => c.active && isInside(c.left, c.top))
  if (spot < 0) spot = 1
  const {left, top} = candidates[spot]!
  return {left, top, spot, free, moved: spot !== 0, overlapCount: hits(left, top), outside: !isInside(left, top)}
}
