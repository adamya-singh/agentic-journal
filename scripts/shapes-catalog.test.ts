// The shapes bank's vocabulary (src/lib/shapes/catalog.ts) and the hook built on it (src/lib/shapes/hook.ts):
// whatever a model sends, the page gets something it can draw.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {parsePart, parseScene, partKinds, shapeIds, visibleParts} from '../src/lib/shapes/catalog.ts'
import {hookLimits, hookPartKinds, hookPrompt, hookShapes, iconForKind, parseHook} from '../src/lib/shapes/hook.ts'

test('nothing the model sends breaks a scene: unknown shapes become pills, bad parts drop, numbers clamp', () => {
  const {scene, problems} = parseScene({
    say: 'hi',
    things: [
      {id: 'a', title: 'A', shape: 'hologram', salience: 7, tone: 'loud', icon: 'nope', parts: [
        {kind: 'line', text: 'kept'}, {kind: 'sparkle'}, {kind: 'value'}, {kind: 'ring', value: 3, from: 9},
        {kind: 'rows', items: ['plain', {text: 'full', done: true}, {detail: 'no text'}]},
      ]},
      {id: 'a', title: 'the same id again'},
      {title: 'no id'},
      'not a thing',
    ],
  })
  assert.deepStrictEqual(scene.things, [{id: 'a', title: 'A', shape: 'pill', salience: 1, tone: 'calm', parts: [
    {kind: 'line', text: 'kept'}, {kind: 'ring', value: 1}, {kind: 'rows', items: [{text: 'plain'}, {text: 'full', done: true}]},
  ]}])
  assert.deepStrictEqual(problems.length, 6)
  assert.deepStrictEqual(parseScene('nonsense').scene.things, [])
})

test('a part reads back as itself, or says why it was dropped', () => {
  assert.deepStrictEqual(parsePart({kind: 'steps', items: ['Prep', 'Present'], at: 0}), {part: {kind: 'steps', items: ['Prep', 'Present'], at: 0}, problem: null})
  assert.match(parsePart({kind: 'steps', items: ['Prep']}).problem ?? '', /missing a property/)
  assert.match(parsePart('rows').problem ?? '', /unknown part/)
})

test('a shape picks its heart, and shows more as the level rises', () => {
  const thing = {id: 't', title: 'T', salience: 0, tone: 'calm' as const, parts: [
    {kind: 'value' as const, value: '7', unit: 'days'}, {kind: 'line' as const, text: 'one line'}, {kind: 'rows' as const, items: [{text: 'a'}]},
  ]}
  const kinds = (shape: typeof shapeIds[number], level: 0 | 1 | 2 | 3) => {
    const {heart, flow} = visibleParts({...thing, shape}, level)
    return [heart?.kind ?? null, flow.map(part => part.kind)]
  }
  assert.deepStrictEqual(kinds('orb', 0), ['value', []])
  assert.deepStrictEqual(kinds('orb', 2), ['value', ['line', 'rows']])
  assert.deepStrictEqual(kinds('list', 1), ['rows', ['value', 'line']])
  assert.deepStrictEqual(kinds('pill', 1), [null, ['value', 'line']])
})

const hook = {
  shape: 'note', icon: 'mail', kind: 'email', name: 'Confirm the Roadrunner call', next: 'Review your reply and send',
  what: 'Roadrunner’s recruiter invited you to an intro call on Thursday at 1 PM. It needs a reply.',
  did: ['Checked Thursday 12–2: free', 'Drafted your reply'],
  say: ['Confirm Thursday.', 'Your reply is drafted and Thursday at 1 is clear.'],
  parts: [{kind: 'quote', text: 'Thursday at 1:00 PM works for me.', by: 'Your reply'}, {kind: 'pairs', items: [{key: 'When', value: 'Thu 1:00 PM'}]}],
  work: {format: 'draft', title: 'Reply to the recruiter', body: 'Hi Michelle,\n\nThursday at 1:00 PM works for me.', href: 'https://mail.google.com/mail/u/0/#inbox/abc'},
}

test('a good hook reads back unchanged', () => {
  const read = parseHook(JSON.parse(JSON.stringify(hook)))
  assert.deepStrictEqual(read.problems, [])
  assert.deepStrictEqual(read.hook, hook)
})

test('nothing OpenClaw sends breaks a hook: it is cut to what the page can draw, or it is no hook', () => {
  const read = parseHook({
    ...hook, shape: 'stage', icon: 'rocket', kind: 'a kind that is far longer than a kind should ever be',
    name: `Study ${'very '.repeat(20)}hard`, did: ['one', 2, 'three', 'four', 'five', 'six'], say: ['only the ask'],
    parts: [{kind: 'media', look: 'slides'}, {kind: 'actions', items: [{label: 'Go', does: 'open'}]}, {kind: 'sparkle'}, {kind: 'value', value: '7', from: 0},
      ...Array.from({length: 8}, (_, index) => ({kind: 'line', text: `line ${index}`}))],
    work: {format: 'spreadsheet', body: 'x'.repeat(hookLimits.body + 50), href: 'javascript:alert(1)'},
  }, 'school').hook!
  assert.deepStrictEqual([read.shape, read.icon], ['pill', 'school'])
  assert.ok(read.kind.length <= hookLimits.kind && read.name.length <= hookLimits.name && read.name.endsWith('…'))
  assert.deepStrictEqual(read.did, ['one', 'three', 'four', 'five'])
  assert.deepStrictEqual(read.say, ['only the ask', hook.what])
  // No pictures or buttons from the model, no `from`, at most six parts.
  assert.deepStrictEqual(read.parts.map(part => part.kind), ['value', 'line', 'line', 'line', 'line', 'line'])
  assert.ok(read.parts.every(part => !('from' in part)))
  assert.deepStrictEqual([read.work?.format, read.work?.title, read.work?.body.length, read.work?.href], ['text', read.name, hookLimits.body, undefined])

  assert.deepStrictEqual(parseHook({...hook, name: ''}).hook, null)
  assert.deepStrictEqual(parseHook({...hook, what: undefined}).hook, null)
  assert.deepStrictEqual(parseHook(null), {hook: null, problems: []})
  assert.deepStrictEqual(parseHook('a hook').hook, null)
  assert.deepStrictEqual(parseHook({...hook, work: {format: 'draft', body: '  '}}).hook?.work, null)
})

test('the hook prompt names every shape, part and field a hook may have, and keeps the work inside the reply', () => {
  const prompt = hookPrompt()
  for (const name of [...hookShapes, ...hookPartKinds, 'shape', 'icon', 'kind', 'name', 'next', 'what', 'did', 'say', 'parts', 'work', 'body']) {
    assert.ok(prompt.includes(name), name)
  }
  for (const kind of partKinds.filter(each => !hookPartKinds.includes(each))) assert.ok(!prompt.includes(`- ${kind} (`), kind)
  assert.match(prompt, /ONLY inside this reply/)
  assert.match(prompt, /no email drafts, no documents, no files/)
  assert.deepStrictEqual([iconForKind('exam'), iconForKind('something new')], ['problem', 'doc'])
})
