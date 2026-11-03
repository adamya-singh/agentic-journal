import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mediaRoot, readState, withLock, writeState } from './store.ts';
import { readUnwind, withUnwind } from './unwind-store.ts';
import type { Acquisition, AcquisitionStore } from './acquisition-types.ts';

const file = () => path.join(mediaRoot(), 'acquisition.json');
export function readAcquisitions(): AcquisitionStore {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, requests: {} };
    throw new Error('Acquisition storage could not be read. Restore it before continuing.');
  }
}
export function withAcquisitions<T>(fn: (s: AcquisitionStore) => T | Promise<T>) {
  return withLock(async () => {
    const s = readAcquisitions();
    const value = await fn(s);
    const temp = `${file()}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(s) + '\n', { mode: 0o600 });
    fs.renameSync(temp, file());
    return value;
  }, 'acquisition');
}
export function knownTitle(id: string) {
  if (!/^tt\d{5,10}$/.test(id)) throw new Error('Only IMDb movies and series can be requested.');
  const t = readState().titles[id];
  const u = readUnwind().shows[id];
  if (!t && !u) throw new Error('Add this title to Media first.');
  if (
    !u &&
    !/^(Movie|TV Movie|TV Series|TV Mini Series|TV Mini-Series|TVSeries|TVMiniSeries)$/i.test(
      t?.type || '',
    )
  )
    throw new Error('This title must be resolved as a movie or series first.');
  return {
    id,
    title: u?.title || t!.title,
    kind: u?.kind || (/series/i.test(t?.type || '') ? ('series' as const) : ('film' as const)),
  };
}
export async function requestAcquisition(id: string, seasons?: number[]) {
  const t = knownTitle(id);
  if (
    t.kind === 'series' &&
    (!seasons?.length || seasons.some((n) => !Number.isInteger(n) || n < 0 || n > 999))
  )
    throw new Error('Choose at least one season.');
  const selected = t.kind === 'series' ? [...new Set(seasons)].sort((a, b) => a - b) : [];
  const r = await withAcquisitions((s) => {
    const old = s.requests[id];
    if (old?.wanted && JSON.stringify(old.seasons) === JSON.stringify(selected)) return old;
    const next: Acquisition = {
      ...old,
      ...t,
      seasons: selected,
      wanted: true,
      revision: (old?.revision || 0) + 1,
      status: 'wanted',
      note: undefined,
      attempts: 0,
      retryAt: undefined,
      items: old?.items || [],
      updatedAt: new Date().toISOString(),
    };
    s.requests[id] = next;
    return next;
  });
  await projectFlags(id, true);
  return r;
}
export async function projectFlags(id: string, on: boolean) {
  await withLock(() => {
    const s = readState();
    const wanted = readAcquisitions().requests[id]?.wanted ?? on;
    if (s.titles[id] && !!s.titles[id].download !== wanted) {
      s.titles[id].download = wanted || undefined;
      writeState(s);
    }
  });
}
export async function cancelAcquisition(id: string) {
  await withAcquisitions((s) => {
    const r = s.requests[id];
    if (r)
      Object.assign(r, {
        wanted: false,
        revision: r.revision + 1,
        status: 'paused',
        note: 'Keeping existing files.',
        retryAt: undefined,
        updatedAt: new Date().toISOString(),
      });
  });
  await projectFlags(id, false);
  await withUnwind((u) => {
    delete u.wanted[id];
  });
}
export async function stageAcquisition(id: string) {
  const t = knownTitle(id);
  if (t.kind === 'film') return requestAcquisition(id);
  const old = readAcquisitions().requests[id];
  if (old?.wanted) return old;
  const r = await withAcquisitions((s) => {
    const next: Acquisition = {
      ...old,
      ...t,
      seasons: [],
      wanted: true,
      revision: (old?.revision || 0) + 1,
      items: old?.items || [],
      attempts: 0,
      status: 'attention',
      note: 'Choose seasons to download.',
      updatedAt: new Date().toISOString(),
    };
    s.requests[id] = next;
    return next;
  });
  await projectFlags(id, true);
  return r;
}
export async function retryAcquisition(id: string) {
  return withAcquisitions((s) => {
    const r = s.requests[id];
    if (!r?.wanted) throw new Error('This title is not selected.');
    r.attempts = 0;
    r.retryAt = undefined;
    r.note = undefined;
    r.status = 'wanted';
    r.searchedRevision = undefined;
    r.searchedAt = undefined;
  });
}
// One-time import of previous flags. A series always waits for season selection.
export async function migrateAcquisitions() {
  await withAcquisitions((s) => {
    if (s.migrated) return;
    const titles = Object.values(readState().titles).filter((x) => x.download);
    const wanted = Object.keys(readUnwind().wanted);
    for (const id of [...new Set([...titles.map((t) => t.id), ...wanted])]) {
      if (s.requests[id] || !/^tt\d{5,10}$/.test(id)) continue;
      try {
        const t = knownTitle(id);
        s.requests[id] = {
          ...t,
          wanted: true,
          seasons: [],
          revision: 1,
          items: [],
          attempts: 0,
          status: t.kind === 'series' ? 'attention' : 'wanted',
          note: t.kind === 'series' ? 'Choose seasons to download.' : undefined,
          updatedAt: new Date().toISOString(),
        };
      } catch {
        /* Unsupported historical flags are left unchanged. */
      }
    }
    s.migrated = true;
  });
}
