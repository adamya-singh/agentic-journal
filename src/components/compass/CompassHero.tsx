'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';
import {
  formatPeriodRange,
  formatShortDate,
  periodProgress,
  relativeTime,
} from '@/lib/compass/dates';
import type { CompassOverview, CompassStatus } from '@/lib/compass/types';

export type CompassViewKind = 'short' | 'long';

const STATUS_LABEL: Record<CompassStatus, string> = {
  active: 'Active',
  'review-due': 'Review due',
  expired: 'Expired',
  upcoming: 'Upcoming',
  closed: 'Closed',
};

const AUTHOR_LABEL: Record<string, string> = {
  openclaw: 'OpenClaw',
  adamya: 'Adamya',
  'compass-sync': 'compass-sync',
};

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

interface Props {
  overview: CompassOverview | undefined;
  loading: boolean;
  view: CompassViewKind;
  onView: (view: CompassViewKind) => void;
  onRefresh: () => void;
  now: number;
}

export function CompassHero({ overview, loading, view, onView, onRefresh, now }: Props) {
  const short = overview?.shortTerm;
  const long = overview?.longTerm;
  const repo = overview?.repo;
  const today = overview?.today ?? '';
  const period = short?.period ?? null;
  const status = short?.status ?? null;
  const progress =
    period && period.start && period.end && today
      ? periodProgress({ start: period.start, end: period.end, reviewBy: period.reviewBy }, today)
      : null;

  let eyebrow = 'Compass';
  let title: React.ReactNode = 'Compass';
  let line: React.ReactNode = null;
  if (!overview) {
    eyebrow = loading ? 'Compass · loading' : 'Compass';
    line = loading ? 'Reading OpenClaw’s compass…' : '';
  } else if (view === 'long') {
    eyebrow = 'Compass · long-term';
    title = (
      <>
        Long-term <em>compass</em>
      </>
    );
    line = long?.available ? (
      <>
        <span>Mirrored from {long.files.join(', ')}</span>
        {long.mirroredAt && (
          <span>
            · synced <b>{relativeTime(long.mirroredAt, now)}</b>
          </span>
        )}
      </>
    ) : (
      <span>No mirrors yet in {overview.dir}/long-term</span>
    );
  } else if (!short?.available) {
    eyebrow = 'Compass · short-term';
    title = (
      <>
        No compass <em>yet</em>
      </>
    );
    line = <span>{short?.path ?? overview.dir}</span>;
  } else {
    eyebrow = `Compass · ${period?.id ?? 'short-term'}`;
    title = short.title || 'Untitled compass';
    line = (
      <>
        {period && <b>{formatPeriodRange(period.start, period.end)}</b>}
        {period?.reviewBy && <span>· review by {formatShortDate(period.reviewBy)}</span>}
        {short.version !== null && <span>· v{short.version}</span>}
        {short.updated && <span>· updated {formatShortDate(short.updated)}</span>}
      </>
    );
  }

  let trackLeft = '';
  let trackRight = '';
  if (progress && status) {
    if (status === 'upcoming') {
      trackLeft =
        progress.daysToStart === 1 ? 'Starts tomorrow' : `Starts in ${plural(progress.daysToStart, 'day')}`;
      trackRight = plural(progress.total, 'day');
    } else if (status === 'expired') {
      trackLeft = `Ended ${plural(progress.daysSinceEnd, 'day')} ago`;
      trackRight = `${plural(progress.total, 'day')} · still in force`;
    } else if (status === 'closed') {
      trackLeft = short?.closed ? `Closed ${formatShortDate(short.closed)}` : 'Closed';
      trackRight = plural(progress.total, 'day');
    } else {
      trackLeft = `Day ${progress.elapsed} of ${progress.total}`;
      trackRight = progress.left === 0 ? 'Last day' : `${plural(progress.left, 'day')} left`;
    }
  }

  const head = repo?.head ?? null;
  const tally = !repo ? null : head ? (
    <>
      <code>{head.shortSha}</code> · {AUTHOR_LABEL[head.authorKind] ?? head.author} ·{' '}
      {relativeTime(head.date, now)}
      <br />
      {repo.branch && <b>{repo.branch}</b>}
      {repo.remote ? ` · ${repo.remote.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, '$1')}` : ''}
    </>
  ) : repo.isRepo ? (
    <>No commits yet</>
  ) : (
    <>History unavailable</>
  );

  return (
    <section className="bf-sky bf-hero cp-hero">
      <div className="bf-sun" aria-hidden="true" />
      <div className="bf-hero-in">
        <div className="cp-hero-main">
          <div className="bf-eyebrow">{eyebrow}</div>
          <h2 className="bf-title">{title}</h2>
          <div className="cp-dates">
            {line}
            {view === 'short' && status && (
              <span className="cp-pill" data-status={status}>
                {status === 'review-due' && <i aria-hidden="true" />}
                {STATUS_LABEL[status]}
              </span>
            )}
          </div>
          {view === 'short' && progress && status && status !== 'closed' && (
            <div>
              <div
                className="cp-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.elapsed}
                aria-label="Days elapsed in this period"
              >
                <b style={{ width: `${progress.pct}%` }} />
                {progress.reviewPct !== null && (
                  <i
                    style={{ left: `${progress.reviewPct}%` }}
                    title={`Review by ${formatShortDate(period?.reviewBy, true)}`}
                  />
                )}
              </div>
              <div className="cp-track-l">
                <span>
                  <b>{trackLeft}</b>
                </span>
                <span>{trackRight}</span>
              </div>
            </div>
          )}
        </div>
        <div className="cp-hero-side">
          {tally && <div className="bf-tally">{tally}</div>}
        </div>
        <div className="cp-hero-acts">
          <div className="bf-seg" role="group" aria-label="Which compass">
            <button type="button" aria-pressed={view === 'short'} onClick={() => onView('short')}>
              Short-term
            </button>
            <button type="button" aria-pressed={view === 'long'} onClick={() => onView('long')}>
              Long-term
            </button>
          </div>
          <button
            type="button"
            className={`cp-ghost${loading ? ' busy' : ''}`}
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw aria-hidden="true" /> Refresh
          </button>
        </div>
      </div>
    </section>
  );
}
