import fs from 'node:fs';
import path from 'node:path';

// The agentic-journal CLI (~/agent-skills/skills/agentic-journal/scripts/io_utils.py, file_locks)
// guards each file it rewrites with `<file>.lock`: created exclusively, holding the writer's pid,
// removed when it is done. The app wrote the same files without looking at that lock, so a route
// could read a file, have the CLI rewrite it, and then write its older copy back over it.
// Wrap a read-modify-write in this to take the same lock the CLI takes.

const TIMEOUT_MS = 5_000;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function holderGone(lockFile: string): boolean {
  try {
    const pid = Number(fs.readFileSync(lockFile, 'utf8').trim());
    if (!Number.isInteger(pid) || pid <= 0) {
      // Not signed yet, unless it has sat that way: then its holder died between creating and signing.
      return Date.now() - fs.statSync(lockFile).mtimeMs > TIMEOUT_MS;
    }
    process.kill(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

/** Runs `fn` holding the CLI's lock on `file`. `fn` must be synchronous. */
export function withCliFileLock<T>(file: string, fn: () => T): T {
  const lockFile = `${file}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  const started = Date.now();
  for (;;) {
    try {
      fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // The CLI never clears a lock its own crash left behind; a dead holder's lock is removed here.
      if (holderGone(lockFile)) fs.rmSync(lockFile, { force: true });
      else if (Date.now() - started > TIMEOUT_MS) throw new Error(`Timed out waiting for the lock on ${path.basename(file)}`);
      else pause(25);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}
