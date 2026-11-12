// Draws a thing: its shape's frame, its heart and the parts its level shows. One element per thing, filled again
// when its shape or level changes, so it grows and moves and is never replaced. All text goes in through textContent.
// The icons are Lucide's; everything else is plain DOM and a little SVG. The look is in gallery.html.
import {
  type IconNode, AppWindow, BookOpen, BriefcaseBusiness, CalendarDays, ChartLine, CircleCheck, Clock, CodeXml, Dumbbell, FileText, Flame,
  GraduationCap, Link, ListTodo, Mail, NotebookPen, Phone, Play, Presentation, Sigma, Sparkles, Sun, Timer, createElement,
} from 'lucide'
import {type IconName, type Level, type Part, type PartOf, type Thing, visibleParts} from './catalog.ts'

const icons: Record<IconName, IconNode> = {
  slides: Presentation, notes: NotebookPen, event: CalendarDays, problem: Sigma, call: Phone, jobs: BriefcaseBusiness, code: CodeXml,
  timer: Timer, video: Play, school: GraduationCap, read: BookOpen, link: Link, doc: FileText, app: AppWindow, spark: Sparkles,
  check: CircleCheck, sun: Sun, list: ListTodo, chart: ChartLine, mail: Mail, flame: Flame, clock: Clock, workout: Dumbbell,
}

/** A catalog icon as an SVG element. */
export function iconOf(name: IconName): SVGElement {
  return createElement(icons[name], {class: 'icon', 'stroke-width': 1.8})
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string | null, text?: string) {
  const node = document.createElement(tag)
  if (className !== null) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}
function svg(tag: string, attributes: Record<string, string | number>, children: SVGElement[] = []) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
  node.append(...children)
  return node
}
const present = (value: string | undefined): value is string => value !== undefined && value !== ''

// How many rows a list shows at each level, before "+ n more".
const rowLimit = [0, 3, 5, 8] as const

// A ring filled clockwise from the top to `value`, drawn in a 100 × 100 box so it scales with its holder. With `of`,
// it is that many arcs with gaps between, and the first value × of are lit.
function ring(value: number, stroke: number, of?: number) {
  const radius = 50 - stroke / 2
  const around = 2 * Math.PI * radius
  const circle = (className: string, extra: Record<string, string | number> = {}) =>
    svg('circle', {class: className, cx: 50, cy: 50, r: radius, fill: 'none', 'stroke-width': stroke, transform: 'rotate(-90 50 50)', ...extra})
  if (of !== undefined && of >= 2 && of <= 12) {
    const arc = around / of
    const lit = Math.round(value * of)
    return svg('svg', {class: 'ring', viewBox: '0 0 100 100'}, Array.from({length: of}, (_, index) =>
      circle(index < lit ? 'fill' : 'track', {'stroke-dasharray': `${arc - 7} ${around - arc + 7}`, 'stroke-dashoffset': -index * arc - 3.5, 'stroke-linecap': 'round'})))
  }
  return svg('svg', {class: 'ring', viewBox: '0 0 100 100'}, [
    circle('track'),
    circle('fill', {'stroke-dasharray': `${around * value} ${around}`, 'stroke-linecap': 'round'}),
  ])
}
// A series as a line with its last point marked, or as bars with the last one lit. Returns the chart's holder.
function spark(points: number[], bars = false, ticks: string[] = []) {
  const holder = el('div', bars ? 'chart bars' : 'chart')
  const low = Math.min(...points, bars ? 0 : Infinity)
  const high = Math.max(...points)
  const share = (value: number) => high === low ? 0.5 : (value - low) / (high - low)
  if (bars) {
    points.forEach((value, index) => {
      const bar = el('i', index === points.length - 1 ? 'last' : null)
      bar.style.height = `${Math.max(share(value) * 100, 6)}%`
      holder.append(bar)
    })
  } else {
    const width = 100
    const height = 32
    const y = (value: number) => height - 3 - share(value) * (height - 6)
    const line = points.map((value, index) => `${points.length < 2 ? width / 2 : index * width / (points.length - 1)},${y(value)}`).join(' ')
    holder.append(svg('svg', {class: 'spark', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none'}, [
      svg('polygon', {class: 'area', points: `0,${height} ${line} ${width},${height}`}),
      svg('polyline', {class: 'stroke', points: line, fill: 'none', 'vector-effect': 'non-scaling-stroke'}),
    ]))
    const last = points[points.length - 1]
    if (last !== undefined) {
      const dot = el('b', 'end')
      dot.style.top = `${y(last) / height * 100}%`
      holder.append(dot)
    }
  }
  if (ticks.length === 0) return holder
  const both = el('div', 'charted')
  const row = el('div', 'ticks')
  for (const tick of ticks) row.append(el('span', null, tick))
  both.append(holder, row)
  return both
}
const clockText = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`

// A picture's stand-in, drawn from its look. A real image would be an <img> here.
function mediaArt(look: string, progress: number | undefined) {
  const box = el('div', `art look-${['video', 'chart', 'slides'].includes(look) ? look : 'image'}`)
  if (look === 'slides') {
    for (const kind of ['wind', 'arcs', 'tree']) {
      const paths: SVGElement[] = []
      if (kind === 'wind') {
        for (let index = 0; index < 9; index++) {
          const y = 6 + index * 6
          paths.push(svg('path', {d: `M 4 ${y} C 30 ${y - 5 + index % 4}, 60 ${y + 6 - index % 3}, 96 ${y - 2}`, stroke: `hsl(${200 + index * 9} 75% 68%)`, fill: 'none', 'stroke-width': 1.3}))
        }
      } else if (kind === 'arcs') {
        const hubs = [[20, 44], [50, 22], [80, 40], [36, 16], [66, 12]] as const
        hubs.forEach(([x0, y0], a) => hubs.forEach(([x1, y1], b) => {
          if (b > a) paths.push(svg('path', {d: `M ${x0} ${y0} Q ${(x0 + x1) / 2} ${Math.min(y0, y1) - 12} ${x1} ${y1}`, stroke: '#ffb36b', fill: 'none', 'stroke-width': 1, opacity: 0.75}))
        }))
        for (const [x, y] of hubs) paths.push(svg('circle', {cx: x, cy: y, r: 2.2, fill: '#fff3e0'}))
      } else {
        const cells = [[0, 0, 55, 37, '#6f8fd8'], [55, 0, 45, 23, '#e6a15c'], [55, 23, 25, 14, '#d97a6c'], [80, 23, 20, 14, '#8cc3a0'], [0, 37, 35, 23, '#b48ad6'], [35, 37, 65, 23, '#5fb0b7']] as const
        for (const [x, y, w, h, fill] of cells) paths.push(svg('rect', {x: x + 1, y: y + 1, width: w - 2, height: h - 2, rx: 2, fill, opacity: 0.88}))
      }
      const slide = el('i', null)
      slide.append(svg('svg', {viewBox: '0 0 100 60', preserveAspectRatio: 'none'}, paths))
      box.append(slide)
    }
  } else if (look === 'chart') {
    box.append(spark([3, 5, 4, 7, 6, 9, 8, 11]))
  } else if (look === 'video') {
    box.append(el('b', 'play', '▶'))
  }
  if (progress !== undefined) {
    const bar = el('u', 'progress')
    bar.append(el('i', null))
    ;(bar.firstElementChild as HTMLElement).style.width = `${progress * 100}%`
    box.append(bar)
  }
  return box
}

function rowsNode(part: PartOf<'rows'>, level: Level) {
  const list = el('ul', part.check === true ? 'p-rows check' : 'p-rows')
  const limit = Math.max(rowLimit[level], 2)
  for (const row of part.items.slice(0, limit)) {
    const item = el('li', row.done === true ? 'done' : null)
    if (part.check === true) {
      const box = el('i', 'box', row.done === true ? '✓' : '')
      item.append(box)
      item.setAttribute('role', 'checkbox')
      item.tabIndex = 0
      const toggle = (event: Event) => {
        event.stopPropagation()
        row.done = row.done !== true
        item.classList.toggle('done', row.done)
        item.setAttribute('aria-checked', String(row.done))
        box.textContent = row.done ? '✓' : ''
      }
      item.setAttribute('aria-checked', String(row.done === true))
      item.addEventListener('click', toggle)
      item.addEventListener('keydown', event => (event.key === ' ' || event.key === 'Enter') && (event.preventDefault(), toggle(event)))
    }
    item.append(el('span', 'text', row.text))
    if (present(row.detail)) item.append(el('span', 'detail', row.detail))
    if (row.hot === true) item.classList.add('hot')
    if (row.meter !== undefined) {
      const bar = el('u', 'bar')
      bar.append(el('i', null))
      ;(bar.firstElementChild as HTMLElement).style.width = `${row.meter * 100}%`
      item.append(bar)
    }
    list.append(item)
  }
  if (part.items.length > limit) list.append(el('li', 'more', `+ ${part.items.length - limit} more`))
  return list
}

/** One part, drawn for the level its thing is at. */
export function renderPart(part: Part, level: Level): HTMLElement {
  switch (part.kind) {
    case 'line': return el('div', 'p-line', part.text)
    case 'prose': return el('p', 'p-prose', part.text)
    case 'quote': {
      const quote = el('blockquote', 'p-quote', part.text)
      if (present(part.by)) quote.append(el('cite', null, part.by))
      return quote
    }
    case 'value': {
      const value = el('div', 'p-value')
      value.append(el('b', null, part.value))
      if (present(part.unit)) value.append(el('small', null, part.unit))
      if (present(part.delta)) value.append(el('em', part.delta.startsWith('-') || part.delta.startsWith('−') ? 'down' : 'up', part.delta))
      if (present(part.label)) value.append(el('span', null, part.label))
      return value
    }
    case 'meter': {
      const meter = el('div', 'p-meter')
      if (present(part.label)) meter.append(el('span', null, part.label), el('em', null, `${Math.round(part.value * 100)}%`))
      const track = el('u', null)
      track.append(el('i', null))
      ;(track.firstElementChild as HTMLElement).style.width = `${part.value * 100}%`
      if (part.target !== undefined) {
        const notch = el('b', null)
        notch.style.left = `${part.target * 100}%`
        track.append(notch)
      }
      meter.append(track)
      return meter
    }
    case 'ring': {
      const holder = el('div', 'p-ring')
      holder.append(ring(part.value, 9, part.of), el('b', null, part.label ?? `${Math.round(part.value * 100)}%`))
      return holder
    }
    case 'spark': {
      const holder = el('div', 'p-spark')
      if (present(part.label)) holder.append(el('span', null, part.label))
      holder.append(spark(part.points, part.bars === true, part.ticks))
      return holder
    }
    case 'dots': {
      const dots = el('div', 'p-dots')
      part.items.forEach((dot, index) => {
        const node = el('i', index === part.at ? 'today' : null)
        const fill = el('b', null)
        fill.style.opacity = String(dot.value === 0 ? 0 : 0.35 + dot.value * 0.65)
        node.append(fill, el('span', null, dot.label))
        dots.append(node)
      })
      return dots
    }
    case 'rows': return rowsNode(part, level)
    case 'pairs': {
      const list = el('dl', 'p-pairs')
      for (const pair of part.items) list.append(el('dt', null, pair.key), el('dd', null, pair.value))
      return list
    }
    case 'steps': {
      const list = el('ol', 'p-steps')
      const steps = part.items.map(step => el('li', null, step))
      const mark = () => steps.forEach((step, index) => {
        step.className = index < part.at ? 'done' : index === part.at ? 'now' : ''
      })
      steps.forEach((step, index) => step.addEventListener('click', event => {
        event.stopPropagation()
        part.at = index
        mark()
      }))
      mark()
      list.append(...steps)
      return list
    }
    case 'timeline': {
      const timeline = el('div', 'p-timeline')
      const track = el('div', 'track')
      part.marks.forEach((mark, index) => {
        const node = el('i', mark.to === undefined ? 'mark point' : 'mark')
        node.style.left = `${mark.at * 100}%`
        if (mark.to !== undefined) node.style.width = `${Math.max(0, mark.to - mark.at) * 100}%`
        const label = el('span', index % 2 === 1 && part.ticks === undefined ? 'low' : null, mark.label)
        node.append(label)
        track.append(node)
      })
      if (part.now !== undefined) {
        const now = el('b', 'now')
        now.style.left = `${part.now * 100}%`
        track.append(now)
      }
      timeline.append(track)
      if (part.ticks !== undefined) {
        const ticks = el('div', 'ticks')
        for (const tick of part.ticks) ticks.append(el('span', null, tick))
        timeline.append(ticks)
      }
      return timeline
    }
    case 'segments': {
      const bar = el('div', 'p-segments')
      for (const segment of part.items) {
        const node = el('i', null)
        node.style.flexGrow = String(Math.max(segment.value, 0.4))
        node.append(el('b', null, String(segment.value)), el('span', null, segment.label))
        bar.append(node)
      }
      return bar
    }
    case 'chips': {
      const chips = el('div', 'p-chips')
      for (const chip of part.items) chips.append(el('span', null, chip))
      return chips
    }
    case 'person': {
      const person = el('div', 'p-person')
      const words = el('div', null)
      words.append(el('b', null, part.name))
      if (present(part.line)) words.append(el('span', null, part.line))
      person.append(el('i', 'avatar', part.name.slice(0, 1).toUpperCase()), words)
      if (present(part.status)) person.append(el('em', 'status', part.status))
      return person
    }
    case 'media': {
      const media = el('figure', 'p-media')
      media.append(mediaArt(part.look, part.progress))
      if (present(part.caption)) media.append(el('figcaption', null, part.caption))
      return media
    }
    case 'code': {
      const code = el('div', 'p-code')
      if (present(part.name)) code.append(el('div', 'name', part.name))
      const lines = el('pre', null)
      for (const line of part.text.split('\n')) lines.append(el('span', null, line))
      code.append(lines)
      return code
    }
    case 'clock': {
      const clock = el('div', 'p-clock')
      const dial = el('i', 'dial')
      const glyph = el('b', null, '▶')
      dial.append(ring(1, 8), glyph)
      const minutes = Math.round(part.seconds / 60)
      const time = el('b', null, clockText(part.seconds))
      clock.append(dial, time, el('span', null, minutes === 1 ? '1 minute' : `${minutes} minutes`))
      // Pressing the dial starts the countdown and pauses it. It stops by itself once its element is gone.
      let left = part.seconds
      let timer: ReturnType<typeof setInterval> | null = null
      const stop = () => {
        if (timer !== null) clearInterval(timer)
        timer = null
        glyph.textContent = '▶'
        clock.classList.remove('running')
      }
      dial.setAttribute('role', 'button')
      dial.tabIndex = 0
      dial.addEventListener('click', event => {
        event.stopPropagation()
        if (timer !== null) return stop()
        glyph.textContent = '❚❚'
        clock.classList.add('running')
        timer = setInterval(() => {
          if (!clock.isConnected || left <= 0) return stop()
          time.textContent = clockText(--left)
        }, 1000)
      })
      return clock
    }
    case 'field': {
      const field = el('input', 'p-field')
      field.placeholder = part.placeholder
      return field
    }
    case 'actions': {
      const actions = el('div', 'p-actions')
      // A hook shows only the main action, so there is one thing to press. The lead shows them all.
      for (const action of level < 3 ? part.items.slice(0, 1) : part.items) {
        const button = el('button', action.quiet === true ? 'quiet' : null, action.label)
        button.type = 'button'
        button.dataset['does'] = action.does
        // Pressing answers at once. The page hears it as a "does" event and would hand it to the agent.
        button.addEventListener('click', event => {
          event.stopPropagation()
          button.classList.add('pressed')
          button.textContent = `✓ ${action.label}`
          button.dispatchEvent(new CustomEvent('does', {bubbles: true, detail: action.does}))
          setTimeout(() => {
            button.classList.remove('pressed')
            button.textContent = action.label
          }, 1400)
        })
        actions.append(button)
      }
      return actions
    }
    case 'embed': {
      const embed = el('div', 'p-embed')
      const bar = el('div', 'bar')
      bar.append(el('i', null), el('i', null), el('i', null), el('span', null, part.url))
      // A stand-in for the app: a rail of pages and the open one. The real app is embedded here.
      const body = el('div', 'body')
      const rail = el('div', 'rail')
      rail.append(el('i', null), el('i', 'on'), el('i', null), el('i', null))
      const sheet = el('div', 'sheet')
      for (const width of [44, 86, 92, 74, 60]) {
        const line = el('i', null)
        line.style.width = `${width}%`
        sheet.append(line)
      }
      sheet.append(el('span', null, `${part.app} opens here`))
      body.append(rail, sheet)
      embed.append(bar, body)
      return embed
    }
  }
}

// An orb's heart sits inside its circle: a ring runs around the edge, and the value, time or initial is the middle.
function orbCore(heart: Part | null, title: string) {
  const core = el('div', 'core')
  if (heart === null) {
    core.append(el('b', null, title.slice(0, 1).toUpperCase()))
    return core
  }
  switch (heart.kind) {
    case 'ring':
    case 'meter':
      core.append(ring(heart.value, 7, heart.kind === 'ring' ? heart.of : undefined), el('b', null, heart.label ?? `${Math.round(heart.value * 100)}%`))
      break
    case 'value':
      core.append(el('b', null, heart.value))
      if (present(heart.unit)) core.append(el('small', null, heart.unit))
      break
    case 'clock':
      core.append(ring(1, 5), el('b', 'time', clockText(heart.seconds)))
      break
    case 'person':
      core.classList.add('face-of')
      core.append(el('b', null, heart.name.slice(0, 1).toUpperCase()))
      break
    default:
      core.append(renderPart(heart, 1))
  }
  return core
}

/** Fills a thing's element for a level: its classes, its face, its heart and the parts under it. */
export function fillThing(node: HTMLElement, thing: Thing, level: Level) {
  const {heart, flow} = visibleParts(thing, level)
  node.className = `thing s-${thing.shape} lv${level} t-${thing.tone}`
  node.dataset['id'] = thing.id
  node.tabIndex = 0
  node.setAttribute('aria-label', thing.title)

  const face = el('div', 'face')
  if (thing.icon !== undefined) face.append(createElement(icons[thing.icon], {class: 'icon', 'stroke-width': 1.8}))
  face.append(el('b', 'title', thing.title))
  // A closed list still says how many it holds.
  const rows = thing.parts.find(part => part.kind === 'rows')
  if (thing.shape === 'list' && level === 0 && rows !== undefined) face.append(el('span', 'count', String(rows.items.length)))
  else if (present(thing.when)) face.append(el('span', 'when', thing.when))

  const children: HTMLElement[] = []
  if (thing.shape === 'orb') {
    children.push(orbCore(heart, thing.title), face)
    // A person's line belongs beside their circle, not inside it.
    if (heart?.kind === 'person' && present(heart.line) && level >= 1) children.push(el('div', 'p-line', heart.line))
  } else if (thing.shape === 'tile') {
    if (heart !== null) children.push(wrap('heart', renderPart(heart, level)))
    children.push(face)
  } else {
    children.push(face)
    if (heart !== null) children.push(wrap('heart', renderPart(heart, level)))
  }
  if (flow.length > 0) children.push(wrap('flow', ...flow.map(part => renderPart(part, level))))
  node.replaceChildren(...children)
}
function wrap(className: string, ...children: HTMLElement[]) {
  const node = el('div', className)
  node.append(...children)
  return node
}

export function renderThing(thing: Thing, level: Level): HTMLElement {
  const node = el('div', null)
  fillThing(node, thing, level)
  return node
}
