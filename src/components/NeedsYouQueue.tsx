'use client';

import React from 'react';
import { AlertCircle, CalendarPlus, ChevronDown, ChevronRight } from 'lucide-react';
import type { JobApplicationsViewData, JobListing } from '@/lib/types';

const COLLAPSED_COUNT = 6;

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
    <section id="needs-you-queue" className="scroll-mt-24">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        <AlertCircle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        Answer questions · {rows.length}
        <span className="hidden font-normal normal-case tracking-normal text-slate-400 sm:inline">oldest first; the worker resumes once you answer</span>
      </h3>
      {extendError && <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-300">{extendError}</p>}
      <ul className="mt-2 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
        {visible.map((row) => {
          const drafts = row.autoCompletable && row.eligibleAt;
          return (
            <li key={row.listingId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 hover:bg-slate-50 sm:flex-nowrap dark:hover:bg-slate-800/40">
              <button
                type="button"
                onClick={() => onOpen(row.listingId)}
                className="min-w-0 flex-1 basis-full text-left sm:basis-auto"
              >
                <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {row.company}
                  {row.archived && <span className="ml-1.5 text-xs font-normal italic text-slate-400">(archived)</span>}
                </span>
                <span className="block truncate text-sm text-slate-600 dark:text-slate-300">{row.position}</span>
              </button>
              <span className="w-44 shrink-0 text-sm">
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  {row.pendingCount} question{row.pendingCount === 1 ? '' : 's'}
                </span>
                <span className="text-slate-400"> · {row.requiredCount} required</span>
              </span>
              <span className="w-40 shrink-0 text-xs text-slate-500 dark:text-slate-400" title={drafts ? 'OpenClaw drafts answers for you at this time' : 'OpenClaw can’t draft these answers; they wait for you'}>
                {drafts
                  ? Date.parse(row.eligibleAt!) <= now
                    ? 'Draft due'
                    : `Drafts in ${formatCountdown(Date.parse(row.eligibleAt!) - now)}`
                  : `Waiting ${formatAge(now - Date.parse(row.blockedSince))}`}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-2">
                {drafts && onExtend && (
                  <button
                    type="button"
                    onClick={() => extend(row.listingId)}
                    disabled={extending !== null}
                    aria-label={`Delay autopilot for ${row.company} ${row.position} by one day`}
                    title="Give yourself another day before OpenClaw answers these for you"
                    className="inline-flex min-h-8 items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-900/40"
                  >
                    <CalendarPlus className="h-3.5 w-3.5" />
                    {extending === row.listingId ? '…' : '+1 day'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpen(row.listingId)}
                  className="min-h-8 rounded-md bg-indigo-600 px-3 py-1 text-xs font-semibold text-white hover:bg-indigo-700"
                >
                  Answer
                </button>
              </span>
            </li>
          );
        })}
        {rows.length > COLLAPSED_COUNT && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="flex w-full items-center justify-between bg-slate-50 px-4 py-2 text-xs text-slate-500 hover:bg-slate-100 dark:bg-slate-800/40 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <span>{expanded ? `All ${rows.length} shown` : `+ ${rows.length - COLLAPSED_COUNT} more`}</span>
              <span className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-300">
                {expanded ? <>Show fewer <ChevronDown className="h-3.5 w-3.5" /></> : <>Show all <ChevronRight className="h-3.5 w-3.5" /></>}
              </span>
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

function formatAge(milliseconds: number): string {
  const days = Math.floor(milliseconds / 86_400_000);
  if (days < 1) return 'today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  return `${Math.round(days / 30)} months`;
}

function formatCountdown(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
}
