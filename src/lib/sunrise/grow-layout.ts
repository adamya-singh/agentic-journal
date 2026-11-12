// Where a structure goes in the growing space, as one numeric program. Home (Dawn's sun, rings and pills, the two
// edges) is fixed; the model adds structures beside their anchors as the session goes on. Each evaluation places one
// structure, incrementally and stickily:
// - it stays where it is if that spot is still free (a structure that grew, or the space changed around it);
// - otherwise it takes the first free spot of a fixed list around its anchor, ordered nearest first: beside the
//   anchor, then above it, then further out;
// - failing that, the first spot inside the space, which the self-check reports as an overlap.
// The obstacles are everything already there: home's pills, the sun, the edges, and the other structures and
// landmarks. grow-layout-reference.ts is the same placement in plain JavaScript, and grow-layout.test.ts compares them.
//
// Every number is a whole or half pixel (the host rounds boxes outward), so each comparison is a 2-operation bit.
import type {Wire} from '../handwired/numeric-ui-core.ts'
import {createEvaluator, createSourceTable, input, list} from '../handwired/cells.ts'
import {makeKit} from './kit.ts'
import {spots} from './geometry.ts'
import type {GrowInput, GrowPlacement} from './grow-layout-reference.ts'

export {spots}
export const obstacleCount = 40
const coordinate = () => input([-8192, 8192], {grid: 1})
const size = () => input([0, 2048], {grid: 1})

export const growCells = {
  bounds: {left: coordinate(), top: coordinate(), right: coordinate(), bottom: coordinate()},
  gap: input([0, 64], {initial: 14, grid: 1}),
  box: {width: size(), height: size()},
  anchor: {x: coordinate(), y: coordinate(), width: size(), height: size()},
  // Where the structure is now, if it has a place: its box's top left corner.
  current: {active: input([0, 1], {grid: 1}), left: input([-8192, 8192], {grid: 1 / 2}), top: input([-8192, 8192], {grid: 1 / 2})},
  obstacles: list(obstacleCount, () => ({active: input([0, 1], {grid: 1}), left: coordinate(), top: coordinate(), right: coordinate(), bottom: coordinate()})),
}

export function buildGrowLayout() {
  const table = createSourceTable()
  const cells = table.declare(growCells)
  const circuit = table.createCircuit()
  const {exact, affine, relu, bit, multiply, overlap} = makeKit(circuit)
  const {bounds, gap, box, anchor, current, obstacles} = cells
  const span: [number, number] = [-3 * 8192, 3 * 8192]
  type Terms = [Wire, number][]

  // Each spot's top left corner, as terms (all coefficients ±1 or ±1/2, so every corner is on a 1/2 px grid).
  // JS: left = sx > 0 ? ax + aw/2 + gap + ox : sx < 0 ? ax - aw/2 - gap - w + ox : ax - w/2 + ox, and top alike.
  const corner = (centre: Wire, extent: Wire, own: Wire, side: number): Terms => side > 0
    ? [[centre, 1], [extent, 1 / 2], [gap, 1]]
    : side < 0 ? [[centre, 1], [extent, -1 / 2], [gap, -1], [own, -1]] : [[centre, 1], [own, -1 / 2]]
  const candidates = [
    {left: affine([[current.left, 1]], 0, span, 1 / 2), top: affine([[current.top, 1]], 0, span, 1 / 2)},
    ...spots.map(([sx, sy, ox, oy]) => ({
      left: affine(corner(anchor.x, anchor.width, box.width, sx), ox, span, 1 / 2),
      top: affine(corner(anchor.y, anchor.height, box.height, sy), oy, span, 1 / 2),
    })),
  ]
  // Margins are scaled by 2 so that they are whole numbers. A box keeps `gap` from every obstacle.
  const g = 2
  const valid: Wire[] = []
  const inside: Wire[] = []
  const misses = (candidate: {left: Wire, top: Wire}) => {
    // JS: left >= bounds.left, left + w <= bounds.right, top >= bounds.top, top + h <= bounds.bottom; relu(-margin) ≥ 1
    // exactly when a margin is negative.
    const out = ([
      [[[candidate.left, -g], [bounds.left, g]], 0],
      [[[candidate.left, g], [box.width, g], [bounds.right, -g]], 0],
      [[[candidate.top, -g], [bounds.top, g]], 0],
      [[[candidate.top, g], [box.height, g], [bounds.bottom, -g]], 0],
    ] as [Terms, number][]).map(([terms, bias]) => relu(terms, bias, [0, 2 ** 24], 1))
    return bit(circuit.reglu([], 1, out.map(wire => [wire, -1] as [Wire, number]), 1))
  }
  candidates.forEach((candidate, index) => {
    const isInside = misses(candidate)
    // JS: overlaps(o) = left < o.right + gap && left + w + gap > o.left && top < o.bottom + gap && top + h + gap > o.top
    const hits = obstacles.map(o => overlap([
      {terms: [[o.right, g], [gap, g], [candidate.left, -g]], bias: 0},
      {terms: [[candidate.left, g], [box.width, g], [gap, g], [o.left, -g]], bias: 0},
      {terms: [[o.bottom, g], [gap, g], [candidate.top, -g]], bias: 0},
      {terms: [[candidate.top, g], [box.height, g], [gap, g], [o.top, -g]], bias: 0},
    ], [o.active, 1]))
    const gate: Terms = index === 0 ? [[current.active, 1]] : []
    inside.push(index === 0 ? bit(circuit.reglu([], 1, [[isInside, 1], [current.active, 1]], -1)) : isInside)
    valid.push(bit(circuit.reglu([], 1, [[isInside, 1], ...gate, ...hits.map(hit => [hit, -1] as [Wire, number])], index === 0 ? -1 : 0)))
  })
  // The first free spot; failing that, the first inside; failing that, spot 1 (the first beside the anchor).
  const firstOf = (bits: Wire[], blocked: Terms) => bits.map((wire, index) =>
    bit(circuit.reglu([], 1, [[wire, 1], ...bits.slice(0, index).map(earlier => [earlier, -1] as [Wire, number]), ...blocked], 0)))
  const firstFree = firstOf(valid, [])
  const free = affine(firstFree.map(wire => [wire, 1]), 0, [0, 1], 1)
  const firstInside = firstOf(inside, [[free, -1]])
  const placedInside = affine([[free, 1], ...firstInside.map((wire): [Wire, number] => [wire, 1])], 0, [0, 1], 1)
  const chosen = firstFree.map((wire, index) => affine([[wire, 1], [firstInside[index]!, 1], ...(index === 1 ? [[placedInside, -1] as [Wire, number]] : [])],
    index === 1 ? 1 : 0, [0, 1], 1))
  const pick = (values: Wire[]) => affine(values.map((value, index) => [multiply(chosen[index]!, value, span, 1 / 2), 1]), 0, span, 1 / 2)
  const left = pick(candidates.map(candidate => candidate.left))
  const top = pick(candidates.map(candidate => candidate.top))
  const spot = affine(chosen.map((wire, index) => [wire, index]), 0, [0, candidates.length - 1], 1)
  // Self-check, from the answer alone: obstacles it overlaps, and whether it is outside the space.
  const overlapCount = affine(obstacles.map(o => [overlap([
    {terms: [[o.right, g], [gap, g], [left, -g]], bias: 0},
    {terms: [[left, g], [box.width, g], [gap, g], [o.left, -g]], bias: 0},
    {terms: [[o.bottom, g], [gap, g], [top, -g]], bias: 0},
    {terms: [[top, g], [box.height, g], [gap, g], [o.top, -g]], bias: 0},
  ], [o.active, 1]), 1] as [Wire, number]), 0, [0, obstacleCount], 1)
  const outside = affine([[misses({left, top}), -1]], 1, [0, 1], 1)
  exact(spot, 0, candidates.length - 1, 1)
  const output = {left, top, spot, free, moved: affine([[chosen[0]!, -1]], 1, [0, 1], 1), overlapCount, outside}
  return {cells, output, ...table.finish()}
}

export function createGrowLayout() {
  const built = buildGrowLayout()
  const evaluate = createEvaluator(built)
  const source = new Float32Array(built.initialSource)
  const {cells} = built
  return {
    built,
    operationCount: built.circuit.operations.length,
    write(layoutInput: GrowInput) {
      const {bounds, box, anchor, current} = layoutInput
      source[cells.bounds.left] = bounds.left
      source[cells.bounds.top] = bounds.top
      source[cells.bounds.right] = bounds.right
      source[cells.bounds.bottom] = bounds.bottom
      source[cells.gap] = layoutInput.gap
      source[cells.box.width] = box.width
      source[cells.box.height] = box.height
      source[cells.anchor.x] = anchor.x
      source[cells.anchor.y] = anchor.y
      source[cells.anchor.width] = anchor.width
      source[cells.anchor.height] = anchor.height
      source[cells.current.active] = current === null ? 0 : 1
      source[cells.current.left] = current?.left ?? 0
      source[cells.current.top] = current?.top ?? 0
      cells.obstacles.forEach((wires, index) => {
        const o = layoutInput.obstacles[index]
        source[wires.active] = o === undefined ? 0 : 1
        source[wires.left] = o?.left ?? 0
        source[wires.top] = o?.top ?? 0
        source[wires.right] = o?.right ?? 0
        source[wires.bottom] = o?.bottom ?? 0
      })
      return source
    },
    run(layoutInput: GrowInput): GrowPlacement {
      const output = evaluate(this.write(layoutInput)).output
      return {
        left: output.left, top: output.top, spot: output.spot, free: output.free === 1, moved: output.moved === 1,
        overlapCount: output.overlapCount, outside: output.outside === 1,
      }
    },
  }
}
