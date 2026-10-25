'use client';

import React from 'react';
import {
  CURRENT_STAGE_LABELS,
  CURRENT_STAGE_ORDER,
  OUTCOME_LABELS,
  type CurrentStage,
  type OutcomeKey,
} from '@/lib/job-overview-view';
import { InfoTip } from './primitives';

const KEY: Record<'submitted' | OutcomeKey, string> = {
  submitted: 'var(--em)',
  received: 'var(--c-tech)',
  assessment: 'var(--now)',
  interview: 'var(--c-screen)',
  offer: 'var(--c-offer)',
  rejected: 'var(--c-reject)',
  awaiting: 'var(--ink2)',
};
const SEGMENT: Record<CurrentStage, string> = {
  none: '#4a5872',
  received: 'var(--c-tech)',
  assessment: 'var(--now)',
  interview: 'var(--c-screen)',
  offer: 'var(--c-offer)',
  rejected: 'var(--c-reject)',
  withdrawn: 'var(--dim)',
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
const LADDER: ('submitted' | OutcomeKey)[] = ['submitted', 'received', 'assessment', 'interview', 'offer'];
const SIDE: OutcomeKey[] = ['rejected', 'awaiting'];
const R = 80;
const CIRC = 2 * Math.PI * R;
const GAP = 3;

/**
 * The Readout hero's left two thirds: a ring of where every submitted
 * application stands now, and the outcome rows as facet filters. Facet
 * semantics: a selected row narrows the rows below without changing the other
 * counts. Outcomes mean "ever reached" and can overlap; the ring is the honest
 * partition of where each application stands right now.
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
  const present = CURRENT_STAGE_ORDER.filter((s) => distribution[s] > 0);
  const arcs = present.reduce<{ stage: CurrentStage; length: number; offset: number }[]>((list, stage) => {
    const offset = list.length ? list[list.length - 1].offset + list[list.length - 1].length + GAP : 0;
    const share = (distribution[stage] / total) * CIRC;
    return [...list, { stage, offset, length: Math.max(present.length > 1 ? share - GAP : share, 2) }];
  }, []);
  const facet = (key: 'submitted' | OutcomeKey) => ({
    title: HINT[key],
    'aria-pressed': key === 'submitted' ? selected === '' : selected === key,
    onClick: () => onSelect(key === 'submitted' || selected === key ? '' : (key as OutcomeKey)),
  });
  const share = (n: number) =>
    counts.submitted ? `${Math.round((n / counts.submitted) * 1000) / 10}%` : '—';
  return (
    <>
      <div
        className="ov-orbit"
        role="img"
        aria-label={`${total} submitted: ${present.map((s) => `${CURRENT_STAGE_LABELS[s]} ${distribution[s]}`).join(', ') || 'none in this view'}`}
      >
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <circle cx="100" cy="100" r={R} stroke="rgba(120,190,255,.07)" />
          {total > 0 &&
            arcs.map((a) => (
              <circle
                key={a.stage}
                className="seg-arc"
                cx="100"
                cy="100"
                r={R}
                style={{ ['--k' as string]: SEGMENT[a.stage] }}
                strokeDasharray={`${a.length} ${CIRC}`}
                strokeDashoffset={-a.offset}
              />
            ))}
          <circle cx="100" cy="100" r="64" stroke="rgba(127,227,255,.18)" strokeWidth="1" strokeDasharray="2 4" />
        </svg>
        <div className="c">
          <b>{total}</b>
          <span className="lab" style={{ color: 'var(--em)', marginTop: 8 }}>submitted</span>
        </div>
      </div>

      <section className="ov-fun" aria-label="Outcomes">
        <div className="lab" style={{ color: 'var(--em)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Ever reached
          <InfoTip label="About outcome counts">
            Each row counts applications that ever reached that stage, so an application can count
            in several rows; it is not a linear funnel. Click a row to show only those applications
            below; the other counts stay as they are.
          </InfoTip>
        </div>
        {LADDER.map((key) => (
          <button key={key} type="button" className="ov-fr" style={{ ['--k' as string]: KEY[key] }} {...facet(key)}>
            <span className="l">{key === 'submitted' ? 'Submitted' : OUTCOME_LABELS[key as OutcomeKey]}</span>
            <span className="t" aria-hidden="true">
              <i style={{ width: counts[key] ? `max(3px, ${(counts[key] / Math.max(1, counts.submitted)) * 100}%)` : 0 }} />
            </span>
            <span className="n">
              {counts[key]}
              <small>{key === 'submitted' ? 'all' : share(counts[key])}</small>
            </span>
          </button>
        ))}
        <div className="ov-side">
          {SIDE.map((key) => (
            <button key={key} type="button" className="ov-sf" style={{ ['--k' as string]: KEY[key] }} {...facet(key)}>
              <b>{counts[key]}</b>
              <span>{OUTCOME_LABELS[key]}</span>
            </button>
          ))}
        </div>
        <div className="leg" style={{ marginTop: 4 }}>
          {present.map((s) => (
            <span key={s} style={{ ['--k' as string]: SEGMENT[s] }}>
              {CURRENT_STAGE_LABELS[s]} {distribution[s]}
            </span>
          ))}
          {total === 0 && <span style={{ ['--k' as string]: 'var(--dim)' }}>No submitted applications in this view.</span>}
          <InfoTip label="About the ring">
            The ring shows each submitted application once, at its latest employer stage. The rows
            count applications that ever reached a stage, so those can overlap; the ring cannot.
          </InfoTip>
        </div>
        <p className="ov-foot">
          <span>{closedBeforeSubmit} closed before submission</span>
          <InfoTip label="About closed listings">
            Postings that disappeared or were archived before an application went out. They are not
            rejections and are left out of every rate here.
          </InfoTip>
          <span aria-hidden="true">·</span>
          <span>{coverage.unknownTiming} without a timing baseline</span>
          <InfoTip label="About timing baselines">
            Response times are measured from the verified submission attempt. Applications confirmed
            by hand or recorded before timestamps were captured have no baseline and are excluded
            from timing, never from counts.
          </InfoTip>
          <span aria-hidden="true">·</span>
          <span>{coverage.reconstructed} reconstructed snapshots</span>
          <InfoTip label="About reconstructed snapshots">
            A snapshot freezes the listing, resume, and answers at submission. Reconstructed ones were
            rebuilt afterwards from the stored record, so the exact historical contents and resume
            version may be unavailable.
          </InfoTip>
        </p>
      </section>
    </>
  );
}
