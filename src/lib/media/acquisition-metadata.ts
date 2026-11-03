import { readAcquisitions, withAcquisitions } from './acquisition-store.ts';
import { managedTorrent, stoppedTorrent } from './acquisition-storage.ts';
import type { MetadataRequest, StorageStatus } from './acquisition-types.ts';
import type { QbitClient, Torrent } from './stack-clients.ts';

export const METADATA_RESERVE = 16 * 1024 ** 2;
const TIMEOUT = 120_000;
const RETRY = 5 * 60_000;
export const needsMetadata = (t: Torrent) =>
  t.total_size === undefined ? t.size === 0 : t.total_size < 0;
export function validMetadataMagnet(t: Torrent) {
  if (!t.magnet_uri || !/^[a-f0-9]{40}$/i.test(t.hash)) return false;
  try {
    const u = new URL(t.magnet_uri);
    return (
      u.protocol === 'magnet:' &&
      u.searchParams
        .getAll('xt')
        .some((xt) => xt.toLowerCase() === `urn:btih:${t.hash.toLowerCase()}`)
    );
  } catch {
    return false;
  }
}

// A stopped magnet cannot discover its size. qBittorrent's native MetadataReceived
// stop condition pauses it before payload requests. Persist the original descriptor
// before replacing the stopped job, so an interrupted add can be recovered safely.
export async function fetchMetadata(
  q: QbitClient,
  torrents: Torrent[],
  owners: Map<string, { id: string; revision: number }>,
  storage: StorageStatus,
  payloadSlots: number,
  enabled: boolean,
  now = Date.now(),
) {
  const snapshot = readAcquisitions();
  const records = snapshot.metadata || {};
  const unknown = torrents.filter((t) => managedTorrent(t) && needsMetadata(t));
  const available = Math.min(
    storage.budgetBytes - storage.usedBytes - storage.reservedBytes,
    storage.freeBytes - storage.minimumFreeBytes - storage.reservedBytes,
  );
  const permitted =
    enabled && storage.available && payloadSlots < 2 && available > METADATA_RESERVE;
  const ownerValid = (r: MetadataRequest) => {
    const request = snapshot.requests[r.requestId];
    return request?.wanted && request.revision === r.revision;
  };
  const candidates: { t?: Torrent; record: MetadataRequest }[] = [];
  for (const t of unknown) {
    const old = records[t.hash];
    const owner =
      owners.get(t.hash.toLowerCase()) ||
      (old && ownerValid(old) && old.category === t.category
        ? { id: old.requestId, revision: old.revision }
        : undefined);
    if (!owner || !validMetadataMagnet(t) || (old?.retryAt && old.retryAt > now)) continue;
    const savePath = t.save_path || '/data/torrents/completed';
    if (savePath !== '/data/torrents/completed' && !savePath.startsWith('/data/torrents/'))
      continue;
    candidates.push({
      t,
      record:
        old && ownerValid(old)
          ? old
          : {
              hash: t.hash,
              magnet: t.magnet_uri!,
              category: t.category,
              savePath,
              requestId: owner.id,
              revision: owner.revision,
              startedAt: 0,
              preparing: true,
            },
    });
  }
  for (const r of Object.values(records)) {
    if (
      r.preparing &&
      ownerValid(r) &&
      !torrents.some((t) => t.hash === r.hash) &&
      (!r.retryAt || r.retryAt <= now)
    )
      candidates.push({ record: r });
  }
  candidates.sort(
    (a, b) =>
      Number(b.record.startedAt > 0 && !b.record.preparing) -
        Number(a.record.startedAt > 0 && !a.record.preparing) ||
      (a.t?.added_on || 0) - (b.t?.added_on || 0),
  );
  let selected = permitted ? candidates[0] : undefined;
  if (
    selected &&
    !selected.record.preparing &&
    selected.record.startedAt &&
    now - selected.record.startedAt >= TIMEOUT
  ) {
    await q.stop([selected.record.hash]);
    await withAcquisitions((s) => {
      (s.metadata ||= {})[selected!.record.hash] = {
        ...selected!.record,
        preparing: true,
        retryAt: now + RETRY,
      };
    });
    selected = candidates[1];
  }
  const selectedHash = selected?.record.hash;
  const stop = unknown
    .filter((t) => t.hash !== selectedHash && !stoppedTorrent(t))
    .map((t) => t.hash);
  await q.stop(stop);
  await withAcquisitions((s) => {
    s.metadata ||= {};
    for (const [hash, record] of Object.entries(s.metadata)) {
      const t = torrents.find((t) => t.hash === hash);
      if (!ownerValid(record) || (t && (!needsMetadata(t) || !managedTorrent(t))))
        delete s.metadata[hash];
      else if (hash !== selectedHash) record.preparing = true;
    }
  });
  if (!selected) return { active: false, reservedBytes: 0 };
  const { t, record } = selected;
  if (t && !stoppedTorrent(t) && !record.preparing && record.startedAt)
    return { active: true, reservedBytes: METADATA_RESERVE };
  const prepared = { ...record, preparing: true, startedAt: now, retryAt: undefined };
  await withAcquisitions((s) => {
    (s.metadata ||= {})[record.hash] = prepared;
  });
  if (t) {
    await q.stop([t.hash]);
    await q.call('torrents/delete', { hashes: t.hash, deleteFiles: 'false' });
  }
  await q.call('torrents/add', {
    urls: record.magnet,
    category: record.category,
    savepath: record.savePath,
    stopped: 'false',
    stopCondition: 'MetadataReceived',
    autoTMM: 'false',
  });
  await withAcquisitions((s) => {
    (s.metadata ||= {})[record.hash] = { ...prepared, preparing: false };
  });
  return { active: true, reservedBytes: METADATA_RESERVE };
}
