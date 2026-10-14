'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { feedApi, type FeedSummary } from './api';
import { SourceMark } from './FeedCard';

interface Teaser {
  summary: FeedSummary;
  preview: { id: string; source: 'youtube' | 'x' | 'imdb'; title: string; image?: string }[];
}
// The way into /media/feed from the Media page: what's waiting and a peek at the top of it.
export function FeedTeaser() {
  const [t, setT] = useState<Teaser>();
  useEffect(() => {
    void feedApi<Teaser>('feed/summary').then(setT).catch(() => {});
  }, []);
  if (!t) return null;
  const s = t.summary;
  return (
    <Link
      href="/media/feed"
      className="group relative mb-8 flex flex-col gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-[#0b1730] via-[#1b3f6e] to-[#b8775a] p-5 text-white shadow-[0_24px_50px_-30px_rgba(11,23,48,.8)] transition hover:shadow-[0_30px_60px_-28px_rgba(11,23,48,.9)] sm:flex-row sm:items-center sm:p-6"
    >
      <div aria-hidden className="pointer-events-none absolute -bottom-20 left-1/3 h-40 w-40 rounded-full bg-[radial-gradient(circle,#fff6d8_0_25%,#ffd27a_48%,#ff9a3c_72%,transparent_74%)] opacity-70" />
      <div className="relative min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-200/90">
          <Sparkles size={12} /> Your feed
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">Pretrain on purpose.</p>
        <p className="mt-1 text-sm text-white/70">
          {s.counts.queue.long} waiting · {s.learned.ups} up, {s.learned.downs} down
          {s.curator.addedToday > 0 && ` · ${s.curator.addedToday} new from OpenClaw today`}
        </p>
      </div>
      <div className="relative flex items-center gap-2">
        {t.preview.slice(0, 4).map((p, i) => (
          <div key={p.id} className={`relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-white/10 ring-1 ring-white/20 ${i > 1 ? 'hidden md:block' : ''}`} title={p.title}>
            {p.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.image} alt="" referrerPolicy="no-referrer" className={`h-full w-full ${p.source === 'imdb' ? 'object-cover object-top' : 'object-cover'}`} />
            ) : (
              <p className="line-clamp-3 p-1.5 text-[9px] leading-tight text-white/80">{p.title}</p>
            )}
            <span className="absolute left-1 top-1 rounded bg-black/60 p-0.5 text-white"><SourceMark source={p.source} className="!h-2.5 !w-3" /></span>
          </div>
        ))}
        <span className="ml-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-gray-900 transition group-hover:translate-x-0.5">
          <ArrowRight size={18} />
        </span>
      </div>
    </Link>
  );
}
