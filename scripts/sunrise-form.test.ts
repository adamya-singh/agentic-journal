// What a task's form says (src/lib/sunrise/form-spec.ts) and how much it matters (src/lib/sunrise/salience.ts).
import assert from 'node:assert/strict'
import {test} from 'node:test'
import type {Task} from '../src/lib/types.ts'
import {buildTaskBrief, type BriefTaskRef} from '../src/lib/task-brief.ts'
import {parseHook} from '../src/lib/shapes/hook.ts'
import {thresholds} from '../src/lib/sunrise/attention-reference.ts'
import {demoHook} from '../src/lib/sunrise/demo-hooks.ts'
import {formSpecFor, kindLine} from '../src/lib/sunrise/form-spec.ts'
import {salienceOf, salienceUnits} from '../src/lib/sunrise/salience.ts'

const now = new Date(2026, 9, 8, 12, 0) // Thu Oct 8 2026
const ref = (id: string, text: string, extra: Partial<Task> = {}): BriefTaskRef => ({task: {id, text, ...extra}, listType: 'have-to-do'})
const tasks = [
  ref('ff', '[Data Context] Fair Face', {dueDate: '2026-10-09'}),
  ref('mid', '[Regression] Midterm Exam', {dueDate: '2026-10-12', notesMarkdown: '- [ ] Review lecture 4\n- [ ] Redo homework 2\n- [x] Make the cheat sheet'}),
  ref('lease', 'Renew the apartment lease'),
]
const briefOf = (id: string) => buildTaskBrief({taskId: id, tasks, completed: [], journal: [], now})!

test('with no hook yet, a form still says what the task belongs to, its name and its next step', () => {
  const fair = formSpecFor(briefOf('ff'))
  assert.deepStrictEqual([fair.kind, fair.name, fair.ready, fair.hasWork, fair.did], ['Data Context · task', 'Fair Face', false, false, []])
  assert.ok(fair.what.includes('Fair Face'))
  assert.match(fair.say[0], /^Fair Face\.$/)
  // A task in no subject says only its kind; an undated one has nothing to say about a date.
  const lease = formSpecFor(briefOf('lease'))
  assert.ok(!lease.kind.includes('·'))
  assert.ok(!lease.what.includes('due'))
  // The rules' steps become rows, and the first open one is the next step when the rules name none.
  const midterm = formSpecFor(briefOf('mid'))
  assert.deepStrictEqual(midterm.kind, 'Regression · exam')
  const brief = briefOf('mid')
  if (brief.steps.length >= 2) {
    assert.deepStrictEqual(midterm.shape, 'list')
    assert.deepStrictEqual(midterm.parts[0]?.kind, 'rows')
  }
  assert.deepStrictEqual(kindLine('Other', 'task'), 'Task')
  assert.deepStrictEqual(kindLine('Jobs', 'email'), 'Jobs · email')
})

test('with a hook, the form is the hook, under the task’s subject', () => {
  const {hook} = parseHook({
    shape: 'orb', icon: 'problem', kind: 'exam', name: 'Study for the midterm', next: 'Start practice problem 1',
    what: 'The Regression midterm is in class on Monday and covers chapters 2 to 4.', did: ['Read the topics'],
    say: ['Study for the midterm.', 'The first problem is set up.'], parts: [{kind: 'value', value: '4', unit: 'days left'}],
    work: {format: 'checklist', title: 'Practice', body: '- [ ] Problem 1'},
  })
  const form = formSpecFor({...briefOf('mid'), hook})
  assert.deepStrictEqual([form.kind, form.name, form.next, form.shape, form.ready, form.hasWork],
    ['Regression · exam', 'Study for the midterm', 'Start practice problem 1', 'orb', true, true])
  assert.deepStrictEqual(form.parts, [{kind: 'value', value: '4', unit: 'days left'}])
  // A task OpenClaw is working on says so.
  const filling = formSpecFor({...briefOf('ff'), agent: {status: 'running', finishedAt: null, summary: null, error: null}})
  assert.deepStrictEqual([filling.filling, filling.parts.at(-1)], [true, {kind: 'line', text: 'OpenClaw is getting this ready.'}])
})

test('a demo hook is a hook the parser accepts unchanged, for every kind of task', () => {
  for (const id of ['ff', 'mid', 'lease']) {
    const hook = demoHook(briefOf(id))
    const read = parseHook(JSON.parse(JSON.stringify(hook)))
    assert.deepStrictEqual(read.problems, [], id)
    assert.deepStrictEqual(read.hook, JSON.parse(JSON.stringify(hook)), id)
  }
})

test('salience follows the clock, the weight and the lists, and lands on the attention program’s levels', () => {
  const base = {weight: 3, today: false, currentRank: null, ready: false}
  const units = (hours: number, extra = {}) => salienceUnits(salienceOf({...base, hours, ...extra}))
  // Sooner matters more, all the way out.
  const hours = [-10, 2, 12, 30, 60, 120, 200, 400, 1000, 3000]
  for (let index = 1; index < hours.length; index++) assert.ok(units(hours[index]!) <= units(hours[index - 1]!), String(hours[index]))
  // An ordinary task leads when it is due within two days, opens within four, teases within a week, and rests a month out.
  assert.ok(units(40) >= thresholds.lead)
  assert.ok(units(90) >= thresholds.hook && units(90) < thresholds.lead)
  assert.ok(units(160) >= thresholds.teaser && units(160) < thresholds.hook)
  assert.ok(units(700) < thresholds.teaser)
  // Heavier, on Today, high in Current, or ready to start: each lifts it.
  assert.ok(units(90, {weight: 5}) > units(90))
  assert.ok(units(90, {today: true}) > units(90))
  assert.ok(units(90, {currentRank: 0}) > units(90, {currentRank: 4}) && units(90, {currentRank: 4}) > units(90, {currentRank: 9}))
  assert.ok(units(90, {ready: true}) > units(90))
  assert.ok(units(1, {weight: 5, today: true, currentRank: 0, ready: true}) <= 64)
})
