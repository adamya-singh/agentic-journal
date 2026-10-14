'use client';

import React from 'react';
import {
  ArrowBigDown,
  ArrowBigUp,
  Bookmark,
  Clapperboard,
  ExternalLink,
  Folder,
  Link2,
  RotateCcw,
  SkipForward,
  Sparkles,
  Star,
} from 'lucide-react';
import { ClipPlayer, YouTubePlayer } from './Player';
import { addedByLabel, ago, clock, shortDate, type FeedCard } from './api';

const AVATAR = ['bg-indigo-500', 'bg-teal-600', 'bg-amber-600', 'bg-rose-600', 'bg-sky-600', 'bg-violet-600', 'bg-emerald-600', 'bg-orange-600'];
const avatarColor = (key: string) => AVATAR[[...key].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % AVATAR.length];

export function SourceMark({ source, className = '' }: { source: FeedCard['source']; className?: string }) {
  if (source === 'youtube')
    return (
      <span aria-label="YouTube" className={`relative inline-block h-3.5 w-5 shrink-0 rounded-[4px] bg-red-600 after:absolute after:left-1/2 after:top-1/2 after:-translate-x-[35%] after:-translate-y-1/2 after:border-y-[3.5px] after:border-l-[6px] after:border-y-transparent after:border-l-white after:content-[''] ${className}`} />
    );
  if (source === 'x')
    return (
      <svg aria-label="X" viewBox="0 0 24 24" className={`h-3.5 w-3.5 shrink-0 fill-current ${className}`}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
      </svg>
    );
  return <Clapperboard aria-label="Film" size={15} className={`shrink-0 text-amber-500 ${className}`} />;
}

export function Avatar({ item }: { item: FeedCard }) {
  if (item.x?.author.avatar)
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={item.x.author.avatar.replace('_normal.', '_bigger.')} alt="" referrerPolicy="no-referrer" className="h-9 w-9 shrink-0 rounded-full bg-gray-200 object-cover dark:bg-gray-800" />
    );
  if (item.source === 'imdb')
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-400 text-[11px] font-black tracking-tight text-amber-950">IMDb</span>
    );
  return (
    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ${avatarColor(item.creator.key)}`}>
      {item.creator.name.replace(/^@/, '').charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function context(item: FeedCard) {
  if (item.youtube) {
    const y = item.youtube;
    const bits = [y.durationSec ? clock(y.durationSec) : y.short ? 'Short' : ''];
    if (y.inHistory && y.watchedDay)
      bits.push(y.progress !== undefined && y.progress < 0.9 ? `${Math.round(y.progress * 100)}% watched ${shortDate(y.watchedDay)}` : `watched ${shortDate(y.watchedDay)}`);
    else bits.push('new for you');
    return bits.filter(Boolean).join(' · ');
  }
  if (item.x) return [item.x.author.username && `@${item.x.author.username}`, item.publishedAt && shortDate(item.publishedAt)].filter(Boolean).join(' · ');
  if (item.imdb) return [item.imdb.type, item.imdb.year].filter(Boolean).join(' · ');
  return '';
}

export function WhyLine({ item, className = '' }: { item: FeedCard; className?: string }) {
  if (!item.why && !item.learned) return null;
  return (
    <div className={`flex gap-2.5 rounded-xl bg-gradient-to-br from-indigo-50 via-indigo-50/60 to-amber-50/70 px-3 py-2.5 text-[13px] leading-relaxed text-gray-700 ring-1 ring-inset ring-indigo-100/70 dark:from-indigo-500/[0.12] dark:via-indigo-500/[0.06] dark:to-amber-400/[0.06] dark:text-gray-300 dark:ring-white/[0.06] ${className}`}>
      <Sparkles size={15} className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-300" />
      <p className="min-w-0">
        {item.why}
        {item.learned && <span className="block text-[12px] text-gray-500 dark:text-gray-400">{item.learned}</span>}
      </p>
    </div>
  );
}

export function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t} className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-white/[0.06] dark:text-gray-400">
          {t}
        </span>
      ))}
    </div>
  );
}

const voteBtn =
  'inline-flex h-11 items-center justify-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500';
export function VoteBar({
  item,
  onVote,
  onSkip,
  extra,
  className = '',
}: {
  item: FeedCard;
  onVote: (v: 'up' | 'down' | null) => void;
  onSkip?: () => void;
  extra?: React.ReactNode;
  className?: string;
}) {
  const up = item.state === 'up',
    down = item.state === 'down';
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        aria-pressed={up}
        title="More like this (U)"
        onClick={() => onVote(up ? null : 'up')}
        className={`${voteBtn} ${up ? 'bg-emerald-500 text-white shadow-[0_6px_16px_-6px_rgba(16,185,129,.7)] hover:bg-emerald-600' : 'text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 dark:text-gray-200 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300'}`}
      >
        <ArrowBigUp size={21} fill={up ? 'currentColor' : 'none'} /> Up
      </button>
      <button
        type="button"
        aria-pressed={down}
        title="Less like this (D)"
        onClick={() => onVote(down ? null : 'down')}
        className={`${voteBtn} ${down ? 'bg-rose-500 text-white hover:bg-rose-600' : 'text-gray-700 hover:bg-rose-50 hover:text-rose-700 dark:text-gray-200 dark:hover:bg-rose-500/10 dark:hover:text-rose-300'}`}
      >
        <ArrowBigDown size={21} fill={down ? 'currentColor' : 'none'} /> Down
      </button>
      <div className="ml-auto flex items-center gap-0.5">
        {extra}
        {onSkip && item.state !== 'up' && item.state !== 'down' && (
          <button type="button" title="Skip (S)" aria-label="Skip" onClick={onSkip} className={`${voteBtn} !px-3 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5`}>
            <SkipForward size={17} />
          </button>
        )}
        <a href={item.x ? item.url : item.url} target="_blank" rel="noopener noreferrer" title="Open (O)" aria-label="Open in a new tab" className={`${voteBtn} !px-3 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5`}>
          <ExternalLink size={17} />
        </a>
      </div>
    </div>
  );
}

export function XMedia({ item, active, onActivate, onEnded }: { item: FeedCard; active: boolean; onActivate: () => void; onEnded?: () => void }) {
  const media = item.x!.media;
  const video = media.find((m) => m.type === 'video' || m.type === 'animated_gif');
  if (video && (video.localUrl || video.video))
    return (
      <div className="mt-3 overflow-hidden rounded-xl ring-1 ring-black/5 dark:ring-white/10">
        <ClipPlayer
          src={video.localUrl || video.video!}
          poster={video.preview}
          active={active}
          gif={video.type === 'animated_gif'}
          label={video.alt || 'Saved video'}
          onActivate={onActivate}
          onEnded={onEnded}
          aspect={video.width && video.height ? video.width / video.height : undefined}
        />
      </div>
    );
  const photos = media.filter((m) => m.type === 'photo' && m.url).slice(0, 4);
  if (photos.length)
    return (
      <div className={`mt-3 grid gap-1 overflow-hidden rounded-xl ring-1 ring-black/5 dark:ring-white/10 ${photos.length > 1 ? 'grid-cols-2' : ''}`}>
        {photos.map((p, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={p.url}
            alt={p.alt || ''}
            referrerPolicy="no-referrer"
            loading="lazy"
            className={`w-full bg-gray-100 object-cover dark:bg-gray-800 ${photos.length === 1 ? 'max-h-[560px]' : photos.length === 3 && i === 0 ? 'row-span-2 h-full' : 'aspect-square'}`}
          />
        ))}
      </div>
    );
  const link = item.x!.links.find((l) => l.title);
  if (link)
    return (
      <a href={link.url} target="_blank" rel="noopener noreferrer" className="mt-3 block overflow-hidden rounded-xl ring-1 ring-black/10 transition hover:bg-gray-50 dark:ring-white/10 dark:hover:bg-white/[0.03]">
        {link.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={link.image} alt="" referrerPolicy="no-referrer" loading="lazy" className="max-h-64 w-full object-cover" />
        )}
        <div className="px-3.5 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] text-gray-500"><Link2 size={11} /> {link.domain}</p>
          <p className="mt-0.5 text-sm font-semibold leading-snug">{link.title}</p>
          {link.description && <p className="mt-0.5 line-clamp-2 text-xs text-gray-500">{link.description}</p>}
        </div>
      </a>
    );
  return null;
}

export function ImdbHero({ item }: { item: FeedCard }) {
  const m = item.imdb!;
  return (
    <div className="relative overflow-hidden bg-gray-900">
      {m.poster && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={m.poster} alt="" aria-hidden referrerPolicy="no-referrer" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-50 blur-2xl" />
      )}
      <div className="relative flex gap-4 p-4 sm:gap-5 sm:p-5">
        {m.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.poster} alt={`${item.title} poster`} referrerPolicy="no-referrer" className="aspect-[2/3] w-28 shrink-0 rounded-lg object-cover shadow-2xl ring-1 ring-white/20 sm:w-36" />
        )}
        <div className="min-w-0 self-end text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-300">{m.type || 'Film'}{m.year ? ` · ${m.year}` : ''}</p>
          <h3 className="mt-1 font-[family-name:var(--font-instrument-serif)] text-[28px] leading-[1.05] sm:text-[34px]">{item.title}</h3>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/75">
            {m.imdbRating && (
              <span className="inline-flex items-center gap-1 font-semibold text-amber-300"><Star size={12} fill="currentColor" /> {m.imdbRating}</span>
            )}
            {m.genres.slice(0, 4).join(' · ')}
          </p>
        </div>
      </div>
    </div>
  );
}

export function FeedCardView({
  item,
  active,
  onActivate,
  onVote,
  onSkip,
  onEnded,
  onWatchlist,
}: {
  item: FeedCard;
  active: boolean;
  onActivate: () => void;
  onVote: (v: 'up' | 'down' | null) => void;
  onSkip: (undo?: boolean) => void;
  onEnded?: () => void;
  onWatchlist?: () => void;
}) {
  if (item.state === 'down' || item.state === 'skipped')
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-white/10">
        <SourceMark source={item.source} />
        <span className="min-w-0 flex-1 truncate">
          {item.state === 'down' ? 'Less like this: ' : 'Skipped: '}
          <span className="text-gray-700 dark:text-gray-300">{item.title}</span>
        </span>
        <button type="button" onClick={() => (item.state === 'down' ? onVote(null) : onSkip(true))} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-500/10">
          <RotateCcw size={13} /> Undo
        </button>
      </div>
    );
  return (
    <article
      data-feed-id={item.id}
      className={`overflow-hidden rounded-2xl border bg-white transition-shadow duration-300 dark:bg-gray-900 ${active ? 'border-indigo-200 shadow-[0_18px_50px_-24px_rgba(79,70,229,.45)] dark:border-indigo-400/30' : 'border-gray-200/80 shadow-[0_1px_2px_rgba(16,24,40,.04),0_10px_30px_-22px_rgba(16,24,40,.25)] dark:border-white/[0.07]'} ${item.state === 'up' ? '!border-emerald-300 dark:!border-emerald-500/40' : ''}`}
    >
      <header className="flex items-center gap-3 px-4 pb-3 pt-3.5">
        <Avatar item={item} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold leading-tight">{item.creator.name}</p>
          <p className="truncate text-xs text-gray-500 dark:text-gray-400">{context(item)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px] text-gray-400">
          <span className="hidden sm:inline" title={new Date(item.addedAt).toLocaleString()}>{addedByLabel(item.addedBy)}{item.addedBy === 'openclaw' ? ` · ${ago(item.addedAt)}` : ''}</span>
          <SourceMark source={item.source} className={item.source === 'x' ? 'text-gray-900 dark:text-gray-100' : ''} />
        </div>
      </header>

      {item.youtube && (
        <YouTubePlayer
          videoId={item.youtube.videoId}
          thumbnail={item.youtube.thumbnail}
          active={active}
          title={item.title}
          url={item.url}
          short={item.youtube.short}
          onEnded={onEnded}
          onActivate={onActivate}
        />
      )}
      {item.imdb && <ImdbHero item={item} />}

      <div className="px-4 pb-1 pt-3.5">
        {item.youtube && (
          <a href={item.url} target="_blank" rel="noopener noreferrer" className="block text-[15px] font-semibold leading-snug hover:text-indigo-600 sm:text-base dark:hover:text-indigo-300">
            {item.title}
          </a>
        )}
        {item.x && (
          <>
            <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed sm:text-base">{item.x.text}</p>
            <XMedia item={item} active={active} onActivate={onActivate} onEnded={onEnded} />
            {item.x.folders.length > 0 && (
              <p className="mt-2.5 flex flex-wrap gap-x-3 text-[11px] text-gray-400">
                {item.x.folders.map((f) => (
                  <span key={f} className="inline-flex items-center gap-1"><Folder size={11} /> {f}</span>
                ))}
              </p>
            )}
          </>
        )}
        <WhyLine item={item} className="mt-3" />
        <div className="mt-2.5"><Tags tags={item.tags} /></div>
      </div>
      <VoteBar
        item={item}
        onVote={onVote}
        onSkip={() => onSkip()}
        className="border-t border-gray-100 px-2 py-1.5 sm:px-3 dark:border-white/[0.06]"
        extra={
          item.imdb ? (
            <>
              <button
                type="button"
                onClick={onWatchlist}
                disabled={item.imdb.watchlist}
                title={item.imdb.watchlist ? 'On your IMDb Watchlist' : 'Add to your IMDb Watchlist'}
                className={`${voteBtn} !px-3 text-gray-500 hover:bg-gray-100 disabled:text-amber-500 dark:text-gray-400 dark:hover:bg-white/5`}
              >
                <Bookmark size={17} fill={item.imdb.watchlist ? 'currentColor' : 'none'} />
              </button>
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${item.title} ${item.imdb.year || ''} trailer`)}`}
                target="_blank"
                rel="noopener noreferrer"
                title="Watch the trailer"
                className={`${voteBtn} !px-3 text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/5`}
              >
                <Clapperboard size={17} />
              </a>
            </>
          ) : null
        }
      />
    </article>
  );
}
