// Where the tasks that have no form of their own sit in Sunrise's sky, so that every open task is drawn in it.
// The rings hold the soonest sixteen as forms, the outer rings sixteen more, and under the sun the top of each
// section. Everything else is a mote: a small light with its name beside it, pressed to open like a form.
// - late: overdue. Its time has set, so it lies on the horizon, on its subject's side of the sun, further out the
//   longer it has been due (a day by the sun, three months at Orbit's edge).
// - nodate: a have-to-do task with no date. It is on no ring: a star past the last one, over its subject's slice.
// - far: a dated task the rings had no room for, at its own distance and in its subject's slice.
// - want: a want-to-do task past the top of its section, deeper under the sun in that section's slice, in the order
//   of his queue.
// Stars and wants take cells of a lattice around the rings (level rows, each cell wide enough for a name), so no two
// names touch. Pure: the engine gives the stage, this gives every mote its point in world px.
import {rings} from './geometry.ts'

export type MoteKind = 'late' | 'nodate' | 'far' | 'want'
export interface MoteItem {
  id: string
  kind: MoteKind
  name: string // short, beside the light
  title: string // in full, with why it is where it is, for the tooltip
  group: string // its subject (a slice above the horizon) or its section (a slice under the sun)
  hours: number // until due; negative when overdue; 0 for what has no date
  wide?: boolean // a group of tasks, named with how many it holds: its name needs a run of cells (wideCells)
}
export interface Slice { name: string, a0: number, a1: number } // degrees, a0 the left edge (the larger angle)
export interface MoteStage {
  cx: number, cy: number // the sun's centre, on the horizon
  kx: number, ky: number // today's rings: px per ring unit across and up
  core: number // the sun with its dailies, in px from its centre: nothing lies nearer than this
  outerR: number, outerRy: number // the last outer ring's radius across and up; 0 when the outer rings are not drawn
  underK: number, underKy: number // the rings under the sun: px per ring unit across and down; 0 when not drawn
  underPush: number // how far the rings under the sun are pushed past the ground's strip
  sectors: Slice[] // today's slices, one per subject on the rings
  tracks: Slice[] // the sections' slices under the sun
}
export interface MotePoint { x: number, y: number }

export const moteCell = {width: 150, row: 22} as const // a cell holds a light and its name
// A group's name stays readable pulled far back, where it is drawn up to 2.6 times its size: it has this many cells
// of its row to itself, and the engine's styles cut the name to fit them.
export const wideCells = 4
const fanLeft = 174, fanRight = 6
const radians = Math.PI / 180

// A subject with no slice of its own still has a steady direction: its name decides it.
function steadyAngle(name: string): number {
  let hash = 7
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 9973
  return 24 + hash % 133 // 24 to 156 degrees
}

/**
 * The cells past radius `from` (an ellipse `tall` times as high as wide): a lattice of rows a name high, each cut
 * into cells a name wide, every other row set half a cell over. A cell is one only if its whole name clears the
 * rings, so names are level, never touch, and wrap around the dome.
 */
class Grid {
  private readonly cells: {x: number, y: number, r: number, angle: number, taken: boolean, key: string}[] = []
  private readonly byKey = new Map<string, Grid['cells'][number]>()
  private readonly from: number
  constructor(from: number, tall: number, depth: number) {
    this.from = from
    const reach = from + depth
    const radius = (x: number, y: number) => Math.hypot(x, y / tall)
    for (let row = 0; row * moteCell.row <= reach * tall; row++) {
      const y = row * moteCell.row + 10
      for (let column = -Math.ceil(reach / moteCell.width) - 1; column * moteCell.width <= reach; column++) {
        const x = (column + (row % 2 === 0 ? 0 : 0.5)) * moteCell.width
        // The light, the middle of its name and the name's end are all past the rings.
        const r = Math.min(radius(x - 8, y), radius(x + moteCell.width / 2, y), radius(x + moteCell.width - 14, y))
        const angle = Math.atan2(y / tall, x + moteCell.width / 2 - 12) / radians
        if (r < from || radius(x, y) > reach || angle < fanRight || angle > fanLeft) continue
        const cell = {x, y, r: radius(x, y), angle, taken: false, key: `${row}:${column}`}
        this.cells.push(cell)
        this.byKey.set(cell.key, cell)
      }
    }
    this.cells.sort((a, b) => a.r - b.r)
  }
  /**
   * The free cell that costs least for a mote that belongs between `a0` and `a1` (degrees): the nearest to the
   * rings inside its slice, filling from the left, then the nearest outside it. x runs right and y away from the
   * horizon, both from the sun. A wide mote takes the cells to its right as well (wideCells in all), for its name.
   */
  take(a0: number, a1: number, wide = false): {x: number, y: number} | null {
    let best: {cell: Grid['cells'][number], cost: number} | null = null
    // The cells a wide mote's name runs over, to the right of its own; null when one is missing (the rings are there) or taken.
    const run = (cell: Grid['cells'][number]) => {
      const [row, column] = cell.key.split(':')
      const cells: Grid['cells'][number][] = []
      for (let step = 1; step < wideCells; step++) {
        const next = this.byKey.get(`${row}:${Number(column) + step}`)
        if (next === undefined || next.taken) return null
        cells.push(next)
      }
      return cells
    }
    for (const cell of this.cells) {
      const base = (cell.r - this.from) * 3
      if (best !== null && base >= best.cost) break // sorted by radius: nothing further out can cost less
      if (cell.taken) continue
      if (wide && run(cell) === null) continue
      const outside = cell.angle > a0 ? cell.angle - a0 : cell.angle < a1 ? a1 - cell.angle : 0
      // Outside its slice costs four times the way along the arc; inside, a little for each cell from the left.
      const cost = base + outside * radians * cell.r * 4 + (outside > 0 ? 0 : (a0 - cell.angle) * radians * cell.r * 0.02)
      if (best === null || cost < best.cost) best = {cell, cost}
    }
    if (best === null) return wide ? this.take(a0, a1) : null
    best.cell.taken = true
    if (wide) {
      for (const cell of run(best.cell)!) cell.taken = true
      // Pulled far back a group's name is drawn larger than its row: the free cells right above and below it stay empty.
      const [row, column] = best.cell.key.split(':').map(Number) as [number, number]
      for (const dr of [-1, 1]) for (let dc = -1; dc <= wideCells; dc++) {
        const near = this.byKey.get(`${row + dr}:${column + dc}`)
        if (near !== undefined && near.x > best.cell.x - moteCell.width && near.x < best.cell.x + wideCells * moteCell.width) near.taken = true
      }
    }
    return {x: best.cell.x, y: best.cell.y}
  }
}

/**
 * How far from the sun something overdue lies, as a share of the way from the sun's edge to Orbit's: a day is by
 * the sun, ninety and more at Orbit's edge.
 */
export function lateThrough(hoursOver: number): number {
  const days = Math.max(0, hoursOver) / 24
  return Math.min(1, Math.log1p(days) / Math.log1p(90))
}

const farDays = [30, 90, 365] as const

/** Every mote's point in world px. A kind whose part of the sky is not drawn now (no outer rings, nothing under the sun) gets none. */
export function placeMotes(items: readonly MoteItem[], stage: MoteStage): Map<string, MotePoint> {
  const out = new Map<string, MotePoint>()
  const {cx, cy, kx, ky} = stage
  const sliceOf = (slices: Slice[], name: string) => slices.find(slice => slice.name === name)

  // ---- Overdue, along the horizon.
  const sides: {id: string, r: number}[][] = [[], []] // left, right
  for (const item of items.filter(each => each.kind === 'late').sort((a, b) => b.hours - a.hours)) {
    const slice = sliceOf(stage.sectors, item.group)
    const mid = slice === undefined ? null : (slice.a0 + slice.a1) / 2
    const side = mid === null ? (sides[0]!.length <= sides[1]!.length ? 0 : 1) : mid > 90 ? 0 : 1
    const from = stage.core + 12
    sides[side]!.push({id: item.id, r: from + lateThrough(-item.hours) * Math.max(0, rings[4] * kx - from)})
  }
  sides.forEach((side, index) => {
    side.sort((a, b) => a.r - b.r)
    let last = -Infinity
    for (const mote of side) {
      // No two lights on top of each other: one that would be is a light's width further out.
      const r = Math.max(mote.r, last + 13)
      last = r
      out.set(mote.id, {x: cx + (index === 0 ? -r : r), y: cy - 1})
    }
  })

  // ---- No date, and dated tasks the rings had no room for: past the outer rings and on them.
  if (stage.outerR > 0) {
    const tall = stage.outerRy / stage.outerR // 1 on a wide screen; a phone's rings stand taller than wide
    const outerK = (stage.outerR - rings[4] * kx - 40) / (rings[4] - rings[0])
    const far = items.filter(each => each.kind === 'far')
    far.forEach((item, index) => {
      const days = Math.max(0, item.hours) / 24
      const slice = sliceOf(stage.sectors, item.group)
      const mid = slice === undefined ? steadyAngle(item.group) : (slice.a0 + slice.a1) / 2
      const angle = Math.max(fanRight + 2, Math.min(fanLeft - 2, mid + ((index % 5) - 2) * 2.5)) * radians
      if (days <= 14) {
        // It belongs on today's rings, which were full: at its own distance, between the forms.
        const r = rings[0] + 18 + (rings[4] - rings[0] - 18) * Math.pow(days / 14, 0.6)
        out.set(item.id, {x: cx + r * kx * Math.cos(angle), y: cy - r * ky * Math.sin(angle)})
        return
      }
      const band = days <= farDays[0] ? 0 : days <= farDays[1] ? 1 : days <= farDays[2] ? 2 : 3
      const from = band === 0 ? 14 : farDays[band - 1]!
      const through = band === 3 ? Math.min(1, (days - from) / 365) : (days - from) / (farDays[band]! - from)
      const r = rings[4] * kx + 40 + (rings[band]! + through * (rings[band + 1]! - rings[band]!) - rings[0]) * outerK
      out.set(item.id, {x: cx + r * Math.cos(angle), y: cy - r * tall * Math.sin(angle)})
    })
    const stars = items.filter(each => each.kind === 'nodate')
    const grid = new Grid(stage.outerR + 46, tall, 900)
    // Subjects with a slice first, in the slices' order, so each fills the cells over its own slice.
    const order = (item: MoteItem) => { const index = stage.sectors.findIndex(slice => slice.name === item.group); return index < 0 ? stage.sectors.length : index }
    for (const item of [...stars].sort((a, b) => order(a) - order(b))) {
      const slice = sliceOf(stage.sectors, item.group)
      const at = slice === undefined ? {a0: steadyAngle(item.group) + 6, a1: steadyAngle(item.group) - 6} : slice
      const cell = grid.take(at.a0, at.a1)
      if (cell !== null) out.set(item.id, {x: cx + cell.x, y: cy - cell.y})
    }
  }

  // ---- Wants, deeper under the sun than the forms.
  if (stage.underK > 0) {
    const edge = rings[4] * stage.underK + stage.underPush
    const tall = (rings[4] * stage.underKy + stage.underPush) / edge
    const grid = new Grid(edge + 38, tall, 1100)
    const wants = items.filter(each => each.kind === 'want')
    const order = (item: MoteItem) => { const index = stage.tracks.findIndex(slice => slice.name === item.group); return index < 0 ? stage.tracks.length : index }
    // Stable: within a section the order stays his queue's.
    for (const item of wants.map((each, index) => ({each, index})).sort((a, b) => order(a.each) - order(b.each) || a.index - b.index).map(({each}) => each)) {
      const slice = sliceOf(stage.tracks, item.group)
      const at = slice === undefined ? {a0: steadyAngle(item.group) + 6, a1: steadyAngle(item.group) - 6} : slice
      const cell = grid.take(at.a0, at.a1, item.wide === true)
      if (cell !== null) out.set(item.id, {x: cx + cell.x, y: cy + cell.y})
    }
  }
  return out
}
