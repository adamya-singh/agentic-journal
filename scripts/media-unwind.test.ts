import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { addTo, initialFeed, page, readFeed, vote, writeFeed } from '../src/lib/media/feed-store.ts';
import { weights } from '../src/lib/media/feed-rank.ts';
import { feedCommand } from '../src/lib/media/feed-cli.ts';
import type { CatalogFetchers } from '../src/lib/media/catalog.ts';
import {
  addShows,
  defaultTaste,
  initialUnwind,
  markEpisode,
  neverMatch,
  readUnwind,
  savePosition,
  writeUnwind,
  type Show,
  type UnwindStore,
} from '../src/lib/media/unwind-store.ts';
import { tonight } from '../src/lib/media/unwind-view.ts';
import { addYouTubeSource, titleHasEpisode } from '../src/lib/media/unwind-sources.ts';
import { guessName, planFor, type Library, type Probe } from '../src/lib/media/library.ts';
import { readState } from '../src/lib/media/store.ts';
import { emptyRanking, rankedList, unsorted } from '../src/lib/media/ranking.ts';
import { GET, POST } from '../src/app/api/media/[[...path]]/route.ts';

let dir: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-unwind-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

const emptyLib: Library = { version: 1, files: {} };
const at = '2026-10-20T00:00:00.000Z';
const episodes = (n: number, runtime: number, season = 1) =>
  Array.from({ length: n }, (_, i) => ({ key: `S${season}E${i + 1}`, season, number: i + 1, name: `Ep ${i + 1}`, runtime, airdate: '2020-01-01' }));
function show(id: string, o: Partial<Show>): Show {
  return { id, kind: 'series', title: id, state: 'deck', watched: [], positions: {}, sources: {}, addedBy: 'test', addedAt: at, ...o };
}
const yt = (videoId: string) => ({ kind: 'youtube' as const, videoId, channelId: 'UCNJcSUSzUeFm8W9P7UUlSeQ', addedBy: 'test', addedAt: at });

// A catalog with one series and one film; anything else is unknown.
const catalog: CatalogFetchers = {
  json: async (url) => {
    if (url.includes('suggestion/x/tt1000001.json')) return { d: [{ id: 'tt1000001', l: 'Fake Show', qid: 'tvSeries', yr: '2020-2022' }] };
    if (url.includes('suggestion/x/tt1000002.json')) return { d: [{ id: 'tt1000002', l: 'Fake Film', qid: 'movie', y: 2023 }] };
    if (url.includes('suggestion/x/')) return { d: [] };
    if (url.includes('lookup/shows?imdb=tt1000001')) return { id: 5, name: 'Fake Show' };
    if (url.includes('shows/5?embed=episodes'))
      return {
        id: 5,
        name: 'Fake Show',
        averageRuntime: 30,
        network: { name: 'HBO' },
        _embedded: { episodes: episodes(3, 30).map((e) => ({ ...e, type: 'regular' })) },
      };
    return null;
  },
};

test('a vote in Unwind teaches Unwind only, and voted lists stay per track', async () => {
  const f = initialFeed();
  const creator = { key: '@hbo', name: 'HBO' };
  addTo(
    f,
    [
      { url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Silicon Valley clip', creator, alignment: { taste: { confidence: 0.85, fun: 0.9, fit: 0.8, tags: ['tech satire'], why: 'Funny.', judgedBy: 'test' } } },
      { url: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'Karpathy lecture', creator: { key: '@karpathy', name: 'Andrej' }, alignment: { long: { confidence: 0.9, tags: ['ML fundamentals'], why: 'Builds it.', judgedBy: 'test' } } },
    ],
    'test',
  );
  writeFeed(f);
  await vote('yt:aaaaaaaaaaa', 'up', 'taste');
  const items = Object.values(readFeed().items);
  assert.equal(readFeed().items['yt:aaaaaaaaaaa'].votedIn, 'unwind');
  assert.equal(weights(items, 'taste').votes, 1);
  assert.equal(weights(items, 'long').votes, 0);
  assert.equal(page({ compass: 'taste', filter: 'voted' }).items.length, 1);
  assert.equal(page({ compass: 'long', filter: 'voted' }).items.length, 0);
  // Each queue holds only its own lens.
  assert.deepEqual(page({ compass: 'long', filter: 'queue' }).items.map((i) => i.id), ['yt:bbbbbbbbbbb']);
  assert.equal(readFeed().items['yt:aaaaaaaaaaa'].alignment.taste?.fun, 0.9);
});

test('feed-add keeps taste alignments with fun and fit', async () => {
  writeFeed(initialFeed());
  const file = path.join(dir, 'items.json');
  fs.writeFileSync(
    file,
    JSON.stringify([
      {
        url: 'https://www.youtube.com/watch?v=ccccccccccc',
        title: 'Office Space memo',
        creator: { key: '@movieclips', name: 'Movieclips' },
        alignment: { taste: { confidence: 0.8, fun: 0.9, fit: 0.7, tags: ['tech satire'], why: 'The memo scene.' } },
      },
    ]),
  );
  const res = (await feedCommand('feed-add', ['--file', file])) as { added: string[] };
  assert.deepEqual(res.added, ['yt:ccccccccccc']);
  const a = readFeed().items['yt:ccccccccccc'].alignment.taste!;
  assert.equal(a.fit, 0.7);
  assert.equal(a.confidence, 0.8);
});

test('the Never list rules out by channel or title word', () => {
  const card = defaultTaste(at);
  assert.equal(neverMatch(card, { creator: '@MrBeast', title: 'Find This Stranger' }), 'Stunt and prize challenges');
  assert.equal(neverMatch(card, { creator: '@someone', title: 'r/AskReddit: what do you regret' }), 'Reddit story narrations');
  assert.equal(neverMatch(card, { creator: '@hbo', title: 'Silicon Valley: Making the World a Better Place' }), undefined);
  card.never.forEach((n) => (n.on = false));
  assert.equal(neverMatch(card, { creator: '@mrbeast', title: '' }), undefined);
});

test('shows are checked against the catalogs before they get in', async () => {
  writeUnwind(initialUnwind());
  const r = await addShows([{ id: 'tt1000001' }, { id: 'tt1000002', runtimeMin: 147 }, { id: 'tt9999999' }], 'test', catalog);
  assert.deepEqual(r.added, ['tt1000001', 'tt1000002']);
  assert.equal(r.unknown[0].id, 'tt9999999');
  const u = readUnwind();
  assert.equal(u.shows.tt1000001.episodes?.length, 3);
  assert.equal(u.shows.tt1000001.network, 'HBO');
  assert.equal(u.shows.tt1000002.kind, 'film');
  assert.equal(u.shows.tt1000002.runtimeMin, 147);
});

test('tonight fits the time you have, preferring what plays here', () => {
  const u: UnwindStore = initialUnwind();
  u.shows.tt1 = show('tt1', { state: 'watching', episodes: episodes(4, 30), watched: ['S1E1'], sources: { S1E2: [yt('aaaaaaaaaaa')], S1E3: [yt('bbbbbbbbbbb')] }, lastWatchedAt: at });
  u.shows.tt2 = show('tt2', { episodes: episodes(8, 45) });
  u.shows.tt3 = show('tt3', { kind: 'film', runtimeMin: 150, sources: { film: [yt('ccccccccccc')] } });
  const t30 = tonight('30', u, emptyLib, []);
  assert.equal(t30.show?.id, 'tt1');
  assert.deepEqual(t30.episodes?.map((e) => e.key), ['S1E2']);
  const t60 = tonight('60', u, emptyLib, []);
  assert.deepEqual(t60.episodes?.map((e) => e.key), ['S1E2', 'S1E3']);
  assert.equal(tonight('120', u, emptyLib, []).show?.id, 'tt3');
  // Nothing playable fits: fall back to the best unplayable thing that fits.
  u.shows.tt1.sources = {};
  assert.equal(tonight('30', u, emptyLib, []).show?.id, 'tt1');
  delete u.shows.tt1;
  assert.equal(tonight('30', u, emptyLib, []).kind, 'none');
  assert.equal(tonight('clips', u, emptyLib, []).kind, 'none');
});

test('watching to the end finishes a show and makes it rankable', async () => {
  const u = initialUnwind();
  u.shows.tt1000001 = show('tt1000001', { title: 'Fake Show', episodes: episodes(2, 30) });
  writeUnwind(u);
  assert.equal((await savePosition('tt1000001', 'S1E1', 600, 1800)).done, false);
  assert.equal(readUnwind().shows.tt1000001.state, 'watching');
  assert.equal((await savePosition('tt1000001', 'S1E1', 1650, 1800)).done, true);
  await markEpisode('tt1000001', 'S1E2', true);
  const s = readUnwind().shows.tt1000001;
  assert.equal(s.state, 'finished');
  const state = readState();
  assert.equal(state.titles.tt1000001.watched, true);
  assert.ok(state.jobs.some((j) => j.action === 'seen' && j.titleId === 'tt1000001'));
  const library = Object.values(state.titles).filter((t) => t.collections.length);
  // Watched and unplaced: the Ranker offers it next.
  assert.ok(unsorted(state.ranking ?? emptyRanking(), library).includes('tt1000001'));
  assert.equal(rankedList(state.ranking ?? emptyRanking()).length, 0);
  await assert.rejects(savePosition('tt1000001', 'S9E9', 10), /Unknown episode/);
});

test('episode markers in upload titles', () => {
  assert.equal(titleHasEpisode("TVF's Aspirants | S01 E01 | UPSC", 'S1E1', true), true);
  assert.equal(titleHasEpisode("TVF's Aspirants | S01 E01 | UPSC", 'S1E2', true), false);
  assert.equal(titleHasEpisode('Pitchers Episode 3 | Full', 'S1E3', true), true);
  assert.equal(titleHasEpisode('Pitchers Episode 3 | Full', 'S1E3', false), false);
  assert.equal(titleHasEpisode('Show 2x05', 'S2E5', false), true);
  assert.equal(titleHasEpisode('Season 2 Episode 5 - Show', 'S2E5', false), true);
});

test('YouTube sources count only from approved channels', async () => {
  const u = initialUnwind();
  u.shows.tt14392248 = show('tt14392248', { title: 'Aspirants', episodes: episodes(5, 45) });
  writeUnwind(u);
  const watch = (channelId: string, author: string, title: string, len: number) =>
    `<script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"0Kl1ucZuSZ8","title":${JSON.stringify(title)},"lengthSeconds":"${len}","channelId":"${channelId}","author":${JSON.stringify(author)}}};</script>`;
  const fetchers = (html: string) => ({ search: async () => '', watch: async () => html });
  const rando = await addYouTubeSource('tt14392248', 'S1E1', '0Kl1ucZuSZ8', 'openclaw', fetchers(watch('UCnsRU39PkBTwobCGeRAOGXg', 'DJ CREATION', 'Aspirants S01E01 full', 2700)));
  assert.equal(rando.added, false);
  assert.equal(readUnwind().officialChannels.UCnsRU39PkBTwobCGeRAOGXg.approved, false);
  await assert.rejects(
    addYouTubeSource('tt14392248', 'S1E1', '0Kl1ucZuSZ8', 'openclaw', fetchers(watch('UCNJcSUSzUeFm8W9P7UUlSeQ', 'The Viral Fever', "TVF's Aspirants | Official Trailer", 188))),
    /Not added/,
  );
  const ok = await addYouTubeSource('tt14392248', 'S1E1', '0Kl1ucZuSZ8', 'openclaw', fetchers(watch('UCNJcSUSzUeFm8W9P7UUlSeQ', 'The Viral Fever', "TVF's Aspirants | S01 E01 | UPSC", 2777)));
  assert.equal(ok.added, true);
  assert.equal(readUnwind().shows.tt14392248.sources.S1E1[0].kind, 'youtube');
});

test('library names and what it takes to play a file', () => {
  assert.deepEqual(guessName('inbox/Silicon.Valley.S02E05.1080p.WEB.mkv'), { title: 'Silicon Valley', season: 2, number: 5 });
  assert.deepEqual(guessName('shows/Kota Factory/Kota.Factory.1x03.mkv'), { title: 'Kota Factory', season: 1, number: 3 });
  assert.deepEqual(guessName('films/12th Fail (2023).mp4'), { title: '12th Fail', year: '2023' });
  const probe = (container: string, v: string, a: string[], pixFmt = 'yuv420p'): Probe => ({
    container,
    video: { codec: v, pixFmt },
    audio: a.map((codec, i) => ({ index: i + 1, codec, isDefault: i === 0 })),
    subs: [],
  });
  assert.equal(planFor(probe('mov,mp4,m4a,3gp,3g2,mj2', 'h264', ['aac'])), 'direct');
  assert.equal(planFor(probe('mov,mp4,m4a,3gp,3g2,mj2', 'h264', ['aac', 'aac'])), 'remux');
  assert.equal(planFor(probe('matroska,webm', 'h264', ['aac'])), 'remux');
  assert.equal(planFor(probe('matroska,webm', 'h264', ['ac3'])), 'audio');
  assert.equal(planFor(probe('matroska,webm', 'hevc', ['aac'])), 'transcode');
  assert.equal(planFor(probe('matroska,webm', 'h264', ['aac'], 'yuv420p10le')), 'transcode');
  assert.equal(planFor(probe('matroska,webm', 'vp9', ['opus']), 'inbox/x.mkv'), 'remux');
  assert.equal(planFor(probe('matroska,webm', 'vp9', ['opus']), 'inbox/x.webm'), 'direct');
});

test('library files stream with Range, only through the index', async () => {
  const root = path.join(dir, 'media', 'library');
  fs.mkdirSync(path.join(root, '.ready'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ready', 'aaaaaaaaaaaaaaaa.mp4'), Buffer.alloc(100, 7));
  fs.writeFileSync(path.join(dir, 'media', 'secret.json'), '{}');
  const entry = (id: string, playPath: string) => ({ id, rel: `inbox/${id}.mkv`, size: 100, mtimeMs: 1, seenAt: at, status: 'ready', playPath, subtitles: [] });
  fs.writeFileSync(
    path.join(dir, 'media', 'library.json'),
    JSON.stringify({
      version: 1,
      files: {
        aaaaaaaaaaaaaaaa: entry('aaaaaaaaaaaaaaaa', '.ready/aaaaaaaaaaaaaaaa.mp4'),
        bbbbbbbbbbbbbbbb: entry('bbbbbbbbbbbbbbbb', '../secret.json'),
      },
    }),
  );
  const get = (id: string, range?: string) =>
    GET(new NextRequest(`http://localhost:3000/api/media/unwind/stream/${id}`, { headers: range ? { range } : {} }));
  const part = await get('aaaaaaaaaaaaaaaa', 'bytes=10-19');
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/100');
  assert.equal((await part.arrayBuffer()).byteLength, 10);
  assert.equal((await get('aaaaaaaaaaaaaaaa')).status, 200);
  assert.equal((await get('aaaaaaaaaaaaaaaa', 'bytes=200-')).status, 416);
  assert.equal((await get('cccccccccccccccc')).status, 404);
  assert.equal((await get('bbbbbbbbbbbbbbbb')).status, 404);
});

test('Unwind writes need the same origin', async () => {
  const u = initialUnwind();
  u.shows.tt1000001 = show('tt1000001', { episodes: episodes(2, 30) });
  writeUnwind(u);
  const post = (origin: string | null, body: unknown) =>
    POST(
      new NextRequest('http://localhost:3000/api/media/unwind/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post(null, { id: 'tt1000001', key: 'S1E1', position: 40 })).status, 403);
  assert.equal((await post('http://localhost:3000', { id: 'tt1000001', key: 'S1E1', position: 40 })).status, 200);
  assert.equal((await post('http://localhost:3000', { id: 'tt1000001', key: '../x', position: 40 })).status, 400);
  assert.equal(readUnwind().shows.tt1000001.positions.S1E1.sec, 40);
  const r = await GET(new NextRequest('http://localhost:3000/api/media/unwind'));
  const body = await r.json();
  assert.equal(body.success, true);
  assert.equal(body.data.continuing[0].id, 'tt1000001');
});
