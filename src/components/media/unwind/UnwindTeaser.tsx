'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Moon } from 'lucide-react';
import { feedApi } from '@/components/media/feed/api';
import { DUSK, DuskSky, Progress, minutesLabel } from './ui';
import type { UnwindView } from '@/lib/media/unwind-view';

// The way into /media/unwind from the Media page, beside the Pretrain feed: what is up next.
export function UnwindTeaser() {
  const [v, setV] = useState<UnwindView>();
  useEffect(() => {
    void feedApi<UnwindView>('unwind').then(setV).catch(() => {});
  }, []);
  const show = v?.continuing[0] ?? v?.tonight['30'].show;
  const next = show?.next;
  const clip = v?.clips.find((c) => c.youtube);
  return (
    <Link
      href="/media/unwind"
      className={`group relative flex min-h-[200px] flex-col justify-between gap-4 overflow-hidden rounded-2xl ${DUSK} p-5 text-white shadow-[0_24px_50px_-30px_rgba(40,10,60,.85)] transition hover:shadow-[0_30px_60px_-28px_rgba(40,10,60,.95)] sm:p-6`}
    >
      <DuskSky sun="sm" />
      <div className="relative">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-pink-200/90">
          <Moon size={12} /> Unwind
        </p>
        <p className="mt-1 text-2xl font-semibold tracking-tight">Unwind in character.</p>
        <p className="mt-1 text-sm text-white/75">
          {!v
            ? 'Entertainment that still fits you.'
            : show && next
              ? `Up next: ${show.title}${show.kind === 'series' ? ` · ${next.label}` : ''}${next.minutes ? ` · ${minutesLabel(next.minutes)}` : ''}`
              : `${v.counts.clips} clips waiting · ${v.counts.deck} on deck`}
        </p>
      </div>
      <div className="relative flex items-center gap-3">
        {show?.poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={show.poster} alt="" referrerPolicy="no-referrer" className="aspect-[2/3] w-14 rounded-lg object-cover ring-1 ring-white/25" />
        )}
        {show?.kind === 'series' && (
          <div className="w-32">
            <Progress watched={show.watched} total={show.total} className="!bg-white/20 [&>span]:!bg-[#ffc2a8]" />
            <p className="mt-1.5 text-[11px] text-white/75">{show.watched} of {show.total} episodes</p>
          </div>
        )}
        {clip && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={clip.youtube!.thumbnail.replace('hqdefault', 'mqdefault')} alt="" referrerPolicy="no-referrer" className="hidden aspect-video w-24 rounded-lg object-cover ring-1 ring-white/25 md:block" />
        )}
        <span className="ml-auto flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-gray-900 transition group-hover:translate-x-0.5">
          <ArrowRight size={18} />
        </span>
      </div>
    </Link>
  );
}
