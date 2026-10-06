import { connectIMDb, IMDbError, type IMDbSession } from './imdb.ts';
import { readState, writeState, withLock, mergeCollection } from './store.ts';
import type { MediaJob, MediaTitle } from './types.ts';

export async function recoverInterrupted() {
  await withLock(() => {
    const s = readState();
    for (const j of s.jobs)
      if (j.status === 'running') {
        j.status = 'failed';
        j.finishedAt = new Date().toISOString();
        j.error = 'Worker interrupted. Retry explicitly; IMDb will be checked before any change.';
      }
    writeState(s);
  });
}
export async function processNext(connect: (id?: string) => Promise<IMDbSession> = connectIMDb) {
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
    } catch (e) {
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
async function finish(job: MediaJob, error?: string) {
  await withLock(() => {
    const s = readState(),
      current = s.jobs.find((j) => j.id === job.id)!;
    current.status = error ? 'failed' : 'succeeded';
    current.error = error;
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
  const seeds = Object.values(s.titles).filter((t) => t.watched || t.watchlist);
  const picks = await session.recommendations(seeds);
  const requested = [
    ...seeds.filter((t) => !t.type || !t.genres),
    ...picks.filter((t) => !s.titles[t.id]?.type),
  ]
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
export async function runWorker() {
  // Prevent two daemon instances from recovering each other's running job.
  await withLock(async () => {
    await recoverInterrupted();
    while (true) {
      await processNext();
      await new Promise((r) => setTimeout(r, 3000));
    }
  }, 'worker');
}
