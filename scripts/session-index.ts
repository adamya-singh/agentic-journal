#!/usr/bin/env node
// The session index from the command line: collect every device's sessions and fold them in (`sync`, what the
// 15-minute timer runs, and what a refresh in the Journal runs with a short budget), see how fresh it is, and list or
// search sessions. OpenClaw uses for-card to cite sessions on cards and briefs, and find/show when Adamya asks it to
// find a session to link to a task. Only one sync, collect or ingest runs at a time (lib/session-index/lock.ts): one
// that finds another running says so and does nothing.
import { collect } from '../src/lib/session-index/collect.ts';
import { appOf, findSessions, hostOf, sessionDetail } from '../src/lib/session-index/find.ts';
import { ingest } from '../src/lib/session-index/ingest.ts';
import { syncLockHolder, trySyncLock } from '../src/lib/session-index/lock.ts';
import { indexStatus, parseTarget, searchSessions, sessionsFor } from '../src/lib/session-index/view.ts';

const [command = 'help', ...args] = process.argv.slice(2);
const out = (data: unknown) => console.log(JSON.stringify({ success: true, data }, null, 2));
const opt = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const seconds = (name: string) => { const n = Number(opt(name)); return n > 0 ? n * 1000 : undefined; };
const log = (line: string) => console.error(line);

/** Runs a write to the index under the lock; when another run holds it, says who and does nothing. */
async function locked(by: string, work: () => Promise<unknown> | unknown) {
  const lock = trySyncLock(by);
  if (!lock) {
    const holder = syncLockHolder();
    out({ skipped: 'another sync of the session index is running', ...(holder ? { holder: { by: holder.by, since: holder.since, pid: holder.pid } } : {}) });
    return;
  }
  try {
    out(await work());
  } finally {
    lock.release();
  }
}

async function main() {
  const by = opt('--by') ?? 'cli';
  if (command === 'ingest') await locked(by, () => ingest({ rebuild: args.includes('--rebuild') }));
  else if (command === 'collect' || command === 'sync') {
    const hosts = opt('--host')?.split(',').filter(Boolean);
    await locked(by, async () => {
      const collected = await collect({ hosts, budgetMs: seconds('--budget'), listTimeoutMs: seconds('--list-timeout'), stopAfterMs: seconds('--stop-after'), log });
      return command === 'sync' ? { collected, ingested: ingest({ rebuild: args.includes('--rebuild') }) } : { collected };
    });
  } else if (command === 'status') out(indexStatus());
  else if (command === 'for-card') {
    const target = parseTarget(args[0]);
    if (!target) throw new Error('for-card needs task:<id> or card:<ac_id>.');
    out(sessionsFor(target));
  } else if (command === 'search') out(searchSessions(args.join(' '), 20));
  else if (command === 'find') {
    const app = opt('--app'), device = opt('--device');
    if (app && !appOf(app)) throw new Error('--app is openclaw, claude-code or codex.');
    if (device && !hostOf(device)) throw new Error('--device is laptop, PC or Mac.');
    out(findSessions({ q: opt('--text') ?? '', app: appOf(app) ?? undefined, host: hostOf(device) ?? undefined, folder: opt('--folder'), after: opt('--after'), before: opt('--before'), limit: Number(opt('--limit')) || undefined }));
  } else if (command === 'show') {
    const detail = sessionDetail(args[0] ?? '');
    if (!detail) throw new Error('No session in the index has that uid.');
    out(detail);
  } else {
    console.log(JSON.stringify({
      commands: ['sync [--host laptop,wsl] [--budget <s>] [--list-timeout <s>] [--stop-after <s>] [--rebuild] [--by <who>]', 'collect [--host …] [--budget <s>]', 'ingest [--rebuild]', 'status', 'for-card task:<id>|card:<ac_id>', 'search <words>',
        'find [--text <words>] [--app openclaw|claude-code|codex] [--device laptop|PC|Mac] [--folder <part>] [--after <date>] [--before <date>] [--limit <n>]', 'show <uid>'],
      note: 'collect reads each device’s Claude Code and Codex transcripts (this machine from disk, others over ssh, read-only) and this machine’s OpenClaw sessions into data/session-index/inbox/<host>/; ingest folds them into index.db. --budget is each device’s time for new reads, --list-timeout how long its listing may take, --stop-after when no further device is asked.',
    }, null, 2));
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
