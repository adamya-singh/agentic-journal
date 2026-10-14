'use client';

import React, { useState } from 'react';
import { Compass, Bot, ChevronDown, TrendingDown, TrendingUp } from 'lucide-react';
import { ago, shortDate, type CompassKind, type CompassView, type FeedSummary } from './api';

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200/80 bg-white p-4 dark:border-white/[0.07] dark:bg-gray-900">
      <h3 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-indigo-500 dark:text-indigo-300">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

export function CompassCard({ compass }: { compass: CompassView }) {
  const [open, setOpen] = useState(false);
  const period = compass.period
    ? [compass.period.start && shortDate(compass.period.start), compass.period.end && shortDate(compass.period.end)].filter(Boolean).join(' – ') || compass.period.label
    : undefined;
  return (
    <Section title={compass.kind === 'long' ? 'Long-term compass' : 'Short-term compass'} icon={<Compass size={13} />}>
      {compass.available ? (
        <>
          {compass.title && <p className="font-[family-name:var(--font-instrument-serif)] text-xl leading-tight">{compass.title}</p>}
          {period && <p className="mb-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">{period}</p>}
          <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">{compass.excerpt}</p>
          {compass.relation && (
            <p className="mt-2 border-l-2 border-amber-300 pl-2.5 text-xs leading-relaxed text-gray-500 dark:border-amber-500/50 dark:text-gray-400">{compass.relation}</p>
          )}
          <button type="button" onClick={() => setOpen(!open)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
            {open ? 'Hide' : 'Read all of it'} <ChevronDown size={13} className={open ? 'rotate-180' : ''} />
          </button>
          {open && (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 font-sans text-xs leading-relaxed text-gray-700 dark:bg-white/[0.04] dark:text-gray-300">{compass.text}</pre>
          )}
          <p className="mt-2.5 break-all text-[11px] text-gray-400">Kept by OpenClaw in {compass.source.replace(/^\/home\/[^/]+/, '~')}. Ask OpenClaw to change it.</p>
          {!compass.usable && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Nothing has been judged against it yet. OpenClaw re-judges your feed on its next pass.</p>
          )}
        </>
      ) : (
        <p className="text-[13px] leading-relaxed text-gray-500">
          {compass.kind === 'short'
            ? 'No short-term compass yet. Once OpenClaw writes one, you can tune the feed to this stretch of time.'
            : 'OpenClaw’s North Star could not be read.'}
        </p>
      )}
    </Section>
  );
}

function Bar({ w }: { w: number }) {
  const pct = Math.round(Math.abs(w) * 50);
  return (
    <div className="relative h-1.5 w-full rounded-full bg-gray-100 dark:bg-white/[0.06]">
      <span className="absolute left-1/2 top-0 h-full w-px bg-gray-300 dark:bg-white/20" />
      <span
        className={`absolute top-0 h-full rounded-full ${w >= 0 ? 'left-1/2 bg-gradient-to-r from-emerald-400 to-emerald-500' : 'right-1/2 bg-gradient-to-l from-rose-400 to-rose-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function LearnedPanel({ summary, compass, compasses }: { summary: FeedSummary; compass: CompassKind; compasses: Record<CompassKind, CompassView> }) {
  const l = summary.learned;
  const run = summary.curator.lastRun;
  return (
    <div className="space-y-3">
      <CompassCard compass={compasses[compass]} />
      <Section title="What your votes taught it" icon={<TrendingUp size={13} />}>
        {l.votes === 0 ? (
          <p className="text-[13px] leading-relaxed text-gray-500">Vote a few things up or down. Each vote moves its topics and its creator, and the feed reorders as you go.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-gray-500">
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">{l.ups} up</span> ·{' '}
              <span className="font-semibold text-rose-600 dark:text-rose-400">{l.downs} down</span>
            </p>
            <ul className="space-y-2.5">
              {l.tags.slice(0, 8).map((t) => (
                <li key={t.tag}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium">{t.tag}</span>
                    <span className="tabular-nums text-gray-400">
                      {t.up}↑ {t.down}↓
                    </span>
                  </div>
                  <Bar w={t.w} />
                </li>
              ))}
            </ul>
            {(l.rising.length > 0 || l.sinking.length > 0) && (
              <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="mb-1 flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400"><TrendingUp size={12} /> More of</p>
                  {l.rising.map((c) => <p key={c.key} className="truncate text-gray-600 dark:text-gray-300">{c.name}</p>)}
                </div>
                <div>
                  <p className="mb-1 flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400"><TrendingDown size={12} /> Less of</p>
                  {l.sinking.map((c) => <p key={c.key} className="truncate text-gray-600 dark:text-gray-300">{c.name}</p>)}
                </div>
              </div>
            )}
          </>
        )}
      </Section>
      <Section title="OpenClaw" icon={<Bot size={13} />}>
        <p className="text-[13px] leading-relaxed text-gray-700 dark:text-gray-300">
          {summary.counts.queue[compass]} waiting for you · {summary.counts.candidate} held in reserve
          {summary.curator.addedToday > 0 && <> · {summary.curator.addedToday} added today</>}.
        </p>
        {run && (
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            Last pass {ago(run.at)}{run.note ? `: ${run.note}` : '.'}
          </p>
        )}
        <p className="mt-2 text-xs text-gray-400">Looks for more every morning from channels you up-vote and your own history and bookmarks.</p>
      </Section>
    </div>
  );
}
