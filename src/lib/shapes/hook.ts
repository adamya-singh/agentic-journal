// A task's hook: OpenClaw has already started the task and left it at the best place to jump in. Sunrise draws
// every task from one, so each reads the same way:
// - `kind` is what sort of thing it is ("talk", "homework"); the journal puts the subject before it;
// - `name` says the task in plain words, starting with a verb; `next` is the one step to take now;
// - `what` is a sentence on what the task is; `did` is what OpenClaw did to get it ready;
// - `say` is what the page says when this task leads: the ask, then why it is easy now;
// - `parts` are a picture of the work in the shapes bank's parts (catalog.ts); `shape` is its outline;
// - `work` is the started work itself: the drafted reply, the outline, the problem set up. It lives only here, in
//   the journal. OpenClaw creates nothing anywhere else.
// Plain data and no DOM, so the brief's validation, the prompt and the tests all read it.
import {type IconName, type Part, type PartKind, type ShapeId, iconNames, parsePart, partKinds, partLine, shapes} from './catalog.ts'

export const workFormats = ['draft', 'outline', 'checklist', 'text'] as const
export type WorkFormat = typeof workFormats[number]
export type HookWork = {format: WorkFormat, title: string, body: string, href?: string}
export type TaskHook = {
  shape: ShapeId
  icon: IconName
  kind: string
  name: string
  next: string
  what: string
  did: string[]
  say: [string, string]
  parts: Part[]
  work: HookWork | null
}

// The outlines a small form has (forms.ts draws these), and the parts a hook may carry. Left out: the parts with no
// real source in the journal (a picture, an embedded app), a countdown, a text input, and buttons, which the page
// adds itself.
export const hookShapes = ['pill', 'orb', 'tile', 'list', 'band', 'note'] as const satisfies readonly ShapeId[]
const leftOut: readonly PartKind[] = ['media', 'embed', 'clock', 'field', 'actions']
export const hookPartKinds = partKinds.filter(kind => !leftOut.includes(kind))

// The icon for a task when OpenClaw names none, from the kind the brief's rules gave it (task-brief.ts's BriefKind).
const kindIcons: Record<string, IconName> = {
  assessment: 'code', exam: 'problem', assignment: 'school', 'catch-up': 'notes', presentation: 'slides', reading: 'read',
  build: 'code', errand: 'check', plan: 'list', task: 'doc',
}
export const iconForKind = (kind: string): IconName => kindIcons[kind] ?? 'doc'

export const hookLimits = {kind: 24, name: 60, next: 60, what: 240, did: 4, didText: 80, ask: 60, why: 120, parts: 6, title: 80, body: 4000} as const

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | null => allowed.find(entry => entry === value) ?? null
// A short text within its limit. Longer text is cut at a word with an ellipsis rather than dropped.
function clip(value: unknown, limit: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  if (text === '') return null
  if (text.length <= limit) return text
  const cut = text.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
const isHttp = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) return false
  try { new URL(value.trim()); return true } catch { return false }
}

/**
 * Reads the hook OpenClaw sent. Nothing it sends can break the page: an unknown shape becomes a pill, an unknown
 * icon the fallback, a bad part is dropped, long text is cut. A hook with no name or no sentence on what the task is
 * is no hook, and comes back null. Each thing dropped or changed is named in `problems`.
 */
export function parseHook(raw: unknown, fallbackIcon: IconName = 'doc'): {hook: TaskHook | null, problems: string[]} {
  const problems: string[] = []
  if (!isRecord(raw)) return {hook: null, problems: raw === null || raw === undefined ? [] : ['the hook is not an object']}
  const name = clip(raw['name'], hookLimits.name)
  const what = clip(raw['what'], hookLimits.what)
  if (name === null || what === null) return {hook: null, problems: ['the hook needs a name and what the task is']}

  const shape = oneOf<ShapeId>(raw['shape'], hookShapes)
  if (shape === null) problems.push(`unknown shape ${JSON.stringify(raw['shape'])}, drawn as a pill`)
  const icon = oneOf(raw['icon'], iconNames)
  const did = (Array.isArray(raw['did']) ? raw['did'] : []).map(item => clip(item, hookLimits.didText)).filter(item => item !== null).slice(0, hookLimits.did)
  const say = Array.isArray(raw['say']) ? raw['say'] : []

  const parts: Part[] = []
  for (const rawPart of Array.isArray(raw['parts']) ? raw['parts'] : []) {
    const read = parsePart(rawPart)
    if (read.part === null) problems.push(read.problem)
    else if (!hookPartKinds.includes(read.part.kind)) problems.push(`${read.part.kind} dropped, a hook does not carry it`)
    else if (parts.length >= hookLimits.parts) problems.push(`${read.part.kind} dropped, a hook carries at most ${hookLimits.parts} parts`)
    else {
      // The page decides what shows at which level.
      const part = {...read.part}
      delete part.from
      parts.push(part)
    }
  }

  let work: HookWork | null = null
  const rawWork = raw['work']
  if (isRecord(rawWork) && typeof rawWork['body'] === 'string' && rawWork['body'].trim() !== '') {
    let body = rawWork['body'].replace(/\r\n/g, '\n').trim()
    if (body.length > hookLimits.body) {
      problems.push(`the work was cut at ${hookLimits.body} characters`)
      body = body.slice(0, hookLimits.body)
    }
    work = {
      format: oneOf(rawWork['format'], workFormats) ?? 'text',
      title: clip(rawWork['title'], hookLimits.title) ?? name,
      body,
      ...isHttp(rawWork['href']) ? {href: rawWork['href'].trim()} : {},
    }
  } else if (rawWork !== null && rawWork !== undefined) {
    problems.push('the work dropped, it has no body')
  }

  return {
    hook: {
      shape: shape ?? 'pill', icon: icon ?? fallbackIcon,
      kind: clip(raw['kind'], hookLimits.kind) ?? '',
      name, next: clip(raw['next'], hookLimits.next) ?? '', what, did,
      say: [clip(say[0], hookLimits.ask) ?? name, clip(say[1], hookLimits.why) ?? what],
      parts, work,
    },
    problems,
  }
}

/** The hook as the text OpenClaw reads in its brief prompt. Built from the catalog's tables, so it can't drift. */
export function hookPrompt(): string {
  const {name, next, what, did, didText, ask, why, parts, kind, title, body} = hookLimits
  return [
    'The hook. Do the first real piece of the task yourself, then leave it at the exact place where he takes over, so that opening the task drops him into work that is already moving. Examples: the reply drafted and ready to review; an essay outlined with its opening sentence written; the first homework problem copied out with its first step set up; a form\'s answers filled from what you can read, with the ones only he can answer listed.',
    'The started work exists ONLY inside this reply, in hook.work.body. Do not create it anywhere else: no email drafts, no documents, no files, no form submissions. In did, list only reading and preparing you actually did.',
    'If you cannot start it for real, still return a hook with the next step and work: null. Never invent facts, quotes, numbers or people for it.',
    '',
    '"hook": {',
    `  "shape": one of ${hookShapes.join(', ')} (below),`,
    `  "icon": one of ${iconNames.join(', ')},`,
    `  "kind": what sort of thing it is in 1-2 words, at most ${kind} characters ("homework", "exam", "talk", "email", "form"). No course or group name: the Journal adds it.`,
    `  "name": the task in plain words, verb first, at most ${name} characters ("Study for the midterm", "Confirm the Roadrunner call"),`,
    `  "next": the one step to take now, as an instruction, at most ${next} characters ("Review your reply and send", "Do step 1 of problem 1"),`,
    `  "what": one sentence on what this task is, for someone who has forgotten it, at most ${what} characters,`,
    `  "did": up to ${did} things you did to get it ready, each at most ${didText} characters, past tense ("Read the brief on Canvas"),`,
    `  "say": [the ask in a few words, at most ${ask} characters ("Start Homework 3."), why it is easy now, at most ${why} characters ("Problem 1 is set up with its data.")],`,
    `  "parts": up to ${parts} parts that picture the work (below). Put the one that makes it recognisable first.`,
    `  "work": null | {"format": "${workFormats.join('|')}", "title": at most ${title} characters, "body": the started work as markdown, at most ${body} characters (a checklist is "- [ ]" lines), "href": optional link to where it gets finished or submitted}`,
    '}',
    '',
    'Shapes:',
    ...hookShapes.map(id => `- ${id}: ${shapes[id].says}. Use for ${shapes[id].use}.${shapes[id].hearts.filter(kind => hookPartKinds.includes(kind)).length === 0 ? '' : ` Its picture is the first ${shapes[id].hearts.filter(kind => hookPartKinds.includes(kind)).join(' or ')} part.`}`),
    '',
    'Parts (each is {"kind": "...", ...its properties}; "?" marks an optional property; fractions are 0 to 1):',
    ...hookPartKinds.map(partLine),
    '- rows items are {text, detail?, done?, hot?}; pairs items are {key, value}; timeline marks are {at, to?, label}; segments items are {label, value}; dots items are {label, value}.',
    'Give at most one part of each kind. Every part must be true to what you read.',
  ].join('\n')
}
