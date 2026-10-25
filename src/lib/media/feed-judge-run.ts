import { readCompass } from './compass.ts';
import { alignmentOf, judgeBatch, type JudgeTarget, type Verdict } from './feed-judge.ts';
import { describe, judgeInput, type JudgeInput } from './feed-pools.ts';
import { addTo, readFeed, rejectIn, withFeed } from './feed-store.ts';
import { candidates } from './feed-cli.ts';
import { vocabularyOf, type FeedSource, type FeedState, type Lens } from './feed-types.ts';
import { neverMatch, readUnwind, tasteTarget, type TasteCard } from './unwind-store.ts';

// Judges feed items (or new pool candidates) against one lens with Gemini.
// The main uses: when a new short-term compass period starts, re-judge the feed
// under it; and stock Unwind by judging your pools against your taste card.
export async function judgeFeed(o: {
  compass: Lens;
  scope: 'items' | 'candidates';
  source?: FeedSource;
  limit: number;
}) {
  let target: JudgeTarget;
  let period: string | undefined;
  if (o.compass === 'taste') target = tasteTarget();
  else {
    const compass = readCompass(o.compass);
    if (!compass.available) throw new Error(`There is no ${o.compass}-term compass to judge against.`);
    target = compass;
    // A new short-term period: last period's judgments no longer apply.
    period = compass.periodId;
  }
  let wiped = 0;
  if (o.compass === 'short' && period)
    wiped = await withFeed((feed) => (feed.shortJudged?.period === period ? 0 : wipeShort(feed)));
  const f = readFeed();
  let inputs: JudgeInput[] =
    o.scope === 'items'
      ? Object.values(f.items)
          .filter(
            (i) =>
              !i.alignment[o.compass] &&
              (!o.source || i.source === o.source) &&
              !f.rejected[i.id]?.some((r) => r.compass === o.compass),
          )
          // Things you liked first, then what is in your queue, then the reserve.
          .sort((a, b) => rankForJudging(a.state) - rankForJudging(b.state))
          .slice(0, o.limit)
          .map((i) => judgeInput(i.id))
          .filter((x): x is JudgeInput => !!x)
      : (candidates(o.source || 'youtube', o.limit, o.compass) as JudgeInput[]);
  // Your Never list rules things out before the model sees them.
  let ruledOut: string[] = [];
  if (o.compass === 'taste') {
    const card = readUnwind().taste;
    ruledOut = inputs.filter((i) => tasteRuledOut(card, i.id)).map((i) => i.id);
    inputs = inputs.filter((i) => !ruledOut.includes(i.id));
  }
  const vocabulary = vocabularyOf(f, o.compass);
  const verdicts: Verdict[] = [];
  for (let i = 0; i < inputs.length; i += 40)
    verdicts.push(...(await judgeBatch(target, vocabulary, inputs.slice(i, i + 40))));
  return withFeed((feed) => {
    const aligned = verdicts.filter((v) => v.aligned);
    const res = addTo(
      feed,
      aligned.map((v) => ({ id: v.id, state: 'candidate' as const, alignment: { [o.compass]: alignmentOf(v, o.compass) } })),
      'openclaw',
    );
    rejectIn(feed, [...ruledOut, ...verdicts.filter((v) => !v.aligned).map((v) => v.id)], o.compass);
    if (o.compass === 'taste') {
      feed.tasteVocabulary = [...new Set([...vocabularyOf(feed, 'taste'), ...res.unknownTags])];
      feed.tasteJudged = { version: target.kind === 'taste' ? target.version : 0, at: new Date().toISOString() };
    } else feed.vocabulary = [...new Set([...feed.vocabulary, ...res.unknownTags])];
    if (o.compass === 'short' && period && target.kind === 'short')
      feed.shortJudged = { period, version: target.version, at: new Date().toISOString() };
    return {
      period,
      wiped,
      judged: verdicts.length,
      aligned: aligned.length,
      added: res.added.length,
      updated: res.updated.length,
      rejected: verdicts.length - aligned.length + ruledOut.length,
      ruledOut: ruledOut.length,
    };
  });
}

// Channels with a home of their own on the Media page never enter Unwind's feed.
const ELSEWHERE = new Set(['@tbpnlive']);
// Matches a pool item against the Never list by its creator and title.
export function tasteRuledOut(card: TasteCard, id: string) {
  const d = describe(id);
  if (!d) return undefined;
  if (ELSEWHERE.has(d.creator.key)) return 'Has its own page';
  return neverMatch(card, { creator: d.creator.key, title: d.title });
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

const rankForJudging = (state: string) =>
  state === 'up' ? 0 : state === 'new' || state === 'seen' ? 1 : state === 'candidate' ? 2 : 3;
