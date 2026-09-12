import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { resolveWorkerConfig } from './omi-transcribe-worker.mjs';

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
