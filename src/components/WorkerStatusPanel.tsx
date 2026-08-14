'use client';

import React from 'react';
import { Bot, Loader2, Pause, Play, Star } from 'lucide-react';
import type { JobApplicationsViewData, JobListing } from '@/lib/types';

interface WorkerStatusPanelProps {
  listings: JobListing[];
  applications: JobApplicationsViewData | null;
  onControl?: (action: 'start' | 'pause') => Promise<void>;
  onOpenApplication: (listingId: string) => void;
  onError?: (message: string | null) => void;
}

const STEP_LABELS: Record<string, string> = {
  navigate: 'Navigating',
  authenticate: 'Signing in',
  autofill: 'Autofilling',
  'resume-upload': 'Uploading resume',
  inventory: 'Reviewing form',
  'answer-questions': 'Answering questions',
  'file-upload': 'Attaching files',
  capture: 'Capturing screenshots',
  submit: 'Submitting',
};

function formatElapsed(fromIso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(fromIso)) / 1000));
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Live view of the OpenClaw application worker: run state, the application it
 * is working on right now (with the agent's fine-grained progress heartbeat),
 * and the claim-order queue preview. Data freshness comes from the 5s poll in
 * useJobBoardState while a run is active.
 */
export function WorkerStatusPanel({
  listings,
  applications,
  onControl,
  onOpenApplication,
  onError,
}: WorkerStatusPanelProps) {
  const [controlPending, setControlPending] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  const listingById = React.useMemo(() => {
    const map = new Map<string, JobListing>();
    for (const listing of listings) {
      map.set(listing.id, listing);
    }
    return map;
  }, [listings]);

  const currentApplication = React.useMemo(() => {
    if (!applications) {
      return null;
    }
    const leased = Object.values(applications.applications).filter(
      (application) =>
        application.status === 'in-progress' &&
        application.lease &&
        Date.parse(application.lease.expiresAt) > now,
    );
    if (leased.length === 0) {
      return null;
    }
    // Multiple live leases only happen when an older one is stale-but-unexpired;
    // the newest claim is the one actually being worked.
    return leased.sort(
      (first, second) =>
        Date.parse(second.lease?.claimedAt ?? '') - Date.parse(first.lease?.claimedAt ?? ''),
    )[0];
  }, [applications, now]);

  // Tick the elapsed timer once a second while a run is live.
  React.useEffect(() => {
    if (!currentApplication) {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [currentApplication]);

  if (!applications) {
    return null;
  }

  const workerEnabled = applications.workerEnabled;
  const running = Boolean(currentApplication);
  const statusLabel = !workerEnabled ? 'Paused' : running ? 'Running' : 'Idle';
  const statusDot = !workerEnabled
    ? 'bg-slate-400'
    : running
      ? 'bg-emerald-500 animate-pulse'
      : 'bg-amber-400';
  const startDisabled =
    !onControl ||
    controlPending ||
    (!workerEnabled &&
      (!applications.readiness.ready || applications.enabledApplicationCategories.length === 0));

  const control = async () => {
    if (!onControl || controlPending) {
      return;
    }
    setControlPending(true);
    onError?.(null);
    try {
      await onControl(workerEnabled ? 'pause' : 'start');
    } catch (controlError) {
      onError?.(controlError instanceof Error ? controlError.message : 'Failed to control worker');
    } finally {
      setControlPending(false);
    }
  };

  const currentListing = currentApplication ? listingById.get(currentApplication.listingId) : null;
  const progress = currentApplication?.progress;
  const queue = applications.queuePreview
    .map((entry) => ({ entry, listing: listingById.get(entry.listingId) }))
    .filter((item): item is { entry: (typeof applications.queuePreview)[number]; listing: JobListing } =>
      Boolean(item.listing),
    );

  return (
    <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-4 dark:border-slate-700 dark:bg-slate-950/30">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
            <Bot className="h-4.5 w-4.5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <span
                className={`inline-block h-2 w-2 rounded-full ${statusDot}`}
                aria-hidden="true"
              />
              Application worker · {statusLabel}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {!workerEnabled
                ? 'Paused — no new applications are claimed.'
                : running
                  ? 'Live · updates every 5s'
                  : 'Waiting for the next scheduled run.'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={control}
          disabled={startDisabled}
          className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {controlPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : workerEnabled ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {workerEnabled ? 'Pause applications' : 'Start applications'}
        </button>
      </div>

      {currentApplication && (
        <button
          type="button"
          onClick={() => onOpenApplication(currentApplication.listingId)}
          className="mt-3 flex w-full flex-col gap-1 rounded-md border border-blue-200 bg-blue-50/70 px-3.5 py-2.5 text-left transition hover:bg-blue-100/70 dark:border-blue-800 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {currentListing
                ? `${currentListing.company} · ${currentListing.positionTitle}`
                : currentApplication.listingId}
            </span>
            {currentApplication.lease && (
              <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
                {formatElapsed(currentApplication.lease.claimedAt, now)} elapsed
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {progress ? (
              <>
                <span className="inline-flex whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800 dark:bg-blue-900/50 dark:text-blue-200">
                  {STEP_LABELS[progress.step] ?? progress.step}
                </span>
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {progress.label}
                </span>
                {progress.detail && (
                  <span className="text-slate-500 dark:text-slate-400">{progress.detail}</span>
                )}
              </>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">
                Working — no progress reported yet
              </span>
            )}
          </div>
        </button>
      )}

      {workerEnabled && queue.length > 0 && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Up next
          </div>
          <ol className="max-h-44 divide-y divide-slate-200 overflow-y-auto rounded-md border border-slate-200 bg-white dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {queue.map(({ entry, listing }) => (
              <li key={entry.listingId}>
                <button
                  type="button"
                  onClick={() => onOpenApplication(entry.listingId)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-slate-400">
                    {entry.rank}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-slate-800 dark:text-slate-200">
                    <span className="font-medium">{listing.company}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {' '}
                      · {listing.positionTitle}
                    </span>
                  </span>
                  {entry.reason === 'resume-requested' ? (
                    <span className="inline-flex shrink-0 whitespace-nowrap rounded-full bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-950/40 dark:text-violet-200 dark:ring-violet-800">
                      Resume requested
                    </span>
                  ) : entry.reason === 'starred' ? (
                    <Star
                      className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500"
                      aria-label="Starred"
                    />
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
