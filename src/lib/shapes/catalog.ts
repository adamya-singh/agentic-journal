// The vocabulary between the model and the page. The model never writes HTML or CSS. Each turn it sends a Scene: a
// flat list of things, and for each thing the shape it should take, how much it matters, and the parts it carries.
// Everything here is plain data with no DOM, so the server, the prompt and the tests can all read it.
//
// - A shape is the outer form of a thing: its outline, how wide it is at each level, and which part it draws as its
//   heart, e.g. an orb's heart is a value or a ring, a list's is its rows.
// - A part is one element inside a shape: a line, a value, rows, a timeline, actions. A thing may carry more parts
//   than its shape shows. The same thing can be an orb now and a list next turn, with no change to its parts.
// - A level, 0 to 3, is how open a thing is: 0 a plain bubble, 1 a teaser, 2 a hook, 3 the lead. The model doesn't
//   pick it. It says a salience, and the attention program (sunrise/attention.ts) gives the level this screen has room for.
//
// The flat list with stable ids and a catalog the model picks from follows A2UI and json-render. What this adds is
// the level: one thing keeps one element as it opens and closes.

export const shapeIds = ['pill', 'orb', 'card', 'tile', 'list', 'band', 'stat', 'note', 'stage'] as const
export type ShapeId = typeof shapeIds[number]
export const tones = ['calm', 'cool', 'warm', 'hot', 'done'] as const
export type Tone = typeof tones[number]
export const iconNames = [
  'slides', 'notes', 'event', 'problem', 'call', 'jobs', 'code', 'timer', 'video', 'school', 'read', 'link', 'doc', 'app',
  'spark', 'check', 'sun', 'list', 'chart', 'mail', 'flame', 'clock', 'workout',
] as const
export type IconName = typeof iconNames[number]
export type Level = 0 | 1 | 2 | 3
// As many things as the layout program has slots (layout.ts's slotCount).
export const maximumThings = 16

// A row may carry a small bar (meter, 0 to 1) and may be marked hot, e.g. the one that is late.
export type Row = {text: string, detail?: string, done?: boolean, meter?: number, hot?: boolean}
export type Mark = {at: number, to?: number, label: string}
export type Count = {label: string, value: number}
export type Dot = {label: string, value: number}
export type Action = {label: string, does: string, quiet?: boolean}
export type Pair = {key: string, value: string}

type Parts = {
  line: {text: string}
  prose: {text: string}
  quote: {text: string, by?: string}
  value: {value: string, unit?: string, label?: string, delta?: string}
  meter: {value: number, label?: string, target?: number}
  ring: {value: number, label?: string, of?: number}
  spark: {points: number[], label?: string, bars?: boolean, ticks?: string[]}
  dots: {items: Dot[], at?: number}
  rows: {items: Row[], check?: boolean}
  pairs: {items: Pair[]}
  steps: {items: string[], at: number}
  timeline: {marks: Mark[], now?: number, ticks?: string[]}
  segments: {items: Count[]}
  chips: {items: string[]}
  person: {name: string, line?: string, status?: string}
  media: {look: string, caption?: string, progress?: number}
  code: {text: string, name?: string}
  clock: {seconds: number}
  field: {placeholder: string}
  actions: {items: Action[]}
  embed: {app: string, url: string}
}
export type PartKind = keyof Parts
// `from` is the first level a part shows at. Left out, the shape and the part's kind decide (firstLevel below).
export type Part = {[K in PartKind]: {kind: K, from?: Level} & Parts[K]}[PartKind]
export type PartOf<K extends PartKind> = Extract<Part, {kind: K}>

export type Thing = {
  id: string // stable across turns: the same id keeps its element and moves
  shape: ShapeId
  title: string
  salience: number // 0 to 1, how much it matters right now
  tone: Tone
  icon?: IconName
  when?: string // a short time or date beside the title, e.g. "Thu 1 PM"
  parts: Part[]
}
export type Scene = {say?: string, things: Thing[]}

// What a property holds. A trailing "?" marks it optional. `unit` is a number from 0 to 1.
type Prop = 'text' | 'number' | 'unit' | 'flag' | 'texts' | 'numbers' | 'rows' | 'marks' | 'counts' | 'dots' | 'actions' | 'pairs'
type PropSpec = Prop | `${Prop}?`
type PartSpec<K extends PartKind> = {says: string, from: Level, props: {[P in keyof Parts[K]]-?: PropSpec}}

export const parts: {[K in PartKind]: PartSpec<K>} = {
  line: {says: 'one short supporting line', from: 1, props: {text: 'text'}},
  prose: {says: 'a paragraph of plain text', from: 2, props: {text: 'text'}},
  quote: {says: 'a passage in someone’s words, set in serif', from: 2, props: {text: 'text', by: 'text?'}},
  value: {says: 'one big number or short word with a unit, e.g. 7 days; delta is its change, e.g. +2', from: 1, props: {value: 'text', unit: 'text?', label: 'text?', delta: 'text?'}},
  meter: {says: 'a bar filled to a fraction, with an optional notch at a target', from: 2, props: {value: 'unit', label: 'text?', target: 'unit?'}},
  ring: {says: 'a ring filled to a fraction, with a short label inside; of splits it into that many arcs, e.g. 5 problems', from: 1, props: {value: 'unit', label: 'text?', of: 'number?'}},
  spark: {says: 'a small chart of a series, a line or bars, the last point marked; ticks name the points', from: 2, props: {points: 'numbers', label: 'text?', bars: 'flag?', ticks: 'texts?'}},
  dots: {says: 'a row of days or tries, each filled by how much was done, with today outlined', from: 2, props: {items: 'dots', at: 'number?'}},
  rows: {says: 'a list of items, each with an optional detail; check makes them checkboxes', from: 2, props: {items: 'rows', check: 'flag?'}},
  pairs: {says: 'facts as key and value', from: 2, props: {items: 'pairs'}},
  steps: {says: 'an ordered path with the current step marked', from: 2, props: {items: 'texts', at: 'number'}},
  timeline: {says: 'blocks along a span of time, each at a fraction of it, with now; ticks label the span evenly, e.g. 9a to 9p', from: 2, props: {marks: 'marks', now: 'unit?', ticks: 'texts?'}},
  segments: {says: 'one bar split by counts, e.g. late, this week, later', from: 2, props: {items: 'counts'}},
  chips: {says: 'a few short tags', from: 2, props: {items: 'texts'}},
  person: {says: 'a person: their initial in a circle, name, a line, and a status such as free now', from: 1, props: {name: 'text', line: 'text?', status: 'text?'}},
  media: {says: 'a picture area; look is image, video, chart or slides', from: 2, props: {look: 'text', caption: 'text?', progress: 'unit?'}},
  code: {says: 'a few lines of code, numbered, under an optional file or problem name', from: 2, props: {text: 'text', name: 'text?'}},
  clock: {says: 'a countdown from a number of seconds', from: 1, props: {seconds: 'number'}},
  field: {says: 'one text input', from: 3, props: {placeholder: 'text'}},
  actions: {says: 'buttons; the first is the main one, and the only one a hook shows', from: 2, props: {items: 'actions'}},
  embed: {says: 'the app the work happens in, opened to the right place', from: 2, props: {app: 'text', url: 'text'}},
}
export const partKinds = Object.keys(parts) as PartKind[]

type ShapeSpec = {
  says: string // what it looks like
  use: string // when the model should pick it
  widths: [number, number, number] // the width in px it reads well at, as a teaser, a hook and the lead; closed, it is as wide as its text
  hearts: PartKind[] // the first part of one of these kinds is drawn as the shape's heart
  heartFrom: Level // the level the heart shows from
}
export const shapes: Record<ShapeId, ShapeSpec> = {
  pill: {says: 'a glass bubble holding a name and one line', use: 'the default: anything that only needs naming', widths: [240, 300, 420], hearts: [], heartFrom: 0},
  orb: {says: 'a circle around one value, ring, countdown or person', use: 'a thing that is one number, a streak, a timer or someone to call', widths: [250, 270, 380], hearts: ['value', 'ring', 'clock', 'person', 'meter'], heartFrom: 0},
  card: {says: 'a titled surface with parts stacked inside', use: 'a thing with a prepared first step and something to press', widths: [280, 340, 460], hearts: [], heartFrom: 0},
  tile: {says: 'a picture first, the name under it', use: 'a thing you recognise by sight: slides, a video, a chart, code', widths: [250, 340, 520], hearts: ['media', 'spark', 'code'], heartFrom: 1},
  list: {says: 'a name with rows under it and a count', use: 'a thing that is several things: a queue, a checklist, facts', widths: [270, 320, 440], hearts: ['rows', 'pairs'], heartFrom: 1},
  band: {says: 'a wide strip along time or steps', use: 'a day, a week, a path with stages, a split by counts', widths: [330, 500, 760], hearts: ['timeline', 'steps', 'segments', 'dots'], heartFrom: 0},
  stat: {says: 'a big number with its trend', use: 'a measure that changes: a count, a streak, time spent', widths: [210, 260, 380], hearts: ['value'], heartFrom: 0},
  note: {says: 'a passage of text in serif', use: 'words to read: a quote, a summary, what the agent noticed', widths: [300, 380, 540], hearts: ['quote', 'prose'], heartFrom: 1},
  stage: {says: 'a large working surface with the app inside', use: 'the one thing being worked on right now', widths: [300, 620, 1100], hearts: ['embed'], heartFrom: 2},
}

/** The level a part first shows at inside a shape. */
export function firstLevel(shape: ShapeId, part: Part, isHeart: boolean): Level {
  return part.from ?? (isHeart ? shapes[shape].heartFrom : parts[part.kind].from)
}
/** What a thing shows at a level: its heart, if its shape has one and the level reaches it, and the parts under it. */
export function visibleParts(thing: Thing, level: Level): {heart: Part | null, flow: Part[]} {
  const hearts = shapes[thing.shape].hearts
  const heart = thing.parts.find(part => hearts.includes(part.kind)) ?? null
  return {
    heart: heart !== null && level >= firstLevel(thing.shape, heart, true) ? heart : null,
    flow: thing.parts.filter(part => part !== heart && level >= firstLevel(thing.shape, part, false)),
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))
const maximumText = 400
const maximumItems = 12
const asText = (value: unknown) => typeof value === 'string' ? value.slice(0, maximumText) : typeof value === 'number' ? String(value) : null
const asNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
// One text of a list. A model often sends a stage as an object ({label, date}); that reads as "Label · date"
// rather than being dropped, so real stages are not lost to their wrapping.
const asLabel = (value: unknown) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return asText(value)
  const record = value as Record<string, unknown>
  const name = asText(record['label'] ?? record['name'] ?? record['title'] ?? record['text'] ?? record['step'])
  if (name === null || name.trim() === '') return null
  const when = asText(record['date'] ?? record['when'] ?? record['due'])
  return (when === null || when.trim() === '' ? name : `${name} · ${when}`).slice(0, maximumText)
}
/** A part that is a list with nothing in it: there is nothing to draw. */
export const isEmptyPart = (part: Part) => 'items' in part && part.items.length === 0
const asList = <T>(value: unknown, item: (value: unknown) => T | null): T[] | null => {
  if (!Array.isArray(value)) return null
  return value.slice(0, maximumItems).map(item).filter(entry => entry !== null)
}
// One object of a list, from the fields it needs and the ones it may have.
const asObject = <T>(value: unknown, fields: Record<string, PropSpec>): T | null => {
  if (!isRecord(value)) return null
  const result: Record<string, unknown> = {}
  for (const [name, spec] of Object.entries(fields)) {
    const read = readProp(value[name], spec.replace('?', '') as Prop)
    if (read !== null) result[name] = read
    else if (!spec.endsWith('?')) return null
  }
  return result as T
}
const rowProps: Record<string, PropSpec> = {text: 'text', detail: 'text?', done: 'flag?', meter: 'unit?', hot: 'flag?'}
function readProp(value: unknown, prop: Prop): unknown {
  switch (prop) {
    case 'text': return asText(value)
    case 'number': return asNumber(value)
    case 'unit': {
      const number = asNumber(value)
      return number === null ? null : clamp(number, 0, 1)
    }
    case 'flag': return typeof value === 'boolean' ? value : null
    case 'texts': return asList(value, asLabel)
    case 'numbers': return asList(value, asNumber)
    case 'rows': return asList(value, item => typeof item === 'string' ? {text: item} : asObject<Row>(item, rowProps))
    case 'marks': return asList(value, item => asObject<Mark>(item, {at: 'unit', to: 'unit?', label: 'text'}))
    case 'counts': return asList(value, item => asObject<Count>(item, {label: 'text', value: 'number'}))
    case 'dots': return asList(value, item => asObject<Dot>(item, {label: 'text', value: 'unit'}))
    case 'actions': return asList(value, item => asObject<Action>(item, {label: 'text', does: 'text', quiet: 'flag?'}))
    case 'pairs': return asList(value, item => asObject<Pair>(item, {key: 'text', value: 'text'}))
  }
}
const asLevel = (value: unknown): Level | null => value === 0 || value === 1 || value === 2 || value === 3 ? value : null
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => allowed.find(entry => entry === value) ?? null

/** Reads one part. An unknown kind or a part missing a property comes back as null with the reason. */
export function parsePart(rawPart: unknown): {part: Part, problem: null} | {part: null, problem: string} {
  const kind = isRecord(rawPart) ? oneOf(rawPart['kind'], partKinds) : null
  if (!isRecord(rawPart) || kind === null) {
    return {part: null, problem: `unknown part ${JSON.stringify(isRecord(rawPart) ? rawPart['kind'] : rawPart)} dropped`}
  }
  const part = asObject<Record<string, unknown>>(rawPart, parts[kind].props)
  if (part === null) return {part: null, problem: `${kind} dropped, it is missing a property`}
  const from = asLevel(rawPart['from'])
  return {part: {kind, ...from === null ? {} : {from}, ...part} as Part, problem: null}
}

/**
 * Reads what the model sent into a Scene the page can draw. Nothing the model sends can break the page: an unknown
 * shape becomes a pill, an unknown part or one missing a property is dropped, numbers are clamped, and each drop is
 * named in `problems`.
 */
export function parseScene(raw: unknown): {scene: Scene, problems: string[]} {
  const problems: string[] = []
  const scene: Scene = {things: []}
  if (!isRecord(raw)) return {scene, problems: ['the scene is not an object']}
  const say = asText(raw['say'])
  if (say !== null) scene.say = say
  const things = Array.isArray(raw['things']) ? raw['things'] : []
  if (things.length > maximumThings) problems.push(`${things.length - maximumThings} things past the first ${maximumThings} dropped`)
  const seen = new Set<string>()
  for (const [index, entry] of things.slice(0, maximumThings).entries()) {
    const id = isRecord(entry) ? asText(entry['id']) : null
    const title = isRecord(entry) ? asText(entry['title']) : null
    if (!isRecord(entry) || id === null || title === null || seen.has(id)) {
      problems.push(`thing ${index}: dropped, it needs a title and an id of its own`)
      continue
    }
    seen.add(id)
    const shape = oneOf(entry['shape'], shapeIds)
    if (shape === null) problems.push(`${id}: unknown shape ${JSON.stringify(entry['shape'])}, drawn as a pill`)
    const thing: Thing = {
      id, title, shape: shape ?? 'pill',
      salience: clamp(asNumber(entry['salience']) ?? 0, 0, 1),
      tone: oneOf(entry['tone'], tones) ?? 'calm',
      parts: [],
    }
    const icon = oneOf(entry['icon'], iconNames)
    if (icon !== null) thing.icon = icon
    const when = asText(entry['when'])
    if (when !== null) thing.when = when
    for (const rawPart of Array.isArray(entry['parts']) ? entry['parts'].slice(0, maximumItems) : []) {
      const read = parsePart(rawPart)
      if (read.part === null) problems.push(`${id}: ${read.problem}`)
      else thing.parts.push(read.part)
    }
    scene.things.push(thing)
  }
  return {scene, problems}
}

const propSchema = (prop: Prop): Record<string, unknown> => {
  const object = (properties: Record<string, PropSpec>) => ({type: 'array', items: objectSchema(properties)})
  switch (prop) {
    case 'text': return {type: 'string'}
    case 'number': return {type: 'number'}
    case 'unit': return {type: 'number', description: '0 to 1'}
    case 'flag': return {type: 'boolean'}
    case 'texts': return {type: 'array', items: {type: 'string'}}
    case 'numbers': return {type: 'array', items: {type: 'number'}}
    case 'rows': return object(rowProps)
    case 'marks': return object({at: 'unit', to: 'unit?', label: 'text'})
    case 'counts': return object({label: 'text', value: 'number'})
    case 'dots': return object({label: 'text', value: 'unit'})
    case 'actions': return object({label: 'text', does: 'text', quiet: 'flag?'})
    case 'pairs': return object({key: 'text', value: 'text'})
  }
}
function objectSchema(properties: Record<string, PropSpec>, extra: Record<string, unknown> = {}) {
  return {
    type: 'object', additionalProperties: false,
    properties: {...extra, ...Object.fromEntries(Object.entries(properties).map(([name, spec]) => [name, propSchema(spec.replace('?', '') as Prop)]))},
    required: [...Object.keys(extra).filter(name => name !== 'from'), ...Object.entries(properties).filter(([, spec]) => !spec.endsWith('?')).map(([name]) => name)],
  }
}
/**
 * The Scene as a JSON Schema, for the model's structured output. Built from the tables above, so it can't drift.
 * @public The intent server will send it; today only the test reads it.
 */
export function sceneJsonSchema() {
  return {
    type: 'object', additionalProperties: false, required: ['things'],
    properties: {
      say: {type: 'string', description: 'one sentence the page says above everything'},
      things: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['id', 'shape', 'title', 'salience', 'tone', 'parts'],
          properties: {
            id: {type: 'string'}, shape: {enum: shapeIds}, title: {type: 'string'},
            salience: {type: 'number', description: '0 to 1, how much it matters right now'},
            tone: {enum: tones}, icon: {enum: iconNames}, when: {type: 'string'},
            parts: {type: 'array', items: {anyOf: partKinds.map(kind => objectSchema(parts[kind].props, {kind: {const: kind}, from: {enum: [0, 1, 2, 3]}}))}},
          },
        },
      },
    },
  }
}

/**
 * The catalog as the text the model reads in its system prompt.
 * @public The intent server will send it; today only the test reads it.
 */
/** A part kind as one line of a prompt: its properties (optional ones end in "?") and what it draws. */
export function partLine(kind: PartKind): string {
  const props = Object.entries(parts[kind].props as Record<string, PropSpec>).map(([name, prop]) => prop.endsWith('?') ? `${name}?` : name).join(', ')
  return `- ${kind} (${props}): ${parts[kind].says}.`
}

export function catalogPrompt(): string {
  return [
    `You compose a page. Send a scene: up to ${maximumThings} things, each with a stable id, a shape, a title, a salience from 0 to 1, a tone (${tones.join(', ')}) and parts.`,
    'You never choose sizes or positions. Salience decides how open a thing is: the screen opens the most salient few and keeps the rest as small bubbles.',
    'Give a thing every part it has, not only the ones its shape draws first. Keep an id the same across turns so the thing moves instead of being replaced.',
    '',
    'Shapes:',
    ...shapeIds.map(id => `- ${id}: ${shapes[id].says}. Use for ${shapes[id].use}.${shapes[id].hearts.length === 0 ? '' : ` Its heart is the first ${shapes[id].hearts.join(' or ')}.`}`),
    '',
    'Parts:',
    ...partKinds.map(partLine),
    '',
    `Icons: ${iconNames.join(', ')}.`,
    '',
    'Write for one glance:',
    '- A title is the thing in at most 4 words, as the person would say it. No dates or verbs it does not need.',
    '- when is the one time that matters, at most 3 words: "tonight", "Thu 1 PM", "in 2 days".',
    '- A line is one fact that makes starting easy, at most 8 words, and never repeats the title.',
    '- Put the part that makes the thing recognisable first. Give at most one of each kind.',
    '- Every thing worth opening has actions, and the first is the next step as a verb: "Call", "Pick one", "Start 25 min".',
    '- tone hot is for the one or two things that are late or happening now; warm for what the agent prepared; done for finished.',
  ].join('\n')
}
