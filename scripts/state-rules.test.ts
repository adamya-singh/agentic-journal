import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { worstStatus } from '../src/lib/uptime/history.ts';
import { settleStalePending } from '../src/lib/task-chat.ts';
import { withCliFileLock } from '../src/lib/cli-file-lock.ts';

test('nothing checked is unknown, not operational', () => {
  assert.equal(worstStatus([]), 'unknown');
  assert.equal(worstStatus(['unknown', 'unknown']), 'unknown');
  assert.equal(worstStatus(['paused', 'paused']), 'paused');
  assert.equal(worstStatus(['paused', 'unknown']), 'unknown');
  assert.equal(worstStatus(['operational', 'unknown', 'paused']), 'operational');
  assert.equal(worstStatus(['operational', 'degraded', 'major', 'unknown']), 'major');
});

test('a chat turn sent before this server started is given up on at once', () => {
  const now = new Date('2026-11-12T12:00:00.000Z');
  const sent = '2026-11-12T11:58:00.000Z';
  const started = Date.parse('2026-11-12T11:59:00.000Z');
  // Two minutes old and the server that sent it is still up: wait for it.
  const live = { pendingSince: sent, error: null };
  assert.equal(settleStalePending(live, now, Date.parse('2026-11-12T08:00:00.000Z')), false);
  assert.equal(live.pendingSince, sent);
  // The server restarted since: nobody is left to bring the answer back.
  const orphan = { pendingSince: sent, error: null };
  assert.equal(settleStalePending(orphan, now, started), true);
  assert.equal(orphan.pendingSince, null);
  assert.ok(orphan.error);
  // Without a start time the old rule holds: only after the turn's own timeout.
  const waiting = { pendingSince: sent, error: null };
  assert.equal(settleStalePending(waiting, now), false);
});

test('the CLI lock is taken, released, and reclaimed from a holder that died', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-lock-'));
  const file = path.join(dir, 'ledger.json');
  const lock = `${file}.lock`;
  assert.equal(withCliFileLock(file, () => fs.readFileSync(lock, 'utf8')), String(process.pid));
  assert.equal(fs.existsSync(lock), false);
  // A process that has exited: its pid names nobody now.
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => child.on('exit', resolve));
  fs.writeFileSync(lock, String(child.pid));
  assert.equal(withCliFileLock(file, () => 'ran'), 'ran');
  assert.equal(fs.existsSync(lock), false);
  // A lock is released even when the work under it throws.
  assert.throws(() => withCliFileLock(file, () => { throw new Error('boom'); }), /boom/);
  assert.equal(fs.existsSync(lock), false);
});
