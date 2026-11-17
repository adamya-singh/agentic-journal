#!/usr/bin/env node
// The session index from the command line: collect every device's sessions and fold them in (`sync`, what the
// 15-minute timer runs), see how fresh it is, and list or search sessions. OpenClaw uses for-card to cite sessions on
// cards and briefs.
import { collect } from '../src/lib/session-index/collect.ts';
import { ingest } from '../src/lib/session-index/ingest.ts';
import { indexStatus, parseTarget, searchSessions, sessionsFor } from '../src/lib/session-index/view.ts';

const [command = 'help', ...args] = process.argv.slice(2);
const out = (data: unknown) => console.log(JSON.stringify({ success: true, data }, null, 2));
const opt = (name: string) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : undefined; };
const log = (line: string) => console.error(line);

async function main() {
  if (command === 'ingest') out(ingest({ rebuild: args.includes('--rebuild') }));
  else if (command === 'collect' || command === 'sync') {
    const hosts = opt('--host')?.split(',').filter(Boolean);
    const budget = Number(opt('--budget'));
    const collected = await collect({ hosts, budgetMs: budget > 0 ? budget * 1000 : undefined, log });
    out(command === 'sync' ? { collected, ingested: ingest({ rebuild: args.includes('--rebuild') }) } : { collected });
  } else if (command === 'status') out(indexStatus());
  else if (command === 'for-card') {
    const target = parseTarget(args[0]);
    if (!target) throw new Error('for-card needs task:<id> or card:<ac_id>.');
    out(sessionsFor(target));
  } else if (command === 'search') out(searchSessions(args.join(' '), 20));
  else {
    console.log(JSON.stringify({
      commands: ['sync [--host laptop,wsl] [--budget <s>] [--rebuild]', 'collect [--host …] [--budget <s>]', 'ingest [--rebuild]', 'status', 'for-card task:<id>|card:<ac_id>', 'search <words>'],
      note: 'collect reads each device’s Claude Code and Codex transcripts (this machine from disk, others over ssh, read-only) and this machine’s OpenClaw sessions into data/session-index/inbox/<host>/; ingest folds them into index.db.',
    }, null, 2));
  }
}

main().catch((e) => {
  console.error(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
