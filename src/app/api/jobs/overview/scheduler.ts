import { findOpenClawCronJob, isOpenClawCliAvailable, runOpenClawCli } from '@/lib/openclaw-cron';
import path from 'path';
export async function ensureOverviewCron() {
  if (!isOpenClawCliAvailable()) return;
  const name = 'Agentic Journal Job Overview Analysis';
  if (await findOpenClawCronJob({ jobName: name })) return;
  // The scheduled worker waits for the deployed endpoint; no email-scan changes.
  const script = path.join(process.cwd(), 'scripts/job-overview-analysis.mjs');
  await runOpenClawCli([
    'cron',
    'add',
    '--name',
    name,
    '--declaration-key',
    'agentic-journal.job-overview.v1',
    '--cron',
    '0 9 * * *',
    '--tz',
    'America/New_York',
    '--session',
    'isolated',
    '--message',
    `Run node ${JSON.stringify(script)} once. This updates the internal job overview analysis only. Do not access email or change applications. Report failure if the command fails.`,
    '--no-deliver',
    '--timeout-seconds',
    '180',
    '--json',
  ]);
}
