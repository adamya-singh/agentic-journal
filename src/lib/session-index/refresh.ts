// "Check again" on a task's "Sessions that worked on this": collect what the devices have now and fold it in, then show
// the list. It runs the same `scripts/session-index.ts sync` the 15-minute timer runs, as a child process (its memory
// is its own, and it can be stopped), with a short budget: this machine first, then each other device only as long as
// its listing answers within LIST_TIMEOUT_S and while the run is under STOP_AFTER_S, so a device that cannot be
// reached never holds it up. The sync takes the index's lock (lock.ts): when the timer's run holds it, this waits a
// little for it, then shows what the index has. Presses while one runs share it; one just after it reuses its answer.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { machineName } from '../proj-hosts.ts';
import { syncLockHolder } from './lock.ts';
import { indexStatus } from './view.ts';

const BUDGET_S = 5;            // each device's time for new reads
const LIST_TIMEOUT_S = 12;     // how long a device's listing may take (ssh's own connect timeout is 8 s)
const STOP_AFTER_S = 45;       // no further device is asked after this
const KILL_AFTER_MS = 100_000;  // a read that runs on past all of that (a very large transcript) is stopped
const COOLDOWN_MS = 20_000;    // a press this soon after a refresh gets that refresh's answer
const WAIT_FOR_OTHER_MS = 20_000;

export interface RefreshDevice { host: string; machine: string; reachable: boolean; skipped?: boolean; error?: string; read: number; pending: number; sessions: number }
export interface RefreshResult {
  /** done: collected and folded in. busy: another run (the timer's) had the index; this one did not run. failed: the run itself failed. */
  state: 'done' | 'busy' | 'failed';
  at: string;
  devices: RefreshDevice[];
  /** Sessions the index folded in again (all of them when it rebuilt itself). */
  changed: number;
  /** How many more sessions the index holds than before (fewer, when sessions left their devices). */
  added?: number;
  message?: string;
  reused?: boolean;
}

interface RefreshState { running: Promise<RefreshResult> | null; last: RefreshResult | null; lastAt: number }
// One server process, but each route bundle may load this module separately.
const shared = globalThis as typeof globalThis & { __sessionIndexRefresh?: RefreshState };
const state: RefreshState = (shared.__sessionIndexRefresh ??= { running: null, last: null, lastAt: 0 });

// As segments, not one literal: Next's file tracer would otherwise pull the folder into every route (backend-data.ts).
const CLI_SEGMENTS = ['scripts', 'session-index.ts'];
const cliPath = () => process.env.SESSION_INDEX_CLI || path.join(process.cwd(), ...CLI_SEGMENTS);

/** What a device's failure says, in a few plain words. */
export function deviceProblem(error: string | undefined): string {
  const e = error ?? '';
  if (/time was up|did not come/i.test(e)) return 'was not asked this time (no time left)';
  if (/too long/i.test(e)) return 'did not answer in time';
  if (/no ssh name/i.test(e)) return 'has no ssh name';
  if (/resolve|no route|unreachable|timed out|refused|connection closed|Connection reset|Could not/i.test(e)) return 'could not be reached';
  if (/Permission denied|publickey|Host key/i.test(e)) return 'refused the ssh login';
  return 'could not be read';
}

/** The sync's JSON output, as a result. Null when it is not that. */
export function readSyncOutput(stdout: string, at: Date): RefreshResult | null {
  let json: unknown;
  try { json = JSON.parse(stdout.slice(stdout.indexOf('{'))); } catch { return null; }
  const data = (json as { success?: unknown; data?: unknown })?.success === true ? (json as { data: Record<string, unknown> }).data : null;
  if (!data || typeof data !== 'object') return null;
  if (typeof data.skipped === 'string') {
    return { state: 'busy', at: at.toISOString(), devices: [], changed: 0, message: 'The index was already being collected (its regular run).' };
  }
  if (!Array.isArray(data.collected)) return null;
  const devices: RefreshDevice[] = (data.collected as Record<string, unknown>[]).map((h) => ({
    host: String(h.host ?? ''), machine: machineName(String(h.host ?? '')), reachable: h.reachable === true,
    ...(h.skipped === true ? { skipped: true } : {}), ...(typeof h.error === 'string' && h.reachable !== true ? { error: deviceProblem(h.error) } : {}),
    read: Number(h.read) || 0, pending: Number(h.pending) || 0, sessions: Number(h.sessions) || 0,
  }));
  const ingested = (data.ingested ?? {}) as { changed?: unknown };
  return { state: 'done', at: at.toISOString(), devices, changed: Number(ingested.changed) || 0 };
}

function runSync(): Promise<RefreshResult> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.NODE_OPTIONS;   // the dev server's own hooks are not the CLI's
    const child = spawn(process.execPath, [
      '--max-old-space-size=256', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', cliPath(),
      'sync', '--budget', String(BUDGET_S), '--list-timeout', String(LIST_TIMEOUT_S), '--stop-after', String(STOP_AFTER_S), '--by', 'journal refresh',
    ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let killed = false;
    const timer = setTimeout(() => { killed = true; child.kill('SIGTERM'); }, KILL_AFTER_MS);
    child.stdout.on('data', (d: Buffer) => { if (out.length < 1 << 20) out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { if (err.length < 8000) err += d.toString('utf8'); });
    const done = (result: RefreshResult) => { clearTimeout(timer); resolve(result); };
    child.on('error', (e) => done({ state: 'failed', at: new Date().toISOString(), devices: [], changed: 0, message: `The index could not be collected: ${e.message}` }));
    child.on('close', (code) => {
      const at = new Date();
      if (killed) { done({ state: 'failed', at: at.toISOString(), devices: [], changed: 0, message: 'Collecting took too long and was stopped; the index’s regular run picks it up.' }); return; }
      const read = code === 0 ? readSyncOutput(out, at) : null;
      if (read) { done(read); return; }
      console.error('session index refresh failed:', err.trim().split('\n').slice(-3).join(' | '));
      done({ state: 'failed', at: at.toISOString(), devices: [], changed: 0, message: 'The index could not be collected just now.' });
    });
  });
}

/** Waits up to `ms` for another run's lock to go. True when it went. */
async function waitForOther(ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (!syncLockHolder()) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return !syncLockHolder();
}

/** Collects and folds in what the devices have now (see the top of this file). Never rejects. */
export function refreshIndex(now = Date.now()): Promise<RefreshResult> {
  if (state.running) return state.running;
  if (state.last && now - state.lastAt < COOLDOWN_MS) return Promise.resolve({ ...state.last, reused: true });
  state.running = (async () => {
    let result: RefreshResult;
    try {
      // The timer's run holds the index: wait a little for it to finish (its result is then what is shown).
      if (syncLockHolder()) {
        const freed = await waitForOther(WAIT_FOR_OTHER_MS);
        result = freed
          ? { state: 'done', at: new Date().toISOString(), devices: [], changed: 0, message: 'The index’s regular run had just collected it.' }
          : { state: 'busy', at: new Date().toISOString(), devices: [], changed: 0, message: 'The index is being collected by its regular run right now; this is what it has so far.' };
      } else {
        const before = indexStatus().indexed;
        result = await runSync();
        if (result.state === 'done') result.added = indexStatus().indexed - before;
      }
    } catch (e) {
      result = { state: 'failed', at: new Date().toISOString(), devices: [], changed: 0, message: e instanceof Error ? e.message : 'The index could not be collected.' };
    }
    state.last = result;
    state.lastAt = Date.now();
    state.running = null;
    return result;
  })();
  return state.running;
}

/** For the tests: forget the last refresh. */
export function resetRefreshState(): void {
  state.running = null;
  state.last = null;
  state.lastAt = 0;
}
