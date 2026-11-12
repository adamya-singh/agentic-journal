// A task drawn from its FormSpec (lib/sunrise/form-spec.ts). On the rings it is small, in its shape's own outline
// (a circle with a tail, a strip along steps, a picture, a note, a stack of rows, a bubble). Under the pointer and
// as the lead it opens: what it is, what OpenClaw already did, a picture of the work, and the button into it.
// Every form reads the same way: icon, "Subject · kind" and date; a plain name; the next step.
// Everything is built from the shapes bank's parts (lib/shapes), and all text goes in through textContent.
import {type Level, type Part, type PartOf, type ShapeId, type Thing, shapes, visibleParts} from '@/lib/shapes/catalog'
import {iconOf, renderPart} from '@/lib/shapes/render'
import type {FormSpec} from '@/lib/sunrise/form-spec'

/** A form and the date it carries ("Thu", "Oct 26"). */
export type FormThing = {spec: FormSpec, when: string}

// A small form's height before the screen's scale, and the narrowest and widest it gets. Its width is as wide as
// what it says, so nothing in it is cut off.
const heights: Record<ShapeId, number> = {pill: 58, orb: 70, stat: 70, band: 70, tile: 70, note: 70, list: 68, card: 70, stage: 70}
const widths: Record<ShapeId, readonly [number, number]> = {
  pill: [140, 270], orb: [200, 330], stat: [104, 190], band: [200, 300], tile: [230, 310], note: [200, 280], list: [170, 295], card: [150, 260], stage: [150, 260],
}
export const formHeight = 70

const asThing = ({spec, when}: FormThing): Thing => ({
  id: spec.id, title: spec.name, shape: spec.shape, salience: 0, tone: 'calm', icon: spec.icon, parts: spec.parts, ...when === '' ? {} : {when},
})

/** A small form measured in `host` (hidden, in the page): how wide what it says is, within its shape's limits. */
export function formSize(form: FormThing, host: HTMLElement, compact = false): readonly [number, number] {
  const shape = compact ? 'pill' : form.spec.shape
  const [narrowest, widest] = widths[shape]
  const node = smallForm(form, undefined, compact)
  node.style.width = 'max-content'
  host.replaceChildren(node)
  const width = Math.ceil(node.getBoundingClientRect().width) + 1
  host.replaceChildren()
  return [Math.max(narrowest, Math.min(widest, width)), heights[shape]]
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
const group = (className: string, ...children: (HTMLElement | null)[]) => {
  const node = el('div', className)
  node.append(...children.filter(child => child !== null))
  return node
}
const heartOf = (thing: Thing) => thing.parts.find(part => shapes[thing.shape].hearts.includes(part.kind)) ?? null

// The line every form opens with: its icon, where it belongs and what sort of thing it is, and its date.
function brow({spec, when}: FormThing) {
  const node = el('div', 'brow')
  node.append(iconOf(spec.icon))
  node.append(el('span', 'kd', spec.kind))
  if (when !== '') node.append(el('span', 'wh', when))
  return node
}
// An orb's circle: its value, ring or person.
function core(heart: Part | null, title: string) {
  const node = el('div', 'core')
  switch (heart?.kind) {
    case 'value':
      node.append(el('b', '', heart.value))
      if (heart.unit !== undefined) node.append(el('small', '', heart.unit))
      break
    case 'ring':
    case 'meter':
      node.append(renderPart({kind: 'ring', value: heart.value, ...heart.label === undefined ? {} : {label: heart.label}, ...heart.kind === 'ring' && heart.of !== undefined ? {of: heart.of} : {}}, 1))
      break
    case 'person':
      node.classList.add('face-of')
      node.append(el('b', '', heart.name.slice(0, 1).toUpperCase()))
      break
    default:
      node.append(el('b', '', title.slice(0, 1).toUpperCase()))
  }
  return node
}
// The next step a small form shows: the spec's, or for a list its first row still to do.
function stepOf(spec: FormSpec) {
  if (spec.next !== '') return spec.next
  const rows = spec.parts.find((part): part is PartOf<'rows'> => part.kind === 'rows')
  return rows?.items.find(row => row.done !== true)?.text ?? ''
}

/**
 * A form drawn small, in its shape's own outline, `width` wide (formSize's), or as wide as it likes without one.
 * `compact` is for a task that isn't near the top yet: a bubble with what it is, its name and its next step,
 * whatever its shape.
 */
export function smallForm(form: FormThing, width?: number, compact = false): HTMLElement {
  const {spec} = form
  const thing = asThing(form)
  const shape = compact ? 'pill' : spec.shape
  const root = el('div', `shape sm s-${shape}`)
  if (width !== undefined) root.style.width = `${width}px`
  root.style.height = `${heights[shape]}px`
  const heart = heartOf(thing)
  const name = () => el('b', 'nm', spec.name)
  const next = () => spec.next === '' ? null : el('span', 'nx', spec.next)
  switch (shape) {
    case 'orb':
      root.append(core(heart, spec.name), group('tail', brow(form), name(), next()))
      break
    case 'band': {
      root.append(brow(form), name())
      if (heart?.kind === 'steps') {
        // The path to it: each stop is a name over its date ("Prep · Thu"), the one you're at lit.
        const path = el('div', 'path')
        heart.items.forEach((item, index) => {
          const [label = '', date = ''] = item.split(' · ')
          path.append(group(index < heart.at ? 'stop done' : index === heart.at ? 'stop now' : 'stop', el('b', '', label), date === '' ? null : el('span', '', date)))
        })
        root.append(path)
      } else if (heart !== null) {
        root.append(renderPart(heart, 1))
      }
      root.append(...[next()].filter(node => node !== null))
      break
    }
    case 'tile':
      root.append(heart === null ? el('div', 'blank') : renderPart(heart, 1), group('cap', brow(form), name(), next()))
      break
    case 'note': {
      const line = spec.parts.find((part): part is PartOf<'line'> => part.kind === 'line')?.text ?? ''
      root.append(brow(form), name(), el('div', 'q', heart?.kind === 'quote' || heart?.kind === 'prose' ? heart.text : line), ...[next()].filter(node => node !== null))
      break
    }
    case 'list': {
      const rows = heart?.kind === 'rows' ? heart : null
      const settled = rows?.items.filter(row => row.done === true).length ?? 0
      const count = rows === null || rows.check !== true || settled === 0 ? null : el('span', 'count', `${settled}/${rows.items.length} done`)
      root.append(group('top', brow(form), group('nmrow', name(), count)))
      // The next row still to do, as its own small bubble: that is the next step.
      for (const row of (rows?.items ?? []).filter(item => item.done !== true).slice(0, 1)) {
        const words = el('span', '', row.text)
        if (rows?.check !== true && row.detail !== undefined) words.append(el('em', '', row.detail))
        root.append(group('row', rows?.check === true ? el('i', 'box') : el('i', row.hot === true ? 'dot hot' : 'dot'), words))
      }
      break
    }
    default: {
      // A bubble still says all three: what it is, its name, and the next step.
      const step = stepOf(spec)
      root.append(brow(form), name())
      if (step !== '') root.append(el('span', 'nx', step))
    }
  }
  return root
}

/**
 * A form opened: what it is, its name, a sentence on the task, what OpenClaw already did, then its picture and the
 * parts its level shows, and the button into the work. Level 2 under the pointer, 3 as the lead. `compact` keeps
 * only the picture and the button, for a lead with little room in the sky.
 */
export function fullForm(form: FormThing, level: Level, compact = false): HTMLElement {
  const {spec} = form
  const thing = asThing(form)
  const root = el('div', `shape full s-${spec.shape}`)
  root.append(brow(form), group('hd', el('b', 'nm', spec.name)))
  if (spec.what !== '') root.append(el('p', 'what', spec.what))
  if (spec.did.length > 0 && !compact) root.append(group('did', el('span', '', 'OpenClaw already'), ...spec.did.map(item => el('i', '', item))))
  const {heart, flow} = visibleParts(thing, level)
  for (const part of heart === null ? flow : [heart, ...flow]) {
    if (compact && part !== heart && part.kind !== 'line') continue
    root.append(renderPart(part, level))
  }
  // The one thing to press: the next step, or just opening it.
  const step = stepOf(spec)
  const button = el('button', 'go', step !== '' ? step : spec.hasWork ? 'Jump in' : 'Open')
  button.type = 'button'
  root.append(group('p-actions', button))
  return root
}
