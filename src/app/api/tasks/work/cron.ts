// OpenClaw's task worker cron (docs/task-worker-design.md, "Cost"). Declared once with a six-hourly schedule as a
// safety net; the Journal wakes it with `cron run` only when a claim would return a task, the cron is not already
// running and OpenClaw's browser is free. Wakes are throttled, and a run that claimed nothing (or a wake that failed)
// backs the next one off, so a broken skill cannot loop. TASK_WORKER_DISABLED=1 turns off declaring and waking (the
// claim route honours it too). Like the other Journal crons, an existing job is never rewritten from here: bump the
// declaration key to change it.
import {
  findOpenClawCronJob,
  isOpenClawCliAvailable,
  runOpenClawCli,
  type OpenClawCronJob,
} from '@/lib/openclaw-cron';
import { isManualBrowserSessionActive } from '@/lib/openclaw-browser';
import { jobBrowserBusy } from '../../jobs/application-store-utils';
import { taskWorkClaimable, taskWorkDisabled } from './actions';
import { taskWorkClaimedSince, taskWorkLeaseLive } from './store';

export const TASK_WORKER_CRON_NAME = 'Agentic Journal Task Worker';
const DECLARATION_KEY = 'agentic-journal.task-worker.v1';
export const TASK_WORKER_MESSAGE =
  'Use the agentic-journal-task-worker skill and process exactly one task. ' +
  'Claim once with the skill script; a null claim means stop quietly. ' +
  'Take one step at the level the claim\'s rules and grant allow: look and prepare freely, act outward only on an approval item Adamya approved, with exactly the approved text. ' +
  'Close with exactly one of waiting, rest, continue, ask, propose, looks-done, retry or release. ' +
  'Never complete, edit or delete the task, never spend money, never do graded coursework, assessments or job applications. ' +
  'If the Journal is unreachable, stop and report one line; never build, deploy or restart anything.';

export const TASK_WORKER_CRON_ARGS: readonly string[] = [
  'cron', 'add',
  '--name', TASK_WORKER_CRON_NAME,
  '--description', 'Works on Journal tasks Adamya handed over and checks for replies; the Journal wakes it when a task is due',
  '--declaration-key', DECLARATION_KEY,
  '--every', '6h',
  '--session', 'isolated',
  '--message', TASK_WORKER_MESSAGE,
  '--no-deliver',
  '--timeout-seconds', '1800',
  '--json',
];

export const WAKE_THROTTLE_MS = 2 * 60_000;
export const WAKE_BACKOFF_MS = 5 * 60_000;
const WAKE_BACKOFF_MAX_MS = 60 * 60_000;
/** A run that started this long ago is over (the cron's timeout is 30 min), whatever the CLI says. */
const RUN_SETTLED_MS = 35 * 60_000;

export interface CronDeps {
  available: () => boolean;
  find: typeof findOpenClawCronJob;
  run: (args: string[]) => Promise<string>;
}
const cliDeps: CronDeps = { available: isOpenClawCliAvailable, find: findOpenClawCronJob, run: (args) => runOpenClawCli(args) };

const findJob = (deps: CronDeps) => deps.find({ jobId: process.env.OPENCLAW_TASK_WORKER_CRON_ID, jobName: TASK_WORKER_CRON_NAME });

/** Declares the cron when it does not exist. Never edits an existing job. */
export async function ensureTaskWorkerCron(deps: CronDeps = cliDeps): Promise<'disabled' | 'exists' | 'added'> {
  if (taskWorkDisabled() || !deps.available()) return 'disabled';
  if (await findJob(deps)) return 'exists';
  await deps.run([...TASK_WORKER_CRON_ARGS]);
  return 'added';
}

// ───────────── the wake decision ─────────────

/** What the Journal remembers between wakes. Kept on globalThis: the interval and the routes are separate bundles. */
export interface WakeState {
  lastWakeAt: number;          // when `cron run` was last sent (0: never)
  wakeSettled: boolean;        // the run that wake started has been judged
  emptyRuns: number;           // wakes in a row whose run claimed nothing, or that failed
  backoffUntil: number;
  inFlight: boolean;
}

export const emptyWakeState = (): WakeState => ({ lastWakeAt: 0, wakeSettled: true, emptyRuns: 0, backoffUntil: 0, inFlight: false });

export interface WakeInputs {
  now: number;
  disabled: boolean;
  browserBusy: boolean;        // Adamya at the wheel, or a job-application / Simplify lease
  taskLeaseLive: boolean;      // a task run holds its lease
  claimable: boolean;          // taskWorkClaimable(now)
  running: boolean;            // the cron is running (from the CLI)
}

export type WakeDecision = 'wake' | 'disabled' | 'throttled' | 'backed-off' | 'browser-busy' | 'running' | 'nothing';

/** Pure: whether to send `cron run` now. Checked in this order, cheapest first. */
export function decideTaskWorkerWake(state: WakeState, input: WakeInputs): WakeDecision {
  if (input.disabled) return 'disabled';
  if (input.now - state.lastWakeAt < WAKE_THROTTLE_MS) return 'throttled';
  if (input.now < state.backoffUntil) return 'backed-off';
  if (input.taskLeaseLive) return 'running';
  if (input.browserBusy) return 'browser-busy';
  if (!input.claimable) return 'nothing';
  if (input.running) return 'running';
  return 'wake';
}

const backoffFor = (emptyRuns: number) => Math.min(WAKE_BACKOFF_MS * 2 ** Math.max(0, emptyRuns - 1), WAKE_BACKOFF_MAX_MS);

/**
 * Pure: judges the run the last wake started, once it is over. It claimed a task: the count starts over. It claimed
 * nothing although a task was claimable: back off 5 minutes, doubling for each one in a row (at most an hour).
 */
export function settleLastWake(state: WakeState, input: { now: number; running: boolean; claimedSinceWake: boolean }): WakeState {
  if (state.wakeSettled || state.lastWakeAt === 0) return state;
  if (input.claimedSinceWake) return { ...state, wakeSettled: true, emptyRuns: 0 };
  if (input.running && input.now - state.lastWakeAt < RUN_SETTLED_MS) return state;
  const emptyRuns = state.emptyRuns + 1;
  return { ...state, wakeSettled: true, emptyRuns, backoffUntil: input.now + backoffFor(emptyRuns) };
}

/** Pure: a `cron run` that failed backs off like an empty run. */
export function failedWake(state: WakeState, now: number): WakeState {
  const emptyRuns = state.emptyRuns + 1;
  return { ...state, lastWakeAt: now, wakeSettled: true, emptyRuns, backoffUntil: now + backoffFor(emptyRuns) };
}

const STATE = Symbol.for('agentic-journal.task-worker-wake');
export function wakeState(): WakeState {
  const g = globalThis as { [STATE]?: WakeState };
  return (g[STATE] ??= emptyWakeState());
}
function setWakeState(next: WakeState): void {
  Object.assign(wakeState(), next);
}

export interface WakeDeps extends CronDeps {
  claimable: (now: Date) => boolean;
  browserBusy: (now: number) => boolean;
  taskLeaseLive: (now: Date) => boolean;
  claimedSince: (sinceMs: number) => boolean;
}
const wakeDeps: WakeDeps = {
  ...cliDeps,
  claimable: (now) => taskWorkClaimable(now),
  browserBusy: (now) => isManualBrowserSessionActive(now) || jobBrowserBusy(now),
  taskLeaseLive: (now) => taskWorkLeaseLive(now),
  claimedSince: (sinceMs) => taskWorkClaimedSince(sinceMs),
};

export interface WakeResult { decision: WakeDecision | 'no-cli' | 'no-job' | 'cron-disabled' | 'failed'; runOutput?: string; error?: string }

/**
 * Sends `cron run` to the task worker when there is a task to claim. Safe to call often (the five-minute interval,
 * the hand and answer routes): it throttles itself, never throws, and does nothing without the OpenClaw CLI.
 */
export async function wakeTaskWorker(now = new Date(), deps: WakeDeps = wakeDeps): Promise<WakeResult> {
  const state = wakeState();
  if (taskWorkDisabled()) return { decision: 'disabled' };
  if (!deps.available()) return { decision: 'no-cli' };
  if (state.inFlight) return { decision: 'throttled' };
  state.inFlight = true;
  try {
    const t = now.getTime();
    const base = { now: t, disabled: false, running: false };
    // Everything up to `claimable` reads local files only; the CLI is asked only when a wake is likely.
    let decision = decideTaskWorkerWake(state, {
      ...base, browserBusy: deps.browserBusy(t), taskLeaseLive: deps.taskLeaseLive(now), claimable: deps.claimable(now),
    });
    if (decision !== 'wake') return { decision };

    let job: OpenClawCronJob | null = await findJob(deps);
    if (!job) {
      await ensureTaskWorkerCron(deps);
      job = await findJob(deps);
    }
    if (!job) return { decision: 'no-job' };
    // Turned off in OpenClaw by hand: respected, never re-enabled from here.
    if (!job.enabled) return { decision: 'cron-disabled' };

    setWakeState(settleLastWake(state, { now: t, running: job.running, claimedSinceWake: deps.claimedSince(state.lastWakeAt) }));
    decision = decideTaskWorkerWake(state, { ...base, browserBusy: false, taskLeaseLive: false, claimable: true, running: job.running });
    if (decision !== 'wake') return { decision };

    try {
      const runOutput = await deps.run(['cron', 'run', job.id]);
      setWakeState({ ...state, lastWakeAt: t, wakeSettled: false });
      return { decision: 'wake', runOutput };
    } catch (error) {
      setWakeState(failedWake(state, t));
      const message = error instanceof Error ? error.message : String(error);
      console.error('Task worker wake failed:', message);
      return { decision: 'failed', error: message };
    }
  } catch (error) {
    // The CLI could not be read: backed off like a failed wake, so a broken CLI is not asked every tick.
    setWakeState(failedWake(state, now.getTime()));
    const message = error instanceof Error ? error.message : String(error);
    console.error('Task worker wake failed:', message);
    return { decision: 'failed', error: message };
  } finally {
    state.inFlight = false;
  }
}
