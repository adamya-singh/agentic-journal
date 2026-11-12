import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { findSupersededSegmentIds, resolveWorkerConfig } from './omi-transcribe-worker.mjs';

const originalMaxRetries = process.env.OMI_TRANSCRIBE_MAX_RETRIES;

afterEach(() => {
  if (originalMaxRetries === undefined) {
    delete process.env.OMI_TRANSCRIBE_MAX_RETRIES;
  } else {
    process.env.OMI_TRANSCRIBE_MAX_RETRIES = originalMaxRetries;
  }
});

test('worker defaults to a bounded retry count', () => {
  delete process.env.OMI_TRANSCRIBE_MAX_RETRIES;
  assert.equal(resolveWorkerConfig().maxRetries, 5);
});

test('worker accepts a configured retry count', () => {
  process.env.OMI_TRANSCRIBE_MAX_RETRIES = '8';
  assert.equal(resolveWorkerConfig().maxRetries, 8);
});

test('failed batches whose chunks were all transcribed elsewhere are superseded', () => {
  const segments = {
    // Re-cut as 12-14-08--12-15-46 with one more chunk, which completed.
    '12-14-08--12-15-44': { status: 'failed', chunkIds: ['a', 'b'] },
    '12-14-08--12-15-46': { status: 'completed', chunkIds: ['a', 'b', 'c'] },
    'still-missing': { status: 'failed', chunkIds: ['b', 'z'] },
    'no-chunks': { status: 'pending', chunkIds: [] },
  };
  const completedChunkIds = new Set(['a', 'b', 'c']);
  assert.deepEqual(findSupersededSegmentIds(segments, completedChunkIds), ['12-14-08--12-15-44']);
});
