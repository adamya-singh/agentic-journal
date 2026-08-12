import { execFile } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// OpenClaw stores cron jobs in SQLite (the old ~/.openclaw/cron/jobs.json was
// migrated away), so the CLI is the only supported way to read or control them.
const DEFAULT_OPENCLAW_CLI_PATH = '/home/rpi5/projects/openclaw/openclaw.mjs';

export interface OpenClawCronJob {
  id: string;
  name: string;
  enabled: boolean;
  running: boolean;
}

export function getOpenClawCliPath(): string {
  return process.env.OPENCLAW_CLI_PATH || DEFAULT_OPENCLAW_CLI_PATH;
}

export function isOpenClawCliAvailable(): boolean {
  return fs.existsSync(getOpenClawCliPath());
}

export async function runOpenClawCli(args: string[], timeoutMs = 90_000): Promise<string> {
  const { stdout } = await execFileAsync(process.execPath, [getOpenClawCliPath(), ...args], {
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Looks up a cron job by stable id (preferred, via env) with a name fallback,
 * so a renamed job keeps working as long as its id is pinned, and a recreated
 * job keeps working as long as its name is unchanged.
 */
export async function findOpenClawCronJob(options: {
  jobId?: string;
  jobName: string;
  timeoutMs?: number;
}): Promise<OpenClawCronJob | null> {
  const output = await runOpenClawCli(['cron', 'list', '--all', '--json'], options.timeoutMs);
  const parsed = parseJsonObjectOutput(output);
  const jobs = Array.isArray(parsed?.jobs) ? (parsed.jobs as unknown[]) : [];
  const normalized = jobs
    .map((job) => normalizeCronJob(job))
    .filter((job): job is OpenClawCronJob => job !== null);
  if (options.jobId) {
    const byId = normalized.find((job) => job.id === options.jobId);
    if (byId) {
      return byId;
    }
  }
  return normalized.find((job) => job.name === options.jobName) ?? null;
}

function normalizeCronJob(raw: unknown): OpenClawCronJob | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const job = raw as {
    id?: unknown;
    name?: unknown;
    enabled?: unknown;
    state?: { runningAtMs?: unknown };
  };
  if (typeof job.id !== 'string' || typeof job.name !== 'string') {
    return null;
  }
  return {
    id: job.id,
    name: job.name,
    enabled: job.enabled === true,
    running: typeof job.state?.runningAtMs === 'number',
  };
}

/** Extracts a JSON object from CLI output that may be preceded by warnings or banners. */
export function parseJsonObjectOutput(output: string): Record<string, unknown> | null {
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
  return null;
}
