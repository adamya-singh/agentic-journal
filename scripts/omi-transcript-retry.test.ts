import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

// The retry route resolves its data directory from process.cwd() at import
// time, so point cwd at a scratch project root before importing it.
const originalCwd = process.cwd();
const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-omi-retry-'));
const transcriptDir = path.join(testRoot, 'src/backend/data/omi-transcripts');
const date = '2026-09-14';
const statusPath = path.join(transcriptDir, `${date}.status.json`);

let retryRoute: typeof import('../src/app/api/omi/transcripts/retry/route');

before(async () => {
  mkdirSync(transcriptDir, { recursive: true });
  process.chdir(testRoot);
  retryRoute = await import('../src/app/api/omi/transcripts/retry/route');
});

after(() => {
  process.chdir(originalCwd);
  rmSync(testRoot, { recursive: true, force: true });
});

function writeStatus(segments: Record<string, unknown>) {
  writeFileSync(
    statusPath,
    JSON.stringify({ date, createdAt: '2026-09-14T16:00:00.000Z', updatedAt: '2026-09-14T16:00:00.000Z', segments }, null, 2)
  );
}

function readStatus() {
  return JSON.parse(readFileSync(statusPath, 'utf-8')) as {
    segments: Record<string, Record<string, unknown>>;
  };
}

async function postRetry(body: unknown) {
  const request = new NextRequest('http://localhost/api/omi/transcripts/retry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const response = await retryRoute.POST(request);
  return { status: response.status, json: await response.json() };
}

test('manual retry resets the retry budget for a batch that hit the cap', async () => {
  writeStatus({
    'capped-batch': {
      id: 'capped-batch',
      status: 'failed',
      retryCount: 5,
      retryAfter: '2026-09-14T17:29:42.384Z',
      operationName: 'projects/p/locations/us/operations/v2-abc',
      gcsUri: 'gs://bucket/capped-batch.wav',
      uploadedAt: '2026-09-14T17:29:45.345Z',
      failedAt: '2026-09-14T17:34:45.000Z',
      error: 'Speech operation did not complete within 300 seconds.',
    },
    'done-batch': { id: 'done-batch', status: 'completed', retryCount: 2 },
  });

  const { status, json } = await postRetry({ date, batchIds: ['capped-batch'] });
  assert.equal(status, 200);
  assert.deepEqual(json.updatedBatchIds, ['capped-batch']);

  const segments = readStatus().segments;
  const retried = segments['capped-batch'];
  assert.equal(retried.status, 'pending');
  assert.equal(retried.retryCount, 0);
  assert.equal(retried.retryAfter, null);
  assert.equal(retried.operationName, null);
  assert.equal(retried.gcsUri, null);
  assert.equal(retried.error, null);
  assert.equal(typeof retried.lastRetryRequestedAt, 'string');

  // Completed batches are untouched, including their retry history.
  assert.equal(segments['done-batch'].status, 'completed');
  assert.equal(segments['done-batch'].retryCount, 2);
});

test('retry with no batch ids targets every failed batch and resets each count', async () => {
  writeStatus({
    a: { id: 'a', status: 'failed', retryCount: 5 },
    b: { id: 'b', status: 'failed', retryCount: 1 },
    c: { id: 'c', status: 'completed', retryCount: 0 },
  });

  const { status, json } = await postRetry({ date });
  assert.equal(status, 200);
  assert.deepEqual([...json.updatedBatchIds].sort(), ['a', 'b']);

  const segments = readStatus().segments;
  assert.equal(segments.a.retryCount, 0);
  assert.equal(segments.b.retryCount, 0);
  assert.equal(segments.a.status, 'pending');
  assert.equal(segments.c.status, 'completed');
});
