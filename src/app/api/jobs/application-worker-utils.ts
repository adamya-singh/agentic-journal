import { execFile } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';
import {
  getJobApplicationReadiness,
  hasActionableJobApplications,
  readJobApplicationsStore,
} from './application-store-utils';

const execFileAsync = promisify(execFile);
const OPENCLAW_CRON_JOB_NAME = 'Agentic Journal Job Applications';
const OPENCLAW_CLI_PATH =
  process.env.OPENCLAW_CLI_PATH || '/home/rpi5/projects/openclaw/dist/index.js';
const OPENCLAW_CRON_JOBS_PATH =
  process.env.OPENCLAW_CRON_JOBS_PATH || '/home/rpi5/.openclaw/cron/jobs.json';

type CronJobsFile = {
  jobs?: Array<{
    id?: unknown;
    name?: unknown;
    enabled?: unknown;
    state?: { runningAtMs?: unknown };
  }>;
};

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
  const job = readWorkerJob();
  if (!job.id) {
    return {
      success: false,
      jobFound: false,
      error: 'OpenClaw job application cron job not found',
    };
  }
  if (!fs.existsSync(OPENCLAW_CLI_PATH)) {
    return { success: false, jobFound: true, error: 'OpenClaw CLI not found' };
  }

  try {
    if (!job.enabled) {
      await runOpenClaw(['cron', 'edit', job.id, '--enable']);
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
    const output = await runOpenClaw(['cron', 'run', job.id]);
    const parsed = parseJsonOutput(output);
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
  const job = readWorkerJob();
  if (!job.id) {
    return {
      success: false,
      jobFound: false,
      error: 'OpenClaw job application cron job not found',
    };
  }
  if (!fs.existsSync(OPENCLAW_CLI_PATH)) {
    return { success: false, jobFound: true, error: 'OpenClaw CLI not found' };
  }
  try {
    if (job.enabled) {
      await runOpenClaw(['cron', 'edit', job.id, '--disable']);
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

function readWorkerJob(): { id?: string; enabled: boolean; running: boolean } {
  try {
    const data = JSON.parse(fs.readFileSync(OPENCLAW_CRON_JOBS_PATH, 'utf-8')) as CronJobsFile;
    const job = data.jobs?.find((candidate) => candidate.name === OPENCLAW_CRON_JOB_NAME);
    return {
      id: typeof job?.id === 'string' ? job.id : undefined,
      enabled: job?.enabled === true,
      running: typeof job?.state?.runningAtMs === 'number',
    };
  } catch {
    return { enabled: false, running: false };
  }
}

async function runOpenClaw(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [OPENCLAW_CLI_PATH, ...args], {
    timeout: 90_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

function parseJsonOutput(output: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(output.trim()) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Some CLI setups print a warning before the JSON payload.
  }
  for (let index = output.indexOf('{'); index >= 0; index = output.indexOf('{', index + 1)) {
    try {
      const parsed = JSON.parse(output.slice(index).trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue until a complete JSON suffix is found.
    }
  }
  const lines = output.trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Continue through log lines until a JSON object is found.
    }
  }
  return null;
}
