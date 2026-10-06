'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
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
  X,
} from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import type { MediaTitle, MediaView } from '@/lib/media/types';

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
  const [ratingTitle, setRatingTitle] = useState<MediaTitle>();
  const [score, setScore] = useState('');
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
  const pending = data?.jobs.filter((j) => j.status === 'queued' || j.status === 'running') || [];
  const failed =
    data?.jobs
      .filter(
        (j, i, jobs) =>
          j.status === 'failed' &&
          !jobs.slice(i + 1).some((next) => next.action === j.action && next.titleId === j.titleId),
      )
      .slice(-3) || [];
  const liked = data?.library.filter((t) => (t.yourRating || 0) >= 7) || [];
  const match = (t: MediaTitle) => {
    const search = `${t.title} ${t.year || ''} ${(t.genres || []).join(' ')}`
      .toLowerCase()
      .includes(q.toLowerCase());
    const kind =
      format === 'all' ||
      (format === 'tv'
        ? /TV|Series|Episode/i.test(t.type || '')
        : format === 'anime'
          ? t.genres?.some((g) => /anime/i.test(g))
          : t.type === 'Movie');
    return search && kind;
  };
  const library = (data?.library || []).filter(
    (t) =>
      match(t) &&
      (filter === 'all' ||
        (filter === 'liked' && (t.yourRating || 0) >= 7) ||
        (filter === 'watched' && t.watched) ||
        (filter === 'watchlist' && t.watchlist)),
  );
  const picks = (data?.picks || [])
    .filter(match)
    .sort(
      (a, b) =>
        Number(data?.feedback[b.id] === 'interested') -
        Number(data?.feedback[a.id] === 'interested'),
    );
  const waiting =
    pending.length > 0 && (!data?.workerAt || Date.now() - Date.parse(data.workerAt) > 120_000);
  const card = (title: MediaTitle, recommendation = false) => {
    const titlePending = pending.some((j) => j.titleId === title.id);
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
          aria-label={`View ${title.title} on IMDb`}
        >
          {title.poster ? (
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
          {title.yourRating ? (
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
            {[title.year, title.type, title.imdbRating ? `IMDb ${title.imdbRating}` : null]
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
                {!title.watched && (
                  <button
                    className={`${button} bg-gray-100 dark:bg-gray-800 !px-2 !py-1.5 !text-xs`}
                    disabled={busy}
                    onClick={() =>
                      void act(
                        '/action',
                        { action: 'seen', id: title.id },
                        'Watch queued. It will show as watched after IMDb confirms.',
                      )
                    }
                  >
                    <Check size={13} /> I saw it
                  </button>
                )}
                {!title.watchlist && (
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
                <button
                  className={`${button} !px-2 !py-1.5 !text-xs`}
                  disabled={busy}
                  onClick={() => {
                    setRatingTitle(title);
                    setScore(title.yourRating?.toString() || '');
                  }}
                >
                  <Star size={13} /> Rate
                </button>
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
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <AppHeader title="Media" subtitle="Your IMDb library and what to watch next" />
      <main className="mx-auto max-w-[1500px] px-4 py-8 sm:px-8">
        <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-indigo-500">
              Movies · TV · Anime
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
                : 'IMDb refresh'}
              : {j.error}
            </span>
            <button
              className={button}
              disabled={
                busy || pending.some((p) => p.action === j.action && p.titleId === j.titleId)
              }
              onClick={() =>
                void act(
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
                    Liked = your IMDb rating of 7–10. Watched titles are kept separately.
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
      <Dialog.Root
        open={!!ratingTitle}
        onOpenChange={(open) => {
          if (!open) setRatingTitle(undefined);
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white p-6 dark:bg-gray-900">
            <Dialog.Title className="text-lg font-semibold">Rate {ratingTitle?.title}</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-gray-500">
              Save your exact score to IMDb. Rating a title also records it as watched.
            </Dialog.Description>
            <label className="mt-5 block text-sm">
              Your IMDb rating
              <select
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-transparent p-2 dark:border-gray-700"
              >
                <option value="" disabled>
                  Choose 1–10
                </option>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}/10
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <Dialog.Close className={button}>Cancel</Dialog.Close>
              <button
                className={`${button} bg-indigo-600 text-white hover:!bg-indigo-700`}
                disabled={!score || busy}
                onClick={async () => {
                  if (
                    ratingTitle &&
                    (await act(
                      '/action',
                      { action: 'rating', id: ratingTitle.id, rating: Number(score) },
                      'Rating queued for IMDb.',
                    ))
                  )
                    setRatingTitle(undefined);
                }}
              >
                Save to IMDb
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
