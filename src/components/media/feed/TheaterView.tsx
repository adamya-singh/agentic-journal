'use client';

import React, { useEffect, useRef } from 'react';
import { Folder, Loader2, Play } from 'lucide-react';
import { ClipPlayer, YouTubePlayer } from './Player';
import { Avatar, ImdbHero, SourceMark, Tags, VoteBar, WhyLine, XMedia, context } from './FeedCard';
import { clock, type FeedCard } from './api';

function Thumb({ item }: { item: FeedCard }) {
  const img =
    item.youtube?.thumbnail.replace('hqdefault', 'mqdefault') ||
    item.imdb?.poster ||
    item.x?.media.find((m) => m.preview || m.url)?.preview ||
    item.x?.media.find((m) => m.url)?.url;
  return (
    <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-gray-100 sm:w-40 dark:bg-gray-800">
      {img ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={img} alt="" referrerPolicy="no-referrer" loading="lazy" className={`h-full w-full ${item.imdb ? 'object-cover object-top' : 'object-cover'}`} />
      ) : (
        <p className="line-clamp-4 p-2 text-[10px] leading-snug text-gray-500">{item.x?.text}</p>
      )}
      {item.youtube?.durationSec && (
        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] font-medium text-white">{clock(item.youtube.durationSec)}</span>
      )}
      <span className="absolute left-1 top-1 rounded bg-white/90 p-0.5 dark:bg-black/70"><SourceMark source={item.source} className="!h-3 !w-3.5" /></span>
    </div>
  );
}

export function TheaterView({
  items,
  index,
  setIndex,
  onVote,
  onSkip,
  onWatchlist,
  autoplay,
  setAutoplay,
  hasMore,
  loadingMore,
  loadMore,
}: {
  items: FeedCard[];
  index: number;
  setIndex: (i: number) => void;
  onVote: (item: FeedCard, v: 'up' | 'down' | null) => void;
  onSkip: (item: FeedCard) => void;
  onWatchlist: (item: FeedCard) => void;
  autoplay: boolean;
  setAutoplay: (on: boolean) => void;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
}) {
  const item = items[index];
  const upNext = items.slice(index + 1).filter((i) => i.state !== 'down' && i.state !== 'skipped');
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const o = new IntersectionObserver((e) => e[0]?.isIntersecting && loadMore(), { rootMargin: '600px' });
    o.observe(el);
    return () => o.disconnect();
  }, [hasMore, loadMore, items.length]);
  // Keep a few items queued ahead of the stage.
  useEffect(() => {
    if (hasMore && items.length - index < 6) loadMore();
  }, [index, items.length, hasMore, loadMore]);
  if (!item) return null;
  const next = () => {
    const i = items.findIndex((x, j) => j > index && x.state !== 'down' && x.state !== 'skipped');
    if (i >= 0) setIndex(i);
  };
  const video = item.x?.media.find((m) => (m.type === 'video' || m.type === 'animated_gif') && (m.localUrl || m.video));
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0">
        <div className={`overflow-hidden rounded-2xl bg-gray-950 shadow-[0_30px_80px_-40px_rgba(15,23,42,.8)] ring-1 ring-black/5 dark:ring-white/10 ${item.youtube || video ? 'sticky top-0 z-20 lg:static' : ''}`}>
          {item.youtube ? (
            <YouTubePlayer key={item.id} videoId={item.youtube.videoId} thumbnail={item.youtube.thumbnail} active title={item.title} url={item.url} short={item.youtube.short} onEnded={() => autoplay && next()} />
          ) : video ? (
            <ClipPlayer key={item.id} src={video.localUrl || video.video!} poster={video.preview} active gif={video.type === 'animated_gif'} label="Saved video" onEnded={() => autoplay && next()} aspect={video.width && video.height ? video.width / video.height : undefined} />
          ) : item.imdb ? (
            <ImdbHero item={item} />
          ) : (
            <div className="flex min-h-[260px] items-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-6 py-10 sm:px-12">
              <div className="mx-auto max-w-2xl">
                <p className="whitespace-pre-wrap font-[family-name:var(--font-instrument-serif)] text-2xl leading-snug text-white sm:text-[32px] sm:leading-tight">{item.x?.text}</p>
                {item.x && <XMedia item={item} active onActivate={() => {}} />}
              </div>
            </div>
          )}
        </div>
        <div className="mt-4 flex items-start gap-3">
          <Avatar item={item} />
          <div className="min-w-0 flex-1">
            {item.source === 'youtube' && <h2 className="text-lg font-semibold leading-snug sm:text-xl">{item.title}</h2>}
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {item.creator.name} · {context(item)}
            </p>
            {item.x && item.x.folders.length > 0 && (
              <p className="mt-1 flex gap-3 text-[11px] text-gray-400">{item.x.folders.map((f) => <span key={f} className="inline-flex items-center gap-1"><Folder size={11} />{f}</span>)}</p>
            )}
          </div>
        </div>
        {item.x && video && <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed">{item.x.text}</p>}
        <WhyLine item={item} className="mt-3" />
        <div className="mt-2.5"><Tags tags={item.tags} /></div>
        <VoteBar
          item={item}
          className="mt-3 rounded-2xl border border-gray-200/80 bg-white px-2 py-1.5 dark:border-white/[0.07] dark:bg-gray-900"
          onVote={(v) => {
            onVote(item, v);
            if (v === 'down') setTimeout(next, 350);
          }}
          onSkip={() => {
            onSkip(item);
            setTimeout(next, 200);
          }}
          extra={
            item.imdb && !item.imdb.watchlist ? (
              <button type="button" onClick={() => onWatchlist(item)} className="inline-flex h-11 items-center rounded-xl px-3 text-sm font-semibold text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5">
                Watchlist
              </button>
            ) : null
          }
        />
      </div>

      <aside className="min-w-0">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Up next</h3>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-gray-500">
            Autoplay
            <button
              type="button"
              role="switch"
              aria-checked={autoplay}
              onClick={() => setAutoplay(!autoplay)}
              className={`relative h-5 w-9 rounded-full transition ${autoplay ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-700'}`}
            >
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${autoplay ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
          </label>
        </div>
        <ol className="space-y-1">
          {upNext.map((x) => {
            const i = items.indexOf(x);
            return (
              <li key={x.id}>
                <div className={`group flex w-full gap-3 rounded-xl p-1.5 transition hover:bg-white dark:hover:bg-white/[0.04] ${x.state === 'up' ? 'ring-1 ring-emerald-300/70 dark:ring-emerald-500/30' : ''}`}>
                  <button type="button" onClick={() => setIndex(i)} className="relative shrink-0" aria-label={`Play ${x.title}`}>
                    <Thumb item={x} />
                    <span className="absolute inset-0 hidden items-center justify-center rounded-lg bg-black/30 text-white group-hover:flex"><Play size={20} fill="currentColor" /></span>
                  </button>
                  <div className="min-w-0 flex-1 py-0.5">
                    <button type="button" onClick={() => setIndex(i)} className="line-clamp-2 text-left text-[13px] font-semibold leading-snug">{x.title}</button>
                    <p className="mt-0.5 truncate text-xs text-gray-500">{x.creator.name}</p>
                    {x.why && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-indigo-600/80 dark:text-indigo-300/80">{x.why}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
        <div ref={sentinel} className="h-1" />
        {loadingMore && <p className="flex justify-center py-4 text-gray-400"><Loader2 size={18} className="animate-spin" /></p>}
        {!hasMore && upNext.length === 0 && <p className="py-6 text-center text-sm text-gray-500">That’s everything for now. OpenClaw adds more each morning.</p>}
      </aside>
    </div>
  );
}
