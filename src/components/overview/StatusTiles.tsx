'use client';

import React from 'react';
import {
  CURRENT_STAGE_LABELS,
  CURRENT_STAGE_ORDER,
  OUTCOME_KEYS,
  OUTCOME_LABELS,
  type CurrentStage,
  type OutcomeKey,
} from '@/lib/job-overview-view';
import { InfoTip } from './primitives';

const DOT: Record<'submitted' | OutcomeKey, string> = {
  submitted: 'bg-indigo-500',
  received: 'bg-emerald-500',
  assessment: 'bg-amber-500',
  interview: 'bg-violet-500',
  offer: 'bg-teal-500',
  rejected: 'bg-red-500',
  awaiting: 'bg-slate-400',
};
const SEGMENT: Record<CurrentStage, string> = {
  none: 'bg-slate-300 dark:bg-slate-600',
  received: 'bg-emerald-400 dark:bg-emerald-500',
  assessment: 'bg-amber-400 dark:bg-amber-500',
  interview: 'bg-violet-400 dark:bg-violet-500',
  offer: 'bg-teal-400 dark:bg-teal-500',
  rejected: 'bg-red-400 dark:bg-red-500',
  withdrawn: 'bg-slate-500 dark:bg-slate-400',
};
const HINT: Record<'submitted' | OutcomeKey, string> = {
  submitted: 'Applications submitted in the selected period.',
  received: 'The employer sent at least one email about the application.',
  assessment: 'Ever invited to an assessment.',
  interview: 'Ever invited to an interview.',
  offer: 'Ever received an offer.',
  rejected: 'Ever rejected. Silence is not rejection.',
  awaiting: 'Submitted with no decision-bearing reply and not withdrawn.',
};

/**
 * Outcome counts with facet semantics: a selected tile narrows the rows below
 * without changing the other tiles, so nothing ever reads as "data lost".
 * Outcomes mean "ever reached" and can overlap; the bar underneath is the
 * honest partition of where each application stands right now.
 */
export function StatusTiles({
  counts,
  distribution,
  selected,
  onSelect,
  closedBeforeSubmit,
  coverage,
}: {
  counts: Record<'submitted' | OutcomeKey, number>;
  distribution: Record<CurrentStage, number>;
  selected: '' | OutcomeKey;
  onSelect: (key: '' | OutcomeKey) => void;
  closedBeforeSubmit: number;
  coverage: { unknownTiming: number; reconstructed: number };
}) {
  const total = Object.values(distribution).reduce((a, b) => a + b, 0);
  const tiles: ('submitted' | OutcomeKey)[] = ['submitted', ...OUTCOME_KEYS];
  return (
    <section className="space-y-3 px-4 py-4 sm:px-5" aria-label="Outcomes">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {tiles.map((key) => {
          const active = key === 'submitted' ? selected === '' : selected === key;
          return (
            <button
              key={key}
              type="button"
              title={HINT[key]}
              aria-pressed={active}
              onClick={() => onSelect(key === 'submitted' || selected === key ? '' : key)}
              className={`rounded-lg border p-3 text-left transition hover:border-indigo-300 dark:hover:border-indigo-700 ${
                active && key !== 'submitted'
                  ? 'border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-500 dark:border-indigo-700 dark:bg-indigo-950/30'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <div className="text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {counts[key]}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[key]}`} aria-hidden="true" />
                {key === 'submitted' ? 'Submitted' : OUTCOME_LABELS[key]}
              </div>
            </button>
          );
        })}
      </div>
      <div>
        <div className="mb-1 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
          Where they stand now
          <InfoTip label="About the stage bar">
            Each submitted application appears once, at its latest employer stage. Outcome tiles
            above count applications that ever reached a stage, so those can overlap; this bar
            cannot.
          </InfoTip>
        </div>
        <div
          className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="img"
          aria-label={CURRENT_STAGE_ORDER.filter((s) => distribution[s] > 0)
            .map((s) => `${CURRENT_STAGE_LABELS[s]} ${distribution[s]}`)
            .join(', ')}
        >
          {total > 0 &&
            CURRENT_STAGE_ORDER.filter((s) => distribution[s] > 0).map((s) => (
              <div
                key={s}
                title={`${CURRENT_STAGE_LABELS[s]}: ${distribution[s]}`}
                style={{ width: `${(distribution[s] / total) * 100}%` }}
                className={`${SEGMENT[s]} min-w-[2px]`}
              />
            ))}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
          {CURRENT_STAGE_ORDER.filter((s) => distribution[s] > 0).map((s) => (
            <span key={s} className="inline-flex items-center gap-1 tabular-nums">
              <span className={`h-2 w-2 rounded-sm ${SEGMENT[s]}`} aria-hidden="true" />
              {CURRENT_STAGE_LABELS[s]} {distribution[s]}
            </span>
          ))}
          {total === 0 && <span>No submitted applications in this view.</span>}
        </div>
      </div>
      <p className="flex flex-wrap items-center gap-x-1 text-xs text-slate-500 dark:text-slate-400">
        <span className="tabular-nums">{closedBeforeSubmit} closed before submission</span>
        <InfoTip label="About closed listings">
          Postings that disappeared or were archived before an application went out. They are not
          rejections and are left out of every rate here.
        </InfoTip>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{coverage.unknownTiming} without a timing baseline</span>
        <InfoTip label="About timing baselines">
          Response times are measured from the verified submission attempt. Applications confirmed
          by hand or recorded before timestamps were captured have no baseline and are excluded
          from timing, never from counts.
        </InfoTip>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{coverage.reconstructed} reconstructed snapshots</span>
        <InfoTip label="About reconstructed snapshots">
          A snapshot freezes the listing, resume, and answers at submission. Reconstructed ones were
          rebuilt afterwards from the stored record, so the exact historical contents and resume
          version may be unavailable.
        </InfoTip>
      </p>
    </section>
  );
}
