// Seed pass for /media/feed: judges every item in your YouTube history, X
// bookmarks and unwatched IMDb picks against a compass, then fills the feed.
//
//   npm run feed:seed -- judge [--compass long|short|taste] [--limit N] [--concurrency 4]
//   npm run feed:seed -- report
//   npm run feed:seed -- write [--target 400] [--dry-run]
//
// Verdicts are checkpointed in media/feed-seed-<compass>.json, so `judge` resumes.
// `--compass taste` stocks Unwind from YouTube and X against your taste card
// (films and series go to Unwind's shows, not the feed).
import fs from 'node:fs';
import path from 'node:path';
import { mediaRoot } from '../src/lib/media/store.ts';
import { readCompass } from '../src/lib/media/compass.ts';
import { judgeInput, poolIds, youtubePool, imdbPool, type JudgeInput } from '../src/lib/media/feed-pools.ts';
import { alignmentOf, judgeBatch, type JudgeTarget, type Verdict } from '../src/lib/media/feed-judge.ts';
import { DEFAULT_VOCABULARY, LENSES, UNWIND_VOCABULARY, type FeedSource, type Lens } from '../src/lib/media/feed-types.ts';
import { readUnwind, tasteTarget } from '../src/lib/media/unwind-store.ts';
import { tasteRuledOut } from '../src/lib/media/feed-judge-run.ts';
import { addTo, readFeed, rejectIn, writeFeed, type NewItem } from '../src/lib/media/feed-store.ts';
import { withLock } from '../src/lib/media/store.ts';

const [command = 'report', ...rest] = process.argv.slice(2);
const opt = (name: string, fallback?: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : fallback;
};
const flag = (name: string) => rest.includes(`--${name}`);
const compassKind = opt('compass', 'long') as Lens;
if (!LENSES.includes(compassKind)) throw new Error(`--compass must be one of ${LENSES.join(', ')}`);
const taste = compassKind === 'taste';
const checkpoint = path.join(mediaRoot(), `feed-seed-${compassKind}.json`);
type Store = Record<string, Verdict & { source: FeedSource }>;
const load = (): Store => {
  try {
    return JSON.parse(fs.readFileSync(checkpoint, 'utf8'));
  } catch {
    return {};
  }
};
const save = (s: Store) => {
  const tmp = `${checkpoint}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
  fs.renameSync(tmp, checkpoint);
};

// Cheap rules before the model: sound effects and other clips under 20 s, and IMDb titles you've seen.
function worthJudging(id: string) {
  if (taste && (/^tt/.test(id) || tasteRuledOut(readUnwind().taste, id))) return false;
  if (id.startsWith('yt:')) {
    const v = youtubePool().videos[id.slice(3)];
    return !(v?.durationSec !== undefined && v.durationSec < 20);
  }
  if (/^tt/.test(id)) return !imdbPool().titles[id]?.watched;
  return true;
}

async function judge() {
  let compass: JudgeTarget;
  if (taste) compass = tasteTarget();
  else {
    const c = readCompass(compassKind as 'long' | 'short');
    if (!c.available) throw new Error(`No ${compassKind}-term compass to judge against.`);
    compass = c;
  }
  const done = load();
  const limit = Number(opt('limit', '0')) || Infinity;
  const todo = poolIds()
    .filter((id) => !done[id] && worthJudging(id))
    .slice(0, limit)
    .map(judgeInput)
    .filter((x): x is JudgeInput => !!x);
  const batches: JudgeInput[][] = [];
  for (let i = 0; i < todo.length; i += 40) batches.push(todo.slice(i, i + 40));
  console.log(`judging ${todo.length} items in ${batches.length} batches (${Object.keys(done).length} already done)`);
  const vocab = Object.keys(taste ? UNWIND_VOCABULARY : DEFAULT_VOCABULARY);
  let next = 0,
    finished = 0,
    failed = 0;
  const worker = async () => {
    while (next < batches.length) {
      const batch = batches[next++];
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const verdicts = await judgeBatch(compass, vocab, batch);
          for (const v of verdicts) done[v.id] = { ...v, source: batch.find((b) => b.id === v.id)!.source };
          save(done);
          break;
        } catch (e) {
          if (attempt === 3) {
            failed++;
            console.error(`batch failed: ${(e as Error).message.slice(0, 200)}`);
          } else await new Promise((r) => setTimeout(r, 5000 * attempt));
        }
      }
      finished++;
      if (finished % 10 === 0 || finished === batches.length)
        console.log(`${finished}/${batches.length} batches, ${Object.keys(done).length} judged`);
    }
  };
  await Promise.all(Array.from({ length: Number(opt('concurrency', '4')) }, worker));
  console.log(`done: ${Object.keys(done).length} judged, ${failed} batches failed (rerun to retry)`);
}

// Picks the strongest items with source quotas and a per-creator cap.
export function select(store: Store, target: number) {
  const aligned = Object.values(store)
    .filter((v) => v.aligned)
    .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
  const creatorOf = (id: string) => {
    if (id.startsWith('yt:')) return youtubePool().videos[id.slice(3)]?.channel || id;
    return id.startsWith('x:') ? `x:${judgeInput(id)?.creator}` : 'imdb';
  };
  const quota: Record<FeedSource, number> = {
    x: Math.round(target * (taste ? 0.25 : 0.35)),
    imdb: taste ? 0 : Math.round(target * 0.06),
    youtube: target,
  };
  const cap: Record<FeedSource, number> = { youtube: 12, x: 4, imdb: 99 };
  const perCreator = new Map<string, number>();
  const picked = new Set<string>();
  const take = (source: FeedSource, max: number, floor: number) => {
    let n = 0;
    for (const v of aligned) {
      if (picked.size >= target || n >= max) break;
      if (v.source !== source || v.confidence < floor || picked.has(v.id)) continue;
      const c = creatorOf(v.id);
      if ((perCreator.get(c) || 0) >= cap[source]) continue;
      perCreator.set(c, (perCreator.get(c) || 0) + 1);
      picked.add(v.id);
      n++;
    }
  };
  take('x', quota.x, 0.65);
  take('imdb', quota.imdb, 0.6);
  take('youtube', target - picked.size, 0.65);
  return { aligned, picked };
}

function report() {
  const store = load();
  const all = Object.values(store);
  const by = (s: FeedSource) => all.filter((v) => v.source === s);
  console.log(`judged ${all.length}; aligned ${all.filter((v) => v.aligned).length}`);
  for (const s of ['youtube', 'x', 'imdb'] as FeedSource[]) {
    const list = by(s);
    const al = list.filter((v) => v.aligned);
    const hist = [0.9, 0.8, 0.7, 0.6, 0.45].map((t) => `≥${t}: ${al.filter((v) => v.confidence >= t).length}`);
    console.log(`${s}: ${list.length} judged, ${al.length} aligned (${hist.join(', ')})`);
  }
  const tags = new Map<string, number>();
  for (const v of all.filter((v) => v.aligned)) for (const t of v.tags) tags.set(t, (tags.get(t) || 0) + 1);
  console.log('tags:', [...tags].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${n}`).join(', '));
  const { picked } = select(store, Number(opt('target', taste ? '150' : '400')));
  const p = [...picked].map((id) => store[id]);
  console.log(`would seed ${p.length}: ` + (['youtube', 'x', 'imdb'] as FeedSource[]).map((s) => `${s} ${p.filter((v) => v.source === s).length}`).join(', '));
}

async function write() {
  const store = load();
  const target = Number(opt('target', taste ? '150' : '400'));
  const { aligned, picked } = select(store, target);
  const items: NewItem[] = aligned.map((v) => ({
    id: v.id,
    state: picked.has(v.id) ? 'new' : 'candidate',
    alignment: { [compassKind]: alignmentOf(v, compassKind) },
  }));
  const notAligned = Object.values(store).filter((v) => !v.aligned).map((v) => v.id);
  if (flag('dry-run')) {
    console.log(`dry run: ${picked.size} new, ${items.length - picked.size} candidates, ${notAligned.length} rejected`);
    return;
  }
  await withLock(() => {
    const f = readFeed();
    const res = addTo(f, items, 'claude:seed');
    rejectIn(f, notAligned, compassKind);
    // New tags the judge coined join the vocabulary so OpenClaw keeps using them.
    // Unwind's vocabulary stays curated: one-off tags the judge coins stay on their items only.
    if (taste) {
      f.tasteJudged = { version: readUnwind().taste.version, at: new Date().toISOString() };
    } else f.vocabulary = [...new Set([...f.vocabulary, ...res.unknownTags])];
    f.curator.runs.push({
      at: new Date().toISOString(),
      by: 'claude:seed',
      added: res.added.length,
      promoted: 0,
      note: `Seed pass against ${taste ? 'your taste card' : `the ${compassKind}-term compass`}: ${picked.size} in the queue, ${res.added.length - picked.size} held as candidates.`,
    });
    writeFeed(f);
    console.log(JSON.stringify({ added: res.added.length, updated: res.updated.length, duplicates: res.duplicates.length, unknown: res.unknown.length, newTags: res.unknownTags }));
  }, 'feed');
}

try {
  if (command === 'judge') await judge();
  else if (command === 'report') report();
  else if (command === 'write') await write();
  else throw new Error('Usage: feed-seed.ts judge|report|write');
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}
