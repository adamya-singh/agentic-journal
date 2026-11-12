// The ring layout program (src/lib/sunrise/layout.ts) against its plain-JS reference: a day built by buildHorizon,
// hand-written cases that say what the layout must do, then seeded random inputs. Every value either side computes is
// exact, so they must agree exactly: scales, slice angles, radii, order, the spot each pill takes and its x and y.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {validateGrids, validateIndexReads} from '../src/lib/handwired/numeric-ui-core.ts'
import {buildHorizon} from '../src/lib/horizon.ts'
import type {Task} from '../src/lib/types.ts'
import {fanLeft, groupCount, slotCount, zoneBase} from '../src/lib/sunrise/geometry.ts'
import {groupsOf, ringItems, ringOverflow, toInput, type Stage} from '../src/lib/sunrise/intent.ts'
import {type DawnInput, type DawnSlot, layoutReference} from '../src/lib/sunrise/layout-reference.ts'
import {createDawnLayout} from '../src/lib/sunrise/layout.ts'

const layout = createDawnLayout()
const desk: Stage = {viewportWidth: 1400, horizonY: 830, topLeft: {width: 470, height: 150}, topRight: {width: 380, height: 96}}
const phone: Stage = {viewportWidth: 390, horizonY: 780, topLeft: {width: 390, height: 150}, topRight: {width: 0, height: 0}}

function expectMatch(input: DawnInput) {
  const program = layout.run(input)
  const reference = layoutReference(input)
  assert.deepStrictEqual([program.kx, program.ky, program.sunScale, program.core], [reference.kx, reference.ky, reference.sunScale, reference.core])
  assert.deepStrictEqual(program.sectors, reference.sectors)
  assert.deepStrictEqual([program.overlapCount, program.outsideCount, program.unplacedCount],
    [reference.overlapCount, reference.outsideCount, reference.unplacedCount])
  assert.deepStrictEqual(program.valid, reference.overlapCount + reference.outsideCount === 0)
  reference.pills.forEach((expected, index) => {
    const actual = program.pills[index]!
    assert.deepStrictEqual(actual.visible, expected.visible)
    if (!expected.visible) return
    assert.deepStrictEqual([actual.x, actual.y, actual.rank, actual.radius, actual.candidate, actual.free],
      [expected.x, expected.y, expected.rank, expected.radius, expected.candidate, expected.free])
  })
  return program
}

// A day like the journal's: three courses, jobs and life, from tonight out past Orbit, laid out by buildHorizon.
const now = new Date(2026, 9, 19, 10, 0)
const due = (days: number) => { const d = new Date(2026, 9, 19 + days); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const haveToDo: Task[] = [
  ['[Regression] Homework 3', 0], ['[Regression] Midterm exam', 2], ['[Regression] Project proposal', 9],
  ['[Data Viz] Show and tell slides', 1], ['[Data Viz] Peer review two charts', 3], ['[Data Viz] Final project draft', 16],
  ['[Algorithms] Problem set 5', 1], ['[Algorithms] Quiz 4', 5], ['[Algorithms] Read chapter 9', 12],
  ['Apply to the Stripe new grad role', 2], ['Reply to the recruiter about onsite dates', 0], ['Online assessment for Datadog', 6],
  ['Renew the apartment lease', 4], ['Book flights home', 20], ['Submit the diploma application', 30], ['Call the dentist', 8],
].map(([text, days], index) => ({id: `t${index}`, text: String(text), dueDate: due(Number(days))}))
const data = buildHorizon({haveToDo, wantToDo: [], currentHaveToDoIds: [], completed: [], now})
const ring = (weights?: Map<string, number>) => {
  const items = ringItems(data.items)
  return {items, groups: groupsOf(items), bounds: data.bounds, dailies: data.dailies.length > 0, weights}
}
// About the width of Geist at 13px, and a narrower label on a phone, as the page measures them.
const measureDesk = (item: {short: string}) => item.short.length * 7.1 + 24
const measurePhone = (item: {short: string}) => Math.min(15, item.short.length) * 6.2 + 18

test('a day built by buildHorizon matches the reference, lays out clean on a desk, and folds a slice at weight 0', () => {
  const all = expectMatch(toInput(ring(), desk, measureDesk))
  expectMatch(toInput(ring(), phone, measurePhone))
  assert.deepStrictEqual(all.valid, true)
  assert.deepStrictEqual(all.unplacedCount, 0)
  const shown = ringItems(data.items)
  assert.ok(shown.length >= 8 && shown.length <= slotCount)
  assert.deepStrictEqual(all.pills.filter(pill => pill.visible).length, shown.length)
  // Nothing is lost: what the rings do not hold is in further or counted as overflow.
  assert.deepStrictEqual(shown.length + ringOverflow(data.items).length, data.items.length)
  const group = shown[0]!.group
  const folded = expectMatch(toInput(ring(new Map([[group, 0]])), desk, measureDesk))
  assert.deepStrictEqual(folded.pills.filter(pill => pill.visible).length, shown.filter(item => item.group !== group).length)
})

const hiddenSlot: DawnSlot = {visible: false, zone: 0, hours: 0, group: 0, width: 0, weight: 1}
function withSlots(slots: Partial<DawnSlot>[], extra: Partial<DawnInput> = {}): DawnInput {
  return {
    ...desk, climb: 156, altitude: 324, dailies: true, groupWeights: Array<number>(groupCount).fill(1),
    slots: Array.from({length: slotCount}, (_, index) => {
      const given = slots[index]
      return given === undefined ? hiddenSlot : {...hiddenSlot, visible: true, width: 100, weight: 3, ...given}
    }),
    ...extra,
  }
}

test('scales follow the stage, and a narrow stage stretches the rings into arches', () => {
  // 1200 px wide is the original's scale; the height can limit it, and so can 1.5.
  assert.deepStrictEqual(expectMatch(withSlots([{}], {viewportWidth: 1200})).kx, 1)
  assert.deepStrictEqual(expectMatch(withSlots([{}], {viewportWidth: 1400, horizonY: 560})).kx, Math.floor(470 * 1024 / 470) / 1024)
  assert.deepStrictEqual(expectMatch(withSlots([{}], {viewportWidth: 3000, horizonY: 2000})).kx, 1.5)
  const narrow = expectMatch(withSlots([{}], phone))
  assert.ok(narrow.ky > narrow.kx * 3)
  assert.deepStrictEqual(expectMatch(withSlots([{}], {...phone, viewportWidth: 700})).ky, expectMatch(withSlots([{}], {...phone, viewportWidth: 700})).kx)
})

test('slices keep their order, fill the fan, and widen with the intent', () => {
  const slots = [{group: 0}, {group: 1}, {group: 1}, {group: 1}, {group: 2}]
  const even = expectMatch(withSlots(slots))
  const shown = even.sectors.filter(sector => sector.shown)
  assert.deepStrictEqual(shown.length, 3)
  // Left to right, 2 degrees apart, from 174 to 6 degrees.
  assert.deepStrictEqual(shown[0]!.a0, fanLeft / 4)
  assert.deepStrictEqual(shown[2]!.a1, 6)
  assert.deepStrictEqual(shown[1]!.a0, shown[0]!.a1 - 2)
  // Widths follow counts: 1.25 : 3 : 1.25.
  const width = (sector: {a0: number, a1: number}) => sector.a0 - sector.a1
  assert.ok(width(shown[1]!) > 2 * width(shown[0]!))
  // Weight 4 on the first slice makes it the widest; weight 0 folds the last one away with its pill.
  const weighted = expectMatch(withSlots(slots, {groupWeights: [4, 1, 0, 1, 1, 1, 1, 1]}))
  assert.ok(width(weighted.sectors[0]!) > width(weighted.sectors[1]!))
  assert.deepStrictEqual(weighted.sectors[2]!.shown, false)
  assert.deepStrictEqual(weighted.pills[4]!.visible, false)
  assert.deepStrictEqual(weighted.sectors[1]!.a1, 6)
})

test('later is farther out within a zone, and each zone stays on its ring', () => {
  const slots = [0, 12, 24, 47].map(hours => ({zone: 0, hours}))
    .concat([60, 156].map(hours => ({zone: 1, hours})), [200, 320].map(hours => ({zone: 2, hours})), [330, 400, 900, 5000].map(hours => ({zone: 3, hours})))
  const output = expectMatch(withSlots(slots))
  const radii = output.pills.slice(0, slots.length).map(pill => pill.radius)
  for (let index = 1; index < radii.length; index++) assert.ok(radii[index]! >= radii[index - 1]!)
  assert.deepStrictEqual(radii[0], zoneBase[0])
  assert.deepStrictEqual(radii[radii.length - 1], 452) // Orbit's outer edge: 470 - 18
})

test('the most urgent pill takes its ideal spot, and the next ones move aside', () => {
  // Three pills due at the same time in one slice: the heaviest goes first, then the lower slot.
  const output = expectMatch(withSlots([{hours: 30, weight: 2}, {hours: 30, weight: 5}, {hours: 30, weight: 2}], {groupWeights: [1, 0, 0, 0, 0, 0, 0, 0]}))
  assert.deepStrictEqual(output.pills.slice(0, 3).map(pill => pill.rank), [1, 0, 2])
  assert.deepStrictEqual(output.pills[1]!.candidate, 0)
  assert.notStrictEqual(output.pills[0]!.candidate, 0)
  assert.deepStrictEqual(output.valid, true)
})

test('pills keep clear of the corners', () => {
  // A huge headline corner pushes everything below it.
  const output = expectMatch(withSlots(Array.from({length: 8}, (_, index) => ({zone: 3, hours: 400 + index * 50, group: index % 3})),
    {topLeft: {width: 1400, height: 300}}))
  for (const pill of output.pills.filter(each => each.visible && each.free)) assert.ok(pill.y - 16 >= 300)
})

test('matches the reference on 2,000 seeded random inputs, and keeps its grid and index promises', {timeout: 120_000}, () => {
  let seed = 11
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
  const integer = (low: number, high: number) => low + Math.floor(random() * (high - low + 1))
  let checked = 0
  for (let trial = 0; trial < 2000; trial++) {
    const climb = integer(0, 216 * 4) / 4
    const input: DawnInput = {
      viewportWidth: integer(200, 2560),
      horizonY: integer(200, 1600),
      topLeft: {width: integer(0, 600), height: integer(0, 260)},
      topRight: {width: integer(0, 500), height: integer(0, 200)},
      climb,
      altitude: Math.min(420, climb + 168),
      dailies: random() < 0.5,
      groupWeights: Array.from({length: groupCount}, () => random() < 0.15 ? 0 : integer(1, 64) / 16),
      slots: Array.from({length: slotCount}, () => ({
        visible: random() < 0.75,
        zone: integer(0, 3),
        hours: random() < 0.1 ? integer(0, 8760 * 4) / 4 : integer(0, 2000 * 4) / 4,
        group: integer(0, groupCount - 1),
        width: integer(30, 320),
        weight: integer(1, 5),
      })),
    }
    expectMatch(input)
    if (trial % 100 === 0) {
      const values = layout.built.circuit.evaluateReference(layout.write(input))
      validateGrids(layout.built.circuit, values)
      validateIndexReads(layout.built.circuit, values)
      checked += 1
    }
  }
  assert.deepStrictEqual(checked, 20)
})
