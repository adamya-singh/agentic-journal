'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Instrument_Serif } from 'next/font/google';
import { ArrowLeft, ArrowRight, Check, Clapperboard, FolderOpen, Loader2, Pause, Play, Plus, Search, X } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { clock, feedApi } from '@/components/media/feed/api';
import { DUSK, DuskSky, PosterImg, Progress, minutesLabel, outline, pill, primary } from '@/components/media/unwind/ui';
import type { Bucket, Pick, ShowCard, UnwindView } from '@/lib/media/unwind-view';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });
const BUCKET_KEY = 'media-unwind:bucket';
const CHIPS: { value: Bucket; label: string; kicker: string }[] = [
  { value: '30', label: '30 min', kicker: 'Fits 30 minutes' },
  { value: '60', label: '1 hour', kicker: 'Fits an hour' },
  { value: '120', label: '2 hours +', kicker: 'A long night' },
  { value: 'clips', label: 'Just clips', kicker: 'Clips only' },
];
const watchHref = (id: string, key?: string) => `/media/unwind/watch?id=${id}${key ? `&ep=${key}` : ''}`;

interface SearchHit {
  id: string;
  kind: 'series' | 'film';
  title: string;
  year?: string;
  poster?: string;
  network?: string;
}
interface LibraryState {
  unmatched: { id: string; rel: string; guess?: { title: string; season?: number; number?: number; year?: string }; status: string }[];
  failed: { id: string; rel: string; error?: string }[];
  preparing: number;
  ready: number;
}

function Tonight({ pick, kicker, onWatched, busy }: { pick: Pick; kicker: string; onWatched: (id: string, key: string) => void; busy: boolean }) {
  if (pick.kind === 'none')
    return (
      <div className="rounded-2xl border border-white/15 bg-black/25 p-5 text-sm text-white/85">
        {pick.note}{' '}
        <Link href="/media/unwind/taste" className="font-semibold text-[#ffc2a8] hover:underline">
          Open your taste card
        </Link>
      </div>
    );
  if (pick.kind === 'clips')
    return (
      <div className="flex flex-wrap gap-5 rounded-2xl border border-white/15 bg-black/30 p-4">
        <div className="grid w-full max-w-[280px] grid-cols-2 gap-1.5">
          {pick.clips!.slice(0, 4).map((c) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={c.id} src={c.youtube?.thumbnail || c.x?.media[0]?.preview || ''} alt="" referrerPolicy="no-referrer" className="aspect-video w-full rounded-lg bg-white/10 object-cover" />
          ))}
        </div>
        <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffc2a8]">{kicker}</p>
          <h2 className="text-2xl font-bold tracking-tight">
            {pick.clips!.length} clips · about {minutesLabel(pick.minutes) || '1 min'}
          </h2>
          <p className="text-sm text-white/80">{pick.note} {pick.clips!.slice(0, 3).map((c) => c.creator.name).join(', ')}.</p>
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            <Link href="/media/feed?track=unwind&view=theater" className={`${pill} bg-white text-[#3b1f5e] hover:bg-white/90`}>
              <Play size={15} fill="currentColor" /> Play the set
            </Link>
            <Link href="/media/feed?track=unwind" className={`${pill} border border-white/30 text-white hover:bg-white/10`}>
              Open the clip stream
            </Link>
          </div>
        </div>
      </div>
    );
  const s = pick.show!;
  const first = pick.episodes![0];
  const label = s.kind === 'film' ? s.title : `${s.title} · ${first.label}`;
  return (
    <div className="flex flex-wrap gap-5 rounded-2xl border border-white/15 bg-black/30 p-4">
      <div className="w-[120px] shrink-0 sm:w-[150px]">
        <PosterImg src={s.poster} title={s.title} kind={s.kind} />
      </div>
      <div className="flex min-w-0 flex-[1_1_280px] flex-col gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#ffc2a8]">{kicker}</p>
        <h2 className="text-2xl font-bold leading-tight tracking-tight">{label}</h2>
        <p className="text-sm text-white/75">
          {[minutesLabel(pick.minutes), s.network, s.kind === 'series' && `episode ${s.watched + 1} of ${s.total}`, pick.episodes!.length > 1 && `${pick.episodes!.length} episodes`]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {s.kind === 'series' && <Progress watched={s.watched} total={s.total} className="max-w-sm !bg-white/20 [&>span]:!bg-[#ffc2a8]" />}
        <p className="max-w-xl text-sm leading-relaxed text-white/90">
          {first.resumeAt > 0 ? `Resume at ${clock(first.resumeAt)}. ` : ''}
          {s.why || pick.note}
        </p>
        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <Link href={watchHref(s.id, first.key)} className={`${pill} bg-white text-[#3b1f5e] hover:bg-white/90`}>
            <Play size={15} fill="currentColor" /> {first.playable ? (first.resumeAt ? 'Resume' : 'Play here') : 'Find a way to play it'}
          </Link>
          <button type="button" disabled={busy} onClick={() => onWatched(s.id, first.key)} className={`${pill} border border-white/30 text-white hover:bg-white/10`}>
            <Check size={15} /> Mark watched
          </button>
        </div>
      </div>
    </div>
  );
}

function ShowTile({ s, actions }: { s: ShowCard; actions?: React.ReactNode }) {
  return (
    <div className="group flex flex-col">
      <Link href={watchHref(s.id, s.next?.key)} className="relative block">
        <PosterImg src={s.poster} title={s.title} kind={s.kind} className="transition group-hover:brightness-90" />
        {s.next?.playable && (
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">Plays here</span>
        )}
      </Link>
      <Link href={watchHref(s.id, s.next?.key)} className="mt-2 text-sm font-semibold leading-snug hover:underline">
        {s.title}
      </Link>
      <span className="text-[11px] text-gray-500">{[s.network, s.year?.slice(0, 4), s.kind === 'film' && minutesLabel(s.next?.minutes)].filter(Boolean).join(' · ')}</span>
      {s.why && <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-gray-600 dark:text-gray-400">{s.why}</p>}
      {actions && <div className="mt-2 flex flex-wrap gap-1.5">{actions}</div>}
    </div>
  );
}

function Section({ id, title, sub, right, children }: { id: string; title: string; sub?: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={id} className="text-xl font-bold tracking-tight">
            {title}
          </h2>
          {sub && <p className="mt-0.5 text-sm text-gray-600 dark:text-gray-400">{sub}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

export default function UnwindPage() {
  const [data, setData] = useState<UnwindView>();
  const [lib, setLib] = useState<LibraryState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [bucket, setBucket] = useState<Bucket>('30');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>();
  const [searching, setSearching] = useState(false);
  const [matching, setMatching] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [v, l] = await Promise.all([feedApi<UnwindView>('unwind'), feedApi<LibraryState>('unwind/library').catch(() => undefined)]);
      setData(v);
      setLib(l);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
    try {
      const b = localStorage.getItem(BUCKET_KEY) as Bucket | null;
      if (b && CHIPS.some((c) => c.value === b)) setBucket(b);
    } catch {
      /* Private window. */
    }
  }, [load]);
  const choose = (b: Bucket) => {
    setBucket(b);
    try {
      localStorage.setItem(BUCKET_KEY, b);
    } catch {
      /* Private window. */
    }
  };
  const act = async (path: string, body: unknown) => {
    setBusy(true);
    try {
      const v = await feedApi<UnwindView>(path, body);
      if (v && 'tonight' in v) setData(v);
      else await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rank = async (id: string, tier: 'S' | 'A' | 'B' | 'C') => {
    setBusy(true);
    try {
      await feedApi('ranking', { op: 'tier', id, tier });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    try {
      setHits(await feedApi<SearchHit[]>(`unwind/search?q=${encodeURIComponent(q.trim())}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSearching(false);
    }
  };
  const inUnwind = new Set(data ? [...data.continuing, ...data.deck, ...data.films, ...data.finished].map((s) => s.id) : []);
  const pick = data?.tonight[bucket];
  const chip = CHIPS.find((c) => c.value === bucket)!;

  return (
    <div className={`${serif.variable} min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100`}>
      <AppHeader title="Media" subtitle="Unwind" />
      <main className="mx-auto max-w-[1300px] px-4 pb-24 pt-6 sm:px-8 sm:pt-8">
        <section aria-labelledby="unwind-heading" className={`relative overflow-hidden rounded-3xl ${DUSK} px-5 py-6 text-white shadow-[0_30px_60px_-30px_rgba(40,10,60,.75)] sm:px-8 sm:py-8`}>
          <DuskSky />
          <div className="relative">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-medium">
              <Link href="/media" className="inline-flex items-center gap-1 text-white/65 hover:text-white">
                <ArrowLeft size={13} /> Media
              </Link>
              <Link href="/media/unwind/taste" className="text-white/85 hover:text-white">
                Taste card →
              </Link>
            </div>
            <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-pink-200/90">Unwind</p>
            <h1 id="unwind-heading" className="mt-1 font-[family-name:var(--font-instrument-serif)] text-[40px] leading-[1] sm:text-[54px]">
              Unwind <em className="text-[#ffc2a8]">in character.</em>
            </h1>
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <span className="text-sm text-white/85">Tonight I have</span>
              <div role="radiogroup" aria-label="Time tonight" className="flex flex-wrap gap-1.5">
                {CHIPS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    role="radio"
                    aria-checked={bucket === c.value}
                    onClick={() => choose(c.value)}
                    className={`${pill} min-h-[40px] ${bucket === c.value ? 'bg-white text-[#3b1f5e]' : 'border border-white/30 bg-white/10 text-white hover:bg-white/20'}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5">
              {!data ? (
                <p className="flex items-center gap-2 py-10 text-sm text-white/80">
                  <Loader2 size={16} className="animate-spin" /> Picking something…
                </p>
              ) : (
                pick && <Tonight pick={pick} kicker={chip.kicker} busy={busy} onWatched={(id, key) => void act('unwind/watched', { id, key, done: true })} />
              )}
            </div>
          </div>
        </section>

        {error && (
          <div role="alert" className="mt-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            {error}
            <button type="button" aria-label="Dismiss" onClick={() => setError('')}>
              <X size={15} />
            </button>
          </div>
        )}

        {data && data.counts.channelsToApprove > 0 && (
          <p className="mt-4 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 dark:border-violet-500/30 dark:bg-violet-500/10 dark:text-violet-200">
            OpenClaw found {data.counts.channelsToApprove} channel{data.counts.channelsToApprove === 1 ? '' : 's'} posting full episodes.{' '}
            <Link href="/media/unwind/taste#channels" className="font-semibold underline-offset-2 hover:underline">
              Approve or skip them
            </Link>
          </p>
        )}

        {data && data.continuing.length > 0 && (
          <Section id="continuing" title="Continue watching" sub="Where you left off. Plays here when the Journal has a source.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.continuing.map((s) => (
                <div key={s.id} className="flex gap-3.5 rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-gray-900">
                  <Link href={watchHref(s.id, s.next?.key)} className="w-[72px] shrink-0">
                    <PosterImg src={s.poster} title={s.title} kind={s.kind} />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <Link href={watchHref(s.id, s.next?.key)} className="truncate text-[15px] font-semibold hover:underline">
                      {s.title}
                    </Link>
                    <span className="truncate text-xs text-gray-600 dark:text-gray-400">
                      {s.next ? `Next: ${s.kind === 'film' ? (s.next.resumeAt ? `resume at ${clock(s.next.resumeAt)}` : 'the film') : s.next.label}` : 'All caught up'}
                    </span>
                    {s.kind === 'series' && <Progress watched={s.watched} total={s.total} className="mt-1" />}
                    <span className="text-[11px] text-gray-500">{[s.kind === 'series' && `${s.watched} of ${s.total}`, s.network].filter(Boolean).join(' · ')}</span>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <Link href={watchHref(s.id, s.next?.key)} className={`${outline} !px-2.5 !py-1.5 text-xs`}>
                        <Play size={13} /> {s.next?.playable ? 'Play next' : 'Next episode'}
                      </Link>
                      <button type="button" disabled={busy} onClick={() => void act('unwind/state', { id: s.id, state: 'paused' })} className={`${outline} !px-2.5 !py-1.5 text-xs`}>
                        <Pause size={13} /> Pause show
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {data && (
          <Section
            id="clips"
            title="Clips for in between"
            sub="Short and funny, picked against your taste card. Votes here only tune Unwind."
            right={
              <Link href="/media/feed?track=unwind" className="inline-flex items-center gap-1 text-sm font-semibold text-violet-700 hover:underline dark:text-violet-300">
                Open the clip stream <ArrowRight size={14} />
              </Link>
            }
          >
            {data.clips.length ? (
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
                {data.clips.map((c) => (
                  <Link key={c.id} href="/media/feed?track=unwind" className="group">
                    <span className="relative block overflow-hidden rounded-xl bg-gray-200 dark:bg-gray-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={c.youtube?.thumbnail || c.x?.media[0]?.preview || c.x?.author.avatar || ''} alt="" referrerPolicy="no-referrer" loading="lazy" className="aspect-video w-full object-cover transition group-hover:scale-[1.02]" />
                      {c.youtube?.durationSec && (
                        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 text-[11px] font-semibold text-white">{clock(c.youtube.durationSec)}</span>
                      )}
                    </span>
                    <span className="mt-2 line-clamp-2 block text-[13px] font-semibold leading-snug">{c.title || c.x?.text.slice(0, 90)}</span>
                    <span className="block text-xs text-gray-500">{c.creator.name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-gray-300 px-5 py-8 text-center text-sm text-gray-500 dark:border-white/10">
                No clips yet. OpenClaw judges your history against your taste card on its next pass.
              </p>
            )}
          </Section>
        )}

        {data && (
          <Section id="deck" title="On deck" sub="Shows picked for you. Start one and it moves up to Continue watching.">
            {data.deck.length ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                {data.deck.map((s) => (
                  <ShowTile
                    key={s.id}
                    s={s}
                    actions={
                      <button type="button" disabled={busy} onClick={() => void act('unwind/state', { id: s.id, state: 'dropped' })} className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">
                        Not for me
                      </button>
                    }
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-gray-300 px-5 py-8 text-center text-sm text-gray-500 dark:border-white/10">
                Nothing on deck yet. <Link href="/media/unwind/taste" className="font-semibold text-violet-700 hover:underline dark:text-violet-300">Calibrate your taste card</Link> or add a show below.
              </p>
            )}
          </Section>
        )}

        {data && data.films.length > 0 && (
          <Section id="films" title="Films for a long night">
            <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7">
              {data.films.map((s) => (
                <ShowTile
                  key={s.id}
                  s={s}
                  actions={
                    <button type="button" disabled={busy} onClick={() => void act('unwind/state', { id: s.id, state: 'dropped' })} className="text-xs font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200">
                      Not for me
                    </button>
                  }
                />
              ))}
            </div>
          </Section>
        )}

        {data && data.finished.length > 0 && (
          <Section id="finished" title="Just finished" sub="Where does it go? It joins your ranking and its score goes to IMDb, like your films.">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.finished.map((s) => (
                <div key={s.id} className="flex items-center gap-3.5 rounded-2xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-gray-900">
                  <div className="w-14 shrink-0">
                    <PosterImg src={s.poster} title={s.title} kind={s.kind} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{s.title}</p>
                    {s.ranked ? (
                      <p className="mt-1 text-xs text-gray-500">In your ranking.</p>
                    ) : (
                      <div className="mt-2 flex gap-1.5">
                        {(['S', 'A', 'B', 'C'] as const).map((t) => (
                          <button
                            key={t}
                            type="button"
                            disabled={busy}
                            onClick={() => void rank(s.id, t)}
                            aria-label={`Rank ${s.title} in tier ${t}`}
                            className={`h-11 w-11 rounded-xl text-base font-bold text-white ${t === 'S' ? 'bg-amber-600' : t === 'A' ? 'bg-violet-600' : t === 'B' ? 'bg-blue-600' : 'bg-gray-600'}`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section id="add" title="Add something" sub="A show or film you want in Unwind. It is checked against IMDb and TVmaze first.">
          <form onSubmit={search} className="flex max-w-xl gap-2">
            <label htmlFor="unwind-search" className="sr-only">
              Search shows and films
            </label>
            <input
              id="unwind-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Silicon Valley, 12th Fail…"
              className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-500/20 dark:border-white/10 dark:bg-gray-900"
            />
            <button type="submit" disabled={searching || q.trim().length < 2} className={primary}>
              {searching ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Search
            </button>
          </form>
          {hits && (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {hits.length === 0 && <li className="text-sm text-gray-500">Nothing found.</li>}
              {hits.map((h) => (
                <li key={h.id} className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-2.5 dark:border-white/10 dark:bg-gray-900">
                  <div className="w-10 shrink-0">
                    <PosterImg src={h.poster} title={h.title} kind={h.kind} className="!rounded-md" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{h.title}</p>
                    <p className="text-xs text-gray-500">{[h.kind === 'film' ? 'Film' : 'Series', h.year, h.network].filter(Boolean).join(' · ')}</p>
                  </div>
                  {matching ? (
                    <button
                      type="button"
                      disabled={busy}
                      className={`${outline} !px-2.5 !py-1.5 text-xs`}
                      onClick={() => {
                        const file = lib?.unmatched.find((f) => f.id === matching);
                        const g = file?.guess;
                        const key = h.kind === 'film' ? 'film' : g?.season !== undefined && g.number !== undefined ? `S${g.season}E${g.number}` : 'S1E1';
                        void act('unwind/match', { fileId: matching, id: h.id, key }).then(() => {
                          setMatching(undefined);
                          setHits(undefined);
                        });
                      }}
                    >
                      Match file
                    </button>
                  ) : inUnwind.has(h.id) ? (
                    <span className="text-xs text-gray-500">In Unwind</span>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => void act('unwind/add', { id: h.id })} className={`${outline} !px-2.5 !py-1.5 text-xs`}>
                      <Plus size={13} /> Add
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {lib && (lib.unmatched.length > 0 || lib.failed.length > 0 || lib.preparing > 0) && (
          <Section id="library" title="Your library" sub="Files in the library folder. The Journal matches them by name and makes them playable here.">
            {lib.preparing > 0 && (
              <p className="mb-3 flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                <Loader2 size={14} className="animate-spin" /> {lib.preparing} file{lib.preparing === 1 ? '' : 's'} being prepared.
              </p>
            )}
            <ul className="space-y-2">
              {lib.unmatched.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm dark:border-white/10 dark:bg-gray-900">
                  <FolderOpen size={16} className="shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.rel}</span>
                  <button
                    type="button"
                    className={`${outline} !px-2.5 !py-1.5 text-xs`}
                    onClick={() => {
                      setMatching(f.id);
                      setQ(f.guess?.title || '');
                      document.getElementById('unwind-search')?.focus();
                    }}
                  >
                    <Clapperboard size={13} /> {matching === f.id ? 'Search above to match' : 'Match to a title'}
                  </button>
                </li>
              ))}
              {lib.failed.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.rel}</span>
                  <span className="text-xs">{f.error?.slice(0, 120) || 'Could not be prepared.'}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </main>
    </div>
  );
}
