// What Horizon Dawn's layout is made of, shared by the program (layout.ts), its plain-JavaScript twin
// (layout-reference.ts) and the page: the rings, the fan, the candidate spots a pill may take, and the tables that
// stand in for cos and sin. Every number here sits on a power-of-two grid, so the program and the reference compute
// the same values exactly and make the same decisions.
//
// The drawing follows the Agentic Journal's src/components/horizon/dawn-svg.ts (DAWN.R, radiusFor, sectorsFor and
// place), in drawing units, where 1 unit is 1 px of the original 1200 × 560 drawing.

export const slotCount = 16
export const groupCount = 8
export const zoneCount = 4 // ignition, climb, altitude, orbit

// Ring radii, from the sun's edge out to Orbit's outer edge.
export const rings = [60, 172, 282, 382, 470] as const
// Where each zone's pills start (its ring plus a pad of 18) and how far they may move out with a later due time, so
// they keep 18 from the next ring.
export const zoneBase = [78, 190, 300, 400] as const
export const zoneWidth = [76, 74, 64, 52] as const
// The dailies ring around the sun, and how far pills keep from the sun with and without it.
export const dailyRadius = 69
export const coreWithDailies = 75
export const coreWithoutDailies = 68

// Angles are counted in ticks of 1/4 degree. The fan runs from 174 degrees (left) to 6 degrees (right), with 2 degrees
// between slices.
export const ticksPerDegree = 4
export const fanLeft = 174 * ticksPerDegree
export const fanTicks = (174 - 6) * ticksPerDegree
export const sectorGap = 2 * ticksPerDegree

// cos and sin at every half degree from -30 to 210 degrees, rounded to 1/2048. A candidate's angle is rounded to the
// nearest half degree and read from these tables.
export const trigGrid = 2 ** -11
export const trigFirstDegree = -30
export const trigStepsPerDegree = 2
export const trigLength = (210 - trigFirstDegree) * trigStepsPerDegree + 1
const roundToTrigGrid = (value: number) => Math.round(value / trigGrid) * trigGrid
export const cosTable = Array.from({length: trigLength}, (_, index) =>
  roundToTrigGrid(Math.cos((trigFirstDegree + index / trigStepsPerDegree) * Math.PI / 180)))
export const sinTable = Array.from({length: trigLength}, (_, index) =>
  roundToTrigGrid(Math.sin((trigFirstDegree + index / trigStepsPerDegree) * Math.PI / 180)))

// Orbit's distance grows with the log of the time past next week, as in dawn-svg.ts's radiusFor:
// 52 × log1p(days / 1) / log1p(60), capped at 1. Here it is piecewise linear in hours past Altitude's end, with
// breakpoints at powers of two, each breakpoint's offset rounded to 1/64 unit, so every slope is a multiple of 2^-15.
export const orbitBreaks = [0, 8, 16, 32, 64, 128, 256, 512, 1024, 1536] as const
export const orbitOffsets = orbitBreaks.map(hours =>
  Math.round(zoneWidth[3] * Math.min(1, Math.log1p(hours / 24) / Math.log1p(60)) * 64) / 64)
export const orbitSlopes = orbitBreaks.slice(1).map((end, index) =>
  (orbitOffsets[index + 1]! - orbitOffsets[index]!) / (end - orbitBreaks[index]!))

// The spots a pill tries, in order: [radius change in drawing units, fraction of its slice's half-width]. As in
// dawn-svg.ts, it slides along its slice first, at its own distance so the due-date order holds, then nudges in or
// out, then spills just past its slice. The first spot that's free wins.
export const candidates: readonly (readonly [dr: number, f: number])[] = [
  ...[0, 12, -12].flatMap(dr => [0, 0.375, -0.375, 0.75, -0.75].map(f => [dr, f] as const)),
  ...[24, -24].flatMap(dr => [0, 0.5, -0.5].map(f => [dr, f] as const)),
  [0, 1.25], [0, -1.25], [0, 1.75], [0, -1.75], [12, 1.25], [12, -1.25],
  [40, 0], [40, 0.5], [40, -0.5], [24, 2.5], [24, -2.5], [40, 1.75], [40, -1.75], [48, 2.5], [48, -2.5],
]
// A narrow slice still spreads its pills as if it were 16 degrees wide (in ticks: its width, twice its half-width).
export const minimumHalf2 = 16 * ticksPerDegree
// A pill's box around its centre: 5 px beside the pill, 16 above its centre and 30 below, for the date under it.
export const boxSide = 5
export const boxAbove = 16
export const boxBelow = 30
// How far every box keeps from the stage's edges and the horizon.
export const edgeMargin = 4

// Scales are counted in 1/1024.
export const scaleUnits = 1024
// The drawing is as wide as the original's 1200 units at most, and its outer ring leaves 90 px above it.
export const drawingWidth = 1200
export const headroom = 90
export const maximumScale = 1.5 * scaleUnits
// The sun never shrinks below 0.6 of its size, so it stays a target on a phone.
export const minimumSunScale = Math.round(0.6 * scaleUnits)
// Below this width the rings stretch upward into arches, so a phone's tall screen holds the fan.
export const archWidth = 700
export const maximumArch = 5 // the arch is at most 5 × as tall as it is wide

export const maximumViewport = 3072
export const maximumHours = 8760
export const maximumPillWidth = 400
export const maximumGroupWeight = 4

// The tie-breaker of the order: a heavier task goes first among those due at the same time, then the lower slot.
export const orderKey = (hours: number, weight: number) => hours * 4 * 8 + (7 - weight)

// grow-layout.ts: where a box may go around its anchor.
// The spots, as [side x, side y, slide x, slide y]: side -1/0/1 puts the box left of / centred on / right of the
// anchor (and above / centred / below it), each with the gap between them, then slid by whole px. Generated around
// the anchor in every direction and ordered by how far the box's centre lands from the anchor's for a typical card
// (280 × 180 beside a 150 × 30 pill), nearest first, ties to the right and up. Below is allowed but rarely free:
// home stands on the horizon.
type Spot = readonly [sx: number, sy: number, ox: number, oy: number]
const typical = {width: 280, height: 180, anchorWidth: 150, anchorHeight: 30, gap: 14}
const spotCentre = ([sx, sy, ox, oy]: Spot) => [
  sx * (typical.anchorWidth / 2 + typical.width / 2 + typical.gap) + ox,
  sy * (typical.anchorHeight / 2 + typical.height / 2 + typical.gap) + oy,
] as const
export const spots: readonly Spot[] = (() => {
  const all: Spot[] = []
  const sides = [[1, 0], [-1, 0], [0, -1], [1, -1], [-1, -1], [0, 1], [1, 1], [-1, 1]] as const
  const step = 64
  for (const [sx, sy] of sides) {
    // Up and diagonally up reach far, into the sky above home, sideways not quite as far, below barely (home stands
    // on the horizon).
    const reach = sy < 0 ? 12 : sy === 0 ? 8 : 1
    for (let out = 0; out <= reach; out++) {
      for (const slide of sy > 0 ? [0] : [0, -1, 1]) {
        // Outward along the side, and slid across it.
        const ox = sx * out * step + (sx === 0 ? slide * step : 0)
        const oy = sy * out * step + (sx === 0 ? 0 : slide * step)
        all.push([sx, sy, ox, oy])
      }
    }
  }
  const unique = new Map(all.map(spot => [spot.join(), spot]))
  // Nearest first: the space grows around home, into the sky above it and out past its edges.
  const distance = (spot: Spot) => { const [x, y] = spotCentre(spot); return Math.hypot(x, y) }
  return [...unique.values()].sort((a, b) => distance(a) - distance(b) || b[0] - a[0] || a[1] - b[1])
})()
