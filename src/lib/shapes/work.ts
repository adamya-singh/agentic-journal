// The started work of a hook, as blocks OpenClaw composes for the task in front of it. A reply to send is a
// letter; a homework problem is the problem with its first line of work; a form is its fields, some filled; a
// choice is its options; a talk is its slides. What a task opens to is built from these, so no two tasks need
// look alike, and the model decides which blocks a task gets and in what order.
// Plain data and no DOM, so the brief's validation, the prompt, the store and the tests all read it.
import {type Part, parsePart} from './catalog.ts'

export type WorkField = {label: string, value: string, needs?: boolean, hint?: string}
export type WorkOption = {title: string, detail?: string, points?: string[]}
export type WorkSlide = {title: string, body?: string, notes?: string}

export type WorkBlock =
  | {kind: 'doc', id: string, label?: string, body: string} // something to keep writing: an outline, notes, an essay
  | {kind: 'checklist', id: string, label?: string, body: string} // "- [ ]" lines to tick and add to
  | {kind: 'letter', id: string, to: string, subject: string, body: string} // a reply or message, drafted
  | {kind: 'problem', id: string, label?: string, prompt: string, given?: string, work: string} // a problem set up, its first line written
  | {kind: 'fields', id: string, label?: string, items: WorkField[]} // a form: what is filled, what needs him
  | {kind: 'choices', id: string, prompt: string, options: WorkOption[], picked?: number} // pick one
  | {kind: 'slides', id: string, items: WorkSlide[], at: number} // a deck, with the slide to work on
  | {kind: 'timer', id: string, label: string, seconds: number, steps?: string[]} // a rehearsal, a workout, a sprint
  | {kind: 'reading', id: string, title: string, by?: string, href?: string, excerpt?: string} // something to read
  | {kind: 'part', id: string, part: Part} // a picture from the shapes bank: a path, a number, facts
export type WorkKind = WorkBlock['kind']
export const workKinds: readonly WorkKind[] = ['doc', 'checklist', 'letter', 'problem', 'fields', 'choices', 'slides', 'timer', 'reading', 'part']

export const workLimits = {blocks: 6, body: 4000, text: 600, short: 120, items: 12, total: 12_000} as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isHttp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return false
  try { new URL(value.trim()); return true } catch { return false }
}
// Long text keeps its lines; a short one is a single line.
const long = (value: unknown, limit: number = workLimits.body) => typeof value === 'string' ? value.replace(/\r\n/g, '\n').slice(0, limit) : null
const short = (value: unknown, limit: number = workLimits.short) => {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const text = String(value).replace(/\s+/g, ' ').trim()
  return text === '' ? null : text.slice(0, limit)
}
const list = <T>(value: unknown, item: (value: unknown) => T | null): T[] =>
  (Array.isArray(value) ? value : []).slice(0, workLimits.items).map(item).filter(entry => entry !== null)
const optional = <K extends string>(key: K, value: string | null): {[P in K]?: string} => value === null ? {} : {[key]: value} as {[P in K]?: string}

function parseBlock(raw: unknown, index: number): {block: WorkBlock, problem: null} | {block: null, problem: string} {
  if (!isRecord(raw)) return {block: null, problem: `block ${index} dropped, it is not an object`}
  const kind = workKinds.find(each => each === raw['kind'])
  const id = short(raw['id'], 40) ?? `b${index}`
  const drop = (why: string) => ({block: null, problem: `${String(raw['kind'])} block dropped, ${why}`})
  switch (kind) {
    case 'doc':
    case 'checklist': {
      const body = long(raw['body'])
      // A checklist may also come as items: they become "- [ ]" lines.
      const lines = kind === 'checklist' && body === null
        ? list(raw['items'], item => { const text = short(isRecord(item) ? item['text'] : item); return text === null ? null : `- [${isRecord(item) && item['done'] === true ? 'x' : ' '}] ${text}` }).join('\n')
        : body
      if (lines === null || (kind === 'checklist' && lines.trim() === '')) return drop('it has no body')
      return {block: {kind, id, ...optional('label', short(raw['label'], 60)), body: lines}, problem: null}
    }
    case 'letter': {
      const body = long(raw['body'])
      if (body === null || body.trim() === '') return drop('it has no body')
      return {block: {kind, id, to: short(raw['to']) ?? '', subject: short(raw['subject']) ?? '', body}, problem: null}
    }
    case 'problem': {
      const prompt = long(raw['prompt'], workLimits.text)
      if (prompt === null || prompt.trim() === '') return drop('it has no prompt')
      return {block: {kind, id, ...optional('label', short(raw['label'], 60)), prompt, ...optional('given', long(raw['given'], workLimits.text)), work: long(raw['work']) ?? ''}, problem: null}
    }
    case 'fields': {
      const items = list(raw['items'], (item): WorkField | null => {
        const label = isRecord(item) ? short(item['label'], 60) : null
        if (!isRecord(item) || label === null) return null
        return {label, value: long(item['value'], workLimits.text) ?? '', ...item['needs'] === true ? {needs: true} : {}, ...optional('hint', short(item['hint']))}
      })
      if (items.length === 0) return drop('it has no fields')
      return {block: {kind, id, ...optional('label', short(raw['label'], 60)), items}, problem: null}
    }
    case 'choices': {
      const options = list(raw['options'], (item): WorkOption | null => {
        const title = isRecord(item) ? short(item['title']) : short(item)
        if (title === null) return null
        const points = isRecord(item) ? list(item['points'], point => short(point)).slice(0, 4) : []
        return {title, ...isRecord(item) ? optional('detail', short(item['detail'], workLimits.text)) : {}, ...points.length > 0 ? {points} : {}}
      }).slice(0, 5)
      if (options.length < 2) return drop('it needs at least two options')
      const picked = typeof raw['picked'] === 'number' && Number.isInteger(raw['picked']) && raw['picked'] >= 0 && raw['picked'] < options.length ? raw['picked'] : undefined
      return {block: {kind, id, prompt: short(raw['prompt'], workLimits.text) ?? 'Pick one', options, ...picked === undefined ? {} : {picked}}, problem: null}
    }
    case 'slides': {
      const items = list(raw['items'], (item): WorkSlide | null => {
        const title = isRecord(item) ? short(item['title']) : short(item)
        if (title === null) return null
        return {title, ...isRecord(item) ? optional('body', long(item['body'], workLimits.text)) : {}, ...isRecord(item) ? optional('notes', long(item['notes'], workLimits.text)) : {}}
      })
      if (items.length === 0) return drop('it has no slides')
      const at = typeof raw['at'] === 'number' && Number.isInteger(raw['at']) ? Math.max(0, Math.min(items.length - 1, raw['at'])) : 0
      return {block: {kind, id, items, at}, problem: null}
    }
    case 'timer': {
      const seconds = typeof raw['seconds'] === 'number' && Number.isFinite(raw['seconds']) ? Math.round(Math.max(10, Math.min(4 * 3600, raw['seconds']))) : null
      if (seconds === null) return drop('it has no seconds')
      const steps = list(raw['steps'], step => short(step))
      return {block: {kind, id, label: short(raw['label']) ?? 'Timer', seconds, ...steps.length > 0 ? {steps} : {}}, problem: null}
    }
    case 'reading': {
      const title = short(raw['title'], workLimits.short * 2)
      if (title === null) return drop('it has no title')
      return {block: {kind, id, title, ...optional('by', short(raw['by'])), ...isHttp(raw['href']) ? {href: raw['href'].trim()} : {}, ...optional('excerpt', long(raw['excerpt'], workLimits.text))}, problem: null}
    }
    case 'part': {
      const read = parsePart(raw['part'])
      if (read.part === null) return drop(read.problem)
      if (read.part.kind === 'embed' || read.part.kind === 'field' || read.part.kind === 'actions' || read.part.kind === 'media') return drop(`a ${read.part.kind} is not a picture of work`)
      const part = {...read.part}
      delete part.from
      return {block: {kind, id, part}, problem: null}
    }
    default:
      return {block: null, problem: `unknown block ${JSON.stringify(raw['kind'])} dropped`}
  }
}

/**
 * Reads the blocks OpenClaw (or the page, saving his edits) sent. Nothing sent can break the page: an unknown or
 * incomplete block is dropped and named in `problems`, text is cut to its limit, ids are made unique, and blocks
 * past the limit or past the total size are left out.
 */
export function parseBlocks(raw: unknown): {blocks: WorkBlock[], problems: string[]} {
  const problems: string[] = []
  const blocks: WorkBlock[] = []
  const seen = new Set<string>()
  let size = 0
  for (const [index, entry] of (Array.isArray(raw) ? raw : []).entries()) {
    const read = parseBlock(entry, index)
    if (read.block === null) { problems.push(read.problem); continue }
    if (blocks.length >= workLimits.blocks) { problems.push(`${read.block.kind} block dropped, a task opens to at most ${workLimits.blocks}`); continue }
    const block = seen.has(read.block.id) ? {...read.block, id: `${read.block.id}-${index}`} : read.block
    size += JSON.stringify(block).length
    if (size > workLimits.total) { problems.push(`${block.kind} block dropped, the work is over ${workLimits.total} characters`); break }
    if (hasSlot(block)) problems.push(`${block.kind} block has a fill-in slot like "[Insert …]": write the real thing or leave the line open`)
    seen.add(block.id)
    blocks.push(block)
  }
  return {blocks, problems}
}

// A bracketed blank for him to fill in ("[Insert quote]", "[Author]", "Session [X]"): template text, not work.
const SLOT = /\[(?:insert|your|author|year|x|n|specific|topic|name|date|title|tbd)\b[^\]\n]{0,80}\](?!\()/i
export const hasSlot = (block: WorkBlock) => SLOT.test(JSON.stringify(block).replace(/[-*]\s+\[[ xX]\]/g, ''))

/** A block he is meant to act in: where "jump in" points. Pictures, readings and timers are context. */
export const isActive = (block: WorkBlock) => block.kind !== 'part' && block.kind !== 'reading' && block.kind !== 'timer'

/** The blocks as the text OpenClaw reads in its brief prompt. */
export function workPrompt(): string {
  const {blocks, body, text, short: one} = workLimits
  return [
    `"work": null | {"title": at most ${one} characters, "href": optional link to where it gets finished or submitted, "blocks": [up to ${blocks} blocks]}`,
    'Compose the blocks for THIS task: what it opens to should look like the task. Pick the blocks that are the work, in the order he would use them, and put the one to act in first after any context. Do not pad with blocks that add nothing. Different tasks should get different blocks.',
    'Blocks (each is {"kind": "...", "id": a short stable name, ...}):',
    `- doc (label?, body): something to keep writing, as markdown: an outline, notes, an essay's opening. Leave the line to pick up from open, e.g. ending in ":" or mid-sentence. At most ${body} characters.`,
    '- checklist (label?, body): "- [ ]" and "- [x]" lines he ticks. Tick what you did.',
    '- letter (to, subject, body): a reply or message drafted for him to review. You never send it.',
    `- problem (label?, prompt, given?, work): one problem copied out exactly (at most ${text} characters), its data or code in given, and the first line of the work started in work.`,
    '- fields (label?, items: [{label, value, needs?, hint?}]): a form. Fill value where you can read the answer; set needs: true on the ones only he can answer, with a hint.',
    '- choices (prompt, options: [{title, detail?, points?}], picked?): two to five real options to pick from, each with what picking it would mean.',
    '- slides (items: [{title, body?, notes?}], at): a deck outlined slide by slide; at is the slide to work on first.',
    '- timer (label, seconds, steps?): a rehearsal, a workout or a timed sprint, with its steps.',
    '- reading (title, by?, href?, excerpt?): the thing to read, with where to open it. Follow it with a doc for his notes.',
    '- part (part): one read-only picture from the parts above, e.g. the steps to the deadline or a few facts.',
    'No fill-in slots. Never write a bracketed blank such as [Insert quote], [Author], [Year], [topic] or "Session [X]", and never a line that only describes what should go there. Where you read the real thing (the reading\'s title and author, the session, the example), write it. Where only he can supply the words, end the line with a colon and leave it open.',
    'Every word in a block must be true to what you read. Never invent a problem, a quote, a field, a slide or an option, and never fill a block with placeholder text. If you could not read the real thing (the problem set, the form, the thread), do not send that block: say what you could not reach in a flag instead.',
  ].join('\n')
}
