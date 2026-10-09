import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { backendDataDir, DEFAULT_DATA_SEGMENTS } from '../src/lib/backend-data';

// Next's file tracer resolves path.join(process.cwd(), '<literal>') at build time and copies every file
// under that path into every route's trace. Pointed at src/backend/data (~145k Omi audio chunks) it made
// production builds run out of heap. App code must build data paths from DEFAULT_DATA_SEGMENTS (or a
// spread array), never from a 'src/backend/data' string literal joined to process.cwd().
const LEAK = /process\.cwd\(\)\s*,\s*['"`][^'"`]*src\/backend\/data/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'backend' || name === 'node_modules' ? [] : sourceFiles(full);
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [full] : [];
  });
}

test('no app code joins process.cwd() to a src/backend/data literal', () => {
  const offenders = sourceFiles(path.join(process.cwd(), 'src')).filter((file) => LEAK.test(readFileSync(file, 'utf-8')));
  assert.deepEqual(offenders.map((f) => path.relative(process.cwd(), f)), []);
});

test('the default data dir is still src/backend/data', () => {
  const saved = process.env.BACKEND_DATA_DIR;
  delete process.env.BACKEND_DATA_DIR;
  try {
    assert.equal(backendDataDir(), path.join(process.cwd(), 'src', 'backend', 'data'));
    assert.deepEqual(DEFAULT_DATA_SEGMENTS, ['src', 'backend', 'data']);
  } finally {
    if (saved !== undefined) process.env.BACKEND_DATA_DIR = saved;
  }
});
