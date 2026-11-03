import path from 'node:path';
import {
  readAcquisitions,
  withAcquisitions,
  migrateAcquisitions,
  projectFlags,
} from './acquisition-store.ts';
import { stackConfig, vpnReady, type StackConfig } from './stack-config.ts';
import { admission, managedTorrent, stoppedTorrent, storageStatus } from './acquisition-storage.ts';
import {
  ArrClient,
  QbitClient,
  jellyCall,
  serviceFetch,
  type ArrTitle,
  type JellyItem,
} from './stack-clients.ts';
import { withUnwind } from './unwind-store.ts';
import type { Acquisition } from './acquisition-types.ts';
import { fetchMetadata, needsMetadata } from './acquisition-metadata.ts';

export async function stackHealth(c = stackConfig()) {
  const services: Record<string, { ok: boolean; note?: string }> = {};
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      services[name] = { ok: true };
    } catch (e) {
      services[name] = { ok: false, note: (e as Error).message };
    }
  };
  await Promise.all([
    check('network', async () => {
      if (c.networkMode === 'vpn' && !vpnReady(c))
        throw new Error('Connect Proton VPN Plus with NAT-PMP enabled.');
      const prefs = await new QbitClient(c.qbittorrent).call<{
        current_network_interface: string;
        upnp: boolean;
      }>('app/preferences');
      if (prefs.current_network_interface !== (c.networkMode === 'vpn' ? 'tun0' : '') || prefs.upnp)
        throw new Error(
          'Downloader routing does not match the selected network mode. Run media:stack up.',
        );
    }),
    check('sonarr', () => managerHealth(new ArrClient(c.sonarr, 'series'), 'journal-sonarr')),
    check('radarr', () => managerHealth(new ArrClient(c.radarr, 'film'), 'journal-radarr')),
    check('sources', async () => {
      if (!c.prowlarr.apiKey) throw new Error('Configure and test download sources in Prowlarr.');
      const r = await serviceFetch(`${c.prowlarr.url}/api/v1/indexer`, {
        headers: { 'X-Api-Key': c.prowlarr.apiKey },
      });
      if (!r.ok) throw new Error('Prowlarr is unavailable.');
      const sources = (await r.json()) as { enable: boolean; protocol: string; tags?: number[] }[];
      if (!sources.some((s) => s.enable && s.protocol === 'torrent'))
        throw new Error('Add and test a torrent source in Prowlarr.');
      if (c.networkMode === 'direct') return;
      const get = async <T>(route: string): Promise<T> => {
        const result = await serviceFetch(`${c.prowlarr.url}/api/v1/${route}`, {
          headers: { 'X-Api-Key': c.prowlarr.apiKey },
        });
        if (!result.ok) throw new Error('Prowlarr proxy settings are unavailable.');
        return result.json();
      };
      const proxies =
        await get<{ name: string; implementation: string; tags: number[] }[]>('indexerproxy');
      const proxy = proxies.find(
        (p) => p.name === 'Journal Gluetun' && p.implementation === 'Http',
      );
      if (
        !proxy ||
        sources.some(
          (s) =>
            s.enable &&
            s.protocol === 'torrent' &&
            !proxy.tags.some((tag) => s.tags?.includes(tag)),
        )
      )
        throw new Error(
          'Tag each source journal-vpn and connect the Gluetun proxy; run media:stack provision.',
        );
    }),
    check('jellyfin', async () => {
      if (!c.jellyfin.userId) throw new Error('Configure the dedicated Jellyfin playback user.');
      const user = await jellyCall<{
        Policy?: { IsAdministrator?: boolean; EnableMediaPlayback?: boolean };
      }>(c, `Users/${c.jellyfin.userId}`);
      if (user.Policy?.IsAdministrator || user.Policy?.EnableMediaPlayback === false)
        throw new Error('Jellyfin playback requires a non-admin user with media access.');
    }),
  ]);
  if (!c.enabled)
    services.setup = { ok: false, note: 'Finish local media setup to enable downloads.' };
  return services;
}
async function managerHealth(client: ArrClient, category: string) {
  if (!client.config.profileId) throw new Error('Choose the Journal 1080p quality profile.');
  const clients =
    await client.call<
      { enable: boolean; implementation: string; fields: { name: string; value: unknown }[] }[]
    >('downloadclient');
  const qbit = clients.find(
    (x) =>
      x.enable &&
      x.implementation === 'QBittorrent' &&
      x.fields.some(
        (f) =>
          ['category', client.kind === 'film' ? 'movieCategory' : 'tvCategory'].includes(f.name) &&
          f.value === category,
      ),
  );
  if (!qbit?.fields.some((f) => f.name === 'initialState' && Number(f.value) === 2))
    throw new Error('Configure the Journal qBittorrent client to add downloads paused.');
  const indexers = await client.call<{ enableAutomaticSearch: boolean }[]>('indexer');
  if (!indexers.some((x) => x.enableAutomaticSearch))
    throw new Error('Sync tested sources from Prowlarr to this manager.');
}
async function remoteFor(client: ArrClient, r: Acquisition, allowCreate: boolean) {
  const all = await client.list();
  const matches = all.filter((x) => x.imdbId === r.id);
  if (matches.length > 1)
    throw new Error('Multiple manager titles match this IMDb ID. Resolve them in the manager.');
  const tag = await client.tag();
  let remote = matches[0];
  if (remote && !remote.tags.includes(tag))
    throw new Error(
      'This title already exists outside Journal. Add its journal tag in the manager to adopt it.',
    );
  if (!remote && r.wanted && allowCreate) {
    const hit = await client.lookup(r.id);
    if (!client.config.profileId) throw new Error('Choose the Journal quality profile.');
    remote = await client.call<ArrTitle>(client.resource(), {
      ...hit,
      id: undefined,
      monitored: r.kind === 'film',
      tags: [tag],
      qualityProfileId: client.config.profileId,
      rootFolderPath: `/data/library/${r.kind === 'film' ? 'movies' : 'shows'}`,
      ...(r.kind === 'film'
        ? { minimumAvailability: 'released' }
        : {
            seasonFolder: true,
            seriesType: 'standard',
            languageProfileId: 1,
            seasons: (hit.seasons || []).map((s) => ({
              ...s,
              monitored: r.seasons.includes(s.seasonNumber),
            })),
          }),
      addOptions: { searchForMovie: false, searchForMissingEpisodes: false, monitor: 'none' },
    });
  }
  return remote;
}
export async function matchJellyItems(
  c: StackConfig,
  r: Acquisition,
  remote: ArrTitle,
  jelly: JellyItem[],
) {
  let files: { key: string; path: string }[] = [];
  if (r.kind === 'film') {
    const file = remote.movieFile;
    if (file?.path) files = [{ key: 'film', path: file.path }];
  } else {
    const client = new ArrClient(c.sonarr, 'series');
    const eps = await client.call<
      { seasonNumber: number; episodeNumber: number; hasFile: boolean; episodeFileId: number }[]
    >(`episode?seriesId=${remote.id}`);
    const ef = await client.call<{ id: number; path: string }[]>(
      `episodefile?seriesId=${remote.id}`,
    );
    const occurrences = new Map<number, number>();
    for (const ep of eps.filter((x) => x.hasFile))
      occurrences.set(ep.episodeFileId, (occurrences.get(ep.episodeFileId) || 0) + 1);
    files = eps
      .filter((x) => x.hasFile && occurrences.get(x.episodeFileId) === 1)
      .flatMap((ep) => {
        const f = ef.find((x) => x.id === ep.episodeFileId);
        return f ? [{ key: `S${ep.seasonNumber}E${ep.episodeNumber}`, path: f.path }] : [];
      });
  }
  return files.flatMap((f) => {
    const canonical = path.posix.normalize(f.path);
    if (!canonical.startsWith(`/data/library/${r.kind === 'film' ? 'movies' : 'shows'}/`))
      return [];
    const hits = jelly.filter(
      (j) =>
        j.Path === canonical &&
        !j.IndexNumberEnd &&
        (r.kind === 'film'
          ? j.Type === 'Movie' && j.ProviderIds?.Imdb === r.id
          : j.Type === 'Episode' &&
            f.key === `S${j.ParentIndexNumber}E${j.IndexNumber}` &&
            jelly.some((series) => series.Id === j.SeriesId && series.ProviderIds?.Imdb === r.id)),
    );
    return hits.length === 1 ? [{ ...f, itemId: hits[0].Id }] : [];
  });
}
async function syncUnwind(client: ArrClient, r: Acquisition, remote: ArrTitle) {
  const episodes =
    r.kind === 'series'
      ? await client.call<
          {
            seasonNumber: number;
            episodeNumber: number;
            title: string;
            airDate?: string;
            runtime?: number;
          }[]
        >(`episode?seriesId=${remote.id}`)
      : [];
  await withUnwind((u) => {
    const old = u.shows[r.id];
    u.shows[r.id] = {
      ...(old || {
        id: r.id,
        title: r.title,
        kind: r.kind,
        state: 'deck',
        watched: [],
        positions: {},
        sources: {},
        addedBy: 'library',
        addedAt: new Date().toISOString(),
      }),
      ...(r.kind === 'series'
        ? {
            episodes: episodes.map((ep) => ({
              key: `S${ep.seasonNumber}E${ep.episodeNumber}`,
              season: ep.seasonNumber,
              number: ep.episodeNumber,
              name: ep.title,
              airdate: ep.airDate,
              runtime: ep.runtime,
            })),
            episodesAt: new Date().toISOString(),
          }
        : {}),
    };
  });
}
const RESEARCH_MS = 6 * 60 * 60_000;
export async function reconcileAcquisitions(c = stackConfig()) {
  await migrateAcquisitions();
  const services = await stackHealth(c);
  await withAcquisitions((s) => {
    s.services = services;
    s.workerAt = new Date().toISOString();
  });
  const ready = Object.values(services).every((s) => s.ok);
  const requests = Object.values(readAcquisitions().requests);
  for (const r of requests) await projectFlags(r.id, r.wanted);
  let jelly: JellyItem[] | undefined;
  if (services.jellyfin.ok) {
    jelly = (
      await jellyCall<{ Items: JellyItem[] }>(
        c,
        `Users/${c.jellyfin.userId}/Items?Recursive=true&IncludeItemTypes=Movie,Series,Episode&Fields=Path,ProviderIds&Limit=100000`,
      )
    ).Items;
  }
  for (const snapshot of requests) {
    await withAcquisitions((s) => {
      s.workerAt = new Date().toISOString();
    });
    const latest = readAcquisitions().requests[snapshot.id];
    if (
      !latest ||
      latest.revision !== snapshot.revision ||
      (latest.retryAt && Date.parse(latest.retryAt) > Date.now())
    )
      continue;
    if (latest.wanted && !ready && !latest.managerId) continue;
    if (latest.kind === 'series' && latest.wanted && !latest.seasons.length) continue;
    const client = new ArrClient(latest.kind === 'series' ? c.sonarr : c.radarr, latest.kind);
    try {
      const remote = await remoteFor(client, latest, ready);
      if (!remote) continue;
      const updated = {
        ...remote,
        monitored: latest.wanted,
        ...(latest.kind === 'series'
          ? {
              seasons: remote.seasons?.map((s) => ({
                ...s,
                monitored: latest.wanted && latest.seasons.includes(s.seasonNumber),
              })),
            }
          : {}),
      };
      await client.call(`${client.resource()}/${remote.id}`, updated, 'PUT');
      // Sonarr fills episodes from TVDB asynchronously after an add; a SeasonSearch before then searches nothing.
      let searchSeasons = latest.seasons;
      if (latest.kind === 'series') {
        // Explicitly set episode monitoring: changing a season alone does not reliably update existing episodes.
        const episodes = await client.call<
          { id: number; seasonNumber: number; monitored: boolean }[]
        >(`episode?seriesId=${remote.id}`);
        for (const on of [false, true]) {
          const ids = episodes
            .filter(
              (ep) =>
                (latest.wanted && latest.seasons.includes(ep.seasonNumber)) === on &&
                ep.monitored !== on,
            )
            .map((ep) => ep.id);
          if (ids.length)
            await client.call('episode/monitor', { episodeIds: ids, monitored: on }, 'PUT');
        }
        searchSeasons = latest.seasons.filter((n) => episodes.some((ep) => ep.seasonNumber === n));
      }
      const queue = (await client.queue()).records.filter((q) =>
        latest.kind === 'film' ? q.movieId === remote.id : q.seriesId === remote.id,
      );
      // A search that found nothing is repeated after a while instead of leaving the title searching forever.
      const stale =
        latest.searchedRevision === latest.revision &&
        !latest.items.length &&
        !queue.length &&
        (!latest.searchedAt || Date.now() - Date.parse(latest.searchedAt) > RESEARCH_MS);
      const waiting = latest.kind === 'series' && !searchSeasons.length;
      if (
        ready &&
        latest.wanted &&
        !waiting &&
        (latest.searchedRevision !== latest.revision || stale)
      ) {
        // Persist before sending a search. A timeout is reconciled without replaying a potentially successful command.
        await withAcquisitions((s) => {
          const r = s.requests[latest.id];
          if (r.revision !== latest.revision) return;
          r.searchedRevision = r.revision;
          r.searchedAt = new Date().toISOString();
        });
        if (latest.kind === 'film')
          await client.call('command', { name: 'MoviesSearch', movieIds: [remote.id] });
        else
          for (const season of searchSeasons)
            await client.call('command', {
              name: 'SeasonSearch',
              seriesId: remote.id,
              seasonNumber: season,
            });
      }
      const items = jelly ? await matchJellyItems(c, latest, remote, jelly) : latest.items;
      const size = queue.reduce((n, q) => n + (q.size || 0), 0),
        left = queue.reduce((n, q) => n + (q.sizeleft || 0), 0);
      const failed = queue.some((q) => /error|warning/i.test(q.trackedDownloadStatus || ''));
      if (items.length || latest.wanted) await syncUnwind(client, latest, remote);
      await withAcquisitions((s) => {
        const r = s.requests[latest.id];
        if (r.revision !== latest.revision) return;
        Object.assign(r, {
          managerId: remote.id,
          items,
          attempts: 0,
          retryAt: undefined,
          note:
            r.wanted && waiting
              ? 'Waiting for the manager to load episodes before searching.'
              : undefined,
          updatedAt: new Date().toISOString(),
          progress: size ? Math.max(0, Math.min(1, 1 - left / size)) : undefined,
          status: !r.wanted
            ? 'paused'
            : queue.length
              ? queue.some((q) => /import/i.test(q.trackedDownloadState || ''))
                ? 'importing'
                : 'downloading'
              : items.length
                ? 'ready'
                : 'searching',
        });
        if (r.wanted && failed) {
          r.status = 'attention';
          r.note =
            'The manager reported a download or import problem. Check its queue before retrying.';
        }
      });
    } catch {
      // Do not expose remote response bodies, credentials, or URLs in the UI or logs.
      await withAcquisitions((s) => {
        const r = s.requests[latest.id];
        if (r.revision !== latest.revision) return;
        r.attempts++;
        r.retryAt = new Date(
          Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(r.attempts, 6)),
        ).toISOString();
        r.status = 'attention';
        r.note =
          'Manager request failed. Check the title match, journal tag, profile, and service health; then retry.';
      });
    }
  }
}
export async function guardDownloads(c = stackConfig(), stopAll = false) {
  const q = new QbitClient(c.qbittorrent);
  const torrents = await q.torrents();
  const prefs = await q.call<{ current_network_interface: string; upnp: boolean }>(
    'app/preferences',
  );
  const routingMatches =
    prefs.current_network_interface === (c.networkMode === 'vpn' ? 'tun0' : '') && !prefs.upnp;
  let allowed =
    c.enabled && (c.networkMode === 'direct' || vpnReady(c)) && routingMatches && !stopAll;
  const active = readAcquisitions();
  allowed =
    allowed &&
    !!active.workerAt &&
    Date.now() - Date.parse(active.workerAt) < 120_000 &&
    Object.values(active.services || {}).every((s) => s.ok);
  const eligible = new Set<string>();
  const owners = new Map<string, { id: string; revision: number }>();
  try {
    for (const kind of ['film', 'series'] as const) {
      const client = new ArrClient(kind === 'film' ? c.radarr : c.sonarr, kind);
      const records = (await client.queue()).records;
      for (const record of records) {
        const request = Object.values(active.requests).find(
          (r) =>
            r.kind === kind && r.managerId === (kind === 'film' ? record.movieId : record.seriesId),
        );
        const season = record.seasonNumber ?? record.episode?.seasonNumber;
        if (
          request?.wanted &&
          (kind === 'film' || (season !== undefined && request.seasons.includes(season))) &&
          record.downloadId
        ) {
          eligible.add(record.downloadId.toLowerCase());
          owners.set(record.downloadId.toLowerCase(), {
            id: request.id,
            revision: request.revision,
          });
        }
      }
    }
  } catch {
    allowed = false;
  }
  // Sonarr can briefly omit a job while its paused magnet is replaced. Retain
  // ownership for that metadata phase using the saved request revision.
  for (const record of Object.values(active.metadata || {})) {
    const request = active.requests[record.requestId];
    const torrent = torrents.find((t) => t.hash === record.hash);
    if (
      request?.wanted &&
      request.revision === record.revision &&
      torrent &&
      torrent.category === record.category &&
      managedTorrent(torrent) &&
      needsMetadata(torrent)
    ) {
      eligible.add(record.hash.toLowerCase());
      owners.set(record.hash.toLowerCase(), { id: request.id, revision: request.revision });
    }
  }
  const storage = storageStatus(c);
  const result = admission(
    torrents.filter((t) => eligible.has(t.hash.toLowerCase())),
    storage,
    allowed,
  );
  const stop = new Set([
    ...result.stop,
    ...torrents
      .filter((t) => managedTorrent(t) && (!allowed || !eligible.has(t.hash.toLowerCase())))
      .map((t) => t.hash),
  ]);
  await q.stop(
    [...stop].filter(
      (hash) =>
        !allowed ||
        !torrents.some(
          (t) => t.hash === hash && needsMetadata(t) && owners.has(hash.toLowerCase()),
        ),
    ),
  );
  storage.reservedBytes = result.reservedBytes;
  const metadata = await fetchMetadata(q, torrents, owners, storage, result.start.length, allowed);
  await q.start(
    result.start.filter((hash) => torrents.some((t) => t.hash === hash && stoppedTorrent(t))),
  );
  storage.reservedBytes += metadata.reservedBytes;
  storage.paused ||=
    !allowed ||
    result.stop.some((hash) => !torrents.some((t) => t.hash === hash && needsMetadata(t)));
  if (metadata.active) storage.note = 'Fetching file information before starting the download.';
  if (!allowed)
    storage.note =
      'Downloads paused until network routing, sources, managers, and the worker are ready.';
  await withAcquisitions((s) => {
    s.storage = storage;
    s.guardAt = new Date().toISOString();
  });
}
