// One collect or ingest of the session index at a time. The 15-minute timer (`scripts/session-index.ts sync`) and a
// refresh pressed in the Journal both write the same per-device state, inboxes and index.db; two at once would not
// tear a file (every write is an atomic rename, ingest one sqlite transaction), but the slower one could put back what
// the other had just replaced. The lock is a file made with O_EXCL; a holder that died, or held it for half an hour,
// does not keep it.
// Node imports only: the CLI takes it on plain node.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sessionIndexDir } from './store.ts';

const MAX_HOLD_MS = 30 * 60_000;

export interface SyncLockHolder { pid: number; by: string; since: string; token: string }
export interface SyncLock { holder: SyncLockHolder; release(): void }

export const syncLockFile = () => path.join(sessionIndexDir(), 'sync.lock');

function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readHolder(file: string): SyncLockHolder | null {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SyncLockHolder>;
    if (typeof raw.pid === 'number' && typeof raw.since === 'string' && typeof raw.token === 'string') {
      return { pid: raw.pid, by: typeof raw.by === 'string' ? raw.by : '', since: raw.since, token: raw.token };
    }
  } catch { /* gone, or half written */ }
  return null;
}

/** Who holds the lock now, when someone live does. */
export function syncLockHolder(now = Date.now()): SyncLockHolder | null {
  const holder = readHolder(syncLockFile());
  if (!holder) return null;
  return alive(holder.pid) && now - Date.parse(holder.since) < MAX_HOLD_MS ? holder : null;
}

/** Takes the lock, or null when a live run holds it. `by` says who took it ("timer", "journal refresh"). */
export function trySyncLock(by: string, now = Date.now()): SyncLock | null {
  const file = syncLockFile();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const holder: SyncLockHolder = { pid: process.pid, by, since: new Date(now).toISOString(), token: randomBytes(8).toString('hex') };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, JSON.stringify(holder), { flag: 'wx', mode: 0o600 });
      return {
        holder,
        release() {
          // Only our own lock: one taken over after we were thought dead is the new holder's.
          if (readHolder(file)?.token === holder.token) fs.rmSync(file, { force: true });
        },
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const had = readHolder(file);
      // A lock being written this instant reads as nothing: leave it to its writer.
      if (!had) {
        try { if (now - fs.statSync(file).mtimeMs < 5000) return null; } catch { continue; }
      } else if (alive(had.pid) && now - Date.parse(had.since) < MAX_HOLD_MS) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}
