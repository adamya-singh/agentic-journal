// A task under the pointer: its brief at a glance. What it belongs to, its name, when it is and how long is left,
// the one thing to watch for, the next step (the line that stands out), up to three facts, and a quiet foot: how
// many chats he has with OpenClaw about it, whether one waits on him, and that a click opens it.
// It is the form the engine already grows on hover (forms.ts fullForm, level 2), so nothing floats over the sky.
// Only what the Journal has is drawn; all text goes in through textContent.
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

/** What the foot says about his chats: "2 chats", and "1 waiting on you" or "OpenClaw is answering" when so. */
export function chatsLine(chats: FormSpec['chats']): {count: string, state: string, waiting: boolean} | null {
  if (chats === undefined || chats.count === 0) return null
  const count = `${chats.count} chat${chats.count === 1 ? '' : 's'}`
  if (chats.waiting > 0) return {count, state: chats.count === 1 ? 'waiting on you' : `${chats.waiting} waiting on you`, waiting: true}
  if (chats.working > 0) return {count, state: 'OpenClaw is answering', waiting: false}
  return {count, state: '', waiting: false}
}

export function glanceForm({spec}: FormThing): HTMLElement {
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
