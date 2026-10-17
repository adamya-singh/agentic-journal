'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Play } from 'lucide-react';
import { clock, feedApi } from '@/components/media/feed/api';
import { YouTubeMark } from '@/components/media/YouTubeIntake';
import type { TbpnView } from '@/lib/media/tbpn';

// The way into /media/tbpn from the Media page: the oldest episode you haven't finished.
export function TbpnTeaser() {
  const [v, setV] = useState<TbpnView>();
  useEffect(() => {
    void feedApi<TbpnView>('tbpn').then(setV).catch(() => {});
  }, []);
  if (!v) return null;
  const next = v.queue[0];
  return (
    <Link
      href="/media/tbpn"
      className="group mb-4 flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-3 pr-4 transition hover:border-gray-300 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-gray-800 dark:bg-gray-900 dark:hover:border-gray-700"
    >
      <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-gray-200 sm:w-36 dark:bg-gray-800">
        {next && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={next.thumbnail} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        )}
        {next && next.progress > 0 && (
          <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/40">
            <span className="block h-full bg-[#ff0033]" style={{ width: `${Math.round(next.progress * 100)}%` }} />
          </span>
        )}
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white transition group-hover:scale-105">
            <Play size={16} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-indigo-600 dark:text-indigo-400">
          <YouTubeMark /> Diet TBPN
          <span className="font-medium normal-case tracking-normal text-gray-500">
            · {next ? `${v.queue.length} to go` : 'caught up'}
          </span>
        </p>
        <p className="mt-1 line-clamp-1 text-[15px] font-semibold">
          {next ? next.title : 'You’re caught up on the last 2 months.'}
        </p>
        {next && (
          <p className="mt-0.5 text-xs text-gray-500">
            {next.resumeAt > 0 ? `Resume at ${clock(next.resumeAt)}` : 'Up next'} ·{' '}
            {new Date(next.publishedAt).toLocaleDateString('en-US', {
              timeZone: 'America/Los_Angeles',
              weekday: 'short',
              month: 'short',
              day: 'numeric',
            })}
          </p>
        )}
      </div>
      <ArrowRight size={18} className="shrink-0 text-gray-400 transition group-hover:translate-x-0.5 group-hover:text-gray-700 dark:group-hover:text-gray-200" />
    </Link>
  );
}
