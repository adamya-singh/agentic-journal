// Queue a production deploy for when nobody is using the laptop (see src/lib/deploy-queue.ts).
//   npm run deploy:queue    ask for a deploy of whatever is checked out when it runs
//   npm run deploy:status   what is queued, what it is waiting on, how the last one went
//   npm run deploy:cancel   drop the queued deploy
// `check` is what agentic-journal-deploy-queue.timer runs every 5 minutes.
import { execFileSync, spawnSync } from 'node:child_process';
import { chats, playing, read, waitReasons, write, type LastRun, type Queued } from '../src/lib/deploy-queue.ts';

const now = () => new Date().toISOString();
const head = () => execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
const ago = (iso: string) => `${Math.round((Date.now() - Date.parse(iso)) / 60_000)} min ago`;

async function check() {
  const queued = read<Queued>('queued');
  if (!queued) return 0;
  const reasons = waitReasons(new Date(), await playing(), await chats());
  if (reasons.length) {
    write('queued', { ...queued, checkedAt: now(), waitingOn: reasons });
    console.log(`Deploy waiting: ${reasons.join('; ')}`);
    return 0;
  }
  const startedAt = now(),
    commit = head();
  console.log(`Nothing in use; deploying ${commit}.`);
  const { status } = spawnSync('bash', ['scripts/deploy-production.sh'], { stdio: 'inherit' });
  // 75: a deploy started by hand holds the deploy lock. Leave the request for the next look.
  if (status === 75) return 0;
  write('last', { startedAt, finishedAt: now(), head: commit, exitCode: status } satisfies LastRun);
  // Keep a request that came in while this deploy ran; it may need code this build missed.
  if (read<Queued>('queued')?.lastRequestedAt === queued.lastRequestedAt) write('queued', undefined);
  return status ?? 1;
}

function status() {
  const queued = read<Queued>('queued'),
    last = read<LastRun>('last');
  if (!queued) console.log('No deploy queued.');
  else {
    console.log(`Deploy queued ${ago(queued.firstRequestedAt)}.`);
    if (queued.checkedAt)
      console.log(
        `Last look ${ago(queued.checkedAt)}, waiting on:\n${(queued.waitingOn || []).map((r) => `  - ${r}`).join('\n')}`,
      );
    else console.log('Not looked at yet; the timer checks every 5 minutes.');
  }
  if (last)
    console.log(
      `Last queued deploy: ${last.head}, finished ${ago(last.finishedAt)}, ${last.exitCode === 0 ? 'succeeded' : `failed (exit ${last.exitCode}); see journalctl -u agentic-journal-deploy-queue`}.`,
    );
}

const command = process.argv[2];
if (command === 'queue') {
  const queued = read<Queued>('queued'),
    at = now();
  write('queued', { ...queued, firstRequestedAt: queued?.firstRequestedAt || at, lastRequestedAt: at });
  console.log(
    'Deploy queued. It runs once nothing has played and no OpenClaw chat has been active for 15 minutes,\n' +
      'and deploys whatever is checked out then. Follow it with: npm run deploy:status',
  );
} else if (command === 'cancel') {
  write('queued', undefined);
  console.log('Queued deploy cancelled.');
} else if (command === 'status') status();
else if (command === 'check') process.exitCode = await check();
else {
  console.error('Usage: node scripts/deploy-queue.ts queue|status|cancel|check');
  process.exitCode = 2;
}
