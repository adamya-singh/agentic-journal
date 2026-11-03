import type { StackConfig } from './stack-config.ts';

export interface ArrTitle {
  id: number;
  title: string;
  imdbId?: string;
  tmdbId?: number;
  tvdbId?: number;
  tags: number[];
  seasons?: { seasonNumber: number; monitored: boolean }[];
  movieFile?: { path: string };
  hasFile?: boolean;
  monitored: boolean;
  path: string;
}
export interface ArrQueue {
  movieId?: number;
  seriesId?: number;
  downloadId?: string;
  size: number;
  sizeleft: number;
  status: string;
  trackedDownloadState?: string;
  episode?: { seasonNumber: number };
  seasonNumber?: number;
  trackedDownloadStatus?: string;
}
export interface Torrent {
  hash: string;
  category: string;
  size: number;
  amount_left: number;
  state: string;
  progress: number;
  added_on: number;
  magnet_uri?: string;
  save_path?: string;
  total_size?: number;
}
export async function serviceFetch(url: string, init: RequestInit = {}) {
  try {
    return await fetch(url, {
      ...init,
      redirect: 'error',
      signal: init.signal || AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error('Media service is unreachable.');
  }
}
export class ArrClient {
  config: StackConfig['sonarr'];
  kind: 'film' | 'series';
  constructor(config: StackConfig['sonarr'], kind: 'film' | 'series') {
    this.config = config;
    this.kind = kind;
  }
  async call<T>(
    route: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
  ): Promise<T> {
    if (!this.config.apiKey) throw new Error('Configure the media manager API key.');
    const r = await serviceFetch(`${this.config.url}/api/v3/${route}`, {
      method,
      headers: { 'X-Api-Key': this.config.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Media manager request failed (${r.status}). Check its settings.`);
    return r.status === 204 ? (undefined as T) : r.json();
  }
  resource() {
    return this.kind === 'film' ? 'movie' : 'series';
  }
  list() {
    return this.call<ArrTitle[]>(this.resource());
  }
  queue() {
    return this.call<{ records: ArrQueue[] }>(
      'queue?pageSize=1000&includeUnknownSeriesItems=false&includeUnknownMovieItems=false',
    );
  }
  async tag() {
    const tags = await this.call<{ id: number; label: string }[]>('tag');
    return (
      tags.find((x) => x.label === 'journal')?.id ||
      (await this.call<{ id: number }>('tag', { label: 'journal' })).id
    );
  }
  async lookup(id: string) {
    const hits = await this.call<ArrTitle[]>(
      `${this.resource()}/lookup?term=${encodeURIComponent(`imdb:${id}`)}`,
    );
    const exact = hits.filter((t) => t.imdbId === id);
    if (exact.length !== 1)
      throw new Error('The manager could not uniquely match this IMDb title. Check its catalog.');
    return exact[0];
  }
}
export class QbitClient {
  private cookie = '';
  private config: StackConfig['qbittorrent'];
  constructor(config: StackConfig['qbittorrent']) {
    this.config = config;
  }
  async call<T>(route: string, data?: Record<string, string>, retried = false): Promise<T> {
    const r = await serviceFetch(`${this.config.url}/api/v2/${route}`, {
      method: data ? 'POST' : 'GET',
      headers: {
        Cookie: this.cookie,
        Referer: `${this.config.url}/`,
        ...(data ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      body: data ? new URLSearchParams(data).toString() : undefined,
    });
    if ([401, 403].includes(r.status) && !retried) {
      const login = await serviceFetch(`${this.config.url}/api/v2/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: `${this.config.url}/`,
        },
        body: new URLSearchParams({
          username: this.config.username,
          password: this.config.password,
        }).toString(),
      });
      const message = (await login.text()).trim();
      if (!login.ok || !['', 'Ok.'].includes(message))
        throw new Error('Configure the qBittorrent login.');
      this.cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
      return this.call(route, data, true);
    }
    if (!r.ok) throw new Error(`Download client request failed (${r.status}).`);
    const text = await r.text();
    try {
      return JSON.parse(text);
    } catch {
      return text as T;
    }
  }
  torrents() {
    return this.call<Torrent[]>('torrents/info');
  }
  stop(hashes: string[]) {
    return hashes.length
      ? this.call('torrents/stop', { hashes: hashes.join('|') })
      : Promise.resolve();
  }
  start(hashes: string[]) {
    return hashes.length
      ? this.call('torrents/start', { hashes: hashes.join('|') })
      : Promise.resolve();
  }
}
export interface JellyItem {
  Id: string;
  Type: string;
  Path?: string;
  ProviderIds?: Record<string, string>;
  SeriesId?: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
  IndexNumberEnd?: number;
}
export async function jellyCall<T>(
  c: StackConfig,
  route: string,
  body?: unknown,
  method = body === undefined ? 'GET' : 'POST',
  admin = false,
): Promise<T> {
  const token = admin ? c.jellyfin.adminKey : c.jellyfin.apiKey;
  if (!token) throw new Error('Configure Jellyfin playback.');
  const r = await serviceFetch(`${c.jellyfin.url}/${route}`, {
    method,
    headers: {
      Authorization: `MediaBrowser Client="Agentic Journal", Device="Journal", DeviceId="journal", Version="1", Token="${token}"`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Jellyfin request failed (${r.status}).`);
  return r.status === 204 ? (undefined as T) : r.json();
}
