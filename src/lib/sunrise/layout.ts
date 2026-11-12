// Horizon Dawn's layout as one numeric program. The host writes the stage (viewport width, the horizon's y, the two
// corner boxes), the week's bounds, one weight per slice from the intent, and per pill its zone, hours until due,
// slice, width and weight. The program returns the slices' angles and every pill's x and y. layout-reference.ts is the
// same layout in plain JavaScript, and layout.test.ts compares the two.
//
// It keeps what the Agentic Journal's dawn-svg.ts means (geometry.ts has the numbers):
// - Slices: one per group, in a fixed order from the left, as wide as its pill count (at least 1.25) times the
//   intent's weight. A weight of 0 folds the slice away and hides its pills.
// - Distance: each zone fills its ring, later is farther out; Orbit spreads by a piecewise-linear log.
// - Placement: most urgent first, each pill takes the first of 36 candidate spots that stays on the stage and clear of
//   the sun, the two corners and every pill placed before it.
// - Self-checks: the overlaps and the pills outside the stage in the final result, counted again from the outputs.
//
// Exactness. Every decision compares numbers on power-of-two grids, so each comparison is 2 operations and FP32 holds
// every value exactly: pixel offsets are multiples of 1/2048 (the trig tables' grid times whole-pixel radii), radii
// and slice boundaries are whole numbers, made so by rounding with (x + 1.5 × 2^23) - 1.5 × 2^23 or by long division.
import {type Circuit, type Wire, emitCompare} from '../handwired/numeric-ui-core.ts'
import {emitStageScales, makeKit} from './kit.ts'
import {createEvaluator, createSourceTable, input, list} from '../handwired/cells.ts'
import {
  boxAbove, boxBelow, boxSide, candidates, coreWithDailies, coreWithoutDailies, cosTable,
  edgeMargin, fanLeft, fanTicks, groupCount, maximumArch, maximumGroupWeight, maximumHours,
  maximumPillWidth, maximumScale, maximumViewport, minimumHalf2, orbitBreaks, orbitSlopes, rings,
  scaleUnits, sectorGap, sinTable, slotCount, trigFirstDegree, trigGrid, trigStepsPerDegree, zoneBase, zoneCount,
  zoneWidth,
} from './geometry.ts'
import type {DawnInput, DawnLayout} from './layout-reference.ts'

// Every input sits on a grid, bits included: a bit declared with inputBit has none, and every comparison built from
// it would cost a 15-operation sign cascade instead of 2 operations.
export const dawnCells = {
  viewportWidth: input([200, maximumViewport], {initial: 1400, grid: 1}),
  horizonY: input([200, maximumViewport], {initial: 830, grid: 1}),
  topLeft: {width: input([0, maximumViewport], {grid: 1}), height: input([0, maximumViewport], {grid: 1})},
  topRight: {width: input([0, maximumViewport], {grid: 1}), height: input([0, maximumViewport], {grid: 1})},
  climb: input([0, 240], {initial: 156, grid: 1 / 4}),
  altitude: input([0, 420], {initial: 324, grid: 1 / 4}),
  dailies: input([0, 1], {grid: 1}),
  groupWeights: list(groupCount, () => input([0, maximumGroupWeight], {initial: 1, grid: 1 / 16})),
  slots: list(slotCount, () => ({
    visible: input([0, 1], {grid: 1}),
    zone: input([0, zoneCount - 1], {grid: 1}),
    hours: input([0, maximumHours], {grid: 1 / 4}),
    group: input([0, groupCount - 1], {grid: 1}),
    width: input([0, maximumPillWidth], {grid: 1}),
    weight: input([1, 5], {initial: 1, grid: 1}),
  })),
}

export function buildDawnLayout() {
  const table = createSourceTable()
  const cells = table.declare(dawnCells)
  const circuit: Circuit = table.createCircuit()
  const kit = makeKit(circuit)
  const {constant, zero, exact, affine, relu, bit, all, multiply, atLeast, oneHot, round, floor, longDivide, minimum, maximum, overlap} = kit

  const {viewportWidth, horizonY, topLeft, topRight, climb, altitude, dailies, groupWeights, slots} = cells

  const {kx, ky, sunScale} = emitStageScales(circuit, kit, {viewportWidth, horizonY, topLeft, topRight})
  // JS: core = round((dailies ? 75 : 68) × sunScale / 1024)
  const core = round(affine([
    [sunScale, coreWithoutDailies / scaleUnits],
    [multiply(dailies, sunScale, [0, maximumScale], 1), (coreWithDailies - coreWithoutDailies) / scaleUnits],
  ], 0, [0, coreWithDailies * maximumScale / scaleUnits], 1 / scaleUnits), 0, Math.ceil(coreWithDailies * maximumScale / scaleUnits))

  // ---- Slices. JS: count, shown and weight per group, then cumulative boundaries in whole ticks.
  const groupOf = slots.map(slot => oneHot(slot.group, groupCount))
  const counts = groupWeights.map((_, group) => affine(slots.map((slot, index) => [all(slot.visible, groupOf[index]![group]!), 1]), 0, [0, slotCount], 1))
  const shown = groupWeights.map((weight, group) => all(atLeast(counts[group]!, 1), atLeast(weight, 1 / 16)))
  const weights = groupWeights.map((weight, group) => {
    const count = counts[group]!
    // JS: shown ? Math.max(1.25, count) × weight : 0
    const atLeastOneAndAQuarter = affine([[count, 1], [relu([[count, -1]], 1.25, [0, 1.25], 1 / 4), 1]], 0, [1.25, slotCount], 1 / 4)
    const base = multiply(shown[group]!, atLeastOneAndAQuarter, [0, slotCount], 1 / 4)
    return multiply(base, weight, [0, slotCount * maximumGroupWeight], 1 / 64)
  })
  const totalMaximum = (slotCount + 1.25 * groupCount) * maximumGroupWeight
  const cumulative = weights.map((_, group) => affine(weights.slice(0, group + 1).map(weight => [weight, 1]), 0, [0, totalMaximum], 1 / 64))
  const total = cumulative[groupCount - 1]!
  const shownCount = affine(shown.map(wire => [wire, 1]), 0, [0, groupCount], 1)
  const anyShown = atLeast(shownCount, 1)
  // JS: span = 672 - 8 × max(0, shownCount - 1)
  const span = affine([[relu([[shownCount, 1]], -1, [0, groupCount - 1], 1), -sectorGap]], fanTicks, [fanTicks - sectorGap * (groupCount - 1), fanTicks], 1)
  const denominator = affine([[total, 64], [anyShown, -1]], 1, [1, totalMaximum * 64], 1) // JS: max(total × 64, 1)
  const bounds: Wire[] = [zero]
  for (let group = 0; group < groupCount - 1; group++) {
    const share = multiply(span, cumulative[group]!, [0, fanTicks * totalMaximum], 1 / 64)
    const numerator = affine([[share, 64]], 0, [0, fanTicks * totalMaximum * 64], 1)
    bounds.push(longDivide(numerator, denominator, 10, fanTicks * totalMaximum * 64, totalMaximum * 64))
  }
  bounds.push(multiply(anyShown, span, [0, fanTicks], 1))
  const sectors = groupWeights.map((_, group) => {
    // JS: gaps = 8 × number of shown slices to the left
    const gapTerms = shown.slice(0, group).map((wire): [Wire, number] => [wire, -sectorGap])
    const a0 = affine([[bounds[group]!, -1], ...gapTerms], fanLeft, [fanLeft - fanTicks - sectorGap * groupCount, fanLeft], 1)
    const a1 = affine([[bounds[group + 1]!, -1], ...gapTerms], fanLeft, [fanLeft - fanTicks - sectorGap * groupCount, fanLeft], 1)
    const mid2 = affine([[a0, 1], [a1, 1]], 0, [-200, 2 * fanLeft], 1)
    const half2 = affine([[a0, 1], [a1, -1]], 0, [0, fanTicks], 1)
    // A narrow slice spreads its pills as if it were 16 degrees wide.
    const spread2 = affine([[relu([[half2, 1]], -minimumHalf2, [0, fanTicks], 1), 1]], minimumHalf2, [minimumHalf2, fanTicks], 1)
    return {shown: shown[group]!, a0, a1, mid2, spread2}
  })

  // ---- Per pill: shown, its slice's middle and spread, its radius and its order key.
  const visible = slots.map((slot, index) =>
    all(slot.visible, affine(groupOf[index]!.map((isGroup, group) => [all(isGroup, shown[group]!), 1]), 0, [0, 1], 1)))
  const pick = (index: number, values: Wire[], range: [number, number], grid: number) =>
    affine(groupOf[index]!.map((isGroup, group) => [multiply(isGroup, values[group]!, range, grid), 1]), 0, range, grid)
  const mid2s = slots.map((_, index) => pick(index, sectors.map(sector => sector.mid2), [-200, 2 * fanLeft], 1))
  const spread2s = slots.map((_, index) => pick(index, sectors.map(sector => sector.spread2), [0, fanTicks], 1))

  // Each linear zone's slope in units per hour, rounded down to 1/4096. JS: floor(width × 4096 / max(4, high - low))
  const low = [zero, constant(48), maximum(constant(48), climb)]
  const high = [minimum(constant(48), climb), climb, altitude]
  const spans = [0, 1, 2].map(zone => {
    const difference = affine([[high[zone]!, 1], [low[zone]!, -1]], 0, [-240, 420], 1 / 4)
    return affine([[relu([[difference, 1]], -4, [0, 420], 1 / 4), 1]], 4, [4, 424], 1 / 4)
  })
  const slopes = spans.map((spanHours, zone) => {
    const slope = longDivide(constant(zoneWidth[zone]! * 4096 * 4), affine([[spanHours, 4]], 0, [16, 1696], 1), 17, zoneWidth[zone]! * 4096 * 4, 1696)
    return affine([[slope, 1 / 4096]], 0, [0, zoneWidth[zone]! / 4 + 1], 1 / 4096)
  })
  const orbitEnd = orbitBreaks[orbitBreaks.length - 1]!
  const radii = slots.map(slot => {
    const zoneIs = oneHot(slot.zone, zoneCount)
    const lowHere = affine([[zoneIs[1]!, 48], [multiply(zoneIs[2]!, low[2]!, [0, 240], 1 / 4), 1]], 0, [0, 240], 1 / 4)
    const spanHere = affine(spans.map((wire, zone): [Wire, number] => [multiply(zoneIs[zone]!, wire, [0, 424], 1 / 4), 1]), 0, [0, 424], 1 / 4)
    const slopeHere = affine(slopes.map((wire, zone): [Wire, number] => [multiply(zoneIs[zone]!, wire, [0, 20], 1 / 4096), 1]), 0, [0, 20], 1 / 4096)
    // JS: min(max(hours - low, 0), span)
    const past = relu([[slot.hours, 1], [lowHere, -1]], 0, [0, maximumHours], 1 / 4)
    const clamped = affine([[spanHere, 1], [relu([[spanHere, 1], [past, -1]], 0, [0, 424], 1 / 4), -1]], 0, [0, 424], 1 / 4)
    // The product is at most the zone's width, since clamped ≤ span and slope ≤ width / span.
    const linear = floor(multiply(clamped, slopeHere, [0, zoneWidth[0]], 2 ** -14), 2 ** -14, 0, zoneWidth[0])
    // Orbit: JS: sum over segments of slope × min(max(pastAltitude - start, 0), length), bias first, so every partial
    // sum stays within 0..52 and nothing rounds.
    const pastAltitude = relu([[slot.hours, 1], [altitude, -1]], 0, [0, maximumHours], 1 / 4)
    const orbitPast = affine([[relu([[pastAltitude, -1]], orbitEnd, [0, orbitEnd], 1 / 4), -1]], orbitEnd, [0, orbitEnd], 1 / 4)
    const segmentTerms = orbitSlopes.map((slope, index): [Wire, number] => {
      const length = orbitBreaks[index + 1]! - orbitBreaks[index]!
      const into = relu([[orbitPast, 1]], -orbitBreaks[index]!, [0, orbitEnd], 1 / 4)
      return [relu([[into, -1]], length, [0, length], 1 / 4), -slope]
    })
    const fullOrbit = orbitSlopes.reduce((sum, slope, index) => sum + slope * (orbitBreaks[index + 1]! - orbitBreaks[index]!), 0)
    const orbit = floor(affine(segmentTerms, fullOrbit, [0, zoneWidth[3]], 2 ** -17), 2 ** -17, 0, zoneWidth[3])
    const isOrbit = zoneIs[3]!
    return affine([
      ...zoneIs.map((wire, zone): [Wire, number] => [wire, zoneBase[zone]!]),
      [multiply(affine([[isOrbit, -1]], 1, [0, 1], 1), linear, [0, zoneWidth[0]], 1), 1],
      [multiply(isOrbit, orbit, [0, zoneWidth[3]], 1), 1],
    ], 0, [zoneBase[0], rings[4]], 1)
  })

  // ---- Order: by hours, heavier first on a tie, then by slot. rank = visible pills that come first.
  const keys = slots.map(slot => affine([[slot.hours, 32], [slot.weight, -1]], 7, [2, maximumHours * 32 + 6], 1))
  const keyAtMost: Wire[][] = slots.map(() => [])
  for (let a = 0; a < slotCount; a++) {
    for (let b = a + 1; b < slotCount; b++) keyAtMost[a]![b] = bit(emitCompare(circuit, keys[a]!, '<=', keys[b]!))
  }
  const comesBefore = (other: number, slot: number) => other < slot ? keyAtMost[other]![slot]! : bit(circuit.affine([[keyAtMost[slot]![other]!, -1]], 1))
  const ranks = slots.map((_, slot) => affine(slots.flatMap((__, other): [Wire, number][] =>
    other === slot ? [] : [[all(visible[other]!, comesBefore(other, slot)), 1]]), 0, [0, slotCount - 1], 1))
  // atPosition[slot][position]: 1 when the pill shows and has that rank.
  const atPosition = slots.map((_, slot) => oneHot(ranks[slot]!, slotCount).map(isRank => all(visible[slot]!, isRank)))
  const gather = (position: number, values: Wire[], range: [number, number], grid: number) =>
    affine(values.map((value, slot) => [multiply(atPosition[slot]![position]!, value, range, grid), 1]), 0, range, grid)

  // ---- Placement, one rank at a time.
  const trigOffset = -trigFirstDegree * trigStepsPerDegree
  const cosWires = cosTable.map(value => constant(value))
  const sinWires = sinTable.map(value => constant(value))
  const fractions = [...new Set(candidates.map(([, f]) => f))]
  const radiusSteps = [...new Set(candidates.map(([dr]) => dr))]
  const maximumReach = Math.ceil(maximumArch * maximumScale * (rings[4] + Math.max(...radiusSteps)) / scaleUnits)
  const offsetRange: [number, number] = [-maximumReach, maximumReach]
  const g = 1 / trigGrid // offsets are multiples of 1/2048 px, so 2048 × a difference is a whole number
  const halfWidth = (wire: Wire): [Wire, number] => [wire, g / 2]
  const centerX: [Wire, number] = [viewportWidth, g / 2]
  type Placed = {u: Wire, v: Wire, width: Wire, visible: Wire, free: Wire, candidate: Wire}
  const placed: Placed[] = []
  for (let position = 0; position < slotCount; position++) {
    const shownHere = affine(slots.map((_, slot) => [atPosition[slot]![position]!, 1]), 0, [0, 1], 1)
    const width = gather(position, slots.map(slot => slot.width), [0, maximumPillWidth], 1)
    // An empty position gets Ignition's radius, so that every reach below is positive.
    const radius = affine([[gather(position, radii, [0, rings[4]], 1), 1], [shownHere, -zoneBase[0]]], zoneBase[0], [zoneBase[0], rings[4]], 1)
    const mid2 = gather(position, mid2s, [-200, 2 * fanLeft], 1)
    const spread2 = gather(position, spread2s, [0, fanTicks], 1)
    // Each fraction's angle, rounded to a half degree, and its cos and sin from the tables.
    const trig = new Map(fractions.map(f => {
      const step = round(affine([[mid2, 1 / 4], [spread2, f / 4]], trigOffset, [-2000, 2000], 1 / 32), -2000, 2000)
      const read = (wires: Wire[]) => exact(circuit.indexRead(step, wires), -1, 1, trigGrid)
      return [f, {cos: read(cosWires), sin: read(sinWires)}]
    }))
    // Each radius step's horizontal and vertical reach in whole px. JS: round(k × (radius + dr) / 1024)
    const kxRadius = multiply(kx, radius, [zoneBase[0], maximumScale * rings[4]], 1)
    const kyRadius = multiply(ky, radius, [zoneBase[0], maximumArch * maximumScale * rings[4]], 1)
    const reach = new Map(radiusSteps.map(dr => {
      const scaled = (kRadius: Wire, k: Wire, kMaximum: number) => round(affine([[kRadius, 1 / scaleUnits], [k, dr / scaleUnits]], 0,
        [0, kMaximum * (rings[4] + dr) / scaleUnits], 1 / scaleUnits), 0, maximumReach)
      return [dr, {x: scaled(kxRadius, kx, maximumScale), y: scaled(kyRadius, ky, maximumArch * maximumScale)}]
    }))
    const spots = candidates.map(([dr, f]) => {
      const angle = trig.get(f)!
      const r = reach.get(dr)!
      const u = multiply(r.x, angle.cos, offsetRange, trigGrid)
      const v = multiply(r.y, angle.sin, offsetRange, trigGrid)
      // Inside the stage: left - 4, width - 4 - right, top - 4 and horizon - 4 - bottom all at least 0. Each is
      // negated here, and relu(-margin) is at least 1 exactly when the margin is below 0.
      const outside = ([
        [[[viewportWidth, -g / 2], [u, -g], halfWidth(width)], (boxSide + edgeMargin) * g],
        [[[viewportWidth, -g / 2], [u, g], halfWidth(width)], (boxSide + edgeMargin) * g],
        [[[horizonY, -g], [v, g]], (boxAbove + edgeMargin) * g],
        [[[v, -g]], (boxBelow + edgeMargin) * g],
      ] as [[Wire, number][], number][]).map(([terms, bias]) => relu(terms, bias, [0, 2 ** 24], 1))
      const inside = bit(circuit.reglu([], 1, outside.map(wire => [wire, -1] as [Wire, number]), 1))
      return {u, v, inside}
    })
    // Clear of the sun, the two corners and every pill placed before, each test 5 operations.
    const valid = spots.map(spot => {
      const {u, v} = spot
      const coreBox = overlap([
        {terms: [[core, g], [u, -g], halfWidth(width)], bias: boxSide * g},
        {terms: [[core, g], [u, g], halfWidth(width)], bias: boxSide * g},
        {terms: [[v, g]], bias: boxAbove * g},
        {terms: [[core, g], [v, -g]], bias: boxBelow * g},
      ], null)
      const leftBox = overlap([
        {terms: [[topLeft.width, g], [viewportWidth, -g / 2], [u, -g], halfWidth(width)], bias: boxSide * g},
        {terms: [centerX, [u, g], halfWidth(width)], bias: boxSide * g},
        {terms: [[topLeft.height, g], [horizonY, -g], [v, g]], bias: boxAbove * g},
        {terms: [[horizonY, g], [v, -g]], bias: boxBelow * g},
      ], null)
      const rightBox = overlap([
        {terms: [[viewportWidth, g / 2], [u, -g], halfWidth(width)], bias: boxSide * g},
        {terms: [[viewportWidth, -g / 2], [topRight.width, g], [u, g], halfWidth(width)], bias: boxSide * g},
        {terms: [[topRight.height, g], [horizonY, -g], [v, g]], bias: boxAbove * g},
        {terms: [[horizonY, g], [v, -g]], bias: boxBelow * g},
      ], null)
      const pills = placed.map(other => overlap([
        {terms: [[other.u, g], [u, -g], halfWidth(other.width), halfWidth(width)], bias: 2 * boxSide * g},
        {terms: [[u, g], [other.u, -g], halfWidth(other.width), halfWidth(width)], bias: 2 * boxSide * g},
        {terms: [[v, g], [other.v, -g]], bias: (boxAbove + boxBelow) * g},
        {terms: [[other.v, g], [v, -g]], bias: (boxAbove + boxBelow) * g},
      ], [other.visible, 1]))
      return bit(circuit.reglu([], 1, [[spot.inside, 1], ...[coreBox, leftBox, rightBox, ...pills].map(wire => [wire, -1] as [Wire, number])], 0))
    })
    // The first free spot; failing that, the first inside the stage; failing that, the first.
    const firstOf = (bits: Wire[], blocked: [Wire, number][]) => bits.map((wire, index) =>
      bit(circuit.reglu([], 1, [[wire, 1], ...bits.slice(0, index).map(earlier => [earlier, -1] as [Wire, number]), ...blocked], 0)))
    const firstFree = firstOf(valid, [])
    const free = affine(firstFree.map(wire => [wire, 1]), 0, [0, 1], 1)
    const firstInside = firstOf(spots.map(spot => spot.inside), [[free, -1]])
    const inside = affine([[free, 1], ...firstInside.map((wire): [Wire, number] => [wire, 1])], 0, [0, 1], 1)
    const chosen = firstFree.map((wire, index) => affine([[wire, 1], [firstInside[index]!, 1], ...(index === 0 ? [[inside, -1] as [Wire, number]] : [])], index === 0 ? 1 : 0, [0, 1], 1))
    const pickSpot = (values: Wire[], range: [number, number], grid: number) =>
      affine(values.map((value, index) => [multiply(chosen[index]!, value, range, grid), 1]), 0, range, grid)
    const u = pickSpot(spots.map(spot => spot.u), offsetRange, trigGrid)
    const v = pickSpot(spots.map(spot => spot.v), offsetRange, trigGrid)
    const candidate = affine(chosen.map((wire, index) => [wire, index]), 0, [0, candidates.length - 1], 1)
    placed.push({u, v, width, visible: shownHere, free, candidate})
  }

  // ---- Back from ranks to slots, then to pixels: x = width / 2 + u, y = horizonY - v.
  const results = placed
  const pills = slots.map((slot, index) => {
    const scatter = (values: Wire[], range: [number, number], grid: number) =>
      affine(values.map((value, position) => [multiply(atPosition[index]![position]!, value, range, grid), 1]), 0, range, grid)
    const scatterBit = (bits: Wire[]) => affine(bits.map((wire, position) => [all(atPosition[index]![position]!, wire), 1]), 0, [0, 1], 1)
    const u = scatter(results.map(result => result.u), offsetRange, trigGrid)
    const v = scatter(results.map(result => result.v), offsetRange, trigGrid)
    return {
      visible: visible[index]!,
      x: affine([[viewportWidth, 1 / 2], [u, 1]], 0, [-maximumReach, maximumViewport + maximumReach], trigGrid),
      y: affine([[horizonY, 1], [v, -1]], 0, [-maximumReach, maximumViewport + maximumReach], trigGrid),
      rank: ranks[index]!,
      radius: radii[index]!,
      candidate: scatter(results.map(result => result.candidate), [0, candidates.length - 1], 1),
      free: scatterBit(results.map(result => result.free)),
      width: slot.width,
    }
  })

  // ---- Self-checks from the outputs alone: overlapping pairs (pills, the sun and the corners), pills outside.
  const fixedBoxes = [
    {left: [[viewportWidth, 1 / 2], [core, -1]], right: [[viewportWidth, 1 / 2], [core, 1]], top: [[horizonY, 1], [core, -1]], bottom: [[horizonY, 1]]},
    {left: [], right: [[topLeft.width, 1]], top: [], bottom: [[topLeft.height, 1]]},
    {left: [[viewportWidth, 1], [topRight.width, -1]], right: [[viewportWidth, 1]], top: [], bottom: [[topRight.height, 1]]},
  ] as {left: [Wire, number][], right: [Wire, number][], top: [Wire, number][], bottom: [Wire, number][]}[]
  const scaled = (terms: [Wire, number][], sign: number) => terms.map(([wire, coefficient]): [Wire, number] => [wire, sign * coefficient * g])
  const overlapTerms: [Wire, number][] = []
  pills.forEach((pill, a) => {
    for (const fixed of fixedBoxes) {
      overlapTerms.push([overlap([
        // fixed.right - pill.left, pill.right - fixed.left, fixed.bottom - pill.top, pill.bottom - fixed.top
        {terms: [...scaled(fixed.right, 1), [pill.x, -g], halfWidth(pill.width)], bias: boxSide * g},
        {terms: [[pill.x, g], halfWidth(pill.width), ...scaled(fixed.left, -1)], bias: boxSide * g},
        {terms: [...scaled(fixed.bottom, 1), [pill.y, -g]], bias: boxAbove * g},
        {terms: [[pill.y, g], ...scaled(fixed.top, -1)], bias: boxBelow * g},
      ], [pill.visible, 1]), 1])
    }
    for (let b = a + 1; b < slotCount; b++) {
      const other = pills[b]!
      overlapTerms.push([overlap([
        {terms: [[other.x, g], [pill.x, -g], halfWidth(other.width), halfWidth(pill.width)], bias: 2 * boxSide * g},
        {terms: [[pill.x, g], [other.x, -g], halfWidth(other.width), halfWidth(pill.width)], bias: 2 * boxSide * g},
        {terms: [[pill.y, g], [other.y, -g]], bias: (boxAbove + boxBelow) * g},
        {terms: [[other.y, g], [pill.y, -g]], bias: (boxAbove + boxBelow) * g},
      ], [all(pill.visible, other.visible), 1]), 1])
    }
  })
  const overlapCount = affine(overlapTerms, 0, [0, overlapTerms.length], 1)
  const outsideCount = affine(pills.map(pill => {
    // A margin below 0 on any side: relu(-margin) ≥ 1.
    const misses = [
      [[[pill.x, -g], halfWidth(pill.width)], (boxSide + edgeMargin) * g],
      [[[pill.x, g], halfWidth(pill.width), [viewportWidth, -g]], (boxSide + edgeMargin) * g],
      [[[pill.y, -g]], (boxAbove + edgeMargin) * g],
      [[[pill.y, g], [horizonY, -g]], (boxBelow + edgeMargin) * g],
    ] as [[Wire, number][], number][]
    const out = misses.map(([terms, bias]) => relu(terms, bias, [0, 2 ** 24], 1))
    // 1 when the pill shows and any margin is negative: min(1, sum) × visible, as relu(visible - relu(1 - sum)).
    const anyOut = bit(circuit.reglu([], 1, [[relu(out.map(wire => [wire, -1] as [Wire, number]), 1, [0, 1], 1), -1], [pill.visible, 1]], 0))
    return [anyOut, 1] as [Wire, number]
  }), 0, [0, slotCount], 1)
  const unplacedCount = affine(pills.map(pill => [pill.visible, 1] as [Wire, number]).concat(pills.map(pill => [pill.free, -1])), 0, [0, slotCount], 1)
  const valid = bit(emitCompare(circuit, affine([[overlapCount, 1], [outsideCount, 1]], 0, [0, overlapTerms.length + slotCount], 1), '===', zero))

  const output = {
    kx, ky, sunScale, core, overlapCount, outsideCount, unplacedCount, valid,
    sectors: sectors.map(sector => ({shown: sector.shown, a0: sector.a0, a1: sector.a1, mid2: sector.mid2})),
    pills: pills.map(pill => ({visible: pill.visible, x: pill.x, y: pill.y, rank: pill.rank, radius: pill.radius, candidate: pill.candidate, free: pill.free})),
  }
  return {cells, output, ...table.finish()}
}

// Builds and compiles the program once, and returns a function from a DawnInput to the layout, in the reference's
// shape: scales as fractions, angles in degrees.
export function createDawnLayout() {
  const built = buildDawnLayout()
  const evaluate = createEvaluator(built)
  const source = new Float32Array(built.initialSource)
  const {cells} = built
  return {
    built,
    operationCount: built.circuit.operations.length,
    write(layoutInput: DawnInput) {
      source[cells.viewportWidth] = layoutInput.viewportWidth
      source[cells.horizonY] = layoutInput.horizonY
      source[cells.topLeft.width] = layoutInput.topLeft.width
      source[cells.topLeft.height] = layoutInput.topLeft.height
      source[cells.topRight.width] = layoutInput.topRight.width
      source[cells.topRight.height] = layoutInput.topRight.height
      source[cells.climb] = layoutInput.climb
      source[cells.altitude] = layoutInput.altitude
      source[cells.dailies] = layoutInput.dailies ? 1 : 0
      cells.groupWeights.forEach((wire, index) => { source[wire] = layoutInput.groupWeights[index] ?? 0 })
      cells.slots.forEach((slot, index) => {
        const values = layoutInput.slots[index] ?? {visible: false, zone: 0, hours: 0, group: 0, width: 0, weight: 1}
        source[slot.visible] = values.visible ? 1 : 0
        source[slot.zone] = values.zone
        source[slot.hours] = values.hours
        source[slot.group] = values.group
        source[slot.width] = values.width
        source[slot.weight] = values.weight
      })
      return source
    },
    run(layoutInput: DawnInput): DawnLayout & {valid: boolean} {
      const output = evaluate(this.write(layoutInput)).output
      return {
        kx: output.kx / scaleUnits, ky: output.ky / scaleUnits, sunScale: output.sunScale / scaleUnits,
        centerX: layoutInput.viewportWidth / 2, core: output.core,
        sectors: output.sectors.map(sector => ({shown: sector.shown === 1, a0: sector.a0 / 4, a1: sector.a1 / 4, mid: sector.mid2 / 8})),
        pills: output.pills.map(pill => ({
          visible: pill.visible === 1, x: pill.x, y: pill.y, rank: pill.rank, radius: pill.radius,
          candidate: pill.candidate, free: pill.free === 1, inside: true,
        })),
        overlapCount: output.overlapCount, outsideCount: output.outsideCount, unplacedCount: output.unplacedCount,
        valid: output.valid === 1,
      }
    },
  }
}
