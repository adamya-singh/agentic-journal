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
  enqueue,
  feedback,
  view,
  mergeCollection,
  withLock,
} from '../src/lib/media/store.ts';
import { processNext, recoverInterrupted } from '../src/lib/media/worker.ts';
import { IMDbError, titleUrl, collectionTotal, type IMDbSession } from '../src/lib/media/imdb.ts';
import { POST } from '../src/app/api/media/[[...path]]/route.ts';
import type { MediaTitle } from '../src/lib/media/types.ts';
let dir: string, previous: string | undefined;
const title = (id = 'tt123'): MediaTitle => ({
  id,
  title: 'A movie',
  url: titleUrl(id),
  collections: [],
  imdbRating: 9.5,
});
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  const s = initialState();
  s.titles.tt123 = title();
  s.recommendations = ['tt123'];
  writeState(s);
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});
const coverage = (complete: boolean) => ({
  total: complete ? 1 : 2,
  collected: 1,
  complete,
  at: new Date().toISOString(),
});
test('empty IMDb lists have no count widget; absence alone does not mean zero', () => {
  assert.equal(
    collectionTotal(
      '',
      "You haven't rated anything yet. Start rating titles and they will be listed here.",
    ),
    0,
  );
  assert.equal(collectionTotal('', 'This list is empty.'), 0);
  assert.equal(collectionTotal('1,031 items', ''), 1031);
  assert.throws(() => collectionTotal('', 'Please sign in'), /unavailable/);
});
const session = (patch: Partial<IMDbSession> = {}): IMDbSession => ({
  account: { id: 'owner', name: 'Adamya' },
  collection: async (c) => ({
    items: [{ ...title(), yourRating: c === 'ratings' ? 8 : undefined }],
    coverage: coverage(true),
  }),
  recommendations: async () => [title('tt456')],
  change: async () => ({ watched: true }),
  close: async () => {},
  ...patch,
});
test('watched is not liked and public IMDb scores are never personal scores', () => {
  const s = readState();
  mergeCollection(s, 'watched', [title()], coverage(true));
  writeState(s);
  assert.equal(view().library[0].watched, true);
  assert.equal(view().library[0].yourRating, undefined);
  assert.equal(view().picks.length, 0);
});
test('partial imports keep absent titles and removed memberships require complete evidence', () => {
  const s = readState();
  mergeCollection(s, 'watchlist', [title()], coverage(true));
  mergeCollection(s, 'watchlist', [title('tt456')], coverage(false));
  assert.equal(s.titles.tt123.watchlist, true);
  mergeCollection(s, 'watchlist', [title('tt456')], coverage(true));
  assert.equal(s.titles.tt123.watchlist, false);
  assert.deepEqual(s.titles.tt123.collections, []);
});
test("one collection cannot erase another collection's verified watched state", () => {
  const s = readState();
  mergeCollection(s, 'watched', [title()], coverage(true));
  mergeCollection(s, 'watchlist', [{ ...title(), watched: false }], coverage(true));
  assert.equal(s.titles.tt123.watched, true);
});
test('feedback persists across imports and restore brings recommendations back', async () => {
  await feedback('tt123', 'dismissed');
  assert.equal(view().picks.length, 0);
  assert.equal(view().dismissed.length, 1);
  await feedback('tt123', null);
  assert.equal(view().picks.length, 1);
  await feedback('tt123', 'interested');
  await enqueue('sync');
  await processNext(async () => session());
  assert.equal(readState().feedback.tt123, 'interested');
  assert.equal(readState().titles.tt123.yourRating, 8);
  assert.equal(view().picks[0].id, 'tt456');
});
test('double-clicks deduplicate jobs; no watched state is fabricated before confirmation', async () => {
  const [a, b] = await Promise.all([enqueue('seen', 'tt123'), enqueue('seen', 'tt123')]);
  assert.equal(a, b);
  assert.equal(readState().jobs.length, 1);
  assert.equal(readState().titles.tt123.watched, undefined);
  assert.equal(view().picks.length, 0);
  await processNext(async () => session());
  assert.equal(readState().jobs[0].status, 'succeeded');
  assert.equal(readState().titles.tt123.watched, true);
});
test('failed saves retain evidence and can be retried explicitly', async () => {
  await enqueue('seen', 'tt123');
  await processNext(async () =>
    session({
      change: async () => {
        throw new IMDbError('Not confirmed');
      },
    }),
  );
  assert.equal(readState().jobs[0].status, 'failed');
  assert.equal(readState().titles.tt123.watched, undefined);
  assert.equal(view().picks.length, 1);
  await enqueue('seen', 'tt123');
  await processNext(async () => session());
  assert.equal(readState().titles.tt123.watched, true);
});
test('interrupted running writes fail without automatic replay', async () => {
  await enqueue('seen', 'tt123');
  const s = readState();
  s.jobs[0].status = 'running';
  writeState(s);
  await recoverInterrupted();
  assert.equal(readState().jobs[0].status, 'failed');
  let connected = false;
  await processNext(async () => {
    connected = true;
    return session();
  });
  assert.equal(connected, false);
});
test('invalid titles, fractional scores and cross-origin requests cannot queue writes', async () => {
  assert.throws(() => titleUrl('tt123/../../'), /Invalid/);
  const req = (origin: string | undefined, rating: number) =>
    new NextRequest('http://localhost:3000/api/media/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify({ action: 'rating', id: 'tt123', rating }),
    });
  assert.equal((await POST(req('https://evil.example', 8))).status, 403);
  assert.equal((await POST(req(undefined, 8))).status, 403);
  assert.equal((await POST(req('http://localhost:3000', 8.5))).status, 400);
  assert.equal((await POST(req('http://localhost:3000', 8))).status, 202);
  assert.equal(readState().jobs.length, 1);
});
test('concurrent feedback and queue mutations do not lose writes', async () => {
  await Promise.all([feedback('tt123', 'interested'), enqueue('watchlist', 'tt123')]);
  assert.equal(readState().feedback.tt123, 'interested');
  assert.equal(readState().jobs.length, 1);
  await withLock(() => {
    const s = readState();
    assert.equal(s.version, 1);
  });
});
test('optional metadata failures do not discard successful account imports or new recommendations', async () => {
  await enqueue('sync');
  await processNext(async () =>
    session({
      enrich: async () => {
        throw new Error('Unavailable public title details');
      },
    }),
  );
  const s = readState();
  assert.equal(s.jobs.at(-1)?.status, 'succeeded');
  assert.equal(s.titles.tt123.yourRating, 8);
  assert.equal(view().picks[0].id, 'tt456');
  assert.match(s.warning || '', /details are unavailable/);
});
