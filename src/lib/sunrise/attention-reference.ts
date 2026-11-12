// attention.ts's program in plain JavaScript: from one salience per thing and the screen's width to each thing's rank
// and level. All values are whole numbers, so the program and this reference agree exactly.

export type AttentionInput = {
  width: number // the screen's width in px
  salience: number[] // per thing, 0 to 64, whole; 0 for a slot with nothing in it
}
export type AttentionOutput = {
  ranks: number[] // 0 is the thing that matters most; ties go to the earlier thing
  levels: number[] // 3 lead hook, 2 hook, 1 teaser, 0 plain pill
  leads: number, hooks: number, teasers: number // how many of each
  hookRoom: number, teaserRoom: number // the budget this width gave
}

// What a thing's salience must reach for each level, out of 64.
export const thresholds = {lead: 32, hook: 22, teaser: 12}
// The budget beside the lead: a phone opens 1 hook and 2 teasers, a medium screen 2 and 3, a wide one 3 and 4.
export const budgetFor = {medium: 700, wide: 1100, hooks: [1, 2, 3], teasers: [2, 3, 4]}

export function attentionReference(input: AttentionInput): AttentionOutput {
  const salience = input.salience
  const ranks = salience.map((own, i) => salience.filter((other, j) => j !== i && (other > own || (other === own && j < i))).length)
  const step = (input.width >= budgetFor.medium ? 1 : 0) + (input.width >= budgetFor.wide ? 1 : 0)
  const hookRoom = budgetFor.hooks[step]!
  const teaserRoom = budgetFor.teasers[step]!
  const levels = salience.map((own, i) => {
    const rank = ranks[i]!
    return (own >= thresholds.lead && rank < 1 ? 1 : 0)
      + (own >= thresholds.hook && rank < 1 + hookRoom ? 1 : 0)
      + (own >= thresholds.teaser && rank < 1 + hookRoom + teaserRoom ? 1 : 0)
  })
  const count = (level: number) => levels.filter(value => value === level).length
  return {ranks, levels, leads: count(3), hooks: count(2), teasers: count(1), hookRoom, teaserRoom}
}
