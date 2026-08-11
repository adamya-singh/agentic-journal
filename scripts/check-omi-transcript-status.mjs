#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const date = process.argv[2] || '2026-06-29';

const manifestEntries = readJsonLines(path.join(projectRoot, 'src/backend/data/omi-audio', date, 'manifest.jsonl'));
const raw = readJson(path.join(projectRoot, 'src/backend/data/omi-transcripts', `${date}.raw.json`), { segments: [] });
const status = readJson(path.join(projectRoot, 'src/backend/data/omi-transcripts', `${date}.status.json`), { segments: {} });
const segments = Object.values(status.segments || {});
const completed = segments.filter((segment) => segment.status === 'completed');
const failed = segments.filter((segment) => segment.status === 'failed');

const summary = {
  date,
  audioChunks: manifestEntries.length,
  rawSegments: raw.segments?.length || 0,
  completedBatches: completed.length,
  failedBatches: failed.length,
  failedBatchIds: failed.map((segment) => segment.id).sort(),
};

console.log(JSON.stringify(summary, null, 2));

if (date === '2026-06-29') {
  assertEqual(summary.audioChunks, 42, 'June 29 audio chunk count');
  assertEqual(summary.rawSegments, 4, 'June 29 raw transcript segment count');
  assertEqual(summary.completedBatches, 4, 'June 29 completed batch count');
  assertEqual(summary.failedBatches, 2, 'June 29 failed batch count');
  assertIncludes(summary.failedBatchIds, '12-54-31--12-56-02', 'June 29 first failed batch');
  assertIncludes(summary.failedBatchIds, '13-00-06--13-01-43', 'June 29 second failed batch');
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function readJsonLines(filePath) {
  try {
    return fs
      .readFileSync(filePath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function assertIncludes(values, expected, label) {
  if (!values.includes(expected)) {
    throw new Error(`${label}: missing ${expected}`);
  }
}
