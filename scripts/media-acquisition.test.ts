import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initialState, writeState } from '../src/lib/media/store.ts';
import { initialUnwind, writeUnwind } from '../src/lib/media/unwind-store.ts';
import {
  requestAcquisition,
  cancelAcquisition,
  migrateAcquisitions,
  readAcquisitions,
  withAcquisitions,
} from '../src/lib/media/acquisition-store.ts';
import { stackConfig, GIB, vpnReady } from '../src/lib/media/stack-config.ts';
import { allocatedBytes, admission, storageStatus } from '../src/lib/media/acquisition-storage.ts';
import {
  reconcileAcquisitions,
  guardDownloads,
  stackHealth,
} from '../src/lib/media/acquisition-worker.ts';
import {
  createPlayback,
  proxyPlayback,
  stopPlayback,
  validateResource,
} from '../src/lib/media/jellyfin-playback.ts';
import { GET, POST } from '../src/app/api/media/[[...path]]/route.ts';
import { NextRequest } from 'next/server';
import type { Torrent, ArrTitle } from '../src/lib/media/stack-clients.ts';
import { QbitClient } from '../src/lib/media/stack-clients.ts';

let dir: string;
const previousData = process.env.BACKEND_DATA_DIR,
  previousConfig = process.env.MEDIA_STACK_CONFIG;
const realFetch = globalThis.fetch;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-acquisition-'));
  process.env.BACKEND_DATA_DIR = dir;
  process.env.MEDIA_STACK_CONFIG = path.join(dir, 'config.json');
  fs.mkdirSync(path.join(dir, 'media'));
  const s = initialState();
  s.titles.tt1000001 = {
    id: 'tt1000001',
    title: 'Movie',
    type: 'Movie',
    collections: [],
    addedAt: '2026-01-01',
    url: '',
  };
  s.titles.tt1000002 = {
    id: 'tt1000002',
    title: 'Series',
    type: 'TV Series',
    collections: [],
    addedAt: '2026-01-01',
    url: '',
  };
  writeState(s);
  writeUnwind(initialUnwind());
  const dataRoot = path.join(dir, 'data');
  fs.mkdirSync(dataRoot);
  fs.writeFileSync(path.join(dataRoot, '.journal-storage'), 'fixture');
  fs.writeFileSync(
    path.join(dir, 'vpn.json'),
    JSON.stringify({ healthy: true, port: 12345, at: Date.now() }),
  );
  fs.writeFileSync(
    process.env.MEDIA_STACK_CONFIG,
    JSON.stringify({
      enabled: true,
      dataRoot,
      storageId: 'fixture',
      vpnStatusFile: path.join(dir, 'vpn.json'),
      sonarr: { url: 'http://127.0.0.1:8989', apiKey: 'secret', profileId: 1 },
      radarr: { url: 'http://127.0.0.1:7878', apiKey: 'secret', profileId: 1 },
      prowlarr: { url: 'http://127.0.0.1:9696', apiKey: 'secret' },
      jellyfin: { url: 'http://127.0.0.1:8096', apiKey: 'playback-secret', userId: 'user' },
    }),
  );
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (previousData === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previousData;
  if (previousConfig === undefined) delete process.env.MEDIA_STACK_CONFIG;
  else process.env.MEDIA_STACK_CONFIG = previousConfig;
  fs.rmSync(dir, { recursive: true, force: true });
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('explicit seasons, duplicate requests, cancellation, and one-time legacy migration', async () => {
  await assert.rejects(requestAcquisition('tt1000002'), /season/);
  await assert.rejects(requestAcquisition('yt:aaaaaaaaaaa'), /IMDb/);
  await Promise.all([
    requestAcquisition('tt1000002', [2, 1, 2]),
    requestAcquisition('tt1000002', [1, 2]),
  ]);
  assert.equal(readAcquisitions().requests.tt1000002.revision, 1);
  assert.deepEqual(readAcquisitions().requests.tt1000002.seasons, [1, 2]);
  await cancelAcquisition('tt1000002');
  await migrateAcquisitions();
  await migrateAcquisitions();
  assert.equal(readAcquisitions().requests.tt1000002.wanted, false);
  assert.equal(readAcquisitions().requests.tt1000002.status, 'paused');
});

test('storage counts hardlinks once and fails closed for missing or wrong drive', () => {
  const c = stackConfig(),
    file = path.join(c.dataRoot, 'video');
  fs.writeFileSync(file, Buffer.alloc(8192, 1));
  const before = allocatedBytes(c.dataRoot);
  fs.linkSync(file, path.join(c.dataRoot, 'imported'));
  assert.equal(allocatedBytes(c.dataRoot), before);
  fs.writeFileSync(path.join(c.dataRoot, '.journal-storage'), 'wrong');
  assert.equal(storageStatus(c).available, false);
  assert.equal(storageStatus(c).paused, true);
});

test('admission reserves full remaining sizes, limits concurrency and rejects unknown metadata', () => {
  const storage = {
    available: true,
    usedBytes: 10 * GIB,
    freeBytes: 100 * GIB,
    reservedBytes: 0,
    budgetBytes: 50 * GIB,
    minimumFreeBytes: 50 * GIB,
    paused: false,
  };
  const t = (hash: string, left: number, state = 'stoppedDL'): Torrent => ({
    hash,
    size: left,
    amount_left: left,
    category: 'journal-radarr',
    state,
    added_on: 1,
    progress: 0,
  });
  const result = admission(
    [t('a', 20 * GIB, 'downloading'), t('b', 19 * GIB), t('c', 2 * GIB), t('magnet', 0)],
    storage,
    true,
  );
  assert.deepEqual(result.start, ['a', 'b']);
  assert.deepEqual(result.stop, ['c', 'magnet']);
  assert.equal(result.reservedBytes, 39 * GIB);
  assert.equal(admission([t('a', GIB)], storage, false).start.length, 0);
});

test('VPN attestation expires and requires a forwarded port', () => {
  const c = stackConfig();
  assert.equal(vpnReady(c), true);
  fs.writeFileSync(
    c.vpnStatusFile,
    JSON.stringify({ healthy: true, port: 1, at: Date.now() - 60_000 }),
  );
  assert.equal(vpnReady(c), false);
});

test('qBittorrent supports current empty-body login and older Ok response contracts', async () => {
  for (const message of ['', 'Ok.']) {
    let loggedIn = false;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/auth/login')) {
        loggedIn = true;
        return new Response(message, { headers: { 'Set-Cookie': 'SID=fixture; HttpOnly' } });
      }
      if (!loggedIn) return new Response(null, { status: 401 });
      assert.equal((init?.headers as Record<string, string>).Cookie, 'SID=fixture');
      return json([]);
    }) as typeof fetch;
    assert.deepEqual(await new QbitClient(stackConfig().qbittorrent).torrents(), []);
  }
});

test('API blocks foreign origins and download scope outside the title catalog', async () => {
  const bad = await POST(
    new NextRequest('http://localhost:3000/api/media/acquisition/request', {
      method: 'POST',
      headers: { origin: 'https://evil.test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'tt1000001' }),
    }),
  );
  assert.equal(bad.status, 403);
  const seasons = await POST(
    new NextRequest('http://localhost:3000/api/media/acquisition/request', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'tt1000002', seasons: [999] }),
    }),
  );
  assert.equal(seasons.status, 400);
  const status = await GET(new NextRequest('http://localhost:3000/api/media/acquisition'));
  assert.equal(JSON.stringify(await status.json()).includes('playback-secret'), false);
});

test('manager add timeout is recovered by canonical identity without a duplicate create', async () => {
  await requestAcquisition('tt1000001');
  let remote: ArrTitle | undefined,
    creates = 0,
    commands = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)),
      route = url.pathname.replace('/api/v3/', '');
    if (url.port === '8080') return json({ current_network_interface: 'tun0', upnp: false });
    if (url.port === '9696')
      return url.pathname.endsWith('indexerproxy')
        ? json([{ name: 'Journal Gluetun', implementation: 'Http', tags: [5] }])
        : json([{ enable: true, protocol: 'torrent', tags: [5] }]);
    if (url.port === '8096')
      return url.pathname.includes('/Items')
        ? json({ Items: [] })
        : json({ Policy: { IsAdministrator: false } });
    if (route === 'downloadclient')
      return json([
        {
          enable: true,
          implementation: 'QBittorrent',
          fields: [
            {
              name: url.port === '7878' ? 'movieCategory' : 'tvCategory',
              value: url.port === '7878' ? 'journal-radarr' : 'journal-sonarr',
            },
            { name: 'initialState', value: 2 },
          ],
        },
      ]);
    if (route === 'indexer') return json([{ enableAutomaticSearch: true }]);
    if (route === 'tag') return json([{ id: 5, label: 'journal' }]);
    if (route === 'movie/lookup')
      return json([{ title: 'Movie', imdbId: 'tt1000001', tmdbId: 12, tags: [] }]);
    if (route === 'movie' && init?.method === 'POST') {
      creates++;
      remote = { ...JSON.parse(String(init.body)), id: 12, imdbId: 'tt1000001' };
      throw new Error('response lost');
    }
    if (route === 'movie') return json(remote ? [remote] : []);
    if (route === 'movie/12') return json(remote);
    if (route === 'command') {
      commands++;
      return json({ id: 9 });
    }
    if (route === 'queue') return json({ records: [] });
    throw new Error('Unexpected route: ' + route);
  }) as typeof fetch;
  await reconcileAcquisitions();
  assert.equal(readAcquisitions().requests.tt1000001.status, 'attention');
  await withAcquisitions((s) => {
    s.requests.tt1000001.retryAt = undefined;
  });
  await reconcileAcquisitions();
  await reconcileAcquisitions();
  assert.equal(creates, 1);
  assert.equal(commands, 1);
  assert.equal(readAcquisitions().requests.tt1000001.managerId, 12);
});

test('guard pauses managed downloads if reconciliation or VPN is stale; unrelated transfers are untouched', async () => {
  const stopped: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('/app/preferences'))
      return json({ current_network_interface: 'tun0', upnp: false });
    if (u.pathname.endsWith('/torrents/info'))
      return json([
        {
          hash: 'a',
          category: 'journal-radarr',
          state: 'downloading',
          size: 10,
          amount_left: 5,
          added_on: 1,
        },
        {
          hash: 'personal',
          category: 'other',
          state: 'downloading',
          size: 10,
          amount_left: 5,
          added_on: 1,
        },
      ]);
    if (u.pathname.endsWith('/torrents/stop')) {
      stopped.push(new URLSearchParams(String(init?.body)).get('hashes') || '');
      return new Response('');
    }
    if (u.pathname.endsWith('/queue')) return json({ records: [] });
    throw new Error('Unexpected request');
  }) as typeof fetch;
  await guardDownloads();
  assert.deepEqual(stopped, ['a']);
});

test('playback only proxies selected item resources; HLS URIs are rewritten and credentials removed', async () => {
  const itemId = 'a'.repeat(32);
  await requestAcquisition('tt1000001');
  await withAcquisitions((s) => {
    s.requests.tt1000001.items = [{ key: 'film', itemId, path: '/data/library/movies/Movie.mp4' }];
  });
  const c = stackConfig();
  for (const target of [
    'https://evil.test/video.ts',
    '/System/Info',
    `/Videos/${'b'.repeat(32)}/stream`,
    `//evil.test/Videos/${itemId}/x`,
  ])
    assert.throws(() => validateResource(target, itemId, c.jellyfin.url, c));
  const seen: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    seen.push(String(input));
    if (u.pathname.endsWith('/PlaybackInfo'))
      return json({
        PlaySessionId: 'session',
        MediaSources: [
          {
            Id: itemId,
            SupportsDirectPlay: false,
            TranscodingUrl: `/Videos/${itemId}/master.m3u8?api_key=playback-secret`,
            MediaStreams: [],
          },
        ],
      });
    if (u.pathname.endsWith('/master.m3u8'))
      return new Response(
        '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin?api_key=playback-secret"\nmain/0.ts?api_key=playback-secret\n',
      );
    if (u.pathname.includes('/Sessions/') || u.pathname.endsWith('/ActiveEncodings'))
      return new Response(null, { status: 204 });
    return new Response('segment');
  }) as typeof fetch;
  const p = await createPlayback({ id: 'tt1000001', key: 'film' });
  await assert.rejects(createPlayback({ id: 'tt1000001', key: 'film' }), /Another stream/);
  const resource = p.src.split('/').at(-1)!;
  const proxied = await proxyPlayback(p.token, resource, new Request('http://localhost' + p.src));
  const manifest = await proxied.text();
  assert.ok(manifest.includes(`/api/media/playback/${p.token}/`));
  assert.ok(!manifest.includes('playback-secret'));
  assert.ok(!seen.some((url) => url.includes('api_key')));
  await stopPlayback(p.token);
  assert.equal(
    (await proxyPlayback(p.token, resource, new Request('http://localhost'))).status,
    404,
  );
});

test('direct routing removes VPN and proxy requirements while retaining other health checks', async () => {
  const c = { ...stackConfig(), networkMode: 'direct' as const };
  fs.unlinkSync(c.vpnStatusFile);
  let proxyReads = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const u = new URL(String(input));
    if (u.port === '8080') return json({ current_network_interface: '', upnp: false });
    if (u.port === '9696') {
      if (u.pathname.endsWith('indexerproxy')) proxyReads++;
      return json([{ enable: true, protocol: 'torrent' }]);
    }
    if (u.port === '8096') return json({ Policy: { IsAdministrator: false } });
    if (u.pathname.endsWith('downloadclient'))
      return json([
        {
          enable: true,
          implementation: 'QBittorrent',
          fields: [
            { name: 'category', value: u.port === '7878' ? 'journal-radarr' : 'journal-sonarr' },
            { name: 'initialState', value: 2 },
          ],
        },
      ]);
    if (u.pathname.endsWith('indexer')) return json([{ enableAutomaticSearch: true }]);
    throw new Error('Unexpected request');
  }) as typeof fetch;
  const health = await stackHealth(c);
  assert.ok(Object.values(health).every((s) => s.ok));
  assert.equal(proxyReads, 0);
  assert.equal((await stackHealth({ ...c, networkMode: 'vpn' })).network.ok, false);
});

test('direct mode admits owned transfers but still enforces storage limits and routing consistency', async () => {
  await requestAcquisition('tt1000001');
  await withAcquisitions((s) => {
    s.requests.tt1000001.managerId = 1;
    s.workerAt = new Date().toISOString();
    s.services = { network: { ok: true }, sources: { ok: true } };
  });
  const c = { ...stackConfig(), networkMode: 'direct' as const };
  fs.unlinkSync(c.vpnStatusFile);
  const starts: string[] = [],
    stops: string[] = [];
  let bound = '';
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('preferences'))
      return json({ current_network_interface: bound, upnp: false });
    if (u.pathname.endsWith('/torrents/info'))
      return json([
        {
          hash: 'owned',
          category: 'journal-radarr',
          size: GIB,
          amount_left: GIB,
          state: 'stoppedDL',
          added_on: 1,
        },
      ]);
    if (u.pathname.endsWith('/queue'))
      return json({ records: u.port === '7878' ? [{ movieId: 1, downloadId: 'owned' }] : [] });
    if (u.pathname.endsWith('/torrents/start')) {
      starts.push(new URLSearchParams(String(init?.body)).get('hashes')!);
      return new Response('');
    }
    if (u.pathname.endsWith('/torrents/stop')) {
      stops.push(new URLSearchParams(String(init?.body)).get('hashes')!);
      return new Response('');
    }
    throw new Error('Unexpected request');
  }) as typeof fetch;
  await guardDownloads(c);
  assert.deepEqual(starts, ['owned']);
  starts.length = 0;
  await guardDownloads({ ...c, budgetGiB: 0.001 });
  assert.equal(starts.length, 0);
  assert.ok(stops.includes('owned'));
  stops.length = 0;
  bound = 'tun0';
  await guardDownloads(c);
  assert.equal(starts.length, 0);
  assert.deepEqual(stops, ['owned']);
});

test('Sonarr queue seasonNumber identifies selected seasons without an embedded episode object', async () => {
  await requestAcquisition('tt1000002', [1, 2]);
  await withAcquisitions((s) => {
    s.requests.tt1000002.managerId = 1;
    s.workerAt = new Date().toISOString();
    s.services = { network: { ok: true } };
  });
  const starts: string[] = [],
    stops: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input));
    if (u.pathname.endsWith('preferences'))
      return json({ current_network_interface: '', upnp: false });
    if (u.pathname.endsWith('/torrents/info'))
      return json([
        {
          hash: 'series-download',
          category: 'journal-sonarr',
          size: 1000,
          amount_left: 1000,
          state: 'stoppedDL',
          added_on: 1,
        },
      ]);
    if (u.pathname.endsWith('/queue'))
      return json({
        records:
          u.port === '8989'
            ? [{ seriesId: 1, seasonNumber: 1, downloadId: 'series-download' }]
            : [],
      });
    if (u.pathname.endsWith('/torrents/start')) {
      starts.push(new URLSearchParams(String(init?.body)).get('hashes')!);
      return new Response('');
    }
    if (u.pathname.endsWith('/torrents/stop')) {
      stops.push(new URLSearchParams(String(init?.body)).get('hashes')!);
      return new Response('');
    }
    throw new Error('Unexpected request');
  }) as typeof fetch;
  const c = { ...stackConfig(), networkMode: 'direct' as const };
  await guardDownloads(c);
  assert.deepEqual(starts, ['series-download']);
  starts.length = 0;
  await withAcquisitions((s) => {
    s.requests.tt1000002.seasons = [2];
    s.requests.tt1000002.revision++;
  });
  await guardDownloads(c);
  assert.deepEqual(starts, []);
  assert.ok(stops.includes('series-download'));
});

test('new series waits for Sonarr episodes before SeasonSearch, and an empty search is retried later', async () => {
  await requestAcquisition('tt1000002', [1, 2]);
  let remote: ArrTitle | undefined,
    episodes: { id: number; seasonNumber: number; monitored: boolean }[] = [];
  const searches: number[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input)),
      route = url.pathname.replace('/api/v3/', '');
    if (url.port === '8080') return json({ current_network_interface: 'tun0', upnp: false });
    if (url.port === '9696')
      return url.pathname.endsWith('indexerproxy')
        ? json([{ name: 'Journal Gluetun', implementation: 'Http', tags: [5] }])
        : json([{ enable: true, protocol: 'torrent', tags: [5] }]);
    if (url.port === '8096')
      return url.pathname.includes('/Items')
        ? json({ Items: [] })
        : json({ Policy: { IsAdministrator: false } });
    if (route === 'downloadclient')
      return json([
        {
          enable: true,
          implementation: 'QBittorrent',
          fields: [
            {
              name: url.port === '7878' ? 'movieCategory' : 'tvCategory',
              value: url.port === '7878' ? 'journal-radarr' : 'journal-sonarr',
            },
            { name: 'initialState', value: 2 },
          ],
        },
      ]);
    if (route === 'indexer') return json([{ enableAutomaticSearch: true }]);
    if (route === 'tag') return json([{ id: 5, label: 'journal' }]);
    if (route === 'series/lookup')
      return json([
        {
          title: 'Series',
          imdbId: 'tt1000002',
          tvdbId: 7,
          tags: [],
          seasons: [{ seasonNumber: 1 }, { seasonNumber: 2 }],
        },
      ]);
    if (route === 'series' && init?.method === 'POST') {
      remote = { ...JSON.parse(String(init.body)), id: 3, imdbId: 'tt1000002' };
      return json(remote);
    }
    if (route === 'series') return json(remote ? [remote] : []);
    if (route === 'series/3') return json(remote);
    if (route === 'episode') return json(episodes);
    if (route === 'episode/monitor') {
      const body = JSON.parse(String(init?.body));
      for (const ep of episodes) if (body.episodeIds.includes(ep.id)) ep.monitored = body.monitored;
      return json([]);
    }
    if (route === 'episodefile') return json([]);
    if (route === 'command') {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.name, 'SeasonSearch');
      searches.push(body.seasonNumber);
      return json({ id: 9 });
    }
    if (route === 'queue') return json({ records: [] });
    throw new Error('Unexpected route: ' + route);
  }) as typeof fetch;
  await reconcileAcquisitions();
  assert.deepEqual(searches, []);
  assert.equal(readAcquisitions().requests.tt1000002.searchedRevision, undefined);
  assert.match(readAcquisitions().requests.tt1000002.note || '', /episodes/);
  episodes = [1, 2].flatMap((season) =>
    [1, 2].map((n) => ({ id: season * 10 + n, seasonNumber: season, monitored: false })),
  );
  await reconcileAcquisitions();
  assert.deepEqual(searches, [1, 2]);
  assert.ok(episodes.every((ep) => ep.monitored));
  await reconcileAcquisitions();
  assert.deepEqual(searches, [1, 2]);
  assert.equal(readAcquisitions().requests.tt1000002.status, 'searching');
  await withAcquisitions((s) => {
    s.requests.tt1000002.searchedAt = new Date(Date.now() - 7 * 60 * 60_000).toISOString();
  });
  await reconcileAcquisitions();
  assert.deepEqual(searches, [1, 2, 1, 2]);
});
