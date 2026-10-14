import { findOpenClawCronJob, isOpenClawCliAvailable, runOpenClawCli } from '@/lib/openclaw-cron';

// OpenClaw's daily feed curation pass (skill: agentic-journal-feed-curator).
// Registered once at server start; like the other Journal crons, an existing
// job's prompt is never rewritten from here (bump the declaration key to change it).
export const FEED_CURATOR_CRON_NAME = 'Agentic Journal Feed Curator';
const DECLARATION_KEY = 'agentic-journal.feed-curator.v1';
const MESSAGE =
  'Use the agentic-journal-feed-curator skill and make exactly one curation pass for the Media feed. ' +
  'Add at most 12 items. Never use Claude. If the Journal is unreachable, stop and report one line; never build, deploy or restart anything.';

export async function ensureFeedCuratorCron() {
  if (process.env.FEED_CURATOR_CRON_DISABLED === '1' || !isOpenClawCliAvailable()) return;
  const job = await findOpenClawCronJob({
    jobId: process.env.OPENCLAW_FEED_CURATOR_CRON_ID,
    jobName: FEED_CURATOR_CRON_NAME,
  });
  if (job) return;
  await runOpenClawCli([
    'cron',
    'add',
    '--name',
    FEED_CURATOR_CRON_NAME,
    '--description',
    'Finds new content for the Media feed from liked channels, your history and bookmarks, tuned by your votes',
    '--declaration-key',
    DECLARATION_KEY,
    '--cron',
    '0 7 * * *',
    '--tz',
    'America/New_York',
    '--session',
    'isolated',
    '--message',
    MESSAGE,
    '--no-deliver',
    '--timeout-seconds',
    '900',
    '--json',
  ]);
}
