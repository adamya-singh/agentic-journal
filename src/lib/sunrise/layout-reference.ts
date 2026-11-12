// layout.ts's Horizon Dawn layout in plain JavaScript, in float64. Every value it computes is a multiple of a power of
// two small enough for FP32 to hold exactly, so layout.test.ts can ask the program for the same decisions (scales,
// slice boundaries, radii, order, the spot each pill takes) and the same coordinates, exactly.
import {
  candidates, coreWithDailies, coreWithoutDailies, cosTable, drawingWidth, edgeMargin, fanLeft, fanTicks, groupCount,
  headroom, maximumArch, minimumHalf2, maximumScale, minimumSunScale, orbitBreaks, orbitSlopes, orderKey, rings, scaleUnits,
  sectorGap, sinTable, archWidth, boxAbove, boxBelow, boxSide, trigFirstDegree, trigLength, trigStepsPerDegree,
  zoneBase, zoneWidth,
} from './geometry.ts'

export type DawnSlot = {
  visible: boolean
  zone: number // 0 ignition, 1 climb, 2 altitude, 3 orbit
  hours: number // until due, on a 1/4 hour grid
  group: number // the slice, 0 = leftmost
  width: number // the pill's width in px, text and padding, a whole number
  weight: number // 1 to 5, as horizon.ts's weightFor
}
export type DawnInput = {
  viewportWidth: number
  horizonY: number // the horizon's y in px: the sun's centre
  topLeft: {width: number, height: number} // the headline's corner, which pills keep out of
  topRight: {width: number, height: number} // the intent line's corner
  climb: number // hours to next Monday, as HorizonData.bounds
  altitude: number // hours to the Monday after
  dailies: boolean // whether the sun wears its ring of dailies
  groupWeights: number[] // the intent: one weight per slice, 0 to 4 on a 1/16 grid, 0 hides the slice
  slots: DawnSlot[]
}
export type DawnSector = {shown: boolean, a0: number, a1: number, mid: number} // degrees
export type DawnPill = {
  visible: boolean, x: number, y: number, rank: number, radius: number, candidate: number, free: boolean, inside: boolean,
}
export type DawnLayout = {
  kx: number, ky: number, sunScale: number, centerX: number, core: number
  sectors: DawnSector[]
  pills: DawnPill[]
  overlapCount: number, outsideCount: number, unplacedCount: number
}

// Math.round, but a value halfway between two whole numbers goes to the even one, as FP32 addition rounds.
export function roundHalfEven(value: number) {
  const floor = Math.floor(value)
  const fraction = value - floor
  if (fraction > 0.5) return floor + 1
  if (fraction < 0.5) return floor
  return floor % 2 === 0 ? floor : floor + 1
}
const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value))

type Box = [left: number, top: number, right: number, bottom: number]
const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]

export function dawnScales(input: DawnInput) {
  const {viewportWidth, horizonY} = input
  const fitWidth = Math.floor(viewportWidth * scaleUnits / drawingWidth)
  const fitHeight = Math.floor(Math.max(0, horizonY - headroom) * scaleUnits / rings[4])
  const kx = Math.max(1, Math.min(fitWidth, fitHeight, maximumScale))
  // On a narrow screen, the rings stretch up into the room under the corners, up to 3 × as tall as wide.
  const top = Math.max(input.topLeft.height, input.topRight.height)
  const archFit = Math.floor(Math.max(0, horizonY - top - 30) * scaleUnits / rings[4])
  const ky = viewportWidth < archWidth ? Math.max(kx, Math.min(archFit, maximumArch * kx)) : kx
  return {kx, ky, sunScale: Math.max(kx, minimumSunScale)}
}

// The slices, as dawn-svg.ts's sectorsFor: in group order from the left, each as wide as its count of pills (at least
// 1.25), times the intent's weight. Boundaries are whole ticks, rounded down from the exact share.
export function dawnSectors(input: DawnInput) {
  const counts = Array.from({length: groupCount}, (_, group) =>
    input.slots.filter(slot => slot.visible && slot.group === group).length)
  const shown = counts.map((count, group) => count >= 1 && input.groupWeights[group]! > 0)
  const weights = counts.map((count, group) => shown[group]! ? Math.max(1.25, count) * input.groupWeights[group]! : 0)
  const total = weights.reduce((a, b) => a + b, 0)
  const shownCount = shown.filter(Boolean).length
  const span = fanTicks - sectorGap * Math.max(0, shownCount - 1)
  let cumulative = 0
  const bounds = [0]
  for (const weight of weights) {
    cumulative += weight
    bounds.push(total > 0 ? Math.floor(span * cumulative / total) : 0)
  }
  let gaps = 0
  return shown.map((isShown, group) => {
    const a0 = fanLeft - bounds[group]! - gaps
    const a1 = fanLeft - bounds[group + 1]! - gaps
    if (isShown) gaps += sectorGap
    return {shown: isShown, a0, a1, mid2: a0 + a1, half2: a0 - a1}
  })
}

// A pill's distance from the sun in drawing units, a whole number, as dawn-svg.ts's radiusFor: each zone fills its
// ring, later inside the ring is farther out, and Orbit spreads by the log of the time past next week.
export function dawnRadius(slot: DawnSlot, climb: number, altitude: number) {
  if (slot.zone === 3) {
    const past = clamp(slot.hours - altitude, 0, orbitBreaks[orbitBreaks.length - 1]!)
    let offset = 0
    orbitSlopes.forEach((slope, index) => {
      offset += slope * clamp(past - orbitBreaks[index]!, 0, orbitBreaks[index + 1]! - orbitBreaks[index]!)
    })
    return zoneBase[3] + Math.floor(offset)
  }
  const low = [0, 48, Math.max(48, climb)][slot.zone]!
  const high = [Math.min(48, climb), climb, altitude][slot.zone]!
  const span = Math.max(4, high - low)
  // The slope in units per hour, rounded down to 1/4096.
  const slope = Math.floor(zoneWidth[slot.zone]! * 4096 / span) / 4096
  return zoneBase[slot.zone]! + Math.floor(clamp(slot.hours - low, 0, span) * slope)
}

export function layoutReference(input: DawnInput): DawnLayout {
  const {viewportWidth, horizonY} = input
  const {kx, ky, sunScale} = dawnScales(input)
  const centerX = viewportWidth / 2
  const core = roundHalfEven((input.dailies ? coreWithDailies : coreWithoutDailies) * sunScale / scaleUnits)
  const sectors = dawnSectors(input)
  const fixed: Box[] = [
    [centerX - core, horizonY - core, centerX + core, horizonY],
    [0, 0, input.topLeft.width, input.topLeft.height],
    [viewportWidth - input.topRight.width, 0, viewportWidth, input.topRight.height],
  ]
  const radii = input.slots.map(slot => dawnRadius(slot, input.climb, input.altitude))
  const keys = input.slots.map(slot => orderKey(slot.hours, slot.weight))
  // A pill shows when the host says so and the intent keeps its slice.
  const order = input.slots.map((slot, index) => ({slot, index})).filter(({slot}) => slot.visible && sectors[slot.group]!.shown)
    .sort((a, b) => keys[a.index]! - keys[b.index]! || a.index - b.index)

  const placed: Box[] = []
  const pills: DawnPill[] = input.slots.map(() =>
    ({visible: false, x: 0, y: 0, rank: 0, radius: 0, candidate: 0, free: false, inside: false}))
  order.forEach(({slot, index}, rank) => {
    const sector = sectors[slot.group]!
    const spots = candidates.map(([dr, f]) => {
      const step = roundHalfEven((sector.mid2 + f * Math.max(sector.half2, minimumHalf2)) / 4) - trigFirstDegree * trigStepsPerDegree
      const at = clamp(step, 0, trigLength - 1)
      const u = roundHalfEven(kx * (radii[index]! + dr) / scaleUnits) * cosTable[at]!
      const v = roundHalfEven(ky * (radii[index]! + dr) / scaleUnits) * sinTable[at]!
      const x = centerX + u
      const y = horizonY - v
      const box: Box = [x - slot.width / 2 - boxSide, y - boxAbove, x + slot.width / 2 + boxSide, y + boxBelow]
      const inside = box[0] >= edgeMargin && box[2] <= viewportWidth - edgeMargin && box[1] >= edgeMargin && box[3] <= horizonY - edgeMargin
      const free = inside && !fixed.some(other => overlaps(box, other)) && !placed.some(other => overlaps(box, other))
      return {x, y, box, inside, free}
    })
    // The first free spot; failing that, the first inside the stage; failing that, the first.
    let candidate = spots.findIndex(spot => spot.free)
    if (candidate < 0) candidate = Math.max(0, spots.findIndex(spot => spot.inside))
    const spot = spots[candidate]!
    placed.push(spot.box)
    pills[index] = {visible: true, x: spot.x, y: spot.y, rank, radius: radii[index]!, candidate, free: spot.free, inside: spot.inside}
  })

  // The checks the program makes of its own result.
  const boxes = pills.map((pill, index): Box => {
    const half = input.slots[index]!.width / 2 + boxSide
    return [pill.x - half, pill.y - boxAbove, pill.x + half, pill.y + boxBelow]
  })
  let overlapCount = 0
  pills.forEach((pill, a) => {
    if (!pill.visible) return
    overlapCount += fixed.filter(other => overlaps(boxes[a]!, other)).length
    for (let b = a + 1; b < pills.length; b++) if (pills[b]!.visible && overlaps(boxes[a]!, boxes[b]!)) overlapCount += 1
  })
  return {
    kx: kx / scaleUnits, ky: ky / scaleUnits, sunScale: sunScale / scaleUnits, centerX, core,
    sectors: sectors.map(sector => ({
      shown: sector.shown, a0: sector.a0 / 4, a1: sector.a1 / 4, mid: sector.mid2 / 8,
    })),
    pills,
    overlapCount,
    outsideCount: pills.filter(pill => pill.visible && !pill.inside).length,
    unplacedCount: pills.filter(pill => pill.visible && !pill.free).length,
  }
}
