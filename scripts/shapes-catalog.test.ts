// The shapes bank's vocabulary (src/lib/shapes/catalog.ts) and the hook built on it (src/lib/shapes/hook.ts):
// whatever a model sends, the page gets something it can draw.
import assert from 'node:assert/strict'
import {test} from 'node:test'
import {parsePart, parseScene, partKinds, shapeIds, visibleParts} from '../src/lib/shapes/catalog.ts'
import {hookLimits, hookPartKinds, hookPrompt, hookShapes, iconForKind, parseHook} from '../src/lib/shapes/hook.ts'
import {isActive, parseBlocks, workKinds, workLimits} from '../src/lib/shapes/work.ts'

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
  work: {title: 'Reply to the recruiter', href: 'https://mail.google.com/mail/u/0/#inbox/abc', blocks: [
    {kind: 'letter', id: 'reply', to: 'Michelle Galan', subject: 'Re: Intro call', body: 'Hi Michelle,\n\nThursday at 1:00 PM works for me.'},
  ]},
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
    parts: [{kind: 'media', look: 'slides'}, {kind: 'actions', items: [{label: 'Go', does: 'open'}]}, {kind: 'sparkle'}, {kind: 'value', value: '7', unit: 'days left', from: 0},
      ...Array.from({length: 8}, (_, index) => ({kind: 'line', text: `line ${index}`}))],
    work: {body: 'Plain text sent as the work.', href: 'javascript:alert(1)'},
  }, 'school').hook!
  assert.deepStrictEqual([read.shape, read.icon], ['pill', 'school'])
  assert.ok(read.kind.length <= hookLimits.kind && read.name.length <= hookLimits.name && read.name.endsWith('…'))
  assert.deepStrictEqual(read.did, ['one', 'three', 'four', 'five'])
  assert.deepStrictEqual(read.say, ['only the ask', hook.what])
  // No pictures or buttons from the model, no `from`, at most six parts.
  assert.deepStrictEqual(read.parts.map(part => part.kind), ['value', 'line', 'line', 'line', 'line', 'line'])
  assert.ok(read.parts.every(part => !('from' in part)))
  // Work sent as plain text becomes one document; a link that is not http(s) is dropped.
  assert.deepStrictEqual([read.work?.title, read.work?.href, read.work?.blocks], [read.name, undefined, [{kind: 'doc', id: 'doc', body: 'Plain text sent as the work.'}]])

  // A number that does not say what it counts means nothing to him: it is dropped.
  const bare = parseHook({...hook, parts: [{kind: 'ring', value: 0.6}, {kind: 'value', value: '3'}, {kind: 'ring', value: 0.4, label: '2/5 problems', of: 5}, {kind: 'value', value: '7', unit: 'days left'}]})
  assert.deepStrictEqual(bare.hook?.parts, [{kind: 'ring', value: 0.4, label: '2/5 problems', of: 5}, {kind: 'value', value: '7', unit: 'days left'}])
  assert.deepStrictEqual(bare.problems.length, 2)
  assert.deepStrictEqual(parseHook({...hook, name: ''}).hook, null)
  assert.deepStrictEqual(parseHook({...hook, what: undefined}).hook, null)
  assert.deepStrictEqual(parseHook(null), {hook: null, problems: []})
  assert.deepStrictEqual(parseHook('a hook').hook, null)
  assert.deepStrictEqual(parseHook({...hook, work: {body: '  '}}).hook?.work, null)
  assert.deepStrictEqual(parseHook({...hook, work: {blocks: [{kind: 'hologram'}]}}).hook?.work, null)
})

test('the hook prompt names every shape, part and field a hook may have, and keeps the work inside the reply', () => {
  const prompt = hookPrompt()
  for (const name of [...hookShapes, ...hookPartKinds, ...workKinds, 'shape', 'icon', 'kind', 'name', 'next', 'what', 'did', 'say', 'parts', 'work', 'blocks']) {
    assert.ok(prompt.includes(name), name)
  }
  for (const kind of partKinds.filter(each => !hookPartKinds.includes(each))) assert.ok(!prompt.includes(`- ${kind} (`), kind)
  assert.match(prompt, /ONLY inside this reply/)
  assert.match(prompt, /no email drafts, no documents, no files/)
  // Every part is tied to something read: real stages, real counts, or nothing.
  assert.match(prompt, /Never generic stages/)
  assert.match(prompt, /Never a fraction or number you chose/)
  assert.match(prompt, /send no parts/)
  assert.match(prompt, /never fill a block with placeholder text/)
  assert.deepStrictEqual([iconForKind('exam'), iconForKind('something new')], ['problem', 'doc'])
})

test('the work is blocks composed for the task: each kind reads back, and nothing sent can break the page', () => {
  const sent = [
    {kind: 'part', id: 'path', part: {kind: 'steps', items: ['Prep', 'Present'], at: 0}},
    {kind: 'problem', id: 'p1', label: 'Problem 1', prompt: 'Show that the line passes through the means.', given: 'y = b0 + b1 x', work: 'At x = '},
    {kind: 'fields', id: 'form', items: [{label: 'Name', value: 'Adamya Singh'}, {label: 'Address', value: '', needs: true, hint: 'Where to send it'}]},
    {kind: 'choices', id: 'pick', prompt: 'Which chart?', options: [{title: 'Wind map', points: ['Live data']}, {title: 'Streamgraph'}], picked: 1},
    {kind: 'slides', id: 'deck', items: [{title: 'Title', notes: 'Say why'}, {title: 'The point', body: '- '}], at: 1},
    {kind: 'timer', id: 'run', label: 'Rehearse', seconds: 180, steps: ['Open', 'Close']},
  ]
  const read = parseBlocks(JSON.parse(JSON.stringify(sent)))
  assert.deepStrictEqual(read.problems, [])
  assert.deepStrictEqual(read.blocks, sent)
  // The block to jump into is the first one he acts in, not the picture before it.
  assert.deepStrictEqual(read.blocks.findIndex(isActive), 1)

  const messy = parseBlocks([
    {kind: 'checklist', items: ['Read it', {text: 'Draft it', done: true}]},
    {kind: 'letter', id: 'a', to: 'x', subject: 'y'}, // no body
    {kind: 'choices', id: 'b', options: [{title: 'Only one'}]},
    {kind: 'slides', id: 'c', items: [{title: 'One'}], at: 9},
    {kind: 'timer', id: 'c', label: 'Sprint', seconds: 99999},
    {kind: 'reading', id: 'd', title: 'An essay', href: 'javascript:alert(1)'},
    {kind: 'part', id: 'e', part: {kind: 'embed', app: 'x', url: 'y'}},
    {kind: 'doc', id: 'f', body: 'x'.repeat(workLimits.body + 100)},
    'not a block',
  ])
  assert.deepStrictEqual(messy.blocks.map(block => block.kind), ['checklist', 'slides', 'timer', 'reading', 'doc'])
  const [checklist, slides, timer, reading, doc] = messy.blocks
  assert.deepStrictEqual(checklist, {kind: 'checklist', id: 'b0', body: '- [ ] Read it\n- [x] Draft it'})
  assert.deepStrictEqual(slides?.kind === 'slides' && slides.at, 0)
  assert.deepStrictEqual(timer?.kind === 'timer' && [timer.id, timer.seconds], ['c-4', 4 * 3600]) // a repeated id is made its own
  assert.deepStrictEqual(reading?.kind === 'reading' && reading.href, undefined)
  assert.deepStrictEqual(doc?.kind === 'doc' && doc.body.length, workLimits.body)
  assert.deepStrictEqual(messy.problems.length, 4)
  // At most six blocks, and anything that is not a list is no blocks.
  assert.deepStrictEqual(parseBlocks(Array.from({length: 9}, (_, index) => ({kind: 'doc', id: `d${index}`, body: 'x'}))).blocks.length, workLimits.blocks)
  assert.deepStrictEqual(parseBlocks('blocks').blocks, [])
})
