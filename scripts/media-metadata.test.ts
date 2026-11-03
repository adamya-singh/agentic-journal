import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fetchMetadata, METADATA_RESERVE } from '../src/lib/media/acquisition-metadata.ts';
import { initialState, writeState } from '../src/lib/media/store.ts';
import {
  requestAcquisition,
  readAcquisitions,
  withAcquisitions,
} from '../src/lib/media/acquisition-store.ts';
import { QbitClient, type Torrent } from '../src/lib/media/stack-clients.ts';
import type { StorageStatus } from '../src/lib/media/acquisition-types.ts';
const old = process.env.BACKEND_DATA_DIR;
let dir: string;
const hash = 'a'.repeat(40);
const magnet = `magnet:?xt=urn:btih:${hash}`;
const torrent: Torrent = {
  hash,
  category: 'journal-sonarr',
  size: 0,
  amount_left: 0,
  state: 'stoppedDL',
  progress: 0,
  added_on: 1,
  magnet_uri: magnet,
  save_path: '/data/torrents/completed',
};
const storage: StorageStatus = {
  available: true,
  paused: false,
  usedBytes: 0,
  reservedBytes: 0,
  freeBytes: 300 * 1024 ** 3,
  minimumFreeBytes: 50 * 1024 ** 3,
  budgetBytes: 150 * 1024 ** 3,
};
const owners = () => new Map([[hash, { id: 'tt1000001', revision: 1 }]]);
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'journal-metadata-'));
  process.env.BACKEND_DATA_DIR = dir;
  const s = initialState();
  s.titles.tt1000001 = {
    id: 'tt1000001',
    title: 'Fixture',
    type: 'Movie',
    collections: [],
    url: '',
  };
  writeState(s);
  await requestAcquisition('tt1000001');
});
afterEach(() => {
  if (old === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = old;
  fs.rmSync(dir, { recursive: true, force: true });
});
function client(failAdd = false) {
  const calls: { route: string; data?: Record<string, string> }[] = [];
  const q = new QbitClient({ url: 'http://127.0.0.1:8080', username: '', password: '' });
  q.call = async <T>(route: string, data?: Record<string, string>): Promise<T> => {
    calls.push({ route, data });
    if (route === 'torrents/delete')
      assert.equal(
        readAcquisitions().metadata?.[hash]?.magnet,
        magnet,
        'descriptor persisted before removal',
      );
    if (route === 'torrents/add' && failAdd) throw new Error('interrupted');
    return '' as T;
  };
  return { q, calls };
}
test('unknown magnets use native metadata-only stopping and never unrestricted resume', async () => {
  const { q, calls } = client();
  const result = await fetchMetadata(q, [torrent], owners(), storage, 0, true, 1000);
  assert.equal(result.reservedBytes, METADATA_RESERVE);
  assert.deepEqual(
    calls.map((x) => x.route),
    ['torrents/stop', 'torrents/delete', 'torrents/add'],
  );
  assert.equal(calls[1].data?.deleteFiles, 'false');
  assert.equal(calls[2].data?.stopCondition, 'MetadataReceived');
  assert.equal(calls[2].data?.stopped, 'false');
  assert.equal(readAcquisitions().metadata?.[hash].preparing, false);
  calls.length = 0;
  await fetchMetadata(q, [{ ...torrent, state: 'metaDL' }], owners(), storage, 0, true, 2000);
  assert.equal(calls.length, 0, 'active metadata retrieval is not stopped and restarted each tick');
});
test('failed add recovers a missing magnet and cancellation prevents recovery', async () => {
  const failed = client(true);
  await assert.rejects(
    fetchMetadata(failed.q, [torrent], owners(), storage, 0, true, 1000),
    /interrupted/,
  );
  assert.equal(readAcquisitions().metadata?.[hash].preparing, true);
  const recovered = client();
  await fetchMetadata(recovered.q, [], new Map(), storage, 0, true, 2000);
  assert.equal(recovered.calls.at(-1)?.route, 'torrents/add');
  recovered.calls.length = 0;
  await fetchMetadata(
    recovered.q,
    [{ ...torrent, state: 'metaDL' }],
    new Map(),
    storage,
    0,
    true,
    2500,
  );
  assert.equal(
    recovered.calls.length,
    0,
    'metadata recovery survives a temporarily empty manager queue',
  );
  await withAcquisitions((s) => {
    s.requests.tt1000001.wanted = false;
    s.metadata![hash].preparing = true;
  });
  recovered.calls.length = 0;
  await fetchMetadata(recovered.q, [], new Map(), storage, 0, true, 3000);
  assert.equal(recovered.calls.length, 0);
});
test('metadata respects capacity, storage headroom, ownership, and stopped-session recovery', async () => {
  for (const [slots, bytes, enabled] of [
    [2, storage.freeBytes, true],
    [0, 0, true],
    [0, storage.freeBytes, false],
  ] as const) {
    const { q, calls } = client();
    await fetchMetadata(
      q,
      [torrent],
      owners(),
      { ...storage, freeBytes: bytes },
      slots,
      enabled,
      1000,
    );
    assert.ok(!calls.some((x) => x.route === 'torrents/add'));
  }
  const { q, calls } = client();
  await fetchMetadata(q, [torrent], new Map(), storage, 0, true, 1000);
  assert.ok(!calls.some((x) => x.route === 'torrents/add'));
  await fetchMetadata(q, [torrent], owners(), storage, 0, true, 1000);
  calls.length = 0;
  await fetchMetadata(q, [torrent], owners(), storage, 0, true, 2000);
  assert.equal(
    calls.at(-1)?.data?.stopCondition,
    'MetadataReceived',
    'a stopped job must have its native stop condition restored',
  );
});
