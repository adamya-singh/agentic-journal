// What Sunrise shows for one task. From the task's hook when OpenClaw has filled one; until then from the brief the
// journal's rules build, so every task reads the same way from the first load: what it belongs to and what sort of
// thing it is, a plain name, and the next step. Pure: the route, the page and the tests share it.
import type {ActionCard} from '@/lib/action-cards/types'
import type {TaskBrief, BriefKind} from '@/lib/task-brief'
import {GROUP_OTHER} from '@/lib/horizon'
import type {IconName, Part, ShapeId} from '@/lib/shapes/catalog'
import {iconForKind} from '@/lib/shapes/hook'

export type FormSpec = {
  id: string
  listType: 'have-to-do' | 'want-to-do'
  shape: ShapeId
  icon: IconName
  kind: string // "Info Viz · talk"
  name: string
  next: string // the one step to take now; '' when nothing is known yet
  what: string // a sentence on what the task is
  did: string[] // what OpenClaw did to get it ready
  say: [string, string] // what the page says when this leads: the ask, then why it is easy now
  parts: Part[]
  ready: boolean // OpenClaw has started it: there is a hook
  hasWork: boolean // the hook carries started work to open
  filling: boolean // OpenClaw is working on it right now, or it is queued
}

const kindWords: Record<BriefKind, string> = {
  assessment: 'assessment', exam: 'exam', assignment: 'assignment', 'catch-up': 'catch-up', presentation: 'talk', reading: 'reading',
  build: 'build', errand: 'errand', plan: 'plan', task: 'task',
}
const capital = (text: string) => text.slice(0, 1).toUpperCase() + text.slice(1)
function clip(text: string, limit: number) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= limit) return clean
  const cut = clean.slice(0, limit - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > limit * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}
// The task's title without its "[Course]" tag.
const plainTitle = (title: string) => title.replace(/^\s*\[[^\]]+\]\s*/, '').trim() || title.trim()

/** "Subject · kind". Tasks in no subject say only their kind. */
export function kindLine(group: string, kind: string): string {
  if (kind === '') return group === GROUP_OTHER ? '' : group
  return group === GROUP_OTHER || group === '' ? capital(kind) : `${group} · ${kind}`
}

export function formSpecFor(brief: TaskBrief): FormSpec {
  const hook = brief.hook
  const filling = brief.agent?.status === 'queued' || brief.agent?.status === 'running'
  const base = {id: brief.id, listType: brief.listType, filling}
  if (hook !== null) {
    return {
      ...base, shape: hook.shape, icon: hook.icon, kind: kindLine(brief.group, hook.kind), name: hook.name, next: hook.next,
      what: hook.what, did: hook.did, say: hook.say, parts: hook.parts, ready: true, hasWork: hook.work !== null,
    }
  }
  // No hook yet: only what the journal really has. An exam's stages are the tasks to clear before it; steps are
  // the task's own steps; a number is the days it has left. Nothing is made up to fill a gap.
  const name = clip(plainTitle(brief.title), 60)
  const open = brief.steps.filter(step => !step.done)
  const next = clip(brief.next?.label ?? open[0]?.text ?? '', 60)
  const parts: Part[] = []
  const daysLeft = brief.when.due === null ? null : Math.ceil((Date.parse(brief.when.due) - Date.parse(brief.generatedAt)) / 864e5)
  const counted = (brief.kind === 'exam' || brief.kind === 'assessment') && daysLeft !== null && daysLeft >= 0
  if (counted) parts.push({kind: 'value', value: String(daysLeft), unit: daysLeft === 1 ? 'day left' : 'days left'})
  // The runway to an exam: what is still to clear before it, then the exam itself.
  const runway = brief.runway ? brief.related.filter(related => related.state !== 'done' && related.rel !== 'after') : []
  if (runway.length >= 2) {
    const shown = runway.slice(-4)
    parts.push({kind: 'steps', items: shown.map(related => clip(`${related.short.replace(/[.…]+$/, '')} · ${related.day}`, 40)), at: 0})
  }
  if (brief.steps.length >= 2) {
    parts.push({kind: 'rows', check: true, items: brief.steps.slice(0, 5).map(step => ({text: clip(step.text, 80), ...step.done ? {done: true} : {}}))})
  }
  if (brief.facts.length > 0) parts.push({kind: 'pairs', items: brief.facts.slice(0, 4).map(fact => ({key: clip(fact.k, 24), value: clip(fact.v, 80)}))})
  if (filling) parts.push({kind: 'line', text: 'OpenClaw is getting this ready.'})
  const when = brief.when.due === null ? '' : brief.when.left?.endsWith('over') ? `It was due ${brief.when.day}.` : `It is due ${brief.when.day}.`
  const what = clip(brief.stakes ?? [capital(plainTitle(brief.title)).replace(/[.!?]*$/, '.'), when].filter(Boolean).join(' '), 240)
  return {
    ...base, shape: counted ? 'orb' : runway.length >= 2 ? 'band' : brief.steps.length >= 2 ? 'list' : 'pill', icon: iconForKind(brief.kind),
    kind: kindLine(brief.group, kindWords[brief.kind]), name, next, what,
    // What OpenClaw has really done so far: what it read when it filled the brief.
    did: brief.agent?.status === 'done' && brief.agent.summary ? [clip(brief.agent.summary, 80)] : [],
    say: [name.replace(/[.!?…]*$/, '.'), next !== '' ? next.replace(/[.!?…]*$/, '.') : when],
    parts, ready: false, hasWork: false,
  }
}

// ---- Action cards beside the tasks.

const cardSources: Record<ActionCard['source'], string> = {x: 'Saved post', jobs: 'Jobs', inbox: 'Inbox', compass: 'Compass', tasks: 'Tasks', other: 'Journal'}
/**
 * How much an open card matters now, on the tasks' scale: its own weight, a little more when it fits now. It tops
 * out just above what leads (0.5), so a card leads only on a day when no task with a date is pressing.
 */
export const cardSalience = (card: ActionCard) => Math.min(1, Math.max(0, card.weight) * 0.5 + (card.when === 'now' ? 0.08 : card.when === 'period' ? 0.03 : 0))

/** An action card as a form: where it came from and what sort of thing it is, its name, and what to do with it. */
export function cardFormSpec(card: ActionCard): FormSpec {
  const post = card.post?.text.replace(/https:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim() ?? ''
  const parts: Part[] = []
  if (post !== '') parts.push({kind: 'quote', text: clip(post, 180), by: card.post?.author ?? ''})
  else if (card.evidence.length > 0) parts.push({kind: 'rows', items: card.evidence.slice(0, 3).map(evidence => ({text: clip(evidence.text, 90)}))})
  parts.push({kind: 'pairs', items: [{key: card.why.label, value: clip(card.why.text, 120)}]})
  return {
    id: `card:${card.id}`, listType: 'want-to-do', shape: post !== '' ? 'note' : 'pill', icon: 'spark',
    kind: `${cardSources[card.source]} · ${card.kind.toLowerCase()}`, name: clip(card.short || card.title, 60), next: clip(card.next, 60),
    what: clip(card.what, 240), did: [], say: [clip(card.title, 60).replace(/[.!?…]*$/, '.'), clip(`Agree or dismiss it. ${card.estimate}.`, 120)],
    parts, ready: true, hasWork: false, filling: false,
  }
}
