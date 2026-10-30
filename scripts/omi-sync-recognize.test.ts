import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRecognizeRequest,
  extractTranscript,
  planRecognizePieces,
  shouldUseSyncRecognize,
} from './omi-transcribe-day.mjs';

test('short clips use sync from the first try and long clips use batch', () => {
  const config = { syncMaxSeconds: 300 };
  const workerClip = { durationSeconds: 90.4 };
  const manualSegment = { durationSeconds: 600 };
  assert.equal(shouldUseSyncRecognize(undefined, workerClip, config), true);
  assert.equal(shouldUseSyncRecognize({ status: 'pending', retryCount: 0 }, workerClip, config), true);
  assert.equal(shouldUseSyncRecognize(undefined, manualSegment, config), false);
  // Setting the limit to 0 sends first tries back to batch.
  assert.equal(shouldUseSyncRecognize(undefined, workerClip, { syncMaxSeconds: 0 }), false);
});

test('every retry uses sync, whatever the clip length', () => {
  const config = { syncMaxSeconds: 300 };
  const manualSegment = { durationSeconds: 600 };
  assert.equal(shouldUseSyncRecognize({ status: 'failed', retryCount: 1 }, manualSegment, config), true);
  // A worker restart mid-retry leaves the batch "running" with its count.
  assert.equal(shouldUseSyncRecognize({ status: 'running', retryCount: 2 }, manualSegment, config), true);
});

test('the sync limit defaults to five minutes and accepts 0', async () => {
  const { resolveConfig } = await import('./omi-transcribe-day.mjs');
  const original = process.env.OMI_STT_SYNC_MAX_SECONDS;
  try {
    delete process.env.OMI_STT_SYNC_MAX_SECONDS;
    assert.equal(resolveConfig({}, 'America/New_York').syncMaxSeconds, 300);
    process.env.OMI_STT_SYNC_MAX_SECONDS = '0';
    assert.equal(resolveConfig({}, 'America/New_York').syncMaxSeconds, 0);
    // Each sync call gets its own deadline instead of the library's 5000 seconds.
    assert.equal(resolveConfig({}, 'America/New_York').syncRequestTimeoutSeconds, 60);
  } finally {
    if (original === undefined) delete process.env.OMI_STT_SYNC_MAX_SECONDS;
    else process.env.OMI_STT_SYNC_MAX_SECONDS = original;
  }
});

test('pieces split the clip evenly and stay under the sync audio limit', () => {
  const pieces = planRecognizePieces(90.4);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((piece) => piece.durationSeconds < 60));
  assert.equal(pieces[1].offsetSeconds, pieces[0].durationSeconds);
  const total = pieces.reduce((sum, piece) => sum + piece.durationSeconds, 0);
  assert.ok(Math.abs(total - 90.4) < 1e-9);

  assert.equal(planRecognizePieces(30.8).length, 1);
  assert.equal(planRecognizePieces(600).length, 11);
  assert.equal(planRecognizePieces(0).length, 1);
});

test('sync requests carry inline audio and no batch-only fields', () => {
  const content = Buffer.from('audio');
  const request = buildRecognizeRequest({
    config: { projectId: 'p', location: 'us', model: 'chirp_3', languageCode: 'en-US' },
    content,
  });
  assert.equal(request.recognizer, 'projects/p/locations/us/recognizers/_');
  assert.equal(request.config.model, 'chirp_3');
  assert.equal(request.content, content);
  assert.equal('files' in request, false);
  assert.equal('recognitionOutputConfig' in request, false);
});

test('transcripts from several sync pieces join in order', () => {
  const pieces = [
    { results: [{ alternatives: [{ transcript: ' first half ' }] }] },
    { results: [] },
    { results: [{ alternatives: [{ transcript: 'second half' }] }] },
  ];
  const fileResult = { transcript: { results: pieces.flatMap((piece) => piece.results) } };
  assert.equal(extractTranscript(fileResult), 'first half\nsecond half');
});
