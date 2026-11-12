// What a show or film is, from public catalogs that need no key: IMDb's
// suggestion endpoint (title, year, kind, poster) and TVmaze (episodes,
// runtimes, network). Every title Unwind holds is checked here first, so a
// made-up or misspelled title never gets in. Fetchers are injectable for tests.

import net from 'node:net';

// TVmaze sits in Germany and takes about a second to connect from here; Node's
// default of 250 ms per address family makes fetch give up with ETIMEDOUT.
if (net.getDefaultAutoSelectFamilyAttemptTimeout() < 2500) net.setDefaultAutoSelectFamilyAttemptTimeout(2500);

export interface CatalogTitle {
  id: string; // tt…
  kind: 'series' | 'film';
  title: string;
  year?: string;
  poster?: string;
  cast?: string;
}
export interface CatalogEpisode {
  key: string; // 'S1E3'
  season: number;
  number: number;
  name: string;
  runtime?: number; // minutes
  airdate?: string;
  summary?: string;
  image?: string;
}
export interface CatalogShow {
  tvmazeId: number;
  name: string;
  network?: string;
  runtime?: number;
  genres: string[];
  summary?: string;
  poster?: string;
  imdb?: string;
  episodes: CatalogEpisode[];
}
export interface CatalogFetchers {
  json: (url: string) => Promise<unknown>;
}
const UA = { 'User-Agent': 'agentic-journal/1.0 (personal media page)' };
export const defaultFetchers: CatalogFetchers = {
  json: async (url) => {
    // One retry: a slow connect or a rate-limit blip shouldn't refuse a real title.
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15_000) });
        if (r.status === 404) return null;
        if (r.status === 429 && attempt < 3) throw new Error('Rate limited.');
        if (!r.ok) throw new Error(`Catalog request failed (${r.status}).`);
        return r.json();
      } catch (e) {
        if (attempt >= 3) throw new Error(`The show catalog could not be reached: ${(e as Error).message}`);
        await new Promise((res) => setTimeout(res, 1500 * attempt));
      }
    }
  },
};

export const episodeKey = (season: number, number: number) => `S${season}E${number}`;
export const parseEpisodeKey = (key: string) => {
  const m = key.match(/^S(\d{1,3})E(\d{1,4})$/);
  return m ? { season: Number(m[1]), number: Number(m[2]) } : undefined;
};
const plain = (html?: string | null) =>
  html ? html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim() : undefined;
// IMDb poster URLs carry their size in the name; ask for something card-sized.
export const sizedPoster = (url?: string, width = 400) =>
  url ? url.replace(/\._V1_.*\.(jpg|png)$/, `._V1_UX${width}.$1`) : undefined;

export interface Suggestion {
  id: string;
  l: string; // title
  q?: string; // label: 'TV series', 'feature'
  qid?: string; // kind: 'tvSeries', 'movie'
  y?: number;
  yr?: string; // a series' run: '2019-2023'
  s?: string; // top cast
  i?: { imageUrl?: string };
}
// IMDb's suggestion endpoint: a tt id finds that title, any other text searches.
export async function imdbSuggest(q: string, f: CatalogFetchers = defaultFetchers): Promise<Suggestion[]> {
  const key = /^tt\d{5,10}$/.test(q)
    ? q
    : q.normalize('NFKD').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
  if (!key) return [];
  const s = (await f.json(`https://v3.sg.media-imdb.com/suggestion/${key.startsWith('tt') ? 'x' : key[0]}/${encodeURIComponent(key)}.json`)) as {
    d?: Suggestion[];
  } | null;
  return s?.d || [];
}
const SERIES = new Set(['tvSeries', 'tvMiniSeries']);
const FILMS = new Set(['movie', 'tvMovie', 'video']);
export async function lookupTitle(id: string, f: CatalogFetchers = defaultFetchers): Promise<CatalogTitle | undefined> {
  if (!/^tt\d{5,10}$/.test(id)) return undefined;
  const hit = (await imdbSuggest(id, f)).find((d) => d.id === id);
  if (!hit || !hit.qid || !(SERIES.has(hit.qid) || FILMS.has(hit.qid))) return undefined;
  return {
    id,
    kind: SERIES.has(hit.qid) ? 'series' : 'film',
    title: hit.l,
    year: hit.yr || (hit.y ? String(hit.y) : undefined),
    poster: sizedPoster(hit.i?.imageUrl),
    cast: hit.s,
  };
}

interface MazeShow {
  id: number;
  name: string;
  runtime?: number | null;
  averageRuntime?: number | null;
  genres?: string[];
  summary?: string | null;
  image?: { medium?: string; original?: string } | null;
  network?: { name: string } | null;
  webChannel?: { name: string } | null;
  externals?: { imdb?: string | null };
  _embedded?: { episodes?: MazeEpisode[] };
}
interface MazeEpisode {
  season: number;
  number: number | null;
  name: string;
  type?: string;
  runtime?: number | null;
  airdate?: string;
  summary?: string | null;
  image?: { medium?: string } | null;
}
function toShow(m: MazeShow): CatalogShow {
  return {
    tvmazeId: m.id,
    name: m.name,
    network: m.network?.name || m.webChannel?.name,
    runtime: m.averageRuntime || m.runtime || undefined,
    genres: m.genres || [],
    summary: plain(m.summary),
    poster: m.image?.medium,
    imdb: m.externals?.imdb || undefined,
    episodes: (m._embedded?.episodes || [])
      // Specials have no number; they never block "next episode".
      .filter((e) => e.number != null && e.type !== 'significant_special')
      .map((e) => ({
        key: episodeKey(e.season, e.number!),
        season: e.season,
        number: e.number!,
        name: e.name,
        runtime: e.runtime || undefined,
        airdate: e.airdate || undefined,
        summary: plain(e.summary)?.slice(0, 400),
        image: e.image?.medium,
      })),
  };
}
// TVmaze answers an IMDb lookup with a redirect to the show; fetch follows it.
export async function showByImdb(id: string, f: CatalogFetchers = defaultFetchers): Promise<CatalogShow | undefined> {
  const show = (await f.json(`https://api.tvmaze.com/lookup/shows?imdb=${id}`)) as MazeShow | null;
  if (!show?.id) return undefined;
  const full = (await f.json(`https://api.tvmaze.com/shows/${show.id}?embed=episodes`)) as MazeShow | null;
  return full ? toShow(full) : undefined;
}
export async function searchShows(q: string, f: CatalogFetchers = defaultFetchers) {
  const hits = ((await f.json(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(q)}`)) || []) as {
    score: number;
    show: MazeShow;
  }[];
  return hits.slice(0, 8).map((h) => ({
    tvmazeId: h.show.id,
    name: h.show.name,
    imdb: h.show.externals?.imdb || undefined,
    network: h.show.network?.name || h.show.webChannel?.name,
    poster: h.show.image?.medium,
    score: h.score,
  }));
}
// IMDb's suggestion search, for films (TVmaze only knows TV).
export async function searchTitles(q: string, f: CatalogFetchers = defaultFetchers) {
  return (await imdbSuggest(q, f))
    .filter((d) => d.id?.startsWith('tt') && d.qid && (SERIES.has(d.qid) || FILMS.has(d.qid)))
    .slice(0, 8)
    .map((d) => ({
      id: d.id,
      kind: SERIES.has(d.qid!) ? ('series' as const) : ('film' as const),
      title: d.l,
      year: d.yr || (d.y ? String(d.y) : undefined),
      poster: sizedPoster(d.i?.imageUrl, 200),
    }));
}
