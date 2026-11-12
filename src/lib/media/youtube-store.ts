import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaRoot, readState, removeTitle, withLock, writeState } from './store.ts';
import { thumbnailUrl, watchUrl } from './youtube-links.ts';
import type { HistoryVideo, YouTubeAccount } from './youtube.ts';
import type { MediaState, MediaTitle } from './types.ts';

// Your YouTube watch history as review candidates. Pending and skipped videos
// live here; a kept video is a `yt:<videoId>` title in state.json, which is the
// only record of "kept" (a crash between the two writes cannot disagree).

export type VideoStatus = 'pending' | 'kept' | 'skipped';
export interface YouTubeVideo {
  title: string;
  channel: string;
  durationSec?: number;
  short?: boolean;
  live?: boolean;
  progress?: number;
  lastWatchedDay: string;
  firstSeenAt: string;
  status: VideoStatus;
  decidedBy?: 'you' | 'rule';
  decidedAt?: string;
}
export interface YouTubeChannel {
  name: string;
  handle?: string;
  channelId?: string;
  rule?: 'keep' | 'skip';
}
export interface YouTubeStore {
  version: 1;
  account?: YouTubeAccount;
  pendingAccount?: YouTubeAccount;
  coverage?: { oldestDay?: string; complete: boolean; total: number; at: string };
  // Where an unfinished full import continues, and the day heading it was under.
  cursor?: string;
  cursorDay?: string;
  lastSyncAt?: string;
  lastAttemptAt?: string;
  channels: Record<string, YouTubeChannel>;
  videos: Record<string, YouTubeVideo>;
}
export type Bucket = 'barely' | 'live';
export const BARELY = 0.2;
export const UNKNOWN_CHANNEL = 'unknown';

const file = () => path.join(mediaRoot(), 'youtube.json');
export const initialYouTube = (): YouTubeStore => ({ version: 1, channels: {}, videos: {} });
export function readYouTube(): YouTubeStore {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return initialYouTube();
    throw new Error('YouTube storage could not be read. Restore it before continuing.');
  }
}
export function writeYouTube(y: YouTubeStore) {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(y) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file());
}
// Both files change together under the media store lock (it is not reentrant: never nest).
async function update<T>(fn: (y: YouTubeStore, s: MediaState) => T): Promise<T> {
  return withLock(() => {
    const y = readYouTube(),
      s = readState();
    const result = fn(y, s);
    writeYouTube(y);
    writeState(s);
    return result;
  });
}

export const titleId = (videoId: string) => `yt:${videoId}`;
// The handle is the stable key the history page and oEmbed agree on; the id or name otherwise.
export const channelKey = (v: Pick<HistoryVideo, 'channelHandle' | 'channelId' | 'channelName'>) =>
  v.channelHandle?.toLowerCase() ||
  v.channelId ||
  (v.channelName ? `name:${v.channelName}` : UNKNOWN_CHANNEL);

function toTitle(videoId: string, v: YouTubeVideo, channel?: YouTubeChannel): MediaTitle {
  return {
    id: titleId(videoId),
    title: v.title,
    url: watchUrl(videoId, v.short),
    poster: thumbnailUrl(videoId),
    year: v.lastWatchedDay.slice(0, 4),
    type: v.short ? 'YouTube Short' : 'YouTube',
    source: 'youtube',
    channel: channel?.name,
    watched: true,
    collections: ['watched'],
  };
}
const isKept = (s: MediaState, videoId: string) => !!s.titles[titleId(videoId)];
function setStatus(
  y: YouTubeStore,
  s: MediaState,
  videoId: string,
  status: VideoStatus,
  by: 'you' | 'rule' = 'you',
) {
  const v = y.videos[videoId];
  if (!v) return;
  if (status === 'kept') {
    // Keep what the ranking or feedback already says about a title kept earlier.
    s.titles[titleId(videoId)] ??= toTitle(videoId, v, y.channels[v.channel]);
  } else if (isKept(s, videoId)) removeTitle(s, titleId(videoId));
  v.status = status;
  v.decidedBy = status === 'pending' ? undefined : by;
  v.decidedAt = status === 'pending' ? undefined : new Date().toISOString();
}

// Adds one page of history. Returns how many of its videos were already known.
export function mergeInto(y: YouTubeStore, s: MediaState, batch: HistoryVideo[], now = new Date()) {
  let known = 0;
  for (const h of batch) {
    const key = channelKey(h);
    const channel = (y.channels[key] ??= { name: h.channelName || 'Unknown channel' });
    if (h.channelName && channel.name === 'Unknown channel') channel.name = h.channelName;
    channel.handle ??= h.channelHandle;
    channel.channelId ??= h.channelId;
    const old = y.videos[h.videoId];
    if (old) {
      known++;
      // History lists a rewatch under each day; keep the latest.
      if (h.watchedDay > old.lastWatchedDay) old.lastWatchedDay = h.watchedDay;
      if (h.progress !== undefined && (old.progress ?? 0) < h.progress) old.progress = h.progress;
      if (old.channel === UNKNOWN_CHANNEL && key !== UNKNOWN_CHANNEL) old.channel = key;
      continue;
    }
    y.videos[h.videoId] = {
      title: h.title,
      channel: key,
      durationSec: h.durationSec,
      short: h.short || undefined,
      live: h.live || undefined,
      progress: h.progress,
      lastWatchedDay: h.watchedDay,
      firstSeenAt: now.toISOString(),
      status: 'pending',
    };
    if (channel.rule)
      setStatus(y, s, h.videoId, channel.rule === 'keep' ? 'kept' : 'skipped', 'rule');
  }
  return { known };
}
export async function mergeBatch(batch: HistoryVideo[]) {
  return update((y, s) => mergeInto(y, s, batch));
}
// Videos the history page lists without a channel (Shorts), once their channel is known.
export async function assignChannels(
  found: { videoId: string; channelName?: string; channelHandle?: string }[],
) {
  return update((y, s) => {
    for (const f of found) {
      const v = y.videos[f.videoId];
      if (!v || v.channel !== UNKNOWN_CHANNEL || !(f.channelName || f.channelHandle)) continue;
      const key = channelKey(f);
      const channel = (y.channels[key] ??= { name: f.channelName || f.channelHandle! });
      channel.handle ??= f.channelHandle;
      v.channel = key;
      const t = s.titles[titleId(f.videoId)];
      if (t) t.channel = channel.name;
      if (v.status === 'pending' && channel.rule)
        setStatus(y, s, f.videoId, channel.rule === 'keep' ? 'kept' : 'skipped', 'rule');
    }
  });
}
export const unknownChannelIds = (y: YouTubeStore, limit = 40) =>
  Object.entries(y.videos)
    .filter(([, v]) => v.channel === UNKNOWN_CHANNEL)
    .slice(0, limit)
    .map(([id]) => id);

// The kept/skipped/pending state before a change, so the page can undo it.
export type Previous = Record<string, VideoStatus>;
function decideMany(
  y: YouTubeStore,
  s: MediaState,
  ids: string[],
  status: VideoStatus,
  by: 'you' | 'rule' = 'you',
): Previous {
  const previous: Previous = {};
  for (const id of ids) {
    const v = y.videos[id];
    if (!v) continue;
    const was = isKept(s, id) ? 'kept' : v.status === 'kept' ? 'pending' : v.status;
    if (was === status) continue;
    previous[id] = was;
    setStatus(y, s, id, status, by);
  }
  return previous;
}
const statusOf = (y: YouTubeStore, s: MediaState, id: string): VideoStatus =>
  isKept(s, id) ? 'kept' : y.videos[id].status === 'kept' ? 'pending' : y.videos[id].status;
const pendingIds = (y: YouTubeStore, s: MediaState, match: (v: YouTubeVideo) => boolean) =>
  Object.entries(y.videos)
    .filter(([id, v]) => statusOf(y, s, id) === 'pending' && match(v))
    .map(([id]) => id);
export const inBucket = (v: YouTubeVideo, b: Bucket) =>
  b === 'live' ? !!v.live : !v.live && v.progress !== undefined && v.progress < BARELY;

export async function decide(ids: string[], status: VideoStatus) {
  return update((y, s) => ({ previous: decideMany(y, s, ids, status) }));
}
export async function decideChannel(
  key: string,
  status: 'kept' | 'skipped' | 'pending',
  remember: boolean,
) {
  return update((y, s) => {
    const channel = y.channels[key];
    if (!channel) throw new Error('Channel not found. Refresh the page.');
    const previousRule = channel.rule;
    if (status === 'pending') delete channel.rule;
    else if (remember) channel.rule = status === 'kept' ? 'keep' : 'skip';
    else delete channel.rule;
    // Keep all / Skip all act on what is still pending; "Undo" (pending) reopens what you decided.
    const ids =
      status === 'pending'
        ? Object.entries(y.videos)
            .filter(([id, v]) => v.channel === key && statusOf(y, s, id) !== 'pending')
            .map(([id]) => id)
        : pendingIds(y, s, (v) => v.channel === key);
    return { previous: decideMany(y, s, ids, status), previousRule };
  });
}
export async function setChannelRule(key: string, rule: 'keep' | 'skip' | null) {
  return update((y) => {
    const channel = y.channels[key];
    if (!channel) throw new Error('Channel not found. Refresh the page.');
    if (rule) channel.rule = rule;
    else delete channel.rule;
  });
}
// Sets several channels' rules at once (null asks each time). A new rule also
// decides the videos that arrived after your last decision on that channel,
// as it would have if it had existed then; older waiting videos stay yours.
export type ChannelRule = 'keep' | 'skip';
export async function setChannelRules(rules: Record<string, ChannelRule | null>) {
  return update((y, s) => {
    const previousRules: Record<string, ChannelRule | null> = {};
    let previous: Previous = {};
    for (const [key, rule] of Object.entries(rules)) {
      const channel = y.channels[key];
      if (!channel) throw new Error('Channel not found. Refresh the page.');
      if ((channel.rule ?? null) === rule) continue;
      previousRules[key] = channel.rule ?? null;
      if (rule) channel.rule = rule;
      else delete channel.rule;
      if (rule) {
        const ids = arrivedSinceDecided(y, s, key);
        previous = {
          ...previous,
          ...decideMany(y, s, ids, rule === 'keep' ? 'kept' : 'skipped', 'rule'),
        };
      }
    }
    return { previous, previousRules };
  });
}
// Pending videos of a channel first seen after your last decision on it.
function arrivedSinceDecided(y: YouTubeStore, s: MediaState, key: string) {
  let last = '';
  for (const v of Object.values(y.videos))
    if (v.channel === key && v.decidedAt && v.decidedAt > last) last = v.decidedAt;
  return last ? pendingIds(y, s, (v) => v.channel === key && v.firstSeenAt > last) : [];
}
export async function decideBucket(bucket: Bucket | 'oneOffs') {
  return update((y, s) => {
    const small = oneOffChannels(y);
    const match = (v: YouTubeVideo) =>
      bucket === 'oneOffs' ? small.has(v.channel) : inBucket(v, bucket);
    return { previous: decideMany(y, s, pendingIds(y, s, match), 'skipped') };
  });
}
export async function restore(previous: Previous, rules?: Record<string, 'keep' | 'skip' | null>) {
  return update((y, s) => {
    for (const [id, status] of Object.entries(previous))
      if (y.videos[id]) setStatus(y, s, id, status);
    for (const [key, rule] of Object.entries(rules || {}))
      if (y.channels[key]) {
        if (rule) y.channels[key].rule = rule;
        else delete y.channels[key].rule;
      }
  });
}
// Removing a kept video from the library skips it, so the next sync does not ask again.
export async function unkeep(videoId: string) {
  return update((y, s) => ({ previous: decideMany(y, s, [videoId], 'skipped') }));
}
export async function confirmAccount(confirm: boolean) {
  return withLock(() => {
    const y = readYouTube();
    if (!y.pendingAccount) throw new Error('There is no YouTube account waiting for confirmation.');
    if (confirm) y.account = y.pendingAccount;
    delete y.pendingAccount;
    writeYouTube(y);
    return y.account;
  });
}

// ---- views for the page ----
export type ChannelSort = 'videos' | 'hours' | 'recent';
export interface ChannelSummary {
  key: string;
  name: string;
  handle?: string;
  rule?: 'keep' | 'skip';
  total: number;
  pending: number;
  kept: number;
  skipped: number;
  watchedSec: number;
  lastWatchedDay: string;
  samples: string[];
}
export interface YouTubeSummary {
  account?: YouTubeAccount;
  pendingAccount?: YouTubeAccount;
  coverage?: YouTubeStore['coverage'];
  importing: boolean;
  lastSyncAt?: string;
  total: number;
  pending: number;
  kept: number;
  skipped: number;
  buckets: Record<Bucket, number>;
  channels: ChannelSummary[];
  oneOffs: { channels: number; videos: number; pending: number };
}
const ONE_OFF = 2;
// Channels with only one or two videos in your history, plus videos whose channel is unknown.
function oneOffChannels(y: YouTubeStore) {
  const sizes = new Map<string, number>();
  for (const v of Object.values(y.videos)) sizes.set(v.channel, (sizes.get(v.channel) || 0) + 1);
  return new Set(
    [...sizes].filter(([key, n]) => n <= ONE_OFF || key === UNKNOWN_CHANNEL).map(([key]) => key),
  );
}
export function summarize(
  y: YouTubeStore,
  s: MediaState,
  sort: ChannelSort = 'videos',
): YouTubeSummary {
  const byChannel = new Map<string, ChannelSummary>();
  const counts = { pending: 0, kept: 0, skipped: 0 };
  const buckets: Record<Bucket, number> = { barely: 0, live: 0 };
  const entries = Object.entries(y.videos).sort(([, a], [, b]) =>
    b.lastWatchedDay.localeCompare(a.lastWatchedDay),
  );
  for (const [id, v] of entries) {
    const status = statusOf(y, s, id);
    counts[status]++;
    if (status === 'pending')
      for (const b of ['barely', 'live'] as const) if (inBucket(v, b)) buckets[b]++;
    const c = y.channels[v.channel];
    let row = byChannel.get(v.channel);
    if (!row) {
      row = {
        key: v.channel,
        name: c?.name || 'Unknown channel',
        handle: c?.handle,
        rule: c?.rule,
        total: 0,
        pending: 0,
        kept: 0,
        skipped: 0,
        watchedSec: 0,
        lastWatchedDay: v.lastWatchedDay,
        samples: [],
      };
      byChannel.set(v.channel, row);
    }
    row.total++;
    row[status]++;
    row.watchedSec += Math.round((v.durationSec || 0) * (v.progress ?? 1));
    if (row.samples.length < 5 && status === 'pending') row.samples.push(id);
  }
  for (const [id, v] of entries) {
    const row = byChannel.get(v.channel)!;
    if (row.samples.length < 5 && !row.samples.includes(id)) row.samples.push(id);
  }
  const all = [...byChannel.values()];
  const big = all.filter((c) => c.total > ONE_OFF && c.key !== UNKNOWN_CHANNEL);
  const small = all.filter((c) => c.total <= ONE_OFF || c.key === UNKNOWN_CHANNEL);
  const order: Record<ChannelSort, (a: ChannelSummary, b: ChannelSummary) => number> = {
    videos: (a, b) => b.total - a.total || b.lastWatchedDay.localeCompare(a.lastWatchedDay),
    hours: (a, b) => b.watchedSec - a.watchedSec,
    recent: (a, b) => b.lastWatchedDay.localeCompare(a.lastWatchedDay),
  };
  return {
    account: y.account,
    pendingAccount: y.pendingAccount,
    coverage: y.coverage,
    importing: !!y.cursor,
    lastSyncAt: y.lastSyncAt,
    total: entries.length,
    ...counts,
    buckets,
    // Channels you have finished deciding sink below the ones still waiting.
    channels: big.sort((a, b) => Number(!a.pending) - Number(!b.pending) || order[sort](a, b)),
    oneOffs: {
      channels: small.length,
      videos: small.reduce((n, c) => n + c.total, 0),
      pending: small.reduce((n, c) => n + c.pending, 0),
    },
  };
}
export function summary(sort?: ChannelSort) {
  return summarize(readYouTube(), readState(), sort);
}

export interface VideoRow {
  id: string;
  title: string;
  channel: string;
  channelName: string;
  durationSec?: number;
  short?: boolean;
  live?: boolean;
  progress?: number;
  lastWatchedDay: string;
  status: VideoStatus;
  decidedBy?: 'you' | 'rule';
  thumbnail: string;
  url: string;
}
export type VideoFilter = { channel: string } | { bucket: Bucket } | { oneOffs: true };
export function listVideos(filter: VideoFilter, offset = 0, limit = 24) {
  const y = readYouTube(),
    s = readState();
  const small = oneOffChannels(y);
  const match = (id: string, v: YouTubeVideo) =>
    'channel' in filter
      ? v.channel === filter.channel
      : 'bucket' in filter
        ? statusOf(y, s, id) === 'pending' && inBucket(v, filter.bucket)
        : small.has(v.channel);
  const rows = Object.entries(y.videos)
    .filter(([id, v]) => match(id, v))
    // Pending first, then newest.
    .sort(
      ([ia, a], [ib, b]) =>
        Number(statusOf(y, s, ia) !== 'pending') - Number(statusOf(y, s, ib) !== 'pending') ||
        b.lastWatchedDay.localeCompare(a.lastWatchedDay),
    );
  return {
    total: rows.length,
    videos: rows.slice(offset, offset + limit).map(
      ([id, v]): VideoRow => ({
        id,
        title: v.title,
        channel: v.channel,
        channelName: y.channels[v.channel]?.name || 'Unknown channel',
        durationSec: v.durationSec,
        short: v.short,
        live: v.live,
        progress: v.progress,
        lastWatchedDay: v.lastWatchedDay,
        status: statusOf(y, s, id),
        decidedBy: v.decidedBy,
        thumbnail: thumbnailUrl(id),
        url: watchUrl(id, v.short),
      }),
    ),
  };
}

// Every channel you could want a rule for: the ones the page lists (more than a
// one-off) and any channel that already has a rule. Biggest first.
export interface ChannelRuleRow {
  key: string;
  name: string;
  handle?: string;
  rule?: ChannelRule;
  total: number;
  kept: number;
  skipped: number;
  pending: number;
  // Of the pending, how many arrived after your last decision on the channel.
  arrived: number;
}
export function channelRules(): ChannelRuleRow[] {
  const y = readYouTube(),
    s = readState();
  const rows = new Map<string, ChannelRuleRow>();
  const lastDecided = new Map<string, string>();
  for (const [id, v] of Object.entries(y.videos)) {
    if (v.channel === UNKNOWN_CHANNEL) continue;
    const c = y.channels[v.channel];
    let row = rows.get(v.channel);
    if (!row) {
      row = {
        key: v.channel,
        name: c?.name || 'Unknown channel',
        handle: c?.handle,
        rule: c?.rule,
        total: 0,
        kept: 0,
        skipped: 0,
        pending: 0,
        arrived: 0,
      };
      rows.set(v.channel, row);
    }
    row.total++;
    row[statusOf(y, s, id)]++;
    if (v.decidedAt && v.decidedAt > (lastDecided.get(v.channel) || ''))
      lastDecided.set(v.channel, v.decidedAt);
  }
  for (const [id, v] of Object.entries(y.videos)) {
    const row = rows.get(v.channel),
      last = lastDecided.get(v.channel);
    if (row && last && v.firstSeenAt > last && statusOf(y, s, id) === 'pending') row.arrived++;
  }
  return [...rows.values()]
    .filter((c) => c.total > ONE_OFF || c.rule)
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
}
