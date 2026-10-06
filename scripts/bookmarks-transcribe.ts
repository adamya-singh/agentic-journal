// Transcribes saved bookmark videos with Google Speech-to-Text (Chirp 3), like the Omi pipeline.
// Usage: npm run bookmarks:transcripts -- --folder <folderId> [--dry-run] [--force]
//        npm run bookmarks:transcripts -- --all [--dry-run]
// Audio is extracted with ffmpeg, staged in the Omi GCS bucket, batch-recognized with automatic
// language detection, then deleted from GCS. Billed by Google per audio minute (~$0.016/min).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { v2 as speechV2 } from '@google-cloud/speech';
import { Storage } from '@google-cloud/storage';
import {
  listBookmarks,
  readMediaIndex,
  readTranscripts,
  withLock,
  writeJson,
} from '../src/lib/bookmarks/store.ts';
import { mediaDir } from '../src/lib/bookmarks/media.ts';

const args = process.argv.slice(2);
const folder = args.includes('--folder') ? args[args.indexOf('--folder') + 1] : undefined;
const dryRun = args.includes('--dry-run'),
  force = args.includes('--force');
if (!folder && !args.includes('--all')) {
  console.error('Pass --folder <folderId> or --all.');
  process.exit(1);
}
const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GOOGLE_VERTEX_PROJECT ||
  process.env.GCP_PROJECT_ID ||
  '';
const location = process.env.OMI_STT_LOCATION || 'us',
  model = process.env.OMI_STT_MODEL || 'chirp_3',
  bucketName = process.env.OMI_STT_GCS_BUCKET || `${projectId}-omi-stt`;
// Inline results allow one file per BatchRecognize request, so files run as parallel requests.
const BATCH = 1,
  PARALLEL = 4,
  TIMEOUT_MS = 30 * 60_000;

function run(command: string, argv: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} failed: ${stderr.slice(-300)}`)),
    );
  });
}

const posts = [];
for (let offset: number | null = 0; offset !== null; ) {
  const page = listBookmarks(
    new URLSearchParams({ ...(folder ? { folder } : {}), offset: String(offset), limit: '100' }),
  );
  posts.push(...page.items);
  offset = page.nextOffset;
}
const index = readMediaIndex(),
  done = readTranscripts();
function hasAudio(file: string) {
  return new Promise<boolean>((resolve) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      file,
    ]);
    let out = '';
    child.stdout.on('data', (c) => (out += c));
    child.on('close', () => resolve(out.trim().length > 0));
  });
}
const queue = posts.flatMap((p) =>
  p.media.flatMap((m, i) => {
    const key = `${p.id}:${i}`;
    return index[key] && (force || !done[key])
      ? [{ key, file: path.join(mediaDir(), index[key].file), seconds: (m.durationMs || 0) / 1000 }]
      : [];
  }),
);
const minutes = queue.reduce((a, q) => a + q.seconds, 0) / 60;
console.log(
  JSON.stringify({
    savedVideos: posts.reduce((n, p) => n + p.media.filter((m) => m.localUrl).length, 0),
    toTranscribe: queue.length,
    minutes: Math.round(minutes * 10) / 10,
    estimatedUsd: Math.round(minutes * 0.016 * 100) / 100,
  }),
);
if (dryRun || !queue.length) process.exit(0);
if (!projectId || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Google Speech credentials are not configured (see the Omi setup in .env).');
  process.exit(1);
}

const speech = new speechV2.SpeechClient({ apiEndpoint: `${location}-speech.googleapis.com` });
const bucket = new Storage({ projectId }).bucket(bucketName);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-stt-'));
let transcribed = 0,
  failed = 0;
try {
  const starts = Array.from({ length: Math.ceil(queue.length / BATCH) }, (_, i) => i * BATCH);
  const worker = async () => {
    for (let b = starts.shift(); b !== undefined; b = starts.shift()) {
      // Silent videos (no audio track) have nothing to transcribe; record them as no speech.
      const items = queue.slice(b, b + BATCH),
        silent: typeof items = [];
      for (const q of items) if (!(await hasAudio(q.file))) silent.push(q);
      if (silent.length) {
        await withLock(() => {
          const transcripts = readTranscripts();
          for (const q of silent) {
            transcripts[q.key] = {
              text: '',
              model: 'none (no audio track)',
              transcribedAt: new Date().toISOString(),
            };
            console.log(`${q.key}: no audio track`);
          }
          writeJson('transcripts.json', transcripts);
        });
        transcribed += silent.length;
        if (silent.length === items.length) continue;
      }
      const batch = queue.slice(b, b + BATCH).map((q) => ({
        ...q,
        object: `bookmark-video-audio/${q.key.replace(':', '-')}-${randomUUID().slice(0, 8)}.flac`,
        local: path.join(work, `${q.key.replace(':', '-')}.flac`),
      }));
      try {
        for (const q of batch) {
          await run('ffmpeg', [
            '-hide_banner',
            '-loglevel',
            'error',
            '-y',
            '-i',
            q.file,
            '-vn',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-c:a',
            'flac',
            q.local,
          ]);
          await bucket.upload(q.local, {
            destination: q.object,
            metadata: { contentType: 'audio/flac' },
          });
        }
        const uri = (q: (typeof batch)[number]) => `gs://${bucketName}/${q.object}`;
        const [operation] = await speech.batchRecognize({
          recognizer: `projects/${projectId}/locations/${location}/recognizers/_`,
          config: {
            autoDecodingConfig: {},
            model,
            languageCodes: ['auto'],
            features: { enableAutomaticPunctuation: true, maxAlternatives: 1 },
          },
          files: batch.map((q) => ({ uri: uri(q) })),
          recognitionOutputConfig: { inlineResponseConfig: {} },
        });
        const deadline = Date.now() + TIMEOUT_MS;
        let result: { results?: Record<string, unknown> } | undefined;
        while (!result) {
          const progress = await speech.checkBatchRecognizeProgress(operation.name!);
          if (progress.done) {
            if (progress.latestResponse?.error)
              throw new Error(JSON.stringify(progress.latestResponse.error));
            result = (progress.result || {}) as { results?: Record<string, unknown> };
            break;
          }
          if (Date.now() > deadline) throw new Error('Speech operation timed out.');
          await new Promise((r) => setTimeout(r, 15_000));
        }
        const results = (result?.results || {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
        await withLock(() => {
          const transcripts = readTranscripts();
          for (const q of batch) {
            const file = results[uri(q)];
            if (!file || file.error) {
              failed++;
              console.log(`failed ${q.key}: ${file?.error?.message || 'no result'}`);
              continue;
            }
            const parts = (file.inlineResult?.transcript?.results || []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
            const text = parts
              .map((r) => r.alternatives?.[0]?.transcript?.trim() || '')
              .filter(Boolean)
              .join('\n');
            const language = parts.find((r) => r.languageCode)?.languageCode;
            transcripts[q.key] = {
              text,
              ...(language ? { language } : {}),
              model,
              transcribedAt: new Date().toISOString(),
            };
            transcribed++;
            console.log(
              `${q.key}: ${text ? `${text.length} chars${language ? ` (${language})` : ''}` : 'no speech'}`,
            );
          }
          writeJson('transcripts.json', transcripts);
        });
      } catch (e) {
        failed += batch.length;
        console.log(
          `failed ${batch.map((q) => q.key).join(', ')}: ${(e as Error).message.slice(0, 300)}`,
        );
      } finally {
        for (const q of batch) {
          await bucket
            .file(q.object)
            .delete()
            .catch(() => {});
          fs.rmSync(q.local, { force: true });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log(JSON.stringify({ transcribed, failed }));
if (failed) process.exitCode = 1;
