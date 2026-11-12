import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { initialState, readState, view, writeState } from '../src/lib/media/store.ts';
import {
  addText,
  applyAddition,
  clarify,
  confirm,
  inboxView,
  parseReply,
  readInbox,
  verify,
  withInbox,
  type Fetch,
} from '../src/lib/media/inbox.ts';
import { GET, POST } from '../src/app/api/media/[[...path]]/route.ts';

let dir: string, previous: string | undefined, agent: string | undefined;
beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  agent = process.env.MEDIA_INBOX_AGENT_DISABLED;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-inbox-'));
  process.env.BACKEND_DATA_DIR = dir;
  // Route tests must never start a real OpenClaw turn.
  process.env.MEDIA_INBOX_AGENT_DISABLED = '1';
  writeState(initialState());
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  if (agent === undefined) delete process.env.MEDIA_INBOX_AGENT_DISABLED;
  else process.env.MEDIA_INBOX_AGENT_DISABLED = agent;
  fs.rmSync(dir, { recursive: true, force: true });
});

const hit = (id: string, l: string, y: number, qid = 'tvSeries') => ({
  id,
  l,
  y,
  qid,
  q: qid === 'movie' ? 'feature' : 'TV series',
  i: { imageUrl: `https://m.media-amazon.com/images/M/${id}._V1_.jpg` },
});
// A tiny IMDb: id lookups and title searches, both from the same table.
const TABLE = [
  hit('tt13616990', 'Chainsaw Man', 2022),
  hit('tt30472557', 'Chainsaw Man - The Movie: Reze Arc', 2025, 'movie'),
  hit('tt11280740', 'Severance', 2022),
  hit('tt0816692', 'Interstellar', 2014, 'movie'),
  { id: 'nm0000123', l: 'Some Person' },
];
const fakeImdb: Fetch = async (url) => {
  const key = decodeURIComponent(url.split('/').pop()!.replace('.json', ''));
  if (key.startsWith('tt')) return { d: TABLE.filter((d) => d.id === key) };
  const q = key.replace(/_/g, ' ');
  return { d: TABLE.filter((d) => d.l.toLowerCase().includes(q)) };
};

test('verify keeps real ids, searches titles without one and fills in other matches', async () => {
  const reading = parseReply({
    additions: [
      {
        phrase: 'that anime with the chainsaw guy',
        candidates: [{ imdbId: null, title: 'Chainsaw Man', year: '2022' }],
        status: 'want',
        favorite: false,
        download: false,
        note: 'Guessing the anime series',
      },
      // A real id for a different title is a wrong id: the title wins.
      {
        phrase: 'severance',
        candidates: [{ imdbId: 'tt0816692', title: 'Severance', year: 2022 }],
        status: 'finished',
        favorite: true,
      },
      { phrase: 'the hobbit book', candidates: [], status: 'none', note: 'A book, not a film' },
    ],
  });
  assert.ok(reading);
  const [chainsaw, severance, book] = await verify(reading, fakeImdb);
  assert.deepEqual(
    chainsaw.candidates.map((c) => c.id),
    ['tt13616990', 'tt30472557'],
  );
  assert.equal(chainsaw.candidates[0].type, 'TVSeries');
  assert.equal(chainsaw.candidates[1].type, 'Movie');
  assert.match(chainsaw.candidates[0].poster!, /_V1_UX400\.jpg$/);
  assert.equal(chainsaw.settings.status, 'want');
  assert.deepEqual(
    severance.candidates.map((c) => c.id),
    ['tt11280740'],
  );
  assert.deepEqual(severance.settings, { status: 'finished', favorite: true, download: false });
  assert.equal(book.candidates.length, 0);
  assert.equal(parseReply({ nope: true }), undefined);
});

test('applyAddition saves Journal flags and queues IMDb only for watches and Watchlist adds', () => {
  const s = initialState();
  const c = { id: 'tt0816692', title: 'Interstellar', year: '2014', type: 'Movie', label: 'feature' };
  applyAddition(s, c, { status: 'finished', favorite: true, download: true });
  const t = s.titles.tt0816692;
  assert.equal(t.favorite, true);
  assert.equal(t.download, true);
  assert.ok(t.addedAt);
  assert.deepEqual(
    s.jobs.map((j) => [j.action, j.titleId]),
    [['seen', 'tt0816692']],
  );
  // Again with the watch still queued: no duplicate, and the flags can be turned off.
  applyAddition(s, c, { status: 'finished', favorite: false, download: false });
  assert.equal(s.jobs.length, 1);
  assert.equal(t.favorite, undefined);
  // Watching is Journal-only; Want to watch goes to the Watchlist unless already watched.
  applyAddition(s, { ...c, id: 'tt11280740', title: 'Severance' }, { status: 'watching', favorite: false, download: false });
  assert.equal(s.titles.tt11280740.watching, true);
  applyAddition(s, { ...c, id: 'tt13616990', title: 'Chainsaw Man' }, { status: 'want', favorite: false, download: false });
  assert.deepEqual(
    s.jobs.map((j) => j.action),
    ['seen', 'watchlist'],
  );
});

const ready = (id: string) =>
  withInbox((inbox) => {
    const e = inbox.entries.find((x) => x.id === id)!;
    e.status = 'ready';
    e.additions.push({
      id: '6b0f9a4e-8b1f-4b52-9a8e-3d2b7f6c1a01',
      phrase: 'that chainsaw anime',
      candidates: [
        { id: 'tt13616990', title: 'Chainsaw Man', year: '2022', type: 'TVSeries', label: 'TV series' },
        { id: 'tt30472557', title: 'Chainsaw Man - The Movie: Reze Arc', year: '2025', type: 'Movie', label: 'feature' },
      ],
      settings: { status: 'want', favorite: false, download: false },
      state: 'pending',
    });
  });

test('confirm puts the picked match in the library and clears it from pending', async () => {
  const id = await addText('  that chainsaw anime, want to watch  ');
  assert.equal(readInbox().entries[0].text, 'that chainsaw anime, want to watch');
  assert.equal(inboxView().reading.length, 1);
  await ready(id);
  assert.equal(inboxView().pending.length, 1);
  await assert.rejects(
    confirm('6b0f9a4e-8b1f-4b52-9a8e-3d2b7f6c1a01', 'tt0000001', { status: 'none', favorite: false, download: false }),
    /Pick one of the matches/,
  );
  await confirm('6b0f9a4e-8b1f-4b52-9a8e-3d2b7f6c1a01', 'tt30472557', { status: 'none', favorite: true, download: true });
  const v = inboxView();
  assert.equal(v.pending.length, 0);
  assert.equal(v.recent[0].title, 'Chainsaw Man - The Movie: Reze Arc');
  // In the library before IMDb ever hears of it, with no IMDb job for "Just add".
  const lib = view().library;
  assert.deepEqual(
    lib.map((t) => [t.id, t.favorite, t.download]),
    [['tt30472557', true, true]],
  );
  assert.equal(readState().jobs.length, 0);
  await assert.rejects(
    confirm('6b0f9a4e-8b1f-4b52-9a8e-3d2b7f6c1a01', 'tt30472557', { status: 'none', favorite: true, download: true }),
    /already done/,
  );
});

test('clarify drops the addition and queues a new read with your hint', async () => {
  await ready(await addText('that chainsaw anime'));
  await clarify('6b0f9a4e-8b1f-4b52-9a8e-3d2b7f6c1a01', 'the manga one');
  const v = inboxView();
  assert.equal(v.pending.length, 0);
  assert.equal(v.reading.length, 1);
  assert.match(v.reading[0].text, /^that chainsaw anime — the manga one \(not Chainsaw Man \(2022\), /);
});

const post = (action: string, body: unknown, origin = 'http://localhost:3000') =>
  POST(
    new NextRequest(`http://localhost:3000/api/media/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', origin },
      body: JSON.stringify(body),
    }),
  );

test('the route adds text, confirms, and sets flags on library titles', async () => {
  assert.equal((await post('inbox/add', { text: 'severance' }, 'https://evil.example')).status, 403);
  assert.equal((await post('inbox/add', { text: '   ' })).status, 400);
  const added = await post('inbox/add', { text: 'severance' });
  assert.equal(added.status, 201);
  const entry = readInbox().entries[0];
  await ready(entry.id);
  const got = await (await GET(new NextRequest('http://localhost:3000/api/media/inbox'))).json();
  assert.equal(got.data.pending[0].id, '6b0f9a4e-8b1f-4b52-9a8e-3d2b7f6c1a01');
  const confirmed = await post('inbox/confirm', {
    id: '6b0f9a4e-8b1f-4b52-9a8e-3d2b7f6c1a01',
    pick: 'tt13616990',
    settings: { status: 'want', favorite: false, download: false },
  });
  assert.equal(confirmed.status, 200);
  assert.equal((await confirmed.json()).data.title, 'Chainsaw Man');
  assert.deepEqual(
    readState().jobs.map((j) => j.action),
    ['watchlist'],
  );
  const flagged = await post('title/flags', { id: 'tt13616990', favorite: true });
  assert.equal(flagged.status, 200);
  assert.equal(readState().titles.tt13616990.favorite, true);
  await post('title/flags', { id: 'tt13616990', favorite: false });
  assert.equal(readState().titles.tt13616990.favorite, undefined);
  assert.equal((await post('title/flags', { id: 'tt999', download: true })).status, 400);
});
