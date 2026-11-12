// The builder helpers both Dawn programs use (layout.ts and live-layout.ts): promises about a wire's range and grid,
// bits, exact rounding and division. Each returns wires whose values FP32 holds exactly, so comparisons built on them
// are 2-operation integer bits.
import {type Circuit, type Wire, emitCompare, emitMaximumExact, emitMinimumExact} from '../handwired/numeric-ui-core.ts'
import {archWidth, drawingWidth, headroom, maximumArch, maximumScale, maximumViewport, minimumSunScale, rings, scaleUnits} from './geometry.ts'

// FP32 values within 2^23..2^24 are whole numbers, so adding this and subtracting it again rounds to the nearest whole
// number, halves to even. The same construction as src/handwiredos/value-list.ts's emitRound.
const roundingBase = 2 ** 23 + 2 ** 22

export function makeKit(circuit: Circuit) {
  const constant = (value: number) => circuit.constant(value)
  const zero = constant(0)
  // A promise about a wire: its range and its grid. Circuit.affine shares a wire between equal expressions, e.g. a
  // slice's width and a boundary, so a promise may come after an earlier reader, which then keeps the wider range.
  const exact = (wire: Wire, minimum: number, maximum: number, grid: number) => {
    circuit.assumeRange(wire, minimum, maximum, {allowExistingReaders: true})
    circuit.assumeGrid(wire, grid, {allowExistingReaders: true})
    return wire
  }
  const affine = (terms: [Wire, number][], bias: number, range: [number, number], grid: number) =>
    exact(circuit.affine(terms, bias), range[0], range[1], grid)
  // JS: Math.max(0, terms + bias)
  const relu = (terms: [Wire, number][], bias: number, range: [number, number], grid: number) =>
    exact(circuit.reglu([], 1, terms, bias), range[0], range[1], grid)
  const bit = (wire: Wire) => exact(wire, 0, 1, 1)
  // JS: bits.every(bit => bit === 1)
  const all = (...bits: Wire[]) => bit(circuit.reglu([], 1, bits.map(wire => [wire, 1] as const), 1 - bits.length))
  const multiply = (a: Wire, b: Wire, range: [number, number], grid: number) => exact(circuit.multiply(a, b), range[0], range[1], grid)
  const atLeast = (wire: Wire, threshold: number) => bit(emitCompare(circuit, wire, '>=', constant(threshold)))
  // The one-hot of an integer within 0..count - 1, e.g. [0, 0, 1, 0] for 2 of 4.
  const oneHot = (wire: Wire, count: number) => {
    const bits = [constant(1), ...Array.from({length: count - 1}, (_, index) => atLeast(wire, index + 1))]
    return bits.map((wire, index) => index + 1 < count ? bit(circuit.affine([[wire, 1], [bits[index + 1]!, -1]])) : wire)
  }
  // JS: Math.round(value) with halves to even, for a value within minimum..maximum. 2 operations.
  const round = (value: Wire, minimum: number, maximum: number) => {
    const shifted = circuit.roundAffine([[value, 1]], roundingBase)
    const rounded = circuit.roundAffine([[shifted, 1]], -roundingBase)
    circuit.markRoundingPoint(shifted)
    circuit.markRoundingPoint(rounded)
    return exact(rounded, minimum, maximum, 1)
  }
  // JS: Math.floor(value) for a value on a grid: just under a half below it never lands on a half. 3 operations.
  const floor = (value: Wire, grid: number, minimum: number, maximum: number) =>
    round(exact(circuit.roundAffine([[value, 1]], grid / 2 - 0.5), minimum - 1, maximum, grid / 2), minimum, maximum)
  // JS: Math.floor(value / divisor) for a whole value within 0..maximum and a whole constant divisor: the rounded
  // approximate quotient, less one where it overshoots. As value-list.ts's emitFloorDivide. 6 operations.
  const floorDivideBy = (value: Wire, divisor: number, maximum: number) => {
    const rounded = round(circuit.roundAffine([[value, 1 / divisor]]), 0, Math.floor(maximum / divisor) + 1)
    const tooLarge = emitCompare(circuit, affine([[rounded, divisor]], 0, [0, maximum + divisor], 1), '>', value)
    return affine([[rounded, 1], [tooLarge, -1]], 0, [0, Math.floor(maximum / divisor)], 1)
  }
  // JS: Math.floor(numerator / denominator) for whole numbers, by long division: one bit of the quotient per step,
  // 5 operations each. The quotient must be below 2^bits.
  const longDivide = (numerator: Wire, denominator: Wire, bits: number, numeratorMaximum: number, denominatorMaximum: number) => {
    let remainder = numerator
    const quotientTerms: [Wire, number][] = []
    for (let power = bits - 1; power >= 0; power--) {
      const step = 2 ** power
      const trial = affine([[remainder, 1], [denominator, -step]], 0, [-denominatorMaximum * step, numeratorMaximum], 1)
      const fits = bit(emitCompare(circuit, trial, '>=', zero))
      const taken = multiply(fits, denominator, [0, denominatorMaximum], 1)
      remainder = affine([[remainder, 1], [taken, -step]], 0, [0, numeratorMaximum], 1)
      quotientTerms.push([fits, step])
    }
    return affine(quotientTerms, 0, [0, 2 ** bits - 1], 1)
  }
  const minimum = (a: Wire, b: Wire) => emitMinimumExact(circuit, a, b)
  const maximum = (a: Wire, b: Wire) => emitMaximumExact(circuit, a, b)

  // A margin between two boxes in grid steps, e.g. one box's right minus the other's left. Since it is a whole number
  // of steps, relu(1 - margin) is 0 exactly when the margin is positive.
  type Edge = {terms: [Wire, number][], bias: number}
  // 1 when all 4 margins are positive (the boxes overlap), times `gate`: relu(gate - sum of relu(1 - margin)).
  const overlap = (margins: Edge[], gate: [Wire, number] | null) => {
    const misses = margins.map(margin => relu(margin.terms.map(([wire, coefficient]) => [wire, -coefficient]), 1 - margin.bias, [0, 2 ** 24], 1))
    return bit(circuit.reglu([], 1, misses.map(miss => [miss, -1] as [Wire, number]).concat(gate === null ? [] : [gate]), gate === null ? 1 : 0))
  }
  return {constant, zero, exact, affine, relu, bit, all, multiply, atLeast, oneHot, round, floor, floorDivideBy, longDivide, minimum, maximum, overlap}
}

type Kit = ReturnType<typeof makeKit>
type Size = {width: Wire, height: Wire}
// The drawing's scales from the stage, as dawnScales in layout-reference.ts: kx and ky (equal, except on a narrow
// stage, where the rings stretch up into arches) and the sun's scale, all in 1/1024.
export function emitStageScales(circuit: Circuit, kit: Kit, stage: {viewportWidth: Wire, horizonY: Wire, topLeft: Size, topRight: Size}) {
  const {constant, exact, affine, relu, bit, floorDivideBy, minimum, maximum} = kit
  const {viewportWidth, horizonY, topLeft, topRight} = stage
  // Scales, in 1/1024. JS: kx = max(1, min(floor(width × 1024 / 1200), floor((horizonY - 90) × 1024 / 470), 1536))
  const fitWidth = floorDivideBy(affine([[viewportWidth, scaleUnits]], 0, [0, maximumViewport * scaleUnits], 1), drawingWidth, maximumViewport * scaleUnits)
  const room = (terms: [Wire, number][], bias: number) => floorDivideBy(
    affine([[relu(terms, bias, [0, maximumViewport], 1), scaleUnits]], 0, [0, maximumViewport * scaleUnits], 1), rings[4], maximumViewport * scaleUnits)
  const fitHeight = room([[horizonY, 1]], -headroom)
  const kx = maximum(minimum(minimum(fitWidth, fitHeight), constant(maximumScale)), constant(1))
  exact(kx, 1, maximumScale, 1)
  // On a narrow screen the rings stretch up into arches, into the room under the taller corner.
  const top = maximum(topLeft.height, topRight.height)
  exact(top, 0, maximumViewport, 1)
  const archFit = room([[horizonY, 1], [top, -1]], -30)
  const arch = maximum(kx, minimum(archFit, affine([[kx, maximumArch]], 0, [maximumArch, maximumArch * maximumScale], 1)))
  exact(arch, 1, maximumArch * maximumScale, 1)
  const narrow = bit(emitCompare(circuit, viewportWidth, '<', constant(archWidth)))
  const ky = exact(circuit.select(narrow, kx, arch), 1, maximumArch * maximumScale, 1)
  const sunScale = exact(maximum(kx, constant(minimumSunScale)), minimumSunScale, maximumScale, 1)
  return {kx, ky, sunScale}
}
