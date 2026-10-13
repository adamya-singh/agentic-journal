import type { MediaTitle, Ranking, Tier } from './types.ts';

// Pure ranking rules, shared by the store and the Media page's ranker.
export const TIERS: Tier[] = ['S', 'A', 'B', 'C'];
export const TIER_LABEL: Record<Tier, string> = {
  S: 'All-time',
  A: 'Loved it',
  B: 'Good',
  C: 'Fine',
};
// The better half of a tier (rounded up) takes the higher IMDb score.
const TIER_SCORES: Record<Tier, [number, number]> = { S: [10, 9], A: [8, 7], B: [6, 5], C: [4, 3] };

export const emptyRanking = (): Ranking => ({
  tiers: { S: [], A: [], B: [], C: [] },
  pending: { S: [], A: [], B: [], C: [] },
  skipped: [],
});

export type RankOp =
  | { op: 'tier'; id: string; tier: Tier }
  | { op: 'place'; id: string; tier: Tier; index: number }
  | { op: 'skip'; id: string }
  | { op: 'unrank'; id: string };

export function withoutTitle(r: Ranking, id: string): Ranking {
  const drop = (ids: string[]) => ids.filter((x) => x !== id);
  return {
    ...r,
    tiers: Object.fromEntries(TIERS.map((t) => [t, drop(r.tiers[t])])) as Ranking['tiers'],
    pending: Object.fromEntries(TIERS.map((t) => [t, drop(r.pending[t])])) as Ranking['pending'],
    skipped: drop(r.skipped),
  };
}

export function applyRankOp(r: Ranking, op: RankOp): Ranking {
  const next = withoutTitle(r, op.id);
  if (op.op === 'tier') {
    // The first title in a tier needs no comparisons, so it is placed right away.
    (next.tiers[op.tier].length ? next.pending : next.tiers)[op.tier].push(op.id);
  } else if (op.op === 'place') {
    if (op.index < 0 || op.index > next.tiers[op.tier].length)
      throw new RangeError('Your ranking changed elsewhere. Reopen the ranker.');
    next.tiers[op.tier].splice(op.index, 0, op.id);
  } else if (op.op === 'skip') next.skipped.push(op.id);
  return next;
}

export interface RankedTitle {
  id: string;
  tier: Tier;
  rank: number;
  score: number;
}
export function rankedList(r: Ranking): RankedTitle[] {
  const out: RankedTitle[] = [];
  for (const tier of TIERS) {
    const ids = r.tiers[tier],
      half = Math.ceil(ids.length / 2);
    ids.forEach((id, i) =>
      out.push({ id, tier, rank: out.length + 1, score: TIER_SCORES[tier][i < half ? 0 : 1] }),
    );
  }
  return out;
}

export const rankable = (t: MediaTitle) => !!(t.watched || t.yourRating);

// Watched titles the ranking has not seen yet, in the order given.
export function unsorted(r: Ranking, titles: MediaTitle[]): string[] {
  const known = new Set([...TIERS.flatMap((t) => [...r.tiers[t], ...r.pending[t]]), ...r.skipped]);
  return titles.filter((t) => rankable(t) && !known.has(t.id)).map((t) => t.id);
}

export const pendingCount = (r: Ranking) => TIERS.reduce((n, t) => n + r.pending[t].length, 0);

// Placed titles whose IMDb score differs from the one the ranking gives them.
export function outOfSync(r: Ranking, titles: Record<string, MediaTitle>) {
  return rankedList(r)
    .filter((x) => titles[x.id] && titles[x.id].yourRating !== x.score)
    .map(({ id, score }) => ({ id, rating: score }));
}
