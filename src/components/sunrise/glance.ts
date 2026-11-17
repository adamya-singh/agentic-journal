// A task under the pointer: its brief at a glance. What it belongs to, its name, when it is and how long is left,
// the one thing to watch for, the next step (the line that stands out), up to three facts, and a quiet foot: how
// many chats he has with OpenClaw about it, whether one waits on him, and that a click opens it.
// It is the form the engine already grows on hover (forms.ts fullForm, level 2), so nothing floats over the sky.
// Only what the Journal has is drawn; all text goes in through textContent.
import {chatsState} from '@/lib/code-sessions-ui'
import {iconOf} from '@/lib/shapes/render'
import type {FormSpec} from '@/lib/sunrise/form-spec'
import type {FormThing} from './forms'

/** As wide as the glance gets. Its height is its content's, capped by the engine at about half the sky. */
export const glanceWidth = 340

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

// The next step: the form's own, or for a list its first row still to do.
function stepOf(spec: FormSpec) {
  if (spec.next !== '') return spec.next
  const rows = spec.parts.find(part => part.kind === 'rows')
  return rows?.kind === 'rows' ? rows.items.find(row => row.done !== true)?.text ?? '' : ''
}

/**
 * What the foot says about his chats (with OpenClaw, Codex and Claude Code alike): "2 chats", and "1 waiting on you",
 * "OpenClaw is answering", "Codex is working" or "Claude Code needs you" when so.
 */
export function chatsLine(chats: FormSpec['chats']): {count: string, state: string, waiting: boolean} | null {
  if (chats === undefined || chats.count === 0) return null
  const count = `${chats.count} chat${chats.count === 1 ? '' : 's'}`
  return {count, state: chatsState(chats), waiting: chats.waiting > 0}
}

/** Done and Let go for an overdue task's opened form. The engine reads the press from `data-act`. */
export function lateActions(name: string): HTMLElement {
  const row = document.createElement('div')
  row.className = 'late-acts'
  for (const [act, label, title] of [['done', 'Done', 'It is done: say when'], ['letgo', 'Let go', 'No longer worth doing. Takes it off your lists without counting it as done']] as const) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `tk-act ${act}`
    button.dataset['act'] = act
    button.textContent = label
    button.title = title
    button.setAttribute('aria-label', `${label}: ${name}`)
    row.append(button)
  }
  return row
}

export function glanceForm({spec, late}: FormThing): HTMLElement {
  const glance = spec.glance!
  const root = el('div', 'shape full gl')
  const brow = el('div', 'brow')
  brow.append(iconOf(spec.icon), el('span', 'kd', spec.kind))
  root.append(brow, el('b', 'gl-nm', spec.name))
  if (glance.when !== '' || glance.left !== '') {
    const when = el('div', 'gl-when')
    if (glance.when !== '') when.append(el('span', '', glance.when))
    if (glance.left !== '') when.append(el('i', `gl-left ${glance.zone}`, glance.left))
    root.append(when)
  }
  if (glance.flag !== null) root.append(el('p', glance.flag.warn ? 'gl-flag warn' : 'gl-flag', glance.flag.text))
  const step = stepOf(spec)
  if (step !== '') {
    const next = el('div', 'gl-next')
    next.append(el('span', '', 'Next'), el('b', '', step))
    root.append(next)
  } else if (spec.filling) {
    root.append(el('p', 'gl-flag', 'OpenClaw is getting this ready.'))
  }
  if (glance.facts.length > 0) {
    const facts = el('dl', 'gl-facts')
    for (const fact of glance.facts) facts.append(el('dt', '', fact.key), el('dd', '', fact.value))
    root.append(facts)
  }
  // Overdue: it is settled from here, done (and when) or let go.
  if (late === true) root.append(lateActions(spec.name))
  const foot = el('div', 'gl-foot')
  const chats = chatsLine(spec.chats)
  if (chats !== null) {
    const said = el('span', chats.waiting ? 'gl-chats waiting' : 'gl-chats')
    said.append(el('i', ''), el('b', '', chats.count))
    if (chats.state !== '') said.append(el('em', '', chats.state))
    foot.append(said)
  }
  foot.append(el('span', 'gl-open', 'Click to open ›'))
  root.append(foot)
  return root
}
