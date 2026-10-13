import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  initialState,
  readState,
  writeState,
  rank,
  syncRatings,
  view,
} from '../src/lib/media/store.ts';
import {
  applyRankOp,
  emptyRanking,
  outOfSync,
  rankedList,
  unsorted,
} from '../src/lib/media/ranking.ts';
import { processNext } from '../src/lib/media/worker.ts';
import { titleUrl } from '../src/lib/media/imdb.ts';
import { POST } from '../src/app/api/media/[[...path]]/route.ts';
import type { MediaTitle } from '../src/lib/media/types.ts';

const title = (id: string, extra: Partial<MediaTitle> = {}): MediaTitle => ({
  id,
  title: id,
  url: titleUrl(id),
  collections: ['watched'],
  watched: true,
  ...extra,
});
let dir: string, previous: string | undefined;
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-rank-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  const s = initialState();
  for (const id of ['tt1', 'tt2', 'tt3', 'tt4', 'tt5']) s.titles[id] = title(id);
  s.titles.tt9 = title('tt9', { collections: [], watched: false });
  writeState(s);
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the first title in a tier is placed; later ones wait for head-to-head picks', () => {
  let r = applyRankOp(emptyRanking(), { op: 'tier', id: 'tt1', tier: 'A' });
  r = applyRankOp(r, { op: 'tier', id: 'tt2', tier: 'A' });
  assert.deepEqual(r.tiers.A, ['tt1']);
  assert.deepEqual(r.pending.A, ['tt2']);
  r = applyRankOp(r, { op: 'place', id: 'tt2', tier: 'A', index: 0 });
  assert.deepEqual(r.tiers.A, ['tt2', 'tt1']);
  assert.deepEqual(r.pending.A, []);
  assert.throws(() => applyRankOp(r, { op: 'place', id: 'tt3', tier: 'A', index: 5 }), RangeError);
});

test('moving a title removes it from wherever it was', () => {
  let r = applyRankOp(emptyRanking(), { op: 'tier', id: 'tt1', tier: 'S' });
  r = applyRankOp(r, { op: 'skip', id: 'tt2' });
  r = applyRankOp(r, { op: 'tier', id: 'tt2', tier: 'S' });
  r = applyRankOp(r, { op: 'tier', id: 'tt1', tier: 'C' });
  assert.deepEqual(r.skipped, []);
  assert.deepEqual(r.tiers.S, []);
  assert.deepEqual(r.pending.S, ['tt2']);
  assert.deepEqual(r.tiers.C, ['tt1']);
});

test('scores come from tier and position; the better half rounds up', () => {
  const r = emptyRanking();
  r.tiers.S = ['tt1'];
  r.tiers.A = ['tt2', 'tt3', 'tt4'];
  r.tiers.C = ['tt5'];
  assert.deepEqual(
    rankedList(r).map((x) => [x.id, x.rank, x.score]),
    [
      ['tt1', 1, 10],
      ['tt2', 2, 8],
      ['tt3', 3, 8],
      ['tt4', 4, 7],
      ['tt5', 5, 4],
    ],
  );
});

test('only watched titles the ranking has not seen are unsorted', () => {
  const r = applyRankOp(emptyRanking(), { op: 'skip', id: 'tt2' });
  const titles = Object.values(readState().titles);
  assert.deepEqual(unsorted(r, titles), ['tt1', 'tt3', 'tt4', 'tt5']);
});

test('sync queues one rating per changed score and skips scores IMDb already has', async () => {
  const s = readState();
  s.titles.tt2.yourRating = 7;
  writeState(s);
  await rank({ op: 'tier', id: 'tt1', tier: 'A' });
  await rank({ op: 'tier', id: 'tt2', tier: 'A' });
  await rank({ op: 'place', id: 'tt2', tier: 'A', index: 1 });
  assert.deepEqual(outOfSync(view().ranking, readState().titles), [{ id: 'tt1', rating: 8 }]);
  assert.deepEqual(await syncRatings(), { queued: 1, waiting: 0 });
  assert.deepEqual(await syncRatings(), { queued: 0, waiting: 0 });
  // A score that changes while its first save is in flight waits for the next sync.
  await rank({ op: 'tier', id: 'tt1', tier: 'S' });
  assert.deepEqual(await syncRatings(), { queued: 1, waiting: 1 });
  assert.deepEqual(
    readState().jobs.map((j) => [j.action, j.titleId, j.rating]),
    [
      ['rating', 'tt1', 8],
      ['rating', 'tt2', 8],
    ],
  );
});

test('the ranking API validates ops and requires a same-origin request', async () => {
  const post = (pathname: string, body: unknown, origin = 'http://127.0.0.1:3000') =>
    POST(
      new NextRequest(`http://127.0.0.1:3000/api/media/${pathname}`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  assert.equal(
    (await post('ranking', { op: 'tier', id: 'tt1', tier: 'S' }, 'https://evil.test')).status,
    403,
  );
  assert.equal((await post('ranking', { op: 'tier', id: 'tt1', tier: 'X' })).status, 400);
  assert.equal((await post('ranking', { op: 'tier', id: 'tt77', tier: 'S' })).status, 400);
  const ok = await post('ranking', { op: 'tier', id: 'tt1', tier: 'S' });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).data.ranking.tiers.S, ['tt1']);
  const sync = await post('ranking/sync', {});
  assert.equal(sync.status, 202);
  assert.equal((await sync.json()).data.queued, 1);
});

test('a finished rating save queues scores that changed while it ran', async () => {
  await rank({ op: 'tier', id: 'tt1', tier: 'A' });
  await syncRatings();
  await rank({ op: 'tier', id: 'tt1', tier: 'S' });
  await processNext(async () => ({
    account: { id: 'owner', name: 'Adamya' },
    collection: async () => ({
      items: [],
      coverage: { total: 0, collected: 0, complete: true, at: '' },
    }),
    recommendations: async () => [],
    change: async (job) => ({ yourRating: job.rating }),
    close: async () => {},
  }));
  const jobs = readState().jobs.map((j) => [j.titleId, j.rating, j.status]);
  assert.deepEqual(jobs, [
    ['tt1', 8, 'succeeded'],
    ['tt1', 10, 'queued'],
  ]);
});
