import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  dataRoot,
  mediaKey,
  readMediaIndex,
  readSources,
  readState,
  withLock,
  writeJson,
} from './store.ts';

// Local copies of bookmarked videos, so they survive the post being deleted on X.
const MAX_BYTES = 1024 * 1024 * 1024;
export const mediaDir = () => path.join(dataRoot(), 'media');

/** Resolves a downloaded file for serving; undefined unless indexed and present on disk. */
export function localMediaFile(postId: string, index: number) {
  if (!/^\d{1,19}$/.test(postId) || !Number.isInteger(index) || index < 0 || index > 3) return;
  const entry = readMediaIndex()[mediaKey(postId, index)];
  if (!entry || path.basename(entry.file) !== entry.file) return;
  const file = path.join(mediaDir(), entry.file);
  try {
    return { file, size: fs.statSync(file).size, contentType: entry.contentType };
  } catch {
    return undefined;
  }
}

/**
 * Downloads the MP4 of every video/GIF in the given posts that is not saved yet.
 * Sequential and free (X's video CDN needs no API call); failures are reported, not retried.
 */
export async function downloadVideos(
  postIds: string[],
  fetcher: typeof fetch = fetch,
  onProgress: (line: string) => void = () => {},
) {
  const account = readState().accountId;
  const sources = readSources();
  const wanted = postIds.flatMap((postId) => {
    const source = sources[`${account}:${postId}`];
    return (source?.media || []).flatMap((m, index) =>
      m.video ? [{ postId, index, url: m.video }] : [],
    );
  });
  fs.mkdirSync(mediaDir(), { recursive: true, mode: 0o700 });
  const result = { saved: 0, skipped: 0, failed: [] as string[], bytes: 0 };
  for (const item of wanted) {
    const key = mediaKey(item.postId, item.index);
    if (readMediaIndex()[key] && localMediaFile(item.postId, item.index)) {
      result.skipped++;
      continue;
    }
    if (new URL(item.url).hostname !== 'video.twimg.com') {
      result.failed.push(`${key} (unexpected host)`);
      continue;
    }
    const file = `${item.postId}-${item.index}.mp4`,
      tmp = path.join(mediaDir(), `.${file}.${randomUUID()}.tmp`);
    try {
      const response = await fetcher(item.url, { signal: AbortSignal.timeout(300_000) });
      const declared = Number(response.headers.get('content-length') || 0);
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      if (declared > MAX_BYTES) throw new Error('file too large');
      const out = fs.createWriteStream(tmp, { mode: 0o600 });
      let bytes = 0;
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) throw new Error('file too large');
        if (!out.write(chunk)) await new Promise<void>((r) => out.once('drain', () => r()));
      }
      await new Promise<void>((resolve, reject) =>
        out.end((err?: Error | null) => (err ? reject(err) : resolve())),
      );
      if (!bytes) throw new Error('empty file');
      fs.renameSync(tmp, path.join(mediaDir(), file));
      await withLock(() => {
        const index = readMediaIndex();
        index[key] = {
          file,
          bytes,
          contentType: 'video/mp4',
          savedAt: new Date().toISOString(),
          source: item.url,
        };
        writeJson('media.json', index);
      });
      result.saved++;
      result.bytes += bytes;
      onProgress(`saved ${key} (${(bytes / 1048576).toFixed(1)} MB)`);
    } catch (e) {
      fs.rmSync(tmp, { force: true });
      result.failed.push(`${key} (${(e as Error).message})`);
      onProgress(`failed ${key}: ${(e as Error).message}`);
    }
  }
  return result;
}
