'use client';

import React from 'react';
import { Loader2, Pause, Play, Star } from 'lucide-react';
import type { JobEmailUpdateRequest } from '@/lib/job-email-updates';
import type { JobApplicationsViewData, JobListing } from '@/lib/types';
import { CompanyLogo } from './mission/CompanyLogo';

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
 * Live view of the OpenClaw application worker for the top of the Board's
 * Mission hero: run state, the application it is working on right now (with
 * the agent's fine-grained progress heartbeat), and the claim-order queue. Data freshness comes from the 5s poll in
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
    <section aria-label="Application worker">
      <div className="wk">
        <div className="eb" aria-live="polite">
          <span className="out" style={{ color: !workerEnabled ? 'var(--dim)' : running ? 'var(--c-tech)' : 'var(--now)' }}>
            <i />Worker {statusLabel.toLowerCase()}
          </span>
          <span aria-hidden="true">·</span>
          <span className={applications.schedulerHealth.healthy ? 'ok' : 'bad'}>
            {applications.schedulerHealth.healthy
              ? applications.schedulerHealth.enabled ? 'Scheduler healthy' : 'Scheduler healthy · cron off'
              : `Scheduler: ${applications.schedulerHealth.error ?? 'unavailable'}`}
          </span>
          <span aria-hidden="true">·</span>
          <EmailUpdatesStatus emailUpdates={applications.emailUpdates} onEmailUpdate={onEmailUpdate} onError={onError} />
        </div>
        <button type="button" onClick={control} disabled={startDisabled} className={`btn sm${workerEnabled ? '' : ' pri'}`}>
          {controlPending ? (
            <Loader2 className="i s animate-spin" />
          ) : workerEnabled ? (
            <Pause className="i s" />
          ) : (
            <Play className="i s" />
          )}
          {workerEnabled ? 'Pause the worker' : 'Start the worker'}
        </button>
      </div>
      <p className="hint" style={{ margin: '6px 0 0' }}>
        {!workerEnabled
          ? 'Paused. No new applications are claimed.'
          : running
            ? 'Live · updates every 5s'
            : nextRetryAt
              ? `Retry scheduled for ${new Date(nextRetryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : 'Idle. Wakes when there’s work (answers, new leads, retries).'}
      </p>

      {currentApplication && (
        <button type="button" onClick={() => onOpenApplication(currentApplication.listingId)} className="run">
          <CompanyLogo company={currentListing?.company ?? '?'} link={currentListing?.link} />
          <span style={{ minWidth: 0 }}>
            <span className="step">
              {progress ? STEP_LABELS[progress.step] ?? progress.step : 'Working'}
              {currentApplication.lease && ` · ${formatElapsed(currentApplication.lease.claimedAt, now)}`}
            </span>
            <span className="co" style={{ display: 'block' }}>
              {currentListing?.company ?? currentApplication.listingId}
              {currentListing && <span className="ro"> · {currentListing.positionTitle}</span>}
            </span>
            <span className="ro" style={{ display: 'block' }}>
              {progress ? [progress.label, progress.detail].filter(Boolean).join(' · ') : 'No progress reported yet'}
            </span>
          </span>
          <span className="pulse" style={{ background: 'var(--em)' }} aria-hidden="true" />
        </button>
      )}

      {workerEnabled && queue.length > 0 && (
        <div className="next">
          <span className="lab" style={{ marginRight: 4 }}>Next to claim</span>
          {queue.slice(0, 8).map(({ entry, listing }) => (
            <button key={entry.listingId} type="button" onClick={() => onOpenApplication(entry.listingId)} title={listing.positionTitle}>
              <CompanyLogo company={listing.company} link={listing.link} size="sm" />
              <span className="rk">{entry.rank}</span>
              {listing.company}
              {entry.reason === 'resume-requested' ? (
                <span style={{ color: 'var(--c-screen)' }}>Resume</span>
              ) : entry.reason === 'starred' ? (
                <Star className="i s" style={{ color: 'var(--now)', fill: 'var(--now)' }} aria-label="Starred" />
              ) : null}
            </button>
          ))}
          {queue.length > 8 && <span className="rk">+{queue.length - 8}</span>}
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
    <span>
      Emails{' '}
      {emailUpdates.enabled
        ? emailUpdates.lastPolledAt
          ? `checked ${new Date(emailUpdates.lastPolledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : 'on · not checked yet'
        : 'off'}
      {onEmailUpdate && (
        <>
          {' · '}
          <button type="button" onClick={toggle} disabled={pending} className="linkbtn">
            {emailUpdates.enabled ? 'Turn off' : 'Turn on'}
          </button>
        </>
      )}
    </span>
  );
}
