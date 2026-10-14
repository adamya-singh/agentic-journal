import fs from 'node:fs';
import path from 'node:path';
import { mediaRoot } from './store.ts';
import { thumbnailUrl, watchUrl, VIDEO_ID } from './youtube-links.ts';
import type { MediaState } from './types.ts';
import type { YouTubeStore } from './youtube-store.ts';
import type { BookmarkFolderStore, BookmarkSource, BookmarkTranscripts } from '../bookmarks/types.ts';
import type { FeedCreator, FeedItem, FeedSource } from './feed-types.ts';

// The feed stores only ids and judgments; titles, text, media and posters come
// from the source stores at read time. Each file is cached until its mtime changes.

const DATA_SEGMENTS = ['src', 'backend', 'data'];
const dataDir = () => process.env.BACKEND_DATA_DIR || path.join(process.cwd(), ...DATA_SEGMENTS);
const cache = new Map<string, { mtime: number; value: unknown }>();
function cached<T>(file: string, fallback: T): T {
  let mtime: number;
  try {
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return fallback;
  }
  const hit = cache.get(file);
  if (hit && hit.mtime === mtime) return hit.value as T;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    cache.set(file, { mtime, value });
    return value;
  } catch {
    // A write in progress; use the previous copy if there is one.
    return (hit?.value as T) ?? fallback;
  }
}
const bookmarksFile = (name: string) => path.join(dataDir(), 'bookmarks', name);
export const youtubePool = () =>
  cached<YouTubeStore>(path.join(mediaRoot(), 'youtube.json'), {
    version: 1,
    channels: {},
    videos: {},
  });
export const imdbPool = () =>
  cached<MediaState>(path.join(mediaRoot(), 'state.json'), {
    version: 1,
    titles: {},
    recommendations: [],
    feedback: {},
    coverage: {},
    jobs: [],
  });
const sources = () => cached<Record<string, BookmarkSource>>(bookmarksFile('sources.json'), {});
const folders = () =>
  cached<BookmarkFolderStore>(bookmarksFile('folders.json'), { folders: [], membership: {} });
const mediaIndex = () => cached<Record<string, unknown>>(bookmarksFile('media.json'), {});
const transcripts = () => cached<BookmarkTranscripts>(bookmarksFile('transcripts.json'), {});

// Post id → bookmark, and post id → folder names (API newest-20 lists merged with full web lists).
let postIndex: { src: unknown; byPost: Map<string, BookmarkSource> } | undefined;
export function bookmarkByPost(): Map<string, BookmarkSource> {
  const src = sources();
  if (postIndex?.src !== src)
    postIndex = { src, byPost: new Map(Object.values(src).map((b) => [b.id, b])) };
  return postIndex.byPost;
}
let folderIndex: { src: unknown; names: Map<string, string[]> } | undefined;
export function foldersByPost(): Map<string, string[]> {
  const f = folders();
  if (folderIndex?.src === f) return folderIndex.names;
  const name = new Map(f.folders.map((x) => [x.id, x.name]));
  const names = new Map<string, string[]>();
  const add = (post: string, folder: string) => {
    const n = name.get(folder);
    if (!n) return;
    const list = names.get(post) || [];
    if (!list.includes(n)) list.push(n);
    names.set(post, list);
  };
  for (const [post, ids] of Object.entries(f.membership)) for (const id of ids) add(post, id);
  for (const [folder, web] of Object.entries(f.web || {})) for (const post of web.ids) add(post, folder);
  folderIndex = { src: f, names };
  return names;
}

export const sourceOf = (id: string): FeedSource | undefined =>
  id.startsWith('yt:') ? 'youtube' : id.startsWith('x:') ? 'x' : /^tt\d+$/.test(id) ? 'imdb' : undefined;
export const FEED_ID = /^(yt:[A-Za-z0-9_-]{11}|x:\d{1,25}|tt\d{1,12})$/;

// Bigger IMDb posters: Amazon image URLs take their size from the suffix after `._V1_`.
export const largePoster = (url?: string) =>
  url?.replace(/\._V1_.*\.(jpg|png)$/, '._V1_QL75_UX480_.$1');
const IMDB_JUNK = /^(Browse (movies|TV shows) by genre|Related interests|Join the Discussion)$/i;
export const cleanGenres = (g?: string[]) => (g || []).filter((x) => !IMDB_JUNK.test(x));

// What the pools know about an id, enough to create a feed item.
export function describe(id: string): Pick<FeedItem, 'source' | 'title' | 'url' | 'creator' | 'publishedAt'> | undefined {
  const source = sourceOf(id);
  if (source === 'youtube') {
    const vid = id.slice(3);
    const y = youtubePool();
    const v = y.videos[vid];
    if (!v) return undefined;
    const c = y.channels[v.channel];
    return {
      source,
      title: v.title,
      url: watchUrl(vid, v.short),
      creator: { key: v.channel, name: c?.name || 'Unknown channel', handle: c?.handle },
    };
  }
  if (source === 'x') {
    const b = bookmarkByPost().get(id.slice(2));
    if (!b) return undefined;
    return {
      source,
      title: postTitle(b.text),
      url: b.url,
      creator: xCreator(b),
      publishedAt: b.publishedAt,
    };
  }
  if (source === 'imdb') {
    const t = imdbPool().titles[id];
    if (!t) return undefined;
    return {
      source,
      title: t.title,
      url: t.url,
      creator: { key: 'imdb', name: 'IMDb' },
      publishedAt: t.year ? `${t.year}-01-01` : undefined,
    };
  }
  return undefined;
}
export const xCreator = (b: BookmarkSource): FeedCreator => ({
  key: `x:@${b.author.username.toLowerCase()}`,
  name: b.author.name,
  handle: `@${b.author.username}`,
});
export function displayText(text: string) {
  return text
    .replace(/(\s*https:\/\/t\.co\/\w+)+\s*$/, '')
    .replace(
      /&(amp|lt|gt|quot|#39);/g,
      (_, e: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]!,
    );
}
export const postTitle = (text: string) => {
  const t = displayText(text).replace(/\s+/g, ' ').trim();
  return t.length > 120 ? `${t.slice(0, 117).replace(/\s\S*$/, '')}…` : t || 'Post';
};

// ---- cards: what the page renders ----
export interface YouTubeFacts {
  videoId: string;
  thumbnail: string;
  durationSec?: number;
  progress?: number;
  short?: boolean;
  watchedDay?: string;
  inHistory: boolean;
}
export interface XFacts {
  postId: string;
  text: string;
  author: { name: string; username: string; avatar?: string };
  media: {
    type: string;
    url?: string;
    preview?: string;
    alt?: string;
    width?: number;
    height?: number;
    video?: string;
    durationMs?: number;
    localUrl?: string;
  }[];
  links: { url: string; title?: string; description?: string; image?: string; domain: string }[];
  folders: string[];
  journalUrl: string;
}
export interface ImdbFacts {
  poster?: string;
  year?: string;
  type?: string;
  genres: string[];
  imdbRating?: number;
  watchlist?: boolean;
  watched?: boolean;
}
export function youtubeFacts(item: FeedItem): YouTubeFacts {
  const vid = item.id.slice(3);
  const v = youtubePool().videos[vid];
  return {
    videoId: vid,
    thumbnail: thumbnailUrl(vid).replace('mqdefault', 'hqdefault'),
    durationSec: v?.durationSec ?? item.durationSec,
    progress: v?.progress,
    short: v?.short,
    watchedDay: v?.lastWatchedDay,
    inHistory: !!v,
  };
}
export function xFacts(item: FeedItem): XFacts | undefined {
  const postId = item.id.slice(2);
  const b = bookmarkByPost().get(postId);
  if (!b) return undefined;
  const index = mediaIndex();
  return {
    postId,
    text: displayText(b.text),
    author: { name: b.author.name, username: b.author.username, avatar: b.author.avatar },
    media: b.media.map((m, i) =>
      index[`${postId}:${i}`] ? { ...m, localUrl: `/api/bookmarks/media/${postId}/${i}` } : m,
    ),
    links: b.links.filter((l) => l.domain !== 'x.com' && l.domain !== 'twitter.com'),
    folders: foldersByPost().get(postId) || [],
    journalUrl: `/bookmarks?item=${encodeURIComponent(`${b.accountId}:${b.id}`)}`,
  };
}
export function imdbFacts(item: FeedItem): ImdbFacts | undefined {
  const t = imdbPool().titles[item.id];
  if (!t) return undefined;
  return {
    poster: largePoster(t.poster),
    year: t.year,
    type: t.type,
    genres: cleanGenres(t.genres),
    imdbRating: t.imdbRating,
    watchlist: t.watchlist,
    watched: t.watched,
  };
}

// ---- judge inputs: a compact, text-only description of a pool item ----
export interface JudgeInput {
  id: string;
  source: FeedSource;
  title: string;
  creator: string;
  detail: string;
}
export function judgeInput(id: string): JudgeInput | undefined {
  const d = describe(id);
  if (!d) return undefined;
  const parts: string[] = [];
  if (d.source === 'youtube') {
    const v = youtubePool().videos[id.slice(3)];
    if (v?.durationSec) parts.push(`${Math.round(v.durationSec / 60)} min`);
    if (v?.short) parts.push('Short');
    if (v?.progress !== undefined) parts.push(`you watched ${Math.round(v.progress * 100)}%`);
    const s = imdbPool().titles[id];
    if (s) parts.push('you kept it in your library');
  } else if (d.source === 'x') {
    const postId = id.slice(2);
    const b = bookmarkByPost().get(postId)!;
    const f = foldersByPost().get(postId);
    if (f?.length) parts.push(`your bookmark folder: ${f.join(', ')}`);
    parts.push(`text: ${displayText(b.text).replace(/\s+/g, ' ').slice(0, 400)}`);
    const media = b.media.map((m) => m.type);
    if (media.length) parts.push(`media: ${media.join(', ')}`);
    const link = b.links.find((l) => l.title);
    if (link) parts.push(`link: ${link.title} (${link.domain})`);
    const tr = Object.entries(transcripts()).find(([k]) => k.startsWith(`${postId}:`))?.[1];
    if (tr?.text) parts.push(`video says: ${tr.text.replace(/\s+/g, ' ').slice(0, 300)}`);
  } else {
    const t = imdbPool().titles[id]!;
    parts.push(
      [t.type, t.year, cleanGenres(t.genres).join(', '), t.imdbRating && `IMDb ${t.imdbRating}`]
        .filter(Boolean)
        .join(' · '),
    );
    if (t.watched) parts.push('you have watched it');
  }
  return {
    id,
    source: d.source,
    title: d.source === 'x' ? '' : d.title,
    creator: d.creator.name + (d.creator.handle ? ` ${d.creator.handle}` : ''),
    detail: parts.join(' | '),
  };
}

// Every pool id, for the seed pass and `feed-candidates`.
export function poolIds(source?: FeedSource): string[] {
  const out: string[] = [];
  if (!source || source === 'youtube')
    for (const vid of Object.keys(youtubePool().videos)) if (VIDEO_ID.test(vid)) out.push(`yt:${vid}`);
  if (!source || source === 'x') for (const post of bookmarkByPost().keys()) out.push(`x:${post}`);
  if (!source || source === 'imdb')
    for (const t of Object.values(imdbPool().titles)) if (/^tt\d+$/.test(t.id)) out.push(t.id);
  return out;
}
