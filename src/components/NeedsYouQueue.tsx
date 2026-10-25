'use client';

import React from 'react';
import { CalendarPlus } from 'lucide-react';
import type { JobApplicationsViewData, JobListing } from '@/lib/types';
import { CompanyLogo } from './mission/CompanyLogo';

const COLLAPSED_COUNT = 5;

interface NeedsYouQueueProps {
  listings: JobListing[];
  applications: JobApplicationsViewData | null;
  onOpen: (listingId: string) => void;
  /** Pushes this application's autopilot draft date back by a day. */
  onExtend?: (listingId: string) => Promise<void>;
}

interface QueueRow {
  listingId: string;
  company: string;
  position: string;
  link: string;
  archived: boolean;
  pendingCount: number;
  requiredCount: number;
  blockedSince: string;
  eligibleAt?: string;
  autoCompletable: boolean;
}

export function NeedsYouQueue({ listings, applications, onOpen, onExtend }: NeedsYouQueueProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [extending, setExtending] = React.useState<string | null>(null);
  const [extendError, setExtendError] = React.useState<string | null>(null);
  const extend = async (listingId: string) => {
    if (!onExtend || extending) return;
    setExtending(listingId);
    setExtendError(null);
    try {
      await onExtend(listingId);
    } catch (error) {
      setExtendError(error instanceof Error ? error.message : 'Failed to extend the autopilot date');
    } finally {
      setExtending(null);
    }
  };
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const rows = React.useMemo<QueueRow[]>(() => {
    if (!applications) return [];
    const listingById = new Map(listings.map((listing) => [listing.id, listing]));
    const result: QueueRow[] = [];
    for (const [listingId, application] of Object.entries(applications.applications)) {
      if (application.status !== 'awaiting-user-input') continue;
      const listing = listingById.get(listingId);
      if (!listing) continue;
      // A redo is OpenClaw's to redraft; the review panel shows it as being redone.
      const pending = application.questions.filter(
        (question) => question.resolution === 'pending' && !question.redoRequest,
      );
      // Drafted applications waiting on answer review (or a redraft) live in the review panel.
      if (pending.length === 0) continue;
      const blockedEntry = [...application.statusHistory]
        .reverse()
        .find((entry) => entry.status === 'awaiting-user-input');
      result.push({
        listingId,
        company: listing.company,
        position: listing.positionTitle,
        link: listing.link,
        archived: listing.status === 'archived',
        pendingCount: pending.length,
        requiredCount: pending.filter((question) => question.required).length,
        blockedSince: blockedEntry?.changedAt ?? application.updatedAt,
        eligibleAt: application.autoCompleteEligibleAt,
        autoCompletable:
          listing.applicationCategories.some((category) =>
            applications.enabledApplicationCategories.includes(category),
          ) && pending.length > 0 &&
          pending.every((question) => question.kind === 'text' || question.kind === 'single-select' || question.kind === 'multi-select'),
      });
    }
    // Oldest blocked first: drain the backlog.
    return result.sort((a, b) => a.blockedSince.localeCompare(b.blockedSince));
  }, [listings, applications]);

  if (rows.length === 0) {
    return null;
  }

  const visible = expanded ? rows : rows.slice(0, COLLAPSED_COUNT);

  return (
    <section id="needs-you-queue" aria-labelledby="needs-you-queue-heading" className="scroll-mt-24">
      <h3 id="needs-you-queue-heading" className="lab" style={{ color: 'var(--now)', margin: '6px 4px 10px' }}>
        Answer questions · {rows.length}
        <span style={{ color: 'var(--dim)' }}> · oldest first; the worker resumes once you answer</span>
      </h3>
      {extendError && <p role="alert" className="err">{extendError}</p>}
      <ul className="qgrid" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {visible.map((row) => {
          const drafts = row.autoCompletable && row.eligibleAt;
          return (
            <li key={row.listingId} className="qc">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <CompanyLogo company={row.company} link={row.link} />
                <span className="kind" style={{ ['--k' as string]: 'var(--now)' }}>
                  {row.pendingCount} question{row.pendingCount === 1 ? '' : 's'}
                </span>
              </div>
              <button type="button" onClick={() => onOpen(row.listingId)} style={{ minWidth: 0 }}>
                <span className="nm">
                  {row.company}
                  {row.archived && <span className="ro" style={{ fontFamily: 'var(--sans)' }}> (archived)</span>}
                </span>
                <span className="rl">{row.position}</span>
              </button>
              <div className="ft">
                <span className="w" title={drafts ? 'OpenClaw drafts answers for you at this time' : 'OpenClaw can’t draft these answers; they wait for you'}>
                  {row.requiredCount} required ·{' '}
                  {drafts
                    ? Date.parse(row.eligibleAt!) <= now
                      ? 'draft due'
                      : `drafts in ${formatCountdown(Date.parse(row.eligibleAt!) - now)}`
                    : `waiting ${formatAge(now - Date.parse(row.blockedSince))}`}
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  {drafts && onExtend && (
                    <button
                      type="button"
                      onClick={() => extend(row.listingId)}
                      disabled={extending !== null}
                      aria-label={`Delay autopilot for ${row.company} ${row.position} by one day`}
                      title="Give yourself another day before OpenClaw answers these for you"
                      className="btn sm"
                    >
                      <CalendarPlus className="i s" />
                      {extending === row.listingId ? '…' : '+1 day'}
                    </button>
                  )}
                  <button type="button" onClick={() => onOpen(row.listingId)} className="btn sm pri">
                    Answer
                  </button>
                </span>
              </div>
            </li>
          );
        })}
        {rows.length > COLLAPSED_COUNT && (
          <li style={{ display: 'grid' }}>
            <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="more qmore">
              {expanded ? <><b>All {rows.length}</b><span>shown · show fewer</span></> : <><b>+{rows.length - COLLAPSED_COUNT}</b><span>more waiting · show all</span></>}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function formatAge(milliseconds: number): string {
  const days = Math.floor(milliseconds / 86_400_000);
  if (days < 1) return 'since today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  return `${Math.round(days / 30)} months`;
}

function formatCountdown(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
}
