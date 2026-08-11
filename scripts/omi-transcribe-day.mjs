#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { v2 as speechV2 } from '@google-cloud/speech';
import { Storage } from '@google-cloud/storage';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = path.join(PROJECT_ROOT, 'src/backend/data');
const AUDIO_ROOT = path.join(DATA_ROOT, 'omi-audio');
const TRANSCRIPT_ROOT = path.join(DATA_ROOT, 'omi-transcripts');
const WORK_ROOT = path.join(TRANSCRIPT_ROOT, '_work');
const DEFAULT_TIMEZONE = 'America/New_York';
const DEFAULT_SEGMENT_MINUTES = 10;
const DEFAULT_STALENESS_SECONDS = 120;
const DEFAULT_OPERATION_POLL_SECONDS = 15;
const DEFAULT_MODEL = 'chirp_3';
const DEFAULT_LANGUAGE_CODE = 'en-US';
const DEFAULT_LOCATION = 'us';
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(`Omi transcription failed: ${error.message}`);
    if (process.env.OMI_STT_DEBUG === 'true') {
      console.error(error);
    }
    process.exitCode = 1;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  await runTranscribeDay(args);
}

async function runTranscribeDay(args, options = {}) {
  const timezone = getValidTimezone(process.env.OMI_AUDIO_TIMEZONE || DEFAULT_TIMEZONE);
  const date = resolveDate(args, timezone);
  const config = resolveConfig(args, timezone);
  const manifestEntries = options.manifestEntries ?? readManifestMaybe(date, {
    allowMissing: Boolean(options.allowMissingManifest),
  });
  const allSegments = options.segments ?? buildSegments(manifestEntries, config);
  const selectedSegments = options.segments ?? selectSegments(allSegments, config);
  const status = readStatus(date);
  const pendingSegments = selectedSegments.filter((segment) => {
    if (config.force) {
      return true;
    }

    const existing = status.segments?.[segment.id];
    return !(existing?.status === 'completed' && existing.hash === segment.hash);
  });

  if (options.logPlan !== false) {
    printPlan({ date, config, manifestEntries, allSegments, selectedSegments, pendingSegments, status });
  }

  if (config.dryRun) {
    return {
      date,
      config,
      manifestEntries,
      allSegments,
      selectedSegments,
      pendingSegments,
      status,
      completed: [],
    };
  }

  if (pendingSegments.length === 0) {
    const rawState = readRawState(date);
    rawState.date = date;
    rawState.config = publicConfig(config);
    writeMarkdown(date, rawState);
    return {
      date,
      config,
      manifestEntries,
      allSegments,
      selectedSegments,
      pendingSegments,
      status,
      completed: [],
    };
  }

  assertRuntimeConfig(config);
  await ensureDir(TRANSCRIPT_ROOT);
  await ensureDir(path.join(WORK_ROOT, date));

  for (const segment of pendingSegments) {
    const existingSegmentStatus = status.segments[segment.id];
    if (existingSegmentStatus?.status === 'completed' && existingSegmentStatus.hash === segment.hash) {
      continue;
    }
    if (existingSegmentStatus?.status === 'running' && existingSegmentStatus.hash === segment.hash) {
      continue;
    }
    const freshRetryFields = existingSegmentStatus?.status === 'failed'
      ? {
          operationName: null,
          gcsUri: null,
          uploadedAt: null,
          failedAt: null,
          error: null,
          retryAfter: null,
        }
      : {};
    status.segments[segment.id] = {
      ...existingSegmentStatus,
      ...freshRetryFields,
      id: segment.id,
      status: 'pending',
      hash: segment.hash,
      chunkCount: segment.entries.length,
      chunkIds: segment.entries.map((entry) => entry.chunkId),
      sourceStartedAt: segment.startedAt,
      sourceEndedAt: segment.endedAt,
      durationSeconds: segment.durationSeconds,
      queuedAt: existingSegmentStatus?.queuedAt ?? new Date().toISOString(),
    };
  }
  writeStatus(date, status);

  const storage = new Storage({ projectId: config.projectId });
  const bucket = storage.bucket(config.bucketName);
  await maybeCreateBucket({ storage, bucketName: config.bucketName, location: config.bucketLocation });

  const speechClient = new speechV2.SpeechClient({
    projectId: config.projectId,
    apiEndpoint: `${config.location}-speech.googleapis.com`,
  });

  const rawState = readRawState(date);
  rawState.date = date;
  rawState.generatedAt = new Date().toISOString();
  rawState.config = publicConfig(config);
  rawState.segments ||= [];
  const completed = [];

  for (const segment of pendingSegments) {
    console.log(`\nTranscribing ${segment.id} (${segment.entries.length} chunks, ${formatSeconds(segment.durationSeconds)})`);
    const existingSegmentStatus = status.segments[segment.id];
    const shouldResumeOperation =
      existingSegmentStatus?.status === 'running' &&
      existingSegmentStatus.hash === segment.hash &&
      typeof existingSegmentStatus.operationName === 'string' &&
      existingSegmentStatus.operationName.length > 0 &&
      typeof existingSegmentStatus.gcsUri === 'string' &&
      existingSegmentStatus.gcsUri.length > 0;
    const localSegmentPath = path.join(WORK_ROOT, date, `${segment.id}.wav`);
    const listPath = path.join(WORK_ROOT, date, `${segment.id}.ffconcat`);
    const gcsObjectName = `omi-audio-segments/${date}/${segment.id}-${segment.hash.slice(0, 12)}.wav`;
    const gcsUri = shouldResumeOperation && existingSegmentStatus.gcsUri
      ? existingSegmentStatus.gcsUri
      : `gs://${config.bucketName}/${gcsObjectName}`;
    let operationName = shouldResumeOperation ? existingSegmentStatus.operationName : null;

    status.segments[segment.id] = {
      ...existingSegmentStatus,
      id: segment.id,
      status: 'running',
      hash: segment.hash,
      startedAt: new Date().toISOString(),
      chunkCount: segment.entries.length,
      sourceStartedAt: segment.startedAt,
      sourceEndedAt: segment.endedAt,
      durationSeconds: segment.durationSeconds,
      chunkIds: segment.entries.map((entry) => entry.chunkId),
      failedAt: null,
      error: null,
      retryAfter: null,
      ...(shouldResumeOperation ? { operationName, gcsUri } : { operationName: null, gcsUri, uploadedAt: null }),
    };
    writeStatus(date, status);

    try {
      if (operationName) {
        console.log(`Resuming existing operation ${operationName}`);
      } else {
        await concatenateSegment(segment, localSegmentPath, listPath);
        await bucket.upload(localSegmentPath, {
          destination: gcsObjectName,
          metadata: {
            contentType: 'audio/wav',
            metadata: {
              omiDate: date,
              omiSegmentId: segment.id,
              omiSegmentHash: segment.hash,
            },
          },
        });

        const request = buildBatchRecognizeRequest({ config, segment, gcsUri });
        const [operation] = await speechClient.batchRecognize(request);
        operationName = operation.name || operation.latestResponse?.name || null;
        status.segments[segment.id] = {
          ...status.segments[segment.id],
          operationName,
          gcsUri,
          uploadedAt: new Date().toISOString(),
        };
        writeStatus(date, status);
      }

      const response = await waitForBatchRecognizeOperation(speechClient, operationName);
      const responseJson = toJsonSafe(response);
      const fileResult = getFileResult(responseJson, gcsUri);
      if (fileResult?.error) {
        throw new Error(`Speech API returned an error for ${segment.id}: ${JSON.stringify(fileResult.error)}`);
      }

      const transcript = extractTranscript(fileResult);
      const completedAt = new Date().toISOString();
      status.segments[segment.id] = {
        ...status.segments[segment.id],
        status: 'completed',
        completedAt,
        transcriptChars: transcript.length,
        gcsDeletedAt: null,
        localSegmentPath: config.keepLocalSegments ? relativeFromRoot(localSegmentPath) : null,
      };

      upsertRawSegment(rawState, {
        id: segment.id,
        hash: segment.hash,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
        durationSeconds: segment.durationSeconds,
        chunkCount: segment.entries.length,
        chunkIds: segment.entries.map((entry) => entry.chunkId),
        gcsUri,
        operationName,
        completedAt,
        transcript,
        response: responseJson,
      });

      await maybeDeleteGcsObject(bucket, gcsObjectName, config.deleteGcsAfterSuccess);
      if (config.deleteGcsAfterSuccess) {
        status.segments[segment.id].gcsDeletedAt = new Date().toISOString();
      }

      if (!config.keepLocalSegments) {
        await removeIfExists(localSegmentPath);
        await removeIfExists(listPath);
      }

      writeRawState(date, rawState);
      writeStatus(date, status);
      writeMarkdown(date, rawState);
      completed.push(segment.id);
      console.log(`Completed ${segment.id}: ${transcript.length} transcript characters`);
    } catch (error) {
      const retryCount = Number(status.segments[segment.id]?.retryCount || 0) + 1;
      const retryDelaySeconds = Math.min(900, 30 * 2 ** Math.min(retryCount - 1, 5));
      if (config.deleteGcsAfterSuccess) {
        await maybeDeleteGcsObject(bucket, gcsObjectName, true).catch((deleteError) => {
          console.warn(`Could not delete staged GCS object after failure: ${deleteError.message}`);
        });
      }
      status.segments[segment.id] = {
        ...status.segments[segment.id],
        status: 'failed',
        failedAt: new Date().toISOString(),
        error: error.message,
        retryCount,
        retryAfter: new Date(Date.now() + secondsToMillis(retryDelaySeconds)).toISOString(),
      };
      writeStatus(date, status);
      throw error;
    }
  }

  return {
    date,
    config,
    manifestEntries,
    allSegments,
    selectedSegments,
    pendingSegments,
    status,
    completed,
  };
}

async function waitForBatchRecognizeOperation(speechClient, operationName) {
  if (!operationName) {
    throw new Error('Speech API did not return an operation name.');
  }

  while (true) {
    const operation = await speechClient.checkBatchRecognizeProgress(operationName);
    if (operation.done) {
      if (operation.latestResponse?.error) {
        throw new Error(`Speech operation failed: ${JSON.stringify(operation.latestResponse.error)}`);
      }
      if (!operation.result) {
        throw new Error('Speech operation completed without a result.');
      }
      return operation.result;
    }
    await sleep(DEFAULT_OPERATION_POLL_SECONDS * 1000);
  }
}

function parseArgs(argv) {
  const args = {
    date: null,
    today: false,
    finalize: false,
    force: false,
    dryRun: false,
    help: false,
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--date') {
      args.date = argv[++i];
    } else if (arg === '--today') {
      args.today = true;
    } else if (arg === '--finalize') {
      args.finalize = true;
    } else if (arg === '--force') {
      args.force = true;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--limit') {
      args.limit = Number(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (args.date && !DATE_REGEX.test(args.date)) {
    throw new Error(`--date must use YYYY-MM-DD, received ${args.date}`);
  }
  if (args.limit !== null && (!Number.isInteger(args.limit) || args.limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }

  return args;
}

function printUsage() {
  console.log(`Usage:
  npm run omi:transcribe -- --date YYYY-MM-DD [--dry-run] [--finalize] [--force] [--limit N]
  npm run omi:transcribe -- --today [--dry-run]

Examples:
  npm run omi:transcribe -- --today --dry-run
  npm run omi:transcribe -- --date 2026-06-25 --limit 1
  npm run omi:transcribe -- --date 2026-06-25 --finalize --force
`);
}

function resolveDate(args, timezone) {
  if (args.date) {
    return args.date;
  }
  if (args.today || !args.date) {
    return formatLocalDate(new Date(), timezone);
  }
}

function resolveConfig(args, timezone) {
  const projectId = firstNonEmpty(
    process.env.GOOGLE_CLOUD_PROJECT,
    process.env.GOOGLE_VERTEX_PROJECT,
    process.env.GCP_PROJECT_ID,
    readProjectIdFromCredentialFile()
  );
  const location = process.env.OMI_STT_LOCATION || DEFAULT_LOCATION;
  const bucketName = normalizeBucketName(
    process.env.OMI_STT_GCS_BUCKET || (projectId ? `${projectId}-omi-stt` : '')
  );
  const segmentMinutes = parsePositiveInteger(
    process.env.OMI_STT_SEGMENT_MINUTES,
    DEFAULT_SEGMENT_MINUTES
  );

  return {
    projectId,
    location,
    model: process.env.OMI_STT_MODEL || DEFAULT_MODEL,
    languageCode: process.env.OMI_STT_LANGUAGE_CODE || DEFAULT_LANGUAGE_CODE,
    bucketName,
    bucketLocation: process.env.OMI_STT_GCS_BUCKET_LOCATION || 'US',
    segmentMinutes,
    staleAfterSeconds: parsePositiveInteger(
      process.env.OMI_STT_STALE_AFTER_SECONDS,
      DEFAULT_STALENESS_SECONDS
    ),
    deleteGcsAfterSuccess: process.env.OMI_STT_DELETE_GCS_AFTER_SUCCESS !== 'false',
    keepLocalSegments: process.env.OMI_STT_KEEP_LOCAL_SEGMENTS === 'true',
    timezone,
    finalize: args.finalize,
    force: args.force,
    dryRun: args.dryRun,
    limit: args.limit,
  };
}

function readProjectIdFromCredentialFile() {
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialPath) {
    return null;
  }

  for (const candidate of [credentialPath, path.resolve(PROJECT_ROOT, credentialPath)]) {
    try {
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, 'utf-8')).project_id || null;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function assertRuntimeConfig(config) {
  if (!config.projectId) {
    throw new Error('Set GOOGLE_CLOUD_PROJECT, GOOGLE_VERTEX_PROJECT, or GCP_PROJECT_ID before transcribing.');
  }
  if (!config.bucketName) {
    throw new Error('Set OMI_STT_GCS_BUCKET or configure a project id so the default bucket can be derived.');
  }
  const credentialPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentialPath) {
    throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS to the service-account JSON key path.');
  }
  if (!fs.existsSync(credentialPath) && !fs.existsSync(path.resolve(PROJECT_ROOT, credentialPath))) {
    throw new Error(`GOOGLE_APPLICATION_CREDENTIALS points to a missing file: ${credentialPath}`);
  }
}

function readManifest(date) {
  return readManifestMaybe(date, { allowMissing: false });
}

function readManifestMaybe(date, options = {}) {
  const manifestPath = path.join(AUDIO_ROOT, date, 'manifest.jsonl');
  if (!fs.existsSync(manifestPath)) {
    if (options.allowMissing) {
      return [];
    }
    throw new Error(`No Omi manifest found for ${date}: ${relativeFromRoot(manifestPath)}`);
  }

  return fs
    .readFileSync(manifestPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line, index) => {
      try {
        const entry = JSON.parse(line);
        const wavPath = path.resolve(PROJECT_ROOT, entry.wavPath);
        if (!fs.existsSync(wavPath)) {
          console.warn(`Skipping manifest line ${index + 1}; missing WAV ${entry.wavPath}`);
          return [];
        }
        return [{ ...entry, absoluteWavPath: wavPath }];
      } catch {
        console.warn(`Skipping malformed manifest line ${index + 1}`);
        return [];
      }
    })
    .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
}

function buildSegments(entries, config) {
  const byId = new Map();
  for (const entry of entries) {
    const receivedAt = new Date(entry.receivedAt);
    const local = getLocalParts(receivedAt, config.timezone);
    const segmentMinute = Math.floor(local.minuteOfDay / config.segmentMinutes) * config.segmentMinutes;
    const id = `${minutesToTimeLabel(segmentMinute)}--${minutesToTimeLabel(segmentMinute + config.segmentMinutes)}`;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        localDate: entry.localDate,
        segmentMinute,
        entries: [],
      });
    }
    byId.get(id).entries.push(entry);
  }

  return [...byId.values()]
    .sort((a, b) => a.segmentMinute - b.segmentMinute)
    .map((segment) => finalizeSegment(segment));
}

function buildRollingSegments(entries, config, options = {}) {
  const completedChunkIds = options.completedChunkIds ?? new Set();
  const nowMs = options.nowMs ?? Date.now();
  const batchSeconds = options.batchSeconds ?? 90;
  const maxBatchSeconds = options.maxBatchSeconds ?? 120;
  const staleSeconds = options.staleSeconds ?? 30;
  const pendingEntries = entries
    .filter((entry) => !completedChunkIds.has(entry.chunkId))
    .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  const segments = [];
  let current = [];
  let currentDuration = 0;

  for (const entry of pendingEntries) {
    const entryDuration = Number(entry.durationSeconds || 0);
    if (current.length > 0 && currentDuration + entryDuration > maxBatchSeconds) {
      segments.push(createRollingSegment(current, config));
      current = [];
      currentDuration = 0;
    }

    current.push(entry);
    currentDuration += entryDuration;

    if (currentDuration >= batchSeconds) {
      segments.push(createRollingSegment(current, config));
      current = [];
      currentDuration = 0;
    }
  }

  if (current.length > 0) {
    const endedAtMs = Math.max(
      ...current.map((entry) => new Date(entry.receivedAt).getTime() + secondsToMillis(entry.durationSeconds || 0))
    );
    if (endedAtMs <= nowMs - secondsToMillis(staleSeconds)) {
      segments.push(createRollingSegment(current, config));
    }
  }

  return segments;
}

function createRollingSegment(entries, config) {
  const first = entries[0];
  const last = entries.at(-1);
  const startLabel = timeLabelWithSeconds(new Date(first.receivedAt), config.timezone);
  const endMs = new Date(last.receivedAt).getTime() + secondsToMillis(last.durationSeconds || 0);
  const endLabel = timeLabelWithSeconds(new Date(endMs), config.timezone);
  return finalizeSegment({
    id: `${startLabel}--${endLabel}`,
    localDate: first.localDate,
    segmentMinute: getLocalParts(new Date(first.receivedAt), config.timezone).minuteOfDay,
    entries,
  });
}

function finalizeSegment(segment) {
  const startedAtMs = Math.min(...segment.entries.map((entry) => new Date(entry.receivedAt).getTime()));
  const endedAtMs = Math.max(
    ...segment.entries.map((entry) => new Date(entry.receivedAt).getTime() + secondsToMillis(entry.durationSeconds || 0))
  );
  const sampleRates = new Set(segment.entries.map((entry) => Number(entry.sampleRate || 16000)));
  const sampleRate = sampleRates.size === 1 ? [...sampleRates][0] : 16000;
  const durationSeconds = segment.entries.reduce((total, entry) => total + Number(entry.durationSeconds || 0), 0);
  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify(
        segment.entries.map((entry) => ({
          chunkId: entry.chunkId,
          receivedAt: entry.receivedAt,
          bytes: entry.bytes,
          durationSeconds: entry.durationSeconds,
          wavPath: entry.wavPath,
        }))
      )
    )
    .digest('hex');

  return {
    ...segment,
    sampleRate,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    endedAtMs,
    durationSeconds,
    hash,
  };
}

function selectSegments(segments, config) {
  const now = Date.now();
  const eligible = config.finalize
    ? segments
    : segments.filter((segment) => segment.endedAtMs <= now - secondsToMillis(config.staleAfterSeconds));
  return config.limit ? eligible.slice(0, config.limit) : eligible;
}

async function concatenateSegment(segment, outputPath, listPath) {
  await ensureDir(path.dirname(outputPath));
  const listBody = segment.entries
    .map((entry) => `file '${entry.absoluteWavPath.replaceAll("'", "'\\''")}'`)
    .join('\n');
  await fsp.writeFile(listPath, `${listBody}\n`, 'utf-8');
  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-acodec',
    'pcm_s16le',
    '-ac',
    '1',
    '-ar',
    String(segment.sampleRate),
    outputPath,
  ]);
}

async function maybeCreateBucket({ storage, bucketName, location }) {
  if (process.env.OMI_STT_CREATE_BUCKET !== 'true') {
    return;
  }

  console.log(`Creating GCS bucket gs://${bucketName} in ${location}`);
  await storage.createBucket(bucketName, { location });
}

function buildBatchRecognizeRequest({ config, segment, gcsUri }) {
  return {
    recognizer: `projects/${config.projectId}/locations/${config.location}/recognizers/_`,
    config: {
      autoDecodingConfig: {},
      model: config.model,
      languageCodes: [config.languageCode],
      features: {
        enableAutomaticPunctuation: true,
        maxAlternatives: 1,
      },
    },
    files: [{ uri: gcsUri }],
    recognitionOutputConfig: {
      inlineResponseConfig: {},
    },
  };
}

function getFileResult(responseJson, gcsUri) {
  const results = responseJson?.results || {};
  return results[gcsUri] || Object.values(results)[0] || null;
}

function extractTranscript(fileResult) {
  const transcript = fileResult?.inlineResult?.transcript || fileResult?.transcript;
  const results = transcript?.results || [];
  return results
    .map((result) => result.alternatives?.[0]?.transcript?.trim() || '')
    .filter(Boolean)
    .join('\n');
}

function readStatus(date) {
  const statusPath = statusPathForDate(date);
  if (!fs.existsSync(statusPath)) {
    return {
      date,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      segments: {},
    };
  }
  const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
  parsed.segments ||= {};
  return parsed;
}

function writeStatus(date, status) {
  status.updatedAt = new Date().toISOString();
  writeJsonAtomically(statusPathForDate(date), status);
}

function readRawState(date) {
  const rawPath = rawPathForDate(date);
  if (!fs.existsSync(rawPath)) {
    return {
      date,
      generatedAt: new Date().toISOString(),
      config: {},
      segments: [],
    };
  }
  const parsed = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  parsed.segments ||= [];
  return parsed;
}

function writeRawState(date, rawState) {
  rawState.generatedAt = new Date().toISOString();
  rawState.segments.sort((a, b) => a.id.localeCompare(b.id));
  writeJsonAtomically(rawPathForDate(date), rawState);
}

function upsertRawSegment(rawState, segmentResult) {
  const index = rawState.segments.findIndex((segment) => segment.id === segmentResult.id);
  if (index === -1) {
    rawState.segments.push(segmentResult);
  } else {
    rawState.segments[index] = segmentResult;
  }
}

function writeMarkdown(date, rawState) {
  const lines = [
    `# Omi Raw Transcript - ${date}`,
    '',
    `Generated: ${new Date().toISOString()}`,
    `Model: ${rawState.config?.model || DEFAULT_MODEL}`,
    `Language: ${rawState.config?.languageCode || DEFAULT_LANGUAGE_CODE}`,
    `Location: ${rawState.config?.location || DEFAULT_LOCATION}`,
    '',
  ];

  const completedSegments = [...(rawState.segments || [])].sort((a, b) => a.id.localeCompare(b.id));
  if (completedSegments.length === 0) {
    lines.push('_No completed transcript segments yet._', '');
  }

  for (const segment of completedSegments) {
    lines.push(`## ${segment.id.replace('--', ' - ')}`, '');
    lines.push(`Source: ${segment.chunkCount} chunks, ${formatSeconds(segment.durationSeconds)}`, '');
    lines.push(segment.transcript?.trim() || '_No transcript text returned._', '');
  }

  writeTextAtomically(markdownPathForDate(date), `${lines.join('\n').trimEnd()}\n`);
}

function printPlan({ date, config, manifestEntries, allSegments, selectedSegments, pendingSegments, status }) {
  const completedCount = Object.values(status.segments || {}).filter((segment) => segment.status === 'completed').length;
  console.log(`Omi transcription plan for ${date}`);
  console.log(`Audio chunks: ${manifestEntries.length}`);
  console.log(`Segments found: ${allSegments.length}`);
  console.log(`Segments eligible: ${selectedSegments.length}${config.finalize ? ' (--finalize)' : ''}`);
  console.log(`Segments pending: ${pendingSegments.length}${config.force ? ' (--force)' : ''}`);
  console.log(`Segments completed in status: ${completedCount}`);
  console.log(`Transcript path: ${relativeFromRoot(markdownPathForDate(date))}`);
  console.log(`Raw JSON path: ${relativeFromRoot(rawPathForDate(date))}`);
  console.log(`Bucket: gs://${config.bucketName || '<missing>'}`);
  console.log(`Model: ${config.model} (${config.location}, ${config.languageCode})`);
  if (config.limit) {
    console.log(`Limit: ${config.limit}`);
  }
  if (pendingSegments.length > 0) {
    console.log('Pending segment ids:');
    for (const segment of pendingSegments) {
      console.log(`- ${segment.id}: ${segment.entries.length} chunks, ${formatSeconds(segment.durationSeconds)}`);
    }
  }
}

function publicConfig(config) {
  return {
    projectId: config.projectId,
    location: config.location,
    model: config.model,
    languageCode: config.languageCode,
    bucketName: config.bucketName,
    bucketLocation: config.bucketLocation,
    segmentMinutes: config.segmentMinutes,
    timezone: config.timezone,
    deleteGcsAfterSuccess: config.deleteGcsAfterSuccess,
  };
}

function getLocalParts(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const valueFor = (type) => parts.find((part) => part.type === type)?.value;
  const hour = Number(valueFor('hour'));
  const minute = Number(valueFor('minute'));
  return {
    date: `${valueFor('year')}-${valueFor('month')}-${valueFor('day')}`,
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
  };
}

function formatLocalDate(date, timezone) {
  return getLocalParts(date, timezone).date;
}

function minutesToTimeLabel(totalMinutes) {
  const wrapped = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, '0')}-${String(minutes).padStart(2, '0')}`;
}

function timeLabelWithSeconds(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const valueFor = (type) => parts.find((part) => part.type === type)?.value || '00';
  return `${valueFor('hour')}-${valueFor('minute')}-${valueFor('second')}`;
}

function formatSeconds(value) {
  return `${Number(value || 0).toFixed(1)}s`;
}

function secondsToMillis(value) {
  return Number(value || 0) * 1000;
}

function getValidTimezone(timezone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() || null;
}

function normalizeBucketName(value) {
  return (value || '').replace(/^gs:\/\//, '').replace(/\/.*$/, '').trim();
}

function statusPathForDate(date) {
  return path.join(TRANSCRIPT_ROOT, `${date}.status.json`);
}

function rawPathForDate(date) {
  return path.join(TRANSCRIPT_ROOT, `${date}.raw.json`);
}

function markdownPathForDate(date) {
  return path.join(TRANSCRIPT_ROOT, `${date}.md`);
}

function relativeFromRoot(filePath) {
  return path.relative(PROJECT_ROOT, filePath);
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

function writeJsonAtomically(filePath, data) {
  writeTextAtomically(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeTextAtomically(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, data, 'utf-8');
  fs.renameSync(tempPath, filePath);
}

async function removeIfExists(filePath) {
  try {
    await fsp.unlink(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function maybeDeleteGcsObject(bucket, objectName, shouldDelete) {
  if (!shouldDelete) {
    return;
  }
  try {
    await bucket.file(objectName).delete();
  } catch (error) {
    if (error.code !== 404) {
      throw error;
    }
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`${command} exited with code ${code}: ${stderr || stdout}`));
      }
    });
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function toJsonSafe(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, nestedValue) => {
      if (typeof nestedValue === 'bigint') {
        return nestedValue.toString();
      }
      return nestedValue;
    })
  );
}

export {
  AUDIO_ROOT,
  DEFAULT_TIMEZONE,
  DATE_REGEX,
  formatLocalDate,
  getValidTimezone,
  readManifest,
  readManifestMaybe,
  readRawState,
  readStatus,
  resolveConfig,
  runTranscribeDay,
  buildRollingSegments,
};
