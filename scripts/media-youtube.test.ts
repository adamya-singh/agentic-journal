import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  addJob,
  initialState,
  mergeCollection,
  rank,
  readState,
  syncRatings,
  writeState,
} from '../src/lib/media/store.ts';
import { outOfSync } from '../src/lib/media/ranking.ts';
import { processNext, queueDailyYouTube } from '../src/lib/media/worker.ts';
import { titleUrl, type IMDbSession } from '../src/lib/media/imdb.ts';
import {
  parseAccountMenu,
  parseHistoryPage,
  resolveDay,
  YouTubeError,
  type HistoryVideo,
  type YouTubeSession,
} from '../src/lib/media/youtube.ts';
import {
  decide,
  decideBucket,
  decideChannel,
  channelRules,
  initialYouTube,
  listVideos,
  mergeBatch,
  readYouTube,
  restore,
  setChannelRules,
  summary,
  unkeep,
  writeYouTube,
} from '../src/lib/media/youtube-store.ts';
import { GET, POST } from '../src/app/api/media/[[...path]]/route.ts';

const fixture = (name: string) =>
  JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8'));
const TODAY = new Date(2026, 9, 13); // Tue Oct 13 2026
const video = (n: number, extra: Partial<HistoryVideo> = {}): HistoryVideo => ({
  videoId: `vid${String(n).padStart(8, '0')}`,
  title: `Video ${n}`,
  channelName: 'Chan A',
  channelHandle: '@ChanA',
  channelId: 'UCaaaaaaaaaaaaaaaaaaaaaa',
  durationSec: 600,
  progress: 1,
  watchedDay: '2026-10-10',
  ...extra,
});
const ACCOUNT = { id: '111||', name: 'Adamya Singh', handle: '@adamya' };
let dir: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-yt-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  const s = initialState();
  s.titles.tt1 = {
    id: 'tt1',
    title: 'A film',
    url: titleUrl('tt1'),
    collections: ['watched'],
    watched: true,
  };
  writeState(s);
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('history pages parse into videos with channel, length, progress and watch day', () => {
  const first = parseHistoryPage(fixture('youtube_history_initial.json'), TODAY);
  assert.equal(first.continuation, 'TOKEN-1');
  // The topbar is not history, even if it contains a video.
  assert.deepEqual(
    first.videos.map((v) => [v.videoId, v.watchedDay]),
    [
      ['aaaaaaaaaa1', '2026-10-13'],
      ['aaaaaaaaaa2', '2026-10-13'],
      ['aaaaaaaaaa1', '2026-10-12'],
      ['bbbbbbbbbb1', '2026-10-12'],
    ],
  );
  assert.deepEqual(first.videos[0], {
    videoId: 'aaaaaaaaaa1',
    title: 'Example video one',
    channelName: 'Example Channel',
    channelId: 'UCexampleexampleexample1',
    channelHandle: '@ExampleChannel',
    durationSec: 1907,
    live: undefined,
    progress: 0.1,
    watchedDay: '2026-10-13',
  });
  assert.equal(first.videos[1].durationSec, 3723);
  assert.equal(first.videos[3].short, true);
  assert.equal(first.videos[3].channelName, undefined);

  // A continuation without a heading continues the previous day.
  const next = parseHistoryPage(fixture('youtube_history_continuation.json'), TODAY, first.lastDay);
  assert.equal(next.continuation, undefined);
  assert.equal(next.videos[0].watchedDay, '2026-10-12');
  assert.equal(next.videos[0].live, true);
  assert.equal(next.videos[0].progress, undefined);
  assert.deepEqual(next.videos[1], {
    videoId: 'cccccccccc1',
    title: 'Legacy layout video',
    channelName: 'Old Channel',
    channelId: 'UColdoldoldoldoldoldold1',
    channelHandle: '@OldChannel',
    durationSec: 245,
    live: undefined,
    progress: 0.15,
    watchedDay: '2025-03-12',
  });
  assert.deepEqual(parseAccountMenu(fixture('youtube_account_menu.json')), {
    name: 'Example Person',
    handle: '@example1234',
  });
});

test('day headings resolve relative to today, across a year boundary', () => {
  assert.equal(resolveDay('Today', TODAY), '2026-10-13');
  assert.equal(resolveDay('Yesterday', TODAY), '2026-10-12');
  assert.equal(resolveDay('Sunday', TODAY), '2026-10-11');
  assert.equal(resolveDay('Tuesday', TODAY), '2026-10-06');
  assert.equal(resolveDay('Oct 3', TODAY), '2026-10-03');
  assert.equal(resolveDay('Dec 30', TODAY), '2025-12-30');
  assert.equal(resolveDay('Mar 12, 2024', TODAY), '2024-03-12');
  assert.equal(resolveDay('Not a date', TODAY), undefined);
});

test('rewatches move the day forward; channel rules decide new videos; kept videos become titles', async () => {
  await mergeBatch([video(1, { watchedDay: '2026-10-01' }), video(2)]);
  await mergeBatch([video(1, { watchedDay: '2026-10-11' })]);
  assert.equal(readYouTube().videos.vid00000001.lastWatchedDay, '2026-10-11');

  const kept = await decideChannel('@chana', 'kept', true);
  assert.equal(Object.keys(kept.previous).length, 2);
  assert.equal(readState().titles['yt:vid00000001'].source, 'youtube');
  assert.equal(readState().titles['yt:vid00000001'].channel, 'Chan A');
  await mergeBatch([video(3)]);
  assert.equal(readYouTube().videos.vid00000003.decidedBy, 'rule');
  assert.ok(readState().titles['yt:vid00000003']);

  const s = summary();
  assert.equal(s.kept, 3);
  assert.equal(s.pending, 0);
  assert.equal(s.channels[0].rule, 'keep');
});

test('channel rules can be set later for channels decided without Remember, and undone', async () => {
  const chanB = { channelName: 'Chan B', channelHandle: '@ChanB', channelId: undefined };
  const chanC = { channelName: 'Chan C', channelHandle: '@ChanC', channelId: undefined };
  const later = () => new Promise((r) => setTimeout(r, 5));
  await mergeBatch([1, 2, 3].map((n) => video(n)));
  await mergeBatch([4, 5, 6].map((n) => video(n, chanB)));
  await mergeBatch([9, 10, 11].map((n) => video(n, chanC)));
  await later();
  await decideChannel('@chana', 'kept', false);
  await decideChannel('@chanb', 'skipped', false);
  // Chan C was picked one video at a time; its other two were already waiting.
  await decide(['vid00000009'], 'kept');
  await later();
  await mergeBatch([video(7)]);
  assert.deepEqual(
    channelRules().map((c) => [c.key, c.rule, c.kept, c.skipped, c.pending, c.arrived]),
    [
      ['@chana', undefined, 3, 0, 1, 1],
      ['@chanb', undefined, 0, 3, 0, 0],
      ['@chanc', undefined, 1, 0, 2, 0],
    ],
  );

  // A new rule catches up on the video that arrived after Keep all, not on Chan C's older ones.
  const set = await setChannelRules({ '@chana': 'keep', '@chanb': 'skip', '@chanc': 'keep' });
  assert.deepEqual(set.previousRules, { '@chana': null, '@chanb': null, '@chanc': null });
  assert.deepEqual(set.previous, { vid00000007: 'pending' });
  assert.equal(readYouTube().videos.vid00000007.decidedBy, 'rule');
  assert.equal(readYouTube().videos.vid00000010.status, 'pending');
  // Setting the same rule again changes nothing, so there is nothing to undo.
  assert.deepEqual(await setChannelRules({ '@chana': 'keep' }), {
    previous: {},
    previousRules: {},
  });
  await mergeBatch([video(8, chanB)]);
  assert.equal(readYouTube().videos.vid00000008.status, 'skipped');
  assert.equal(readYouTube().videos.vid00000008.decidedBy, 'rule');

  await restore(set.previous, set.previousRules);
  assert.equal(readYouTube().channels['@chana'].rule, undefined);
  assert.equal(readState().titles['yt:vid00000007'], undefined);
  await assert.rejects(setChannelRules({ '@nobody': 'keep' }), /Channel not found/);
  assert.equal(readYouTube().channels['@chanb'].rule, undefined);
});

test('skipped videos never come back as pending, and undo restores the earlier state', async () => {
  await mergeBatch([
    video(1),
    video(2, { progress: 0.05 }),
    video(3, { live: true, progress: undefined }),
  ]);
  const barely = await decideBucket('barely');
  assert.deepEqual(barely.previous, { vid00000002: 'pending' });
  const live = await decideBucket('live');
  assert.deepEqual(Object.keys(live.previous), ['vid00000003']);
  await mergeBatch([video(2, { progress: 0.05, watchedDay: '2026-10-12' })]);
  assert.equal(readYouTube().videos.vid00000002.status, 'skipped');
  await restore(barely.previous);
  assert.equal(summary().pending, 2);
  assert.equal(listVideos({ channel: '@chana' }).videos[0].status, 'pending');
});

test('removing a kept video drops its title, ranking and feedback, and keeps it skipped', async () => {
  await mergeBatch([video(1)]);
  await decide(['vid00000001'], 'kept');
  await rank({ op: 'tier', id: 'yt:vid00000001', tier: 'S' });
  const s = readState();
  s.feedback['yt:vid00000001'] = 'interested';
  writeState(s);
  await unkeep('vid00000001');
  const after = readState();
  assert.equal(after.titles['yt:vid00000001'], undefined);
  assert.equal(after.feedback['yt:vid00000001'], undefined);
  assert.deepEqual(after.ranking!.tiers.S, []);
  assert.equal(readYouTube().videos.vid00000001.status, 'skipped');
});

test('IMDb never sees YouTube titles: refresh, rating sync and IMDb jobs', async () => {
  await mergeBatch([video(1)]);
  await decide(['vid00000001'], 'kept');
  await rank({ op: 'tier', id: 'yt:vid00000001', tier: 'S' });
  await rank({ op: 'tier', id: 'tt1', tier: 'A' });
  const s = readState();
  assert.deepEqual(outOfSync(s.ranking!, s.titles), [{ id: 'tt1', rating: 8 }]);
  await syncRatings();
  assert.deepEqual(
    readState().jobs.map((j) => j.titleId),
    ['tt1'],
  );
  assert.throws(() => addJob(readState(), 'rating', 'yt:vid00000001', 9), /Only IMDb/);
  assert.throws(() => addJob(readState(), 'seen', 'yt:vid00000001'), /Only IMDb/);

  // A complete IMDb watched read leaves kept videos in the library.
  const t = readState();
  mergeCollection(t, 'watched', [], { total: 0, collected: 0, complete: true, at: '' });
  assert.equal(t.titles['yt:vid00000001'].watched, true);
  assert.deepEqual(t.titles['yt:vid00000001'].collections, ['watched']);
  assert.equal(t.titles.tt1.watched, false);
});

const noIMDb = async (): Promise<IMDbSession> => {
  throw new Error('IMDb must not be used for YouTube jobs');
};
function fakeYouTube(
  pages: HistoryVideo[][],
  account: typeof ACCOUNT | null = ACCOUNT,
  log: { cursors: (string | undefined)[]; closed: number; batches?: number } = {
    cursors: [],
    closed: 0,
  },
  budgetPages = Infinity,
) {
  return async (): Promise<YouTubeSession> => ({
    account,
    async readHistory({ cursor, onBatch }) {
      log.cursors.push(cursor);
      let i = cursor ? Number(cursor) : 0,
        read = 0;
      for (; i < pages.length; i++) {
        if (read++ >= budgetPages) return { complete: false, cursor: String(i) };
        log.batches = (log.batches || 0) + 1;
        if (await onBatch(pages[i])) return { complete: false };
      }
      return { complete: true };
    },
    async close() {
      log.closed++;
    },
  });
}
const queue = () => {
  const s = readState();
  addJob(s, 'youtube-sync');
  writeState(s);
};

test('the first sync waits for you to confirm the account, then imports; a different account fails', async () => {
  queue();
  await processNext(noIMDb, fakeYouTube([[video(1)]]));
  let y = readYouTube();
  assert.deepEqual(y.pendingAccount, ACCOUNT);
  assert.equal(Object.keys(y.videos).length, 0);
  assert.equal(readState().jobs.at(-1)!.note, 'Waiting for you to confirm the YouTube account.');

  const post = (url: string, body: unknown, origin = 'http://localhost:3000') =>
    POST(
      new NextRequest(`http://localhost:3000/api/media/${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await post('youtube/account', { confirm: true }, 'https://evil.example')).status,
    403,
  );
  assert.equal((await post('youtube/account', { confirm: true })).status, 200);
  y = readYouTube();
  assert.deepEqual(y.account, ACCOUNT);
  assert.equal(y.pendingAccount, undefined);
  // Confirming queued the import.
  await processNext(noIMDb, fakeYouTube([[video(1), video(2)]]));
  y = readYouTube();
  assert.equal(Object.keys(y.videos).length, 2);
  assert.equal(y.coverage!.complete, true);
  assert.ok(y.lastSyncAt);

  queue();
  await processNext(
    noIMDb,
    fakeYouTube([[video(3)]], { id: '222||', name: 'Rutgers', handle: '@ru' }),
  );
  const job = readState().jobs.at(-1)!;
  assert.equal(job.status, 'failed');
  assert.match(job.error!, /signed in to YouTube as @ru, not @adamya/);
  assert.equal(readYouTube().videos.vid00000003, undefined);

  queue();
  await processNext(noIMDb, fakeYouTube([[video(3)]], null));
  assert.match(readState().jobs.at(-1)!.error!, /Sign in to YouTube/);
});

test('a long import continues from its cursor in the next job; later syncs stop once caught up', async () => {
  const y = initialYouTube();
  y.account = ACCOUNT;
  writeYouTube(y);
  const pages = [0, 1, 2].map((p) => Array.from({ length: 40 }, (_, i) => video(p * 40 + i)));
  const log = { cursors: [] as (string | undefined)[], closed: 0 };
  queue();
  await processNext(noIMDb, fakeYouTube(pages, ACCOUNT, log, 2));
  assert.equal(readYouTube().cursor, '2');
  assert.equal(readYouTube().coverage!.complete, false);
  // The next job was queued and continues where the first stopped.
  assert.equal(readState().jobs.at(-1)!.status, 'queued');
  await processNext(noIMDb, fakeYouTube(pages, ACCOUNT, log, 2));
  assert.deepEqual(log.cursors, [undefined, '2']);
  assert.equal(Object.keys(readYouTube().videos).length, 120);
  assert.equal(readYouTube().cursor, undefined);
  assert.equal(readYouTube().coverage!.complete, true);
  assert.equal(log.closed, 2);

  // New videos on top of a page that is otherwise known: stop after that page.
  const incremental = { cursors: [] as (string | undefined)[], closed: 0, batches: 0 };
  queue();
  await processNext(
    noIMDb,
    fakeYouTube([[video(500), ...pages[0]], pages[1], pages[2]], ACCOUNT, incremental),
  );
  assert.equal(incremental.batches, 1);
  assert.ok(readYouTube().videos.vid00000500);
  assert.equal(readYouTube().coverage!.complete, true);
});

test('the daily sync waits a day after success and an hour after a failed attempt', async () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(await queueDailyYouTube(now), false); // no account yet
  const y = initialYouTube();
  y.account = ACCOUNT;
  y.lastSyncAt = new Date(now - 3600_000).toISOString();
  writeYouTube(y);
  assert.equal(await queueDailyYouTube(now), false);
  y.lastSyncAt = new Date(now - 25 * 3600_000).toISOString();
  y.lastAttemptAt = new Date(now - 10 * 60_000).toISOString();
  writeYouTube(y);
  assert.equal(await queueDailyYouTube(now), false);
  y.lastAttemptAt = new Date(now - 2 * 3600_000).toISOString();
  writeYouTube(y);
  assert.equal(await queueDailyYouTube(now), true);
  assert.equal(await queueDailyYouTube(now), false); // already queued
  assert.equal(readState().jobs.filter((j) => j.action === 'youtube-sync').length, 1);
});

test('routes: yt ids rank, bad ids and foreign origins are refused, summaries page', async () => {
  await mergeBatch([video(1), video(2)]);
  await decide(['vid00000001'], 'kept');
  const post = (url: string, body: unknown, origin = 'http://localhost:3000') =>
    POST(
      new NextRequest(`http://localhost:3000/api/media/${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await post('ranking', { op: 'tier', id: 'yt:vid00000001', tier: 'S' })).status,
    200,
  );
  assert.equal((await post('ranking', { op: 'tier', id: 'yt:bad', tier: 'S' })).status, 400);
  assert.equal(
    (await post('action', { action: 'rating', id: 'yt:vid00000001', rating: 9 })).status,
    400,
  );
  assert.equal(
    (await post('youtube/decide', { ids: ['vid00000002'], status: 'kept' }, 'https://evil.example'))
      .status,
    403,
  );
  assert.equal((await post('youtube/decide', { ids: ['../../etc'], status: 'kept' })).status, 400);
  assert.equal(
    (await post('youtube/decide', { ids: ['vid00000002'], status: 'kept' })).status,
    200,
  );
  const get = async (url: string) =>
    (await (await GET(new NextRequest(`http://localhost:3000/api/media/${url}`))).json()).data;
  assert.equal((await get('youtube')).kept, 2);
  assert.equal((await get('youtube/videos?channel=%40chana')).total, 2);
  assert.equal((await post('youtube/rules', { rules: { '@chana': 'keep' } })).status, 200);
  assert.equal((await post('youtube/rules', { rules: { '@chana': 'always' } })).status, 400);
  assert.equal((await post('youtube/rules', { rules: {} })).status, 400);
  assert.equal((await get('youtube/rules')).channels[0].rule, 'keep');
  assert.ok(Array.isArray((await get('')).library));
  assert.ok(YouTubeError);
});
