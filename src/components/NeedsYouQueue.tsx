'use client';

import React from 'react';
import { AlertCircle, CalendarPlus, ChevronDown, ChevronRight } from 'lucide-react';
import type { JobApplicationsViewData, JobListing } from '@/lib/types';

const COLLAPSED_COUNT = 8;

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
      const pending = application.questions.filter(
        (question) => question.resolution === 'pending',
      );
      // Drafted applications waiting on answer review live in the review panel.
      if (pending.length === 0 && application.reviewHoldSince) continue;
      const blockedEntry = [...application.statusHistory]
        .reverse()
        .find((entry) => entry.status === 'awaiting-user-input');
      result.push({
        listingId,
        company: listing.company,
        position: listing.positionTitle,
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
    <section
      id="needs-you-queue"
      className="border-b border-slate-200 dark:border-slate-700 bg-amber-50/60 dark:bg-amber-950/10"
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-1">
        <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Needs your input ({rows.length})
        </h3>
        <span className="text-xs text-amber-700/70 dark:text-amber-400/70">
          — oldest first; answering all questions lets the worker resume
        </span>
      </div>
      {extendError && <p role="alert" className="px-4 pb-1 text-sm text-red-700 dark:text-red-300">{extendError}</p>}
      <ul className="divide-y divide-amber-100 dark:divide-amber-900/30">
        {visible.map((row) => (
          <li key={row.listingId} className="flex items-center hover:bg-amber-100/60 dark:hover:bg-amber-900/20">
            <button
              type="button"
              onClick={() => onOpen(row.listingId)}
              className="flex min-w-0 flex-1 items-baseline gap-3 py-2 pl-4 pr-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-100">
                  {row.company}
                </span>{' '}
                <span className="text-slate-500 dark:text-slate-400">{row.position}</span>
                {row.archived && (
                  <span className="ml-1.5 text-xs italic text-slate-400">(archived)</span>
                )}
              </span>
              <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">
                {row.pendingCount} question{row.pendingCount === 1 ? '' : 's'}
                {row.requiredCount > 0 && ` (${row.requiredCount} required)`}
              </span>
              <span className="w-24 shrink-0 text-right text-xs text-slate-400 dark:text-slate-500">
                {row.autoCompletable && row.eligibleAt
                  ? Date.parse(row.eligibleAt) <= now
                    ? 'Draft due'
                    : `Drafts in ${formatCountdown(Date.parse(row.eligibleAt) - now)}`
                  : 'External blocker'}
              </span>
            </button>
            {/* Kept in every row so the columns line up; only autopilot rows can use it. */}
            <button
              type="button"
              onClick={() => extend(row.listingId)}
              disabled={!onExtend || !row.autoCompletable || !row.eligibleAt || extending !== null}
              aria-label={`Delay autopilot for ${row.company} ${row.position} by one day`}
              title="Give yourself another day before OpenClaw answers these for you"
              className={`mr-3 inline-flex min-h-8 shrink-0 items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40 ${
                row.autoCompletable && row.eligibleAt ? '' : 'invisible'
              }`}
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              {extending === row.listingId ? '…' : '+1 day'}
            </button>
          </li>
        ))}
      </ul>
      {rows.length > COLLAPSED_COUNT && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-center justify-center gap-1 px-4 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100/60 dark:text-amber-300 dark:hover:bg-amber-900/20"
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> Show fewer
            </>
          ) : (
            <>
              <ChevronRight className="h-3.5 w-3.5" /> Show all {rows.length}
            </>
          )}
        </button>
      )}
    </section>
  );
}

function formatCountdown(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
}
