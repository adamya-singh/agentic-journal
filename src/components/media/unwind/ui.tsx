'use client';

import React from 'react';
import { Film, Tv } from 'lucide-react';

// Unwind's look: Pretrain is dawn, Unwind is dusk. A setting sun, a crescent,
// a few stars, over a plum-to-coral sky.

export const DUSK = 'bg-gradient-to-br from-[#120a26] via-[#3b1d62] to-[#d9706a]';
export const pill =
  'inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:cursor-not-allowed disabled:opacity-50';
export const button =
  'inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-50';
export const outline = `${button} border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800`;
export const primary = `${button} bg-[#3b1f5e] text-white hover:bg-[#4a2a73] dark:bg-violet-500 dark:hover:bg-violet-400`;

export function DuskSky({ sun = 'lg' }: { sun?: 'lg' | 'sm' }) {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(1px_1px_at_12%_22%,rgba(255,255,255,.9),transparent_60%),radial-gradient(1px_1px_at_32%_12%,rgba(255,255,255,.7),transparent_60%),radial-gradient(1.5px_1.5px_at_58%_30%,rgba(255,255,255,.8),transparent_60%),radial-gradient(1px_1px_at_76%_16%,rgba(255,255,255,.6),transparent_60%),radial-gradient(1px_1px_at_88%_40%,rgba(255,255,255,.6),transparent_60%)]"
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute rounded-full bg-[radial-gradient(circle_at_50%_45%,#ffe2c4_0_24%,#ffab7a_48%,#e8606a_72%,transparent_74%)] ${sun === 'lg' ? '-bottom-40 right-6 h-72 w-72 sm:right-20' : '-bottom-28 right-8 h-48 w-48'}`}
      />
      <div aria-hidden className="pointer-events-none absolute right-[38%] top-14 h-6 w-6 rounded-full shadow-[7px_-5px_0_0_#f6e7c8]" />
    </>
  );
}

export function PosterImg({ src, title, kind, className = '' }: { src?: string; title: string; kind?: 'series' | 'film'; className?: string }) {
  if (!src)
    return (
      <div className={`flex aspect-[2/3] flex-col items-center justify-center gap-1 rounded-xl bg-gradient-to-br from-[#2a1747] to-[#8e3b6b] p-2 text-center text-white ${className}`}>
        {kind === 'film' ? <Film size={18} /> : <Tv size={18} />}
        <span className="line-clamp-3 text-xs font-semibold">{title}</span>
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={title} referrerPolicy="no-referrer" loading="lazy" className={`aspect-[2/3] w-full rounded-xl bg-gray-200 object-cover dark:bg-gray-800 ${className}`} />
  );
}

export function Progress({ watched, total, className = '' }: { watched: number; total: number; className?: string }) {
  const pct = total ? Math.round((watched / total) * 100) : 0;
  return (
    <span className={`block h-1 overflow-hidden rounded-full bg-violet-100 dark:bg-white/10 ${className}`}>
      <span className="block h-full rounded-full bg-violet-600 dark:bg-violet-400" style={{ width: `${pct}%` }} />
    </span>
  );
}

export const minutesLabel = (m?: number) => {
  if (!m) return '';
  const h = Math.floor(m / 60);
  return h ? `${h} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`;
};
