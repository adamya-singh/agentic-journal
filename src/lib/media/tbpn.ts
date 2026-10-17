import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaRoot, withLock } from './store.ts';
import { readYouTube } from './youtube-store.ts';
import { VIDEO_ID, thumbnailUrl, watchUrl } from './youtube-links.ts';

// Diet TBPN, TBPN's daily recap, played on the Media page. Episodes come from the
// public playlist (no sign-in needed). How far you got comes from two places: your
// YouTube history (youtube.json, synced daily by OpenClaw) and the Journal's own
// player, which saves its position as you watch. The furthest of the two wins.

export const DIET_TBPN_PLAYLIST = 'PLBV_0ax_G8bpVbF8ndXETB2S2obcwF8gT';
export const WINDOW_DAYS = 60;
// Past this share an episode counts as watched (the outro is skippable).
export const DONE_AT = 0.9;
// YouTube's resume bar never shows less than 10%: at 0.10 you only opened it.
const OPENED = 0.1;
const DAY_MS = 86_400_000;
const STALE_MS = 30 * 60_000;
const RETRY_MS = 5 * 60_000;

export interface Episode {
  title: string;
  durationSec?: number;
  publishedAt?: string;
}
export interface Watch {
  // Seconds into the episode where the Journal's player last was.
  position: number;
  at: string;
  // true: finished or marked watched; false: put back in the queue by you.
  done?: boolean;
}
export interface TbpnStore {
  version: 1;
  syncedAt?: string;
  attemptedAt?: string;
  error?: string;
  episodes: Record<string, Episode>;
  watch: Record<string, Watch>;
}

const file = () => path.join(mediaRoot(), 'tbpn.json');
export const initialTbpn = (): TbpnStore => ({ version: 1, episodes: {}, watch: {} });
export function readTbpn(): TbpnStore {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return initialTbpn();
    throw new Error('Diet TBPN storage could not be read. Restore it before continuing.');
  }
}
function writeTbpn(t: TbpnStore) {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(t) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file());
}
// Its own lock: saving your place never waits behind an IMDb or YouTube sync.
const withTbpn = <T>(fn: (t: TbpnStore) => T) =>
  withLock(() => {
    const t = readTbpn();
    const out = fn(t);
    writeTbpn(t);
    return out;
  }, 'tbpn');

// ---- the playlist page ----
export interface PlaylistItem {
  videoId: string;
  title: string;
  durationSec?: number;
}
export function parseClock(s: string): number | undefined {
  if (!/^\d+(:\d{2}){1,2}$/.test(s)) return undefined;
  return s.split(':').reduce((a, p) => a * 60 + Number(p), 0);
}
const cleanTitle = (t: string) => t.replace(/\s*\|\s*Diet TBPN\s*$/i, '').trim();
function badgeClock(o: unknown): number | undefined {
  if (!o || typeof o !== 'object') return undefined;
  const text = (o as { thumbnailBadgeViewModel?: { text?: string } }).thumbnailBadgeViewModel?.text;
  if (text && parseClock(text)) return parseClock(text);
  for (const v of Object.values(o)) {
    const found = badgeClock(v);
    if (found) return found;
  }
  return undefined;
}
interface Lockup {
  contentId?: string;
  contentType?: string;
  metadata?: { lockupMetadataViewModel?: { title?: { content?: string } } };
  contentImage?: unknown;
}
// The newest 100 videos of the playlist, as the page's ytInitialData lists them.
export function parsePlaylistPage(html: string): PlaylistItem[] {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error('The Diet TBPN playlist page changed. Its videos could not be read.');
  const out: PlaylistItem[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    const l = (o as { lockupViewModel?: Lockup }).lockupViewModel;
    if (l?.contentId && VIDEO_ID.test(l.contentId) && l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      const title = l.metadata?.lockupMetadataViewModel?.title?.content;
      if (title) out.push({ videoId: l.contentId, title: cleanTitle(title), durationSec: badgeClock(l.contentImage) });
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(JSON.parse(m[1]));
  return out;
}
export function parsePublishDate(html: string): string | undefined {
  const m = html.match(/"publishDate":(?:\{"simpleText":)?"([^"]+)"/);
  const t = m ? Date.parse(m[1]) : NaN;
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
async function page(url: string) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`YouTube answered ${r.status}.`);
  return r.text();
}
export interface Fetchers {
  playlist: () => Promise<string>;
  watch: (videoId: string) => Promise<string>;
}
const youtube: Fetchers = {
  playlist: () => page(`https://www.youtube.com/playlist?list=${DIET_TBPN_PLAYLIST}`),
  watch: (id) => page(`https://www.youtube.com/watch?v=${id}`),
};

// Reads the playlist and dates the episodes it has not dated yet. The playlist is
// newest first, so dating stops once episodes fall well outside the window.
export async function syncEpisodes(now = Date.now(), fetchers: Fetchers = youtube) {
  const attemptedAt = new Date(now).toISOString();
  try {
    const items = parsePlaylistPage(await fetchers.playlist());
    if (!items.length) throw new Error('The Diet TBPN playlist came back empty.');
    const known = readTbpn().episodes;
    const cutoff = now - (WINDOW_DAYS + 7) * DAY_MS;
    const dates: Record<string, string> = {};
    let outside = 0;
    for (let i = 0; i < items.length && outside < 3; i += 6) {
      const batch = items.slice(i, i + 6);
      const found = await Promise.all(
        batch.map(
          async (it) =>
            known[it.videoId]?.publishedAt ??
            (await fetchers.watch(it.videoId).then(parsePublishDate, () => undefined)),
        ),
      );
      batch.forEach((it, n) => {
        const d = found[n];
        if (!d) return;
        dates[it.videoId] = d;
        outside = Date.parse(d) < cutoff ? outside + 1 : 0;
      });
    }
    return await withTbpn((t) => {
      for (const it of items) {
        const e = (t.episodes[it.videoId] ??= { title: it.title });
        e.title = it.title;
        e.durationSec = it.durationSec ?? e.durationSec;
        e.publishedAt = dates[it.videoId] ?? e.publishedAt;
      }
      t.syncedAt = t.attemptedAt = attemptedAt;
      delete t.error;
      return items.length;
    });
  } catch (e) {
    await withTbpn((t) => {
      t.attemptedAt = attemptedAt;
      t.error = e instanceof Error ? e.message : 'Diet TBPN could not be refreshed.';
    });
    throw e;
  }
}
let inflight: Promise<unknown> | undefined;
// Refreshes in the background when the list is old; waits only the very first time.
export async function ensureFresh(now = Date.now()) {
  const t = readTbpn();
  const stale = !t.syncedAt || now - Date.parse(t.syncedAt) > STALE_MS;
  const retrying = t.attemptedAt && t.attemptedAt !== t.syncedAt && now - Date.parse(t.attemptedAt) < RETRY_MS;
  if (!stale || retrying) return;
  inflight ??= syncEpisodes(now).finally(() => (inflight = undefined));
  if (!Object.keys(t.episodes).length) await inflight.catch(() => undefined);
  else inflight.catch(() => undefined);
}

// ---- your place in each episode ----
export async function savePosition(videoId: string, position: number, ended = false) {
  return withTbpn((t) => {
    const e = t.episodes[videoId];
    if (!e) throw new Error('That is not a Diet TBPN episode.');
    const end = e.durationSec ?? Infinity;
    const w = (t.watch[videoId] ??= { position: 0, at: '' });
    w.position = Math.max(0, Math.min(Math.round(position), end));
    w.at = new Date().toISOString();
    if (ended || w.position >= end * DONE_AT) w.done = true;
    return w;
  });
}
export async function markWatched(videoId: string, done: boolean) {
  return withTbpn((t) => {
    if (!t.episodes[videoId]) throw new Error('That is not a Diet TBPN episode.');
    const w = (t.watch[videoId] ??= { position: 0, at: new Date().toISOString() });
    w.done = done;
    // Back in the queue means from the start.
    if (!done) w.position = 0;
    return w;
  });
}

// ---- the view ----
export interface EpisodeView {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  publishedAt: string;
  durationSec?: number;
  // How far you got, 0..1, and where the player starts (seconds).
  progress: number;
  resumeAt: number;
  state: 'new' | 'started' | 'watched';
}
export interface TbpnView {
  queue: EpisodeView[];
  watched: EpisodeView[];
  remainingSec: number;
  windowDays: number;
  syncedAt?: string;
  error?: string;
  youtubeSyncedAt?: string;
  // Whether plays in the Journal show up in your YouTube history.
  history: 'confirmed' | 'missing' | 'unknown';
}
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export function buildView(t: TbpnStore, yt = readYouTube(), now = Date.now()): TbpnView {
  const from = now - WINDOW_DAYS * DAY_MS;
  const all: EpisodeView[] = [];
  for (const [id, e] of Object.entries(t.episodes)) {
    if (!e.publishedAt || Date.parse(e.publishedAt) < from) continue;
    const dur = e.durationSec;
    const w = t.watch[id];
    const ytp = yt.videos[id]?.progress ?? 0;
    const own = dur && w ? w.position / dur : 0;
    const resumeAt = Math.max(w?.position ?? 0, dur && ytp > OPENED ? Math.round(ytp * dur) - 5 : 0);
    const progress = Math.min(1, Math.max(ytp, own));
    const watched = w?.done ?? progress >= DONE_AT;
    all.push({
      id,
      title: e.title,
      url: watchUrl(id),
      thumbnail: thumbnailUrl(id),
      publishedAt: e.publishedAt,
      durationSec: dur,
      progress: watched ? Math.max(progress, w?.done ? 1 : 0) : progress,
      // A few seconds in, or right at the end, is not worth resuming.
      resumeAt: watched || resumeAt < 30 || (dur && resumeAt >= dur - 10) ? 0 : resumeAt,
      state: watched ? 'watched' : progress > 0 ? 'started' : 'new',
    });
  }
  all.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  const queue = all.filter((e) => e.state !== 'watched');
  // Plays the history sync should have seen by now: did any reach YouTube?
  const checked = yt.lastSyncAt
    ? Object.entries(t.watch).filter(([, w]) => w.position >= 60 && w.at && w.at < yt.lastSyncAt!)
    : [];
  const reached = checked.some(([id, w]) => (yt.videos[id]?.lastWatchedDay ?? '') >= localDay(w.at));
  return {
    queue,
    watched: all.filter((e) => e.state === 'watched').reverse(),
    remainingSec: queue.reduce((a, e) => a + (e.durationSec ?? 0) - e.resumeAt, 0),
    windowDays: WINDOW_DAYS,
    syncedAt: t.syncedAt,
    error: t.error,
    youtubeSyncedAt: yt.lastSyncAt,
    history: reached ? 'confirmed' : checked.length ? 'missing' : 'unknown',
  };
}
export const tbpnView = (now = Date.now()) => buildView(readTbpn(), readYouTube(), now);
