import {
  findOpenClawCronJob,
  isOpenClawCliAvailable,
  parseJsonObjectOutput,
  runOpenClawCli,
  type OpenClawCronJob,
} from '@/lib/openclaw-cron';
import {
  getJobApplicationReadiness,
  hasActionableJobApplications,
  readJobApplicationsStore,
  reconcileStaleJobApplicationLeases,
} from './application-store-utils';

const OPENCLAW_CRON_JOB_NAME = 'Agentic Journal Job Applications';

export interface WorkerControlResult {
  success: boolean;
  jobFound: boolean;
  enabled?: boolean;
  queued?: boolean;
  alreadyRunning?: boolean;
  runId?: string;
  error?: string;
}

export async function wakeJobApplicationWorkerIfEnabled(): Promise<WorkerControlResult | null> {
  const store = readJobApplicationsStore();
  if (
    !store.workerEnabled ||
    !getJobApplicationReadiness().ready ||
    !hasActionableJobApplications()
  ) {
    return null;
  }
  return triggerJobApplicationWorker();
}

export async function triggerJobApplicationWorker(): Promise<WorkerControlResult> {
  const lookup = await readWorkerJob();
  if (lookup.error) {
    return { success: false, jobFound: false, error: lookup.error };
  }
  const job = lookup.job;
  if (!job) {
    return {
      success: false,
      jobFound: false,
      error: 'OpenClaw job application cron job not found',
    };
  }

  try {
    if (!job.enabled) {
      await runOpenClawCli(['cron', 'edit', job.id, '--enable']);
    }
    if (job.running) {
      return {
        success: true,
        jobFound: true,
        enabled: true,
        queued: false,
        alreadyRunning: true,
      };
    }
    const output = await runOpenClawCli(['cron', 'run', job.id]);
    const parsed = parseJsonObjectOutput(output);
    return {
      success: true,
      jobFound: true,
      enabled: true,
      queued: true,
      runId: typeof parsed?.runId === 'string' ? parsed.runId : undefined,
    };
  } catch (error) {
    return {
      success: false,
      jobFound: true,
      error: error instanceof Error ? error.message : 'Unable to trigger OpenClaw worker',
    };
  }
}

export async function disableJobApplicationWorker(): Promise<WorkerControlResult> {
  const lookup = await readWorkerJob();
  if (lookup.error) {
    return { success: false, jobFound: false, error: lookup.error };
  }
  const job = lookup.job;
  if (!job) {
    return {
      success: false,
      jobFound: false,
      error: 'OpenClaw job application cron job not found',
    };
  }
  try {
    if (job.enabled) {
      await runOpenClawCli(['cron', 'edit', job.id, '--disable']);
    }
    return { success: true, jobFound: true, enabled: false };
  } catch (error) {
    return {
      success: false,
      jobFound: true,
      error: error instanceof Error ? error.message : 'Unable to disable OpenClaw worker',
    };
  }
}

const WAKE_ONLY_MESSAGE =
  'Run python3 /home/rpi5/.openclaw/workspace/skills/agentic-journal-job-applications/scripts/applications.py wake. ' +
  'Do not claim or process an application in this wake-only run.';

/**
 * One-shot delete-after-run OpenClaw cron that re-enables the worker at a
 * retry time — the server-side twin of the skill's `schedule-retry` command,
 * for interrupted runs whose agent died before it could schedule its own wake.
 */
export async function scheduleWorkerWakeAt(atIso: string): Promise<void> {
  await runOpenClawCli([
    'cron',
    'add',
    '--name',
    'Job application retry reconcile',
    '--at',
    atIso,
    '--session',
    'isolated',
    '--message',
    WAKE_ONLY_MESSAGE,
    '--delete-after-run',
    '--no-deliver',
    '--timeout-seconds',
    '300',
    '--json',
  ]);
}

let lastReconcileAtMs = 0;
const RECONCILE_MIN_INTERVAL_MS = 60 * 1000;

/**
 * Dead-run self-heal: recover applications stranded behind expired leases,
 * then either wake the worker (if something is claimable now) or schedule a
 * one-shot wake at the earliest synthesized retry time. Throttled and fully
 * error-swallowed — safe to call from the list route's after() and the
 * instrumentation interval.
 */
export async function reconcileAndWakeJobApplicationWorker(): Promise<void> {
  const now = Date.now();
  if (now - lastReconcileAtMs < RECONCILE_MIN_INTERVAL_MS) {
    return;
  }
  lastReconcileAtMs = now;
  try {
    const { reconciled } = await reconcileStaleJobApplicationLeases();
    if (reconciled.length === 0) {
      return;
    }
    console.error(
      `Recovered ${reconciled.length} interrupted job application run(s):`,
      reconciled.map((entry) => entry.listingId).join(', '),
    );
    if (hasActionableJobApplications()) {
      await wakeJobApplicationWorkerIfEnabled();
      return;
    }
    const retryTimes = reconciled
      .map((entry) => entry.nextRetryAt)
      .filter((value): value is string => Boolean(value))
      .sort();
    if (retryTimes.length > 0 && readJobApplicationsStore().workerEnabled) {
      await scheduleWorkerWakeAt(retryTimes[0]);
    }
  } catch (error) {
    console.error('Job application lease reconcile failed:', error);
  }
}

async function readWorkerJob(): Promise<{ job?: OpenClawCronJob | null; error?: string }> {
  if (!isOpenClawCliAvailable()) {
    return { error: 'OpenClaw CLI not found' };
  }
  try {
    const job = await findOpenClawCronJob({
      jobId: process.env.OPENCLAW_JOB_APPLICATIONS_CRON_ID,
      jobName: OPENCLAW_CRON_JOB_NAME,
    });
    return { job };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unable to read OpenClaw cron jobs',
    };
  }
}
