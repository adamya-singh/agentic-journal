// How much a task matters right now, by rule: how soon it is due, how heavy it is, whether it is on Today or near
// the top of Current, and whether OpenClaw has it ready to start. The attention program (attention.ts) turns these
// into who leads and who opens. Run in the page and again every few minutes, so it follows the clock.
import {salienceSteps} from './attention.ts'

export type SalienceInput = {
  hours: number // until it is due; negative when overdue
  weight: number // 1 to 5, as horizon.ts's weightFor
  today: boolean // on Today's list and not done
  currentRank: number | null // its place in the Current queue, 0 first; null when it is not in the top few
  ready: boolean // OpenClaw has started it
}

// Urgency by hours until due, between these points along log-hours: due within 6 hours is nearly everything, two
// days out still leads a quiet day, a week out is a teaser, a month out a plain bubble.
const curve: readonly (readonly [hours: number, value: number])[] = [[6, 0.9], [24, 0.72], [48, 0.58], [96, 0.42], [168, 0.3], [336, 0.18], [720, 0.1], [2160, 0.05]]
function urgency(hours: number) {
  const first = curve[0]!
  const last = curve[curve.length - 1]!
  if (hours <= first[0]) return first[1]
  if (hours >= last[0]) return last[1]
  const upper = curve.findIndex(([at]) => hours <= at)
  const [h0, v0] = curve[upper - 1]!
  const [h1, v1] = curve[upper]!
  return v0 + (v1 - v0) * (Math.log(hours / h0) / Math.log(h1 / h0))
}
export const currentTop = 6

/** 0 to 1. */
export function salienceOf(input: SalienceInput): number {
  let value = urgency(Math.max(0, input.hours)) * (0.7 + 0.1 * Math.min(5, Math.max(1, input.weight)))
  if (input.today) value += 0.08
  if (input.currentRank !== null && input.currentRank < currentTop) value += 0.08 * (1 - input.currentRank / currentTop)
  if (input.ready) value += 0.05
  return Math.max(0, Math.min(1, value))
}
/** As the attention program reads it: a whole number from 0 to 64. */
export const salienceUnits = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * salienceSteps)
