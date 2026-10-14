'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowUpDown,
  ArrowUpRight,
  Check,
  Clock,
  Film,
  Heart,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Star,
  ThumbsDown,
  Trophy,
  X,
} from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { Poster, Ranker, TIER_CLASS, VideoFrame } from '@/components/media/Ranker';
import { YouTubeIntake, YouTubeMark } from '@/components/media/YouTubeIntake';
import { FeedTeaser } from '@/components/media/feed/FeedTeaser';
import { TIERS, isImdb, outOfSync, pendingCount, rankedList, unsorted } from '@/lib/media/ranking';
import type { MediaTitle, MediaView, Tier } from '@/lib/media/types';

const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed';
async function api<T>(path = '', body?: unknown): Promise<T> {
  const r = await fetch(`/api/media${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const p = await r.json();
  if (!r.ok || !p.success) throw new Error(p.error || 'Media could not be loaded.');
  return p.data;
}
type Filter = 'all' | 'liked' | 'watched' | 'watchlist';

export default function MediaPage() {
  const [data, setData] = useState<MediaView>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [format, setFormat] = useState('all');
  const [dismissed, setDismissed] = useState(false);
  const [rankOpen, setRankOpen] = useState(false);
  const [rankFocus, setRankFocus] = useState<string>();
  const openRanker = (focus?: string) => {
    setRankFocus(focus);
    setRankOpen(true);
  };
  const load = useCallback(async () => {
    try {
      setData(await api<MediaView>());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Media could not be loaded.');
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [load]);
  const act = async (path: string, body: unknown, message: string) => {
    setBusy(true);
    setError('');
    try {
      await api(path, body);
      setNotice(message);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const allPending =
    data?.jobs.filter((j) => j.status === 'queued' || j.status === 'running') || [];
  // YouTube imports have their own status band; this list is IMDb requests.
  const pending = allPending.filter((j) => j.action !== 'youtube-sync');
  const youtubeSyncing = allPending.some((j) => j.action === 'youtube-sync');
  const failed =
    data?.jobs
      .filter(
        (j, i, jobs) =>
          j.status === 'failed' &&
          !jobs.slice(i + 1).some((next) => next.action === j.action && next.titleId === j.titleId),
      )
      .slice(-3) || [];
  const ranked = data ? rankedList(data.ranking) : [];
  const rankOf = new Map(ranked.map((r) => [r.id, r]));
  // IMDb titles are liked by your IMDb rating; YouTube videos by their ranking score.
  const isLiked = (t: MediaTitle) =>
    (t.source === 'youtube' ? rankOf.get(t.id)?.score || 0 : t.yourRating || 0) >= 7;
  const liked = data?.library.filter(isLiked) || [];
  const match = (t: MediaTitle) => {
    const search = `${t.title} ${t.year || ''} ${(t.genres || []).join(' ')}`
      .toLowerCase()
      .includes(q.toLowerCase());
    const youtube = t.source === 'youtube';
    const kind =
      format === 'all' ||
      (format === 'youtube'
        ? youtube
        : !youtube &&
          (format === 'tv'
            ? /TV|Series|Episode/i.test(t.type || '')
            : format === 'anime'
              ? t.genres?.some((g) => /anime/i.test(g))
              : t.type === 'Movie'));
    return search && kind;
  };
  const pendingTier = new Map<string, Tier>(
    data ? TIERS.flatMap((t) => data.ranking.pending[t].map((id) => [id, t] as const)) : [],
  );
  const rankLeft = data
    ? unsorted(data.ranking, data.library).length + pendingCount(data.ranking)
    : 0;
  const ratingJobs = pending.filter((j) => j.action === 'rating');
  const unsynced = data
    ? outOfSync(data.ranking, Object.fromEntries(data.library.map((t) => [t.id, t]))).filter(
        (x) => !ratingJobs.some((j) => j.titleId === x.id && j.rating === x.rating),
      )
    : [];
  const library = (data?.library || [])
    .filter(
      (t) =>
        match(t) &&
        (filter === 'all' ||
          (filter === 'liked' && isLiked(t)) ||
          (filter === 'watched' && t.watched) ||
          (filter === 'watchlist' && t.watchlist)),
    )
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        (rankOf.get(a.t.id)?.rank ?? Infinity) - (rankOf.get(b.t.id)?.rank ?? Infinity) ||
        a.i - b.i,
    )
    .map(({ t }) => t);
  const picks = (data?.picks || [])
    .filter(match)
    .sort(
      (a, b) =>
        Number(data?.feedback[b.id] === 'interested') -
        Number(data?.feedback[a.id] === 'interested'),
    );
  const waiting =
    allPending.length > 0 && (!data?.workerAt || Date.now() - Date.parse(data.workerAt) > 120_000);
  const card = (title: MediaTitle, recommendation = false) => {
    const titlePending = pending.some((j) => j.titleId === title.id);
    const youtube = title.source === 'youtube';
    return (
      <article
        key={title.id}
        className="group flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900"
      >
        <a
          href={title.url}
          target="_blank"
          rel="noreferrer"
          className="relative block aspect-[2/3] overflow-hidden bg-gray-100 dark:bg-gray-800"
          aria-label={`View ${title.title} on ${youtube ? 'YouTube' : 'IMDb'}`}
        >
          {title.poster && youtube ? (
            <VideoFrame src={title.poster} />
          ) : title.poster ? (
            // IMDb already supplies resized images; keep the remote source without proxying it.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={title.poster}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-gray-400">
              <Film size={44} />
            </div>
          )}
          {rankOf.has(title.id) ? (
            <span
              className={`absolute left-2 top-2 rounded-md px-2 py-1 text-xs font-bold ${TIER_CLASS[rankOf.get(title.id)!.tier]}`}
            >
              #{rankOf.get(title.id)!.rank} · {rankOf.get(title.id)!.tier} ·{' '}
              {rankOf.get(title.id)!.score}/10
            </span>
          ) : pendingTier.has(title.id) ? (
            <span
              className={`absolute left-2 top-2 rounded-md px-2 py-1 text-xs font-bold ${TIER_CLASS[pendingTier.get(title.id)!]}`}
            >
              {pendingTier.get(title.id)} · not placed yet
            </span>
          ) : title.yourRating ? (
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-1 text-xs font-semibold text-white">
              <Star size={12} fill="currentColor" /> Your {title.yourRating}/10
            </span>
          ) : null}
          {title.watched && (
            <span className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/75 px-2 py-1 text-xs text-white">
              <Check size={12} /> Watched
            </span>
          )}
        </a>
        <div className="flex flex-1 flex-col p-3">
          <a
            href={title.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold leading-snug hover:text-indigo-500"
          >
            {title.title}
          </a>
          <p className="mt-1 text-xs text-gray-500">
            {(youtube
              ? [title.channel, 'YouTube']
              : [title.year, title.type, title.imdbRating ? `IMDb ${title.imdbRating}` : null]
            )
              .filter(Boolean)
              .join(' · ')}
          </p>
          {recommendation && title.reason && (
            <p className="mt-2 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              {title.reason}
            </p>
          )}
          {data?.feedback[title.id] === 'interested' && (
            <span className="mt-2 text-xs font-medium text-indigo-500">Interested</span>
          )}
          <div className="mt-auto pt-3">
            {titlePending ? (
              <p className="flex items-center gap-1 py-2 text-xs text-gray-500">
                <Loader2 size={12} className="animate-spin" /> Saving to IMDb…
              </p>
            ) : (
              <div className="flex flex-wrap gap-1">
                {isImdb(title.id) && !title.watched && (
                  <button
                    className={`${button} bg-gray-100 dark:bg-gray-800 !px-2 !py-1.5 !text-xs`}
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await act(
                          '/action',
                          { action: 'seen', id: title.id },
                          'Watch queued. It will show as watched after IMDb confirms.',
                        )
                      )
                        openRanker(title.id);
                    }}
                  >
                    <Check size={13} /> I saw it
                  </button>
                )}
                {isImdb(title.id) && !title.watchlist && (
                  <button
                    className={`${button} !px-2 !py-1.5 !text-xs`}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        '/action',
                        { action: 'watchlist', id: title.id },
                        'Added to the IMDb save queue.',
                      )
                    }
                  >
                    <Plus size={13} /> Watchlist
                  </button>
                )}
                {title.watched && (
                  <button
                    className={`${button} !px-2 !py-1.5 !text-xs`}
                    disabled={busy}
                    onClick={() => openRanker(title.id)}
                  >
                    <ArrowUpDown size={13} /> {rankOf.has(title.id) ? 'Move' : 'Rank'}
                  </button>
                )}
                {youtube && (
                  <button
                    className={`${button} !px-2 !py-1.5 !text-xs text-gray-500`}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        '/youtube/unkeep',
                        { id: title.id },
                        'Removed from your library. It stays skipped in your YouTube history.',
                      )
                    }
                  >
                    <X size={13} /> Remove
                  </button>
                )}
                {recommendation && (
                  <>
                    <button
                      className={`${button} !px-2 !py-1.5 !text-xs`}
                      disabled={busy}
                      aria-label={`Interested in ${title.title}`}
                      onClick={() =>
                        void act(
                          '/feedback',
                          {
                            id: title.id,
                            value: data?.feedback[title.id] === 'interested' ? null : 'interested',
                          },
                          'Preference saved.',
                        )
                      }
                    >
                      <Heart size={13} /> Interested
                    </button>
                    <button
                      className={`${button} !px-2 !py-1.5 !text-xs text-gray-500`}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          '/feedback',
                          { id: title.id, value: 'dismissed' },
                          'Hidden from recommendations. You can restore it below.',
                        )
                      }
                    >
                      <ThumbsDown size={13} /> Not interested
                    </button>
                  </>
                )}
              </div>
            )}
            {title.watchlist && (
              <span className="mt-1 block text-xs text-gray-500">On your IMDb Watchlist</span>
            )}
          </div>
        </div>
      </article>
    );
  };
  const syncYouTube = () =>
    void act(
      '/youtube/sync',
      {},
      'YouTube sync queued. OpenClaw reads your history in the background.',
    );
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <AppHeader
        title="Media"
        subtitle="Your IMDb library, YouTube history and what to watch next"
      />
      <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-8">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">
              Movies · TV · Anime · YouTube
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight">
              A little inspiration for your next watch.
            </h2>
            <p className="mt-2 text-sm text-gray-500">
              {data?.account
                ? `Connected to ${data.account.name} on IMDb.`
                : 'Use your signed-in OpenClaw browser to connect IMDb.'}{' '}
              {data?.syncedAt && `Updated ${new Date(data.syncedAt).toLocaleString()}.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={`${button} border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900`}
              disabled={busy || youtubeSyncing}
              onClick={syncYouTube}
            >
              {youtubeSyncing ? <Loader2 size={16} className="animate-spin" /> : <YouTubeMark />}{' '}
              Sync YouTube
            </button>
            <button
              className={`${button} bg-indigo-600 text-white hover:!bg-indigo-700`}
              disabled={busy || pending.some((j) => j.action === 'sync')}
              onClick={() =>
                void act('/sync', {}, 'IMDb refresh queued. You can leave this page while it runs.')
              }
            >
              <RefreshCw
                size={16}
                className={pending.some((j) => j.action === 'sync') ? 'animate-spin' : ''}
              />{' '}
              {data?.account ? 'Refresh IMDb' : 'Connect IMDb'}
            </button>
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
          >
            {error}
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mb-4 flex items-center justify-between rounded-lg bg-indigo-50 p-3 text-sm text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200"
          >
            {notice}
            <button className={button} aria-label="Dismiss notice" onClick={() => setNotice('')}>
              <X size={14} />
            </button>
          </div>
        )}
        {pending.length > 0 && (
          <p role="status" className="mb-4 flex items-center gap-2 text-sm text-gray-500">
            <Clock size={15} />{' '}
            {waiting
              ? 'Waiting for the IMDb connection. Your changes are queued.'
              : `${pending.length} IMDb ${pending.length === 1 ? 'request' : 'requests'} pending. Confirmed saves will appear here.`}
          </p>
        )}
        {data?.warning && (
          <p className="mb-4 rounded-lg border border-amber-200 p-3 text-sm text-amber-700 dark:border-amber-900 dark:text-amber-300">
            {data.warning}
          </p>
        )}
        {failed.map((j) => (
          <div
            key={j.id}
            role="alert"
            className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 p-3 text-sm dark:border-amber-900"
          >
            <span>
              {j.titleId
                ? data?.library.find((t) => t.id === j.titleId)?.title ||
                  data?.picks.find((t) => t.id === j.titleId)?.title
                : j.action === 'youtube-sync'
                  ? 'YouTube sync'
                  : 'IMDb refresh'}
              : {j.error}
            </span>
            <button
              className={button}
              disabled={
                busy || allPending.some((p) => p.action === j.action && p.titleId === j.titleId)
              }
              onClick={() =>
                j.action === 'youtube-sync'
                  ? syncYouTube()
                  : void act(
                      j.action === 'sync' ? '/sync' : '/action',
                      j.action === 'sync'
                        ? {}
                        : {
                            action: j.action,
                            id: j.titleId,
                            ...(j.action === 'rating' ? { rating: j.rating } : {}),
                          },
                      'Retry queued; current IMDb state will be checked first.',
                    )
              }
            >
              Retry
            </button>
          </div>
        ))}
        <div className="my-6 flex flex-wrap items-center gap-3 border-y border-gray-200 py-4 dark:border-gray-800">
          <label className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900">
            <Search size={16} className="text-gray-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search your media and recommendations"
              aria-label="Search media"
              className="w-full min-w-[180px] bg-transparent text-sm outline-none"
            />
          </label>
          <select
            aria-label="Media format"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
            value={format}
            onChange={(e) => setFormat(e.target.value)}
          >
            <option value="all">All formats</option>
            <option value="movie">Movies</option>
            <option value="tv">TV & episodes</option>
            <option value="anime">Anime</option>
            <option value="youtube">YouTube</option>
          </select>
          {data && (
            <p className="text-sm text-gray-500">
              {data.library.length} in your library · {liked.length} liked
            </p>
          )}
        </div>
        {!data && !error && (
          <p role="status" className="py-10 text-center text-gray-500">
            Loading your media…
          </p>
        )}
        {data && (
          <>
            <FeedTeaser />
            <YouTubeIntake
              syncing={youtubeSyncing}
              onLibraryChanged={() => void load()}
              onSync={syncYouTube}
            />
            <section aria-labelledby="ranking-heading" className="mb-10">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 id="ranking-heading" className="text-xl font-semibold">
                    Your ranking
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    {ranked.length
                      ? `${ranked.length} ranked${rankLeft ? ` · ${rankLeft} waiting for a place` : ''}. Scores go to IMDb as your ratings.`
                      : 'Sort what you have watched into S, A, B and C, then a few head-to-head picks set the exact order.'}
                  </p>
                  {ratingJobs.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-gray-500">
                      <Loader2 size={12} className="animate-spin" /> Saving {ratingJobs.length}{' '}
                      {ratingJobs.length === 1 ? 'score' : 'scores'} to IMDb
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {unsynced.length > 0 && !rankLeft && (
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void act(
                          '/ranking/sync',
                          {},
                          'Scores queued for IMDb. They save one at a time in the background.',
                        )
                      }
                    >
                      <RefreshCw size={14} /> Send {unsynced.length}{' '}
                      {unsynced.length === 1 ? 'score' : 'scores'} to IMDb
                    </button>
                  )}
                  <button
                    className={`${button} bg-indigo-600 text-white hover:!bg-indigo-700`}
                    onClick={() => openRanker()}
                  >
                    <Trophy size={15} />{' '}
                    {!ranked.length
                      ? `Rank ${rankLeft} titles`
                      : rankLeft
                        ? `Continue ranking · ${rankLeft} left`
                        : 'Rank'}
                  </button>
                </div>
              </div>
              {ranked.length > 0 && (
                <div className="grid gap-2">
                  {TIERS.filter((tier) => data.ranking.tiers[tier].length).map((tier) => (
                    <div key={tier} className="grid grid-cols-[46px_minmax(0,1fr)] gap-2.5">
                      <span
                        className={`grid place-items-center rounded-lg text-2xl font-extrabold ${TIER_CLASS[tier]}`}
                      >
                        {tier}
                      </span>
                      <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1">
                        {ranked
                          .filter((r) => r.tier === tier)
                          .map((r) => {
                            const t = data.library.find((x) => x.id === r.id);
                            return (
                              <button
                                key={r.id}
                                className="relative shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                                title={`${t?.title} · ${r.score}/10. Click to move it.`}
                                onClick={() => openRanker(r.id)}
                              >
                                <Poster title={t} className="w-[74px]" />
                                <span className="absolute left-1 top-1 rounded bg-black/75 px-1.5 text-[10px] font-bold tabular-nums text-white">
                                  #{r.rank}
                                </span>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section aria-labelledby="picks-heading" className="mb-10">
              <div className="mb-4 flex items-end justify-between gap-3">
                <div>
                  <h3 id="picks-heading" className="text-xl font-semibold">
                    For your next watch
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    IMDb picks and related titles. Tell us what fits.
                  </p>
                </div>
                <a
                  className={`${button} text-gray-500`}
                  href="https://www.imdb.com/what-to-watch/top-picks/"
                  target="_blank"
                  rel="noreferrer"
                >
                  Explore IMDb <ArrowUpRight size={14} />
                </a>
              </div>
              {picks.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {picks.slice(0, 18).map((t) => card(t, true))}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500 dark:border-gray-700">
                  {data.account
                    ? 'No matching recommendations. Try another filter or refresh IMDb for new picks.'
                    : 'Connect IMDb to bring in your history, ratings, Watchlist, and recommendations.'}
                </div>
              )}
            </section>
            <section aria-labelledby="library-heading">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
                <div>
                  <h3 id="library-heading" className="text-xl font-semibold">
                    Your library
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Liked = your IMDb rating of 7–10, or a ranking score of 7+ for YouTube videos.
                    Watched titles are kept separately.
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {(['all', 'liked', 'watched', 'watchlist'] as const).map((f) => (
                    <button
                      key={f}
                      className={`${button} capitalize ${filter === f ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : ''}`}
                      aria-pressed={filter === f}
                      onClick={() => setFilter(f)}
                    >
                      {f === 'all' ? 'All media' : f}
                    </button>
                  ))}
                </div>
              </div>
              {Object.entries(data.coverage).some(([, c]) => !c.complete) && (
                <p className="mb-4 text-xs text-amber-600">
                  Some IMDb lists are incomplete. Counts reflect imported titles.
                </p>
              )}
              {library.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
                  {library.map((t) => card(t))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-gray-500">
                  {filter === 'liked'
                    ? 'Rate the titles you enjoyed on IMDb to build your liked collection.'
                    : 'No media matches these filters.'}
                </p>
              )}
            </section>
            <div className="mt-8 border-t border-gray-200 pt-4 dark:border-gray-800">
              <button
                className={`${button} text-gray-500`}
                onClick={() => setDismissed(!dismissed)}
                aria-expanded={dismissed}
              >
                Not interested ({data.dismissed.length})
              </button>
              <p className="mt-1 text-xs text-gray-500">
                Interested and Not interested are private Journal preferences. Seen, ratings, and
                Watchlist saves go to IMDb.
              </p>
              {dismissed && (
                <ul className="mt-3 divide-y divide-gray-200 dark:divide-gray-800">
                  {data.dismissed.map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <a href={t.url} target="_blank" rel="noreferrer">
                        {t.title}
                      </a>
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void act(
                            '/feedback',
                            { id: t.id, value: null },
                            'Recommendation restored.',
                          )
                        }
                      >
                        Restore
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>
      {data && (
        <Ranker
          open={rankOpen}
          onOpenChange={(open) => {
            setRankOpen(open);
            if (!open) void load();
          }}
          data={data}
          focusId={rankFocus}
          api={api}
          onSaved={setData}
        />
      )}
    </div>
  );
}
