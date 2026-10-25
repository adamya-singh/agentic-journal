'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import * as Dialog from '@radix-ui/react-dialog';
import { Instrument_Serif } from 'next/font/google';
import { ArrowLeft, Compass, Keyboard, Loader2, Plus, Rows3, Sparkles, Tv, X } from 'lucide-react';
import { AppHeader } from '@/components/AppHeader';
import { SoundContext, togglePlayback } from '@/components/media/feed/Player';
import { FeedCardView, SourceMark } from '@/components/media/feed/FeedCard';
import { LearnedPanel } from '@/components/media/feed/LearnedPanel';
import { TheaterView } from '@/components/media/feed/TheaterView';
import { useFeed } from '@/components/media/feed/useFeed';
import { feedApi, shortDate, type CompassKind, type FeedCard, type FeedFilter, type FeedSource, type FeedSummary } from '@/components/media/feed/api';

const serif = Instrument_Serif({ weight: '400', style: ['normal', 'italic'], subsets: ['latin'], variable: '--font-instrument-serif' });

type View = 'stream' | 'theater';
const PREFS = 'media-feed:prefs';
const FEED_CSS = `@keyframes feedPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,.35)}50%{box-shadow:0 0 0 7px rgba(255,255,255,0)}}
@keyframes feedIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
.feed-in{animation:feedIn .45s cubic-bezier(.2,.7,.2,1) both}`;

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: React.ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-xl bg-gray-100 p-1 dark:bg-white/[0.06]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${value === o.value ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const SOURCES: { value: FeedSource | 'all'; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'x', label: 'Posts' },
  { value: 'imdb', label: 'Films' },
];
// Unwind's films and shows live on /media/unwind; its feed is clips and posts.
const UNWIND_SOURCES: { value: FeedSource | 'all'; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'youtube', label: 'Clips' },
  { value: 'x', label: 'Posts' },
];

export default function FeedPage() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>('stream');
  const [compass, setCompass] = useState<CompassKind>('long');
  const unwind = compass === 'taste';
  // The Pretrain compass to go back to when you leave Unwind.
  const lastPretrain = useRef<CompassKind>('long');
  const [filter, setFilter] = useState<FeedFilter>('queue');
  const [source, setSource] = useState<FeedSource | 'all'>('all');
  const [autoplay, setAutoplay] = useState(true);
  const [soundOn, setSoundOn] = useState(false);
  const [active, setActive] = useState<string>();
  const [theaterIndex, setTheaterIndex] = useState(0);
  const [learnedOpen, setLearnedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [link, setLink] = useState('');
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void }>();
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    if (compass !== 'taste') lastPretrain.current = compass;
    // Films are not part of Unwind's feed.
    else setSource((s) => (s === 'imdb' ? 'all' : s));
  }, [compass]);

  // Preferences: URL first, then what you used last time.
  useEffect(() => {
    let saved: Partial<{ view: View; compass: CompassKind; autoplay: boolean }> = {};
    try {
      saved = JSON.parse(localStorage.getItem(PREFS) || '{}');
    } catch {
      /* Private window. */
    }
    const p = new URLSearchParams(window.location.search);
    function pick<T extends string>(k: string, allowed: readonly T[], fallback: T, saved?: T): T {
      const v = p.get(k) as T | null;
      return v && allowed.includes(v) ? v : saved && allowed.includes(saved) ? saved : fallback;
    }
    setView(pick<View>('view', ['stream', 'theater'], 'stream', saved.view));
    setCompass(
      p.get('track') === 'unwind'
        ? 'taste'
        : pick<CompassKind>('compass', ['long', 'short'], 'long', saved.compass === 'taste' ? undefined : saved.compass),
    );
    setFilter(pick<FeedFilter>('filter', ['queue', 'voted', 'skipped'], 'queue'));
    setSource(pick<FeedSource | 'all'>('source', ['youtube', 'x', 'imdb', 'all'], 'all'));
    if (saved.autoplay === false) setAutoplay(false);
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const p = new URLSearchParams();
    if (view !== 'stream') p.set('view', view);
    if (compass === 'taste') p.set('track', 'unwind');
    else if (compass !== 'long') p.set('compass', compass);
    if (filter !== 'queue') p.set('filter', filter);
    if (source !== 'all') p.set('source', source);
    window.history.replaceState(null, '', `${window.location.pathname}${p.size ? `?${p}` : ''}`);
    try {
      localStorage.setItem(PREFS, JSON.stringify({ view, compass: lastPretrain.current, autoplay }));
    } catch {
      /* Private window. */
    }
  }, [ready, view, compass, filter, source, autoplay]);

  const feed = useFeed({ compass, filter, source: source === 'all' ? undefined : source });
  const { items, view: data, loading, loadingMore, hasMore, loadMore, setSummary, patch, markSeen } = feed;
  useEffect(() => {
    setActive(undefined);
    setTheaterIndex(0);
    window.scrollTo({ top: 0 });
  }, [compass, filter, source]);
  // A short-term compass that disappeared (or hasn't been judged yet) falls back to long-term.
  useEffect(() => {
    if (data && compass === 'short' && !data.compasses.short.usable) setCompass('long');
  }, [data, compass]);

  // ---- actions ----
  const showToast = useCallback((text: string, undo?: () => void) => {
    setToast({ text, undo });
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(undefined), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  const vote = useCallback(
    async (item: FeedCard, v: 'up' | 'down' | null, quiet = false) => {
      const was = item.state;
      patch(item.id, { state: v ?? 'seen' });
      try {
        setSummary(await feedApi<FeedSummary>('feed/vote', { id: item.id, vote: v, compass }));
        if (!quiet && v)
          showToast(v === 'up' ? 'More like this' : 'Less like this', () => void vote({ ...item, state: v }, was === 'up' || was === 'down' ? was : null, true));
      } catch (e) {
        patch(item.id, { state: was });
        feed.setError((e as Error).message);
      }
    },
    [compass, patch, setSummary, showToast, feed],
  );
  const skip = useCallback(
    async (item: FeedCard, undo = false) => {
      const was = item.state;
      patch(item.id, { state: undo ? 'seen' : 'skipped' });
      try {
        setSummary(await feedApi<FeedSummary>('feed/skip', { id: item.id, undo, compass }));
        if (!undo) showToast('Skipped', () => void skip({ ...item, state: 'skipped' }, true));
      } catch (e) {
        patch(item.id, { state: was });
        feed.setError((e as Error).message);
      }
    },
    [compass, patch, setSummary, showToast, feed],
  );
  const watchlist = useCallback(
    async (item: FeedCard) => {
      try {
        await feedApi('action', { action: 'watchlist', id: item.id });
        if (item.imdb) patch(item.id, { imdb: { ...item.imdb, watchlist: true } });
        showToast('Adding to your IMDb Watchlist');
      } catch (e) {
        feed.setError((e as Error).message);
      }
    },
    [patch, showToast, feed],
  );
  const addLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!link.trim()) return;
    setAdding(true);
    try {
      const r = await feedApi<{ added: boolean }>('feed/add', { url: link.trim(), track: unwind ? 'unwind' : 'pretrain' });
      showToast(r.added ? 'Added to your feed' : 'Already in your feed');
      setLink('');
      setAddOpen(false);
      void feed.reload();
    } catch (err) {
      feed.setError((err as Error).message);
    } finally {
      setAdding(false);
    }
  };

  // ---- stream: the card most in view is active (plays; counts as seen after a moment) ----
  const visible = useRef(new Map<string, number>());
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (view !== 'stream') return;
    const root = streamRef.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.feedId!;
          const h = Math.min(e.boundingClientRect.height, window.innerHeight);
          visible.current.set(id, h ? e.intersectionRect.height / h : 0);
        }
        let best: string | undefined,
          score = 0.6;
        const order = [...root.querySelectorAll<HTMLElement>('[data-feed-id]')].map((el) => el.dataset.feedId!);
        for (const id of order) {
          const r = visible.current.get(id) ?? 0;
          // Topmost wins a tie: on a tall screen several cards are fully in view.
          if (r > score || (r === score && best === undefined)) {
            best = id;
            score = r;
          }
        }
        if (best) setActive(best);
      },
      { threshold: [0, 0.25, 0.5, 0.6, 0.75, 0.9, 1] },
    );
    root.querySelectorAll('[data-feed-id]').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [view, items]);
  const activeId = view === 'theater' ? items[theaterIndex]?.id : active;
  useEffect(() => {
    if (!activeId || filter !== 'queue') return;
    const t = setTimeout(() => markSeen(activeId), 1500);
    return () => clearTimeout(t);
  }, [activeId, filter, markSeen]);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (view !== 'stream' || !el || !hasMore || loading) return;
    const io = new IntersectionObserver((e) => e[0]?.isIntersecting && void loadMore(), { rootMargin: '1200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [view, hasMore, loading, loadMore, items.length]);

  const shown = useMemo(() => items, [items]);
  const scrollToCard = (id?: string) => {
    if (!id) return;
    document.querySelector(`[data-feed-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const step = useCallback(
    (dir: 1 | -1) => {
      if (view === 'theater') {
        setTheaterIndex((i) => Math.max(0, Math.min(items.length - 1, i + dir)));
        return;
      }
      const live = items.filter((i) => i.state !== 'down' && i.state !== 'skipped');
      const at = live.findIndex((i) => i.id === active);
      const target = live[Math.max(0, Math.min(live.length - 1, at + dir))];
      if (target) {
        setActive(target.id);
        scrollToCard(target.id);
      }
    },
    [view, items, active],
  );
  // Stream: when a video ends, glide to the next card (autoplay).
  const onEnded = useCallback(() => {
    if (autoplay) step(1);
  }, [autoplay, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || t.isContentEditable || e.metaKey || e.ctrlKey || e.altKey) return;
      const item = items.find((i) => i.id === activeId);
      const k = e.key.toLowerCase();
      if (k === 'j' || e.key === 'ArrowDown') {
        if (view === 'stream' && e.key === 'ArrowDown') return;
        e.preventDefault();
        step(1);
      } else if (k === 'k' || (e.key === 'ArrowUp' && view === 'theater')) {
        e.preventDefault();
        step(-1);
      } else if (k === 'u' && item) void vote(item, item.state === 'up' ? null : 'up');
      else if (k === 'd' && item) {
        void vote(item, item.state === 'down' ? null : 'down');
        if (item.state !== 'down') setTimeout(() => step(1), 300);
      } else if (k === 's' && item) {
        void skip(item);
        setTimeout(() => step(1), 200);
      } else if (k === 'o' && item) window.open(item.url, '_blank', 'noopener');
      else if (k === 'm') setSoundOn((s) => !s);
      else if (k === 't') setView((v) => (v === 'stream' ? 'theater' : 'stream'));
      else if (e.key === ' ' && activeId) {
        e.preventDefault();
        togglePlayback();
      } else if (e.key === '?') setHelpOpen((h) => !h);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, activeId, view, step, vote, skip]);

  // Theater starts at the card you were looking at.
  const switchView = (v: View) => {
    if (v === 'theater') {
      const i = items.findIndex((x) => x.id === active);
      setTheaterIndex(Math.max(0, i));
    } else {
      setActive(items[theaterIndex]?.id);
      setTimeout(() => scrollToCard(items[theaterIndex]?.id), 50);
    }
    setView(v);
  };

  const summary = data?.summary;
  const compassInfo = data?.compasses[compass];
  const shortUsable = !!data?.compasses.short.usable;
  const period = compassInfo?.period?.start || compassInfo?.period?.end
    ? [compassInfo.period?.start && shortDate(compassInfo.period.start), compassInfo.period?.end && shortDate(compassInfo.period.end)].filter(Boolean).join(' – ')
    : undefined;
  const panel = data && summary ? <LearnedPanel summary={summary} compass={compass} compasses={data.compasses} /> : null;

  return (
    <SoundContext.Provider value={{ on: soundOn, set: setSoundOn }}>
      <style dangerouslySetInnerHTML={{ __html: FEED_CSS }} />
      <div className={`${serif.variable} min-h-screen bg-gray-50 text-gray-900 dark:bg-gray-950 dark:text-gray-100`}>
        <AppHeader title="Media" subtitle="Your feed" />
        <main className="mx-auto max-w-[1500px] px-4 pb-24 pt-6 sm:px-8 sm:pt-8">
          {/* Hero */}
          <div className={`relative mb-5 overflow-hidden rounded-3xl bg-gradient-to-br px-5 py-6 text-white sm:px-8 sm:py-8 ${unwind ? 'from-[#120a26] via-[#3b1d62] to-[#d9706a] shadow-[0_30px_60px_-30px_rgba(40,10,60,.75)]' : 'from-[#0b1730] via-[#1b3f6e] to-[#c9825a] shadow-[0_30px_60px_-30px_rgba(11,23,48,.7)]'}`}>
            <div aria-hidden className={`pointer-events-none absolute -bottom-28 -right-14 h-44 w-44 opacity-80 sm:-bottom-24 sm:right-24 sm:h-56 sm:w-56 sm:opacity-90 rounded-full blur-[1px] ${unwind ? 'sm:-bottom-36 bg-[radial-gradient(circle_at_50%_45%,#ffe2c4_0_24%,#ffab7a_48%,#e8606a_72%,transparent_74%)]' : 'bg-[radial-gradient(circle_at_50%_45%,#fff6d8_0_28%,#ffd27a_50%,#ff9a3c_75%,transparent_76%)]'}`} />
            {unwind && <div aria-hidden className="pointer-events-none absolute right-10 top-8 h-6 w-6 rounded-full shadow-[7px_-5px_0_0_#f6e7c8] sm:right-28" />}
            <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(1px_1px_at_12%_22%,rgba(255,255,255,.9),transparent_60%),radial-gradient(1px_1px_at_32%_12%,rgba(255,255,255,.7),transparent_60%),radial-gradient(1.5px_1.5px_at_58%_30%,rgba(255,255,255,.8),transparent_60%),radial-gradient(1px_1px_at_76%_16%,rgba(255,255,255,.6),transparent_60%),radial-gradient(1px_1px_at_88%_40%,rgba(255,255,255,.7),transparent_60%)]" />
            <div className="relative max-w-3xl">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <Link href={unwind ? '/media/unwind' : '/media'} className="inline-flex items-center gap-1 text-xs font-medium text-white/60 hover:text-white">
                  <ArrowLeft size={13} /> {unwind ? 'Unwind' : 'Media'}
                </Link>
                <div role="radiogroup" aria-label="Track" className="inline-flex rounded-full border border-white/20 bg-white/10 p-1 backdrop-blur">
                  {(['pretrain', 'unwind'] as const).map((t) => {
                    const on = (t === 'unwind') === unwind;
                    return (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setCompass(t === 'unwind' ? 'taste' : lastPretrain.current)}
                        className={`rounded-full px-4 py-1.5 text-[13px] font-semibold transition ${on ? (t === 'unwind' ? 'bg-white text-[#3b1f5e]' : 'bg-white text-[#0b1730]') : 'text-white/75 hover:text-white'}`}
                      >
                        {t === 'unwind' ? 'Unwind' : 'Pretrain'}
                      </button>
                    );
                  })}
                </div>
              </div>
              <p className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${unwind ? 'text-pink-200/90' : 'text-amber-200/90'}`}>{unwind ? 'Your feed · Unwind' : 'Your feed'}</p>
              <h2 className="mt-1.5 font-[family-name:var(--font-instrument-serif)] text-[38px] leading-[1] sm:text-[52px]">
                {unwind ? (
                  <>Unwind <em className="text-[#ffc2a8]">in character.</em></>
                ) : (
                  <>Pretrain <em className="text-[#ffd27a]">on purpose.</em></>
                )}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/75">
                {unwind ? (
                  <>
                    Tuned to your taste card: <span className="text-white/90">{compassInfo?.excerpt.slice(0, 150)}{(compassInfo?.excerpt.length ?? 0) > 150 ? '…' : ''}</span>{' '}
                    <Link href="/media/unwind/taste" className="font-semibold text-[#ffc2a8] underline-offset-2 hover:underline">Edit it</Link>
                  </>
                ) : compassInfo?.available ? (
                  <>
                    Tuned to your {compass === 'long' ? 'long-term' : 'short-term'} compass{period ? ` (${period})` : ''}: <span className="text-white/90">{compassInfo.excerpt.slice(0, 150)}{compassInfo.excerpt.length > 150 ? '…' : ''}</span>
                  </>
                ) : (
                  'Only what moves you toward who you want to be. Vote things up or down and the feed learns.'
                )}
              </p>
              {summary && (
                <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/60">
                  <span><span className="font-semibold text-white">{summary.counts.queue[compass]}</span> waiting</span>
                  <span><span className="font-semibold text-emerald-300">{summary.learned.ups}</span> up · <span className="font-semibold text-rose-300">{summary.learned.downs}</span> down</span>
                  {summary.curator.addedToday > 0 && <span><span className={`font-semibold ${unwind ? 'text-pink-200' : 'text-amber-200'}`}>{summary.curator.addedToday}</span> new from OpenClaw today</span>}
                </p>
              )}
            </div>
          </div>

          {/* Controls */}
          <div className="sticky top-0 z-30 -mx-4 mb-5 border-b border-gray-200/70 bg-gray-50/85 px-4 py-2.5 backdrop-blur-xl sm:-mx-8 sm:px-8 dark:border-white/[0.06] dark:bg-gray-950/85">
            <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <Segmented
                label="View"
                value={view}
                onChange={switchView}
                options={[
                  { value: 'stream', label: <><Rows3 size={14} /> Stream</> },
                  { value: 'theater', label: <><Tv size={14} /> Theater</> },
                ]}
              />
              {!unwind && <Segmented
                label="Compass"
                value={compass}
                onChange={setCompass}
                options={[
                  { value: 'long', label: <><Compass size={14} /> Long-term</> },
                  {
                    value: 'short',
                    label: 'Short-term',
                    disabled: !shortUsable,
                    title: shortUsable ? undefined : data?.compasses.short.available ? 'OpenClaw hasn’t judged the feed against it yet' : 'No short-term compass yet',
                  },
                ]}
              />}
              <Segmented
                label="Show"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'queue', label: 'For you' },
                  { value: 'voted', label: 'Voted' },
                  { value: 'skipped', label: 'Skipped' },
                ]}
              />
              <div className="flex shrink-0 gap-1">
                {(unwind ? UNWIND_SOURCES : SOURCES).map((s) => (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSource(s.value)}
                    aria-pressed={source === s.value}
                    className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition ${source === s.value ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900' : 'text-gray-600 hover:bg-gray-200/70 dark:text-gray-400 dark:hover:bg-white/[0.06]'}`}
                  >
                    {s.value !== 'all' && <SourceMark source={s.value} className={source === s.value ? '' : s.value === 'x' ? 'text-gray-800 dark:text-gray-200' : ''} />}
                    {s.label}
                  </button>
                ))}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1 pl-2">
                <button type="button" onClick={() => setAddOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-semibold text-gray-600 hover:bg-gray-200/70 dark:text-gray-300 dark:hover:bg-white/[0.06]">
                  <Plus size={15} /> Add
                </button>
                <button
                  type="button"
                  onClick={() => setLearnedOpen(true)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[13px] font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10 ${view === 'stream' ? 'lg:hidden' : ''}`}
                >
                  <Sparkles size={15} /> Learned
                </button>
                <button type="button" onClick={() => setHelpOpen((h) => !h)} aria-label="Keyboard shortcuts" className="hidden rounded-xl p-2 text-gray-400 hover:bg-gray-200/70 hover:text-gray-700 sm:inline-flex dark:hover:bg-white/[0.06] dark:hover:text-gray-200">
                  <Keyboard size={16} />
                </button>
              </div>
            </div>
            {addOpen && (
              <form onSubmit={addLink} className="mt-2.5 flex gap-2">
                <input
                  autoFocus
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="Paste a YouTube, X or IMDb link"
                  className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 dark:border-white/10 dark:bg-gray-900"
                />
                <button type="submit" disabled={adding || !link.trim()} className="inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
                  {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add
                </button>
              </form>
            )}
            {helpOpen && (
              <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                {[['J / K', 'next / previous'], ['U', 'up'], ['D', 'down'], ['S', 'skip'], ['M', 'sound'], ['Space', 'play / pause'], ['O', 'open'], ['T', 'stream / theater']].map(([k, v]) => (
                  <span key={k}><kbd className="rounded border border-b-2 border-gray-300 bg-white px-1.5 font-sans text-[11px] font-semibold text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200">{k}</kbd> {v}</span>
                ))}
              </p>
            )}
          </div>

          {feed.error && (
            <div role="alert" className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
              {feed.error}
              <button type="button" aria-label="Dismiss" onClick={() => feed.setError('')}><X size={15} /></button>
            </div>
          )}

          {loading && !items.length ? (
            <div className="mx-auto max-w-2xl space-y-4">
              {[0, 1].map((i) => (
                <div key={i} className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white dark:border-white/[0.07] dark:bg-gray-900">
                  <div className="flex items-center gap-3 p-4"><div className="h-9 w-9 animate-pulse rounded-full bg-gray-200 dark:bg-gray-800" /><div className="h-3 w-40 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></div>
                  <div className="aspect-video animate-pulse bg-gray-100 dark:bg-gray-800/60" />
                  <div className="space-y-2 p-4"><div className="h-3 w-3/4 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /><div className="h-3 w-1/2 animate-pulse rounded bg-gray-200 dark:bg-gray-800" /></div>
                </div>
              ))}
            </div>
          ) : !items.length ? (
            <div className="mx-auto max-w-xl rounded-3xl border border-dashed border-gray-300 px-6 py-14 text-center dark:border-white/10">
              <p className="font-[family-name:var(--font-instrument-serif)] text-3xl">
                {filter === 'queue' ? (summary && summary.counts.up + summary.counts.down > 0 ? 'You’re all caught up.' : 'Your feed is being filled.') : filter === 'voted' ? 'Nothing voted yet.' : 'Nothing skipped.'}
              </p>
              <p className="mt-2 text-sm text-gray-500">
                {filter === 'queue' ? 'OpenClaw looks for more every morning. Paste a link with Add to put something in yourself.' : 'Votes and skips from the feed show up here.'}
              </p>
            </div>
          ) : view === 'theater' ? (
            <TheaterView
              items={shown}
              index={Math.min(theaterIndex, shown.length - 1)}
              setIndex={setTheaterIndex}
              onVote={(i, v) => void vote(i, v)}
              onSkip={(i) => void skip(i)}
              onWatchlist={(i) => void watchlist(i)}
              autoplay={autoplay}
              setAutoplay={setAutoplay}
              hasMore={hasMore}
              loadingMore={loadingMore}
              loadMore={() => void loadMore()}
            />
          ) : (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
              <div ref={streamRef} className="mx-auto w-full max-w-[680px] space-y-5">
                {shown.map((item, i) => (
                  <div key={item.id} className="feed-in" style={{ animationDelay: `${Math.min(i % 12, 6) * 40}ms` }}>
                    <FeedCardView
                      item={item}
                      active={item.id === active}
                      onActivate={() => setActive(item.id)}
                      onVote={(v) => void vote(item, v)}
                      onSkip={(undo) => void skip(item, undo)}
                      onEnded={onEnded}
                      onWatchlist={() => void watchlist(item)}
                    />
                  </div>
                ))}
                <div ref={sentinel} className="h-1" />
                {loadingMore && <p className="flex justify-center py-6 text-gray-400"><Loader2 size={20} className="animate-spin" /></p>}
                {!hasMore && items.length > 0 && (
                  <p className="py-8 text-center font-[family-name:var(--font-instrument-serif)] text-xl text-gray-400">
                    {filter === 'queue' ? 'That’s everything for now.' : 'That’s all of them.'}
                  </p>
                )}
              </div>
              <aside className="hidden lg:block">
                <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pb-6 [scrollbar-width:thin]">{panel}</div>
              </aside>
            </div>
          )}
        </main>

        <Dialog.Root open={learnedOpen} onOpenChange={setLearnedOpen}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" />
            <Dialog.Content className={`${serif.variable} fixed inset-x-0 bottom-0 z-50 max-h-[88vh] overflow-y-auto rounded-t-3xl bg-gray-50 p-4 pb-8 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:max-h-[calc(100vh-2rem)] sm:w-[380px] sm:rounded-3xl dark:bg-gray-950`}>
              <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300 sm:hidden dark:bg-gray-700" />
              <div className="mb-3 flex items-center justify-between">
                <Dialog.Title className="text-base font-semibold">Your feed</Dialog.Title>
                <Dialog.Close className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-800" aria-label="Close"><X size={16} /></Dialog.Close>
              </div>
              <Dialog.Description className="sr-only">Compass, what your votes taught the feed, and OpenClaw’s last pass.</Dialog.Description>
              {panel}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        {toast && (
          <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 whitespace-nowrap rounded-full bg-gray-900 px-4 py-2.5 text-sm text-white shadow-xl dark:bg-white dark:text-gray-900">
            {toast.text}
            {toast.undo && (
              <button
                type="button"
                className="font-semibold text-indigo-300 dark:text-indigo-600"
                onClick={() => {
                  toast.undo?.();
                  setToast(undefined);
                }}
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>
    </SoundContext.Provider>
  );
}
