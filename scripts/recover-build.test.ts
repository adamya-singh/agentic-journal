import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.join(import.meta.dirname, 'recover-build.sh');

function tree(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'recover-build-'));
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), body);
  }
  return root;
}
const run = (root: string, ...args: string[]) =>
  spawnSync('bash', [script, ...args], {
    env: { ...process.env, AGENTIC_JOURNAL_ROOT: root, AGENTIC_JOURNAL_DEPLOY_LOCK: path.join(root, 'lock') },
    encoding: 'utf8',
  });
const read = (root: string, name: string) => {
  try {
    return fs.readFileSync(path.join(root, name), 'utf8');
  } catch {
    return undefined;
  }
};

test('a build an interrupted deploy set aside is put back, keeping the cache', () => {
  const root = tree({
    '.next/cache/webpack': 'cache',
    '.next/half-written': 'new',
    '.next-previous/BUILD_ID': 'old',
    '.next-previous/routes-manifest.json': '{}',
    'src/backend/.mastra-previous/output/package.json': '{"old":true}',
  });
  assert.equal(run(root).status, 0);
  assert.equal(read(root, '.next/BUILD_ID'), 'old');
  assert.equal(read(root, '.next/cache/webpack'), 'cache');
  assert.equal(read(root, '.next/half-written'), undefined);
  assert.equal(read(root, 'src/backend/.mastra/output/package.json'), '{"old":true}');
  assert.equal(fs.existsSync(path.join(root, '.next-previous')), false);
});

test('a complete build is left alone unless the deploy forces a rollback', () => {
  const files = {
    '.next/BUILD_ID': 'new',
    '.next-previous/BUILD_ID': 'old',
    'src/backend/.mastra/output/package.json': '{"new":true}',
  };
  const kept = tree(files);
  assert.equal(run(kept).status, 0);
  assert.equal(read(kept, '.next/BUILD_ID'), 'new');
  const rolled = tree(files);
  assert.equal(run(rolled, '--force').status, 0);
  assert.equal(read(rolled, '.next/BUILD_ID'), 'old');
  // No Mastra build was set aside (it was reused), so the one in place stays.
  assert.equal(read(rolled, 'src/backend/.mastra/output/package.json'), '{"new":true}');
});

test('nothing is touched while a deploy holds the lock', () => {
  const root = tree({ '.next-previous/BUILD_ID': 'old' });
  const holder = spawnSync('flock', ['-n', path.join(root, 'lock'), 'bash', script], {
    env: { ...process.env, AGENTIC_JOURNAL_ROOT: root, AGENTIC_JOURNAL_DEPLOY_LOCK: path.join(root, 'lock') },
    encoding: 'utf8',
  });
  assert.equal(holder.status, 0);
  assert.match(holder.stderr, /deploy is running/);
  assert.equal(read(root, '.next/BUILD_ID'), undefined);
});
