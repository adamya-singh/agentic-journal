import fs from 'node:fs';
import path from 'node:path';
import { GIB, type StackConfig } from './stack-config.ts';
import type { StorageStatus } from './acquisition-types.ts';
import type { Torrent } from './stack-clients.ts';

export function assertStorage(c: StackConfig) {
  const root = fs.realpathSync(c.dataRoot);
  if (root !== path.resolve(c.dataRoot))
    throw new Error('Media storage must be a real directory, not a symlink.');
  if (fs.readFileSync(path.join(root, '.journal-storage'), 'utf8').trim() !== c.storageId)
    throw new Error('Media drive is missing or its storage marker does not match.');
  return root;
}
// Allocated blocks and inode deduplication count downloaded files and their imports once.
export function allocatedBytes(root: string) {
  const seen = new Set<string>();
  let bytes = 0;
  const device = fs.statSync(root).dev;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name),
        st = fs.lstatSync(full);
      if (st.dev !== device) throw new Error('Media folders must share one filesystem.');
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const key = `${st.dev}:${st.ino}`;
        if (!seen.has(key)) {
          seen.add(key);
          bytes += st.blocks * 512;
        }
      }
    }
  };
  walk(root);
  return bytes;
}
export function storageStatus(c: StackConfig, reservedBytes = 0): StorageStatus {
  const base = {
    budgetBytes: c.budgetGiB * GIB,
    minimumFreeBytes: c.minimumFreeGiB * GIB,
    reservedBytes,
  };
  try {
    const root = assertStorage(c),
      stat = fs.statfsSync(root);
    const usedBytes = allocatedBytes(root),
      freeBytes = stat.bavail * stat.bsize;
    const paused =
      usedBytes + reservedBytes >= base.budgetBytes ||
      freeBytes - reservedBytes <= base.minimumFreeBytes;
    return {
      ...base,
      available: true,
      usedBytes,
      freeBytes,
      paused,
      note: paused
        ? 'Storage limit reached. Free space or move the library to a larger drive.'
        : undefined,
    };
  } catch {
    return {
      ...base,
      available: false,
      usedBytes: 0,
      freeBytes: 0,
      paused: true,
      note: 'Media drive unavailable. Check its mount and storage marker.',
    };
  }
}
export const managedTorrent = (t: Torrent) =>
  ['journal-sonarr', 'journal-radarr'].includes(t.category);
export const stoppedTorrent = (t: Torrent) => /^(stopped|paused)/i.test(t.state);
export function admission(torrents: Torrent[], storage: StorageStatus, enabled: boolean) {
  let remaining = Math.min(
    storage.budgetBytes - storage.usedBytes,
    storage.freeBytes - storage.minimumFreeBytes,
  );
  const start: string[] = [],
    stop: string[] = [];
  // Already running jobs reserve their remaining bytes first; retain at most two.
  const jobs = torrents
    .filter(managedTorrent)
    .filter((t) => t.amount_left > 0 || t.size === 0 || /meta/i.test(t.state))
    .sort(
      (a, b) => Number(stoppedTorrent(a)) - Number(stoppedTorrent(b)) || a.added_on - b.added_on,
    );
  for (const t of jobs) {
    const known =
      t.size > 0 &&
      Number.isFinite(t.amount_left) &&
      t.amount_left >= 0 &&
      !/error|missingfiles/i.test(t.state);
    if (enabled && storage.available && known && start.length < 2 && t.amount_left < remaining) {
      remaining -= t.amount_left;
      start.push(t.hash);
    } else stop.push(t.hash);
  }
  return {
    start,
    stop,
    reservedBytes: Math.max(
      0,
      Math.min(
        storage.budgetBytes - storage.usedBytes,
        storage.freeBytes - storage.minimumFreeBytes,
      ) - remaining,
    ),
  };
}
