import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaRoot, withLock } from './store.ts';
import {
  describe,
  FEED_ID,
  imdbFacts,
  sourceOf,
  xFacts,
  youtubeFacts,
  type ImdbFacts,
  type XFacts,
  type YouTubeFacts,
} from './feed-pools.ts';
import { explain, learned, order, weights, type Learned } from './feed-rank.ts';
import {
  DEFAULT_VOCABULARY,
  LENSES,
  trackOf,
  votedTrack,
  vocabularyOf,
  type Alignment,
  type Lens,
  type FeedCreator,
  type FeedItem,
  type FeedItemState,
  type FeedSource,
  type FeedState,
  type Vote,
} from './feed-types.ts';

const file = () => path.join(mediaRoot(), 'feed.json');
export const initialFeed = (): FeedState => ({
  version: 1,
  vocabulary: Object.keys(DEFAULT_VOCABULARY),
  items: {},
  rejected: {},
  curator: { runs: [] },
});
export function readFeed(): FeedState {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return initialFeed();
    throw new Error('Feed storage could not be read. Restore it before continuing.');
  }
}
export function writeFeed(f: FeedState) {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(f) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file());
}
// Its own lock: voting never waits behind an IMDb or YouTube write.
export const withFeed = <T>(fn: (f: FeedState) => T) =>
  withLock(() => {
    const f = readFeed();
    const out = fn(f);
    writeFeed(f);
    return out;
  }, 'feed');

// ---- the queue ----
export type FeedFilter = 'queue' | 'voted' | 'skipped';
const QUEUED: FeedItemState[] = ['new', 'seen'];
export const eligible = (item: FeedItem, compass: Lens) => !!item.alignment[compass];
const inFilter = (item: FeedItem, filter: FeedFilter) =>
  filter === 'queue'
    ? QUEUED.includes(item.state)
    : filter === 'voted'
      ? item.state === 'up' || item.state === 'down'
      : item.state === 'skipped';
export const queueDepth = (f: FeedState, compass: Lens) =>
  Object.values(f.items).filter((i) => eligible(i, compass) && QUEUED.includes(i.state)).length;

const REFILL_BELOW = 60,
  REFILL_BATCH = 40;
// Keeps the queue from running dry: promotes the best-scoring candidates.
export function refill(f: FeedState, compass: Lens, now = Date.now()) {
  if (queueDepth(f, compass) >= REFILL_BELOW) return 0;
  const all = Object.values(f.items);
  const candidates = all.filter((i) => i.state === 'candidate' && eligible(i, compass));
  const picked = order(candidates, compass, weights(all, compass), now).slice(0, REFILL_BATCH);
  for (const i of picked) i.state = 'new';
  return picked.length;
}

export interface FeedCard {
  id: string;
  source: FeedSource;
  title: string;
  url: string;
  creator: FeedCreator;
  publishedAt?: string;
  state: FeedItemState;
  addedBy: string;
  addedAt: string;
  votedAt?: string;
  why?: string;
  tags: string[];
  confidence?: number;
  learned?: string;
  youtube?: YouTubeFacts;
  x?: XFacts;
  imdb?: ImdbFacts;
}
function card(item: FeedItem, compass: Lens, w: ReturnType<typeof weights>): FeedCard | undefined {
  const a = item.alignment[compass] ?? item.alignment.long ?? item.alignment.short ?? item.alignment.taste;
  const base: FeedCard = {
    id: item.id,
    source: item.source,
    title: item.title,
    url: item.url,
    creator: item.creator,
    publishedAt: item.publishedAt,
    state: item.state,
    addedBy: item.addedBy,
    addedAt: item.addedAt,
    votedAt: item.votedAt,
    why: a?.why,
    tags: a?.tags || [],
    confidence: a?.confidence,
    learned: explain(item, compass, w),
  };
  if (item.source === 'youtube') return { ...base, youtube: youtubeFacts(item) };
  if (item.source === 'x') {
    const x = xFacts(item);
    return x ? { ...base, x } : undefined;
  }
  const imdb = imdbFacts(item);
  return imdb ? { ...base, imdb } : undefined;
}

export interface PageQuery {
  compass: Lens;
  filter: FeedFilter;
  source?: FeedSource;
  exclude?: string[];
  offset?: number;
  limit?: number;
}
export interface FeedPage {
  items: FeedCard[];
  nextOffset: number | null;
  total: number;
}
// The queue is re-ranked on every page, so the client sends what it already
// shows (`exclude`) rather than an offset. Voted and skipped lists are stable
// (newest first) and page by offset.
export function page(q: PageQuery, f = readFeed(), now = Date.now()): FeedPage {
  const all = Object.values(f.items);
  const w = weights(all, q.compass);
  const skip = new Set(q.exclude || []);
  let list = all.filter(
    (i) =>
      inFilter(i, q.filter) &&
      // The queue is per lens; voted and skipped lists are per track.
      (q.filter === 'queue' ? eligible(i, q.compass) : votedTrack(i) === trackOf(q.compass)) &&
      (!q.source || i.source === q.source) &&
      !skip.has(i.id),
  );
  list =
    q.filter === 'queue'
      ? order(list, q.compass, w, now)
      : list.sort((a, b) => (b.votedAt || b.seenAt || '').localeCompare(a.votedAt || a.seenAt || ''));
  const limit = q.limit ?? 12,
    offset = q.filter === 'queue' ? 0 : (q.offset ?? 0);
  const items: FeedCard[] = [];
  let i = offset;
  for (; i < list.length && items.length < limit; i++) {
    const c = card(list[i], q.compass, w);
    if (c) items.push(c);
  }
  return {
    items,
    total: list.length + (q.filter === 'queue' ? skip.size : 0),
    nextOffset: i < list.length ? i : null,
  };
}

export interface FeedSummary {
  learned: Learned;
  counts: Record<FeedItemState, number> & { queue: Record<Lens, number> };
  judged: Record<Lens, number>;
  curator: { lastRun?: FeedState['curator']['runs'][number]; addedToday: number };
  vocabulary: string[];
}
export function summarize(f = readFeed(), compass: Lens = 'long', now = Date.now()): FeedSummary {
  const all = Object.values(f.items);
  const counts = { candidate: 0, new: 0, seen: 0, up: 0, down: 0, skipped: 0 } as FeedSummary['counts'];
  for (const i of all) counts[i.state]++;
  counts.queue = Object.fromEntries(LENSES.map((l) => [l, queueDepth(f, l)])) as Record<Lens, number>;
  const since = now - 24 * 3600_000;
  return {
    learned: learned(weights(all, compass)),
    counts,
    judged: Object.fromEntries(LENSES.map((l) => [l, all.filter((i) => i.alignment[l]).length])) as Record<Lens, number>,
    curator: {
      lastRun: f.curator.runs.at(-1),
      addedToday: all.filter((i) => i.addedBy === 'openclaw' && Date.parse(i.addedAt) > since).length,
    },
    vocabulary: f.vocabulary,
  };
}

// ---- your actions ----
export async function vote(id: string, value: Vote | null, compass: Lens = 'long') {
  return withFeed((f) => {
    const item = f.items[id];
    if (!item) throw new Error('That item is no longer in your feed. Refresh the page.');
    const now = new Date().toISOString();
    if (value) {
      item.state = value;
      item.votedAt = now;
      item.votedIn = trackOf(compass);
    } else {
      // Undo: back into the queue as seen.
      item.state = 'seen';
      delete item.votedAt;
    }
    item.seenAt ??= now;
    refill(f, compass);
    return summarize(f, compass);
  });
}
export async function skip(id: string, undo = false, compass: Lens = 'long') {
  return withFeed((f) => {
    const item = f.items[id];
    if (!item) throw new Error('That item is no longer in your feed. Refresh the page.');
    item.state = undo ? 'seen' : 'skipped';
    item.seenAt = new Date().toISOString();
    if (!undo) item.votedIn = trackOf(compass);
    refill(f, compass);
    return summarize(f, compass);
  });
}
// Shown without a vote. A second sighting without a vote skips it for good.
export async function markSeen(ids: string[], compass: Lens = 'long') {
  return withFeed((f) => {
    const now = new Date().toISOString();
    let changed = 0;
    for (const id of ids) {
      const item = f.items[id];
      if (!item || !QUEUED.includes(item.state)) continue;
      // One sighting per day counts: reloads and re-renders don't skip things.
      if (item.seenAt && item.seenAt.slice(0, 10) === now.slice(0, 10)) continue;
      item.seenCount++;
      item.seenAt = now;
      item.state = item.seenCount >= 2 ? 'skipped' : 'seen';
      if (item.state === 'skipped') item.votedIn = trackOf(compass);
      changed++;
    }
    const promoted = refill(f, compass);
    return { changed, promoted };
  });
}

// ---- curation: the seed pass, OpenClaw and paste-a-link ----
export const YT_URL =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
export function idFromUrl(url: string): string | undefined {
  const yt = url.match(YT_URL);
  if (yt) return `yt:${yt[1]}`;
  const x = url.match(/(?:x|twitter)\.com\/[^/]+\/status(?:es)?\/(\d+)/);
  if (x) return `x:${x[1]}`;
  const tt = url.match(/imdb\.com\/title\/(tt\d+)/);
  if (tt) return tt[1];
  return undefined;
}
export interface NewItem {
  id?: string;
  url?: string;
  title?: string;
  creator?: FeedCreator;
  publishedAt?: string;
  durationSec?: number;
  channelId?: string;
  state?: 'new' | 'candidate';
  alignment: Partial<Record<Lens, Omit<Alignment, 'judgedAt'> & { judgedAt?: string }>>;
}
export interface AddResult {
  added: string[];
  updated: string[];
  duplicates: string[];
  rejected: string[];
  unknown: { id?: string; url?: string; reason: string }[];
  unknownTags: string[];
}
// Adds or re-judges items. A known item keeps its state and votes; new judgments are merged in.
export function addTo(f: FeedState, items: NewItem[], by: string, now = new Date()): AddResult {
  const res: AddResult = { added: [], updated: [], duplicates: [], rejected: [], unknown: [], unknownTags: [] };
  const vocab = { pretrain: new Set(f.vocabulary), unwind: new Set(vocabularyOf(f, 'taste')) };
  const at = now.toISOString();
  for (const n of items) {
    const id = n.id || (n.url ? idFromUrl(n.url) : undefined);
    if (!id || !FEED_ID.test(id)) {
      res.unknown.push({ id: n.id, url: n.url, reason: 'Not a YouTube, X or IMDb id or link.' });
      continue;
    }
    const alignment = Object.fromEntries(
      Object.entries(n.alignment).map(([k, a]) => {
        for (const t of a.tags)
          if (!vocab[trackOf(k as Lens)].has(t) && !res.unknownTags.includes(t)) res.unknownTags.push(t);
        return [
          k,
          {
            confidence: Math.max(0, Math.min(1, a.confidence)),
            tags: [...new Set(a.tags)].slice(0, 4),
            why: a.why.trim().slice(0, 300),
            judgedBy: a.judgedBy,
            judgedAt: a.judgedAt || at,
            ...(a.fun !== undefined ? { fun: Math.max(0, Math.min(1, a.fun)) } : {}),
            ...(a.fit !== undefined ? { fit: Math.max(0, Math.min(1, a.fit)) } : {}),
          },
        ];
      }),
    ) as FeedItem['alignment'];
    const old = f.items[id];
    if (old) {
      const fresh = Object.keys(alignment).filter((k) => !old.alignment[k as Lens]);
      if (!fresh.length) {
        res.duplicates.push(id);
        continue;
      }
      old.alignment = { ...old.alignment, ...alignment };
      res.updated.push(id);
      continue;
    }
    const compasses = Object.keys(alignment) as Lens[];
    if (by !== 'you' && compasses.length && compasses.every((k) => f.rejected[id]?.some((r) => r.compass === k))) {
      res.rejected.push(id);
      continue;
    }
    const known = describe(id);
    const source = sourceOf(id)!;
    if (!known && !(source === 'youtube' && n.title && n.creator)) {
      res.unknown.push({
        id,
        url: n.url,
        reason:
          source === 'youtube'
            ? 'Not in your YouTube history: pass title and creator.'
            : source === 'x'
              ? 'Only saved X bookmarks can go in the feed.'
              : 'Unknown IMDb title: refresh IMDb first.',
      });
      continue;
    }
    f.items[id] = {
      id,
      source,
      title: known?.title ?? n.title!,
      url: known?.url ?? (n.url || `https://www.youtube.com/watch?v=${id.slice(3)}`),
      creator: known?.creator ?? n.creator!,
      publishedAt: n.publishedAt ?? known?.publishedAt,
      alignment,
      addedBy: by,
      addedAt: at,
      state: n.state ?? 'new',
      seenCount: 0,
      ...(n.durationSec ? { durationSec: n.durationSec } : {}),
      ...(n.channelId ? { channelId: n.channelId } : {}),
    };
    res.added.push(id);
  }
  return res;
}
export async function addItems(items: NewItem[], by: string) {
  return withFeed((f) => addTo(f, items, by));
}
export function rejectIn(f: FeedState, ids: string[], compass: Lens, now = new Date()) {
  for (const id of ids) {
    const list = (f.rejected[id] ||= []);
    if (!list.some((r) => r.compass === compass)) list.push({ at: now.toISOString(), compass });
  }
}
export async function reject(ids: string[], compass: Lens) {
  return withFeed((f) => rejectIn(f, ids, compass));
}
export async function promote(sel: { ids?: string[]; tag?: string; creator?: string; limit?: number }, compass: Lens = 'long') {
  return withFeed((f) => {
    const all = Object.values(f.items);
    let pool = all.filter((i) => i.state === 'candidate');
    if (sel.ids) pool = pool.filter((i) => sel.ids!.includes(i.id));
    if (sel.tag) pool = pool.filter((i) => Object.values(i.alignment).some((a) => a?.tags.includes(sel.tag!)));
    if (sel.creator) pool = pool.filter((i) => i.creator.key === sel.creator);
    const picked = order(pool, compass, weights(all, compass)).slice(0, sel.limit ?? 20);
    for (const i of picked) i.state = 'new';
    return { promoted: picked.map((i) => i.id) };
  });
}
export async function recordRun(run: { by: string; added: number; promoted: number; note?: string }) {
  return withFeed((f) => {
    f.curator.runs = [...f.curator.runs, { at: new Date().toISOString(), ...run }].slice(-50);
  });
}
export async function editVocabulary(add: string[], remove: string[]) {
  return withFeed((f) => {
    f.vocabulary = [...new Set([...f.vocabulary, ...add.map((t) => t.trim()).filter(Boolean)])].filter(
      (t) => !remove.includes(t),
    );
    return f.vocabulary;
  });
}
