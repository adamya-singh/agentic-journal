import { connectIMDb, IMDbError, type IMDbSession } from './imdb.ts';
import { readState, writeState, withLock, mergeCollection, syncRatings, addJob } from './store.ts';
import { isImdb } from './ranking.ts';
import { connectYouTube, lookupChannel, YouTubeError, type YouTubeSession } from './youtube.ts';
import {
  assignChannels,
  mergeBatch,
  readYouTube,
  unknownChannelIds,
  writeYouTube,
} from './youtube-store.ts';
import type { MediaJob, MediaTitle } from './types.ts';

// One YouTube job reads for at most this long, then the next job continues from
// the saved cursor, so IMDb saves queued meanwhile are not held up.
export const YOUTUBE_BUDGET_MS = 5 * 60_000;
// A later sync stops once a page is mostly videos it already has.
const CAUGHT_UP = 30;
const DAY_MS = 24 * 3600_000;
const RETRY_MS = 3600_000;
const LOOKUPS_PER_JOB = 1000;
const LOOKUP_PARALLEL = 6;

export async function recoverInterrupted() {
  await withLock(() => {
    const s = readState();
    for (const j of s.jobs)
      if (j.status === 'running') {
        j.status = 'failed';
        j.finishedAt = new Date().toISOString();
        j.error =
          j.action === 'youtube-sync'
            ? 'Worker interrupted. Sync YouTube again to continue.'
            : 'Worker interrupted. Retry explicitly; IMDb will be checked before any change.';
      }
    writeState(s);
  });
}
export async function processNext(
  connect: (id?: string) => Promise<IMDbSession> = connectIMDb,
  connectYT: () => Promise<YouTubeSession> = connectYouTube,
) {
  return withLock(async () => {
    const job = await withLock(() => {
      const s = readState();
      s.workerAt = new Date().toISOString();
      const job = s.jobs.find((j) => j.status === 'queued');
      if (job) job.status = 'running';
      writeState(s);
      return job;
    });
    if (!job) return false;
    const heartbeat = setInterval(() => {
      void withLock(() => {
        const s = readState();
        s.workerAt = new Date().toISOString();
        writeState(s);
      }).catch(() => undefined);
    }, 15_000);
    if (job.action === 'youtube-sync') {
      try {
        const { note, more } = await syncYouTube(connectYT);
        await finish(job, undefined, note);
        if (more)
          await withLock(() => {
            const s = readState();
            addJob(s, 'youtube-sync');
            writeState(s);
          });
      } catch (e) {
        if (!(e instanceof YouTubeError))
          console.error('YouTube sync failed:', String((e as Error)?.message).split('\n')[0]);
        await finish(
          job,
          e instanceof YouTubeError ? e.message : 'YouTube could not be read. Sync again later.',
        );
      } finally {
        clearInterval(heartbeat);
      }
      return true;
    }
    let session: IMDbSession | undefined;
    try {
      const expected = readState().account?.id;
      session = await connect(expected);
      if (expected && session.account.id !== expected)
        throw new IMDbError('IMDb account changed. Restore the connected account before syncing.');
      await withLock(() => {
        const s = readState();
        s.account = session!.account;
        writeState(s);
      });
      if (job.action === 'sync') await sync(session);
      else {
        const patch = await session.change(job);
        await withLock(() => {
          const s = readState(),
            title = s.titles[job.titleId!];
          Object.assign(title, patch);
          if (patch.watched && !title.collections.includes('watched'))
            title.collections.push('watched');
          if (patch.watchlist && !title.collections.includes('watchlist'))
            title.collections.push('watchlist');
          if (patch.yourRating && !title.collections.includes('ratings'))
            title.collections.push('ratings');
          writeState(s);
        });
      }
      await finish(job);
      // Ranking moves made while this save ran may have changed other scores.
      if (job.action === 'rating') await syncRatings();
    } catch (e) {
      // The job record keeps a safe message; the log gets the first line of the raw cause.
      const raw = e instanceof IMDbError ? (e.cause as Error | undefined) : (e as Error);
      if (raw)
        console.error(
          `Media ${job.action} job failed${job.titleId ? ` (${job.titleId})` : ''}:`,
          String(raw?.message).split('\n')[0].slice(0, 300),
        );
      await finish(
        job,
        e instanceof IMDbError
          ? e.message
          : 'IMDb could not complete the request. Check login and the title, then retry.',
      );
    } finally {
      clearInterval(heartbeat);
      if (session) await session.close().catch(() => undefined);
    }
    return true;
  }, 'browser');
}
async function finish(job: MediaJob, error?: string, note?: string) {
  await withLock(() => {
    const s = readState(),
      current = s.jobs.find((j) => j.id === job.id)!;
    current.status = error ? 'failed' : 'succeeded';
    current.error = error;
    if (note) current.note = note;
    current.finishedAt = new Date().toISOString();
    s.workerAt = new Date().toISOString();
    writeState(s);
  });
}
async function sync(session: IMDbSession) {
  const incomplete: string[] = [];
  for (const c of ['watched', 'ratings', 'watchlist'] as const) {
    const result = await session.collection(c);
    if (!result.coverage.complete) incomplete.push(c);
    await withLock(() => {
      const s = readState();
      mergeCollection(s, c, result.items, result.coverage);
      writeState(s);
    });
  }
  const s = readState();
  const seeds = Object.values(s.titles).filter((t) => isImdb(t.id) && (t.watched || t.watchlist));
  const picks = await session.recommendations(seeds);
  const requested = [
    ...seeds.filter((t) => !t.type || !t.genres),
    ...picks.filter((t) => !s.titles[t.id]?.type),
  ]
    .filter((t) => isImdb(t.id))
    .filter((t, i, a) => a.findIndex((v) => v.id === t.id) === i)
    .slice(0, 150);
  let detail: MediaTitle[] = [];
  let detailWarning = false;
  if (session.enrich) {
    try {
      detail = await session.enrich(requested);
      detailWarning = detail.length < requested.length;
    } catch (e) {
      if (e instanceof IMDbError) throw e;
      detailWarning = true;
    }
  }
  await withLock(() => {
    const s = readState();
    for (const p of picks) {
      const old = s.titles[p.id];
      // Recommendations cannot overwrite verified account fields with an unloaded control.
      const metadata = Object.fromEntries(
        Object.entries(p).filter(
          ([key]) => !['watched', 'yourRating', 'watchlist', 'collections'].includes(key),
        ),
      ) as Omit<typeof p, 'collections'>;
      s.titles[p.id] = {
        ...metadata,
        ...old,
        reason: p.reason,
        collections: old?.collections || [],
      };
    }
    for (const d of detail)
      if (s.titles[d.id]) {
        // Enrichment supplies metadata only; feedback/account updates may have
        // happened while the browser was reading detail pages.
        const { type, year, genres, poster } = d;
        Object.assign(s.titles[d.id], { type, year, genres, poster });
      }
    s.recommendations = [...new Set(picks.map((p) => p.id))];
    s.syncedAt = new Date().toISOString();
    s.warning = incomplete.length
      ? `Partial IMDb coverage: ${incomplete.join(', ')}. Previously saved evidence is retained.`
      : detailWarning
        ? 'Library and recommendations refreshed. Some poster or format details are unavailable; all titles remain visible under All formats.'
        : picks.length
          ? undefined
          : 'IMDb returned no recommendations. Rate titles you like, then refresh.';
    writeState(s);
  });
}
async function saveYouTube(fn: (y: ReturnType<typeof readYouTube>) => void) {
  await withLock(() => {
    const y = readYouTube();
    fn(y);
    writeYouTube(y);
  });
}
// Reads YouTube history into youtube.json. Returns `more` when a full import
// ran out of time and another job should continue it.
async function syncYouTube(connect: () => Promise<YouTubeSession>) {
  await saveYouTube((y) => (y.lastAttemptAt = new Date().toISOString()));
  const session = await connect();
  try {
    if (!session.account)
      throw new YouTubeError("Sign in to YouTube in OpenClaw's browser, then sync again.");
    const start = readYouTube();
    if (!start.account || start.pendingAccount) {
      await saveYouTube((y) => (y.pendingAccount = session.account!));
      return { note: 'Waiting for you to confirm the YouTube account.', more: false };
    }
    if (start.account.id !== session.account.id) {
      const who = session.account.handle || session.account.name;
      throw new YouTubeError(
        `OpenClaw's browser is signed in to YouTube as ${who}, not ${start.account.handle || start.account.name}. Switch accounts there, then sync again.`,
      );
    }
    const incremental = !!start.coverage?.complete && !start.cursor;
    let result;
    try {
      result = await session.readHistory({
        cursor: start.cursor,
        lastDay: start.cursorDay,
        budgetMs: YOUTUBE_BUDGET_MS,
        onBatch: async (videos) => {
          const { known } = await mergeBatch(videos);
          return incremental && known >= CAUGHT_UP;
        },
      });
    } catch (e) {
      // A saved cursor can expire; start again from the newest videos next time.
      if (start.cursor) await saveYouTube((y) => (delete y.cursor, delete y.cursorDay));
      throw e;
    }
    // Shorts are listed without a channel; YouTube's public oEmbed has it.
    const unknown = unknownChannelIds(readYouTube(), LOOKUPS_PER_JOB);
    const found: Parameters<typeof assignChannels>[0] = [];
    for (let i = 0; i < unknown.length; i += LOOKUP_PARALLEL) {
      const batch = unknown.slice(i, i + LOOKUP_PARALLEL);
      const channels = await Promise.all(batch.map((videoId) => lookupChannel(videoId)));
      batch.forEach((videoId, j) => channels[j] && found.push({ videoId, ...channels[j] }));
    }
    if (found.length) await assignChannels(found);
    const now = new Date().toISOString();
    await saveYouTube((y) => {
      const days = Object.values(y.videos)
        .map((v) => v.lastWatchedDay)
        .sort();
      if (result.cursor) {
        y.cursor = result.cursor;
        y.cursorDay = result.lastDay;
      } else {
        delete y.cursor;
        delete y.cursorDay;
        y.lastSyncAt = now;
      }
      y.coverage = {
        oldestDay: days[0],
        complete: result.complete || !!y.coverage?.complete,
        total: days.length,
        at: now,
      };
    });
    return { note: undefined, more: !!result.cursor };
  } finally {
    await session.close().catch(() => undefined);
  }
}
// The daily sync: once the account is confirmed, read new history a day after
// the last successful sync, retrying a failed attempt at most hourly.
export async function queueDailyYouTube(now = Date.now()) {
  const y = readYouTube();
  if (!y.account || y.pendingAccount) return false;
  if (y.lastSyncAt && now - Date.parse(y.lastSyncAt) < DAY_MS) return false;
  if (y.lastAttemptAt && now - Date.parse(y.lastAttemptAt) < RETRY_MS) return false;
  return withLock(() => {
    const s = readState();
    if (s.jobs.some((j) => j.action === 'youtube-sync' && ['queued', 'running'].includes(j.status)))
      return false;
    addJob(s, 'youtube-sync');
    writeState(s);
    return true;
  });
}
export async function runWorker() {
  // Prevent two daemon instances from recovering each other's running job.
  await withLock(async () => {
    await recoverInterrupted();
    while (true) {
      await queueDailyYouTube().catch(() => undefined);
      await processNext();
      await new Promise((r) => setTimeout(r, 3000));
    }
  }, 'worker');
}
