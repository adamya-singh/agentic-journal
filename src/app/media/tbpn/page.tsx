'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, CircleAlert, Loader2, RotateCcw, SkipForward } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { TbpnPlayer } from '@/components/media/tbpn/TbpnPlayer';
import { clock, feedApi } from '@/components/media/feed/api';
import type { EpisodeView, TbpnView } from '@/lib/media/tbpn';

const button =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';
const outline = `${button} border border-gray-200 bg-white hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:hover:bg-gray-800`;
const AUTOPLAY = 'media-tbpn:autoplay';
const maxres = (id: string) => `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;
// TBPN posts from Los Angeles; the show day is the Pacific date.
const showDay = (iso: string, weekday: 'short' | 'long' = 'short') =>
  new Date(iso).toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    weekday,
    month: 'short',
    day: 'numeric',
  });

function stateLabel(e: EpisodeView, nowPlaying: boolean) {
  if (nowPlaying) return { text: 'Now playing', className: 'text-indigo-600 dark:text-indigo-300' };
  if (e.state === 'watched') return { text: 'Watched', className: 'text-gray-500' };
  if (e.resumeAt > 0)
    return { text: `Resume at ${clock(e.resumeAt)}`, className: 'text-amber-700 dark:text-amber-400' };
  if (e.state === 'started') return { text: 'Opened', className: 'text-gray-500' };
  return { text: 'New', className: 'text-gray-500' };
}

function Thumb({ e, width = 'w-32' }: { e: EpisodeView; width?: string }) {
  return (
    <div className={`relative aspect-video ${width} shrink-0 overflow-hidden rounded-lg bg-gray-200 dark:bg-gray-800`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={e.thumbnail} alt="" referrerPolicy="no-referrer" loading="lazy" className="h-full w-full object-cover" />
      {e.durationSec && (
        <span className="absolute bottom-1.5 right-1 rounded bg-black/80 px-1 text-[11px] font-medium text-white">
          {clock(e.durationSec)}
        </span>
      )}
      {e.progress > 0 && (
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/40">
          <span className="block h-full bg-[#ff0033]" style={{ width: `${Math.round(e.progress * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

function HistoryNote({ view }: { view: TbpnView }) {
  if (view.history === 'missing')
    return (
      <p className="mt-2 flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
        <CircleAlert size={15} className="mt-0.5 shrink-0" />
        Your last plays here did not show up in your YouTube history. Sign in to YouTube in this browser
        and allow its cookies, or use Open on YouTube.
      </p>
    );
  return (
    <p className="mt-2 flex items-start gap-1.5 text-sm text-gray-600 dark:text-gray-400">
      <Check size={15} className="mt-0.5 shrink-0 text-green-600" />
      {view.history === 'confirmed'
        ? 'Plays here show up in your YouTube history. Your place is saved here too.'
        : 'Plays on the YouTube account this browser is signed in to. Your place is saved here too.'}
    </p>
  );
}

export default function TbpnPage() {
  const [view, setView] = useState<TbpnView>();
  const [error, setError] = useState('');
  const [currentId, setCurrentId] = useState<string>();
  const [started, setStarted] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [showWatched, setShowWatched] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await feedApi<TbpnView>('tbpn');
      setView(v);
      setError('');
      return v;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Diet TBPN could not be loaded.');
    }
  }, []);
  useEffect(() => {
    void load();
    try {
      setAutoplay(localStorage.getItem(AUTOPLAY) !== 'off');
    } catch {
      /* Storage blocked: autoplay stays on. */
    }
  }, [load]);

  useEffect(() => {
    if (view) setCurrentId((id) => id ?? view.queue[0]?.id);
  }, [view]);

  const all = useMemo(() => (view ? [...view.queue, ...view.watched] : []), [view]);
  const current = all.find((e) => e.id === currentId);
  // The next unwatched episode after this one, else the oldest one left.
  const nextAfter = (id: string, v = view) => {
    if (!v) return undefined;
    const at = [...v.queue, ...v.watched].find((e) => e.id === id)?.publishedAt ?? '';
    return v.queue.find((e) => e.id !== id && e.publishedAt > at) ?? v.queue.find((e) => e.id !== id);
  };
  const next = current ? nextAfter(current.id) : undefined;

  const savePosition = useCallback((id: string, seconds: number) => {
    void fetch('/api/media/tbpn/position', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, position: seconds }),
      keepalive: true,
    }).catch(() => {});
  }, []);
  const onEnded = async (id: string) => {
    await feedApi('tbpn/position', { id, position: 86_400, ended: true }).catch(() => {});
    const v = await load();
    const n = v && nextAfter(id, v);
    if (autoplay && n) setCurrentId(n.id);
  };
  const markWatched = async (id: string, done: boolean) => {
    setBusy(true);
    try {
      const v = await feedApi<TbpnView>('tbpn/watched', { id, done });
      if (done && id === currentId) {
        const n = nextAfter(id, v);
        if (n) setCurrentId(n.id);
      }
      setView(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  const toggleAutoplay = (on: boolean) => {
    setAutoplay(on);
    try {
      localStorage.setItem(AUTOPLAY, on ? 'on' : 'off');
    } catch {
      /* Only this visit, then. */
    }
  };

  const queueIndex = current ? view?.queue.findIndex((e) => e.id === current.id) ?? -1 : -1;
  const hours = view ? (view.remainingSec / 3600).toFixed(1) : '';

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <AppHeader title="Media" subtitle="Your IMDb library, YouTube history and what to watch next" />
      <main className="mx-auto max-w-[1500px] px-4 pb-10 pt-5 sm:px-8">
        <nav aria-label="Breadcrumb" className="mb-4 text-sm text-gray-500">
          <Link href="/media" className="text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
            Media
          </Link>{' '}
          <span aria-hidden>/</span> <span className="font-medium text-gray-900 dark:text-gray-100">Diet TBPN</span>
        </nav>
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}
        {!view && !error && (
          <p role="status" className="flex items-center gap-2 py-20 text-sm text-gray-500">
            <Loader2 size={16} className="animate-spin" /> Loading Diet TBPN from YouTube…
          </p>
        )}
        {view && (
          <div className="flex flex-wrap items-start gap-6">
            <section aria-label="Now playing" className="min-w-0 flex-[999_1_600px]">
              {current ? (
                <>
                  <TbpnPlayer
                    episode={current}
                    poster={maxres(current.id)}
                    started={started}
                    onStart={() => setStarted(true)}
                    onPosition={savePosition}
                    onEnded={(id) => void onEnded(id)}
                    onFailed={() => setError('This episode would not play here. Use Open on YouTube.')}
                  />
                  <div className="mt-4 flex flex-wrap justify-between gap-4">
                    <div className="min-w-0 flex-[1_1_360px]">
                      <p className="text-xs font-semibold uppercase tracking-widest text-indigo-600 dark:text-indigo-400">
                        Diet TBPN · {showDay(current.publishedAt)}
                        {queueIndex >= 0 && ` · ${queueIndex + 1} of ${view.queue.length}`}
                      </p>
                      <h1 className="mt-1.5 text-xl font-semibold leading-snug sm:text-2xl">{current.title}</h1>
                      <HistoryNote view={view} />
                    </div>
                    <div className="flex flex-wrap items-start gap-2">
                      {current.state === 'watched' ? (
                        <button className={outline} disabled={busy} onClick={() => void markWatched(current.id, false)}>
                          <RotateCcw size={15} /> Watch again
                        </button>
                      ) : (
                        <button className={outline} disabled={busy} onClick={() => void markWatched(current.id, true)}>
                          <Check size={15} /> Mark watched
                        </button>
                      )}
                      <a
                        className={outline}
                        href={`${current.url}${current.resumeAt ? `&t=${Math.floor(current.resumeAt)}s` : ''}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Open on YouTube <ArrowUpRight size={15} />
                      </a>
                      <button
                        className={`${button} bg-indigo-600 text-white hover:bg-indigo-700`}
                        disabled={!next}
                        onClick={() => next && setCurrentId(next.id)}
                      >
                        Next episode <SkipForward size={15} />
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex aspect-video flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-gray-300 text-center dark:border-gray-700">
                  <Check size={28} className="text-green-600" />
                  <p className="text-lg font-semibold">You’re caught up.</p>
                  <p className="text-sm text-gray-500">New episodes land here the evening they’re posted.</p>
                </div>
              )}
            </section>

            <aside
              aria-labelledby="backlog-heading"
              className="w-full min-w-0 flex-[1_1_340px] overflow-hidden rounded-2xl border border-gray-200 bg-white lg:max-w-[460px] dark:border-gray-800 dark:bg-gray-900"
            >
              <div className="border-b border-gray-100 px-4 pb-3 pt-4 dark:border-gray-800">
                <div className="flex items-baseline justify-between gap-2">
                  <h2 id="backlog-heading" className="text-base font-semibold">
                    Your backlog
                  </h2>
                  <span className="text-sm text-gray-500">
                    {view.queue.length} left{view.queue.length > 0 && ` · ${hours} h`}
                  </span>
                </div>
                <p className="mb-2.5 mt-1 text-xs text-gray-500">
                  Oldest first, from the last 2 months. Finished episodes drop off.
                </p>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <input
                    type="checkbox"
                    checked={autoplay}
                    onChange={(e) => toggleAutoplay(e.target.checked)}
                    className="h-4 w-4 accent-indigo-600"
                  />
                  Play the next one automatically
                </label>
              </div>
              <ol className="max-h-[640px] overflow-y-auto p-1.5">
                {view.queue.map((e) => {
                  const now = e.id === currentId;
                  const s = stateLabel(e, now);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => setCurrentId(e.id)}
                        aria-current={now ? 'true' : undefined}
                        className={`flex w-full gap-2.5 rounded-xl p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${now ? 'bg-indigo-50 dark:bg-indigo-950/60' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60'}`}
                      >
                        <Thumb e={e} />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-[13px] font-medium leading-snug">{e.title}</span>
                          <span className="mt-1 block text-xs text-gray-500">
                            {showDay(e.publishedAt)} · <span className={`font-medium ${s.className}`}>{s.text}</span>
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
                {view.queue.length === 0 && (
                  <li className="px-3 py-8 text-center text-sm text-gray-500">Nothing left. Nice.</li>
                )}
              </ol>
              {showWatched && view.watched.length > 0 && (
                <ol aria-label="Watched" className="border-t border-gray-100 p-1.5 dark:border-gray-800">
                  {view.watched.map((e) => (
                    <li key={e.id} className="flex items-center gap-2.5 rounded-xl p-2 opacity-70">
                      <Thumb e={e} width="w-24" />
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 text-[13px] leading-snug">{e.title}</span>
                        <span className="mt-1 block text-xs text-gray-500">{showDay(e.publishedAt)}</span>
                      </span>
                      <button
                        className={`${button} !px-2 !py-1 text-xs hover:bg-gray-100 dark:hover:bg-gray-800`}
                        disabled={busy}
                        onClick={() => void markWatched(e.id, false)}
                      >
                        Put back
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm dark:border-gray-800">
                {view.watched.length > 0 ? (
                  <button
                    type="button"
                    className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
                    onClick={() => setShowWatched((s) => !s)}
                  >
                    {showWatched ? 'Hide watched' : `Show ${view.watched.length} watched`}
                  </button>
                ) : (
                  <span />
                )}
                <span className="text-xs text-gray-500">
                  {view.error ? 'YouTube could not be reached; showing the last list.' : 'Older episodes hidden'}
                </span>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
