'use client';

import React from 'react';
import { Loader2, Pause, Play, Star } from 'lucide-react';
import type { JobEmailUpdateRequest } from '@/lib/job-email-updates';
import type { JobApplicationsViewData, JobListing } from '@/lib/types';

interface WorkerStatusPanelProps {
  listings: JobListing[];
  applications: JobApplicationsViewData | null;
  onControl?: (action: 'start' | 'pause') => Promise<void>;
  onEmailUpdate?: (request: JobEmailUpdateRequest) => Promise<void>;
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
  onEmailUpdate,
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

  // Earliest scheduled retry, shown while idle so a recovered-but-backing-off
  // run doesn't read as "nothing is happening".
  const nextRetryAt = !running
    ? Object.values(applications.applications)
        .map((application) => application.nextRetryAt)
        .filter((value): value is string => Boolean(value && Date.parse(value) > now))
        .sort()[0]
    : undefined;

  const currentListing = currentApplication ? listingById.get(currentApplication.listingId) : null;
  const progress = currentApplication?.progress;
  const queue = applications.queuePreview
    .map((entry) => ({ entry, listing: listingById.get(entry.listingId) }))
    .filter((item): item is { entry: (typeof applications.queuePreview)[number]; listing: JobListing } =>
      Boolean(item.listing),
    );

  return (
    <section aria-label="Application worker" className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <span className={`inline-block h-2 w-2 rounded-full ${statusDot}`} aria-hidden="true" />
          Worker {statusLabel.toLowerCase()}
        </div>
        <button
          type="button"
          onClick={control}
          disabled={startDisabled}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          {controlPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : workerEnabled ? (
            <Pause className="h-3.5 w-3.5" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
          {workerEnabled ? 'Pause' : 'Start'}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        {!workerEnabled
          ? 'Paused. No new applications are claimed.'
          : running
            ? 'Live · updates every 5s'
            : nextRetryAt
              ? `Retry scheduled for ${new Date(nextRetryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : 'Idle. Wakes when there’s work (answers, new leads, retries).'}
      </p>

      {currentApplication && (
        <button
          type="button"
          onClick={() => onOpenApplication(currentApplication.listingId)}
          className="mt-3 block w-full rounded-md bg-blue-50 px-3 py-2 text-left transition hover:bg-blue-100/70 dark:bg-blue-950/40 dark:hover:bg-blue-950/60"
        >
          <span className="block text-xs font-medium text-blue-700 dark:text-blue-300">
            {progress ? STEP_LABELS[progress.step] ?? progress.step : 'Working'}
            {currentApplication.lease && ` · ${formatElapsed(currentApplication.lease.claimedAt, now)}`}
          </span>
          <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
            {currentListing?.company ?? currentApplication.listingId}
          </span>
          {currentListing && (
            <span className="block truncate text-xs text-slate-600 dark:text-slate-300">{currentListing.positionTitle}</span>
          )}
          <span className="mt-1 line-clamp-2 block text-xs text-slate-500 dark:text-slate-400">
            {progress ? [progress.label, progress.detail].filter(Boolean).join(' · ') : 'No progress reported yet'}
          </span>
        </button>
      )}

      <dl className="mt-3 space-y-1 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex justify-between gap-3">
          <dt>Scheduler</dt>
          <dd className={applications.schedulerHealth.healthy ? 'text-emerald-600 dark:text-emerald-400' : 'text-right text-red-600 dark:text-red-400'}>
            {applications.schedulerHealth.healthy
              ? applications.schedulerHealth.enabled ? 'Healthy' : 'Healthy · cron off'
              : applications.schedulerHealth.error ?? 'Unavailable'}
          </dd>
        </div>
        <EmailUpdatesStatus emailUpdates={applications.emailUpdates} onEmailUpdate={onEmailUpdate} onError={onError} />
      </dl>

      {workerEnabled && queue.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Next to claim
          </div>
          <ol className="max-h-40 overflow-y-auto">
            {queue.map(({ entry, listing }) => (
              <li key={entry.listingId}>
                <button
                  type="button"
                  onClick={() => onOpenApplication(entry.listingId)}
                  className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-xs transition hover:bg-slate-50 dark:hover:bg-slate-800/60"
                >
                  <span className="w-4 shrink-0 text-right tabular-nums text-slate-400">{entry.rank}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-700 dark:text-slate-200">
                    <span className="font-medium">{listing.company}</span>
                    <span className="text-slate-500 dark:text-slate-400"> · {listing.positionTitle}</span>
                  </span>
                  {entry.reason === 'resume-requested' ? (
                    <span className="shrink-0 text-violet-700 dark:text-violet-300">Resume</span>
                  ) : entry.reason === 'starred' ? (
                    <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" aria-label="Starred" />
                  ) : null}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

/** One line: whether OpenClaw is reading employer replies, and the switch for it. */
function EmailUpdatesStatus({
  emailUpdates,
  onEmailUpdate,
  onError,
}: {
  emailUpdates: JobApplicationsViewData['emailUpdates'];
  onEmailUpdate?: (request: JobEmailUpdateRequest) => Promise<void>;
  onError?: (message: string | null) => void;
}) {
  const [pending, setPending] = React.useState(false);
  const toggle = async () => {
    if (!onEmailUpdate || pending) return;
    setPending(true);
    onError?.(null);
    try {
      await onEmailUpdate({ action: 'set-enabled', enabled: !emailUpdates.enabled });
    } catch (error) {
      onError?.(error instanceof Error ? error.message : 'Failed to change employer email updates');
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="flex justify-between gap-3">
      <dt className="whitespace-nowrap">Employer emails</dt>
      <dd className="text-right">
        {emailUpdates.enabled
          ? emailUpdates.lastPolledAt
            ? `On · checked ${new Date(emailUpdates.lastPolledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
            : 'On · not checked yet'
          : 'Off'}
        {onEmailUpdate && (
          <>
            {' · '}
            <button
              type="button"
              onClick={toggle}
              disabled={pending}
              className="font-semibold text-indigo-700 underline-offset-2 hover:underline disabled:opacity-50 dark:text-indigo-300"
            >
              {emailUpdates.enabled ? 'Turn off' : 'Turn on'}
            </button>
          </>
        )}
      </dd>
    </div>
  );
}
