import { findOpenClawCronJob, isOpenClawCliAvailable, runOpenClawCli } from '../openclaw-cron.ts';

// OpenClaw writes Horizon's action cards twice a day (skill: agentic-journal-action-cards).
// Registered once at server start; like the other Journal crons, an existing job's prompt is never
// rewritten from here (bump the declaration key to change it).
export const ACTION_CARDS_CRON_NAME = 'Agentic Journal Action Cards';
const DECLARATION_KEY = 'agentic-journal.action-cards.v1';
export const ACTION_CARDS_MESSAGE =
  'Use the agentic-journal-action-cards skill and make exactly one pass. Read the digest and his recent reasons first. ' +
  'Write at most 3 new noticed cards plus one card per new Openclaw-folder post, and withdraw cards whose signal is resolved. ' +
  'Refresh from X only when the digest says xRefresh.due. Never use Claude. If the Journal is unreachable, stop and report one line; never build, deploy or restart anything.';

export interface CronDeps {
  available: () => boolean;
  find: typeof findOpenClawCronJob;
  run: (args: string[]) => Promise<string>;
}
const defaults: CronDeps = { available: isOpenClawCliAvailable, find: findOpenClawCronJob, run: (args) => runOpenClawCli(args) };

export async function ensureActionCardsCron(deps: CronDeps = defaults): Promise<'disabled' | 'exists' | 'added'> {
  if (process.env.ACTION_CARDS_CRON_DISABLED === '1' || !deps.available()) return 'disabled';
  const job = await deps.find({ jobId: process.env.OPENCLAW_ACTION_CARDS_CRON_ID, jobName: ACTION_CARDS_CRON_NAME });
  if (job) return 'exists';
  await deps.run([
    'cron', 'add',
    '--name', ACTION_CARDS_CRON_NAME,
    '--description', 'Writes Horizon Dawn action cards from your Openclaw saves and what it notices in Jobs, inbox, compass and tasks',
    '--declaration-key', DECLARATION_KEY,
    '--cron', '30 7,17 * * *',
    '--tz', 'America/New_York',
    '--session', 'isolated',
    '--message', ACTION_CARDS_MESSAGE,
    '--no-deliver',
    '--timeout-seconds', '900',
    '--json',
  ]);
  return 'added';
}
