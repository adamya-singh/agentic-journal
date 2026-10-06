import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  BookmarkAnnotation,
  BookmarkSource,
  BookmarkState,
  Bookmark,
  BookmarkFolderStore,
  BookmarkList,
  BookmarkMediaIndex,
  BookmarkTranscripts,
  BookmarkSort,
} from './types.ts';

export const dataRoot = () =>
  path.join(
    process.env.BACKEND_DATA_DIR || path.join(process.cwd(), 'src/backend/data'),
    'bookmarks',
  );
export const journalOrigin = () =>
  new URL(process.env.X_BOOKMARKS_ORIGIN || 'https://ubuntu-laptop.taile85e97.ts.net').origin;
const journalLink = (key: string) => `${journalOrigin()}/bookmarks?item=${encodeURIComponent(key)}`;
export const initialState = (): BookmarkState => ({
  version: 1,
  historyComplete: false,
  budgetConfirmed: false,
  pilotComplete: false,
  pilotReviewed: false,
  history: [],
  usage: {},
});
export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataRoot(), name), 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw new Error(
      'Bookmark storage could not be read. Restore the file from backup before continuing.',
    );
  }
}
export function writeJson(name: string, value: unknown) {
  fs.mkdirSync(dataRoot(), { recursive: true, mode: 0o700 });
  const file = path.join(dataRoot(), name),
    tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
export async function withLock<T>(fn: () => T | Promise<T>, name = '.store-lock'): Promise<T> {
  fs.mkdirSync(dataRoot(), { recursive: true, mode: 0o700 });
  const lock = path.join(dataRoot(), name);
  const recoveryLock = `${lock}.recovery`;
  for (let attempt = 0; attempt < 200; attempt++) {
    let acquired = false;
    try {
      fs.mkdirSync(lock);
      acquired = true;
      fs.writeFileSync(path.join(lock, 'pid'), String(process.pid));
      break;
    } catch (e) {
      if (acquired) fs.rmSync(lock, { recursive: true, force: true });
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      // Serialize stale-owner checks: two reclaimers must never delete a new owner's lock.
      let recovering = false;
      try {
        fs.mkdirSync(recoveryLock);
        recovering = true;
        let stale = false;
        try {
          const pid = Number(fs.readFileSync(path.join(lock, 'pid'), 'utf8'));
          if (Number.isInteger(pid) && pid > 0) {
            try {
              process.kill(pid, 0);
            } catch (err) {
              stale = (err as NodeJS.ErrnoException).code === 'ESRCH';
            }
          } else {
            stale = Date.now() - fs.statSync(lock).mtimeMs > 30_000;
          }
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
            try {
              stale = Date.now() - fs.statSync(lock).mtimeMs > 30_000;
            } catch {
              /* Owner already released. */
            }
          } else {
            throw err;
          }
        }
        if (stale) fs.rmSync(lock, { recursive: true, force: true });
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      } finally {
        if (recovering) fs.rmSync(recoveryLock, { recursive: true, force: true });
      }
      if (attempt === 199) throw new Error('Bookmark storage is busy. Try again shortly.');
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  try {
    return await fn();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
export const readState = () => readJson('state.json', initialState());
export const readSources = () => readJson<Record<string, BookmarkSource>>('sources.json', {});
export const readAnnotations = () =>
  readJson<Record<string, BookmarkAnnotation>>('annotations.json', {});
export const readMediaIndex = () => readJson<BookmarkMediaIndex>('media.json', {});
export const mediaKey = (postId: string, index: number) => `${postId}:${index}`;
/** Adds `localUrl` to media that have a downloaded copy (see media.ts). */
export const readTranscripts = () => readJson<BookmarkTranscripts>('transcripts.json', {});
/** Adds `localUrl` (downloaded copy, see media.ts) and `transcript` to each media item. */
export function withLocalMedia(
  source: BookmarkSource,
  index: BookmarkMediaIndex,
  transcripts: BookmarkTranscripts = {},
) {
  return source.media.map((m, i) => {
    const key = mediaKey(source.id, i);
    return index[key]
      ? {
          ...m,
          localUrl: `/api/bookmarks/media/${source.id}/${i}`,
          ...(transcripts[key] ? { transcript: transcripts[key].text } : {}),
        }
      : m;
  });
}
export const readFolders = () =>
  readJson<BookmarkFolderStore>('folders.json', { folders: [], membership: {} });
/** Post ID → folder IDs, combining the API's newest-20 lists with full lists read from x.com. */
export function folderMembership(store: BookmarkFolderStore, account?: string) {
  if (store.accountId !== account) return {};
  const merged: Record<string, string[]> = {};
  const add = (postId: string, folderId: string) => {
    const list = (merged[postId] ||= []);
    if (!list.includes(folderId)) list.push(folderId);
  };
  for (const [postId, folderIds] of Object.entries(store.membership))
    for (const folderId of folderIds) add(postId, folderId);
  for (const [folderId, web] of Object.entries(store.web || {}))
    if (store.folders.some((f) => f.id === folderId))
      for (const postId of web.ids) add(postId, folderId);
  return merged;
}
/**
 * Gives every source a savedRank (higher = bookmarked more recently), in place.
 * Imports before ranks existed stamped each page with its import time, so X's order is
 * pages in import order (>100 ms apart) and, within a page, descending importedAt (1 ms steps).
 * Unranked sources are placed below any ranked ones, since they came from history pages.
 */
export function ensureSavedRanks(sources: Record<string, BookmarkSource>) {
  const unranked = Object.values(sources).filter((v) => v.savedRank === undefined);
  if (!unranked.length) return false;
  const time = (v: BookmarkSource) => Date.parse(v.importedAt);
  unranked.sort((a, b) => time(a) - time(b));
  const pages: BookmarkSource[][] = [];
  for (const v of unranked) {
    const page = pages.at(-1);
    if (page && time(v) - time(page.at(-1)!) <= 100) page.push(v);
    else pages.push([v]);
  }
  const ranked = Object.values(sources).flatMap((v) =>
    v.savedRank === undefined ? [] : [v.savedRank],
  );
  let rank = ranked.length ? Math.min(...ranked) - 1 : 0;
  for (const page of pages)
    for (const v of page.sort((a, b) => time(b) - time(a) || b.id.localeCompare(a.id)))
      v.savedRank = rank--;
  return true;
}
const sorters: Record<BookmarkSort, (a: Bookmark, b: Bookmark) => number> = {
  saved: (a, b) => b.savedRank! - a.savedRank!,
  'saved-oldest': (a, b) => a.savedRank! - b.savedRank!,
  posted: (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''),
  'posted-oldest': (a, b) => (a.publishedAt || '9').localeCompare(b.publishedAt || '9'),
  author: (a, b) =>
    a.author.name.localeCompare(b.author.name, undefined, {
      sensitivity: 'base',
      ignorePunctuation: true,
    }) || b.savedRank! - a.savedRank!,
};
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const u = new URL(value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export function listBookmarks(params = new URLSearchParams()): BookmarkList {
  const annotations = readAnnotations(),
    sources = readSources(),
    account = readState().accountId,
    folderStore = readFolders(),
    mediaIndex = readMediaIndex(),
    transcripts = readTranscripts();
  ensureSavedRanks(sources);
  const membership = folderMembership(folderStore, account);
  let items: Bookmark[] = Object.entries(sources)
    .filter(([, s]) => s.accountId === account)
    .map(([key, s]) => ({
      ...s,
      ...(annotations[key] || { favorite: false, read: false, tags: [] }),
      media: withLocalMedia(s, mediaIndex, transcripts),
      key,
      journalUrl: journalLink(key),
      folders: membership[s.id] || [],
    }));
  const collectionTotal = items.length;
  const tags = [...new Set(items.flatMap((i) => i.tags))].sort();
  const folders = (folderStore.accountId === account ? folderStore.folders : []).map((f) => ({
    ...f,
    count: items.filter((i) => i.folders.includes(f.id)).length,
  }));
  const unsortedCount = items.filter((i) => !i.folders.length).length;
  const folder = params.get('folder') || '',
    author = (params.get('author') || '').toLowerCase();
  const q = (params.get('q') || '').toLowerCase().trim();
  items = items.filter(
    (i) =>
      (!q ||
        q
          .split(/\s+/)
          .every((term) =>
            [
              i.text,
              i.author.name,
              i.author.username,
              ...i.tags,
              ...i.links.flatMap((l) => [l.title, l.domain, l.description]),
              ...i.media.map((m) => m.transcript),
            ]
              .join(' ')
              .toLowerCase()
              .includes(term),
          )) &&
      (params.get('unread') !== 'true' || !i.read) &&
      (params.get('favorite') !== 'true' || i.favorite) &&
      (!params.get('tag') || i.tags.includes(params.get('tag')!)) &&
      (!folder || (folder === 'none' ? !i.folders.length : i.folders.includes(folder))) &&
      (!author || i.author.username.toLowerCase() === author) &&
      (!params.get('media') ||
        (params.get('media') === 'text'
          ? !i.media.length && !i.links.length
          : params.get('media') === 'link'
            ? !!i.links.length
            : i.media.some((m) =>
                params.get('media') === 'photo' ? m.type === 'photo' : m.type !== 'photo',
              ))),
  );
  const sort = params.get('sort') as BookmarkSort;
  items.sort((a, b) => (sorters[sort] || sorters.saved)(a, b) || b.id.localeCompare(a.id));
  const parsedOffset = Number(params.get('offset')),
    parsedLimit = Number(params.get('limit'));
  const offset = Number.isFinite(parsedOffset) ? Math.max(0, Math.floor(parsedOffset)) : 0;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(100, Math.max(1, Math.floor(parsedLimit)))
      : 40;
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    tags,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    folders,
    unsortedCount,
    collectionTotal,
    folderSyncedAt: folderStore.accountId === account ? folderStore.syncedAt : undefined,
  };
}
export function getBookmark(key: string): Bookmark | undefined {
  const source = readSources()[key],
    account = readState().accountId;
  if (!source || source.accountId !== account) return undefined;
  const folderStore = readFolders();
  return {
    ...source,
    ...(readAnnotations()[key] || { favorite: false, read: false, tags: [] }),
    media: withLocalMedia(source, readMediaIndex(), readTranscripts()),
    key,
    journalUrl: journalLink(key),
    folders: folderMembership(folderStore, account)[source.id] || [],
  };
}
export async function updateBookmark(
  key: string,
  update: { favorite?: boolean; read?: boolean; tags?: string[] },
) {
  return withLock(() => {
    if (!getBookmark(key)) throw new Error('Bookmark not found.');
    const annotations = readAnnotations();
    annotations[key] = {
      ...(annotations[key] || { favorite: false, read: false, tags: [] }),
      ...update,
    };
    writeJson('annotations.json', annotations);
    return getBookmark(key);
  });
}
