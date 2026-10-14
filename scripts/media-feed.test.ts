import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { initialState, writeState } from '../src/lib/media/store.ts';
import { initialYouTube, writeYouTube } from '../src/lib/media/youtube-store.ts';
import {
  addTo,
  idFromUrl,
  initialFeed,
  markSeen,
  page,
  readFeed,
  refill,
  rejectIn,
  skip,
  vote,
  writeFeed,
} from '../src/lib/media/feed-store.ts';
import { explain, order, score, weights } from '../src/lib/media/feed-rank.ts';
import { frontMatter, parseShortTerm, readCompass, section } from '../src/lib/media/compass.ts';
import { judgePrompt } from '../src/lib/media/feed-judge.ts';
import { digest } from '../src/lib/media/feed-cli.ts';
import { GET, POST } from '../src/app/api/media/[[...path]]/route.ts';
import type { FeedItem } from '../src/lib/media/feed-types.ts';

let dir: string;
const saved: Record<string, string | undefined> = {};
const ENV = ['BACKEND_DATA_DIR', 'OPENCLAW_WORKSPACE_DIR', 'OPENCLAW_COMPASS_DIR'];
const vid = (n: number) => `vid${String(n).padStart(8, '0')}`; // 11 chars
beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-feed-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  process.env.OPENCLAW_WORKSPACE_DIR = path.join(dir, 'ws');
  delete process.env.OPENCLAW_COMPASS_DIR;
  fs.mkdirSync(path.join(dir, 'ws'));
  fs.writeFileSync(
    path.join(dir, 'ws', 'USER.md'),
    '# USER\n\n- **Core North Star (Canonical):** "Be a primary architect of the AI future."\n- **Scoreboard:** depth plus traction.\n\n---\n\nOther stuff\n',
  );
  fs.writeFileSync(path.join(dir, 'ws', 'MEMORY.md'), '## North Star Anchor\n- Anti-Drift Rule: no fragmentation.\n\n## Other\nx\n');
  const y = initialYouTube();
  for (let n = 0; n < 6; n++) {
    y.videos[vid(n)] = {
      title: `Video ${n}`,
      channel: n < 3 ? '@karpathy' : '@other',
      durationSec: 600,
      lastWatchedDay: '2026-10-01',
      firstSeenAt: '2026-10-01T00:00:00Z',
      status: 'pending',
    };
  }
  y.channels['@karpathy'] = { name: 'Andrej Karpathy', handle: '@karpathy', channelId: 'UCk' };
  y.channels['@other'] = { name: 'Other', handle: '@other' };
  writeYouTube(y);
  const s = initialState();
  s.titles.tt1 = { id: 'tt1', title: '12th Fail', url: 'https://www.imdb.com/title/tt1/', collections: [], genres: ['Drama', 'Browse movies by genre'] };
  writeState(s);
  fs.mkdirSync(path.join(dir, 'bookmarks'));
  fs.writeFileSync(
    path.join(dir, 'bookmarks', 'sources.json'),
    JSON.stringify({
      'acct:123': {
        id: '123', accountId: 'acct', text: 'Guard your attention like capital. https://t.co/abc', url: 'https://x.com/i/status/123',
        importedAt: '2026-10-01T00:00:00Z', author: { id: '1', name: 'Saila', username: 'sailaunderscore' }, media: [], links: [],
      },
    }),
  );
  fs.writeFileSync(
    path.join(dir, 'bookmarks', 'folders.json'),
    JSON.stringify({ folders: [{ id: 'f1', name: 'Good advice' }], membership: { '123': ['f1'] } }),
  );
});
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});
const al = (confidence: number, tags: string[] = ['ML fundamentals']) => ({
  long: { confidence, tags, why: 'Builds fundamentals.', judgedBy: 'test' },
});
function seed(n = 6) {
  const f = initialFeed();
  const res = addTo(
    f,
    [
      ...Array.from({ length: n }, (_, i) => ({ id: `yt:${vid(i)}`, alignment: al(0.9 - i * 0.05, i < 3 ? ['ML fundamentals'] : ['tech news']) })),
      { id: 'x:123', alignment: al(0.8, ['good advice']) },
      { id: 'tt1', alignment: al(0.7, ['stories of persistence']) },
    ],
    'test',
  );
  writeFeed(f);
  return res;
}
const req = (p: string, body?: unknown) =>
  new NextRequest(`http://127.0.0.1:3000/api/media/${p}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { origin: 'http://127.0.0.1:3000', 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

test('items are hydrated from the pools; unknown X posts and IMDb titles are refused', () => {
  const f = initialFeed();
  const res = addTo(
    f,
    [
      { id: `yt:${vid(0)}`, alignment: al(0.9) },
      { url: 'https://x.com/someone/status/999', alignment: al(0.9) },
      { id: 'tt999', alignment: al(0.9) },
      { url: 'https://youtu.be/AAAAAAAAAAA', title: 'New upload', creator: { key: '@new', name: 'New' }, alignment: al(0.8) },
      { url: 'https://example.com/video', alignment: al(0.9) },
    ],
    'openclaw',
  );
  assert.deepEqual(res.added, [`yt:${vid(0)}`, 'yt:AAAAAAAAAAA']);
  assert.equal(res.unknown.length, 3);
  assert.equal(f.items[`yt:${vid(0)}`].creator.name, 'Andrej Karpathy');
  assert.equal(f.items[`yt:${vid(0)}`].title, 'Video 0');
  // A second judgment under the same compass is a duplicate; a new compass merges in.
  const again = addTo(f, [{ id: `yt:${vid(0)}`, alignment: { short: { confidence: 0.6, tags: [], why: 'Short-term fit.', judgedBy: 't' } } }], 'x');
  assert.deepEqual(again.updated, [`yt:${vid(0)}`]);
  assert.ok(f.items[`yt:${vid(0)}`].alignment.short);
});

test('ids come from YouTube, X and IMDb links', () => {
  assert.equal(idFromUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3'), 'yt:dQw4w9WgXcQ');
  assert.equal(idFromUrl('https://youtube.com/shorts/dQw4w9WgXcQ'), 'yt:dQw4w9WgXcQ');
  assert.equal(idFromUrl('https://twitter.com/a/status/42?s=20'), 'x:42');
  assert.equal(idFromUrl('https://m.imdb.com/title/tt0111161/'), 'tt0111161');
  assert.equal(idFromUrl('https://example.com'), undefined);
});

test('votes move tag, creator and source weights, and the order follows them', () => {
  seed();
  const f = readFeed();
  const all = Object.values(f.items);
  const before = order(all, 'long', weights(all));
  assert.equal(before[0].id, `yt:${vid(0)}`);
  // Down-vote Karpathy twice and up-vote the "tech news" channel twice.
  for (const i of [0, 1]) f.items[`yt:${vid(i)}`].state = 'down';
  for (const i of [3, 4]) f.items[`yt:${vid(i)}`].state = 'up';
  const w = weights(Object.values(f.items));
  assert.ok(w.tags.get('tech news')!.w > 0 && w.tags.get('ML fundamentals')!.w < 0);
  assert.ok(score(f.items[`yt:${vid(5)}`], 'long', w) > score(f.items[`yt:${vid(2)}`], 'long', w));
  assert.match(explain(f.items[`yt:${vid(5)}`], 'long', w)!, /up-voted 2 of 2 tagged tech news/);
  // Not judged under the short-term compass: not eligible there.
  assert.equal(score(f.items[`yt:${vid(5)}`], 'short', w), -Infinity);
});

test('the order never puts one creator twice in a row while others remain', () => {
  seed();
  const all = Object.values(readFeed().items);
  const o = order(all, 'long', weights(all));
  for (let i = 1; i < o.length - 1; i++) assert.notEqual(o[i].creator.key, o[i - 1].creator.key);
});

test('pages exclude what the page already shows; voted lists page by offset', async () => {
  seed();
  const first = page({ compass: 'long', filter: 'queue', limit: 3 });
  assert.equal(first.items.length, 3);
  const second = page({ compass: 'long', filter: 'queue', limit: 3, exclude: first.items.map((i) => i.id) });
  assert.ok(second.items.every((i) => !first.items.some((j) => j.id === i.id)));
  const x = page({ compass: 'long', filter: 'queue', source: 'x' }).items[0];
  assert.equal(x.x!.text, 'Guard your attention like capital.');
  assert.deepEqual(x.x!.folders, ['Good advice']);
  const imdb = page({ compass: 'long', filter: 'queue', source: 'imdb' }).items[0];
  assert.deepEqual(imdb.imdb!.genres, ['Drama']);
  await vote('x:123', 'up');
  assert.equal(page({ compass: 'long', filter: 'voted' }).items[0].id, 'x:123');
  assert.equal(page({ compass: 'long', filter: 'queue' }).items.some((i) => i.id === 'x:123'), false);
  await vote('x:123', null);
  assert.equal(readFeed().items['x:123'].state, 'seen');
});

test('two sightings on different days without a vote skip an item; skip can be undone', async () => {
  seed();
  await markSeen(['tt1']);
  assert.equal(readFeed().items.tt1.state, 'seen');
  await markSeen(['tt1']); // same day: no change
  assert.equal(readFeed().items.tt1.seenCount, 1);
  const f = readFeed();
  f.items.tt1.seenAt = '2026-01-01T00:00:00Z';
  writeFeed(f);
  await markSeen(['tt1']);
  assert.equal(readFeed().items.tt1.state, 'skipped');
  await skip('tt1', true);
  assert.equal(readFeed().items.tt1.state, 'seen');
});

test('refill promotes candidates when the queue runs low', () => {
  const f = initialFeed();
  addTo(f, Array.from({ length: 6 }, (_, i) => ({ id: `yt:${vid(i)}`, state: 'candidate' as const, alignment: al(0.8) })), 't');
  assert.equal(refill(f, 'long'), 6);
  assert.ok(Object.values(f.items).every((i: FeedItem) => i.state === 'new'));
});

test('rejected items are not re-added by curators under the same compass', () => {
  const f = initialFeed();
  rejectIn(f, [`yt:${vid(1)}`], 'long');
  const res = addTo(f, [{ id: `yt:${vid(1)}`, alignment: al(0.9) }], 'openclaw');
  assert.deepEqual(res.rejected, [`yt:${vid(1)}`]);
  // You can always add something yourself.
  assert.deepEqual(addTo(f, [{ id: `yt:${vid(1)}`, alignment: al(0.9) }], 'you').added, [`yt:${vid(1)}`]);
});

test('compasses: long-term from USER/MEMORY/SOUL, short-term from compass/short-term/compass.md, missing file is fine', () => {
  fs.writeFileSync(path.join(dir, 'ws', 'SOUL.md'), '# Soul\n\n## Canonical North Star\nSystemic influence.\n');
  const long = readCompass('long');
  assert.ok(long.available);
  assert.match(long.text, /primary architect/);
  assert.match(long.text, /Anti-Drift/);
  assert.doesNotMatch(long.text, /Other stuff/);
  assert.equal(readCompass('short').available, false);
  fs.mkdirSync(path.join(dir, 'ws', 'compass', 'short-term'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'ws', 'compass', 'short-term', 'compass.md'),
    '---\nkind: short-term\nperiod: 2026-10-14--2026-11-11\ntitle: "Ship and land"\nstart: 2026-10-14\nend: 2026-11-11\nreview_by: 2026-11-01\nversion: 1\n---\n# Compass\n\n## Period\nShip the feed.\n\n## Relation to the long-term compass\nCapability depth now.\n\n## Focus\nx\n',
  );
  const short = readCompass('short');
  assert.equal(short.available, true);
  assert.equal(short.title, 'Ship and land');
  assert.deepEqual(short.period, { start: '2026-10-14', end: '2026-11-11', label: undefined });
  assert.equal(short.relation, 'Capability depth now.');
  assert.equal(frontMatter('no front matter').body, 'no front matter');
  assert.equal(section('# A\n1\n## B\n2\n# C\n3', /^# A/), '1\n## B\n2');
  assert.equal(parseShortTerm('# T\n\nPeriod text').title, 'T');
  assert.match(long.text, /Systemic influence/);
  process.env.OPENCLAW_COMPASS_DIR = path.join(dir, 'elsewhere');
  assert.equal(readCompass('short').available, false);
});

test('the judge prompt quotes the compass and the vocabulary', () => {
  const p = judgePrompt(readCompass('long'), ['frontier AI'], [{ id: 'x:1', source: 'x', title: '', creator: 'A', detail: 'text: hi' }]);
  assert.match(p, /primary architect/);
  assert.match(p, /- frontier AI: labs/);
  assert.match(p, /x:1 \| x \| A/);
});

test('digest gives OpenClaw both compasses, liked channels with ids and an avoid list', async () => {
  seed();
  await vote(`yt:${vid(0)}`, 'up');
  await vote(`yt:${vid(1)}`, 'up');
  await vote(`yt:${vid(3)}`, 'down');
  await vote(`yt:${vid(4)}`, 'down');
  const d = digest();
  assert.equal(d.compasses.long.available, true);
  assert.equal(d.upChannels[0].channelId, 'UCk');
  assert.deepEqual(d.avoid.creators.map((c) => c.key), ['@other']);
  assert.equal(d.recentVotes.length, 4);
});

test('feed routes: GET view, POST vote/seen/page, Origin required', async () => {
  seed();
  const view = await (await GET(req('feed?compass=long'))).json();
  assert.equal(view.success, true);
  assert.equal(view.data.compasses.long.usable, true);
  assert.equal(view.data.compasses.short.usable, false);
  assert.ok(view.data.items.length > 0);
  const voted = await (await POST(req('feed/vote', { id: 'tt1', vote: 'up' }))).json();
  assert.equal(voted.data.counts.up, 1);
  const seen = await (await POST(req('feed/seen', { ids: [`yt:${vid(0)}`] }))).json();
  assert.equal(seen.data.changed, 1);
  const more = await (await POST(req('feed/page', { compass: 'long', filter: 'queue', exclude: [`yt:${vid(0)}`] }))).json();
  assert.ok(more.data.items.every((i: { id: string }) => i.id !== `yt:${vid(0)}`));
  const bad = await POST(req('feed/vote', { id: 'javascript:alert(1)', vote: 'up' }));
  assert.equal(bad.status, 400);
  const foreign = await POST(
    new NextRequest('http://127.0.0.1:3000/api/media/feed/vote', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'tt1', vote: 'down' }),
    }),
  );
  assert.equal(foreign.status, 403);
});
