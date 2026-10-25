import { page, readFeed, type FeedCard } from './feed-store.ts';
import { rankingOf, readState } from './store.ts';
import { libraryFile, readLibrary, type Library } from './library.ts';
import {
  airedEpisodes,
  FILM,
  keysOf,
  nextKey,
  readUnwind,
  runtimeOf,
  type PlaySource,
  type Show,
  type UnwindStore,
} from './unwind-store.ts';

// What /media/unwind shows. Pure over the stores, so the Tonight rules are testable.

export type Bucket = '30' | '60' | '120' | 'clips';
export const BUCKETS: Bucket[] = ['30', '60', '120', 'clips'];
// The most each bucket will plan, in minutes.
const FITS: Record<Exclude<Bucket, 'clips'>, number> = { '30': 35, '60': 65, '120': 180 };
const CLIP_SET_MIN = 30;
// Runtimes the catalogs don't know.
const GUESS_EPISODE = 45,
  GUESS_FILM = 150;

export interface PlayableSource {
  kind: 'youtube' | 'file';
  videoId?: string;
  channel?: string;
  fileId?: string;
  src?: string;
  subtitles?: { lang: string; src: string }[];
  durationSec?: number;
}
export interface EpisodeRef {
  key: string;
  label: string; // 'S2 E5 “Server Space”' or the film's title
  name?: string;
  minutes?: number;
  resumeAt: number;
  durationSec?: number;
  playable: boolean;
}
export interface ShowCard {
  id: string;
  kind: 'series' | 'film';
  title: string;
  year?: string;
  poster?: string;
  network?: string;
  summary?: string;
  state: Show['state'];
  why?: string;
  tags: string[];
  fun?: number;
  fit?: number;
  score: number;
  watched: number;
  total: number;
  next?: EpisodeRef;
  wanted: boolean;
  ranked: boolean;
  finishedAt?: string;
  lastWatchedAt?: string;
}
export interface Pick {
  bucket: Bucket;
  kind: 'episodes' | 'film' | 'clips' | 'none';
  show?: ShowCard;
  episodes?: EpisodeRef[];
  clips?: FeedCard[];
  minutes: number;
  note: string;
}
export interface UnwindView {
  taste: { summary: string; version: number; moods: string[] };
  tonight: Record<Bucket, Pick>;
  continuing: ShowCard[];
  deck: ShowCard[];
  films: ShowCard[];
  finished: ShowCard[];
  clips: FeedCard[];
  counts: { shows: number; watching: number; deck: number; clips: number; unmatched: number; channelsToApprove: number };
}

export const episodeLabel = (s: Show, key: string) => {
  if (key === FILM) return s.title;
  const e = s.episodes?.find((x) => x.key === key);
  const m = key.match(/^S(\d+)E(\d+)$/);
  const num = m ? `S${m[1]} E${m[2]}` : key;
  return e?.name ? `${num} “${e.name}”` : num;
};
const sourcesPlayable = (list: PlaySource[] | undefined, lib: Library) =>
  (list || []).some((x) => x.kind === 'youtube' || !!libraryFile(lib, x.fileId)?.playable);
export function resumeAt(s: Show, key: string) {
  const p = s.positions[key];
  if (!p || s.watched.includes(key) || p.sec < 30) return 0;
  if (p.durationSec && p.sec > p.durationSec - 10) return 0;
  return Math.floor(p.sec);
}
export function episodeRef(s: Show, key: string, lib: Library): EpisodeRef {
  const e = s.episodes?.find((x) => x.key === key);
  return {
    key,
    label: episodeLabel(s, key),
    name: e?.name,
    minutes: runtimeOf(s, key),
    resumeAt: resumeAt(s, key),
    durationSec: s.positions[key]?.durationSec,
    playable: sourcesPlayable(s.sources[key], lib),
  };
}

export function showCard(s: Show, u: UnwindStore, lib: Library, ranked: Set<string>): ShowCard {
  const a = s.alignment;
  const keys = keysOf(s);
  const next = nextKey(s);
  return {
    id: s.id,
    kind: s.kind,
    title: s.title,
    year: s.year,
    poster: s.poster,
    network: s.network,
    summary: s.summary?.slice(0, 300),
    state: s.state,
    why: a?.why,
    tags: a?.tags || [],
    fun: a?.fun,
    fit: a?.fit,
    score: a?.confidence ?? 0.5,
    watched: s.watched.filter((k) => keys.includes(k)).length,
    total: keys.length,
    next: next ? episodeRef(s, next, lib) : undefined,
    wanted: !!u.wanted[s.id],
    ranked: ranked.has(s.id),
    finishedAt: s.finishedAt,
    lastWatchedAt: s.lastWatchedAt,
  };
}

// The episodes from `start` on that fit in `max` minutes (at least one).
function run(s: Show, start: string, max: number, lib: Library) {
  const keys = airedEpisodes(s).map((e) => e.key).filter((k) => !s.watched.includes(k));
  const from = keys.indexOf(start);
  const out: EpisodeRef[] = [];
  let minutes = 0;
  for (const k of keys.slice(from < 0 ? 0 : from)) {
    const m = (runtimeOf(s, k) ?? GUESS_EPISODE) - resumeAt(s, k) / 60;
    if (out.length && minutes + m > max) break;
    out.push(episodeRef(s, k, lib));
    minutes += m;
    if (minutes >= max) break;
  }
  return { out, minutes: Math.round(minutes) };
}

// One thing that fits the time you have. Shows you are in the middle of come
// first, then the best of what's on deck; something that plays here beats
// something that doesn't.
export function tonight(bucket: Bucket, u: UnwindStore, lib: Library, clips: FeedCard[], ranked = new Set<string>()): Pick {
  if (bucket === 'clips') {
    const set: FeedCard[] = [];
    let sec = 0;
    const len = (c: FeedCard) => c.youtube?.durationSec ?? (c.source === 'x' ? 60 : 300);
    // Best first, skipping whatever would overflow the set; a lone long one only if nothing fits.
    for (const c of clips) {
      if (sec + len(c) > CLIP_SET_MIN * 60) continue;
      set.push(c);
      sec += len(c);
      if (set.length >= 8) break;
    }
    if (!set.length && clips.length) {
      const shortest = [...clips].sort((a, b) => len(a) - len(b))[0];
      set.push(shortest);
      sec = len(shortest);
    }
    return set.length
      ? { bucket, kind: 'clips', clips: set, minutes: Math.round(sec / 60), note: 'A short set, not an endless scroll.' }
      : { bucket, kind: 'none', minutes: 0, note: 'No clips waiting yet. OpenClaw adds more every morning.' };
  }
  const max = FITS[bucket];
  const shows = Object.values(u.shows);
  const watching = shows
    .filter((s) => s.state === 'watching')
    .sort((a, b) => (b.lastWatchedAt || '').localeCompare(a.lastWatchedAt || ''));
  const deck = shows
    .filter((s) => s.state === 'deck')
    .sort((a, b) => (b.alignment?.confidence ?? 0.5) - (a.alignment?.confidence ?? 0.5) || a.title.localeCompare(b.title));
  const order = [...watching, ...deck];
  const minutesOf = (s: Show, k: string) =>
    (runtimeOf(s, k) ?? (s.kind === 'film' ? GUESS_FILM : GUESS_EPISODE)) - resumeAt(s, k) / 60;
  const playable = (s: Show, k: string) => sourcesPlayable(s.sources[k], lib);
  for (const needPlayable of [true, false]) {
    if (bucket === '120') {
      // A film first: that is what a long night is for.
      for (const s of order.filter((x) => x.kind === 'film')) {
        const k = nextKey(s);
        if (!k || (needPlayable && !playable(s, k)) || minutesOf(s, k) > max) continue;
        return {
          bucket,
          kind: 'film',
          show: showCard(s, u, lib, ranked),
          episodes: [episodeRef(s, k, lib)],
          minutes: Math.round(minutesOf(s, k)),
          note: s.state === 'watching' ? 'Finish what you started.' : 'Film night.',
        };
      }
    }
    for (const s of order.filter((x) => x.kind === 'series')) {
      const k = nextKey(s);
      if (!k || (needPlayable && !playable(s, k))) continue;
      const m = minutesOf(s, k);
      if (m > max) continue;
      // Short episodes stack up to fill the time.
      const r = bucket === '30' ? { out: [episodeRef(s, k, lib)], minutes: Math.round(m) } : run(s, k, max, lib);
      const eps = needPlayable ? r.out.filter((e, i) => i === 0 || e.playable) : r.out;
      return {
        bucket,
        kind: 'episodes',
        show: showCard(s, u, lib, ranked),
        episodes: eps,
        minutes: eps.reduce((n, e) => n + (e.minutes ?? GUESS_EPISODE) - e.resumeAt / 60, 0) | 0,
        note:
          s.state === 'watching'
            ? `Next in a show you are ${s.watched.length} episode${s.watched.length === 1 ? '' : 's'} into.`
            : 'A new show from your deck.',
      };
    }
  }
  return {
    bucket,
    kind: 'none',
    minutes: 0,
    note: shows.length ? 'Nothing on deck fits that much time.' : 'Nothing on deck yet. Calibrate your taste card or ask OpenClaw for picks.',
  };
}

export function unwindView(u = readUnwind(), lib = readLibrary(), now = Date.now()): UnwindView {
  const f = readFeed();
  const clips = page({ compass: 'taste', filter: 'queue', limit: 16 }, f).items;
  const r = rankingOf(readState());
  const ranked = new Set([...Object.values(r.tiers).flat(), ...Object.values(r.pending).flat(), ...r.skipped]);
  const shows = Object.values(u.shows);
  const card = (s: Show) => showCard(s, u, lib, ranked);
  const byScore = (a: Show, b: Show) => (b.alignment?.confidence ?? 0.5) - (a.alignment?.confidence ?? 0.5) || a.title.localeCompare(b.title);
  const month = 30 * 86_400_000;
  return {
    taste: { summary: u.taste.summary, version: u.taste.version, moods: u.taste.moods.map((m) => m.name) },
    tonight: Object.fromEntries(BUCKETS.map((b) => [b, tonight(b, u, lib, clips, ranked)])) as Record<Bucket, Pick>,
    continuing: shows
      .filter((s) => s.state === 'watching' || (s.state === 'paused' && s.watched.length))
      .sort((a, b) => (b.lastWatchedAt || '').localeCompare(a.lastWatchedAt || ''))
      .map(card),
    deck: shows.filter((s) => s.state === 'deck' && s.kind === 'series').sort(byScore).map(card),
    films: shows.filter((s) => s.state === 'deck' && s.kind === 'film').sort(byScore).map(card),
    finished: shows
      .filter((s) => s.state === 'finished' && (!ranked.has(s.id) || now - Date.parse(s.finishedAt || '') < month))
      .sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''))
      .map(card),
    clips: clips.slice(0, 8),
    counts: {
      shows: shows.length,
      watching: shows.filter((s) => s.state === 'watching').length,
      deck: shows.filter((s) => s.state === 'deck').length,
      clips: clips.length,
      unmatched: Object.values(lib.files).filter((x) => !x.match && x.status !== 'failed').length,
      channelsToApprove: Object.values(u.officialChannels).filter((c) => !c.approved).length,
    },
  };
}

// Everything the watch page needs for one title.
export interface WatchView {
  show: ShowCard;
  key: string;
  episode: EpisodeRef;
  sources: PlayableSource[];
  episodes: (EpisodeRef & { watched: boolean; season?: number })[];
  nextKey?: string;
  prevKey?: string;
}
export function watchView(id: string, key?: string, u = readUnwind(), lib = readLibrary()): WatchView | undefined {
  const s = u.shows[id];
  if (!s) return undefined;
  const keys = keysOf(s);
  const k = key && (keys.includes(key) || s.episodes?.some((e) => e.key === key)) ? key : nextKey(s) || keys.at(-1);
  if (!k) return undefined;
  const sources: PlayableSource[] = [];
  for (const src of s.sources[k] || []) {
    if (src.kind === 'youtube')
      sources.push({ kind: 'youtube', videoId: src.videoId, channel: src.channel, durationSec: src.durationSec });
    else {
      const file = libraryFile(lib, src.fileId);
      if (file?.playable)
        sources.push({
          kind: 'file',
          fileId: file.id,
          src: `/api/media/unwind/stream/${file.id}`,
          subtitles: file.subtitles.map((t, i) => ({ lang: t.lang, src: `/api/media/unwind/subs/${file.id}/${i}` })),
          durationSec: file.probe?.durationSec,
        });
    }
  }
  // A file that plays here is the better experience; YouTube is the fallback.
  sources.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'file' ? -1 : 1));
  const i = keys.indexOf(k);
  const r = rankingOf(readState());
  const ranked = new Set([...Object.values(r.tiers).flat(), ...Object.values(r.pending).flat(), ...r.skipped]);
  return {
    show: showCard(s, u, lib, ranked),
    key: k,
    episode: episodeRef(s, k, lib),
    sources,
    episodes:
      s.kind === 'film'
        ? []
        : airedEpisodes(s).map((e) => ({ ...episodeRef(s, e.key, lib), watched: s.watched.includes(e.key), season: e.season })),
    nextKey: i >= 0 ? keys[i + 1] : undefined,
    prevKey: i > 0 ? keys[i - 1] : undefined,
  };
}
