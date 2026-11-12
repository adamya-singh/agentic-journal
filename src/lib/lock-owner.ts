import fs from 'node:fs';

// Lock files name their owner as "pid boot start": the pid, the boot it ran in and the kernel's
// start time for it (Linux /proc). A pid alone is not enough. A holder killed while holding a
// lock (reboot, OOM, SIGKILL) leaves its file behind, and once an unrelated process reuses the
// pid the lock looks held forever: after the 2026-11-06 05:00 reboot the library worker could
// not start for a day and a half.
const read = (file: string) => {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
};
const bootId = read('/proc/sys/kernel/random/boot_id');
// Field 22 of /proc/<pid>/stat, counted after the last ')' because the command name may hold spaces.
const startOf = (pid: number) => read(`/proc/${pid}/stat`).split(') ').at(-1)?.split(' ')[19] ?? '';
const start = startOf(process.pid);

/** What to write into a lock file this process holds. */
export const lockOwner = () => (bootId && start ? `${process.pid} ${bootId} ${start}` : String(process.pid));

/** True only when the owner a lock file names is certainly gone, so a live lock is never taken. */
export function ownerGone(owner: string): boolean {
  const [pid, boot, started] = owner.trim().split(' ');
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  if (boot && started) return boot !== bootId || startOf(n) !== started;
  // A bare pid: written on macOS, or before owners carried a start time.
  try {
    process.kill(n, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ESRCH';
  }
}
