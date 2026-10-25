import { defaultFetchers, searchShows, searchTitles, type CatalogFetchers } from './catalog.ts';
import { guessKey, normTitle, prepare, readLibrary, scan, setMatch, withLibrary, type LibFile } from './library.ts';
import { withLock } from './store.ts';
import { addShows, addSource, readUnwind, withUnwind, type Show } from './unwind-store.ts';

// Ties library files to Unwind: a file named like a show or film you have is
// matched by name; a name Unwind doesn't know yet is looked up in the catalogs
// once a day and, on an exact match, added to your deck. Matched files become
// play sources for their episode.

const DAY = 86_400_000;

async function lookUp(file: LibFile, f: CatalogFetchers): Promise<string | undefined> {
  const g = file.guess!;
  const want = normTitle(g.title);
  if (guessKey(g) !== 'film') {
    const hits = await searchShows(g.title, f);
    return hits.find((h) => h.imdb && normTitle(h.name) === want)?.imdb;
  }
  const hits = await searchTitles(g.title, f);
  return hits.find((h) => h.kind === 'film' && normTitle(h.title) === want && (!g.year || h.year?.startsWith(g.year)))?.id;
}

export async function matchFiles(f: CatalogFetchers = defaultFetchers, now = Date.now()) {
  const lib = readLibrary();
  let shows = readUnwind().shows;
  const res = { matched: 0, wired: 0, added: [] as string[], pruned: 0 };
  const byTitle = () => {
    const m = new Map<string, Show[]>();
    for (const s of Object.values(shows)) m.set(normTitle(s.title), [...(m.get(normTitle(s.title)) || []), s]);
    return m;
  };
  let titles = byTitle();
  for (const file of Object.values(lib.files)) {
    if (file.status === 'settling') continue;
    let match = file.match;
    if (!match && file.guess) {
      const key = guessKey(file.guess);
      const kind = key === 'film' ? 'film' : 'series';
      const want = normTitle(file.guess.title);
      // Exact first; then a show whose (long enough) title the file name contains, like "TVFs.Aspirants".
      let show =
        titles.get(want)?.find((s) => s.kind === kind) ??
        [...titles]
          .filter(([t]) => t.length >= 6 && want.includes(t))
          .sort((a, b) => b[0].length - a[0].length)
          .flatMap(([, list]) => list)
          .find((s) => s.kind === kind);
      if (!show && (!file.lookedUpAt || now - Date.parse(file.lookedUpAt) > DAY)) {
        const id = await lookUp(file, f).catch(() => undefined);
        await withLibrary((l) => {
          if (l.files[file.id]) l.files[file.id].lookedUpAt = new Date(now).toISOString();
        });
        if (id) {
          const r = await addShows([{ id }], 'library', f);
          if (r.added.length) res.added.push(id);
          shows = readUnwind().shows;
          titles = byTitle();
          show = shows[id];
        }
      }
      if (show) {
        match = { showId: show.id, key, by: 'name', at: new Date(now).toISOString() };
        await setMatch(file.id, { showId: show.id, key }, 'name');
        res.matched++;
      }
    }
    if (!match) continue;
    const s = shows[match.showId];
    if (s && !(s.sources[match.key] || []).some((x) => x.kind === 'file' && x.fileId === file.id)) {
      try {
        await addSource(match.showId, match.key, { kind: 'file', fileId: file.id, addedAt: new Date(now).toISOString() });
        res.wired++;
      } catch {
        /* The episode isn't in the catalog yet; a later episode refresh lets it in. */
      }
    }
  }
  // Files that left the library stop being sources.
  const present = new Set(Object.keys(lib.files));
  res.pruned = await withUnwind((u) => {
    let n = 0;
    for (const s of Object.values(u.shows))
      for (const [key, list] of Object.entries(s.sources)) {
        const keep = list.filter((x) => x.kind !== 'file' || present.has(x.fileId));
        n += list.length - keep.length;
        if (keep.length) s.sources[key] = keep;
        else delete s.sources[key];
      }
    return n;
  });
  return res;
}

// One pass of the library worker: find files, match them, make one playable.
export async function libraryPass(f: CatalogFetchers = defaultFetchers) {
  const scanned = await scan();
  const matched = await matchFiles(f);
  const lib = readLibrary();
  // Matched files first (you can watch them), then oldest first.
  const next = Object.values(lib.files)
    .filter((x) => x.status === 'new')
    .sort((a, b) => Number(!!b.match) - Number(!!a.match) || a.seenAt.localeCompare(b.seenAt))[0];
  const prepared = next ? await prepare(next.id) : undefined;
  return { scanned, matched, prepared: prepared ? { id: prepared.id, status: prepared.status, plan: prepared.plan } : undefined };
}

export async function runLibraryWorker() {
  await withLock(async () => {
    for (;;) {
      let busy = false;
      try {
        const r = await libraryPass();
        busy = !!r.prepared;
      } catch (e) {
        console.error(`Library pass failed: ${(e as Error).message}`);
      }
      // Straight on while there is work; otherwise look again in 30 s.
      if (!busy) await new Promise((r) => setTimeout(r, 30_000));
    }
  }, 'library-worker');
}
