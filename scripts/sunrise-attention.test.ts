// attention.ts's program against attention-reference.ts: what spending attention promises, then seeded random days.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {type AttentionInput, attentionReference} from '../src/lib/sunrise/attention-reference.ts'
import {createAttention, thingCount} from '../src/lib/sunrise/attention.ts'

const attention = createAttention()
function expectMatch(input: AttentionInput) {
  const salience = Array.from({length: thingCount}, (_, index) => input.salience[index] ?? 0)
  const program = attention.run({...input, salience})
  assert.deepStrictEqual(program, attentionReference({...input, salience}))
  return program
}

test('one lead, then hooks and teasers within the budget, by salience', () => {
  const day = expectMatch({width: 1400, salience: [51, 42, 38, 29, 22, 19, 19, 15, 9, 6]})
  assert.deepStrictEqual(day.levels.slice(0, 10), [3, 2, 2, 2, 1, 1, 1, 1, 0, 0])
  assert.deepStrictEqual([day.leads, day.hooks, day.teasers], [1, 3, 4])
  // A phone opens fewer: the same day there has one hook and two teasers.
  const phone = expectMatch({width: 390, salience: [51, 42, 38, 29, 22, 19, 19, 15, 9, 6]})
  assert.deepStrictEqual(phone.levels.slice(0, 10), [3, 2, 1, 1, 0, 0, 0, 0, 0, 0])
})

test('a thing opens only as far as its salience earns, so a quiet day has no lead', () => {
  const quiet = expectMatch({width: 1400, salience: [24, 14, 8]})
  assert.deepStrictEqual(quiet.levels.slice(0, 3), [2, 1, 0])
  assert.deepStrictEqual(quiet.leads, 0)
})

test('order is by salience, not by position, and ties go to the earlier thing', () => {
  const tied = expectMatch({width: 1400, salience: [10, 40, 40, 33]})
  assert.deepStrictEqual(tied.ranks.slice(0, 4), [3, 0, 1, 2])
  assert.deepStrictEqual(tied.levels.slice(0, 4), [0, 3, 2, 2])
})

test('matches the reference on 2,000 seeded random days', () => {
  let seed = 7
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31
  for (let trial = 0; trial < 2000; trial++) {
    const count = Math.floor(random() * (thingCount + 1))
    const salience = Array.from({length: count}, () => random() < 0.15 ? 0 : Math.floor(random() * 65))
    expectMatch({width: Math.floor(random() * 2000), salience})
  }
})
