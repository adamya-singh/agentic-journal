#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  AUDIO_ROOT,
  DEFAULT_TIMEZONE,
  DATE_REGEX,
  buildRollingSegments,
  formatLocalDate,
  getValidTimezone,
  readManifestMaybe,
  readRawState,
  readStatus,
  resolveConfig,
  runTranscribeDay,
} from './omi-transcribe-day.mjs';

const DEFAULT_POLL_SECONDS = 15;
const DEFAULT_BATCH_SECONDS = 90;
const DEFAULT_BATCH_MAX_SECONDS = 120;
const DEFAULT_STALE_SECONDS = 30;

main().catch((error) => {
  console.error(`Omi transcription worker failed: ${error.message}`);
  if (process.env.OMI_STT_DEBUG === 'true') {
    console.error(error);
  }
  process.exitCode = 1;
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const workerConfig = resolveWorkerConfig();
  if (!workerConfig.enabled) {
    console.log('Omi transcription worker is disabled by OMI_TRANSCRIBE_ENABLED=false');
    return;
  }

  do {
    await runWorkerCycle({ args, workerConfig });
    if (args.once) {
      return;
    }
    await sleep(workerConfig.pollSeconds * 1000);
  } while (true);
}

async function runWorkerCycle({ args, workerConfig }) {
  const dates = resolveDates(args, workerConfig.timezone);
  let processed = 0;

  for (const date of dates) {
    const manifestEntries = readManifestMaybe(date, { allowMissing: true });
    if (manifestEntries.length === 0) {
      if (args.dryRun) {
        console.log(`No Omi manifest found for ${date}`);
      }
      continue;
    }

    const transcribeConfig = resolveConfig(
      {
        date,
        today: false,
        finalize: true,
        force: false,
        dryRun: args.dryRun,
        limit: null,
      },
      workerConfig.timezone
    );
    const completedChunkIds = collectCompletedChunkIds(date, manifestEntries);
    const rollingSegments = buildRollingSegments(manifestEntries, transcribeConfig, {
      completedChunkIds,
      batchSeconds: workerConfig.batchSeconds,
      maxBatchSeconds: workerConfig.batchMaxSeconds,
      staleSeconds: workerConfig.staleSeconds,
    });
    const retryableSegments = rollingSegments.filter((segment) => isRetryable(date, segment));
    const selectedSegments = retryableSegments.slice(0, 1);

    if (args.dryRun || selectedSegments.length > 0) {
      console.log(
        `Omi worker ${date}: chunks=${manifestEntries.length} completedChunks=${completedChunkIds.size} ` +
          `eligibleBatches=${rollingSegments.length} readyBatches=${retryableSegments.length}`
      );
    }

    if (selectedSegments.length === 0) {
      continue;
    }

    await runTranscribeDay(
      {
        date,
        today: false,
        finalize: true,
        force: false,
        dryRun: args.dryRun,
        limit: null,
      },
      {
        manifestEntries,
        segments: selectedSegments,
        allowMissingManifest: true,
        logPlan: args.dryRun,
      }
    );
    processed += selectedSegments.length;
  }

  if (args.dryRun) {
    console.log(`Omi worker dry-run complete: selectedBatches=${processed}`);
  }
}

function collectCompletedChunkIds(date, manifestEntries = []) {
  const chunkIds = new Set();
  const rawState = readRawState(date);
  for (const segment of rawState.segments || []) {
    for (const chunkId of segment.chunkIds || []) {
      chunkIds.add(chunkId);
    }
    addChunkIdsFromCompletedRange(chunkIds, manifestEntries, segment);
  }

  const status = readStatus(date);
  for (const segment of Object.values(status.segments || {})) {
    if (segment.status !== 'completed') {
      continue;
    }
    for (const chunkId of segment.chunkIds || []) {
      chunkIds.add(chunkId);
    }
    addChunkIdsFromCompletedRange(chunkIds, manifestEntries, segment);
  }
  return chunkIds;
}

function addChunkIdsFromCompletedRange(chunkIds, manifestEntries, segment) {
  const startedAt = segment.sourceStartedAt || segment.startedAt;
  const endedAt = segment.sourceEndedAt || segment.endedAt;
  if (!startedAt || !endedAt) {
    return;
  }

  const startedAtMs = new Date(startedAt).getTime();
  const endedAtMs = new Date(endedAt).getTime();
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return;
  }

  for (const entry of manifestEntries) {
    const receivedAtMs = new Date(entry.receivedAt).getTime();
    if (receivedAtMs >= startedAtMs && receivedAtMs <= endedAtMs) {
      chunkIds.add(entry.chunkId);
    }
  }
}

function isRetryable(date, segment) {
  const status = readStatus(date);
  const existing = status.segments?.[segment.id];
  if (!existing || existing.hash !== segment.hash) {
    return true;
  }
  if (existing.status === 'completed') {
    return false;
  }
  if (existing.status === 'running') {
    return true;
  }
  if (existing.status !== 'failed') {
    return true;
  }
  if (!existing.retryAfter) {
    return true;
  }
  return new Date(existing.retryAfter).getTime() <= Date.now();
}

function resolveDates(args, timezone) {
  if (args.date) {
    return [args.date];
  }

  const today = formatLocalDate(new Date(), timezone);
  const dates = new Set([today]);
  if (fs.existsSync(AUDIO_ROOT)) {
    for (const entry of fs.readdirSync(AUDIO_ROOT, { withFileTypes: true })) {
      if (entry.isDirectory() && DATE_REGEX.test(entry.name)) {
        const status = readStatus(entry.name);
        const hasUnfinished = Object.values(status.segments || {}).some((segment) =>
          ['failed', 'pending', 'running'].includes(segment.status)
        );
        const hasNoStatus = Object.keys(status.segments || {}).length === 0;
        if (entry.name < today && (hasUnfinished || hasNoStatus || hasUnprocessedChunks(entry.name))) {
          dates.add(entry.name);
        }
      }
    }
  }
  return [...dates].sort();
}

function hasUnprocessedChunks(date) {
  const manifestEntries = readManifestMaybe(date, { allowMissing: true });
  if (manifestEntries.length === 0) {
    return false;
  }
  const completedChunkIds = collectCompletedChunkIds(date, manifestEntries);
  return manifestEntries.some((entry) => !completedChunkIds.has(entry.chunkId));
}

function resolveWorkerConfig() {
  const timezone = getValidTimezone(process.env.OMI_AUDIO_TIMEZONE || DEFAULT_TIMEZONE);
  return {
    enabled: process.env.OMI_TRANSCRIBE_ENABLED !== 'false',
    pollSeconds: parsePositiveInteger(process.env.OMI_TRANSCRIBE_POLL_SECONDS, DEFAULT_POLL_SECONDS),
    batchSeconds: parsePositiveInteger(process.env.OMI_TRANSCRIBE_BATCH_SECONDS, DEFAULT_BATCH_SECONDS),
    batchMaxSeconds: parsePositiveInteger(
      process.env.OMI_TRANSCRIBE_BATCH_MAX_SECONDS,
      DEFAULT_BATCH_MAX_SECONDS
    ),
    staleSeconds: parsePositiveInteger(process.env.OMI_TRANSCRIBE_STALE_SECONDS, DEFAULT_STALE_SECONDS),
    timezone,
  };
}

function parseArgs(argv) {
  const args = {
    once: false,
    dryRun: false,
    date: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--once') {
      args.once = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--date') {
      args.date = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.date && !DATE_REGEX.test(args.date)) {
    throw new Error(`--date must use YYYY-MM-DD, received ${args.date}`);
  }
  return args;
}

function printUsage() {
  console.log(`Usage:
  npm run omi:worker -- [--once] [--dry-run] [--date YYYY-MM-DD]

Examples:
  npm run omi:worker -- --once --dry-run
  npm run omi:worker -- --once --date 2026-06-25
`);
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
