// Sunrise's layout engine: Horizon Dawn's sky, where every task is a small form on its ring. Three Handwired
// programs (lib/sunrise) lay it out each time anything changes:
// - attention spends attention: from how much each task matters and the stage's width, which one leads, which open
//   with their picture, and which stay small;
// - layout (Dawn's own program) puts every form on its ring, at its subject's angle. The rings are solved on a stage
//   scaled down so that a form takes the room of one of Dawn's pills, then scaled back;
// - grow-layout lifts the lead off its ring into the nearest free sky.
// One element per task grows and shrinks between its small form, its opened form and the workspace; nothing is torn
// down. The engine owns every position, including where the workspace and the trays go. What they hold, and
// everything that talks to the journal, is React's (SunriseHero.tsx), through `slots` and the host's callbacks.
import {GROUP_OTHER, type HorizonDaily, type HorizonItem} from '@/lib/horizon'
import {createAttention, salienceSteps, thingCount} from '@/lib/sunrise/attention'
import type {SunriseData} from '@/lib/sunrise/data'
import {dailyRadius, rings} from '@/lib/sunrise/geometry'
import type {GrowBox, GrowInput} from '@/lib/sunrise/grow-layout-reference'
import {createGrowLayout} from '@/lib/sunrise/grow-layout'
import {groupsOf, ringItems, ringOverflow, toInput} from '@/lib/sunrise/intent'
import {createDawnLayout} from '@/lib/sunrise/layout'
import {salienceOf} from '@/lib/sunrise/salience'
import {type Point, type Tap, type TouchGesture, isDoubleTap, isTap, needsRestart, touchGesture, touchView} from '@/lib/sunrise/touch-camera'
import {type FormThing, formHeight, formSize, fullForm, smallForm} from './forms'
import {glanceWidth} from './glance'

export type Box = {left: number, top: number, width: number, height: number}
export type TrayKind = 'holds' | 'nodate' | 'today' | 'dailies' | 'cards' | 'answers' | 'track'
/**
 * An action card on the far side: its form, how much it matters now (0 to 1), the ring it sits on (0 fits now,
 * 1 this period, 2 after, 3 someday), the bet whose slice it is in, and how it is marked.
 */
export type CardThing = {id: string, salience: number, form: FormThing, ring: number, slice: string, noticed: boolean, handed: boolean}
export type EngineHost = {
  /** A task or an action card was opened into the workspace (its id), or the workspace closed (null). */
  onOpen(taskId: string | null): void
  /** A tray opened, or closed (null). A section's tray under the sun also names its section. */
  onTray(kind: TrayKind | null, track?: string): void
  /** A daily's arc was pressed. */
  onToggleDaily(daily: HorizonDaily): void
  /** The sky was laid out again (new data, a new size, time passing). */
  onLayout?(): void
}
/** Where the rings put a task and the slices, in Horizon Dawn's own units (dawn-svg.ts's 1200 × 630 drawing). */
export type SpaceLayout = {spots: {item: HorizonItem, x: number, y: number}[], sectors: {group: string, a0: number, a1: number, mid: number}[]}

// ---- The programs, built once for the page. Building takes most of a second, so it yields between them.
type Programs = {dawn: ReturnType<typeof createDawnLayout>, grow: ReturnType<typeof createGrowLayout>, attention: ReturnType<typeof createAttention>}
let programs: Promise<Programs> | null = null
const breathe = () => new Promise<void>(resolve => setTimeout(resolve, 0))
export function loadPrograms(): Promise<Programs> {
  programs ??= (async () => {
    await breathe()
    const dawn = createDawnLayout()
    await breathe()
    const grow = createGrowLayout()
    await breathe()
    return {dawn, grow, attention: createAttention()}
  })()
  return programs
}

const SKY: [number, string][] = [[0, '#05070d'], [0.3, '#0b1730'], [0.58, '#1b3f6e'], [0.8, '#5b7aa6'], [0.92, '#c9a08a'], [1, '#e39a5f']]
const BANDS = ['rgba(255,196,128,.17)', 'rgba(255,196,128,.07)', 'rgba(170,200,240,.05)', 'rgba(170,200,240,.02)']
const SUN = ['#fff6d8', '#ffd27a', '#ff9a3c', '#ff7a2f']
// Deterministic stars over a stretch of sky, thinning toward `fadeY` (as dawn-svg.ts's starField does toward the horizon).
function starField(left: number, top: number, width: number, height: number, count: number, fadeY: number) {
  let seed = 7
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  let svg = ''
  for (let index = 0; index < count; index++) {
    const y = top + next() * height
    const x = left + next() * width
    const opacity = Math.min(1, Math.max(0, (fadeY - y) / fadeY)) * (0.25 + next() * 0.7)
    svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${next() < 0.08 ? 1.4 : 0.7}" fill="#fff" opacity="${opacity.toFixed(2)}"/>`
  }
  return svg
}

// A task on today's rings, or an action card on the far side's (its item then stands in for a task's: its ring,
// its bet as the subject, and `salience` is its own).
type Thing = {
  id: string, item: HorizonItem, salience: number | null, outer: boolean, under: boolean, inert: boolean, form: FormThing, signature: string
  el: HTMLElement, face: HTMLElement, body: HTMLElement, day: HTMLElement, seat: HTMLElement
  level: number, hook: Box | null, shown: boolean, lifted: boolean, from: {x: number, y: number} | null
  lastBox: Box | null
  at: Box | null, rest: Box | null // where it's drawn now, and where it rests when nothing hovers it
  look: string // the ring whose light its form takes
}

const escapeText = (text: string) => text.replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]!)
const trimDots = (text: string) => text.replace(/[.…]+$/, '')
// "Mon Oct 26" in a form's corner is "Oct 26".
const shortDay = (day: string) => { const parts = day.split(' '); return parts.length === 3 ? `${parts[1]} ${parts[2]}` : day }
const svgNS = 'http://www.w3.org/2000/svg'
// A form is 70 tall before the screen's scale: these rows are scales 1.26 down to 0.77. The rings take the biggest
// at which everything fits, so a day with few tasks reads large and a crowded one still holds them all.
const formRows: readonly (readonly [number, number])[] = [[0, 88], [0, 80], [0, 72], [0, 66], [0, 60], [0, 54]]
// Forms drawn narrower than their shape's footprint, because the rings had no room for them at full width.
const narrowBy = 0.7
// Pulled back, the four rings hold what is past the next two weeks: to a month, a season, a year, and beyond.
const farDays = [30, 90, 365] as const
const farBounds = {climb: 156, altitude: 324}
const ringZones = ['ignition', 'climb', 'altitude', 'orbit'] as const
// A place within one of the four rings, as hours for the ring program: `through` is 0 at the ring's inner edge.
function ringHours(ring: number, through: number) {
  const {climb, altitude} = farBounds
  return ring === 0 ? through * 48 : ring === 1 ? 48 + through * (climb - 48) : ring === 2 ? climb + through * (altitude - climb) : altitude + through * 1500
}
// How far out in its ring a card sits: the heavier it is, the nearer the sun.
const cardOut = (card: CardThing) => 1 - Math.max(0, Math.min(1, card.salience * 2))
// How far the things under the sun are pushed down past the ground's own strip (its names and chips), in px.
const underPush = 64
const monthDay = (date: Date) => date.toLocaleDateString('en-US', {month: 'short', day: 'numeric'})

export class SunriseEngine {
  /** Where React draws: the workspace, the open tray, and the capture box in the top right corner. */
  readonly slots: {pane: HTMLElement, tray: HTMLElement, cap: HTMLElement}

  private readonly root: HTMLElement
  private readonly host: EngineHost
  private readonly programs: Programs
  private readonly abort = new AbortController()
  private readonly observer: ResizeObserver
  private readonly timers = new Set<number>()
  private glideTimer = 0
  /** A one-off timer that destroy() cancels, and that leaves the set once it has run. */
  private later(run: () => void, ms: number): number {
    const timer = window.setTimeout(() => { this.timers.delete(timer); run() }, ms)
    this.timers.add(timer)
    return timer
  }

  /** The flat drawing of the sky, which the 3D world fades out as it takes over. */
  readonly flat: SVGSVGElement
  private spaceLayout: SpaceLayout = {spots: [], sectors: []}
  private readonly threads: SVGSVGElement
  private readonly labels: HTMLElement
  private readonly say: HTMLElement
  private readonly backButton: HTMLButtonElement
  private readonly pane: HTMLElement
  private readonly glowEl: HTMLElement
  private readonly groundEl: HTMLElement
  private readonly streakEl: HTMLButtonElement
  private readonly sunButton: HTMLButtonElement
  private readonly arcsEl: HTMLElement
  private readonly tray: HTMLElement
  private readonly toastEl: HTMLElement
  private readonly safeEl: HTMLElement // as tall as the window's bottom safe area (sunrise-css)
  private readonly world: HTMLElement
  private readonly viewButton: HTMLButtonElement
  private readonly lockButton: HTMLButtonElement
  private readonly fullButton: HTMLButtonElement
  private locked = false // scrolling stays in the sky: the page under it does not move
  private full = false // the sky fills the whole window
  // The camera: the world is drawn at `z` times its size, moved by x and y px. Home is 1, 0, 0.
  private view = {z: 1, x: 0, y: 0}
  // On a phone, what is drawn in world px (the camera goes no further) and the least zoom that still shows it all.
  private reach = {left: 0, top: 0, right: 1, bottom: 1}
  private minZoom = 0.4
  private lastPointer = '' // the kind of pointer that last pressed the sky: a tap on a faint bubble first shows its name
  private pinch: {z: number} | null = null // a Mac trackpad's pinch, in Safari
  // Fingers on the sky (client px): the gesture they make once one has gone further than a tap, where the stage was
  // then, and what the page took of a pull, for its fling. `off` is a touch that belongs to a tray, the workspace or a form.
  private touch: {fingers: Map<number, Point>, start: Point, gesture: TouchGesture | null, box: Point, off: boolean, paged: {at: number, dy: number}[]} | null = null
  private lastTap: Tap | null = null
  private swallowUntil = 0 // the click a drag ends with is not a press
  private flingUntil = 0
  private readonly zoneEls: HTMLElement[]
  private readonly subjectEls = new Map<string, HTMLButtonElement>()
  private readonly trackEls = new Map<string, HTMLElement>()
  private trackSectors: {name: string, mid: number}[] = [] // the sections under the sun that have a slice, and its middle in degrees
  private trackBoxes: Box[] = [] // on a phone, where their names were put, so no task covers one
  private readonly nameBoxes = new Map<HTMLElement, Box>() // on a phone, where every name at the rim is, for roomToGrow
  private smallHost: HTMLElement | null = null
  private measurer: HTMLElement | null = null
  private readonly measureContext = document.createElement('canvas').getContext('2d')

  private data: SunriseData | null = null
  private cards: CardThing[] = []
  private answers = 0 // answers given to cards so far: the far side's ground offers them
  private things: Thing[] = []
  private source: HorizonItem[] = [] // what the rings hold: today's tasks, or on the far side the cards
  private outerR = 0 // how far out the outer rings reach, in px from the sun; 0 when nothing is out there
  private outerKy = 0 // on a phone, the outer rings' height scale (they stand taller than wide), in px per ring unit
  private underK = 0 // the scale of the rings under the sun, in px per ring unit
  private underKy = 0 // and their height scale, which differs from it only on a phone
  // Where each thing under the sun sits: its ring (0 nearest the horizon) and how far through it.
  private readonly underPlace = new Map<string, {ring: number, through: number, look: string}>()
  private farSide = false // turned to the far side, where the action cards are
  private turning = false
  private subject: string | null = null // the subject you've gone into, if any
  private open: string | null = null // the task in the workspace
  private hot: Thing | null = null // the form under the pointer
  private trayKind: TrayKind | null = null
  private trayTrack: string | null = null // the section whose tray is open
  private trayWidth = 0 // the stage's width when it opened
  private readonly dailyDone = new Map<string, boolean>() // dailies pressed here, until the journal's answer arrives
  private readonly startedHere = new Set<string>()
  private ready = false
  private destroyed = false

  private stage = {width: 1, height: 1, horizonY: 1}
  private narrow = false
  private last = {x: 0, sunR: 0, ss: 1, kx: 1, ky: 1}
  private workBox: Box | null = null
  private paneFrom: Box | null = null
  private restCorners: {key: string, topLeft: {width: number, height: number}, topRight: {width: number, height: number}} | null = null
  private leadId = ''
  private compactLead = false
  private readonly sizeFor = new Map<string, number>()
  private readonly formSizes = new Map<string, readonly [number, number]>()
  private readonly fullHeights = new Map<string, number>()
  private readonly narrowForms = new Set<string>()
  private narrowSeat = false
  private commit = () => {}
  private flatKey = ''
  private hotTimer = 0
  private settleTimer = 0
  private saidSize = ''

  constructor(root: HTMLElement, programs: Programs, host: EngineHost) {
    this.root = root
    this.programs = programs
    this.host = host
    const {signal} = this.abort
    const div = (className: string) => { const node = document.createElement('div'); node.className = className; return node }

    this.flat = document.createElementNS(svgNS, 'svg')
    this.flat.setAttribute('class', 'sr-flat')
    this.flat.setAttribute('role', 'img')
    this.flat.setAttribute('aria-label', 'Tasks on rings by how soon they are due, one slice per subject')
    this.threads = document.createElementNS(svgNS, 'svg')
    this.threads.setAttribute('class', 'sr-threads')
    this.threads.setAttribute('aria-hidden', 'true')
    this.labels = div('sr-labels')
    this.glowEl = div('sr-glow')
    this.labels.append(this.glowEl)
    this.zoneEls = [...ringZones, ...ringZones].map(() => {
      const zone = div('zl')
      this.labels.append(zone)
      return zone
    })
    this.pane = div('sr-pane')
    this.pane.setAttribute('role', 'region')
    this.pane.setAttribute('aria-label', 'The task in front of you')
    const paneIn = div('sr-pane-in')
    this.pane.append(paneIn)
    this.say = div('sr-say')
    this.backButton = document.createElement('button')
    this.backButton.type = 'button'
    this.backButton.className = 'sr-back'
    this.backButton.textContent = '← All of Dawn'
    this.backButton.hidden = true
    this.say.append(this.backButton, document.createElement('h1'), document.createElement('p'))
    const cap = div('sr-cap')
    this.arcsEl = div('sr-arcs')
    this.sunButton = document.createElement('button')
    this.sunButton.type = 'button'
    this.sunButton.className = 'sr-sunbtn'
    this.groundEl = div('sr-ground')
    this.streakEl = document.createElement('button')
    this.streakEl.type = 'button'
    this.streakEl.className = 'sr-streak'
    this.streakEl.setAttribute('aria-label', 'Your dailies')
    this.tray = div('sr-tray')
    this.tray.hidden = true
    this.toastEl = div('sr-toast')
    this.toastEl.setAttribute('role', 'status')
    root.classList.add('shapes')
    // The world is what the camera moves: the rings and everything on them. The flat drawing stays a child of
    // the sky itself (the 3D world needs it there) and is moved with the same transform. The words, the capture
    // box, the workspace and the trays stay put on the screen.
    this.world = div('sr-world')
    this.world.append(this.threads, this.labels, this.arcsEl, this.sunButton, this.groundEl, this.streakEl)
    const control = (className: string) => { const button = document.createElement('button'); button.type = 'button'; button.className = className; return button }
    this.viewButton = control('sr-view')
    this.viewButton.hidden = true
    this.lockButton = control('sr-lock')
    this.fullButton = control('sr-full')
    const controls = div('sr-ctl')
    controls.append(this.viewButton, this.lockButton, this.fullButton)
    this.safeEl = div('sr-safe')
    root.append(this.flat, div('sr-day'), this.world, this.pane, this.say, cap, controls, this.tray, this.toastEl, this.safeEl)
    this.lockButton.addEventListener('click', event => { event.stopPropagation(); this.setLocked(!this.locked) }, {signal})
    this.fullButton.addEventListener('click', event => { event.stopPropagation(); this.setFull(!this.full) }, {signal})
    // A double click on the sky itself snaps the camera back to today.
    root.addEventListener('dblclick', event => {
      const target = event.target instanceof Element ? event.target : null
      if (this.open !== null || this.root.classList.contains('hz-live') || target === null || !overSky(target)) return
      if (target.closest('.thing, button, a, input, textarea, .sr-ground') !== null || this.isHome()) return
      event.preventDefault()
      this.resetView()
    }, {signal})
    this.paintControls()
    this.slots = {pane: paneIn, tray: this.tray, cap}
    this.viewButton.addEventListener('click', event => { event.stopPropagation(); this.resetView() }, {signal})

    // Press a task to open it where it is.
    this.labels.addEventListener('click', event => {
      const el = event.target instanceof Element ? event.target.closest<HTMLElement>('.thing') : null
      const thing = el === null ? undefined : this.things.find(candidate => candidate.el === el)
      if (thing === undefined) return
      // A faint bubble shows its name only under a mouse. A finger's first tap shows it; the next opens it.
      if (el!.classList.contains('ghost') && this.lastPointer !== 'mouse' && !el!.classList.contains('peek')) {
        for (const other of this.things) other.el.classList.remove('peek')
        el!.classList.add('peek')
        return
      }
      if (thing.shown && !thing.inert) this.openTask(thing.id)
    }, {signal})
    // A form under the pointer opens a little and the others step back, for as long as the pointer stays.
    this.labels.addEventListener('pointerover', event => {
      if (this.narrow || this.open !== null || event.pointerType === 'touch') return
      const el = event.target instanceof Element ? event.target.closest<HTMLElement>('.thing.form, .thing.hook') : null
      const thing = el === null ? undefined : this.things.find(candidate => candidate.el === el)
      if (thing === undefined || thing.inert) return
      window.clearTimeout(this.hotTimer)
      if (thing !== this.hot) this.hotTimer = window.setTimeout(() => this.setHot(thing), this.hot === null ? 70 : 20)
    }, {signal})
    this.labels.addEventListener('pointerout', event => {
      const to = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.thing.form, .thing.hook') : null
      if (to !== null && to === this.hot?.el) return
      window.clearTimeout(this.hotTimer)
      if (to === null) this.hotTimer = window.setTimeout(() => this.setHot(null), 110)
    }, {signal})
    this.groundEl.addEventListener('click', event => {
      const back = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-side]') : null
      if (back !== null) { event.stopPropagation(); this.turn(false); return }
      const further = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-far]') : null
      if (further !== null) { event.stopPropagation(); this.showOuter(); return }
      const chip = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-tray]') : null
      if (chip === null) return
      event.stopPropagation()
      const kind = chip.dataset['tray'] as TrayKind
      if (this.trayKind === kind) this.closeTray()
      else this.openTray(kind, chip)
    }, {signal})
    this.arcsEl.addEventListener('click', event => {
      const arc = event.target instanceof Element ? event.target.closest<HTMLElement>('.arc') : null
      const daily = arc === null ? undefined : this.data?.horizon.dailies[Number(arc.dataset['daily'])]
      if (daily !== undefined) this.toggleDaily(daily)
    }, {signal})
    // Press the sun and the sky turns over to its far side, where the action cards are, as on Dawn. Press it
    // again to come back. The dailies list is under the sun: press the week's streak.
    this.sunButton.addEventListener('click', event => {
      event.stopPropagation()
      this.turn(!this.farSide)
    }, {signal})
    this.streakEl.addEventListener('click', event => {
      event.stopPropagation()
      if (this.trayKind === 'dailies') this.closeTray()
      else this.openTray('dailies', this.streakEl)
    }, {signal})
    this.backButton.addEventListener('click', () => this.leaveSubject(), {signal})
    this.say.addEventListener('click', event => {
      if (!(event.target instanceof Element) || event.target.closest('.sr-dl') === null) return
      event.stopPropagation()
      if (this.trayKind === 'dailies') this.closeTray()
      else this.openTray('dailies', this.say)
    }, {signal})
    root.addEventListener('pointerdown', event => { this.lastPointer = event.pointerType }, {signal, capture: true})
    document.addEventListener('pointerdown', event => {
      if (this.trayKind === null || !(event.target instanceof Node)) return
      const onTrack = event.target instanceof Element && event.target.closest('.sl-track, .sr-dl') !== null
      if (!this.tray.contains(event.target) && !this.groundEl.contains(event.target) && event.target !== this.sunButton && !this.streakEl.contains(event.target) && !onTrack) this.closeTray()
    }, {signal})
    window.addEventListener('keydown', event => {
      // Inside the 3D world Escape is the world's (it asks the host first).
      if (event.key !== 'Escape' || event.defaultPrevented || this.root.classList.contains('hz-live')) return
      // Typing somewhere (the chat, the work, a reason): Escape is that field's.
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable)) return
      if (this.trayKind !== null) this.closeTray()
      else if (this.open !== null) this.closeTask()
      else if (!this.isHome()) this.resetView()
      else if (this.subject !== null) this.leaveSubject()
      else if (this.farSide) this.turn(false)
      else if (this.full) this.setFull(false)
      // The lock's own button is hidden on a narrow window; Escape is then the way out.
      else if (this.locked) this.setLocked(false)
    }, {signal})
    // Shift and scroll pulls back to the tasks past the next two weeks, and comes back.
    // The sky is a space the camera moves through. Over it, a pinch zooms about the pointer and a two-finger
    // scroll moves around. (A trackpad pinch arrives as a wheel event with Ctrl held; Safari sends its own
    // gesture events, below.) A scroll that cannot move the camera any further, such as down from the ground,
    // is left to the page, so the rest of the page stays reachable.
    const overSky = (target: EventTarget | null) => target instanceof Node && !this.pane.contains(target) && !this.tray.contains(target) && !this.slots.cap.contains(target)
    const pointIn = (event: {clientX: number, clientY: number}) => { const box = root.getBoundingClientRect(); return {x: event.clientX - box.left, y: event.clientY - box.top} }
    root.addEventListener('wheel', event => {
      if (this.open !== null || this.root.classList.contains('hz-live') || !overSky(event.target)) return
      const unit = event.deltaMode === 1 ? 16 : 1
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        const at = pointIn(event)
        this.zoomAt(at.x, at.y, this.view.z * Math.exp(-event.deltaY * unit * 0.012))
        return
      }
      const before = this.view
      this.setView(before.z, before.x - event.deltaX * unit, before.y - event.deltaY * unit)
      // Locked in, a scroll never reaches the page, even when the camera has nowhere further to go.
      if (this.locked || this.full || this.view.x !== before.x || this.view.y !== before.y) event.preventDefault()
    }, {signal, passive: false})
    // On a touch screen one finger moves the camera and two pinch it, about the point between them (the sky has
    // touch-action none, sunrise-css.ts, so the browser leaves both to us). Nothing moves until a finger has gone
    // further than a tap, so a tap on a form, a chip, an arc or the sun is still a press. A touch that starts in a
    // tray, the workspace, the capture box or on a chip is theirs, as is any while a task is open. A mouse or a pen
    // is left as it was.
    root.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch') return
      // The first finger of a new touch: whatever an earlier one left behind (a lift the sky never saw) is gone.
      if (event.isPrimary) this.touch = null
      this.swallowUntil = 0
      if (this.touch === null) {
        const target = event.target instanceof Element ? event.target : null
        const off = this.open !== null || this.root.classList.contains('hz-live') || target === null || !overSky(target)
          || target.closest('input, textarea, select, [contenteditable], .sr-ground button') !== null
        this.touch = {fingers: new Map(), start: {x: event.clientX, y: event.clientY}, gesture: null, box: {x: 0, y: 0}, off, paged: []}
        // The page still gliding from the last pull stops under the finger, as the page's own scrolling does.
        if (!off && performance.now() < this.flingUntil) window.scrollTo({left: window.scrollX, top: window.scrollY, behavior: 'instant'})
      }
      this.touch.fingers.set(event.pointerId, {x: event.clientX, y: event.clientY})
      if (this.touch.off) return
      // A second finger is a pinch at once; a finger that lands mid-gesture starts it again from the camera as it is.
      if (this.touch.gesture !== null || this.touch.fingers.size > 1) this.touchBegin()
    }, {signal})
    root.addEventListener('pointermove', event => {
      const touch = this.touch
      if (event.pointerType !== 'touch' || touch === null || touch.off) return
      const before = touch.fingers.get(event.pointerId)
      if (before === undefined) return
      const at = {x: event.clientX, y: event.clientY}
      touch.fingers.set(event.pointerId, at)
      if (touch.gesture === null) {
        if (!isTap(touch.start, at)) this.touchBegin()
        return
      }
      this.touchMove(at.y - before.y)
    }, {signal})
    const lift = (event: PointerEvent) => {
      const touch = this.touch
      if (event.pointerType !== 'touch' || touch === null || !touch.fingers.delete(event.pointerId)) return
      const moved = touch.gesture !== null
      if (touch.fingers.size > 0) {
        // The finger left goes on moving the camera from where it is.
        if (moved && !touch.off) this.touchBegin()
        return
      }
      this.touch = null
      // Cancelled, the browser took the touch over: it was no press.
      if (touch.off || event.type === 'pointercancel') return
      if (moved) {
        this.swallowUntil = performance.now() + 400
        this.fling(touch.paged)
        return
      }
      // A double tap on the open sky snaps the camera back to today, as a double click does.
      const target = event.target instanceof Element ? event.target : null
      const tap = {at: performance.now(), point: {x: event.clientX, y: event.clientY}}
      if (target === null || target.closest('.thing, button, a, input, textarea, .sr-ground') !== null) { this.lastTap = null; return }
      if (!isDoubleTap(this.lastTap, tap)) { this.lastTap = tap; return }
      this.lastTap = null
      if (!this.isHome()) this.resetView()
    }
    root.addEventListener('pointerup', lift, {signal})
    root.addEventListener('pointercancel', lift, {signal})
    root.addEventListener('click', event => {
      if (performance.now() > this.swallowUntil) return
      this.swallowUntil = 0
      event.preventDefault()
      event.stopPropagation()
    }, {signal, capture: true})
    // Safari's own pinch events. On a touch screen the fingers' pointer events (above) move the camera, so there
    // these only keep iOS from zooming the page over the sky; a Mac trackpad's pinch still zooms the camera.
    type Gesture = Event & {scale: number, clientX: number, clientY: number}
    root.addEventListener('gesturestart', event => {
      if (this.open !== null || this.root.classList.contains('hz-live') || !overSky(event.target)) return
      event.preventDefault()
      this.pinch = this.touch === null ? {z: this.view.z} : null
    }, {signal})
    root.addEventListener('gesturechange', event => {
      if (this.pinch === null || this.touch !== null) return
      event.preventDefault()
      const gesture = event as Gesture
      const at = pointIn(gesture)
      this.zoomAt(at.x, at.y, this.pinch.z * gesture.scale)
    }, {signal})
    root.addEventListener('gestureend', () => { this.pinch = null }, {signal})

    let frame = 0
    this.observer = new ResizeObserver(() => {
      // Not before the fonts are in (start, below): sizes measured in a fallback font would be kept.
      if (!this.ready) return
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => this.resized())
    })
    this.observer.observe(root)
    this.observer.observe(cap)
    // Time passes: what is due soon matters more. Every five minutes the same data is laid out again.
    this.timers.add(window.setInterval(() => { if (this.ready && this.open === null && this.hot === null) this.solve() }, 5 * 60_000))

    void (document.fonts?.ready ?? Promise.resolve()).then(() => this.start(), () => this.start())
  }

  /**
   * New data from the journal: tasks keep their elements and move; new ones appear, finished ones sink into the sun.
   * `cards` are the action cards still open, heaviest first, and `answers` how many have been answered: they are
   * what the far side shows.
   */
  update(data: SunriseData, cards: CardThing[] = [], answers = 0) {
    if (this.destroyed) return
    const before = this.data
    this.data = data
    this.cards = cards
    this.answers = answers
    for (const daily of data.horizon.dailies) if (this.dailyDone.get(daily.id) === daily.done) this.dailyDone.delete(daily.id)
    this.source = this.farSide ? cards.map(card => this.cardItem(card)) : data.horizon.items
    const items = ringItems(this.source)
    const cardOf = new Map(cards.map(card => [card.id, card]))
    const wanted = [
      ...items.map(item => {
        const card = this.farSide ? cardOf.get(item.id) : undefined
        return {id: item.id, item, salience: card?.salience ?? null, outer: false, form: card?.form ?? this.formOf(item)}
      }),
      // What today's rings have no room for sits further out in the same sky, on rings by the month and season.
      ...(this.farSide ? [] : this.outerItems(data)).map(item => ({id: item.id, item, salience: 0 as number | null, outer: true, form: this.formOf(item)})),
    ].map(each => ({...each, under: false, inert: false}))
    // Under the sun is the want-to-do side, in its sections.
    this.underPlace.clear()
    if (!this.farSide) {
      for (const below of this.underItems(data)) {
        this.underPlace.set(below.item.id, {ring: below.ring, through: below.through, look: below.look})
        wanted.push({id: below.item.id, item: below.item, salience: 0, outer: false, under: true, inert: below.inert, form: below.form})
      }
    }
    const keep = new Set(wanted.map(each => each.id))
    const wasUndated = new Set(before?.horizon.undated.map(undated => undated.id) ?? [])
    const chip = this.groundEl.querySelector('.nodate')
    for (const thing of this.things.filter(candidate => !keep.has(candidate.id))) this.removeThing(thing)
    this.things = this.things.filter(thing => keep.has(thing.id))
    for (const each of wanted) {
      const signature = JSON.stringify(each.form)
      const thing = this.things.find(candidate => candidate.id === each.id)
      if (thing === undefined) {
        const added = this.addThing(each.id, each.item, each.salience, each.outer, each.under, each.inert, each.form, signature)
        // A task that just got its When flies up from the ground to its ring.
        if (wasUndated.has(each.id) && chip !== null && this.ready) {
          const rect = this.toWorld(this.rectIn(chip))
          added.el.style.transition = 'none'
          this.setBox(added.el, {left: rect.left, top: rect.top, width: Math.max(60, rect.width), height: 28})
          void added.el.offsetWidth
          added.el.style.transition = ''
        }
        continue
      }
      thing.item = each.item
      thing.salience = each.salience
      thing.outer = each.outer
      thing.under = each.under
      thing.inert = each.inert
      thing.day.textContent = each.item.day
      if (thing.signature !== signature) {
        thing.form = each.form
        thing.signature = signature
        this.forget(thing.id)
        thing.body.dataset['key'] = ''
        thing.face.dataset['key'] = ''
      }
    }
    // The order attention reads them in is the rings' own: soonest first.
    const position = new Map(wanted.map((each, index) => [each.id, index]))
    this.things.sort((a, b) => position.get(a.id)! - position.get(b.id)!)
    if (this.subject !== null && !groupsOf(this.source).includes(this.subject)) this.subject = null
    if (this.open !== null && this.workBox === null) this.open = null
    // The card that was open is gone (withdrawn, or answered somewhere else): its pane would stay
    // up with nothing in it, and on a narrow screen cover the whole sky.
    if (this.open?.startsWith('card:') && !cards.some(card => card.id === this.open)) this.closeTask()
    this.flatKey = ''
    if (this.ready) this.solve()
  }

  /** Opens a task into the workspace, growing from its form (or from the sun, when it has none on the rings). */
  openTask(taskId: string) {
    if (this.destroyed || this.data === null) return
    if (this.open !== null) this.open = null
    const thing = this.things.find(candidate => candidate.id === taskId)
    const from = thing?.at === null || thing?.at === undefined ? null : this.toScreen(thing.at)
    this.open = taskId
    if (!taskId.startsWith('card:')) this.startedHere.add(taskId)
    this.closeTray()
    window.clearTimeout(this.hotTimer)
    this.hot = null
    this.root.classList.remove('hovering')
    // It grows where its form is; a task with no form on the rings rises out of the sun.
    this.paneFrom = from ?? this.toScreen(this.sunCircle())
    // On a phone a task's workspace is the whole screen (sunrise-css .sr-pane.full); a card stays in the sky.
    this.pane.classList.toggle('full', this.narrow && !taskId.startsWith('card:'))
    this.pane.style.transition = 'none'
    this.placePane(this.paneFrom, false)
    void this.pane.offsetWidth
    this.pane.style.transition = ''
    this.root.classList.add('working')
    this.workBox = this.workRect(from, taskId.startsWith('card:'))
    this.solve()
    requestAnimationFrame(() => { if (this.workBox !== null) this.placePane(this.workBox, true) })
    this.host.onOpen(taskId)
  }

  /** Moves the camera back until the outer rings, and the tasks further out on them, are in view. */
  showOuter() {
    const {width: W, height: H} = this.stage
    if (this.outerR <= 0) return
    if (this.narrow) {
      // A phone: the outer rings stand tall around the others and some places sit above the stage (solve), so the
      // camera takes in everything out there and the ground, as near as it may.
      const Y = this.stage.horizonY
      const far = {left: W / 2 - this.outerR, top: Y - (rings[4] * this.last.ky + 40 + (rings[4] - rings[0]) * this.outerKy), right: W / 2 + this.outerR, bottom: Y + 48}
      for (const thing of this.things) {
        if (!thing.outer || thing.rest === null) continue
        far.left = Math.min(far.left, thing.rest.left)
        far.right = Math.max(far.right, thing.rest.left + thing.rest.width)
        far.top = Math.min(far.top, thing.rest.top)
      }
      const z = Math.max(0.4, Math.min(1, (W - 16) / (far.right - far.left), (H - 16) / (far.bottom - far.top)))
      this.setView(z, W / 2 - (far.left + far.right) / 2 * z, H - 8 - far.bottom * z, true)
      return
    }
    const z = Math.max(0.4, Math.min(1, (W / 2 - 24) / this.outerR, (this.stage.horizonY - 24) / this.outerR))
    this.setView(z, W / 2 * (1 - z), H * (1 - z), true)
  }

  /**
   * Turns the sky over to its far side, where the action cards sit on the rings (by when they fit, one slice per
   * bet), or back to today. The sky rolls about the horizon as it turns.
   */
  turn(farSide: boolean) {
    if (this.farSide === farSide || this.turning || this.data === null || this.destroyed) return
    this.closeTray()
    if (this.open !== null) this.closeTask()
    this.setHot(null)
    const swap = () => {
      this.farSide = farSide
      this.subject = null
      this.resetView()
      this.root.classList.toggle('farside', farSide)
      this.root.classList.add('resizing')
      this.update(this.data!, this.cards, this.answers)
      this.later(() => this.root.classList.remove('resizing'), 50)
    }
    if (!this.ready || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { swap(); return }
    this.turning = true
    this.root.style.setProperty('--hy', `${this.stage.horizonY}px`)
    this.root.classList.add('turn-out')
    this.later(() => {
      if (this.destroyed) return
      swap()
      this.root.classList.remove('turn-out')
      this.root.classList.add('turn-in')
      this.later(() => { this.root.classList.remove('turn-in'); this.turning = false }, 460)
    }, 300)
  }

  /** Closes the workspace: it shrinks back into the task's form. */
  closeTask() {
    if (this.open === null) return
    const thing = this.things.find(candidate => candidate.id === this.open)
    this.open = null
    this.workBox = null
    this.root.classList.remove('working')
    this.placePane(thing?.at === null || thing?.at === undefined ? this.paneFrom ?? this.toScreen(this.sunCircle()) : this.toScreen(thing.at), false)
    // A whole-screen workspace fades where it is, and goes back into the sky once it is out of sight.
    if (this.pane.classList.contains('full')) this.later(() => { if (this.open === null) this.pane.classList.remove('full') }, 340)
    this.host.onOpen(null)
    if (!this.destroyed) this.solve()
  }

  closeTray() {
    if (this.trayKind === null) return
    this.trayKind = null
    this.trayTrack = null
    this.tray.hidden = true
    this.host.onTray(null)
  }

  /** The current layout in Dawn's units, for the 3D world (dawn-space.ts's setLayout). */
  layoutForSpace(): SpaceLayout { return this.spaceLayout }

  /** Locks scrolling into the sky: the page under it stays put until it is unlocked. */
  setLocked(locked: boolean) {
    this.locked = locked
    if (!locked && this.full) this.full = false
    this.applyHold()
  }
  /** Makes the sky fill the whole window (which also locks it), or gives the page back. */
  setFull(full: boolean) {
    this.full = full
    this.locked = full
    this.applyHold()
  }
  private applyHold() {
    const hero = this.root.parentElement
    const page = document.documentElement
    if (this.locked && !this.full) hero?.scrollIntoView({block: 'start'})
    hero?.classList.toggle('sr-fullpage', this.full)
    page.classList.toggle('sr-held', this.locked || this.full)
    this.paintControls()
    try { localStorage.setItem('sunrise-hold', this.full ? 'full' : this.locked ? 'locked' : '') } catch { /* no storage here: it just isn't remembered */ }
  }
  private paintControls() {
    this.lockButton.textContent = this.locked ? 'Locked in · unlock' : 'Lock scrolling here'
    this.lockButton.title = this.locked ? 'Let scrolling move the page again' : 'Keep scrolling inside the sky: the page will not move'
    this.lockButton.classList.toggle('on', this.locked)
    // On a phone it is just its icon, in the corner (sunrise-css): corners out to fill the window, in to give it back.
    const label = this.full ? 'Exit full page' : 'Full page'
    const icon = this.full ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'
    this.fullButton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icon}"/></svg><span>${label}</span>`
    this.fullButton.setAttribute('aria-label', label)
    this.fullButton.title = this.full ? 'Give the rest of the page back' : 'Let the sky fill the whole window'
    this.fullButton.classList.toggle('on', this.full)
  }

  /** Puts the camera back home: nothing zoomed, nothing moved. */
  resetView() { this.setView(1, 0, 0, true) }

  /** A short message at the foot of the sky. */
  toast(text: string) {
    this.toastEl.textContent = text
    this.toastEl.classList.add('on')
    const earlier = Number(this.toastEl.dataset['timer'] ?? 0)
    window.clearTimeout(earlier)
    this.timers.delete(earlier)
    this.toastEl.dataset['timer'] = String(this.later(() => this.toastEl.classList.remove('on'), 2600))
  }

  destroy() {
    this.destroyed = true
    this.abort.abort()
    this.observer.disconnect()
    for (const timer of this.timers) { window.clearTimeout(timer); window.clearInterval(timer) }
    window.clearTimeout(this.hotTimer)
    window.clearTimeout(this.settleTimer)
    this.root.parentElement?.classList.remove('sr-fullpage')
    document.documentElement.classList.remove('sr-held')
    this.root.replaceChildren()
    this.root.classList.remove('shapes', 'ready', 'narrow', 'hovering', 'settling', 'working', 'resizing', 'farside', 'turn-out', 'turn-in', 'zoomed', 'gliding')
  }

  // ---- Things.
  // What today's rings leave out: the tasks past Orbit's six, and any the rings had no room for.
  private outerItems(data: SunriseData): HorizonItem[] {
    return [...ringOverflow(data.horizon.items), ...data.horizon.further].sort((a, b) => a.hours - b.hours).slice(0, 16)
  }
  // What sits under the sun: the want-to-do side. Each section (Recharge, Level Up, his own labels, Life) is a
  // slice, as each class is one above, and a task sits nearer the horizon the higher it is in his queue. What is
  // overdue or has no date stays one press away, on the ground's chips.
  private underItems(data: SunriseData): {item: HorizonItem, ring: number, through: number, look: string, inert: boolean, form: FormThing}[] {
    const blank = {listType: 'want-to-do' as const, weight: 2, due: '', implied: false, hours: 0, zone: 'hold' as const, left: '', day: ''}
    const rows = new Map<string, number>()
    const shown = new Map<string, number>()
    for (const want of data.horizon.wants) shown.set(want.track, (shown.get(want.track) ?? 0) + 1)
    return data.horizon.wants.slice(0, 16).map(want => {
      const row = rows.get(want.track) ?? 0
      rows.set(want.track, row + 1)
      const count = shown.get(want.track) ?? 1
      // The ring nearest the sun is too short an arc for a form: sections start on the second.
      const depth = 1 + row * 3 / Math.max(3, count)
      const ring = Math.min(3, Math.floor(depth))
      const item: HorizonItem = {...blank, id: want.id, title: want.title, short: want.short, label: want.label, group: want.track}
      // Its form names its section where a task above names its class.
      const {spec} = this.formOf(item)
      const kind = spec.kind.replace(/^(Life|Other|Task)\b/i, want.track)
      return {item, ring, through: count <= 3 ? 0.5 : depth - ring, look: 'under want', inert: false, form: {spec: {...spec, kind}, when: ''}}
    })
  }
  // A task further out as the ring program reads it: its ring is by how far off it is (a month, a season, a
  // year, beyond), and its place in the ring by how far through that stretch.
  private outerItem(item: HorizonItem, elapsed: number): HorizonItem {
    const days = Math.max(0, item.hours - elapsed) / 24
    const band = days <= farDays[0] ? 0 : days <= farDays[1] ? 1 : days <= farDays[2] ? 2 : 3
    const from = band === 0 ? 0 : farDays[band - 1]!
    const through = band === 3 ? Math.min(1, (days - from) / 365) : (days - from) / (farDays[band]! - from)
    return {...item, zone: ringZones[band]!, hours: ringHours(band, through)}
  }
  // A card as the ring program reads it: its ring is when it fits, its slice is its bet, and within its ring the
  // heavier it is the nearer the sun.
  private cardItem(card: CardThing): HorizonItem {
    const ring = Math.max(0, Math.min(3, card.ring))
    const hours = ringHours(ring, cardOut(card))
    const {spec, when} = card.form
    return {
      id: card.id, listType: 'want-to-do', title: spec.what, short: spec.name, label: card.slice, group: card.slice,
      weight: 1 + Math.round(Math.max(0, Math.min(1, card.salience * 2)) * 4), due: '', implied: false, hours, zone: ringZones[ring]!, day: when, left: '',
    }
  }
  private formOf(item: HorizonItem): FormThing {
    const spec = this.data?.forms[item.id] ?? {
      id: item.id, listType: item.listType, shape: 'pill' as const, icon: 'doc' as const, kind: item.group === GROUP_OTHER ? 'Task' : item.group,
      name: trimDots(item.short), next: '', what: item.title, did: [], say: [trimDots(item.short), ''] as [string, string], parts: [],
      ready: false, hasWork: false, filling: false,
    }
    return {spec, when: shortDay(item.day)}
  }
  private addThing(id: string, item: HorizonItem, salience: number | null, outer: boolean, under: boolean, inert: boolean, form: FormThing, signature: string): Thing {
    const el = document.createElement('div')
    el.className = 'thing lv0 gone'
    el.dataset['id'] = id
    const face = document.createElement('div')
    face.className = 'face'
    const body = document.createElement('div')
    body.className = 'body'
    const day = document.createElement('span')
    day.className = 'd'
    day.textContent = item.day
    el.append(face, body, day)
    const seat = document.createElement('div')
    seat.className = 'seat'
    this.labels.append(seat, el)
    const thing: Thing = {id, item, salience, outer, under, inert, form, signature, el, face, body, day, seat, level: 0, hook: null, shown: false, lifted: false, from: null, lastBox: null, at: null, rest: null, look: item.zone}
    this.things.push(thing)
    return thing
  }
  // Finished, let go or moved off the rings: it sinks toward the sun and is gone.
  private removeThing(thing: Thing) {
    if (this.hot === thing) this.hot = null
    this.forget(thing.id)
    thing.seat.remove()
    thing.el.className = `${thing.el.className.replace(/\b(ghost|hot|opened)\b/g, '')} gone leaving`
    this.setBox(thing.el, {left: this.stage.width / 2 - 10, top: this.stage.horizonY - 10, width: 20, height: 20})
    this.later(() => thing.el.remove(), 1000)
  }
  private forget(id: string) {
    for (const cache of [this.formSizes, this.fullHeights]) for (const key of [...cache.keys()]) if (key.startsWith(`${id}|`)) cache.delete(key)
  }

  // ---- Measuring.
  private textWidth(text: string, weight = 500) {
    if (this.measureContext === null) return text.length * 7
    const family = getComputedStyle(this.root).getPropertyValue('--sans').trim() || 'system-ui, sans-serif'
    this.measureContext.font = `${weight} 12px ${family}`
    return Math.ceil(this.measureContext.measureText(text).width)
  }
  private pillLabel(thing: Thing) {
    const short = trimDots(thing.item.short)
    return short.length > 16 ? `${short.slice(0, 15).trimEnd()}…` : short
  }
  private pillWidth(thing: Thing) { return this.textWidth(this.pillLabel(thing), thing.level > 0 ? 600 : 500) + 20 }
  // The few tasks that matter most (level 2) get their full form with its picture. The rest are compact: what it
  // is, its name and its next step. The rings have room for only a few full forms near the sun.
  private isCompact(thing: Thing) { return thing.level < 2 }
  private ownSize(thing: Thing, compact = this.isCompact(thing)): readonly [number, number] {
    const key = `${thing.id}|${compact}`
    let size = this.formSizes.get(key)
    if (size === undefined) {
      if (this.smallHost === null) {
        this.smallHost = document.createElement('div')
        this.smallHost.className = 'measure-sm'
        this.labels.append(this.smallHost)
      }
      size = formSize(thing.form, this.smallHost, compact)
      this.formSizes.set(key, size)
    }
    return size
  }
  private narrowWidth(thing: Thing) { return Math.round(this.ownSize(thing)[0] * (this.narrowForms.has(thing.id) ? narrowBy : 1)) }
  private formBox(thing: Thing, rowHeight: number) {
    const scale = rowHeight / formHeight
    return {width: Math.round(this.narrowWidth(thing) * scale), height: Math.round(this.ownSize(thing)[1] * scale)}
  }
  // An opened form is as tall as its parts make it: measured once in a hidden copy, at the width it opens to.
  private fullBox(thing: Thing, level: 2 | 3, compact = false) {
    const width = this.narrow ? Math.min(340, this.stage.width - 32) : level === 3 ? 336 : thing.form.spec.glance === undefined ? 280 : glanceWidth
    const key = `${thing.id}|${level}|${compact}|${width}`
    let height = this.fullHeights.get(key)
    if (height === undefined) {
      if (this.measurer === null) {
        this.measurer = document.createElement('div')
        this.labels.append(this.measurer)
      }
      this.measurer.className = `measure thing form ${level === 3 ? 'hook lv3' : 'hot'}`
      this.measurer.style.width = `${width}px`
      const body = document.createElement('div')
      body.className = 'body'
      const full = document.createElement('div')
      full.className = 'f'
      full.append(fullForm(thing.form, level, compact))
      body.append(full)
      this.measurer.replaceChildren(body)
      height = Math.ceil(this.measurer.offsetHeight)
      this.measurer.replaceChildren()
      this.fullHeights.set(key, height)
    }
    return {width, height}
  }
  // ---- The camera.
  private toScreen(box: Box): Box {
    const {z, x, y} = this.view
    return {left: box.left * z + x, top: box.top * z + y, width: box.width * z, height: box.height * z}
  }
  private toWorld(box: Box): Box {
    const {z, x, y} = this.view
    return {left: (box.left - x) / z, top: (box.top - y) / z, width: box.width / z, height: box.height / z}
  }
  private isHome() { return this.view.z === 1 && this.view.x === 0 && this.view.y === 0 }
  private zoomLimit(to: number) {
    // Close to life size snaps to it, so home is easy to come back to.
    const z = Math.max(this.narrow ? this.minZoom : 0.4, Math.min(3, to))
    return Math.abs(z - 1) < 0.04 ? 1 : z
  }
  private zoomAt(px: number, py: number, to: number) {
    const z = this.zoomLimit(to)
    const k = z / this.view.z
    this.setView(z, px - (px - this.view.x) * k, py - (py - this.view.y) * k)
  }
  // The camera stays inside what is drawn: one and a half stages to each side, a stage and a half up, and a
  // stage and a quarter down under the sun.
  private keptView(z: number, x: number, y: number) {
    const {width: W, height: H} = this.stage
    const keep = (at: number, size: number, low: number, high: number) => Math.min(-low * z, Math.max(size - high * z, at))
    if (this.narrow) {
      // A phone goes only as far as something is drawn, so a pull down reaches the sections and then the page under
      // the sky, not empty ground. What fits on the screen whole sits in the middle of it.
      const {left, top, right, bottom} = this.reach
      const held = (at: number, size: number, low: number, high: number) => (high - low) * z <= size ? (size - (low + high) * z) / 2 : keep(at, size, low, high)
      return {z, x: held(x, W, left, right), y: held(y, H, top, bottom)}
    }
    return {z, x: keep(x, W, -1.5 * W, 2.5 * W), y: keep(y, H, -1.6 * H, 2.25 * H)}
  }
  /** On a phone: how far what is drawn reaches, in world px, and so the least zoom that shows all of it. */
  private measureReach() {
    const {width: W, height: H, horizonY: Y} = this.stage
    let left = 0, top = 0, right = W, bottom = H
    if (this.outerR > 0) {
      left = W / 2 - this.outerR
      right = W / 2 + this.outerR
      top = Y - (rings[4] * this.last.ky + 40 + (rings[4] - rings[0]) * this.outerKy)
    }
    const boxes = [...this.things.map(thing => thing.rest ?? (thing.el.classList.contains('ghost') ? thing.lastBox : null)), ...this.trackBoxes]
    for (const box of boxes) {
      if (box === null) continue
      left = Math.min(left, box.left)
      right = Math.max(right, box.left + box.width)
      top = Math.min(top, box.top)
      bottom = Math.max(bottom, box.top + box.height + 16) // a pill's day hangs under it
    }
    // A margin past whatever reaches out of the stage; what is inside it moves nothing.
    this.reach = {left: Math.min(0, left - 16), top: Math.min(0, top - 24), right: Math.max(W, right + 16), bottom: Math.max(H, bottom + 24)}
    const fits = Math.min(W / (this.reach.right - this.reach.left), H / (this.reach.bottom - this.reach.top))
    // Never so far out that a name cannot be read (the names grow back as the camera pulls out, setView).
    this.minZoom = Math.max(0.4, Math.min(1, Math.floor(fits * 100) / 100))
  }
  private setView(z: number, x: number, y: number, glide = false, keepTray = false) {
    const next = this.keptView(z, x, y)
    // Within a couple of pixels of home is home.
    this.view = z === 1 && Math.abs(next.x) < 3 && Math.abs(next.y) < 3 ? {z: 1, x: 0, y: 0} : next
    const home = this.isHome()
    const transform = home ? '' : `translate(${this.view.x.toFixed(1)}px,${this.view.y.toFixed(1)}px) scale(${this.view.z.toFixed(4)})`
    this.root.classList.toggle('gliding', glide)
    if (glide) {
      // One glide at a time: an earlier glide's timer would end this one's early.
      window.clearTimeout(this.glideTimer)
      this.timers.delete(this.glideTimer)
      this.glideTimer = this.later(() => this.root.classList.remove('gliding'), 420)
    }
    this.world.style.transform = transform
    this.flat.style.transform = transform
    // Pulled back on a phone, the names grow back toward their own size (sunrise-css --lk), as far as they have
    // room to (roomToGrow).
    if (this.narrow) this.root.style.setProperty('--lk', this.view.z >= 0.85 ? '1' : Math.min(2.2, 0.85 / this.view.z).toFixed(3))
    this.root.classList.toggle('zoomed', !home)
    this.viewButton.hidden = home
    // A phone has no room for the long label beside the chips that pass under it: one word there.
    if (!home) this.viewButton.textContent = this.narrow ? '↺ Today' : this.view.z === 1 ? 'Back to today' : `${Math.round(this.view.z * 100)}% · Back to today`
    if (this.narrow) this.viewButton.setAttribute('aria-label', 'Back to today')
    if (this.trayKind !== null && !keepTray) this.closeTray()
  }
  // ---- Touch (the handlers are in the constructor): touch-camera.ts says where the camera goes, the camera above keeps it in.
  /** The fingers in stage px, against where the stage was when the gesture (re)started. */
  private touchPoints() {
    const {fingers, box} = this.touch!
    return new Map([...fingers].map(([id, at]) => [id, {x: at.x - box.x, y: at.y - box.y}]))
  }
  /** Takes the fingers for the camera, or starts the gesture again from the camera as it is now, so nothing jumps. */
  private touchBegin() {
    const touch = this.touch!
    if (touch.gesture === null) {
      // From here the fingers are the camera's, wherever they go.
      for (const id of touch.fingers.keys()) { try { this.root.setPointerCapture(id) } catch { /* that finger is already up */ } }
    }
    const box = this.root.getBoundingClientRect()
    touch.box = {x: box.left, y: box.top}
    touch.gesture = touchGesture(this.touchPoints(), this.view)
  }
  /**
   * The camera for where the fingers are now, kept inside what is drawn. A pull up or down that the camera cannot
   * follow any further scrolls the page instead (`dy` is how far the finger just moved), so what is under the sky stays
   * reachable on a phone, where the sky fills the screen; and a sky the page has half scrolled away comes back into
   * view before the camera moves. Locked in or full page, the page never moves.
   */
  private touchMove(dy: number) {
    const touch = this.touch!
    let gesture = touch.gesture!
    const points = this.touchPoints()
    if (needsRestart(gesture, points)) { this.touchBegin(); gesture = touch.gesture! }
    const paging = gesture.ids.length === 1 && !this.locked && !this.full
    if (paging && dy !== 0) {
      const box = this.root.getBoundingClientRect()
      const owed = dy > 0 ? Math.max(0, Math.min(dy, -box.top)) : -Math.max(0, Math.min(-dy, box.bottom - window.innerHeight))
      if (Math.abs(owed) >= 0.5 && this.scrollPage(owed)) { this.touchBegin(); return }
    }
    const want = touchView(gesture, points)
    const z = this.zoomLimit(want.z)
    const at = z === want.z ? want : touchView(gesture, points, z)
    const kept = this.keptView(at.z, at.x, at.y)
    this.setView(at.z, at.x, at.y)
    // At an edge the gesture starts again from where the camera stopped, so coming back moves it at once.
    const over = at.y - kept.y
    if (want.z < (this.narrow ? this.minZoom : 0.4) || want.z > 3 || Math.abs(at.x - kept.x) >= 0.5 || Math.abs(over) >= 0.5) {
      if (paging && Math.abs(over) >= 0.5) this.scrollPage(over)
      this.touchBegin()
    }
  }
  /** Scrolls the page as a finger moving `dy` px down would; true when it moved. What it took is kept for the fling. */
  private scrollPage(dy: number) {
    const was = window.scrollY
    window.scrollBy(0, -dy)
    const moved = was - window.scrollY
    if (moved !== 0) this.touch?.paged.push({at: performance.now(), dy: moved})
    return moved !== 0
  }
  /** A pull that was scrolling the page when the finger left carries on a little, as the page's own scrolling would. */
  private fling(paged: {at: number, dy: number}[]) {
    const now = performance.now()
    const last = paged[paged.length - 1]
    if (last === undefined || now - last.at > 60) return
    const recent = paged.filter(step => now - step.at <= 100)
    const span = Math.max(16, now - recent[0]!.at)
    const speed = recent.reduce((sum, step) => sum + step.dy, 0) / span
    if (Math.abs(speed) <= 0.3) return
    window.scrollBy({top: -speed * 300, behavior: 'smooth'})
    this.flingUntil = now + 800
  }

  private rectIn(el: Element): Box {
    const rect = el.getBoundingClientRect()
    const base = this.root.getBoundingClientRect()
    return {left: rect.left - base.left, top: rect.top - base.top, width: rect.width, height: rect.height}
  }
  private measureStage() {
    const width = Math.max(320, Math.round(this.root.clientWidth))
    const height = Math.max(480, Math.round(this.root.clientHeight))
    this.narrow = width < 700
    this.root.classList.toggle('narrow', this.narrow)
    // Full page on a phone, the ground's strip stays above the home indicator.
    const safe = this.narrow && this.full ? this.safeEl.offsetHeight : 0
    this.stage = {width, height, horizonY: Math.max(240, height - (this.narrow ? 64 + safe : 70))}
    const {say} = this
    const {cap} = this.slots
    cap.style.top = this.narrow ? `${say.offsetTop + say.offsetHeight + 10}px` : ''
    // The capture box at rest: it may grow while you type, and the sky does not move for that.
    const capBottom = cap.offsetTop + Math.min(cap.offsetHeight, 64)
    const sayBottom = say.offsetTop + say.offsetHeight
    this.saidSize = `${say.offsetWidth}x${say.offsetHeight}`
    if (this.narrow) return {topLeft: {width, height: Math.ceil(Math.max(sayBottom, capBottom) + 6)}, topRight: {width: 0, height: 0}}
    return {
      topLeft: {width: Math.ceil(say.offsetLeft + say.offsetWidth + 12), height: Math.ceil(sayBottom + 8)},
      topRight: {width: Math.ceil(width - cap.offsetLeft + 12), height: Math.ceil(capBottom + 8)},
    }
  }

  // ---- Solving: attention, then the rings, then the lead's place in the sky.
  private salience(thing: Thing, elapsed: number, todayOpen: Set<string>) {
    const data = this.data!
    if (thing.outer || thing.under) return 0
    // A card's salience is its own; a task's follows the clock and the lists.
    const value = thing.salience ?? salienceOf({
      hours: thing.item.hours - elapsed, weight: thing.item.weight, today: todayOpen.has(thing.id),
      currentRank: data.current[thing.id] ?? null, ready: thing.form.spec.ready,
    })
    if (this.subject !== null) return thing.item.group === this.subject ? Math.min(1, value + 0.25) : 0
    return value
  }

  private solve() {
    const data = this.data
    if (data === null || this.destroyed) return
    const {dawn, grow, attention} = this.programs
    const {things} = this
    let corners = this.measureStage()
    const {width: W, horizonY: Y} = this.stage
    const narrow = this.narrow
    const boxed = !narrow
    const horizon = data.horizon
    const elapsed = Math.max(0, (Date.now() - Date.parse(horizon.now)) / 36e5)
    // An open task shrinks nothing: the layout keeps the corners it had, so nothing moves under the work.
    const cornerKey = `${W}x${this.stage.height}`
    if (this.open !== null && this.restCorners?.key === cornerKey) corners = {topLeft: {...this.restCorners.topLeft}, topRight: {...this.restCorners.topRight}}
    else if (this.open === null) this.restCorners = {key: cornerKey, topLeft: {...corners.topLeft}, topRight: {...corners.topRight}}

    // 1. Attention.
    const todayOpen = new Set(data.today.filter(row => !row.completed).map(row => row.id))
    const salience = things.map(thing => Math.round(this.salience(thing, elapsed, todayOpen) * salienceSteps))
    const spent = attention.run({width: W, salience: Array.from({length: thingCount}, (_, index) => salience[index] ?? 0)})
    things.forEach((thing, index) => { thing.level = spent.levels[index] ?? 0 })
    const rankOfThing = (thing: Thing) => spent.ranks[things.indexOf(thing)] ?? 99
    const order = [...things].sort((a, b) => rankOfThing(a) - rankOfThing(b))
    const lead = things.find(thing => thing.level === 3)
    this.leadId = lead?.id ?? ''
    // A phone keeps a shelf under the words for the lead: the arches stand below it.
    const shelfTop = corners.topLeft.height + 10
    const shelf = narrow && lead !== undefined
    const cornersAsDrawn = {topLeft: {...corners.topLeft}, topRight: {...corners.topRight}}
    if (shelf) corners.topLeft.height += this.fullBox(lead, 3, true).height + 30

    // 2. The rings. Gone into a subject, its slice opens to the whole fan and the others fold away.
    const ringThings = things.filter(thing => !thing.outer && !thing.under)
    const outerThings = things.filter(thing => thing.outer)
    const underThings = things.filter(thing => thing.under)
    const items = ringThings.map(thing => thing.item)
    const cardOf = new Map(this.farSide ? this.cards.map(card => [card.id, card]) : [])
    ringThings.forEach((thing, index) => {
      const card = cardOf.get(thing.id)
      thing.look = `${items[index]!.zone}${card === undefined ? '' : ` is-card${card.noticed ? ' noticed' : ''}${card.handed ? ' handed' : ''}`}`
    })
    const groups = groupsOf(this.source)
    const weights = this.subject === null ? undefined : new Map(groups.map(group => [group, group === this.subject ? 4 : 0]))
    const thingOf = (item: HorizonItem) => ringThings.find(thing => thing.id === item.id)
    const bounds = this.farSide ? farBounds : {climb: horizon.bounds.climb - elapsed, altitude: horizon.bounds.altitude - elapsed}
    this.narrowForms.clear()
    this.narrowSeat = false
    const ringInput = (size: readonly [number, number]) => {
      const S = boxed ? (size[1] + 10) / 46 : 1
      const scaled = (box: {width: number, height: number}) => ({width: Math.ceil(box.width / S), height: Math.ceil(box.height / S)})
      const stageNow = {viewportWidth: Math.floor(W / S), horizonY: Math.floor(Y / S), topLeft: scaled(corners.topLeft), topRight: scaled(corners.topRight)}
      const input = toInput({items, groups, bounds, dailies: horizon.dailies.length > 0, ...weights === undefined ? {} : {weights}}, stageNow, item => {
        const thing = thingOf(item)
        if (thing === undefined) return 80
        // Every slot is a form wide, the lead's too (it lifts into the sky and leaves its seat), so the layout is
        // the same whichever task leads.
        if (boxed) return Math.ceil(((this.narrowSeat && thing.level === 3 ? 64 : this.formBox(thing, size[1]).width) + 10) / S) - 10
        return this.pillWidth(thing)
      })
      return {input, S}
    }
    // The far side's rings are a preference, as on Dawn: many cards fit "now" at once, so a card that finds no
    // room on its ring steps one ring out, the least important first, until everything has a place.
    const spreadOut = (input: ReturnType<typeof ringInput>['input']) => {
      let ring = dawn.run(input)
      if (!this.farSide) return ring
      for (let guard = 0; guard < 60 && (ring.overlapCount > 0 || ring.unplacedCount > 0); guard++) {
        const stuck = items.map((item, index) => ({item, index}))
          .filter(({index}) => { const slot = input.slots[index]!; return slot.visible && slot.zone < 3 && !ring.pills[index]!.free })
          .sort((a, b) => (spent.ranks[things.findIndex(thing => thing.id === b.item.id)] ?? 99) - (spent.ranks[things.findIndex(thing => thing.id === a.item.id)] ?? 99))[0]
        if (stuck === undefined) break
        const slot = input.slots[stuck.index]!
        const card = cardOf.get(stuck.item.id)
        slot.zone += 1
        slot.hours = Math.round(ringHours(slot.zone, card === undefined ? 0.5 : cardOut(card)) * 4) / 4
        ring = dawn.run(input)
      }
      return ring
    }
    // The biggest of five form sizes at which Dawn's rings hold them all with no overlap, remembered for this stage.
    let rowSize: readonly [number, number] = formRows[formRows.length - 1]!
    if (boxed) {
      const sizeKey = `${W}x${this.stage.height}|${this.subject ?? ''}|${this.farSide}`
      const fitsAt = (index: number) => { const fit = spreadOut(ringInput(formRows[index]!).input); return fit.overlapCount === 0 && fit.unplacedCount === 0 }
      let index = this.sizeFor.get(sizeKey)
      if (index === undefined) {
        index = 0
        while (index < formRows.length - 1 && !fitsAt(index)) index++
      } else if (!fitsAt(index)) {
        // Later it only steps down, and only to a size that holds everything again; otherwise the size stays and
        // what's in the way narrows or folds (below), so forms don't keep changing size as time passes.
        for (let smaller = index + 1; smaller < formRows.length; smaller++) {
          if (fitsAt(smaller)) { index = smaller; break }
        }
      }
      this.sizeFor.set(sizeKey, index)
      rowSize = formRows[index]!
    }

    const placeAll = (final: boolean): boolean => {
      let demoted = false
      const {input, S} = ringInput(rowSize)
      if (boxed) this.root.style.setProperty('--fz', (rowSize[1] / formHeight).toFixed(3))
      // What matters least folds away when there isn't room for everything: a phone's arches keep the top nine,
      // and anywhere the rings report an overlap, the least important form folds until none is left.
      const rankOf = (item: HorizonItem) => { const thing = thingOf(item); return thing === undefined ? 99 : rankOfThing(thing) }
      const foldable = items.map((item, index) => ({item, index}))
        .filter(({item}) => { const level = thingOf(item)?.level; return boxed ? level !== undefined && level !== 3 : level === 0 })
        .sort((a, b) => rankOf(b.item) - rankOf(a.item))
      if (narrow) foldable.filter(({item}) => rankOf(item) >= 9).forEach(({index}) => { input.slots[index]!.visible = false })
      let ring = spreadOut(input)
      // A form takes the light of the ring it ended up on.
      if (this.farSide) ringThings.forEach((thing, index) => { thing.look = thing.look.replace(/^\w+/, ringZones[input.slots[index]!.zone] ?? 'orbit') })
      const widthOf = (px: number) => Math.ceil((px + 10) / S) - 10
      for (let guard = 0; guard < 40 && ring.overlapCount > 0; guard++) {
        const stuck = items.map((item, index) => ({thing: thingOf(item), index})).filter(({index}) => input.slots[index]!.visible && !ring.pills[index]!.free)
        // A form with no room first tries narrower: the lifted lead leaves only a seat, another form loses some width.
        const squeeze = boxed ? stuck.find(({thing}) => thing !== undefined && (thing.level === 3 ? !this.narrowSeat : !this.narrowForms.has(thing.id))) : undefined
        if (squeeze?.thing !== undefined) {
          if (squeeze.thing.level === 3) this.narrowSeat = true
          else this.narrowForms.add(squeeze.thing.id)
          input.slots[squeeze.index]!.width = widthOf(squeeze.thing.level === 3 ? 64 : this.formBox(squeeze.thing, rowSize[1]).width)
          ring = dawn.run(input)
          continue
        }
        // Then the least important of those in the way folds, never the lead.
        const candidates = foldable.filter(({index, item}) => input.slots[index]!.visible && item.id !== this.leadId)
        const next = candidates.find(({index}) => !ring.pills[index]!.free) ?? candidates[0]
        if (next === undefined) break
        input.slots[next.index]!.visible = false
        ring = dawn.run(input)
      }
      // A phone's bubble where the rings put it, nudged out along its ray until it and its day are clear of the sun
      // and its dailies (the rings' core is a box in their own units, and stands taller than the sun is drawn) and
      // the sun's own name over it (a finger cannot hover to see it, sunrise-css), and `further` past that when
      // another bubble was in its way.
      const further = new Map<number, number>()
      const sunClear = (dailyRadius + 8) * ring.sunScale + 20
      const pillAt = (index: number, extra = further.get(index) ?? 0) => {
        const out = ring.pills[index]!, width = input.slots[index]!.width
        const vx = out.x - W / 2, vy = out.y - Y, r = Math.hypot(vx, vy) || 1
        const at = (more: number) => { const x = out.x + vx / r * more, y = out.y + vy / r * more; return {left: x - width / 2, right: x + width / 2, top: y - 14, bottom: y + 14, x} }
        const clear = (box: ReturnType<typeof at>) => Math.hypot(Math.max(box.left - W / 2, 0, W / 2 - box.right), Math.max(box.top - Y, 0, Y - box.bottom - 16)) >= sunClear
        let more = 0
        while (more < 80 && !clear(at(more))) more += 4
        return at(more + extra)
      }
      // A phone's report counts the lead's empty seat, so it can stay above zero with nothing left to fold. What is
      // drawn is what counts there: a bubble over another's name or its day moves out along its ray into clear sky
      // under the shelf, or else folds (a faint bubble reads better than one name over another). Always the less
      // important of the two, never the lead.
      if (narrow) {
        type Pill = ReturnType<typeof pillAt>
        const clash = (a: Pill, b: Pill) => a.left < b.right + 2 && a.right > b.left - 2
          && (a.top < b.bottom + 2 && a.bottom > b.top - 2 || Math.abs(a.x - b.x) < 40 + (a.right - a.left) / 2 && a.top < b.bottom + 16 && a.bottom > b.bottom)
        const onStage = (a: Pill) => a.left >= 4 && a.right <= W - 4 && a.top >= corners.topLeft.height + 4 && a.bottom + 16 <= Y - 4
        for (let guard = 0; guard < 16; guard++) {
          const shown = items.map((item, index) => ({item, index})).filter(({item, index}) => input.slots[index]!.visible && ring.pills[index]!.visible && item.id !== this.leadId)
          const hit = shown.flatMap(a => shown.filter(b => b !== a && clash(pillAt(a.index), pillAt(b.index))).map(b => rankOf(a.item) > rankOf(b.item) ? a : b))
          const least = hit.sort((a, b) => rankOf(b.item) - rankOf(a.item))[0]
          if (least === undefined) break
          const others = shown.filter(other => other !== least).map(other => pillAt(other.index))
          const room = Array.from({length: 18}, (_, step) => (further.get(least.index) ?? 0) + 8 * (step + 1))
            .find(extra => { const moved = pillAt(least.index, extra); return onStage(moved) && others.every(other => !clash(moved, other) && !clash(other, moved)) })
          if (room !== undefined) { further.set(least.index, room); continue }
          input.slots[least.index]!.visible = false
          further.clear()
          ring = dawn.run(input)
        }
      }
      // Back to real pixels. The sun is drawn no bigger than the core the forms keep clear of.
      const kxNow = ring.kx * S
      const kyNow = ring.ky * S
      const ss = boxed ? Math.max(0.6, Math.min(kxNow, (ring.core * S - 2) / (dailyRadius + 8))) : ring.sunScale
      this.last = {x: W / 2, sunR: (dailyRadius + 8) * ss, ss, kx: kxNow, ky: kyNow}
      const dx = (W - Math.floor(W / S) * S) / 2
      const dy = Y - Math.floor(Y / S) * S
      const pillBoxes = new Map<Thing, Box>()
      items.forEach((item, index) => {
        const thing = thingOf(item)
        const out = ring.pills[index]!
        if (thing === undefined || !out.visible) return
        if (boxed) {
          // The program kept a band 16 above and 30 below the pill's centre: the form sits in the middle of it.
          const {width, height} = this.formBox(thing, rowSize[1])
          pillBoxes.set(thing, {left: out.x * S + dx - width / 2, top: out.y * S + dy + 7 * S - height / 2, width, height})
          return
        }
        const {left, right, top} = pillAt(index)
        pillBoxes.set(thing, {left, top, width: right - left, height: 28})
      })

      // 3. The lead, lifted into the nearest free sky, clear of everything on the rings.
      const sunBox: GrowBox = {left: Math.floor(W / 2 - this.last.sunR), top: Math.floor(Y - this.last.sunR), right: Math.ceil(W / 2 + this.last.sunR), bottom: Y + 4}
      const cornerBoxes: GrowBox[] = [
        {left: 0, top: 0, right: cornersAsDrawn.topLeft.width, bottom: cornersAsDrawn.topLeft.height},
        {left: W - cornersAsDrawn.topRight.width, top: 0, right: W, bottom: cornersAsDrawn.topRight.height},
      ].filter(box => box.right > box.left && box.bottom > box.top)
      const growBox = (box: Box): GrowBox => ({left: Math.floor(box.left), top: Math.floor(box.top), right: Math.ceil(box.left + box.width), bottom: Math.ceil(box.top + box.height + 18)})
      const growBounds = {left: 10, top: 10, right: W - 10, bottom: Y - 6}
      const placed: GrowBox[] = []
      const place = (thing: Thing, size: {width: number, height: number}, anchor: {x: number, y: number, width: number, height: number}) => {
        const obstacles = [sunBox, ...cornerBoxes, ...placed, ...[...pillBoxes].filter(([other]) => other !== thing && other.level !== 3 && !other.outer && !other.under).map(([, box]) => growBox(box))].slice(0, 40)
        const sticky = thing.hook !== null && thing.hook.width === size.width && thing.hook.height === size.height
        const growInput: GrowInput = {
          bounds: growBounds, gap: narrow ? 8 : 14, box: {width: Math.round(size.width), height: Math.round(size.height)},
          anchor: {x: Math.round(anchor.x), y: Math.round(anchor.y), width: Math.round(anchor.width), height: Math.round(anchor.height)},
          current: sticky ? {left: Math.round(thing.hook!.left * 2) / 2, top: Math.round(thing.hook!.top * 2) / 2} : null,
          obstacles,
        }
        return grow.run(growInput)
      }
      // The lead rises out of its slice: its anchor is where its ray leaves the outer ring, so it opens into the
      // sky above its own subject. On a phone it takes the shelf instead.
      const rayAnchor = (x: number, y: number) => {
        const angle = Math.atan2((Y - y) / this.last.ky, (x - W / 2) / this.last.kx)
        const r = rings[4] + 6
        return {x: W / 2 + r * this.last.kx * Math.cos(angle), y: Y - r * this.last.ky * Math.sin(angle), width: 2, height: 2}
      }
      // The outer rings: the same ring program lays out what is further off, and each place is then pushed out
      // along its own ray, past Orbit. Things only get further apart that way, so nothing it placed overlaps.
      this.outerR = 0
      if (outerThings.length > 0 && this.subject === null) {
        const far = outerThings.map(thing => this.outerItem(thing.item, elapsed))
        const stageOut = {viewportWidth: Math.floor(W / S), horizonY: Math.floor(Y / S), topLeft: {width: 0, height: 0}, topRight: {width: 0, height: 0}}
        const out = dawn.run(toInput({items: far, groups: groupsOf(far), bounds: farBounds, dailies: false}, stageOut, item => {
          const thing = outerThings.find(candidate => candidate.id === item.id)
          if (thing === undefined) return 80
          return boxed ? Math.ceil((this.formBox(thing, rowSize[1]).width + 10) / S) - 10 : this.pillWidth(thing)
        }))
        const push = rings[4] * kxNow + 40 - rings[0] * out.kx * S
        this.outerR = rings[4] * out.kx * S + push
        this.outerKy = out.ky * S
        // A phone's stage is topped by the words and the capture box, then the lead's shelf, all the way across. The
        // words and the box step back once the camera moves (sunrise-css .zoomed); the lead never does.
        const wordsBottom = cornersAsDrawn.topLeft.height, shelfBottom = corners.topLeft.height
        outerThings.forEach((thing, index) => {
          const pill = out.pills[index]!
          thing.look = far[index]!.zone === 'ignition' ? 'altitude' : 'orbit'
          if (!pill.visible || !pill.free) return
          if (!boxed) {
            // A phone's rings stand taller than they are wide, so the outer ones are ellipses around them, 40 past
            // Orbit all the way round: each place keeps its angle and how far out it is. One that lands on the lead's
            // shelf goes further out along its ray until it is clear (its day hangs 42 under its top); one under the
            // words stays and is veiled while they are up, as on a wide screen, and so is one the screen's edge
            // would cut in half.
            const u = (pill.x - W / 2) / out.kx, v = (Y - pill.y) / out.ky, reach = Math.hypot(u, v) || 1
            const cx = W / 2 + u / reach * (rings[4] * kxNow + 40 + (reach - rings[0]) * out.kx)
            const cy = Y - v / reach * (rings[4] * kyNow + 40 + (reach - rings[0]) * out.ky)
            const vx = cx - W / 2, vy = cy - Y, r = Math.hypot(vx, vy) || 1
            const width = this.pillWidth(thing)
            const boxAt = (more: number): Box => ({left: cx + vx / r * more - width / 2, top: cy + vy / r * more - 14, width, height: 28})
            const across = (box: Box, from: number, to: number) => box.top < to + 8 && box.top + 42 > from - 8
            let more = 0
            while (more < 900 && shelfBottom > wordsBottom && across(boxAt(more), wordsBottom, shelfBottom)) more += 16
            const box = boxAt(more)
            if (across(box, 0, wordsBottom) || box.left < 0 || box.left + width > W) thing.look += ' veiled'
            pillBoxes.set(thing, box)
            return
          }
          const cx = pill.x * S + dx, cy = pill.y * S + dy + 7 * S
          const vx = cx - W / 2, vy = cy - Y, r = Math.hypot(vx, vy) || 1
          const {width, height} = this.formBox(thing, rowSize[1])
          // A place that lands under the headline stays where it is and fades away while the words are up: it is
          // there again as soon as he moves the camera, when the words step back. One under the capture box, which
          // never steps back, goes further out along its ray until it is clear.
          const boxAt = (reach: number) => ({left: cx + vx / r * reach - width / 2, top: cy + vy / r * reach - height / 2, width, height})
          const on = (box: Box, corner: GrowBox | undefined) => corner !== undefined && box.left < corner.right + 14 && box.left + box.width > corner.left - 14 && box.top < corner.bottom + 14 && box.top + box.height > corner.top - 14
          const words: GrowBox | undefined = cornersAsDrawn.topLeft.width > 0 ? {left: 0, top: 0, right: cornersAsDrawn.topLeft.width, bottom: cornersAsDrawn.topLeft.height} : undefined
          const capture: GrowBox | undefined = cornersAsDrawn.topRight.width > 0 ? {left: W - cornersAsDrawn.topRight.width, top: 0, right: W, bottom: cornersAsDrawn.topRight.height} : undefined
          let reach = push
          while (reach < push + 900 && on(boxAt(reach), capture)) reach += 16
          if (on(boxAt(reach), words)) thing.look += ' veiled'
          pillBoxes.set(thing, boxAt(reach))
        })
      } else if (!this.farSide && this.subject === null) {
        // Nothing is out there today; the rings still are, so the sky reads as going on.
        this.outerR = rings[4] * kxNow + 40 + (rings[4] - rings[0]) * kxNow
        this.outerKy = kyNow
      }
      // Under the sun: the same ring program lays out what is behind today, and each place is mirrored below the
      // horizon and pushed down past the ground's own strip.
      this.underK = kxNow
      this.underKy = kyNow
      const tracks = this.farSide ? [] : horizon.wantTracks
      this.trackSectors = []
      if ((underThings.length > 0 || tracks.length > 0) && this.subject === null && !this.farSide) {
        const low = underThings.map(thing => {
          const at = this.underPlace.get(thing.id) ?? {ring: 3, through: 0.5, look: 'under'}
          thing.look = at.look
          return {...thing.item, zone: ringZones[at.ring]!, hours: ringHours(at.ring, at.through)}
        })
        // A section with nothing in it still has its slice: a place that is held, with no task in it.
        const lowGroups = tracks.map(track => track.name)
        for (const track of tracks) {
          if (low.some(item => item.group === track.name) || low.length >= 16) continue
          low.push({id: `track:${track.name}`, listType: 'want-to-do', title: '', short: '', label: '', group: track.name, weight: 1, due: '', implied: false, hours: ringHours(3, 0.5), zone: ringZones[3]!, day: '', left: ''})
        }
        const stageLow = {viewportWidth: Math.floor(W / S), horizonY: Math.floor(Y / S), topLeft: {width: 0, height: 0}, topRight: {width: 0, height: 0}}
        // No section is squeezed to a sliver by a fuller one: each is at least as wide as three tasks.
        const lowWeights = new Map(lowGroups.map(group => { const count = low.filter(item => item.group === group).length; return [group, Math.round(Math.max(3, count) / Math.max(1.25, count) * 16) / 16] }))
        const under = dawn.run(toInput({items: low, groups: lowGroups.length > 0 ? lowGroups : groupsOf(low), bounds: farBounds, dailies: false, weights: lowWeights}, stageLow, item => {
          const thing = underThings.find(candidate => candidate.id === item.id)
          if (thing === undefined) return 80
          return boxed ? Math.ceil((this.formBox(thing, rowSize[1]).width + 10) / S) - 10 : this.pillWidth(thing)
        }))
        this.underK = under.kx * S
        this.underKy = under.ky * S
        this.trackSectors = tracks.flatMap((track, index) => { const sector = under.sectors[index]; return sector === undefined || !sector.shown ? [] : [{name: track.name, mid: sector.mid}] })
        underThings.forEach((thing, index) => {
          const pill = under.pills[index]!
          if (!pill.visible || !pill.free) return
          if (!boxed) {
            // A phone's rings stand taller than they are wide: the place is mirrored onto the same ellipses below the
            // horizon, then pushed down past the ground's strip, as a bubble like the rest.
            const u = (pill.x - W / 2) / under.kx, v = (Y - pill.y) / under.ky, reach = Math.hypot(u, v) || 1
            const cx = W / 2 + u / reach * (reach * under.kx + underPush), cy = Y + v / reach * (reach * under.ky + underPush)
            const width = this.pillWidth(thing)
            // One the screen's edge would cut comes in to it, unless that puts it on another.
            const box = {left: cx - width / 2, top: cy - 14, width, height: 28}
            const inside = {...box, left: Math.max(6, Math.min(W - 6 - width, box.left))}
            const taken = [...pillBoxes].some(([other, at]) => other.under && inside.left < at.left + at.width + 6 && inside.left + width + 6 > at.left && inside.top < at.top + at.height + 6 && inside.top + 34 > at.top)
            pillBoxes.set(thing, taken ? box : inside)
            return
          }
          const cx = pill.x * S + dx, cy = pill.y * S + dy + 7 * S
          const vx = cx - W / 2, vy = cy - Y, r = Math.hypot(vx, vy) || 1
          const {width, height} = this.formBox(thing, rowSize[1])
          pillBoxes.set(thing, {left: cx + vx / r * underPush - width / 2, top: Y - (vy + vy / r * underPush) - height / 2, width, height})
        })
      }
      for (const thing of order) {
        const pill = pillBoxes.get(thing)
        const anchor = pill === undefined ? null : {x: pill.left + pill.width / 2, y: pill.top + pill.height / 2, width: pill.width, height: pill.height}
        thing.shown = anchor !== null
        thing.from = anchor === null ? null : {x: anchor.x, y: anchor.y}
        // Everything but the lead sits where the rings put it.
        if (anchor === null || thing.level !== 3) { thing.hook = null; continue }
        let size = this.fullBox(thing, 3, narrow)
        const hookAnchor = shelf ? {x: Math.round(W / 2), y: shelfTop + size.height + 8 + 1, width: 2, height: 2} : rayAnchor(anchor.x, anchor.y)
        // It looks for room above its own slice, then beside its seat, then in the open sky under the capture box,
        // which the rings leave free.
        const anchors = [hookAnchor, ...narrow ? [] : [anchor, {x: Math.round(W * 0.74), y: cornersAsDrawn.topRight.height + 40, width: 2, height: 2}]]
        const tryAll = () => { for (const at of anchors) { const found = place(thing, size, at); if (found.free) return found } return place(thing, size, hookAnchor) }
        let result = tryAll()
        // A lead with no room for all its parts opens with fewer: its picture, a line and its button.
        this.compactLead = narrow
        if (!result.free && !narrow) {
          size = this.fullBox(thing, 3, true)
          result = tryAll()
          this.compactLead = result.free
        }
        if (result.free) {
          thing.hook = {left: result.left, top: result.top, ...size}
          placed.push(growBox(thing.hook))
          continue
        }
        // No room to open: it stays a form like the rest, lit.
        thing.hook = null
        thing.level = 2
        demoted = true
      }
      if (!demoted || final) {
        // The same places in Dawn's units: the 3D world stands today's tasks where the rings put them.
        if (!this.farSide) this.spaceLayout = {
          spots: [...pillBoxes].filter(([thing]) => !thing.outer && !thing.under).map(([thing, box]) => ({
            item: thing.item, x: 600 + (box.left + box.width / 2 - W / 2) / kxNow, y: 560 - (Y - (box.top + box.height / 2)) / kyNow,
          })),
          sectors: groups.flatMap((group, index) => { const sector = ring.sectors[index]; return sector === undefined || !sector.shown ? [] : [{group, a0: sector.a0, a1: sector.a1, mid: sector.mid}] }),
        }
        this.commit = () => {
          this.render(pillBoxes, kxNow)
          this.renderSubjects(ring.sectors, kxNow, kyNow)
          this.renderTracks()
          this.renderGround()
          if (narrow) this.roomToGrow()
        }
      }
      return demoted
    }
    // Twice when the lead finds no room in the sky: it stays a form on its ring, and the rings are laid out for that.
    for (let pass = 0; pass < 3; pass++) {
      if (!placeAll(pass === 2)) break
    }
    this.commit()
    this.drawFlat()
    this.writeHeadline(order)
    if (narrow) {
      // What is drawn changed: the camera stays inside it (without closing a tray it has not moved for).
      this.measureReach()
      const kept = this.keptView(Math.max(this.minZoom, this.view.z), this.view.x, this.view.y)
      if (Math.abs(kept.z - this.view.z) > 1e-3 || Math.abs(kept.x - this.view.x) >= 0.5 || Math.abs(kept.y - this.view.y) >= 0.5) this.setView(kept.z, kept.x, kept.y, false, true)
    }
    this.host.onLayout?.()
    // The words changed size: the corners the rings keep clear of changed with them, so lay it out once more.
    if (this.open === null && this.saidSize !== `${this.say.offsetWidth}x${this.say.offsetHeight}` && !this.resolving) {
      this.resolving = true
      try { this.solve() } finally { this.resolving = false }
    }
  }
  private resolving = false

  // ---- Rendering every thing from its level and boxes. CSS carries each one smoothly to its new shape.
  private render(pillBoxes: Map<Thing, Box>, kx: number) {
    const {width: W, horizonY: Y} = this.stage
    const boxed = !this.narrow
    const started = this.data?.started ?? {}
    let lines = ''
    let glow: Box | null = null
    for (const thing of this.things) {
      const {el, face, body} = thing
      const pill = pillBoxes.get(thing)
      const level = thing.level
      const isHook = level === 3 && thing.hook !== null
      const rest: Box | null = thing.hook ?? pill ?? null
      const isBox = boxed && !isHook && rest !== null
      const isHot = this.hot === thing && this.open === null
      const box: Box | null = isBox && isHot && rest !== null ? this.grown(thing, rest) : rest
      thing.at = null
      thing.rest = null
      const isStarted = started[thing.id] !== undefined || this.startedHere.has(thing.id)
      el.className = `thing lv${level} ${thing.look}${isHook ? ' hook' : ''}${isBox ? ' form' : ''}${isBox && thing.id === this.leadId ? ' lead' : ''}${isHot ? ' hot' : ''}${isStarted ? ' started' : ''}`
      if (pill !== undefined && !isHook) thing.lastBox = pill
      if (this.open === thing.id && box !== null && thing.shown) {
        // It grew into the workspace right where it was: its form waits underneath.
        el.classList.add('opened')
        this.setBox(el, box)
        thing.at = box
        thing.rest = rest
        thing.seat.classList.remove('on')
        continue
      }
      if (!thing.shown || box === null) {
        // Folded, not finished: it stays where it was as a faint bubble.
        if (thing.lastBox !== null && this.open === null && this.subject === null) {
          el.classList.add('ghost')
          this.setBox(el, thing.lastBox)
        } else {
          el.classList.add('gone')
        }
        thing.seat.classList.remove('on')
        thing.lifted = false
        continue
      }
      this.setBox(el, box)
      thing.at = box
      thing.rest = rest
      if (isHook || (isBox && thing.id === this.leadId)) glow = box
      if (!isHook && !isBox) {
        // A narrow screen: a bubble with the task's name.
        const label = this.pillLabel(thing)
        if (face.dataset['key'] !== label) { face.dataset['key'] = label; face.innerHTML = `<b>${escapeText(label)}</b>` }
        if (body.dataset['key'] !== '') { body.dataset['key'] = ''; body.replaceChildren() }
      }
      if (isHook || isBox) {
        // The small form in its shape's outline, and its parts stacked for when it opens.
        const key = `${isHook}|${isHook && this.compactLead}|${this.narrowForms.has(thing.id)}|${this.isCompact(thing)}|${this.narrow}`
        if (body.dataset['key'] !== key) {
          body.dataset['key'] = key
          const small = document.createElement('div')
          small.className = 'm'
          const full = document.createElement('div')
          full.className = 'f'
          if (!isHook) small.append(smallForm(thing.form, this.narrowWidth(thing), this.isCompact(thing)))
          full.append(fullForm(thing.form, isHook ? 3 : 2, isHook && this.compactLead))
          body.replaceChildren(small, full)
        }
      }
      // Lifted off its ring: its home keeps a seat, and a thread of light runs to it.
      thing.lifted = isHook && pill !== undefined
      thing.seat.classList.toggle('on', thing.lifted)
      if (pill !== undefined) {
        thing.seat.style.transform = `translate(${(pill.left + pill.width / 2).toFixed(1)}px,${(pill.top + pill.height / 2).toFixed(1)}px) translate(-50%,-50%)`
        thing.seat.style.width = `${Math.min(pill.width, 120)}px`
      }
      if (thing.lifted && thing.hook !== null && thing.from !== null) {
        const sx = thing.from.x
        const sy = thing.from.y
        const hx = Math.max(thing.hook.left + 14, Math.min(thing.hook.left + thing.hook.width - 14, sx))
        const hy = Math.max(thing.hook.top, Math.min(thing.hook.top + thing.hook.height, sy))
        lines += `<linearGradient id="sr-thread" gradientUnits="userSpaceOnUse" x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}"><stop offset="0" stop-color="#ffd6aa" stop-opacity="0.35"/><stop offset=".25" stop-color="#ffd6aa" stop-opacity="0.04"/><stop offset=".6" stop-color="#ffd6aa" stop-opacity="0.3"/><stop offset="1" stop-color="#ffe2c4" stop-opacity="0.9"/></linearGradient>`
          + `<line x1="${sx.toFixed(1)}" y1="${sy.toFixed(1)}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="url(#sr-thread)" class="lead"/>`
      }
    }
    this.glowEl.classList.toggle('on', glow !== null)
    if (glow !== null) { this.setBox(this.glowEl, glow); this.glowEl.style.borderRadius = glow.height < 110 ? `${Math.round(glow.height / 2)}px` : '20px' }
    // A faint bubble never sits under something drawn: there it just goes.
    for (const thing of this.things) {
      const ghost = thing.lastBox
      if (!thing.el.classList.contains('ghost') || ghost === null) continue
      const under = this.things.some(other => other.at !== null && ghost.left < other.at.left + other.at.width && ghost.left + ghost.width > other.at.left
        && ghost.top < other.at.top + other.at.height && ghost.top + ghost.height > other.at.top)
      if (under) { thing.el.classList.remove('ghost'); thing.el.classList.add('gone') }
    }
    this.threads.setAttribute('viewBox', `0 0 ${W} ${this.stage.height}`)
    this.threads.innerHTML = lines
    // The rings' names on the ground, as Dawn's, then the outer rings': stretches of the calendar.
    const now = Date.now()
    const names = [
      ...this.farSide
        ? [['Now', 'fits a bet'], ['This period', 'build days'], ['After finals', 'parked'], ['Someday', 'no date']]
        : [['Ignition', 'next 48h'], ['Climb', 'this week'], ['Altitude', 'next week'], ['Orbit', 'later']],
      ['Month', `to ${monthDay(new Date(now + farDays[0] * 864e5))}`], ['Season', `to ${monthDay(new Date(now + farDays[1] * 864e5))}`],
      ['Year', `to ${new Date(now + farDays[2] * 864e5).toLocaleDateString('en-US', {month: 'short', year: 'numeric'})}`], ['Beyond', 'later'],
    ]
    const outerK = this.outerR > 0 ? (this.outerR - rings[4] * kx - 40) / (rings[4] - rings[0]) : 0
    this.zoneEls.forEach((zone, index) => {
      const html = `<b>${names[index]![0]}</b><small>${names[index]![1]!.toUpperCase()}</small>`
      if (zone.dataset['html'] !== html) { zone.innerHTML = html; zone.dataset['html'] = html }
      const outer = index >= 4
      const mid = outer
        ? rings[4] * kx + 40 + ((rings[index - 4]! + rings[index - 3]!) / 2 - rings[0]) * outerK
        : (rings[index]! + rings[index + 1]!) / 2 * kx
      zone.style.transform = `translate(${(W / 2 - mid).toFixed(1)}px,${(Y + 30).toFixed(1)}px) translate(-50%,-62%) scale(${Math.min(1, kx).toFixed(3)})`
      zone.style.opacity = kx < 0.6 || (outer && this.outerR <= 0) ? '0' : '1'
    })
  }
  // A form under the pointer opens around its own centre, kept on the stage.
  private grown(thing: Thing, rest: Box): Box {
    const open = this.fullBox(thing, 2)
    // A task's glance stays a glance: never taller than about half the sky.
    if (thing.form.spec.glance !== undefined) open.height = Math.min(open.height, Math.max(220, Math.round(this.stage.horizonY * 0.52)))
    const left = rest.left + rest.width / 2 - open.width / 2, top = rest.top + rest.height / 2 - open.height / 2
    // Out past the stage (the outer rings) it opens where it is.
    if (thing.outer || thing.under) return {left, top, ...open}
    return {
      left: Math.max(8, Math.min(this.stage.width - 8 - open.width, left)),
      top: Math.max(8, Math.min(this.stage.horizonY - 6 - open.height, top)), ...open,
    }
  }
  private setHot(thing: Thing | null) {
    if (this.hot === thing) return
    this.hot = thing
    this.root.classList.toggle('hovering', thing !== null)
    // Coming back to rest is as quick as growing was.
    this.root.classList.add('settling')
    window.clearTimeout(this.settleTimer)
    this.settleTimer = window.setTimeout(() => this.root.classList.remove('settling'), 340)
    this.commit()
  }
  private setBox(el: HTMLElement, box: Box) {
    // The translate property, not transform: then the scale property shrinks a thing about its own centre.
    el.style.translate = `${box.left.toFixed(1)}px ${box.top.toFixed(1)}px`
    el.style.width = `${box.width.toFixed(1)}px`
    el.style.height = `${box.height.toFixed(1)}px`
  }

  private dailies(): HorizonDaily[] {
    return (this.data?.horizon.dailies ?? []).map(daily => ({...daily, done: this.dailyDone.get(daily.id) ?? daily.done}))
  }
  private writeHeadline(order: Thing[]) {
    const data = this.data!
    const h1 = this.say.querySelector('h1')!
    const p = this.say.querySelector('p')!
    const horizon = data.horizon
    const lead = order.find(thing => thing.level === 3 && thing.shown) ?? order.find(thing => thing.level >= 1 && thing.shown)
    this.backButton.hidden = this.subject === null
    let html: string
    if (this.subject !== null) {
      const mine = this.source.filter(item => item.group === this.subject)
      html = `${escapeText(this.subject)}. <em>${mine.length} thing${mine.length === 1 ? '' : 's'}${mine[0] === undefined ? '' : ` · next ${escapeText(trimDots(mine[0].short))}, ${escapeText(mine[0].day)}`}</em>`
    } else if (this.farSide) {
      const noticed = this.cards.filter(card => card.noticed).length
      html = this.cards.length === 0
        ? 'The far side. <em>Nothing here yet. Save a post to your Openclaw folder on X, or wait for OpenClaw to notice something worth doing.</em>'
        : `The far side. <em>${this.cards.length} to decide: ${this.cards.length - noticed} you saved, ${noticed} OpenClaw noticed. Closer to the sun is sooner.</em>`
    } else if (lead !== undefined) {
      const [ask, why] = lead.form.spec.say
      html = `${escapeText(ask)} <em>${escapeText(why)}</em>`
    } else if (horizon.holds.length > 0) {
      html = `Clear the ground first. <em>${horizon.holds.length} overdue.</em>`
    } else {
      html = 'Clear skies. <em>Nothing needs you right now.</em>'
    }
    if (h1.dataset['html'] !== html) { h1.innerHTML = html; h1.dataset['html'] = html }
    const dailies = this.dailies()
    const parts = [`${horizon.cleared.length} cleared this week${horizon.letGoThisWeek > 0 ? `, ${horizon.letGoThisWeek} let go` : ''}`]
    if (dailies.length > 0) parts.push(`${dailies.filter(daily => daily.done).length} of ${dailies.length} dailies`)
    if (!this.narrow || dailies.length === 0) { p.textContent = parts.join(' · '); p.dataset['html'] = ''; return }
    // A phone's ground has no room for the week's streak: the dailies open from their count here instead.
    const line = `${escapeText(parts[0]!)} · <button type="button" class="sr-dl" aria-label="Your dailies: ${escapeText(parts[1]!)}">${escapeText(parts[1]!)}</button>`
    if (p.dataset['html'] !== line) { p.innerHTML = line; p.dataset['html'] = line }
  }

  // ---- The flat drawing: sky, rings, sun and dailies, as Dawn's.
  private drawFlat() {
    const {width: W, height: H, horizonY: Y} = this.stage
    // The far side has no dailies on its sun, and its sky is at dusk.
    const dailies = this.farSide ? [] : this.dailies()
    const doneCount = dailies.filter(daily => daily.done).length
    const {kx, ky, ss} = this.last
    const key = [W, H, Y, kx, ky, ss, dailies.length, dailies.map(daily => daily.done ? 1 : 0).join(''), this.farSide, Math.round(this.outerR), this.underK.toFixed(3), this.narrow, this.outerKy.toFixed(3), this.underKy.toFixed(3)].join()
    if (key === this.flatKey) return
    this.flatKey = key
    const X = W / 2
    // What is drawn reaches as far as the camera can go (setView): the sky has no edge to find.
    const left = -1.6 * W, wide = 4.2 * W, top = -1.7 * H, deep = 2.4 * H
    const point = (rx: number, ry: number, degrees: number) => [X + rx * Math.cos(degrees * Math.PI / 180), Y - ry * Math.sin(degrees * Math.PI / 180)] as const
    let s = '<defs>'
      // In the drawing's own units, so the sky keeps its colours over the stage and goes on dark above it, and
      // the ground keeps its band and goes on below.
      + `<linearGradient id="sr-skyfill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${Y}">${SKY.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>`
      // Under the horizon the ground keeps its sand for a strip, then goes down into the dark, as the sky does above.
      + `<linearGradient id="sr-gr" gradientUnits="userSpaceOnUse" x1="0" y1="${Y}" x2="0" y2="${Y + 900}"><stop offset="0" stop-color="#d9b48d"/><stop offset=".08" stop-color="#8a6446"/><stop offset=".3" stop-color="#4a3020"/><stop offset=".7" stop-color="#1e140e"/><stop offset="1" stop-color="#0b0806"/></linearGradient>`
      + `<clipPath id="sr-below"><rect x="${left}" y="${Y}" width="${wide}" height="${deep - Y}"/></clipPath>`
      + `<radialGradient id="sr-sun" cx=".5" cy=".5" r=".5">${SUN.map((c, i) => `<stop offset="${[0, 0.55, 0.85, 1][i]}" stop-color="${c}"/>`).join('')}</radialGradient>`
      + '<radialGradient id="sr-haze" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffc26b" stop-opacity=".5"/><stop offset=".5" stop-color="#ffc26b" stop-opacity=".15"/><stop offset="1" stop-color="#ffc26b" stop-opacity="0"/></radialGradient>'
      + '<filter id="sr-dglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>'
      + '<filter id="sr-bloom" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>'
      + `<linearGradient id="sr-dusk" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${Y}"><stop offset="0" stop-color="rgb(46,24,70)" stop-opacity=".55"/><stop offset=".62" stop-color="rgb(107,42,88)" stop-opacity=".5"/><stop offset=".92" stop-color="rgb(194,79,98)" stop-opacity=".5"/><stop offset="1" stop-color="rgb(242,137,90)" stop-opacity=".45"/></linearGradient>`
      + `<clipPath id="sr-above"><rect x="${left}" y="${top}" width="${wide}" height="${Y - top}"/></clipPath></defs>`
    s += `<rect x="${left}" y="${top}" width="${wide}" height="${Y - top}" fill="url(#sr-skyfill)"/>${starField(left, top, wide, Y * 0.6 - top, 900, Y * 0.6)}`
    if (this.farSide) s += `<rect x="${left}" y="${top}" width="${wide}" height="${Y - top}" fill="url(#sr-dusk)"/>`
    s += '<g clip-path="url(#sr-above)">'
    for (let index = 3; index >= 0; index--) {
      const r = rings[index + 1]!
      s += `<ellipse cx="${X}" cy="${Y}" rx="${(r * kx).toFixed(1)}" ry="${(r * ky).toFixed(1)}" fill="${BANDS[index]}" stroke="rgba(255,255,255,.14)"${index >= 3 ? ' stroke-dasharray="2 6"' : ''}/>`
    }
    // The outer rings: a month, a season, a year, beyond. Fainter the further out.
    if (this.outerR > 0) {
      const outerK = (this.outerR - rings[4] * kx - 40) / (rings[4] - rings[0])
      for (let index = 1; index <= 4; index++) {
        const r = rings[4] * kx + 40 + (rings[index]! - rings[0]) * outerK
        const stroke = `fill="none" stroke="rgba(255,255,255,${(0.26 - index * 0.04).toFixed(2)})" stroke-width="1.6" stroke-dasharray="3 9"`
        // A phone's rings stand taller than they are wide, and the outer ones go round them (solve).
        if (this.narrow) s += `<ellipse cx="${X}" cy="${Y}" rx="${r.toFixed(1)}" ry="${(rings[4] * ky + 40 + (rings[index]! - rings[0]) * this.outerKy).toFixed(1)}" ${stroke}/>`
        else s += `<circle cx="${X}" cy="${Y}" r="${r.toFixed(1)}" ${stroke}/>`
      }
    }
    s += `<ellipse cx="${X}" cy="${Y}" rx="${(rings[2] * kx).toFixed(1)}" ry="${(rings[2] * ky).toFixed(1)}" fill="url(#sr-haze)"/>`
    const count = dailies.length
    if (count > 0) s += `<circle cx="${X}" cy="${Y}" r="${((doneCount === count ? 104 : 72) * ss).toFixed(1)}" fill="#ffc26b" opacity="${(0.12 + 0.5 * doneCount / count).toFixed(2)}" filter="url(#sr-bloom)"/>`
    s += `<circle cx="${X}" cy="${Y}" r="${(rings[0] * ss).toFixed(1)}" fill="url(#sr-sun)"/></g>`
    const gap = 4
    const segment = (180 - gap * (count + 1)) / Math.max(1, count)
    dailies.forEach((daily, index) => {
      const a0 = 180 - gap - index * (segment + gap)
      const r = dailyRadius * ss
      const [x0, y0] = point(r, r, a0)
      const [x1, y1] = point(r, r, a0 - segment)
      const path = `M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`
      if (daily.done) s += `<path d="${path}" fill="none" stroke="#ffb37a" stroke-width="7" stroke-linecap="round" opacity=".8" filter="url(#sr-dglow)"/>`
      s += `<path d="${path}" fill="none" stroke="${daily.done ? '#fff6ec' : 'rgba(255,236,214,.38)'}" stroke-width="${(4.5 * Math.min(1, ss + 0.2)).toFixed(1)}" stroke-linecap="round"/>`
    })
    s += `<text x="${X}" y="${Y - (count > 0 ? 29 : 20) * ss}" text-anchor="middle" class="you" font-size="${ss > 0.8 ? 10 : 8}">${this.farSide ? 'TODAY' : 'YOU'}</text>`
    if (count > 0 && ss > 0.8) s += `<text x="${X}" y="${Y - 12 * ss}" text-anchor="middle" class="dcount">${doneCount === count ? 'ALL DONE' : `${doneCount} OF ${count} DAILY`}</text>`
    // Under the sun: the ground going down, the rings carried on below the horizon, and the sun's glow in it.
    const under = this.underK > 0 ? this.underK : kx
    let below = `<rect x="${left}" y="${Y}" width="${wide}" height="${deep - Y}" fill="url(#sr-gr)"/>`
    if (this.farSide) below += `<rect x="${left}" y="${Y}" width="${wide}" height="${deep - Y}" fill="rgb(60,26,46)" opacity=".5"/>`
    below += `<g clip-path="url(#sr-below)"><circle cx="${X}" cy="${Y}" r="${(rings[1] * under).toFixed(1)}" fill="url(#sr-haze)" opacity=".55"/>`
    for (let index = 1; index <= 4; index++) {
      const stroke = `fill="none" stroke="rgba(255,214,170,${(0.3 - index * 0.045).toFixed(2)})" stroke-width="1.2" stroke-dasharray="2 7"`
      const r = (rings[index]! * under + underPush).toFixed(1)
      if (this.narrow) below += `<ellipse cx="${X}" cy="${Y}" rx="${r}" ry="${(rings[index]! * (this.underKy > 0 ? this.underKy : ky) + underPush).toFixed(1)}" ${stroke}/>`
      else below += `<circle cx="${X}" cy="${Y}" r="${r}" ${stroke}/>`
    }
    below += '</g>'
    s += `${below}<rect x="${left}" y="${Y - 1}" width="${wide}" height="1.5" fill="rgba(255,243,220,.7)"/>`
    this.flat.setAttribute('viewBox', `0 0 ${W} ${H}`)
    this.flat.setAttribute('width', String(W))
    this.flat.setAttribute('height', String(H))
    this.flat.innerHTML = s
  }

  // ---- The workspace: a task opens where its form is, as big as the stage allows.
  private sunCircle(): Box {
    const r = this.last.sunR
    return {left: this.stage.width / 2 - r, top: this.stage.horizonY - r, width: 2 * r, height: 2 * r}
  }
  private placePane(box: Box, risen: boolean) {
    this.setBox(this.pane, box)
    this.pane.classList.toggle('risen', risen)
  }
  private workRect(from: Box | null, card = false): Box {
    const {width: W, height: H} = this.stage
    if (this.narrow) return {left: 8, top: 8, width: W - 16, height: H - 16}
    // A card to decide is one column; a task opens to most of the screen: its brief, its work or a page, its chats.
    const width = Math.min(card ? 500 : 1480, W - 32)
    // A task's workspace ends where the window does: under the page's bar the sky can reach below what is in view.
    const seen = card ? H : Math.max(480, Math.min(H, window.innerHeight - Math.max(0, this.root.getBoundingClientRect().top)))
    const height = card ? Math.min(680, H - 28) : seen - 28
    const centre = from ?? this.toScreen(this.sunCircle())
    const left = Math.max(16, Math.min(W - 16 - width, centre.left + centre.width / 2 - width / 2))
    const top = Math.max(14, Math.min(seen - 14 - height, centre.top + centre.height / 2 - height / 2))
    return {left: Math.round(left), top: Math.round(top), width, height}
  }

  // ---- The ground: what is overdue, what has no date, Today. The week's dailies under the sun; arcs and the sun
  // you can press.
  private dailyAnchor(index: number, count: number) {
    const {width: W, horizonY: Y} = this.stage
    const gap = 4
    const segment = (180 - gap * (count + 1)) / Math.max(1, count)
    const angle = (180 - gap - index * (segment + gap) - segment / 2) * Math.PI / 180
    const r = dailyRadius * this.last.ss
    return {x: W / 2 + r * Math.cos(angle), y: Y - r * Math.sin(angle) - 6}
  }
  private renderGround() {
    const data = this.data!
    const {width: W, horizonY: Y} = this.stage
    const horizon = data.horizon
    const dailies = this.dailies()
    let html = ''
    if (this.farSide) {
      // The far side's ground: the way back, the answers given so far, and the cards the rings have no room for.
      html += '<button type="button" class="chip more" data-side="today">‹ Today</button>'
      if (this.answers > 0) html += `<button type="button" class="chip" data-tray="answers">Your answers <b>${this.answers}</b></button>`
      const left = ringOverflow(this.source).length + this.things.filter(thing => !thing.shown).length
      if (left > 0) html += `<button type="button" class="chip cards" data-tray="cards" title="Every card, including the ones the rings have no room for"><b>+${left}</b> more cards</button>`
    } else {
      // A phone's chips share one line with the chat button in the corner: they say less.
      const [onlyHold] = horizon.holds
      if (horizon.holds.length === 1 && onlyHold !== undefined && !this.narrow) html += `<button type="button" class="chip hold" data-tray="holds"><b>${escapeText(trimDots(onlyHold.short))}</b> overdue</button>`
      else if (horizon.holds.length > 0) html += `<button type="button" class="chip hold" data-tray="holds"><b>${horizon.holds.length}</b> overdue</button>`
      if (horizon.undated.length > 0) html += `<button type="button" class="chip nodate" data-tray="nodate"><b>${horizon.undated.length}</b> ${this.narrow ? 'no date' : 'with no date'}</button>`
      if (data.today.length > 0) html += `<button type="button" class="chip today" data-tray="today">Today <b>${data.today.filter(row => row.completed).length} of ${data.today.length}</b></button>`
      // What today's rings have no room for is counted, never dropped: it is further out, and the camera goes there.
      const beyond = horizon.further.length + ringOverflow(horizon.items).length
      if (beyond > 0) html += `<button type="button" class="chip more" data-far="1" title="Later tasks sit on the rings further out. Pinch out, or press this, to see them."><b>+${beyond}</b> further ›</button>`
    }
    if (this.groundEl.dataset['html'] !== html) { this.groundEl.innerHTML = html; this.groundEl.dataset['html'] = html }
    this.groundEl.style.left = this.narrow ? '12px' : `${Math.round(W / 2 + this.last.sunR + 30)}px`
    this.groundEl.style.top = `${Y + (this.narrow ? 10 : 12)}px`
    // The streak: dailies checked off on each of the last seven days, today last.
    this.streakEl.hidden = dailies.length === 0 || this.farSide
    if (dailies.length > 0) {
      const week = [...horizon.dailyWeek]
      if (week.length > 0) week[week.length - 1] = dailies.filter(daily => daily.done).length
      this.streakEl.innerHTML = `<span>${week.map((count, index) => `<i class="${index === week.length - 1 ? 'now' : ''}" style="height:${3 + Math.min(count, 6) * 4}px"></i>`).join('')}</span><small>dailies, 7 days</small>`
      this.streakEl.style.left = this.narrow ? `${W - 62}px` : `${Math.round(W / 2 - 40)}px`
      this.streakEl.style.top = `${Y + (this.narrow ? 12 : 30)}px`
    }
    const r = this.last.sunR
    this.sunButton.hidden = this.open !== null
    const sunLabel = this.farSide ? 'Today' : `Far side · ${this.cards.length}`
    this.sunButton.setAttribute('aria-label', this.farSide ? 'Turn back to today' : `Turn to the far side: ${this.cards.length} to decide`)
    if (this.sunButton.dataset['label'] !== sunLabel) { this.sunButton.dataset['label'] = sunLabel; this.sunButton.innerHTML = `<span class="l">${sunLabel}</span>` }
    this.sunButton.style.transform = `translate(${(W / 2 - r).toFixed(1)}px,${(Y - r).toFixed(1)}px)`
    this.sunButton.style.width = this.sunButton.style.height = `${(2 * r).toFixed(0)}px`
    this.arcsEl.hidden = dailies.length === 0 || this.open !== null || this.farSide
    const arcsKey = dailies.map(daily => daily.id).join()
    if (this.arcsEl.dataset['key'] !== arcsKey) {
      this.arcsEl.dataset['key'] = arcsKey
      this.arcsEl.innerHTML = dailies.map((daily, index) => `<button type="button" class="arc" data-daily="${index}" title="${escapeText(daily.short)}" aria-label="Check off ${escapeText(daily.short)}"></button>`).join('')
    }
    dailies.forEach((daily, index) => {
      const at = this.dailyAnchor(index, dailies.length)
      const el = this.arcsEl.children[index] as HTMLElement
      el.style.transform = `translate(${(at.x - 13).toFixed(1)}px,${(at.y - 7).toFixed(1)}px)`
      el.classList.toggle('did', daily.done)
    })
  }
  private toggleDaily(daily: HorizonDaily) {
    const done = !(this.dailyDone.get(daily.id) ?? daily.done)
    this.dailyDone.set(daily.id, done)
    if (done) this.toast(`${trimDots(daily.short)}: checked off`)
    this.flatKey = ''
    this.solve()
    this.host.onToggleDaily({...daily, done: !done})
  }
  /** The journal refused the toggle: show what it holds again, not what was pressed. */
  dailyFailed(id: string) {
    if (!this.dailyDone.delete(id) || this.destroyed) return
    this.flatKey = ''
    this.solve()
  }
  private openTray(kind: TrayKind, from: HTMLElement, track?: string) {
    this.trayKind = kind
    this.trayTrack = track ?? null
    this.tray.hidden = false
    this.tray.dataset['kind'] = kind
    this.trayWidth = this.stage.width
    this.host.onTray(kind, track)
    // A phone's tray is a sheet at the foot of the window (sunrise-css): it is not placed by what opened it.
    if (this.narrow) return
    const rect = this.rectIn(from)
    const width = this.tray.offsetWidth
    this.tray.style.left = `${Math.round(Math.max(10, Math.min(this.stage.width - width - 10, rect.left + rect.width / 2 - width / 2)))}px`
    this.tray.style.bottom = `${Math.round(this.stage.height - rect.top + 10)}px`
    // The room above what opened it, so a long list scrolls inside the tray instead of leaving the sky.
    this.tray.style.setProperty('--room', `${Math.round(Math.max(160, rect.top - 20))}px`)
  }

  // ---- Subjects at the rim: press one to go into it.
  private subjectLabelAt(group: string, mid: number, kx: number, ky: number, width: number) {
    const {width: W, horizonY: Y} = this.stage
    const angle = (this.subject === group ? 90 : mid) * Math.PI / 180
    const r = rings[4] + 22
    const lean = Math.max(-1, Math.min(1, Math.cos(angle) * 2.5))
    const x = Math.min(W - 8 - width, Math.max(8, W / 2 + r * kx * Math.cos(angle) + (-50 + 50 * lean) / 100 * width))
    return {x, y: Y - r * ky * Math.sin(angle) - 10}
  }
  private renderSubjects(sectors: {shown: boolean, mid: number}[], kx: number, ky: number) {
    const items = this.source
    const groups = groupsOf(items)
    for (const [group, el] of this.subjectEls) if (!groups.includes(group)) el.classList.add('off')
    groups.forEach((group, index) => {
      let el = this.subjectEls.get(group)
      if (el === undefined) {
        el = document.createElement('button')
        el.type = 'button'
        el.className = 'sl-subject off'
        el.addEventListener('click', event => { event.stopPropagation(); if (this.subject === group) this.leaveSubject(); else this.enterSubject(group) }, {signal: this.abort.signal})
        this.labels.append(el)
        this.subjectEls.set(group, el)
      }
      const sector = sectors[index]
      if (sector === undefined || !sector.shown) { el.classList.add('off'); return }
      const count = items.filter(item => item.group === group).length
      const html = `${escapeText(group.toUpperCase())}<small>${count}</small>`
      if (el.dataset['html'] !== html) { el.innerHTML = html; el.dataset['html'] = html }
      el.classList.remove('off')
      el.classList.toggle('here', this.subject === group)
      const width = el.offsetWidth || Math.ceil(group.length * 7.6 + String(count).length * 7 + 24)
      const at = this.subjectLabelAt(group, sector.mid, kx, ky, width)
      el.style.transform = `translate(${at.x.toFixed(1)}px,${at.y.toFixed(1)}px)${this.narrow ? ' scale(min(var(--lk,1),var(--k,1)))' : ''}`
      this.nameBoxes.set(el, {left: at.x, top: at.y, width, height: el.offsetHeight || 19})
      // A form that had to cover it wins: the label steps aside.
      const covered = this.things.some(thing => {
        const box = thing.rest
        return box !== null && at.x < box.left + box.width && at.x + width > box.left && at.y < box.top + box.height && at.y + 20 > box.top
      })
      el.classList.toggle('off', covered)
    })
  }
  // ---- Sections under the sun: each is named at the rim of its slice, below the horizon, with how many of its
  // open tasks are drawn. The permanent ones are named even when empty. Press a name for the section's tray, every
  // open task in it in his queue's order; press it again to close it.
  private renderTracks() {
    const {width: W, horizonY: Y} = this.stage
    const tracks = this.data?.horizon.wantTracks ?? []
    const live = new Set(this.trackSectors.map(sector => sector.name))
    for (const [name, el] of this.trackEls) if (!live.has(name)) el.classList.add('off')
    const under = this.things.flatMap(thing => thing.under && thing.rest !== null ? [thing.rest] : [])
    this.trackBoxes = []
    for (const sector of this.trackSectors) {
      const track = tracks.find(candidate => candidate.name === sector.name)
      if (track === undefined) continue
      let el = this.trackEls.get(sector.name)
      if (el === undefined) {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'sl-track off'
        const name = sector.name
        button.addEventListener('click', event => {
          event.stopPropagation()
          if (this.trayKind === 'track' && this.trayTrack === name) this.closeTray()
          else this.openTray('track', button, name)
        }, {signal: this.abort.signal})
        el = button
        this.labels.append(el)
        this.trackEls.set(sector.name, el)
      }
      const drawn = this.things.filter(thing => thing.under && thing.shown && thing.item.group === track.name).length
      const html = `${escapeText(track.name.toUpperCase())}<small>${track.open === 0 ? 'nothing yet' : drawn < track.open ? `${drawn} of ${track.open}` : String(track.open)}</small>`
      if (el.dataset['html'] !== html) { el.innerHTML = html; el.dataset['html'] = html }
      el.title = track.about || `${track.open} open in ${track.name}`
      el.classList.remove('off')
      el.classList.toggle('empty', track.open === 0)
      const width = el.offsetWidth || Math.ceil(track.name.length * 7.6 + 60)
      // Named at the head of its slice, between the sun and its first task, so the names are the first thing
      // seen on the way down. A name leans away from the middle, as the classes' names do at the rim.
      const angle = sector.mid * Math.PI / 180
      const r = (rings[0] + rings[1]) / 2 * this.underK + underPush
      // On a phone the rings under the sun are taller than they are wide.
      const down = this.narrow ? (rings[0] + rings[1]) / 2 * this.underKy + underPush : r
      const lean = Math.max(-1, Math.min(1, Math.cos(angle) * 2.5))
      const x = Math.min(W - 8 - width, Math.max(8, W / 2 + r * Math.cos(angle) + (-50 + 50 * lean) / 100 * width))
      let y = Y + Math.max(underPush + 26, down * Math.sin(angle)) - 9
      if (this.narrow) {
        // A phone's tasks crowd the head of their slice: a name a task would cover steps up or down to the nearest
        // clear line (never onto the ground's strip), so no name is ever under a task.
        const height = el.offsetHeight || 19
        const clear = (top: number) => ![...under, ...this.trackBoxes].some(box => x < box.left + box.width + 4 && x + width + 4 > box.left && top < box.top + box.height + 3 && top + height + 3 > box.top)
        const steps = [0, ...Array.from({length: 24}, (_, index) => (index >> 1) * 6 + 6).map((step, index) => index % 2 === 0 ? -step : step)]
        y += steps.find(step => y + step >= Y + underPush + 4 && clear(y + step)) ?? 0
        this.trackBoxes.push({left: x, top: y, width, height})
        this.nameBoxes.set(el, {left: x, top: y, width, height})
      }
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)${this.narrow ? ' scale(min(var(--lk,1),var(--k,1)))' : ''}`
    }
  }
  /**
   * On a phone, pulled back: how far each bubble, name and the ground's chips may grow back toward their own size
   * (--lk, setView) before it would touch another, or the lead, the sun or its name, which do not grow. It is
   * written as --k on each, and sunrise-css scales each by the less of the two, so the camera pulling out never
   * crowds anything more than it is at home.
   */
  private roomToGrow() {
    const {width: W, horizonY: Y} = this.stage
    const r = this.last.sunR
    const items: {el: HTMLElement | null, box: Box}[] = [
      {el: null, box: {left: W / 2 - r, top: Y - r, width: 2 * r, height: r}},
      {el: null, box: {left: W / 2 - 50, top: Y - r - 16, width: 100, height: 14}},
    ]
    for (const thing of this.things) {
      thing.el.style.setProperty('--k', '1')
      if (thing.rest === null) continue
      // A bubble with the day that hangs under it; the lead does not grow.
      const day = thing.item.day === '' || thing.under ? 0 : 16
      items.push({el: thing.hook === null ? thing.el : null, box: {...thing.rest, height: thing.rest.height + day}})
    }
    for (const [el, box] of this.nameBoxes) if (!el.classList.contains('off')) items.push({el, box})
    if (this.groundEl.offsetWidth > 0) items.push({el: this.groundEl, box: this.rectIn(this.groundEl)})
    const gap = 4
    for (const a of items) {
      if (a.el === null) continue
      const ax = a.box.left + a.box.width / 2, ay = a.box.top + a.box.height / 2, aw = (a.box.width + gap) / 2, ah = (a.box.height + gap) / 2
      let k = 3
      for (const b of items) {
        if (b === a) continue
        const dx = Math.abs(b.box.left + b.box.width / 2 - ax), dy = Math.abs(b.box.top + b.box.height / 2 - ay)
        const bw = (b.box.width + gap) / 2, bh = (b.box.height + gap) / 2
        // Two that grow share the gap between them; one that does not keeps its own size.
        k = Math.min(k, b.el === null ? Math.max((dx - bw) / aw, (dy - bh) / ah) : Math.max(dx / (aw + bw), dy / (ah + bh)))
      }
      a.el.style.setProperty('--k', Math.max(1, k).toFixed(3))
    }
  }
  private enterSubject(group: string) { this.subject = group; this.closeTray(); this.solve() }
  private leaveSubject() { this.subject = null; this.solve() }

  private resized() {
    if (this.destroyed) return
    this.root.classList.add('resizing')
    this.fullHeights.clear()
    // Where a folded task last stood was measured on the old stage.
    for (const thing of this.things) thing.lastBox = null
    this.solve()
    if (this.open !== null) {
      const opened = this.things.find(thing => thing.id === this.open)
      this.workBox = this.workRect(opened?.at === null || opened?.at === undefined ? null : this.toScreen(opened.at), this.open.startsWith('card:'))
      this.pane.classList.toggle('full', this.narrow && !this.open.startsWith('card:'))
      this.placePane(this.workBox, true)
    }
    // setView closes an open tray. A phone's tray is a sheet at the foot of the window, which the on-screen keyboard
    // resizes around without moving it: there only a new width closes it.
    const keep = this.narrow && this.trayWidth === this.stage.width
    this.setView(this.view.z, this.view.x, this.view.y, false, keep)
    if (!keep && this.trayKind !== null) this.closeTray()
    this.later(() => this.root.classList.remove('resizing'), 50)
  }
  private start() {
    if (this.destroyed) return
    this.ready = true
    // The sky stays locked in, or full page, if that is how it was left.
    try {
      const held = localStorage.getItem('sunrise-hold')
      if (held === 'full') this.setFull(true)
      else if (held === 'locked') { this.locked = true; document.documentElement.classList.add('sr-held'); this.paintControls() }
    } catch { /* no storage here */ }
    // Sizes measured before the fonts were in are not kept.
    this.formSizes.clear()
    this.fullHeights.clear()
    this.root.classList.add('resizing')
    this.solve()
    this.root.classList.add('ready')
    this.later(() => this.root.classList.remove('resizing'), 50)
  }
}
