import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  buildView,
  initialTbpn,
  markWatched,
  parsePlaylistPage,
  parsePublishDate,
  readTbpn,
  savePosition,
  syncEpisodes,
  type TbpnStore,
} from '../src/lib/media/tbpn.ts';
import { initialYouTube, writeYouTube, type YouTubeStore } from '../src/lib/media/youtube-store.ts';
import { GET, POST } from '../src/app/api/media/[[...path]]/route.ts';

const NOW = Date.parse('2026-10-17T19:00:00Z');
const DAY = 86_400_000;
const lockup = (id: string, title: string, clock: string) => ({
  lockupViewModel: {
    contentId: id,
    contentType: 'LOCKUP_CONTENT_TYPE_VIDEO',
    contentImage: {
      thumbnailViewModel: {
        overlays: [{ thumbnailBottomOverlayViewModel: { badges: [{ thumbnailBadgeViewModel: { text: clock } }] } }],
      },
    },
    metadata: { lockupMetadataViewModel: { title: { content: title } } },
  },
});
const playlistHtml = (items: object[]) =>
  `<html><script nonce="x">var ytInitialData = ${JSON.stringify({
    contents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: [...items, { continuationItemViewModel: {} }] } }] } },
  })};</script></html>`;
const watchHtml = (iso: string) => `<script>{"microformat":{"publishDate":"${iso}","uploadDate":"${iso}"}}</script>`;

let dir: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-tbpn-test-'));
  process.env.BACKEND_DATA_DIR = dir;
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the playlist page parses into episodes with clean titles and lengths', () => {
  const items = parsePlaylistPage(
    playlistHtml([
      lockup('Giy8Fl5bKPA', 'We Review ‘You Can See Everything’ | Diet TBPN', '31:09'),
      lockup('k8Ob9iXNrOU', 'Inflation Heats Up| Diet TBPN', '1:02:03'),
      { lockupViewModel: { contentId: 'PLnotavideo', contentType: 'LOCKUP_CONTENT_TYPE_PLAYLIST' } },
    ]),
  );
  assert.deepEqual(items, [
    { videoId: 'Giy8Fl5bKPA', title: 'We Review ‘You Can See Everything’', durationSec: 1869 },
    { videoId: 'k8Ob9iXNrOU', title: 'Inflation Heats Up', durationSec: 3723 },
  ]);
  assert.throws(() => parsePlaylistPage('<html></html>'), /changed/);
  assert.equal(parsePublishDate(watchHtml('2026-10-16T17:23:34-07:00')), '2026-10-17T00:23:34.000Z');
  assert.equal(parsePublishDate('<html></html>'), undefined);
});

test('a sync dates new episodes, reuses known dates and stops past the window', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `ep${String(i).padStart(9, '0')}`);
  const fetched: string[] = [];
  const fetchers = {
    playlist: async () => playlistHtml(ids.map((id, i) => lockup(id, `Episode ${i} | Diet TBPN`, '30:00'))),
    // Newest first, one every 5 days: ep0 today, ep14 70 days ago.
    watch: async (id: string) => {
      fetched.push(id);
      return watchHtml(new Date(NOW - Number(id.slice(2)) * 5 * DAY).toISOString());
    },
  };
  assert.equal(await syncEpisodes(NOW, fetchers), 20);
  const t = readTbpn();
  assert.equal(Object.keys(t.episodes).length, 20);
  assert.equal(t.episodes[ids[0]].title, 'Episode 0');
  assert.equal(t.episodes[ids[0]].durationSec, 1800);
  // 67 days is the dating cutoff: three past it in a row (ep14-16) end the dating.
  assert.ok(!fetched.includes(ids[19]));
  assert.ok(t.syncedAt && !t.error);

  fetched.length = 0;
  await syncEpisodes(NOW + DAY, fetchers);
  assert.ok(!fetched.includes(ids[0]), 'known dates are not fetched again');

  await assert.rejects(syncEpisodes(NOW, { ...fetchers, playlist: async () => '<html></html>' }));
  assert.match(readTbpn().error ?? '', /changed/);
  assert.equal(Object.keys(readTbpn().episodes).length, 20, 'a failed sync keeps the last list');
});

const store = (): TbpnStore => ({
  ...initialTbpn(),
  episodes: {
    old_episode: { title: 'Too old', durationSec: 1800, publishedAt: new Date(NOW - 70 * DAY).toISOString() },
    a__________: { title: 'A', durationSec: 1800, publishedAt: new Date(NOW - 40 * DAY).toISOString() },
    b__________: { title: 'B', durationSec: 1800, publishedAt: new Date(NOW - 30 * DAY).toISOString() },
    c__________: { title: 'C', durationSec: 1800, publishedAt: new Date(NOW - 20 * DAY).toISOString() },
    d__________: { title: 'D', durationSec: 1800, publishedAt: new Date(NOW - 10 * DAY).toISOString() },
    e__________: { title: 'E', durationSec: 1800, publishedAt: new Date(NOW - 1 * DAY).toISOString() },
    undated____: { title: 'Undated', durationSec: 1800 },
  },
});
const yt = (videos: Record<string, { progress: number; day?: string }>, lastSyncAt?: string): YouTubeStore => ({
  ...initialYouTube(),
  lastSyncAt,
  videos: Object.fromEntries(
    Object.entries(videos).map(([id, v]) => [
      id,
      { title: id, channel: '@tbpnlive', progress: v.progress, lastWatchedDay: v.day ?? '2026-09-01', firstSeenAt: '', status: 'kept' as const },
    ]),
  ),
});

test('the backlog is the last 2 months, oldest first, without finished episodes', () => {
  const t = store();
  // B half watched on YouTube, C finished on YouTube, D only opened (the 10% floor).
  const v = buildView(t, yt({ b__________: { progress: 0.5 }, c__________: { progress: 1 }, d__________: { progress: 0.1 } }), NOW);
  assert.deepEqual(
    v.queue.map((e) => e.id),
    ['a__________', 'b__________', 'd__________', 'e__________'],
  );
  assert.deepEqual(v.watched.map((e) => e.id), ['c__________']);
  const [a, b, d] = v.queue;
  assert.equal(a.state, 'new');
  assert.equal(b.resumeAt, 895, 'resumes a few seconds before where YouTube says you were');
  assert.equal(d.state, 'started');
  assert.equal(d.resumeAt, 0, 'an only-opened episode starts from the top');
  assert.equal(v.remainingSec, 1800 * 3 + (1800 - 895));
  assert.equal(v.history, 'unknown');
});

test('the furthest place wins, and marks override progress both ways', () => {
  const t = store();
  t.watch.b__________ = { position: 1200, at: new Date(NOW).toISOString() };
  t.watch.c__________ = { position: 0, at: new Date(NOW).toISOString(), done: false };
  t.watch.e__________ = { position: 10, at: new Date(NOW).toISOString(), done: true };
  const v = buildView(t, yt({ b__________: { progress: 0.5 }, c__________: { progress: 1 } }), NOW);
  const b = v.queue.find((e) => e.id === 'b__________')!;
  assert.equal(b.resumeAt, 1200);
  assert.ok(v.queue.some((e) => e.id === 'c__________'), 'put back in the queue');
  assert.deepEqual(v.watched.map((e) => e.id), ['e__________']);
});

test('history check: Journal plays seen in a later YouTube sync confirm it', () => {
  const t = store();
  t.watch.a__________ = { position: 600, at: '2026-10-15T15:00:00Z' };
  const missing = buildView(t, yt({}, '2026-10-16T12:00:00Z'), NOW);
  assert.equal(missing.history, 'missing');
  const confirmed = buildView(t, yt({ a__________: { progress: 0.33, day: '2026-10-15' } }, '2026-10-16T12:00:00Z'), NOW);
  assert.equal(confirmed.history, 'confirmed');
  const tooSoon = buildView(t, yt({}, '2026-10-15T12:00:00Z'), NOW);
  assert.equal(tooSoon.history, 'unknown', 'the sync ran before the play');
});

test('saving your place: near the end counts as watched; unknown ids are refused', async () => {
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'media', 'tbpn.json'), JSON.stringify(store()));
  assert.equal((await savePosition('a__________', 600.4)).position, 600);
  assert.equal((await savePosition('a__________', 1700)).done, true);
  await markWatched('a__________', false);
  assert.deepEqual(readTbpn().watch.a__________.position, 0);
  await assert.rejects(savePosition('zzzzzzzzzzz', 10), /not a Diet TBPN episode/);
});

test('the API saves positions from the same origin only', async () => {
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'media', 'tbpn.json'), JSON.stringify({ ...store(), syncedAt: new Date().toISOString() }));
  writeYouTube(initialYouTube());
  const post = (origin: string | null, body: unknown) =>
    POST(
      new NextRequest('http://localhost:3000/api/media/tbpn/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
      }),
    );
  assert.equal((await post(null, { id: 'b__________', position: 30 })).status, 403);
  assert.equal((await post('http://localhost:3000', { id: 'b__________', position: 30 })).status, 200);
  assert.equal((await post('http://localhost:3000', { id: 'bad', position: 30 })).status, 400);
  assert.equal(readTbpn().watch.b__________.position, 30);
  const r = await GET(new NextRequest('http://localhost:3000/api/media/tbpn'));
  const body = await r.json();
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data.queue));
});
