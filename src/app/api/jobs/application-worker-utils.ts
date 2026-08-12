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
