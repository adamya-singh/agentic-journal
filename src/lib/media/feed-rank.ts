import { trackOf, votedTrack, type FeedItem, type FeedItemState, type Lens } from './feed-types.ts';

// The feed's recommender, deliberately simple: every vote moves a smoothed
// weight for the item's tags, its creator and its source. An item's score is the
// curator's confidence that it fits the compass plus what your votes say about
// things like it. Pure functions; the store and API call them.

export interface Tally {
  up: number;
  down: number;
  skip: number;
  w: number; // -1..1, smoothed
}
export interface Weights {
  tags: Map<string, Tally>;
  creators: Map<string, Tally & { name: string }>;
  sources: Map<string, Tally>;
  votes: number;
}
const blank = (): Tally => ({ up: 0, down: 0, skip: 0, w: 0 });
// Skipping is weak evidence against; two smoothing votes keep one vote from swinging a weight to ±1.
const weightOf = (t: Tally) => (t.up - t.down - 0.25 * t.skip) / (t.up + t.down + 0.25 * t.skip + 2);

export const tagsOf = (item: FeedItem, compass: Lens) =>
  item.alignment[compass]?.tags ??
  (compass === 'taste' ? undefined : (item.alignment.long?.tags ?? item.alignment.short?.tags)) ??
  item.alignment.taste?.tags ??
  [];

const VOTED: FeedItemState[] = ['up', 'down', 'skipped'];
// Only votes cast in this lens's track count: Unwind never teaches Pretrain, and back.
export function weights(items: Iterable<FeedItem>, compass: Lens = 'long'): Weights {
  const w: Weights = { tags: new Map(), creators: new Map(), sources: new Map(), votes: 0 };
  const track = trackOf(compass);
  for (const item of items) {
    if (!VOTED.includes(item.state) || votedTrack(item) !== track) continue;
    if (item.state !== 'skipped') w.votes++;
    const field = item.state === 'up' ? 'up' : item.state === 'down' ? 'down' : 'skip';
    const bump = (t: Tally) => {
      t[field]++;
      t.w = weightOf(t);
    };
    for (const tag of new Set(tagsOf(item, compass))) {
      if (!w.tags.has(tag)) w.tags.set(tag, blank());
      bump(w.tags.get(tag)!);
    }
    if (!w.creators.has(item.creator.key))
      w.creators.set(item.creator.key, { ...blank(), name: item.creator.name });
    bump(w.creators.get(item.creator.key)!);
    if (!w.sources.has(item.source)) w.sources.set(item.source, blank());
    bump(w.sources.get(item.source)!);
  }
  return w;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export function score(item: FeedItem, compass: Lens, w: Weights, now = Date.now()) {
  const a = item.alignment[compass];
  if (!a) return -Infinity;
  const creator = w.creators.get(item.creator.key);
  const creatorVotes = creator ? creator.up + creator.down : 0;
  const fresh = now - Date.parse(item.addedAt) < 48 * 3600_000;
  return (
    a.confidence +
    0.6 * mean(a.tags.map((t) => w.tags.get(t)?.w ?? 0)) +
    0.5 * (creator?.w ?? 0) +
    0.2 * (w.sources.get(item.source)?.w ?? 0) +
    // A little exploration: creators you have barely voted on get a nudge.
    (creatorVotes < 3 ? 0.15 : 0) +
    (fresh ? 0.1 : 0) -
    // Shown once without a vote: let unseen items go first.
    (item.state === 'seen' ? 0.3 : 0)
  );
}

// FNV-1a: a stable per-day tie-break so equal scores don't always come out in insertion order.
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

// Highest score first, then spread out: never two in a row from one creator,
// never three in a row from one source, as long as something else is left.
export function order(
  items: FeedItem[],
  compass: Lens,
  w: Weights,
  now = Date.now(),
): FeedItem[] {
  const day = new Date(now).toISOString().slice(0, 10);
  const ranked = items
    .map((item) => ({ item, s: score(item, compass, w, now), h: hash(item.id + day) }))
    .sort((a, b) => b.s - a.s || a.h - b.h)
    .map((x) => x.item);
  const out: FeedItem[] = [];
  const rest = ranked;
  while (rest.length) {
    const last = out.at(-1),
      before = out.at(-2);
    const ok = (x: FeedItem) =>
      x.creator.key !== last?.creator.key &&
      !(last && before && last.source === x.source && before.source === x.source);
    // Look a little way ahead only, so a strong item is never buried for diversity.
    const i = rest.slice(0, 12).findIndex(ok);
    out.push(rest.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}

// One short line on why your votes moved this item, or undefined when they didn't.
export function explain(item: FeedItem, compass: Lens, w: Weights): string | undefined {
  const parts: string[] = [];
  const best = tagsOf(item, compass)
    .map((tag) => ({ tag, t: w.tags.get(tag) }))
    .filter((x): x is { tag: string; t: Tally } => !!x.t && x.t.up + x.t.down >= 2)
    .sort((a, b) => Math.abs(b.t.w) - Math.abs(a.t.w))[0];
  if (best)
    parts.push(
      best.t.w >= 0
        ? `You up-voted ${best.t.up} of ${best.t.up + best.t.down} tagged ${best.tag}`
        : `You down-voted ${best.t.down} of ${best.t.up + best.t.down} tagged ${best.tag}`,
    );
  const c = w.creators.get(item.creator.key);
  if (c && c.up + c.down >= 2) {
    const net = c.up - c.down;
    parts.push(`${c.name} ${net >= 0 ? '+' : '−'}${Math.abs(net)}`);
  }
  return parts.length ? parts.join(' · ') : undefined;
}

export interface Learned {
  votes: number;
  ups: number;
  downs: number;
  tags: { tag: string; up: number; down: number; w: number }[];
  rising: { key: string; name: string; net: number }[];
  sinking: { key: string; name: string; net: number }[];
  sources: { source: string; up: number; down: number; w: number }[];
}
export function learned(w: Weights): Learned {
  const tags = [...w.tags]
    .filter(([, t]) => t.up + t.down > 0)
    .map(([tag, t]) => ({ tag, up: t.up, down: t.down, w: t.w }))
    .sort((a, b) => b.w - a.w || b.up - a.up);
  const creators = [...w.creators]
    .map(([key, c]) => ({ key, name: c.name, net: c.up - c.down }))
    .filter((c) => c.net !== 0);
  let ups = 0,
    downs = 0;
  for (const s of w.sources.values()) {
    ups += s.up;
    downs += s.down;
  }
  return {
    votes: w.votes,
    ups,
    downs,
    tags,
    rising: creators.filter((c) => c.net > 0).sort((a, b) => b.net - a.net).slice(0, 5),
    sinking: creators.filter((c) => c.net < 0).sort((a, b) => a.net - b.net).slice(0, 5),
    sources: [...w.sources].map(([source, t]) => ({ source, up: t.up, down: t.down, w: t.w })),
  };
}
