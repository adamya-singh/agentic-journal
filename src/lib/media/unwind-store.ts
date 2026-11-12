import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { addJob, mediaRoot, readState, withLock, writeState } from './store.ts';
import {
  defaultFetchers,
  lookupTitle,
  showByImdb,
  type CatalogEpisode,
  type CatalogFetchers,
} from './catalog.ts';
import type { Alignment } from './feed-types.ts';
import type { TasteTarget } from './feed-judge.ts';
import type { MediaTitle } from './types.ts';

// Unwind: entertainment you still curate to fit you. The clips live in the
// feed (the `taste` lens); this store holds what the feed can't: your taste
// card, the shows and films you are watching or might, where you are in each,
// and what can play them inside the Journal. Its own file and lock, like Diet
// TBPN, so saving your place never waits behind the feed or an IMDb sync.

export interface Mood {
  name: string;
  examples: string;
}
export interface NeverRule {
  name: string;
  // Lowercased creator keys ('@mrbeast') and title words; either one matching rules an item out.
  channels: string[];
  keywords: string[];
  on: boolean;
}
export interface TasteCard {
  version: number;
  updatedAt: string;
  summary: string;
  moods: Mood[];
  anchors: string[]; // tt ids you loved
  never: NeverRule[];
}
export type ShowState = 'deck' | 'watching' | 'paused' | 'finished' | 'dropped';
export const SHOW_STATES: ShowState[] = ['deck', 'watching', 'paused', 'finished', 'dropped'];
export type PlaySource =
  | { kind: 'youtube'; videoId: string; channelId: string; channel?: string; durationSec?: number; addedBy: string; addedAt: string }
  | { kind: 'file'; fileId: string; addedAt: string };
export const FILM = 'film'; // the one "episode" a film has
export interface Show {
  id: string; // tt…
  kind: 'series' | 'film';
  title: string;
  year?: string;
  poster?: string;
  cast?: string;
  network?: string;
  summary?: string;
  genres?: string[];
  tvmazeId?: number;
  runtimeMin?: number;
  episodes?: CatalogEpisode[];
  episodesAt?: string;
  state: ShowState;
  watched: string[];
  positions: Record<string, { sec: number; at: string; durationSec?: number }>;
  sources: Record<string, PlaySource[]>;
  alignment?: Alignment;
  addedBy: string;
  addedAt: string;
  startedAt?: string;
  lastWatchedAt?: string;
  finishedAt?: string;
}
export interface OfficialChannel {
  channelId: string;
  name: string;
  handle?: string;
  approved: boolean;
  proposedBy: string;
  at: string;
}
export interface UnwindStore {
  version: 1;
  taste: TasteCard;
  shows: Record<string, Show>;
  // Channels whose full uploads count as a real source (studios posting their own shows).
  officialChannels: Record<string, OfficialChannel>;
  calibrated: Record<string, 'loved' | 'want' | 'not'>;
  // Titles you asked for that nothing can play yet.
  wanted: Record<string, string>;
}

export const DONE_AT = 0.9;

export function defaultTaste(now = new Date().toISOString()): TasteCard {
  return {
    version: 1,
    updatedAt: now,
    summary:
      'Smart, ambitious and funny. Tech satire and founder drama first; underdog stories, desi slice of life and big-screen spectacle when there is time. Entertainment that still fits who you are building yourself into. Never brainrot.',
    moods: [
      { name: 'tech satire', examples: 'Silicon Valley, Office Space' },
      { name: 'founder drama', examples: 'TVF Pitchers, Scam 1992, WeCrashed' },
      { name: 'underdog grind', examples: '3 Idiots, 12th Fail' },
      { name: 'big-screen spectacle', examples: 'Top Gun: Maverick, Spider-Verse' },
      { name: 'power games', examples: 'Succession, Billions' },
      { name: 'smart docs', examples: 'Fern, Barely Sociable' },
      { name: 'desi slice of life', examples: 'Kota Factory, Gullak' },
      { name: 'sci-fi with ideas', examples: 'Pantheon, Blade Runner 2049' },
    ],
    // 3 Idiots, Top Gun: Maverick, Spider-Man: Across the Spider-Verse.
    anchors: ['tt1187043', 'tt1745960', 'tt9362722'],
    never: [
      { name: 'Reddit story narrations', channels: ['@redditjar', '@updootreddit', '@sirreddit', '@planetreddit'], keywords: ['r/askreddit', 'askreddit'], on: true },
      { name: 'Minecraft manhunts and challenges', channels: ['@dream', '@dreamxd', '@georgenotfound'], keywords: ['minecraft speedrunner', 'minecraft, but'], on: true },
      { name: 'Stunt and prize challenges', channels: ['@mrbeast', '@mrbeast2', '@mrbeastgaming'], keywords: ['win $', 'last to leave'], on: true },
      { name: 'Outrage politics podcasts', channels: [], keywords: ['trump', 'maga', 'woke'], on: true },
    ],
  };
}
export const initialUnwind = (): UnwindStore => ({
  version: 1,
  taste: defaultTaste(),
  shows: {},
  officialChannels: {
    // TVF posts many of its own shows in full.
    UCNJcSUSzUeFm8W9P7UUlSeQ: {
      channelId: 'UCNJcSUSzUeFm8W9P7UUlSeQ',
      name: 'The Viral Fever',
      handle: '@TheViralFever',
      approved: true,
      proposedBy: 'claude:seed',
      at: new Date().toISOString(),
    },
  },
  calibrated: {},
  wanted: {},
});

const file = () => path.join(mediaRoot(), 'unwind.json');
export function readUnwind(): UnwindStore {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return initialUnwind();
    throw new Error('Unwind storage could not be read. Restore it before continuing.');
  }
}
export function writeUnwind(u: UnwindStore) {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(u) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file());
}
export const withUnwind = <T>(fn: (u: UnwindStore) => T | Promise<T>) =>
  withLock(async () => {
    const u = readUnwind();
    const out = await fn(u);
    writeUnwind(u);
    return out;
  }, 'unwind');

// ---- the taste card ----
// The card as the judge (and OpenClaw) reads it.
export function tasteText(card: TasteCard, anchorTitle: (id: string) => string | undefined = () => undefined) {
  const anchors = card.anchors.map((id) => anchorTitle(id) || id);
  return [
    card.summary,
    '',
    'Moods he lights up for:',
    ...card.moods.map((m) => `- ${m.name}${m.examples ? ` (e.g. ${m.examples})` : ''}`),
    anchors.length ? `\nAlready loved: ${anchors.join(', ')}.` : '',
    '',
    'Never, even to unwind:',
    ...card.never.filter((n) => n.on).map((n) => `- ${n.name}`),
  ].join('\n');
}
// What the judge and OpenClaw read: the card, with your anchors named from the IMDb cache.
export function tasteTarget(u = readUnwind()): TasteTarget {
  const titles = readState().titles;
  return {
    kind: 'taste',
    version: u.taste.version,
    text: tasteText(u.taste, (id) => titles[id]?.title || u.shows[id]?.title),
  };
}
// A cheap rule check before the model sees anything.
export function neverMatch(card: TasteCard, item: { creator?: string; title?: string }) {
  const creator = item.creator?.toLowerCase();
  const title = item.title?.toLowerCase() || '';
  return card.never.find(
    (n) => n.on && ((creator && n.channels.includes(creator)) || n.keywords.some((k) => k && title.includes(k))),
  )?.name;
}
export interface TastePatch {
  summary?: string;
  moods?: Mood[];
  anchors?: string[];
  never?: NeverRule[];
}
export async function editTaste(patch: TastePatch) {
  return withUnwind((u) => {
    const clean = (s: string, n: number) => s.trim().slice(0, n);
    const t = u.taste;
    if (patch.summary !== undefined) t.summary = clean(patch.summary, 1200);
    if (patch.moods)
      t.moods = patch.moods
        .map((m) => ({ name: clean(m.name, 40).toLowerCase(), examples: clean(m.examples, 160) }))
        .filter((m) => m.name)
        .slice(0, 20);
    if (patch.anchors) t.anchors = [...new Set(patch.anchors.filter((id) => /^tt\d+$/.test(id)))].slice(0, 40);
    if (patch.never)
      t.never = patch.never
        .map((n) => ({
          name: clean(n.name, 80),
          channels: n.channels.map((c) => c.trim().toLowerCase()).filter(Boolean).slice(0, 40),
          keywords: n.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 40),
          on: n.on,
        }))
        .filter((n) => n.name)
        .slice(0, 20);
    t.version++;
    t.updatedAt = new Date().toISOString();
    return t;
  });
}

// ---- shows and films ----
export interface ShowIn {
  id: string;
  state?: ShowState;
  runtimeMin?: number; // films: the catalogs don't know it
  alignment?: Omit<Alignment, 'judgedAt'> & { judgedAt?: string };
}
export interface ShowAddResult {
  added: string[];
  updated: string[];
  unknown: { id: string; reason: string }[];
}
// Looks every title up before taking it. A series without TVmaze episodes is
// refused: nothing could say what to watch next.
export async function addShows(items: ShowIn[], by: string, f: CatalogFetchers = defaultFetchers): Promise<ShowAddResult> {
  const res: ShowAddResult = { added: [], updated: [], unknown: [] };
  const known = readUnwind().shows;
  const looked: { item: ShowIn; show?: Partial<Show> }[] = [];
  for (const item of items) {
    if (known[item.id]) {
      looked.push({ item });
      continue;
    }
    try {
      const t = await lookupTitle(item.id, f);
      if (!t) {
        res.unknown.push({ id: item.id, reason: 'Not a film or series on IMDb.' });
        continue;
      }
      let extra: Partial<Show> = {};
      if (t.kind === 'series') {
        const s = await showByImdb(item.id, f);
        if (!s || !s.episodes.length) {
          res.unknown.push({ id: item.id, reason: 'TVmaze has no episode list for this series.' });
          continue;
        }
        extra = {
          tvmazeId: s.tvmazeId,
          network: s.network,
          summary: s.summary,
          genres: s.genres,
          runtimeMin: s.runtime,
          episodes: s.episodes,
          episodesAt: new Date().toISOString(),
          poster: t.poster || s.poster,
        };
      }
      looked.push({ item, show: { kind: t.kind, title: t.title, year: t.year, poster: t.poster, cast: t.cast, ...extra } });
    } catch (e) {
      res.unknown.push({ id: item.id, reason: (e as Error).message });
    }
  }
  await withUnwind((u) => {
    const at = new Date().toISOString();
    for (const { item, show } of looked) {
      const alignment = item.alignment
        ? { ...item.alignment, judgedAt: item.alignment.judgedAt || at, why: item.alignment.why.trim().slice(0, 300) }
        : undefined;
      const old = u.shows[item.id];
      if (old) {
        if (alignment) old.alignment = alignment;
        if (item.runtimeMin) old.runtimeMin = item.runtimeMin;
        if (item.state && old.state === 'deck') old.state = item.state;
        res.updated.push(item.id);
        continue;
      }
      if (!show) continue;
      u.shows[item.id] = {
        id: item.id,
        kind: show.kind!,
        title: show.title!,
        ...show,
        ...(item.runtimeMin ? { runtimeMin: item.runtimeMin } : {}),
        state: item.state ?? 'deck',
        watched: [],
        positions: {},
        sources: {},
        alignment,
        addedBy: by,
        addedAt: at,
      };
      res.added.push(item.id);
    }
  });
  return res;
}
// Re-reads episode lists for running shows (new seasons air).
export async function refreshEpisodes(ids?: string[], f: CatalogFetchers = defaultFetchers) {
  const u = readUnwind();
  const due = Object.values(u.shows).filter(
    (s) =>
      s.kind === 'series' &&
      (ids ? ids.includes(s.id) : ['watching', 'paused', 'deck'].includes(s.state)) &&
      (ids || !s.episodesAt || Date.now() - Date.parse(s.episodesAt) > 7 * 86_400_000),
  );
  const fresh = new Map<string, CatalogEpisode[]>();
  for (const s of due.slice(0, 20)) {
    const c = await showByImdb(s.id, f).catch(() => undefined);
    if (c?.episodes.length) fresh.set(s.id, c.episodes);
  }
  await withUnwind((u) => {
    for (const [id, eps] of fresh)
      if (u.shows[id]) {
        u.shows[id].episodes = eps;
        u.shows[id].episodesAt = new Date().toISOString();
      }
  });
  return { refreshed: [...fresh.keys()] };
}

const today = () => new Date().toISOString().slice(0, 10);
// Episodes that exist and have aired, in order.
export const airedEpisodes = (s: Show) =>
  (s.episodes || [])
    .filter((e) => !e.airdate || e.airdate <= today())
    .sort((a, b) => a.season - b.season || a.number - b.number);
export function keysOf(s: Show) {
  return s.kind === 'film' ? [FILM] : airedEpisodes(s).map((e) => e.key);
}
// The first aired episode you haven't watched; a film is its own one key.
export function nextKey(s: Show): string | undefined {
  return keysOf(s).find((k) => !s.watched.includes(k));
}
export function runtimeOf(s: Show, key: string): number | undefined {
  if (key === FILM) return s.runtimeMin;
  return s.episodes?.find((e) => e.key === key)?.runtime ?? s.runtimeMin;
}
const keyOk = (s: Show, key: string) => keysOf(s).includes(key) || (s.episodes || []).some((e) => e.key === key);

function requireShow(u: UnwindStore, id: string) {
  const s = u.shows[id];
  if (!s) throw new Error('That title is not in Unwind. Refresh the page.');
  return s;
}
export async function setShowState(id: string, state: ShowState) {
  const finished = await withUnwind((u) => {
    const s = requireShow(u, id);
    s.state = state;
    if (state === 'watching') s.startedAt ??= new Date().toISOString();
    if (state === 'finished') s.finishedAt = new Date().toISOString();
    return state === 'finished' ? s : undefined;
  });
  if (finished) await recordWatched(finished);
}
// Where you are. Past 90%, or at the end, the episode counts as watched.
export async function savePosition(id: string, key: string, sec: number, durationSec?: number, ended = false) {
  const res = await withUnwind((u) => {
    const s = requireShow(u, id);
    if (!keyOk(s, key)) throw new Error('Unknown episode.');
    const at = new Date().toISOString();
    const dur = durationSec && durationSec > 0 ? durationSec : s.positions[key]?.durationSec;
    const pos = dur ? Math.min(sec, dur) : sec;
    s.positions[key] = { sec: pos, at, ...(dur ? { durationSec: dur } : {}) };
    s.lastWatchedAt = at;
    if (s.state === 'deck' || s.state === 'paused') {
      s.state = 'watching';
      s.startedAt ??= at;
    }
    const done = ended || (!!dur && pos >= dur * DONE_AT);
    return done ? watch(s, key, true) : undefined;
  });
  if (res) await recordWatched(res);
  return { done: !!res || readUnwind().shows[id]?.watched.includes(key) };
}
export async function markEpisode(id: string, key: string, done: boolean) {
  const finished = await withUnwind((u) => {
    const s = requireShow(u, id);
    if (!keyOk(s, key)) throw new Error('Unknown episode.');
    return watch(s, key, done);
  });
  if (finished) await recordWatched(finished);
}
// Marks one key; returns the show when that finished it.
function watch(s: Show, key: string, done: boolean): Show | undefined {
  const at = new Date().toISOString();
  if (done) {
    if (!s.watched.includes(key)) s.watched.push(key);
    s.lastWatchedAt = at;
    if (s.state === 'deck' || s.state === 'paused') s.state = 'watching';
    s.startedAt ??= at;
  } else {
    s.watched = s.watched.filter((k) => k !== key);
    if (s.positions[key]) s.positions[key].sec = 0;
    if (s.state === 'finished') {
      s.state = 'watching';
      delete s.finishedAt;
    }
    return undefined;
  }
  if (s.state !== 'finished' && !nextKey(s)) {
    s.state = 'finished';
    s.finishedAt = at;
    return s;
  }
  return undefined;
}
// A finished title joins your library and ranking, and IMDb learns you saw it.
export async function recordWatched(s: Show) {
  return withLock(() => {
    const state = readState();
    const old = state.titles[s.id];
    const title: MediaTitle = {
      ...old,
      id: s.id,
      title: old?.title || s.title,
      url: old?.url || `https://www.imdb.com/title/${s.id}/`,
      year: old?.year || s.year?.slice(0, 4),
      type: old?.type || (s.kind === 'series' ? 'TV Series' : 'Movie'),
      poster: old?.poster || s.poster,
      genres: old?.genres || s.genres,
      source: 'imdb',
      watched: true,
      collections: [...new Set([...(old?.collections || []), 'watched' as const])],
    };
    state.titles[s.id] = title;
    try {
      if (!old?.watched) addJob(state, 'seen', s.id);
    } catch {
      /* A full queue or a pending change: the next IMDb sync settles it. */
    }
    writeState(state);
  });
}

// ---- play sources ----
export async function addSource(id: string, key: string, src: PlaySource) {
  return withUnwind((u) => {
    const s = requireShow(u, id);
    if (!keyOk(s, key)) throw new Error('Unknown episode.');
    const list = (s.sources[key] ||= []);
    const same = (x: PlaySource) =>
      x.kind === src.kind && (x.kind === 'youtube' ? x.videoId === (src as typeof x).videoId : x.fileId === (src as typeof x).fileId);
    if (!list.some(same)) list.push(src);
    delete u.wanted[id];
    return list.length;
  });
}
export async function removeSource(id: string, key: string, ref: string) {
  return withUnwind((u) => {
    const s = requireShow(u, id);
    s.sources[key] = (s.sources[key] || []).filter((x) => (x.kind === 'youtube' ? x.videoId : x.fileId) !== ref);
    if (!s.sources[key].length) delete s.sources[key];
  });
}
export async function want(id: string, on = true) {
  return withUnwind((u) => {
    requireShow(u, id);
    if (on) u.wanted[id] = new Date().toISOString();
    else delete u.wanted[id];
  });
}
export async function proposeChannel(c: { channelId: string; name: string; handle?: string }, by: string, approved = false) {
  return withUnwind((u) => {
    const old = u.officialChannels[c.channelId];
    u.officialChannels[c.channelId] = {
      ...c,
      approved: old?.approved || approved,
      proposedBy: old?.proposedBy || by,
      at: old?.at || new Date().toISOString(),
    };
    return u.officialChannels[c.channelId];
  });
}
export async function approveChannel(channelId: string, approved: boolean) {
  return withUnwind((u) => {
    const c = u.officialChannels[channelId];
    if (!c) throw new Error('Unknown channel.');
    if (approved) c.approved = true;
    else delete u.officialChannels[channelId];
  });
}

// ---- first-run calibration on the taste page ----
export async function calibrate(id: string, answer: 'loved' | 'want' | 'not' | null, f: CatalogFetchers = defaultFetchers) {
  if (answer === 'want' && !readUnwind().shows[id]) {
    const r = await addShows([{ id }], 'you', f);
    if (r.unknown.length) throw new Error(r.unknown[0].reason);
  }
  return withUnwind((u) => {
    if (answer === null) delete u.calibrated[id];
    else u.calibrated[id] = answer;
    const anchors = new Set(u.taste.anchors);
    if (answer === 'loved') anchors.add(id);
    else anchors.delete(id);
    if ([...anchors].length !== u.taste.anchors.length) {
      u.taste.anchors = [...anchors];
      u.taste.version++;
      u.taste.updatedAt = new Date().toISOString();
    }
    const s = u.shows[id];
    if (s && answer === 'not' && s.state === 'deck') s.state = 'dropped';
    if (s && answer === 'want' && s.state === 'dropped') s.state = 'deck';
    return u.calibrated;
  });
}

// Titles the taste page asks about on a first run: what you love tells OpenClaw more than any rule.
export const CALIBRATION_IDS = [
  'tt2575988', // Silicon Valley
  'tt7660850', // Succession
  'tt4742876', // TVF Pitchers
  'tt9432978', // Kota Factory
  'tt12392504', // Scam 1992
  'tt13868972', // Rocket Boys
  'tt2543312', // Halt and Catch Fire
  'tt4158110', // Mr. Robot
  'tt11280740', // Severance
  'tt11680642', // Pantheon
  'tt4270492', // Billions
  'tt14452776', // The Bear
  'tt12005128', // WeCrashed
  'tt1285016', // The Social Network
  'tt1210166', // Moneyball
  'tt1596363', // The Big Short
  'tt23849204', // 12th Fail
  'tt2395469', // Gully Boy
];
const calibrationCache = new Map<string, Awaited<ReturnType<typeof lookupTitle>>>();
export async function calibrationItems(f: CatalogFetchers = defaultFetchers) {
  const missing = CALIBRATION_IDS.filter((id) => !calibrationCache.has(id));
  await Promise.all(
    missing.map(async (id) => {
      const t = await lookupTitle(id, f).catch(() => undefined);
      if (t) calibrationCache.set(id, t);
    }),
  );
  const u = readUnwind();
  return CALIBRATION_IDS.map((id) => calibrationCache.get(id))
    .filter((t): t is NonNullable<typeof t> => !!t)
    .map((t) => ({ id: t.id, kind: t.kind, title: t.title, year: t.year, poster: t.poster, answer: u.calibrated[t.id] ?? null }));
}
