import fs from 'node:fs';
import { z } from 'zod';
import { parseArgs, tasteDigest } from './feed-cli.ts';
import { fileIdOf, importFile, readLibrary, retry, scan, setMatch } from './library.ts';
import { matchFiles } from './library-sync.ts';
import { addYouTubeSource, findSources } from './unwind-sources.ts';
import {
  addShows,
  approveChannel,
  FILM,
  markEpisode,
  nextKey,
  readUnwind,
  refreshEpisodes,
  setShowState,
  SHOW_STATES,
  type ShowIn,
} from './unwind-store.ts';
import { unwindView } from './unwind-view.ts';

// `npm run media -- unwind-* | library-*`: how OpenClaw (and your own scripts)
// stock Unwind and its local library from a shell. JSON on stdout.

const tt = z.string().regex(/^tt\d{5,10}$/);
const epKey = z.string().regex(/^(S\d{1,3}E\d{1,4}|film)$/);
const ShowAlignment = z.object({
  fun: z.number().min(0).max(1),
  fit: z.number().min(0).max(1),
  tags: z.array(z.string().min(1).max(40)).max(4),
  why: z.string().min(3).max(300),
  judgedBy: z.string().max(60).default('openclaw'),
});
const ShowFile = z
  .array(
    z.object({
      id: tt,
      state: z.enum(['deck', 'watching', 'paused', 'finished', 'dropped']).optional(),
      runtimeMin: z.number().int().min(1).max(600).optional(),
      alignment: ShowAlignment.optional(),
    }),
  )
  .max(40);

type Args = ReturnType<typeof parseArgs>;
const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string) : undefined);
const need = (a: Args, k: string, usage: string) => {
  const v = str(a, k);
  if (!v) throw new Error(`Usage: ${usage}`);
  return v;
};

// Titles you asked for, and the next episode of each running show, that nothing can play yet.
export function wishlist() {
  const u = readUnwind();
  const lib = readLibrary();
  const playable = (list: { kind: string; fileId?: string }[] = []) =>
    list.some((x) => x.kind === 'youtube' || lib.files[x.fileId || '']?.status === 'ready');
  const out: { id: string; title: string; year?: string; kind: string; key: string; wanted: boolean }[] = [];
  for (const s of Object.values(u.shows)) {
    if (!['watching', 'deck', 'paused'].includes(s.state) && !u.wanted[s.id]) continue;
    const key = nextKey(s);
    if (!key || playable(s.sources[key])) continue;
    if (s.state === 'deck' && !u.wanted[s.id]) continue;
    out.push({ id: s.id, title: s.title, year: s.year, kind: s.kind, key, wanted: !!u.wanted[s.id] });
  }
  return out;
}

export async function unwindCommand(command: string, rest: string[]): Promise<unknown> {
  const a = parseArgs(rest);
  switch (command) {
    case 'unwind-digest':
      return tasteDigest();
    case 'unwind-view': {
      const v = unwindView();
      const brief = (c: { id: string; title: string; state: string; next?: { key: string; playable: boolean } }) => ({
        id: c.id,
        title: c.title,
        state: c.state,
        next: c.next?.key,
        playable: c.next?.playable,
      });
      return {
        counts: v.counts,
        tonight: Object.fromEntries(
          Object.entries(v.tonight).map(([b, p]) => [b, { kind: p.kind, title: p.show?.title, episodes: p.episodes?.map((e) => e.key), minutes: p.minutes }]),
        ),
        continuing: v.continuing.map(brief),
        deck: v.deck.map(brief),
        films: v.films.map(brief),
        finished: v.finished.map(brief),
      };
    }
    case 'unwind-add': {
      const file = need(a, 'file', 'unwind-add --file shows.json [--by openclaw]');
      const items = ShowFile.parse(JSON.parse(fs.readFileSync(file, 'utf8')));
      const shows: ShowIn[] = items.map((i) => ({
        id: i.id,
        state: i.state,
        runtimeMin: i.runtimeMin,
        alignment: i.alignment && {
          ...i.alignment,
          confidence: Math.round(((i.alignment.fun + i.alignment.fit) / 2) * 100) / 100,
        },
      }));
      return addShows(shows, str(a, 'by') || 'openclaw');
    }
    case 'unwind-state': {
      const id = tt.parse(need(a, 'id', 'unwind-state --id tt… --state deck|watching|paused|finished|dropped'));
      await setShowState(id, z.enum(SHOW_STATES as [string, ...string[]]).parse(str(a, 'state')) as never);
      return readUnwind().shows[id];
    }
    case 'unwind-watched': {
      const id = tt.parse(need(a, 'id', 'unwind-watched --id tt… --ep S1E3|film [--undo]'));
      await markEpisode(id, epKey.parse(str(a, 'ep') || FILM), a.undo !== true);
      return { watched: readUnwind().shows[id]?.watched };
    }
    case 'unwind-refresh':
      return refreshEpisodes(str(a, 'ids')?.split(',').map((s) => tt.parse(s.trim())));
    case 'unwind-sources': {
      const show = tt.parse(need(a, 'show', 'unwind-sources --show tt… [--find [--episodes N]] | --show tt… --ep S1E3 --video ID'));
      const video = str(a, 'video');
      if (video)
        return addYouTubeSource(show, epKey.parse(str(a, 'ep') || FILM), z.string().regex(/^[A-Za-z0-9_-]{11}$/).parse(video), str(a, 'by') || 'openclaw');
      if (a.find) return findSources(show, { episodes: Math.min(Number(str(a, 'episodes') || 3), 10), by: str(a, 'by') || 'openclaw' });
      return readUnwind().shows[show]?.sources;
    }
    case 'unwind-channel': {
      const approve = str(a, 'approve'),
        remove = str(a, 'remove');
      if (!approve && !remove) return Object.values(readUnwind().officialChannels);
      await approveChannel((approve || remove)!, !!approve);
      return Object.values(readUnwind().officialChannels);
    }
    case 'unwind-wishlist':
      return wishlist();
    case 'library-scan': {
      const scanned = await scan();
      return { scanned, matched: await matchFiles() };
    }
    case 'library-status': {
      const files = Object.values(readLibrary().files);
      const count = (s: string) => files.filter((f) => f.status === s).length;
      return {
        counts: { files: files.length, settling: count('settling'), waiting: count('new'), preparing: count('preparing'), ready: count('ready'), failed: count('failed') },
        unmatched: files.filter((f) => !f.match).map((f) => ({ id: f.id, rel: f.rel, guess: f.guess, status: f.status })),
        failed: files.filter((f) => f.status === 'failed').map((f) => ({ id: f.id, rel: f.rel, error: f.error })),
      };
    }
    case 'library-add': {
      const src = need(a, 'file', 'library-add --file /path/video.mkv [--show tt… --ep S1E3 | --film tt…] [--mode link|move|copy]');
      const rel = importFile(src, z.enum(['link', 'move', 'copy']).catch('link').parse(str(a, 'mode')));
      await scan();
      const film = str(a, 'film'),
        show = str(a, 'show');
      if (film || show) {
        const id = tt.parse(film || show);
        if (!readUnwind().shows[id]) {
          const r = await addShows([{ id }], 'library');
          if (r.unknown.length) throw new Error(r.unknown[0].reason);
        }
        await setMatch(fileIdOf(rel), { showId: id, key: film ? FILM : epKey.parse(str(a, 'ep')) }, 'cli');
      }
      return { rel, id: fileIdOf(rel), note: 'The library worker prepares it once the file has settled (about 2 minutes).' };
    }
    case 'library-match': {
      const id = need(a, 'id', 'library-match --id <fileId> --show tt… --ep S1E3|film');
      const show = tt.parse(need(a, 'show', 'library-match --id <fileId> --show tt… --ep S1E3|film'));
      if (!readUnwind().shows[show]) {
        const r = await addShows([{ id: show }], 'you');
        if (r.unknown.length) throw new Error(r.unknown[0].reason);
      }
      await setMatch(id, { showId: show, key: epKey.parse(str(a, 'ep') || FILM) }, 'cli');
      return matchFiles();
    }
    case 'library-retry':
      return retry(need(a, 'id', 'library-retry --id <fileId>'));
  }
  return undefined;
}
export const UNWIND_USAGE =
  'unwind-digest | unwind-view | unwind-add --file shows.json [--by openclaw] | unwind-state --id tt --state S | unwind-watched --id tt --ep S1E3|film [--undo] | unwind-refresh [--ids a,b] | unwind-sources --show tt [--find [--episodes N]] | unwind-sources --show tt --ep S1E3 --video ID | unwind-channel [--approve UC…|--remove UC…] | unwind-wishlist | library-scan | library-status | library-add --file PATH [--show tt --ep S1E3|--film tt] [--mode link|move|copy] | library-match --id FILEID --show tt --ep S1E3|film | library-retry --id FILEID';
