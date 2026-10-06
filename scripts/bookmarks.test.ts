import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initialState,
  readState,
  writeJson,
  readSources,
  listBookmarks,
  getBookmark,
  updateBookmark,
  dataRoot,
  withLock,
  ensureSavedRanks,
} from '../src/lib/bookmarks/store.ts';
import {
  startSync,
  processJob,
  settings,
  status,
  cancelSync,
  recoverInterrupted,
  billingMonth,
  importFolders,
} from '../src/lib/bookmarks/sync.ts';
import {
  credentials,
  beginOAuth,
  completeOAuth,
  accessToken,
  normalizePost,
  xRequest,
  safeReason,
  XError,
} from '../src/lib/bookmarks/x-client.ts';
import { GET, POST } from '../src/app/api/bookmarks/[[...path]]/route.ts';
import { NextRequest } from 'next/server';
import type { BookmarkSource } from '../src/lib/bookmarks/types.ts';
let dir: string, oldDir: string | undefined;
beforeEach(() => {
  oldDir = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmarks-test-'));
  process.env.BACKEND_DATA_DIR = dir;
  process.env.X_CLIENT_ID = 'test-client';
  process.env.X_CLIENT_SECRET = 'test-secret';
  writeJson('state.json', {
    ...initialState(),
    accountId: '42',
    username: 'reader',
    budgetConfirmed: true,
  });
  writeJson('credentials.json', {
    accessToken: 'private-access',
    refreshToken: 'private-refresh',
    expiresAt: Date.now() + 999_000,
    accountId: '42',
    localKey: 'local-private',
  });
});
afterEach(() => {
  if (oldDir === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = oldDir;
  delete process.env.X_CLIENT_ID;
  delete process.env.X_CLIENT_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});
function page(ids: string[], next?: string) {
  return {
    data: ids.map((id) => ({
      id,
      text: `An idea ${id}`,
      author_id: '7',
      created_at: '2026-01-01T00:00:00Z',
    })),
    includes: { users: [{ id: '7', name: 'A Writer', username: 'writer' }] },
    meta: { result_count: ids.length, ...(next ? { next_token: next } : {}) },
  };
}
function fake(pages: unknown[], urls: string[] = []) {
  return (async (input: string | URL | Request) => {
    urls.push(String(input));
    assert.ok(pages.length, 'unexpected paid request');
    return Response.json(pages.shift());
  }) as typeof fetch;
}
async function reviewed() {
  await withLock(() => {
    const s = readState();
    s.pilotComplete = true;
    s.pilotReviewed = true;
    writeJson('state.json', s);
  });
}

test('five-post pilot pauses and explicit reviewed resume completes history', async () => {
  const urls: string[] = [];
  await startSync();
  await processJob(fake([page(['9', '8'], 'older')], urls));
  assert.equal(urls.length, 1);
  assert.equal(readState().job?.status, 'paused');
  assert.equal(readState().historyCursor, 'older');
  await assert.rejects(startSync(true), /Review the pilot/);
  await settings({ pilotReviewed: true });
  await startSync(true);
  await processJob(fake([page(['7'])], urls));
  assert.equal(new URL(urls[1]).searchParams.get('pagination_token'), 'older');
  assert.equal(readState().historyComplete, true);
  assert.equal(readState().job?.status, 'completed');
  assert.equal(listBookmarks().total, 3);
});
test('incremental sync stops at a fully known page and preserves metadata and import time', async () => {
  await reviewed();
  await startSync();
  await processJob(fake([page(['8', '7'])]));
  const imported = getBookmark('42:8')!.importedAt;
  await updateBookmark('42:8', { favorite: true, read: true, tags: ['research'] });
  await startSync();
  const urls: string[] = [];
  await processJob(fake([page(['9', '8'], 'next'), page(['7'], 'unneeded')], urls));
  assert.equal(urls.length, 2);
  assert.equal(readState().job?.status, 'completed');
  assert.equal(getBookmark('42:8')!.importedAt, imported);
  assert.equal(getBookmark('42:8')!.favorite, true);
  assert.deepEqual(getBookmark('42:8')!.tags, ['research']);
});
test('cancelled partial history checkpoint survives a new recent sync', async () => {
  await reviewed();
  await startSync();
  const urls: string[] = [];
  const request = (async () => {
    await cancelSync();
    return Response.json(page(['9', '8'], 'deep'));
  }) as typeof fetch;
  await processJob(request);
  assert.equal(readState().job?.status, 'cancelled');
  assert.equal(readState().historyCursor, 'deep');
  await startSync();
  await processJob(fake([page(['10', '9'], 'boundary'), page(['8'], 'mid'), page(['7'])], urls));
  assert.equal(new URL(urls[2]).searchParams.get('pagination_token'), 'deep');
  assert.equal(listBookmarks().total, 4);
});
test('duplicate records are idempotent', async () => {
  await reviewed();
  await startSync();
  await processJob(fake([page(['9', '9'], 'p2'), page(['9'])]));
  assert.equal(listBookmarks().total, 1);
  assert.equal(readState().job?.imported, 1);
});
test('manual cancellation finishes the in-flight page without requesting another', async () => {
  await reviewed();
  await startSync();
  let calls = 0;
  await processJob((async () => {
    calls++;
    await cancelSync();
    return Response.json(page(['9'], 'more'));
  }) as typeof fetch);
  assert.equal(calls, 1);
  assert.equal(readState().job?.status, 'cancelled');
  assert.equal(listBookmarks().total, 1);
});
test('restart and date changes never fetch or resume a queued/running job', async () => {
  await reviewed();
  await startSync();
  await recoverInterrupted();
  let calls = 0;
  await processJob((async () => {
    calls++;
    throw new Error();
  }) as typeof fetch);
  const s = readState();
  s.usage['2000-01'] = 5;
  writeJson('state.json', s);
  listBookmarks();
  getBookmark('42:9');
  status();
  assert.equal(calls, 0);
  assert.equal(readState().job?.status, 'paused');
});
test('concurrent starts share a job and only one processor can claim it', async () => {
  await reviewed();
  const ids = await Promise.all([startSync(), startSync()]);
  assert.equal(ids[0], ids[1]);
  let calls = 0;
  const request = (async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 50));
    return Response.json(page(['9']));
  }) as typeof fetch;
  await Promise.all([processJob(request), processJob(request)]);
  assert.equal(calls, 1);
});
for (const [code, expected] of [
  [429, /rate limit/],
  [402, /credits/],
  [401, /denied/],
  [403, /denied/],
  [500, /error/],
] as const) {
  test(`X ${code} pauses without disclosing response secrets`, async () => {
    await reviewed();
    await startSync();
    await processJob((async () =>
      Response.json(
        { message: 'private-access private-refresh' },
        { status: code },
      )) as typeof fetch);
    assert.equal(readState().job?.status, 'paused');
    assert.match(readState().job!.reason!, expected);
    assert.doesNotMatch(JSON.stringify(status()), /private-access|private-refresh|local-private/);
  });
}
test('expired pagination cursor restarts only on explicit resume', async () => {
  await reviewed();
  await startSync();
  await processJob(fake([page(['9'], 'expired'), { meta: { result_count: 2 } }]));
  assert.equal(readState().job?.cursor, 'expired');
  await startSync(true);
  await processJob((async () => Response.json({}, { status: 400 })) as typeof fetch);
  assert.equal(readState().job?.cursor, undefined);
  assert.equal(readState().job?.status, 'paused');
  await startSync(true);
  const urls: string[] = [];
  await processJob(fake([page(['9', '8'])], urls));
  assert.equal(new URL(urls[0]).searchParams.has('pagination_token'), false);
});
test('malformed page is not committed and budget reservation is retained', async () => {
  await reviewed();
  await startSync();
  await processJob(fake([{ data: [{ id: '9' }], meta: { result_count: 1 } }]));
  assert.equal(Object.keys(readSources()).length, 0);
  assert.equal(readState().job?.status, 'paused');
  assert.ok(status().estimate > 0);
});
test('budget limits paid fetching but not local reading', async () => {
  await reviewed();
  const s = readState();
  s.usage[billingMonth()] = 4.99;
  writeJson('state.json', s);
  await assert.rejects(startSync(), /allowance/);
  assert.equal(listBookmarks().total, 0);
});
test('normalization supports long text, media and safe link previews', () => {
  const source = normalizePost(
    {
      id: '9',
      text: 'short',
      author_id: '7',
      note_post: {
        text: 'long text',
        entities: {
          urls: [
            {
              expanded_url: 'https://example.com/article',
              title: 'Interesting',
              images: [{ url: 'javascript:alert(1)' }],
            },
          ],
        },
      },
      attachments: { media_keys: ['m'] },
    },
    {
      users: [{ id: '7', name: 'Writer', username: 'writer' }],
      media: [
        {
          media_key: 'm',
          type: 'photo',
          url: 'https://pbs.twimg.com/image',
          alt_text: 'A diagram',
        },
      ],
    },
    '42',
    '2026-10-05',
  );
  assert.equal(source.text, 'long text');
  assert.equal(source.links[0].image, undefined);
  assert.equal(source.media[0].alt, 'A diagram');
});
test('search, tags, read and media filters use local data and retain missing X saves', async () => {
  await reviewed();
  await startSync();
  await processJob(fake([page(['9', '8'])]));
  await updateBookmark('42:9', { tags: ['research'], read: true, favorite: true });
  assert.equal(
    listBookmarks(new URLSearchParams({ q: 'research writer', favorite: 'true' })).total,
    1,
  );
  assert.equal(listBookmarks(new URLSearchParams({ unread: 'true' })).total, 1);
  assert.equal(listBookmarks(new URLSearchParams({ media: 'photo' })).total, 0);
  await startSync();
  await processJob(fake([page([])]));
  assert.equal(listBookmarks().total, 2);
});
test('OAuth state rejects mismatch, expires, and is single-use', async () => {
  const auth = await beginOAuth();
  let calls = 0;
  const request = (async () => {
    calls++;
    return Response.json({});
  }) as typeof fetch;
  await assert.rejects(completeOAuth('code', auth.state, 'wrong-cookie', request), /verified/);
  assert.equal(calls, 0);
  const c = credentials();
  c.pending!.expiresAt = 0;
  writeJson('credentials.json', c);
  await assert.rejects(completeOAuth('code', auth.state, auth.state, request), /expired/);
  assert.equal(calls, 0);
  const fresh = await beginOAuth();
  await completeOAuth(
    'code',
    fresh.state,
    fresh.state,
    fake([
      { access_token: 'new-secret', refresh_token: 'new-refresh', expires_in: 7200 },
      { data: { id: '42', username: 'reader' } },
    ]),
  );
  await assert.rejects(completeOAuth('code', fresh.state, fresh.state, request), /verified/);
  assert.equal(fs.statSync(path.join(dataRoot(), 'credentials.json')).mode & 0o777, 0o600);
});
async function callback(
  responses: (() => Response)[],
  query: (state: string) => string = (state) => `code=private-code&state=${state}`,
  cookie?: string,
) {
  const auth = await beginOAuth();
  const original = globalThis.fetch,
    originalWarn = console.warn,
    logs: string[] = [];
  globalThis.fetch = (async () => {
    assert.ok(responses.length, 'unexpected X request');
    return responses.shift()!();
  }) as typeof fetch;
  console.warn = (...args: unknown[]) => void logs.push(args.map(String).join(' '));
  try {
    const r = await GET(
      new NextRequest(`http://localhost:3000/api/bookmarks/oauth/callback?${query(auth.state)}`, {
        headers: { Cookie: `x_bookmarks_state=${cookie ?? auth.state}` },
      }),
    );
    const location = new URL(r.headers.get('location')!);
    return { location, logs, failure: readState().lastConnectionError, state: auth.state };
  } finally {
    globalThis.fetch = original;
    console.warn = originalWarn;
  }
}
const tokenOk = () =>
  Response.json({ access_token: 'new-secret', refresh_token: 'new-refresh', expires_in: 7200 });
function assertRedacted(text: string, state: string) {
  for (const secret of ['private-code', 'new-secret', 'new-refresh', 'test-secret', state, 'leak'])
    assert.ok(!text.includes(secret), 'diagnostic leaked a secret');
}
test('account lookup failure reports stage and sanitized X status without keeping tokens', async () => {
  writeJson('credentials.json', {});
  const { location, logs, failure, state } = await callback([
    tokenOk,
    () =>
      Response.json(
        {
          title: 'CreditsDepleted',
          detail: 'leak new-secret',
          type: 'https://api.x.com/2/problems/x',
        },
        { status: 402 },
      ),
  ]);
  assert.equal(location.searchParams.get('connection_error'), 'account_lookup');
  assert.equal(failure?.stage, 'account_lookup');
  assert.equal(failure?.status, 402);
  assert.equal(failure?.reason, 'CreditsDepleted');
  assert.match(failure!.message, /users\/me.*HTTP 402.*Add X API credits/);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /stage=account_lookup status=402 reason=CreditsDepleted/);
  assertRedacted(JSON.stringify({ location: location.href, logs, failure }), state);
  assert.equal(credentials().accessToken, undefined);
  assert.equal(credentials().pending, undefined);
  assert.equal(status().connected, false);
});
test('token exchange rejection reports the exchange stage, not a refresh failure', async () => {
  const { location, failure, logs, state } = await callback([
    () =>
      Response.json(
        { error: 'invalid_request', error_description: 'leak private-code' },
        { status: 400 },
      ),
  ]);
  assert.equal(location.searchParams.get('connection_error'), 'token_exchange');
  assert.deepEqual(
    { stage: failure?.stage, status: failure?.status, reason: failure?.reason },
    { stage: 'token_exchange', status: 400, reason: 'invalid_request' },
  );
  assert.match(failure!.message, /exchanging the authorization code.*callback URL/);
  assert.doesNotMatch(failure!.message, /renewed/);
  assertRedacted(JSON.stringify({ location: location.href, logs, failure }), state);
  assert.equal(credentials().accessToken, 'private-access');
});
test('denied authorization and cookie mismatch report their stage without calling X', async () => {
  const denied = await callback([], (state) => `error=access_denied&state=${state}`);
  assert.equal(denied.location.searchParams.get('connection_error'), 'authorize');
  assert.equal(denied.failure?.reason, 'access_denied');
  const mismatch = await callback([], undefined, 'other-cookie');
  assert.equal(mismatch.failure?.stage, 'state');
  assert.equal(mismatch.failure?.reason, 'cookie_mismatch');
  assert.ok(credentials().pending, 'unverified callbacks must not consume the pending request');
});
test('successful callback stores the account and clears the last connection error', async () => {
  writeJson('credentials.json', {});
  await callback([() => Response.json({}, { status: 503 })]);
  assert.equal(readState().lastConnectionError?.stage, 'token_exchange');
  const ok = await callback([
    tokenOk,
    () => Response.json({ data: { id: '42', username: 'reader' } }),
  ]);
  assert.equal(ok.location.searchParams.get('connected'), 'true');
  assert.equal(ok.failure, undefined);
  assert.equal(credentials().accessToken, 'new-secret');
  assert.equal(status().connected, true);
  assert.equal(JSON.stringify(status()).includes('new-secret'), false);
});
test('X error reasons keep only short identifier codes', async () => {
  const fail = (body: unknown, code = 403) =>
    xRequest('https://api.x.com', {}, (async () =>
      Response.json(body, { status: code })) as typeof fetch);
  await assert.rejects(fail({ title: 'Unsupported Authentication' }), (e: XError) => {
    assert.equal(e.reason, 'Unsupported Authentication');
    return e.status === 403 && e.kind === 'authentication';
  });
  await assert.rejects(
    fail({ title: 'Client Forbidden', reason: 'client-not-enrolled', detail: 'leak' }),
    (e: XError) => {
      assert.equal(e.reason, 'Client Forbidden - client-not-enrolled');
      return true;
    },
  );
  await assert.rejects(fail({ reason: 'client-not-enrolled' }), (e: XError) => {
    assert.equal(e.reason, 'client-not-enrolled');
    return true;
  });
  await assert.rejects(fail({ title: 'token=leak&x', detail: 'leak' }), (e: XError) => {
    assert.equal(e.reason, undefined);
    return true;
  });
  assert.equal(
    safeReason('https://api.twitter.com/2/problems/client-forbidden'),
    'client-forbidden',
  );
  assert.equal(safeReason('a'.repeat(80)), undefined);
});
test('token refresh rotates credentials atomically and concurrent calls refresh once', async () => {
  writeJson('credentials.json', { ...credentials(), expiresAt: 0 });
  let calls = 0;
  const request = (async () => {
    calls++;
    return Response.json({
      access_token: 'rotated',
      refresh_token: 'rotated-refresh',
      expires_in: 7200,
    });
  }) as typeof fetch;
  const tokens = await Promise.all([accessToken(request), accessToken(request)]);
  assert.deepEqual(tokens, ['rotated', 'rotated']);
  assert.equal(calls, 1);
  assert.equal(credentials().refreshToken, 'rotated-refresh');
});
test('network and malformed errors are redacted', async () => {
  await assert.rejects(
    xRequest('https://api.x.com', {}, (async () => {
      throw new Error('private-access');
    }) as typeof fetch),
    /could not be reached/,
  );
  await assert.rejects(
    xRequest('https://api.x.com', {}, (async () => new Response('private-access')) as typeof fetch),
    /invalid response/,
  );
});
test('API reads are local, mutations reject cross-origin and missing authentication', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    throw new Error();
  }) as typeof fetch;
  try {
    for (const suffix of ['', '/status', '/item?key=42:9'])
      await GET(new NextRequest(`http://localhost:3000/api/bookmarks${suffix}`));
    assert.equal(calls, 0);
    for (const origin of [undefined, 'https://evil.example', 'null']) {
      const r = await POST(
        new NextRequest('http://localhost:3000/api/bookmarks/sync', {
          method: 'POST',
          headers: origin ? { Origin: origin } : {},
        }),
      );
      assert.equal(r.status, 403);
    }
    const r = await POST(
      new NextRequest('http://localhost:3000/api/bookmarks/settings', {
        method: 'POST',
        headers: { Authorization: 'Bearer local-private', 'Content-Type': 'application/json' },
        body: JSON.stringify({ budgetConfirmed: false }),
      }),
    );
    assert.equal(r.status, 200);
    assert.equal(readState().budgetConfirmed, false);
  } finally {
    globalThis.fetch = original;
  }
});

test('cross-process writers serialize changes and recover a dead lock owner', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  fs.mkdirSync(path.join(dataRoot(), '.store-lock'));
  fs.writeFileSync(path.join(dataRoot(), '.store-lock/pid'), '99999999');
  const source = `import {withLock,readState,writeJson} from ${JSON.stringify(new URL('../src/lib/bookmarks/store.ts', import.meta.url).href)}; for(let i=0;i<4;i++) await withLock(async()=>{const s=readState(); const n=s.usage.counter||0; await new Promise(r=>setTimeout(r,5));s.usage.counter=n+1;writeJson('state.json',s);});`;
  await Promise.all([
    run(process.execPath, ['--input-type=module', '-e', source]),
    run(process.execPath, ['--input-type=module', '-e', source]),
  ]);
  assert.equal(readState().usage.counter, 8);
});
test('a completed pilot resumes without another paid fetch', async () => {
  await startSync();
  await processJob(fake([page(['9'])]));
  await settings({ pilotReviewed: true });
  await startSync(true);
  let calls = 0;
  await processJob((async () => {
    calls++;
    throw new Error();
  }) as typeof fetch);
  assert.equal(calls, 0);
  assert.equal(readState().job?.status, 'completed');
});
test('revoked refresh access pauses and never replaces valid stored credentials with an error', async () => {
  const before = credentials();
  writeJson('credentials.json', { ...before, expiresAt: 0 });
  await assert.rejects(
    accessToken((async () =>
      Response.json({ access_token: 'bad' }, { status: 401 })) as typeof fetch),
    /denied/,
  );
  assert.equal(credentials().accessToken, before.accessToken);
});

test('cyclic pagination pauses instead of repeatedly charging for duplicate pages', async () => {
  await reviewed();
  await startSync();
  const urls: string[] = [];
  await processJob(fake([page(['9'], 'a'), page(['8'], 'b'), page(['7'], 'a')], urls));
  assert.equal(urls.length, 3);
  assert.equal(readState().job?.status, 'paused');
  assert.match(readState().job!.reason!, /pagination/);
  assert.equal(listBookmarks().total, 2);
});

test('saved order follows X across history pages and puts new saves on top', async () => {
  await reviewed();
  await startSync();
  await processJob(fake([page(['9', '8'], 'older'), page(['7', '6'])]));
  const order = () => listBookmarks().items.map((i) => i.id);
  assert.deepEqual(order(), ['9', '8', '7', '6']);
  assert.deepEqual(
    listBookmarks(new URLSearchParams({ sort: 'saved-oldest' })).items.map((i) => i.id),
    ['6', '7', '8', '9'],
  );
  await startSync();
  await processJob(fake([page(['11', '10', '9'], 'next')]));
  assert.deepEqual(order(), ['11', '10', '9', '8', '7', '6']);
});
test('legacy imports recover X order from per-page import timestamps', () => {
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 6) + ms).toISOString();
  const src = (id: string, ms: number): BookmarkSource => ({
    id,
    accountId: '42',
    text: id,
    url: '',
    importedAt: at(ms),
    author: { id: '7', name: 'A', username: 'a' },
    media: [],
    links: [],
  });
  // Page one at t=0 (posts 9, 8), page two imported a second later (posts 7, 6).
  const sources = {
    '42:9': src('9', 0),
    '42:8': src('8', -1),
    '42:7': src('7', 1000),
    '42:6': src('6', 999),
  };
  assert.equal(ensureSavedRanks(sources), true);
  const ranked = Object.values(sources).sort((a, b) => b.savedRank! - a.savedRank!);
  assert.deepEqual(
    ranked.map((v) => v.id),
    ['9', '8', '7', '6'],
  );
  assert.equal(ensureSavedRanks(sources), false);
});
test('sorting by posted date and author, and filtering by author', async () => {
  await reviewed();
  await startSync();
  const p = page(['3', '2', '1']);
  p.data[0].created_at = '2026-03-01T00:00:00Z';
  p.data[1].created_at = '2026-01-01T00:00:00Z';
  p.data[2].created_at = '2026-02-01T00:00:00Z';
  p.data[1].author_id = '8';
  p.includes.users.push({ id: '8', name: 'Another Voice', username: 'another' });
  await processJob(fake([p]));
  const ids = (q: Record<string, string>) =>
    listBookmarks(new URLSearchParams(q)).items.map((i) => i.id);
  assert.deepEqual(ids({ sort: 'posted' }), ['3', '1', '2']);
  assert.deepEqual(ids({ sort: 'posted-oldest' }), ['2', '1', '3']);
  assert.deepEqual(ids({ sort: 'author' }), ['2', '3', '1']);
  assert.deepEqual(ids({ author: 'Another' }), ['2']);
});
function folderFetch(routes: Record<string, unknown[]>, urls: string[] = []) {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    urls.push(url.href);
    const key = url.pathname.replace('/2/users/42/bookmarks/folders', '') || '/';
    assert.ok(routes[key]?.length, `unexpected paid request ${key}`);
    return Response.json(routes[key].shift());
  }) as typeof fetch;
}
test('folder import stores membership, filters by folder and settles cost to returned items', async () => {
  await reviewed();
  await startSync();
  await processJob(fake([page(['3', '2', '1'])]));
  const before = readState().usage[billingMonth()];
  const urls: string[] = [];
  const result = await importFolders(
    folderFetch(
      {
        '/': [
          {
            data: [
              { id: '100', name: 'Research' },
              { id: '200', name: 'Recipes' },
            ],
          },
        ],
        '/100': [
          { data: [{ id: '3' }], meta: { result_count: 1, next_token: 'more' } },
          { data: [{ id: '2' }], meta: { result_count: 1 } },
        ],
        '/200': [{ data: [{ id: '2' }], meta: { result_count: 1 } }],
      },
      urls,
    ),
  );
  assert.equal(urls.length, 4);
  assert.equal(new URL(urls[2]).searchParams.get('pagination_token'), 'more');
  assert.deepEqual(
    { folders: result.folders, assigned: result.assigned },
    { folders: 2, assigned: 2 },
  );
  assert.ok(Math.abs(readState().usage[billingMonth()] - before - 0.005) < 1e-9);
  const list = listBookmarks();
  assert.deepEqual(
    list.folders.map((f) => [f.name, f.count]),
    [
      ['Research', 2],
      ['Recipes', 1],
    ],
  );
  assert.equal(list.unsortedCount, 1);
  assert.deepEqual(getBookmark('42:2')!.folders, ['100', '200']);
  const ids = (folder: string) =>
    listBookmarks(new URLSearchParams({ folder })).items.map((i) => i.id);
  assert.deepEqual(ids('100'), ['3', '2']);
  assert.deepEqual(ids('none'), ['1']);
});
test('a failed folder import keeps the previous folders and stops at the local allowance', async () => {
  await reviewed();
  writeJson('folders.json', {
    accountId: '42',
    syncedAt: 'old',
    folders: [{ id: '1', name: 'Kept' }],
    membership: {},
  });
  await assert.rejects(
    importFolders(
      folderFetch({ '/': [{ data: [{ id: '100', name: 'New' }] }], '/100': [{ data: 'bad' }] }),
    ),
    /incomplete folder page/,
  );
  assert.equal(listBookmarks().folders[0].name, 'Kept');
  await withLock(() => {
    const s = readState();
    s.usage[billingMonth()] = 4.95;
    writeJson('state.json', s);
  });
  await assert.rejects(importFolders(folderFetch({})), /allowance is exhausted/);
});
