import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { addJob, mediaRoot, readState, withLock, writeState } from './store.ts';
import { defaultFetchers, imdbSuggest, sizedPoster, type CatalogFetchers, type Suggestion } from './catalog.ts';
import type { MediaState, MediaTitle } from './types.ts';

// Quick add: you type whatever you remember ("finally finished severance, loved
// it", "that anime with the chainsaw guy, want to watch"), OpenClaw works out
// which titles you mean and what you said about them, and each one waits here
// until you confirm the match and its settings. Every candidate is checked
// against IMDb before you see it, so a made-up title never reaches your library.
// Its own file and lock: OpenClaw's turn can take a minute and must not hold the
// media store.

export type AddStatus = 'finished' | 'watching' | 'want' | 'none';
export const ADD_STATUSES: AddStatus[] = ['finished', 'watching', 'want', 'none'];
export interface Settings {
  status: AddStatus;
  favorite: boolean;
  download: boolean;
}
export interface Candidate {
  id: string; // tt…
  title: string;
  year?: string;
  type: string; // IMDb's label: 'Movie', 'TVSeries', 'TVMiniSeries'
  label: string; // 'TV series', 'Feature'
  poster?: string;
  cast?: string;
}
export interface Addition {
  id: string;
  phrase: string; // the part of what you typed this is about
  note?: string; // what OpenClaw understood, in a line
  candidates: Candidate[];
  settings: Settings; // what OpenClaw read from your words
  state: 'pending' | 'added' | 'dismissed';
  pick?: string;
  doneAt?: string;
}
export interface Entry {
  id: string;
  text: string;
  createdAt: string;
  status: 'queued' | 'reading' | 'ready' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  // OpenClaw could not be reached, so the candidates are IMDb's matches for your words.
  fallback?: boolean;
  additions: Addition[];
}
export interface Inbox {
  version: 1;
  entries: Entry[];
}
export const RUNNING_TIMEOUT_MS = 15 * 60_000;
const KEEP_DONE = 60;

const file = () => path.join(mediaRoot(), 'inbox.json');
export function readInbox(): Inbox {
  try {
    return JSON.parse(fs.readFileSync(file(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, entries: [] };
    throw new Error('Quick add storage could not be read. Restore it before continuing.');
  }
}
function writeInbox(inbox: Inbox) {
  fs.mkdirSync(mediaRoot(), { recursive: true, mode: 0o700 });
  const tmp = `${file()}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(inbox, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file());
}
export const withInbox = <T>(fn: (inbox: Inbox) => T) =>
  withLock(() => {
    const inbox = readInbox();
    const out = fn(inbox);
    writeInbox(inbox);
    return out;
  }, 'inbox');

// ───────────── IMDb ─────────────

export type Fetch = CatalogFetchers['json'];
const fetchers = (f?: Fetch): CatalogFetchers => (f ? { json: f } : defaultFetchers);
// What a quick add can be: films, shows and their specials, never episodes, people or games.
const TYPES: Record<string, string> = {
  movie: 'Movie',
  tvMovie: 'Movie',
  video: 'Movie',
  short: 'Movie',
  tvSpecial: 'Movie',
  tvSeries: 'TVSeries',
  tvMiniSeries: 'TVMiniSeries',
};
// Series come with their run ('2019-2023', or '2022-2022' for one season); films with a year.
const yearOf = (yr?: string, y?: number) => {
  const [a, b] = (yr || '').split('-');
  return a ? (b && b !== a ? `${a}–${b}` : b === '' ? `${a}–` : a) : y ? String(y) : undefined;
};
const candidatesOf = (hits: Suggestion[]): Candidate[] =>
  hits
    .filter((d) => d.id?.startsWith('tt') && d.l && d.qid && TYPES[d.qid])
    .map((d) => ({
      id: d.id,
      title: d.l,
      year: yearOf(d.yr, d.y),
      type: TYPES[d.qid!],
      label: d.q || d.qid!,
      poster: sizedPoster(d.i?.imageUrl),
      cast: d.s,
    }));
export async function lookupId(id: string, f?: Fetch) {
  if (!/^tt\d{5,10}$/.test(id)) return undefined;
  return candidatesOf(await imdbSuggest(id, fetchers(f))).find((c) => c.id === id);
}
export const searchImdb = async (q: string, f?: Fetch) => candidatesOf(await imdbSuggest(q, fetchers(f)));

// ───────────── OpenClaw ─────────────

export function readPrompt(text: string, library: string[]) {
  return `Adamya typed this into the quick-add box on his Agentic Journal Media page, to add to his media library (movies, TV, anime, documentaries):

"""
${text.slice(0, 2000)}
"""

Work out every title he means and what he said about each. He types from memory, so expect misspellings, half-remembered plots ("the one where the office workers have their memories split"), nicknames, and several titles in one line. Use web search when you are not sure which title he means. Do not open a browser and do not change anything anywhere; just answer.

For each title:
- phrase: the words in his text it comes from.
- candidates: 1 to 4 IMDb titles it could be, most likely first. Give more than one only when it is genuinely unclear (remakes, same name, a show vs its film). Each has imdbId (the real tt id when you know it, otherwise null), title and year. The Journal checks every one against IMDb.
- status: "finished" if he says he watched or finished it, "watching" if he is partway, "want" if he wants to watch it, otherwise "none".
- favorite: true only if he says he loved it, it is a favorite, or similar.
- download: true only if he says he wants it downloaded, saved offline, or kept on disk.
- note: one short line on what you understood, e.g. "Finished it, loved it" or "Guessing the 2022 anime, not the 2025 film".

If something is not a film or show (a book, a game, a song), still list it with candidates [] and a note saying so.
${library.length ? `\nFor context, recent titles already in his library: ${library.slice(0, 40).join('; ')}\n` : ''}
Reply with only this JSON, no prose:
{"additions":[{"phrase":"...","candidates":[{"imdbId":"tt0000000","title":"...","year":"2020"}],"status":"none","favorite":false,"download":false,"note":"..."}]}`;
}
const Reply = z.object({
  additions: z
    .array(
      z.object({
        phrase: z.string().trim().min(1).max(300),
        candidates: z
          .array(
            z.object({
              imdbId: z.string().nullish(),
              title: z.string().trim().min(1).max(200),
              year: z.union([z.string(), z.number()]).nullish(),
            }),
          )
          .max(6)
          .catch([]),
        status: z.enum(['finished', 'watching', 'want', 'none']).catch('none'),
        favorite: z.boolean().catch(false),
        download: z.boolean().catch(false),
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .max(20),
});
export type Reading = z.infer<typeof Reply>['additions'];
export function parseReply(raw: unknown): Reading | undefined {
  const r = Reply.safeParse(raw);
  return r.success ? r.data.additions : undefined;
}

// Turns OpenClaw's guesses into IMDb titles: ids are looked up, titles without
// one are searched (year breaks ties), and IMDb's other hits for the best guess
// fill the options up to four, so a wrong guess still leaves the right one a tap away.
export async function verify(reading: Reading, f?: Fetch): Promise<Addition[]> {
  const out: Addition[] = [];
  for (const r of reading) {
    const found: Candidate[] = [];
    const add = (c?: Candidate) => c && !found.some((x) => x.id === c.id) && found.push(c);
    for (const c of r.candidates.slice(0, 4)) {
      const byId = c.imdbId ? await lookupId(c.imdbId, f).catch(() => undefined) : undefined;
      // A real id for a different title is a wrong id; trust the title instead.
      if (byId && same(byId.title, c.title)) {
        add(byId);
        continue;
      }
      const hits = await searchImdb(c.title, f).catch(() => []);
      const year = c.year ? String(c.year).slice(0, 4) : undefined;
      add(hits.find((h) => same(h.title, c.title) && (!year || h.year?.startsWith(year))) || hits.find((h) => same(h.title, c.title)) || hits[0]);
    }
    // Only same-named titles (a remake, the film of the show), and at most three options in all.
    const best = r.candidates[0]?.title;
    if (best)
      for (const h of await searchImdb(best, f).catch(() => []))
        if (found.length < 3 && same(h.title, best)) add(h);
    out.push({
      id: randomUUID(),
      phrase: r.phrase,
      note: r.note || undefined,
      candidates: found.slice(0, 4),
      settings: { status: r.status, favorite: r.favorite, download: r.download },
      state: 'pending',
    });
  }
  return out;
}
const words = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
const same = (a: string, b: string) => {
  const x = words(a),
    y = words(b);
  return x === y || x.startsWith(y) || y.startsWith(x);
};
// When OpenClaw can't be reached: IMDb's own matches for what you typed.
export async function fallback(text: string, f?: Fetch): Promise<Addition[]> {
  const hits = await searchImdb(text, f).catch(() => []);
  if (!hits.length) return [];
  return [
    {
      id: randomUUID(),
      phrase: text,
      candidates: hits.slice(0, 3),
      settings: { status: 'none', favorite: false, download: false },
      state: 'pending',
    },
  ];
}

// ───────────── what you do ─────────────

export async function addText(text: string) {
  const t = text.trim();
  if (!t) throw new Error('Type something to add.');
  return withInbox((inbox) => {
    if (inbox.entries.filter((e) => e.status === 'queued' || e.status === 'reading').length >= 20)
      throw new Error('OpenClaw already has 20 to read. Wait for those first.');
    const entry: Entry = {
      id: randomUUID(),
      text: t.slice(0, 2000),
      createdAt: new Date().toISOString(),
      status: 'queued',
      additions: [],
    };
    inbox.entries.push(entry);
    return entry.id;
  });
}
const findAddition = (inbox: Inbox, id: string) => {
  for (const entry of inbox.entries) {
    const a = entry.additions.find((x) => x.id === id);
    if (a) return { entry, a };
  }
  throw new Error('That addition is gone. Refresh the page.');
};
// Done entries stay a while so "Recently added" can show them, then go.
function prune(inbox: Inbox) {
  const done = (e: Entry) => e.status === 'ready' && e.additions.every((a) => a.state !== 'pending');
  const old = inbox.entries.filter(done);
  if (old.length > KEEP_DONE) {
    const drop = new Set(old.slice(0, old.length - KEEP_DONE).map((e) => e.id));
    inbox.entries = inbox.entries.filter((e) => !drop.has(e.id));
  }
}
export async function dismissEntry(id: string) {
  return withInbox((inbox) => {
    const e = inbox.entries.find((x) => x.id === id);
    if (!e) throw new Error('That entry is gone. Refresh the page.');
    if (e.status === 'reading') throw new Error('OpenClaw is reading this now. Try again in a moment.');
    inbox.entries = inbox.entries.filter((x) => x.id !== id);
  });
}
export async function retryEntry(id: string) {
  return withInbox((inbox) => {
    const e = inbox.entries.find((x) => x.id === id);
    if (!e) throw new Error('That entry is gone. Refresh the page.');
    if (e.status !== 'failed' && !e.fallback) throw new Error('This one does not need a retry.');
    Object.assign(e, { status: 'queued', error: undefined, fallback: undefined, additions: e.additions.filter((a) => a.state !== 'pending') });
  });
}
export async function dismissAddition(id: string) {
  return withInbox((inbox) => {
    const { a } = findAddition(inbox, id);
    if (a.state !== 'pending') throw new Error('This one is already done.');
    Object.assign(a, { state: 'dismissed', doneAt: new Date().toISOString() });
    prune(inbox);
  });
}
// None of the options fit: drop it and let OpenClaw read it again with your hint.
export async function clarify(id: string, hint: string) {
  const h = hint.trim();
  if (!h) throw new Error('Say a little more about which one you mean.');
  return withInbox((inbox) => {
    const { a } = findAddition(inbox, id);
    if (a.state !== 'pending') throw new Error('This one is already done.');
    Object.assign(a, { state: 'dismissed', doneAt: new Date().toISOString() });
    const passed = a.candidates.map((c) => `${c.title}${c.year ? ` (${c.year})` : ''}`).join(', ');
    const entry: Entry = {
      id: randomUUID(),
      text: `${a.phrase} — ${h.slice(0, 500)}${passed ? ` (not ${passed})` : ''}`,
      createdAt: new Date().toISOString(),
      status: 'queued',
      additions: [],
    };
    inbox.entries.push(entry);
    return entry.id;
  });
}

// Puts the title in your library with your settings. Finished and Want to watch
// are also saved to IMDb (as a watch and a Watchlist add) through the usual queue;
// favorite, keep on disk and watching are Journal-only.
export function applyAddition(s: MediaState, c: Candidate, settings: Settings, now = new Date().toISOString()) {
  const old = s.titles[c.id];
  const t: MediaTitle = old || {
    id: c.id,
    title: c.title,
    url: `https://www.imdb.com/title/${c.id}/`,
    year: c.year,
    type: c.type,
    poster: c.poster,
    collections: [],
    source: 'imdb',
  };
  t.addedAt ||= now;
  t.favorite = settings.favorite || undefined;
  t.download = settings.download || undefined;
  t.watching = (settings.status === 'watching' && !t.watched) || undefined;
  s.titles[c.id] = t;
  const queued = (action: 'seen' | 'watchlist') =>
    s.jobs.some((j) => j.titleId === c.id && j.action === action && ['queued', 'running'].includes(j.status));
  if (settings.status === 'finished' && !t.watched && !queued('seen')) addJob(s, 'seen', c.id);
  if (settings.status === 'want' && !t.watched && !t.watchlist && !queued('watchlist')) addJob(s, 'watchlist', c.id);
  return t;
}
export async function confirm(id: string, pick: string, settings: Settings) {
  const { a } = findAddition(readInbox(), id);
  if (a.state !== 'pending') throw new Error('This one is already done.');
  const c = a.candidates.find((x) => x.id === pick);
  if (!c) throw new Error('Pick one of the matches shown.');
  const title = await withLock(() => {
    const s = readState();
    const t = applyAddition(s, c, settings);
    writeState(s);
    return t;
  });
  await withInbox((inbox) => {
    const found = findAddition(inbox, id).a;
    Object.assign(found, { state: 'added', pick, settings, doneAt: new Date().toISOString() });
    prune(inbox);
  });
  return title;
}

export interface InboxView {
  reading: { id: string; text: string; status: 'queued' | 'reading'; createdAt: string; startedAt?: string }[];
  failed: { id: string; text: string; error?: string }[];
  pending: (Addition & { entryId: string; text: string; fallback?: boolean; known: Record<string, Partial<Settings>> })[];
  // Read but nothing matched on IMDb.
  unmatched: { id: string; entryId: string; phrase: string; note?: string }[];
  recent: { id: string; title: string; poster?: string; state: 'added' | 'dismissed'; doneAt?: string }[];
}
// `known` says how a candidate already sits in your library, so its settings start from there.
export function inboxView(inbox = readInbox(), s: MediaState = readState()): InboxView {
  const settingsOf = (t: MediaTitle): Partial<Settings> => ({
    status: t.watched ? 'finished' : t.watching ? 'watching' : t.watchlist ? 'want' : undefined,
    favorite: !!t.favorite,
    download: !!t.download,
  });
  // Recommendations are titles too, but not yours until they are in the library.
  const inLibrary = (t?: MediaTitle) => !!t && (t.collections.length > 0 || !!t.addedAt);
  const live = inbox.entries.filter((e) => e.status === 'queued' || e.status === 'reading');
  const all = inbox.entries.flatMap((e) => e.additions.map((a) => ({ e, a })));
  return {
    reading: live.map(({ id, text, status, createdAt, startedAt }) => ({
      id,
      text,
      status: status as 'queued' | 'reading',
      createdAt,
      startedAt,
    })),
    failed: inbox.entries.filter((e) => e.status === 'failed').map(({ id, text, error }) => ({ id, text, error })),
    pending: all
      .filter(({ a }) => a.state === 'pending' && a.candidates.length)
      .map(({ e, a }) => ({
        ...a,
        entryId: e.id,
        text: e.text,
        fallback: e.fallback,
        known: Object.fromEntries(
          a.candidates.filter((c) => inLibrary(s.titles[c.id])).map((c) => [c.id, settingsOf(s.titles[c.id])]),
        ),
      })),
    unmatched: all
      .filter(({ a }) => a.state === 'pending' && !a.candidates.length)
      .map(({ e, a }) => ({ id: a.id, entryId: e.id, phrase: a.phrase, note: a.note })),
    recent: all
      .filter(({ a }) => a.state !== 'pending' && a.doneAt)
      .sort((x, y) => (y.a.doneAt || '').localeCompare(x.a.doneAt || ''))
      .slice(0, 8)
      .map(({ a }) => {
        const c = a.candidates.find((x) => x.id === a.pick) || a.candidates[0];
        return { id: a.id, title: c?.title || a.phrase, poster: c?.poster, state: a.state as 'added' | 'dismissed', doneAt: a.doneAt };
      }),
  };
}
