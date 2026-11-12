import { normTitle } from './library.ts';
import { page, parseSearch, parseWatch, type SearchHit } from './youtube-page.ts';
import {
  addSource,
  FILM,
  keysOf,
  proposeChannel,
  readUnwind,
  runtimeOf,
  type Show,
} from './unwind-store.ts';

// Full episodes and films that studios post on YouTube themselves (TVF puts
// whole seasons up), found by search and kept only when they come from a
// channel you have approved. They play in the Journal's own YouTube player.

export interface SourceFetchers {
  search: (q: string) => Promise<string>;
  watch: (videoId: string) => Promise<string>;
}
const youtube: SourceFetchers = {
  search: (q) => page(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`),
  watch: (id) => page(`https://www.youtube.com/watch?v=${id}`),
};

// "S01 E03", "S1E3", "1x03", "Season 1 Episode 3", or "Episode 3" / "Ep 3" when the show has one season.
export function titleHasEpisode(title: string, key: string, singleSeason: boolean) {
  const m = key.match(/^S(\d+)E(\d+)$/);
  if (!m) return false;
  const [s, e] = [Number(m[1]), Number(m[2])];
  const t = title.toLowerCase();
  const found: [number, number][] = [];
  for (const x of t.matchAll(/\bs(\d{1,2})\s*[|:.-]?\s*e(?:p(?:isode)?)?\s*(\d{1,3})\b/g)) found.push([Number(x[1]), Number(x[2])]);
  for (const x of t.matchAll(/\b(\d{1,2})x(\d{2,3})\b/g)) found.push([Number(x[1]), Number(x[2])]);
  for (const x of t.matchAll(/season\s*(\d{1,2})\D{0,12}?episode\s*(\d{1,3})\b/g)) found.push([Number(x[1]), Number(x[2])]);
  if (found.length) return found.some(([a, b]) => a === s && b === e);
  if (!singleSeason || s !== 1) return false;
  return [...t.matchAll(/\b(?:episode|ep)\s*\.?\s*(\d{1,3})\b/g)].some((x) => Number(x[1]) === e);
}
const longEnough = (durationSec: number | undefined, minutes: number | undefined, film: boolean) =>
  !!durationSec && durationSec >= (minutes ? minutes * 60 * 0.6 : film ? 70 * 60 : 15 * 60);
const namesShow = (title: string, show: Show) => normTitle(title).includes(normTitle(show.title).replace(/^tvf/, ''));

// Checks a candidate the way a person would: whose channel, which episode, how long.
export function judgeHit(show: Show, key: string, hit: Pick<SearchHit, 'title' | 'channelId' | 'durationSec'>) {
  const film = key === FILM;
  const seasons = new Set((show.episodes || []).map((e) => e.season));
  if (!namesShow(hit.title, show)) return 'names another title';
  if (!film && !titleHasEpisode(hit.title, key, seasons.size <= 1)) return 'a different episode';
  if (film && /trailer|teaser|scene|clip|review|reaction|explained/i.test(hit.title)) return 'not the film itself';
  if (!longEnough(hit.durationSec, runtimeOf(show, key), film)) return 'too short to be the whole thing';
  return undefined;
}

// You (or OpenClaw) point at a video. Yours vouches for its channel; OpenClaw's
// only counts once you approve the channel.
export async function addYouTubeSource(showId: string, key: string, videoId: string, by: string, f: SourceFetchers = youtube) {
  const show = readUnwind().shows[showId];
  if (!show) throw new Error('That title is not in Unwind.');
  const facts = parseWatch(await f.watch(videoId));
  if (!facts) throw new Error('That YouTube video could not be read.');
  const problem = judgeHit(show, key, facts);
  if (problem && by !== 'you') throw new Error(`Not added: ${problem}.`);
  const channel = readUnwind().officialChannels[facts.channelId];
  if (!channel?.approved) {
    await proposeChannel({ channelId: facts.channelId, name: facts.channel }, by, by === 'you');
    if (by !== 'you') return { added: false, awaitingChannel: facts.channel };
  }
  await addSource(showId, key, {
    kind: 'youtube',
    videoId,
    channelId: facts.channelId,
    channel: facts.channel,
    durationSec: facts.durationSec,
    addedBy: by,
    addedAt: new Date().toISOString(),
  });
  return { added: true, channel: facts.channel };
}

// Searches for the next few episodes that nothing can play yet.
export async function findSources(showId: string, o: { episodes?: number; by?: string } = {}, f: SourceFetchers = youtube) {
  const u = readUnwind();
  const show = u.shows[showId];
  if (!show) throw new Error('That title is not in Unwind.');
  const keys = keysOf(show)
    .filter((k) => !show.watched.includes(k) && !(show.sources[k] || []).length)
    .slice(0, o.episodes ?? 3);
  const res = { searched: keys, added: [] as { key: string; videoId: string; channel: string }[], proposed: [] as string[], none: [] as string[] };
  for (const key of keys) {
    const m = key.match(/^S(\d+)E(\d+)$/);
    const q =
      key === FILM
        ? `${show.title} ${show.year?.slice(0, 4) || ''} full movie`
        : `${show.title} S${String(m![1]).padStart(2, '0')}E${String(m![2]).padStart(2, '0')}`;
    const hits = parseSearch(await f.search(q)).slice(0, 15).filter((h) => h.channelId && !judgeHit(show, key, h));
    const official = hits.find((h) => readUnwind().officialChannels[h.channelId!]?.approved);
    if (official) {
      await addSource(showId, key, {
        kind: 'youtube',
        videoId: official.videoId,
        channelId: official.channelId!,
        channel: official.channel,
        durationSec: official.durationSec,
        addedBy: o.by || 'openclaw',
        addedAt: new Date().toISOString(),
      });
      res.added.push({ key, videoId: official.videoId, channel: official.channel });
      continue;
    }
    // A verified channel with the right upload is worth asking you about.
    const verified = hits.find((h) => h.verified);
    if (verified && !readUnwind().officialChannels[verified.channelId!]) {
      await proposeChannel({ channelId: verified.channelId!, name: verified.channel }, o.by || 'openclaw');
      res.proposed.push(verified.channel);
    }
    res.none.push(key);
  }
  return res;
}
