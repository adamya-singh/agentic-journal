'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, Link2, Loader2, Search, SkipForward, Star, X } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { clock, feedApi } from '@/components/media/feed/api';
import { UnwindPlayer } from '@/components/media/unwind/UnwindPlayer';
import { DUSK, DuskSky, PosterImg, Progress, minutesLabel, outline, primary } from '@/components/media/unwind/ui';
import type { WatchView } from '@/lib/media/unwind-view';

// One show or film, playing in the Journal: /media/unwind/watch?id=tt…&ep=S1E3.

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return { id: p.get('id') || '', ep: p.get('ep') || undefined };
}

function NoSource({ v, onChanged }: { v: WatchView; onChanged: () => void }) {
  const [busy, setBusy] = useState<'find' | 'link' | 'want'>();
  const [note, setNote] = useState('');
  const [url, setUrl] = useState('');
  const find = async () => {
    setBusy('find');
    setNote('');
    try {
      const r = await feedApi<{ added: unknown[]; proposed: string[]; none: string[] }>('unwind/find', { id: v.show.id });
      setNote(
        r.added.length
          ? `Found ${r.added.length} official upload${r.added.length === 1 ? '' : 's'}.`
          : r.proposed.length
            ? `${r.proposed.join(', ')} posts full episodes. Approve the channel on your taste card to use it.`
            : 'No official upload on YouTube.',
      );
      onChanged();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('link');
    setNote('');
    try {
      await feedApi('unwind/source', { id: v.show.id, key: v.key, url: url.trim() });
      setUrl('');
      onChanged();
    } catch (err) {
      setNote((err as Error).message);
    } finally {
      setBusy(undefined);
    }
  };
  const want = async () => {
    setBusy('want');
    try {
      await feedApi('unwind/want', { id: v.show.id, on: !v.show.wanted });
      onChanged();
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <div className={`relative flex aspect-video flex-col justify-center overflow-hidden rounded-2xl ${DUSK} p-6 text-white sm:p-10`}>
      <DuskSky sun="sm" />
      <div className="relative max-w-xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffc2a8]">Nothing plays this here yet</p>
        <h2 className="mt-1 text-xl font-bold sm:text-2xl">{v.show.kind === 'film' ? v.show.title : `${v.show.title} · ${v.episode.label}`}</h2>
        <p className="mt-2 text-sm text-white/80">
          Put the file in your library’s inbox folder and it plays here once it is ready, or use an upload the studio posted itself.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" onClick={() => void find()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#3b1f5e] hover:bg-white/90 disabled:opacity-60">
            {busy === 'find' ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Look for an official upload
          </button>
          <button type="button" onClick={() => void want()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-4 py-2 text-sm font-semibold text-white hover:bg-white/10 disabled:opacity-60">
            <Star size={15} fill={v.show.wanted ? 'currentColor' : 'none'} /> {v.show.wanted ? 'On your wanted list' : 'Add to wanted list'}
          </button>
        </div>
        <form onSubmit={add} className="mt-3 flex max-w-md gap-2">
          <label htmlFor="source-url" className="sr-only">
            YouTube link
          </label>
          <input
            id="source-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Or paste a YouTube link"
            className="min-w-0 flex-1 rounded-full border border-white/25 bg-white/10 px-4 py-2 text-sm text-white placeholder:text-white/60 outline-none focus:border-white/60"
          />
          <button type="submit" disabled={!!busy || !url.trim()} className="inline-flex items-center gap-1.5 rounded-full border border-white/30 px-3.5 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-50">
            {busy === 'link' ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />} Use it
          </button>
        </form>
        {note && <p role="status" className="mt-3 text-sm text-white/90">{note}</p>}
      </div>
    </div>
  );
}

export default function WatchPage() {
  const [v, setV] = useState<WatchView>();
  const [error, setError] = useState('');
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<number>();

  const load = useCallback(async (id: string, ep?: string) => {
    try {
      const view = await feedApi<WatchView>(`unwind/watch?id=${encodeURIComponent(id)}${ep ? `&ep=${ep}` : ''}`);
      setV(view);
      setError('');
      return view;
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const { id, ep } = readUrl();
    if (!id) setError('No title picked.');
    else void load(id, ep);
  }, [load]);
  const go = async (key: string, autoplay = started) => {
    if (!v) return;
    window.history.replaceState(null, '', `/media/unwind/watch?id=${v.show.id}&ep=${key}`);
    setEnded(false);
    setStarted(autoplay);
    const view = await load(v.show.id, key);
    if (view) setOpen(view.episodes.find((e) => e.key === key)?.season);
  };
  const reload = () => v && void load(v.show.id, v.key);

  const source = useMemo(() => v?.sources.find((s) => !failed.has(s.fileId || s.videoId || '')), [v, failed]);
  const savePosition = useCallback(
    (seconds: number, duration?: number, done = false) => {
      if (!v) return;
      void fetch('/api/media/unwind/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: v.show.id, key: v.key, position: Math.min(seconds, 86_400), duration, ended: done || undefined }),
        keepalive: true,
      }).catch(() => {});
    },
    [v],
  );
  const markWatched = async (key: string, done: boolean) => {
    if (!v) return;
    try {
      await feedApi('unwind/watched', { id: v.show.id, key, done });
      await load(v.show.id, v.key);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const seasons = useMemo(() => {
    const m = new Map<number, WatchView['episodes']>();
    for (const e of v?.episodes || []) m.set(e.season ?? 1, [...(m.get(e.season ?? 1) || []), e]);
    return [...m];
  }, [v]);
  const currentSeason = v?.episodes.find((e) => e.key === v.key)?.season;
  const next = v?.nextKey ? v.episodes.find((e) => e.key === v.nextKey) : undefined;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <AppHeader title="Media" subtitle="Unwind" />
      <main className="mx-auto max-w-[1500px] px-4 pb-16 pt-5 sm:px-8">
        <nav aria-label="Breadcrumb" className="mb-4 flex flex-wrap gap-1.5 text-sm text-gray-500">
          <Link href="/media" className="text-violet-700 hover:underline dark:text-violet-300">Media</Link>
          <span aria-hidden>/</span>
          <Link href="/media/unwind" className="text-violet-700 hover:underline dark:text-violet-300">Unwind</Link>
          {v && (
            <>
              <span aria-hidden>/</span> <span className="font-medium text-gray-900 dark:text-gray-100">{v.show.title}</span>
            </>
          )}
        </nav>
        {error && (
          <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
            <button type="button" aria-label="Dismiss" onClick={() => setError('')}><X size={15} /></button>
          </div>
        )}
        {!v ? (
          !error && (
            <p role="status" className="flex items-center gap-2 py-20 text-sm text-gray-500">
              <Loader2 size={16} className="animate-spin" /> Loading…
            </p>
          )
        ) : (
          <div className="flex flex-wrap items-start gap-6">
            <section aria-label="Now playing" className="min-w-0 flex-[999_1_640px]">
              {source ? (
                <UnwindPlayer
                  key={`${v.key}:${source.fileId || source.videoId}`}
                  source={source}
                  title={v.episode.label}
                  resumeAt={v.episode.resumeAt}
                  started={started}
                  onStart={() => setStarted(true)}
                  onPosition={(s, d) => savePosition(s, d)}
                  onEnded={() => {
                    savePosition(86_400, undefined, true);
                    setEnded(true);
                  }}
                  onFailed={() => setFailed((f) => new Set(f).add(source.fileId || source.videoId || ''))}
                />
              ) : (
                <NoSource v={v} onChanged={reload} />
              )}
              {ended && next && (
                <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-[#1e1338] px-4 py-3 text-white">
                  <span className="flex-1 text-sm">Up next: {next.label}{next.minutes ? ` · ${minutesLabel(next.minutes)}` : ''}</span>
                  <button type="button" onClick={() => void go(next.key, true)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#3b1f5e]">
                    <SkipForward size={15} /> Play next
                  </button>
                  <Link href="/media/unwind" className="rounded-full border border-white/30 px-4 py-2 text-sm font-semibold hover:bg-white/10">Done for tonight</Link>
                </div>
              )}
              <div className="mt-4 flex flex-wrap justify-between gap-4">
                <div className="min-w-0 flex-[1_1_360px]">
                  <p className="text-xs font-semibold uppercase tracking-widest text-violet-700 dark:text-violet-300">
                    {v.show.kind === 'film' ? 'Film' : v.show.title}
                  </p>
                  <h1 className="mt-1 text-xl font-semibold leading-snug sm:text-2xl">{v.show.kind === 'film' ? v.show.title : v.episode.label}</h1>
                  <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                    {[minutesLabel(v.episode.minutes), v.show.network, v.show.year?.slice(0, 4), v.episode.resumeAt > 0 && `resume at ${clock(v.episode.resumeAt)}`].filter(Boolean).join(' · ')}
                  </p>
                  {v.show.why && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-700 dark:text-gray-300">{v.show.why}</p>}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {v.episodes.find((e) => e.key === v.key)?.watched || (v.show.kind === 'film' && v.show.state === 'finished') ? (
                    <button type="button" onClick={() => void markWatched(v.key, false)} className={outline}>
                      <Check size={15} className="text-green-600" /> Watched
                    </button>
                  ) : (
                    <button type="button" onClick={() => void markWatched(v.key, true)} className={outline}>
                      <Check size={15} /> Mark watched
                    </button>
                  )}
                  {next && (
                    <button type="button" onClick={() => void go(next.key)} className={primary}>
                      <SkipForward size={15} /> Next episode
                    </button>
                  )}
                </div>
              </div>
            </section>

            <aside aria-labelledby="episodes-heading" className="w-full min-w-0 flex-[1_1_340px] overflow-hidden rounded-2xl border border-gray-200 bg-white lg:max-w-[440px] dark:border-white/10 dark:bg-gray-900">
              <div className="flex gap-3.5 border-b border-gray-100 p-4 dark:border-white/10">
                <div className="w-16 shrink-0">
                  <PosterImg src={v.show.poster} title={v.show.title} kind={v.show.kind} />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 id="episodes-heading" className="text-base font-semibold">{v.show.title}</h2>
                  <p className="text-xs text-gray-500">{[v.show.network, v.show.year].filter(Boolean).join(' · ')}</p>
                  {v.show.kind === 'series' && (
                    <>
                      <Progress watched={v.show.watched} total={v.show.total} className="mt-2" />
                      <p className="mt-1 text-xs text-gray-500">{v.show.watched} of {v.show.total} watched</p>
                    </>
                  )}
                  {v.show.summary && <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-gray-600 dark:text-gray-400">{v.show.summary}</p>}
                </div>
              </div>
              {seasons.length > 0 && (
                <div className="max-h-[620px] overflow-y-auto p-1.5">
                  {seasons.map(([season, eps]) => {
                    const expanded = (open ?? currentSeason) === season;
                    const done = eps.filter((e) => e.watched).length;
                    return (
                      <div key={season}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpen(expanded ? -1 : season)}
                          className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm font-semibold hover:bg-gray-50 dark:hover:bg-white/[0.04]"
                        >
                          Season {season}
                          <span className="flex items-center gap-2 text-xs font-normal text-gray-500">
                            {done}/{eps.length} <ChevronDown size={14} className={expanded ? 'rotate-180' : ''} />
                          </span>
                        </button>
                        {expanded && (
                          <ol>
                            {eps.map((e) => {
                              const now = e.key === v.key;
                              return (
                                <li key={e.key} className={`flex items-center gap-2 rounded-lg ${now ? 'bg-violet-50 dark:bg-violet-500/10' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'}`}>
                                  <button type="button" onClick={() => void go(e.key)} className="flex min-w-0 flex-1 items-start gap-2.5 px-3 py-2 text-left">
                                    <span className="w-7 shrink-0 pt-px text-xs tabular-nums text-gray-400">{e.key.replace(/^S\d+E/, '')}</span>
                                    <span className="min-w-0 flex-1">
                                      <span className={`block truncate text-[13px] font-medium ${e.watched ? 'text-gray-500' : ''}`}>{e.name || e.label}</span>
                                      <span className="block text-[11px] text-gray-500">
                                        {[now ? 'Now playing' : e.resumeAt ? `Resume at ${clock(e.resumeAt)}` : undefined, minutesLabel(e.minutes), e.playable && 'plays here'].filter(Boolean).join(' · ')}
                                      </span>
                                    </span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void markWatched(e.key, !e.watched)}
                                    aria-label={e.watched ? `Mark ${e.label} unwatched` : `Mark ${e.label} watched`}
                                    className={`mr-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${e.watched ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 text-transparent hover:text-gray-400 dark:border-white/20'}`}
                                  >
                                    <Check size={14} />
                                  </button>
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </aside>
          </div>
        )}
      </main>
    </div>
  );
}
