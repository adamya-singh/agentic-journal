'use client';

import React from 'react';
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import type { JobApplicationsViewData, JobListing } from '@/lib/types';

const COLLAPSED_COUNT = 8;

interface NeedsYouQueueProps {
  listings: JobListing[];
  applications: JobApplicationsViewData | null;
  onOpen: (listingId: string) => void;
}

interface QueueRow {
  listingId: string;
  company: string;
  position: string;
  archived: boolean;
  pendingCount: number;
  requiredCount: number;
  blockedSince: string;
}

function blockedDays(since: string): number {
  const ms = Date.now() - new Date(since).getTime();
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 86_400_000) : 0;
}

export function NeedsYouQueue({ listings, applications, onOpen }: NeedsYouQueueProps) {
  const [expanded, setExpanded] = React.useState(false);

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
      <ul className="divide-y divide-amber-100 dark:divide-amber-900/30">
        {visible.map((row) => (
          <li key={row.listingId}>
            <button
              type="button"
              onClick={() => onOpen(row.listingId)}
              className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-amber-100/60 dark:hover:bg-amber-900/20"
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
                {blockedDays(row.blockedSince) === 0
                  ? 'today'
                  : `${blockedDays(row.blockedSince)}d blocked`}
              </span>
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
