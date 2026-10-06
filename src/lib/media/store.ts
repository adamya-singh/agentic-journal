import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Collection,
  Coverage,
  MediaAction,
  MediaState,
  MediaTitle,
  MediaView,
} from './types.ts';

export const mediaRoot = () =>
  path.join(process.env.BACKEND_DATA_DIR || path.join(process.cwd(), 'src/backend/data'), 'media');
export const initialState = (): MediaState => ({
  version: 1,
  titles: {},
  recommendations: [],
  feedback: {},
  coverage: {},
  jobs: [],
});
export function readState(): MediaState {
  try {
    return JSON.parse(fs.readFileSync(path.join(mediaRoot(), 'state.json'), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return initialState();
    throw new Error('Media storage could not be read. Restore it before continuing.');
  }
}
export function writeState(state: MediaState) {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const file = path.join(mediaRoot(), 'state.json'),
    tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
// Cross-process lock shared by the API, worker and CLI. Browser work uses a
// separate lock so feedback and status reads remain responsive during a sync.
export async function withLock<T>(fn: () => T | Promise<T>, name = 'store'): Promise<T> {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const file = path.join(mediaRoot(), `${name}.lock`);
  let owned = false;
  for (let n = 0; n < 200 && !owned; n++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 });
      owned = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // Reclaim only dead owners. An empty file during creation is never reclaimed.
      let recovering = false;
      const recovery = `${file}.recovery`;
      try {
        fs.mkdirSync(recovery);
        recovering = true;
        const pid = Number(fs.readFileSync(file, 'utf8'));
        if (pid > 0) {
          try {
            process.kill(pid, 0);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ESRCH') fs.unlinkSync(file);
          }
        }
      } catch (err) {
        if (!['EEXIST', 'ENOENT'].includes((err as NodeJS.ErrnoException).code || '')) throw err;
      } finally {
        if (recovering) fs.rmdirSync(recovery);
      }
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  if (!owned) throw new Error('Media is busy. Try again shortly.');
  try {
    return await fn();
  } finally {
    fs.unlinkSync(file);
  }
}
export function view(): MediaView {
  const s = readState();
  const pendingSeen = new Set(
    s.jobs
      .filter((j) => ['queued', 'running'].includes(j.status) && j.action === 'seen')
      .map((j) => j.titleId),
  );
  const titles = Object.values(s.titles);
  const { titles: _titles, ...rest } = s;
  void _titles;
  return {
    ...rest,
    library: titles
      .filter((t) => t.collections.length)
      .sort((a, b) => (b.yourRating || 0) - (a.yourRating || 0) || a.title.localeCompare(b.title)),
    picks: s.recommendations
      .map((id) => s.titles[id])
      .filter((t) => t && !t.watched && !pendingSeen.has(t.id) && s.feedback[t.id] !== 'dismissed'),
    dismissed: titles.filter((t) => s.feedback[t.id] === 'dismissed'),
  };
}
export async function feedback(id: string, value: 'interested' | 'dismissed' | null) {
  return withLock(() => {
    const s = readState();
    if (!s.titles[id]) throw new Error('Title not found. Refresh the page.');
    if (value === null) delete s.feedback[id];
    else s.feedback[id] = value;
    writeState(s);
  });
}
export async function enqueue(action: MediaAction, titleId?: string, rating?: number) {
  return withLock(() => {
    const s = readState();
    if (action !== 'sync' && (!titleId || !s.titles[titleId]))
      throw new Error('Title not found. Refresh the page.');
    const pending = s.jobs.filter((j) => ['queued', 'running'].includes(j.status));
    const duplicate = pending.find(
      (j) => j.action === action && j.titleId === titleId && j.rating === rating,
    );
    if (duplicate) return duplicate.id;
    if (pending.length >= 50) throw new Error('The media queue is full. Wait for pending changes.');
    if (pending.some((j) => titleId && j.titleId === titleId && j.action === action))
      throw new Error('This title already has a pending change. Wait for it to finish.');
    const id = randomUUID();
    s.jobs = s.jobs
      .filter((j) => ['queued', 'running'].includes(j.status))
      .concat(s.jobs.filter((j) => !['queued', 'running'].includes(j.status)).slice(-100));
    s.jobs.push({
      id,
      action,
      titleId,
      rating,
      status: 'queued',
      createdAt: new Date().toISOString(),
    });
    writeState(s);
    return id;
  });
}
// A partial refresh adds observed evidence without erasing old membership.
// Only complete collection reads can establish absence or a removed rating.
export function mergeCollection(
  s: MediaState,
  collection: Collection,
  items: MediaTitle[],
  coverage: Coverage,
) {
  if (coverage.complete) {
    for (const t of Object.values(s.titles)) {
      t.collections = t.collections.filter((c) => c !== collection);
      if (collection === 'watched') t.watched = false;
      if (collection === 'watchlist') t.watchlist = false;
      if (collection === 'ratings') t.yourRating = null;
    }
  }
  for (const item of items) {
    const old = s.titles[item.id];
    const defined = Object.fromEntries(
      Object.entries(item).filter(
        ([key, v]) => !['watched', 'watchlist'].includes(key) && v !== undefined,
      ),
    );
    const t = {
      ...old,
      ...defined,
      collections: [...new Set([...(old?.collections || []), collection])],
    } as MediaTitle;
    if (collection === 'watched' || collection === 'ratings') t.watched = true;
    if (collection === 'watchlist') t.watchlist = true;
    s.titles[t.id] = t;
  }
  // Any personal rating is IMDb evidence of a watch, even if a history refresh was partial.
  for (const t of Object.values(s.titles)) if (t.yourRating) t.watched = true;
  s.coverage[collection] = coverage;
}
