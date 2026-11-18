import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The one piece of the deploy queue the Journal itself reads (the rest is src/lib/deploy-queue.ts,
// run by scripts/deploy-queue.ts). A queued deploy stops OpenClaw's gateway for the build, which
// would cut a job application off mid-form. So once a deploy is otherwise ready to go it sets
// `quietSince`, and from then until it finishes the application worker starts nothing new.

/** A hold older than this is a deploy that died without clearing it; the worker carries on. */
export const DEPLOY_HOLD_MAX_MS = 90 * 60_000;

export const deployStateDir = () =>
  process.env.DEPLOY_QUEUE_DIR ||
  path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local/state'), 'agentic-journal');

/** True while a queued deploy is waiting for the worker to go quiet, or is running. */
export function deployHoldsWorker(now = Date.now()): boolean {
  try {
    const queued = JSON.parse(fs.readFileSync(path.join(deployStateDir(), 'deploy-queued.json'), 'utf8')) as { quietSince?: string };
    const since = Date.parse(queued.quietSince ?? '');
    return Number.isFinite(since) && now - since < DEPLOY_HOLD_MAX_MS;
  } catch {
    return false;
  }
}
