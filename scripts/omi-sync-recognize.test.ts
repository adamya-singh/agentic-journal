import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildRecognizeRequest,
  extractTranscript,
  planRecognizePieces,
  shouldUseSyncRecognize,
} from './omi-transcribe-day.mjs';

test('first attempts use batch recognition and every retry uses sync', () => {
  assert.equal(shouldUseSyncRecognize(undefined), false);
  assert.equal(shouldUseSyncRecognize({ status: 'pending', retryCount: 0 }), false);
  assert.equal(shouldUseSyncRecognize({ status: 'failed', retryCount: 1 }), true);
  // A worker restart mid-retry leaves the batch "running" with its count.
  assert.equal(shouldUseSyncRecognize({ status: 'running', retryCount: 2 }), true);
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
