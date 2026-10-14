'use client';

import React from 'react';
import { Sunrise } from '@/components/bugs-features/icons';
import { formatPeriodRange, formatShortDate, weeksInclusive } from '@/lib/compass/dates';
import type { CompassDraft, PeriodSummary } from '@/lib/compass/types';

export type SheetTarget = { kind: 'period' | 'draft'; id: string };

const STATE_LABEL = { current: 'Current', closed: 'Closed', unfinished: 'Unfinished' } as const;

function weeksLabel(weeks: number) {
  return `${Number.isInteger(weeks) ? weeks : weeks.toFixed(1)} week${weeks === 1 ? '' : 's'}`;
}

interface Props {
  periods: PeriodSummary[];
  drafts: CompassDraft[];
  today: string;
  onOpen: (target: SheetTarget) => void;
}

export function PeriodTimeline({ periods, drafts, today, onOpen }: Props) {
  if (!periods.length && !drafts.length) {
    return (
      <section className="cp-sec" aria-label="Periods">
        <div className="cp-sec-head">
          <h3 className="bf-h">Periods</h3>
        </div>
        <div className="bf-empty">
          <Sunrise />
          <div className="bf-h">No periods yet</div>
          <div>Each period is recorded here with its log, retro and final compass.</div>
        </div>
      </section>
    );
  }
  return (
    <section className="cp-sec" aria-labelledby="cp-periods">
      <div className="cp-sec-head">
        <h3 className="bf-h" id="cp-periods">
          Periods
        </h3>
        <small>
          {periods.length} recorded{drafts.length ? ` · ${drafts.length} draft${drafts.length === 1 ? '' : 's'}` : ''}
        </small>
      </div>
      <ol className="cp-tl">
        {drafts.map((draft) => {
          const approved = !!draft.approved;
          const opensLater = draft.start ? today < draft.start : true;
          return (
            <li className="cp-tl-item draft" key={`draft-${draft.id}`}>
              <button
                type="button"
                className="cp-tl-card draft"
                onClick={() => onOpen({ kind: 'draft', id: draft.id })}
              >
                <div className="cp-tl-top">
                  <span className="cp-state" data-state={approved ? 'approved' : 'draft'}>
                    {approved ? 'Approved' : 'Draft'}
                  </span>
                  <span>next period · {draft.id}</span>
                  {draft.start && draft.end && (
                    <span className="r">{weeksLabel(weeksInclusive(draft.start, draft.end))}</span>
                  )}
                </div>
                <h3>{draft.title}</h3>
                {draft.start && draft.end && (
                  <div className="cp-tl-dates">{formatPeriodRange(draft.start, draft.end)}</div>
                )}
                <div className={`cp-await${approved ? ' ok' : ''}`}>
                  <i aria-hidden="true" />
                  {approved
                    ? opensLater
                      ? `Approved, opens ${formatShortDate(draft.start, true)}`
                      : 'Approved, opens at the next Pulse run'
                    : 'Awaiting your approval on Telegram'}
                </div>
              </button>
            </li>
          );
        })}
        {periods.map((p) => (
          <li className={`cp-tl-item ${p.state}`} key={p.id}>
            <button type="button" className="cp-tl-card" onClick={() => onOpen({ kind: 'period', id: p.id })}>
              <div className="cp-tl-top">
                <span className="cp-state" data-state={p.state}>
                  {STATE_LABEL[p.state]}
                </span>
                <span>{p.id}</span>
                <span className="r">{weeksLabel(p.weeks)}</span>
              </div>
              <h3>{p.title}</h3>
              <div className="cp-tl-dates">
                {formatPeriodRange(p.start, p.end)}
                {p.finalVersion !== null ? ` · v${p.finalVersion}` : ''}
                {p.closed ? ` · closed ${formatShortDate(p.closed)}` : ''}
              </div>
              <div className="cp-tl-chips">
                <span className={`cp-chip${p.hasLog ? '' : ' off'}`}>
                  log · {p.logEntries}
                </span>
                <span className={`cp-chip${p.hasRetro ? '' : ' off'}`}>retro</span>
                <span className={`cp-chip${p.hasSnapshot ? '' : ' off'}`}>
                  {p.hasSnapshot ? 'snapshot' : p.current ? 'live' : 'snapshot'}
                </span>
              </div>
              {p.verdict && (
                <div className="cp-verdict">
                  Period length: <b>{p.verdict}</b>
                </div>
              )}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
