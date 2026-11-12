#!/usr/bin/env node
// The session index from the command line: fold in what machines sent (`proj sessions` on each one), see
// how fresh it is, and list or search sessions. OpenClaw uses for-card to cite sessions on cards and briefs.
import { ingest } from '../src/lib/session-index/ingest.ts';
import { indexStatus, parseTarget, searchSessions, sessionsFor } from '../src/lib/session-index/view.ts';

const [command = 'help', ...args] = process.argv.slice(2);
const out = (data: unknown) => console.log(JSON.stringify({ success: true, data }, null, 2));
try {
  if (command === 'ingest') out(ingest({ rebuild: args.includes('--rebuild') }));
  else if (command === 'status') out(indexStatus());
  else if (command === 'for-card') {
    const target = parseTarget(args[0]);
    if (!target) throw new Error('for-card needs task:<id> or card:<ac_id>.');
    out(sessionsFor(target));
  } else if (command === 'search') out(searchSessions(args.join(' '), 20));
  else {
    console.log(JSON.stringify({
      commands: ['ingest [--rebuild]', 'status', 'for-card task:<id>|card:<ac_id>', 'search <words>'],
      note: 'Machines send redacted session digests to data/session-index/inbox/<host>/ with `proj sessions`; ingest folds them into index.db.',
    }, null, 2));
  }
} catch (e) {
  console.error(JSON.stringify({ success: false, error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
}
