// From the journal's Horizon data to the ring layout program's inputs.
import {GROUP_JOBS, GROUP_LIFE, GROUP_OTHER, type HorizonItem} from '@/lib/horizon'
import {groupCount, maximumHours, slotCount} from './geometry.ts'
import type {DawnInput, DawnSlot} from './layout-reference.ts'

const zones = ['ignition', 'climb', 'altitude', 'orbit']
const tail = [GROUP_JOBS, GROUP_OTHER, GROUP_LIFE]

// The slices in a fixed order, as dawn-svg.ts's sectorsFor: courses alphabetically from the left, then Jobs, Other
// and Life on the right. The program holds 8 slices; a ninth subject and later ones are not placed (see ringOverflow).
export function groupsOf(items: readonly HorizonItem[]): string[] {
  const names = new Set(items.map(item => item.group))
  return [...names].sort((a, b) => tail.indexOf(a) - tail.indexOf(b) || a.localeCompare(b)).slice(0, groupCount)
}

// The ring items the program places: the 16 soonest whose subject has a slice.
export function ringItems(items: readonly HorizonItem[]): HorizonItem[] {
  const groups = groupsOf(items)
  return items.filter(item => zones.includes(item.zone) && groups.includes(item.group))
    .slice().sort((a, b) => a.hours - b.hours).slice(0, slotCount)
}

// What the rings cannot hold: ring items past the 16 soonest or in a ninth subject. The host counts them into the
// "further" chip rather than dropping them.
export function ringOverflow(items: readonly HorizonItem[]): HorizonItem[] {
  const placed = new Set(ringItems(items).map(item => item.id))
  return items.filter(item => zones.includes(item.zone) && !placed.has(item.id))
}

const quarter = (value: number) => Math.round(value * 4) / 4

export type Stage = {viewportWidth: number, horizonY: number, topLeft: {width: number, height: number}, topRight: {width: number, height: number}}
export type RingInput = {
  items: readonly HorizonItem[] // the ring items to place, at most 16 (ringItems)
  groups: readonly string[] // the slices, in order (groupsOf)
  bounds: {climb: number, altitude: number} // where Climb and Altitude end, in hours
  dailies: boolean // whether the sun carries the daily ring
  weights?: ReadonlyMap<string, number> // a slice's weight: 0 hides it, 1 is as Dawn draws it
}

// The program's inputs. measure gives an item's width in px, rounded up to a whole px here.
export function toInput(ring: RingInput, stage: Stage, measure: (item: HorizonItem) => number): DawnInput {
  const {items, groups} = ring
  const slots: DawnSlot[] = Array.from({length: slotCount}, (_, index) => {
    const item = items[index]
    if (item === undefined) return {visible: false, zone: 0, hours: 0, group: 0, width: 0, weight: 1}
    return {
      visible: groups.includes(item.group),
      zone: Math.max(0, zones.indexOf(item.zone)),
      hours: Math.min(maximumHours, Math.max(0, quarter(item.hours))),
      group: Math.max(0, groups.indexOf(item.group)),
      width: Math.min(400, Math.ceil(measure(item))),
      weight: Math.min(5, Math.max(1, Math.round(item.weight))),
    }
  })
  return {
    ...stage,
    climb: quarter(Math.min(240, Math.max(0, ring.bounds.climb))),
    altitude: quarter(Math.min(420, Math.max(0, ring.bounds.altitude))),
    dailies: ring.dailies,
    groupWeights: Array.from({length: groupCount}, (_, index) => {
      const group = groups[index]
      return group === undefined ? 0 : ring.weights?.get(group) ?? 1
    }),
    slots,
  }
}
