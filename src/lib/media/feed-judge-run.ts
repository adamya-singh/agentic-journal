import { readCompass } from './compass.ts';
import { judgeBatch, judgedBy, type Verdict } from './feed-judge.ts';
import { judgeInput, type JudgeInput } from './feed-pools.ts';
import { addTo, readFeed, rejectIn, withFeed } from './feed-store.ts';
import { candidates } from './feed-cli.ts';
import type { CompassKind, FeedSource, FeedState } from './feed-types.ts';

// Judges feed items (or new pool candidates) against one compass with Gemini.
// The main use: when a new short-term compass period starts, re-judge the feed under it.
export async function judgeFeed(o: {
  compass: CompassKind;
  scope: 'items' | 'candidates';
  source?: FeedSource;
  limit: number;
}) {
  const compass = readCompass(o.compass);
  if (!compass.available) throw new Error(`There is no ${o.compass}-term compass to judge against.`);
  // A new short-term period: last period's judgments no longer apply.
  const period = compass.periodId;
  let wiped = 0;
  if (o.compass === 'short' && period)
    wiped = await withFeed((feed) => (feed.shortJudged?.period === period ? 0 : wipeShort(feed)));
  const f = readFeed();
  const inputs: JudgeInput[] =
    o.scope === 'items'
      ? Object.values(f.items)
          .filter(
            (i) =>
              !i.alignment[o.compass] &&
              (!o.source || i.source === o.source) &&
              !f.rejected[i.id]?.some((r) => r.compass === o.compass),
          )
          // Things you liked first: they matter most under any compass.
          .sort((a, b) => Number(b.state === 'up') - Number(a.state === 'up'))
          .slice(0, o.limit)
          .map((i) => judgeInput(i.id))
          .filter((x): x is JudgeInput => !!x)
      : (candidates(o.source || 'youtube', o.limit, o.compass) as JudgeInput[]);
  const verdicts: Verdict[] = [];
  for (let i = 0; i < inputs.length; i += 40)
    verdicts.push(...(await judgeBatch(compass, f.vocabulary, inputs.slice(i, i + 40))));
  return withFeed((feed) => {
    const aligned = verdicts.filter((v) => v.aligned);
    const res = addTo(
      feed,
      aligned.map((v) => ({
        id: v.id,
        state: 'candidate' as const,
        alignment: { [o.compass]: { confidence: v.confidence, tags: v.tags, why: v.why, judgedBy: judgedBy(o.compass) } },
      })),
      'openclaw',
    );
    rejectIn(feed, verdicts.filter((v) => !v.aligned).map((v) => v.id), o.compass);
    feed.vocabulary = [...new Set([...feed.vocabulary, ...res.unknownTags])];
    if (o.compass === 'short' && period)
      feed.shortJudged = { period, version: compass.version, at: new Date().toISOString() };
    return {
      period,
      wiped,
      judged: verdicts.length,
      aligned: aligned.length,
      added: res.added.length,
      updated: res.updated.length,
      rejected: verdicts.length - aligned.length,
    };
  });
}

// Drops every short-term judgment and rejection; returns how many items had one.
export function wipeShort(feed: FeedState) {
  let n = 0;
  for (const item of Object.values(feed.items))
    if (item.alignment.short) {
      delete item.alignment.short;
      n++;
    }
  for (const [id, list] of Object.entries(feed.rejected)) {
    const keep = list.filter((r) => r.compass !== 'short');
    if (keep.length) feed.rejected[id] = keep;
    else delete feed.rejected[id];
  }
  delete feed.shortJudged;
  return n;
}
