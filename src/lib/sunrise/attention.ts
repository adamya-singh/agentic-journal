// How Sunrise spends attention, as one numeric program. The model (and time, and you) only say how much each thing
// matters right now: one salience per thing, 0 to 64. This program decides what that means on this screen:
// - rank: the order of everything by salience, ties to the earlier thing;
// - level: how open each thing is. 3 is the lead hook (the one Sunrise wants you to start), 2 a hook (a preview of
//   its first step, prepared by the agent), 1 a teaser (its pill carries one prepared line), 0 a plain pill;
// - the budget: a wider screen has room for more hooks and teasers, so it opens more, never all.
// A thing is opened only as far as its salience earns, whatever its rank: a quiet day has no lead.
// attention-reference.ts is the same in plain JavaScript, and attention.test.ts compares the two.
import type {Wire} from '../handwired/numeric-ui-core.ts'
import {createEvaluator, createSourceTable, input, list} from '../handwired/cells.ts'
import {makeKit} from './kit.ts'
import {type AttentionInput, type AttentionOutput, budgetFor, thresholds} from './attention-reference.ts'

export const thingCount = 24
export const salienceSteps = 64

export const attentionCells = {
  width: input([0, 4096], {grid: 1}),
  salience: list(thingCount, () => input([0, salienceSteps], {grid: 1})),
}

export function buildAttention() {
  const table = createSourceTable()
  const cells = table.declare(attentionCells)
  const circuit = table.createCircuit()
  const {affine, relu, bit, atLeast} = makeKit(circuit)
  const {width, salience} = cells
  type Terms = [Wire, number][]
  // JS: d >= 1 for a whole d within -range..range: relu(d) - relu(d - 1).
  const positive = (terms: Terms, bias: number, range: number) =>
    bit(affine([[relu(terms, bias, [0, range], 1), 1], [relu(terms, bias - 1, [0, range], 1), -1]], 0, [0, 1], 1))

  // Rank: how many things come before this one. JS: salience[j] > salience[i] || (salience[j] === salience[i] && j < i)
  const ranks = salience.map((own, i) => affine(salience.flatMap((other, j): Terms => {
    if (j === i) return []
    // An earlier thing comes first on a tie: other - own + 1 >= 1, i.e. other >= own.
    return [[positive([[other, 1], [own, -1]], j < i ? 1 : 0, salienceSteps + 1), 1]]
  }), 0, [0, thingCount - 1], 1))

  // The budget, from the screen's width (attention-reference.ts's budgetFor): hooks and teasers beside the lead.
  const wide = atLeast(width, budgetFor.wide)
  const medium = atLeast(width, budgetFor.medium)
  const hookRoom = affine([[medium, 1], [wide, 1]], budgetFor.hooks[0]!, [0, 8], 1)
  const teaserRoom = affine([[medium, 1], [wide, 1]], budgetFor.teasers[0]!, [0, 8], 1)

  // Each level is earned twice: by salience (at least its threshold) and by rank (within its budget). The levels
  // nest, so a thing's level is how many of the three it earns. JS: rank < room is room - rank >= 1.
  const levels = salience.map((own, i) => {
    const rank = ranks[i]!
    const earns = (threshold: number, room: Terms, roomBias: number) => bit(circuit.reglu([], 1, [
      [atLeast(own, threshold), 1],
      [positive([...room, [rank, -1]], roomBias, thingCount + 16), 1],
    ], -1))
    const lead = earns(thresholds.lead, [], 1)
    const hook = earns(thresholds.hook, [[hookRoom, 1]], 1)
    const teaser = earns(thresholds.teaser, [[hookRoom, 1], [teaserRoom, 1]], 1)
    return affine([[lead, 1], [hook, 1], [teaser, 1]], 0, [0, 3], 1)
  })
  // How many of each, so the host can check the budget held.
  const count = (level: number) => affine(levels.map(wire => [atLeast(wire, level), 1] as [Wire, number]), 0, [0, thingCount], 1)
  const output = {ranks, levels, leads: count(3), hooks: count(2), teasers: count(1), hookRoom, teaserRoom}
  return {cells, output, ...table.finish()}
}

export function createAttention() {
  const built = buildAttention()
  const evaluate = createEvaluator(built)
  const source = new Float32Array(built.initialSource)
  const {cells} = built
  return {
    built,
    operationCount: built.circuit.operations.length,
    run(attention: AttentionInput): AttentionOutput {
      source[cells.width] = Math.max(0, Math.min(4096, Math.round(attention.width)))
      cells.salience.forEach((wire, index) => {
        source[wire] = Math.max(0, Math.min(salienceSteps, Math.round(attention.salience[index] ?? 0)))
      })
      const output = evaluate(source).output
      return {
        ranks: [...output.ranks], levels: [...output.levels],
        // "At least" counts: hooks counts the lead too, teasers counts every opened thing.
        leads: output.leads, hooks: output.hooks - output.leads, teasers: output.teasers - output.hooks,
        hookRoom: output.hookRoom, teaserRoom: output.teaserRoom,
      }
    },
  }
}
