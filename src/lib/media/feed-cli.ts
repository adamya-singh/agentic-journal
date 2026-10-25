import fs from 'node:fs';
import { z } from 'zod';
import { readCompass } from './compass.ts';
import {
  addItems,
  editVocabulary,
  promote,
  readFeed,
  recordRun,
  summarize,
  type NewItem,
} from './feed-store.ts';
import { learned, weights } from './feed-rank.ts';
import { bookmarkByPost, judgeInput, poolIds, youtubePool } from './feed-pools.ts';
import { describeTag, trackOf, vocabularyOf, votedTrack, type CompassKind, type FeedItem, type FeedSource, type Lens } from './feed-types.ts';
import { readUnwind, tasteTarget } from './unwind-store.ts';

// `npm run media -- feed-*`: how OpenClaw (and you) curate the feed from a shell.
// Output is JSON on stdout like the other media commands.

export function digest(compass: CompassKind = 'long') {
  const f = readFeed();
  const all = Object.values(f.items);
  const w = weights(all, compass);
  const l = learned(w);
  const y = youtubePool();
  const upChannels = l.rising
    .filter((c) => !c.key.startsWith('x:') && c.key !== 'imdb')
    .map((c) => ({ ...c, channelId: y.channels[c.key]?.channelId, handle: y.channels[c.key]?.handle }));
  const s = summarize(f, compass);
  const long = readCompass('long'),
    short = readCompass('short');
  return {
    compasses: {
      long: { available: long.available, text: long.text, updatedAt: long.updatedAt },
      short: {
        available: short.available,
        title: short.title,
        periodId: short.periodId,
        version: short.version,
        forAgents: short.forAgents,
        text: short.text,
        period: short.period,
        relation: short.relation,
        updatedAt: short.updatedAt,
        source: short.source,
      },
    },
    vocabulary: f.vocabulary.map((t) => ({ tag: t, meaning: describeTag(t) })),
    // Run `feed-judge --compass short --scope items` when true (new period, or judging unfinished).
    shortNeedsJudging:
      short.available &&
      (f.shortJudged?.period !== short.periodId || s.judged.short < Math.min(s.judged.long, 400)),
    shortJudged: f.shortJudged,
    queue: s.counts.queue,
    counts: s.counts,
    judged: s.judged,
    learned: l,
    upChannels,
    avoid: {
      creators: l.sinking.filter((c) => c.net <= -2),
      tags: l.tags.filter((t) => t.w <= -0.3).map((t) => t.tag),
    },
    recentVotes: recentVotes(all, compass),
    lastRuns: f.curator.runs.slice(-5),
  };
}
function recentVotes(all: FeedItem[], lens: Lens) {
  return all
    .filter((i) => (i.state === 'up' || i.state === 'down') && votedTrack(i) === trackOf(lens))
    .sort((a, b) => (b.votedAt || '').localeCompare(a.votedAt || ''))
    .slice(0, 30)
    .map((i) => ({
      id: i.id,
      vote: i.state,
      title: i.title,
      creator: i.creator.name,
      tags: (i.alignment[lens] ?? i.alignment.long)?.tags,
      why: (i.alignment[lens] ?? i.alignment.long)?.why,
    }));
}

// Unwind's digest: your taste card, the clip queue, shows in progress and what nothing can play yet.
export function tasteDigest() {
  const f = readFeed();
  const all = Object.values(f.items);
  const l = learned(weights(all, 'taste'));
  const y = youtubePool();
  const s = summarize(f, 'taste');
  const u = readUnwind();
  const shows = Object.values(u.shows);
  return {
    taste: { ...u.taste, text: tasteTarget(u).text },
    tasteNeedsJudging: f.tasteJudged?.version !== u.taste.version || s.judged.taste < 100,
    tasteJudged: f.tasteJudged,
    vocabulary: vocabularyOf(f, 'taste').map((t) => ({ tag: t, meaning: describeTag(t) })),
    queue: s.counts.queue.taste,
    judged: s.judged.taste,
    learned: l,
    upChannels: l.rising
      .filter((c) => !c.key.startsWith('x:') && c.key !== 'imdb')
      .map((c) => ({ ...c, channelId: y.channels[c.key]?.channelId, handle: y.channels[c.key]?.handle })),
    avoid: {
      creators: l.sinking.filter((c) => c.net <= -2),
      tags: l.tags.filter((t) => t.w <= -0.3).map((t) => t.tag),
    },
    recentVotes: recentVotes(all, 'taste'),
    shows: {
      deck: shows.filter((x) => x.state === 'deck').length,
      watching: shows.filter((x) => x.state === 'watching').map((x) => ({ id: x.id, title: x.title, watched: x.watched.length })),
      finished: shows.filter((x) => x.state === 'finished').map((x) => x.title),
      dropped: shows.filter((x) => x.state === 'dropped').map((x) => x.title),
    },
    calibrated: u.calibrated,
    officialChannels: Object.values(u.officialChannels),
    lastRuns: f.curator.runs.slice(-5),
  };
}

// Pool items not in the feed and not yet rejected under this compass, liked creators first.
export function candidates(source: FeedSource, limit = 50, compass: Lens = 'long') {
  const f = readFeed();
  const w = weights(Object.values(f.items), compass);
  const y = youtubePool();
  const posts = bookmarkByPost();
  const recency = (id: string) =>
    id.startsWith('yt:')
      ? y.videos[id.slice(3)]?.lastWatchedDay || ''
      : id.startsWith('x:')
        ? String(1e9 + (posts.get(id.slice(2))?.savedRank ?? 0)).padStart(12, '0')
        : '';
  const creatorW = (id: string) => {
    const key = id.startsWith('yt:')
      ? y.videos[id.slice(3)]?.channel
      : id.startsWith('x:')
        ? `x:@${posts.get(id.slice(2))?.author.username.toLowerCase()}`
        : 'imdb';
    return (key && w.creators.get(key)?.w) || 0;
  };
  return poolIds(source)
    .filter((id) => !f.items[id] && !f.rejected[id]?.some((r) => r.compass === compass))
    .map((id) => ({ id, cw: creatorW(id), r: recency(id) }))
    .sort((a, b) => b.cw - a.cw || b.r.localeCompare(a.r))
    .slice(0, limit)
    .map((x) => judgeInput(x.id))
    .filter(Boolean);
}

const AlignmentIn = z.object({
  confidence: z.number().min(0).max(1),
  tags: z.array(z.string().min(1).max(40)).max(4),
  why: z.string().min(3).max(300),
  judgedBy: z.string().max(60).default('openclaw'),
  fun: z.number().min(0).max(1).optional(),
  fit: z.number().min(0).max(1).optional(),
});
const ItemIn = z
  .object({
    id: z.string().optional(),
    url: z.string().url().optional(),
    title: z.string().max(300).optional(),
    creator: z.object({ key: z.string(), name: z.string(), handle: z.string().optional() }).optional(),
    publishedAt: z.string().optional(),
    durationSec: z.number().int().positive().optional(),
    channelId: z.string().optional(),
    state: z.enum(['new', 'candidate']).optional(),
    alignment: z
      .object({ long: AlignmentIn.optional(), short: AlignmentIn.optional(), taste: AlignmentIn.optional() })
      .refine((a) => a.long || a.short || a.taste, 'Give an alignment for at least one compass or taste.'),
  })
  .refine((i) => i.id || i.url, 'Each item needs an id or a url.');
const FileIn = z.union([z.array(ItemIn), z.object({ items: z.array(ItemIn) })]);

export async function addFromFile(file: string, by = 'openclaw') {
  const parsed = FileIn.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
  const items = (Array.isArray(parsed) ? parsed : parsed.items) as NewItem[];
  if (items.length > 100) throw new Error('Add at most 100 items per call.');
  return addItems(items, by);
}

type Args = Record<string, string | true>;
export function parseArgs(args: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
    else {
      out[a.slice(2)] = next;
      i++;
    }
  }
  return out;
}
const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
const list = (a: Args, k: string) => str(a, k)?.split(',').map((s) => s.trim()).filter(Boolean) || [];
const compassOf = (a: Args): Lens =>
  str(a, 'track') === 'unwind' ? 'taste' : z.enum(['long', 'short', 'taste']).catch('long').parse(str(a, 'compass'));

export async function feedCommand(command: string, rest: string[]): Promise<unknown> {
  const a = parseArgs(rest);
  switch (command) {
    case 'feed-digest': {
      const lens = compassOf(a);
      return lens === 'taste' ? tasteDigest() : digest(lens);
    }
    case 'feed-stats':
      return summarize(readFeed(), compassOf(a));
    case 'feed-candidates':
      return candidates(
        z.enum(['youtube', 'x', 'imdb']).parse(str(a, 'source') || 'youtube'),
        Math.min(Number(str(a, 'limit') || 50), 200),
        compassOf(a),
      );
    case 'feed-add': {
      const file = str(a, 'file');
      if (!file) throw new Error('Usage: feed-add --file items.json [--by openclaw]');
      return addFromFile(file, str(a, 'by') || 'openclaw');
    }
    case 'feed-promote':
      return promote(
        {
          ids: list(a, 'ids').length ? list(a, 'ids') : undefined,
          tag: str(a, 'tag'),
          creator: str(a, 'creator'),
          limit: Number(str(a, 'limit') || 20),
        },
        compassOf(a),
      );
    case 'feed-vocab':
      return editVocabulary(list(a, 'add'), list(a, 'remove'));
    case 'feed-run':
      await recordRun({
        by: str(a, 'by') || 'openclaw',
        added: Number(str(a, 'added') || 0),
        promoted: Number(str(a, 'promoted') || 0),
        note: str(a, 'note')?.slice(0, 500),
      });
      return { recorded: true };
    case 'feed-judge': {
      const { judgeFeed } = await import('./feed-judge-run.ts');
      return judgeFeed({
        compass: compassOf(a),
        scope: z.enum(['items', 'candidates']).catch('items').parse(str(a, 'scope')),
        source: str(a, 'source') as FeedSource | undefined,
        limit: Number(str(a, 'limit') || 200),
      });
    }
  }
  return undefined;
}
export const FEED_USAGE =
  'feed-digest [--compass long|short|taste] [--track unwind] | feed-stats | feed-candidates --source youtube|x|imdb [--limit N] | feed-add --file items.json [--by openclaw] | feed-promote --ids a,b|--tag T|--creator K [--limit N] | feed-judge --compass long|short|taste [--scope items|candidates] [--source S] [--limit N] | feed-vocab --add a,b --remove c | feed-run --added N --promoted N --note "..."';
