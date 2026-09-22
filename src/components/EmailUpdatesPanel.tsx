'use client';

import React from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Mail, X } from 'lucide-react';
import { JOB_EMPLOYER_STAGE_LABELS, type JobEmailUpdateRequest } from '@/lib/job-email-updates';
import type {
  JobApplicationsViewData, JobEmailUpdateCandidate, JobEmployerStage, JobListing,
} from '@/lib/types';
import { EmployerStageBadge } from './EmployerStageBadge';

const COLLAPSED_STORAGE_KEY = 'jobs.emailUpdatesPanel.collapsed';
const STAGES = Object.keys(JOB_EMPLOYER_STAGE_LABELS) as JobEmployerStage[];

/**
 * Employer emails OpenClaw could not confidently tie to one posting and stage.
 * Nothing changes here or in Simplify until one is applied.
 */
export function EmailUpdatesPanel({
  listings,
  applications,
  onUpdate,
}: {
  listings: JobListing[];
  applications: JobApplicationsViewData | null;
  onUpdate?: (request: JobEmailUpdateRequest) => Promise<void>;
}) {
  const [collapsed, setCollapsed] = React.useState(false);
  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1');
    } catch {}
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, current ? '0' : '1');
      } catch {}
      return !current;
    });
  };
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const state = applications?.emailUpdates;
  // Postings an employer email can belong to, newest application first.
  const options = React.useMemo(() => {
    if (!applications) return [];
    return listings
      .filter((listing) =>
        listing.status === 'applied' || applications.applications[listing.id]?.status === 'submitted')
      .map((listing) => ({
        listingId: listing.id,
        label: `${listing.company} — ${listing.positionTitle}`,
        submittedAt: applications.applications[listing.id]?.submittedAt ?? listing.updatedAt,
      }))
      .sort((first, second) => second.submittedAt.localeCompare(first.submittedAt));
  }, [listings, applications]);

  if (!state || (state.pending.length === 0 && !state.lastError)) return null;

  return (
    <section className="border-b border-sky-200 bg-sky-50/60 px-5 py-4 dark:border-sky-900/60 dark:bg-sky-950/10">
      <h3>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="email-update-items"
          className="-my-2 flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold text-sky-900 dark:text-sky-200"
        >
          <Mail className="h-4 w-4 shrink-0 text-sky-600" />
          <span className="min-w-0 flex-1">
            Employer emails to confirm ({state.pending.length})
            {state.lastPolledAt && (
              <span className="ml-2 font-normal text-sky-700/80 dark:text-sky-300/80">
                inbox checked {formatAgo(now - Date.parse(state.lastPolledAt))}
              </span>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-sky-700 dark:text-sky-300">
            {collapsed ? 'Show' : 'Hide'}
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
      </h3>
      <div id="email-update-items" hidden={collapsed} className="mt-3 space-y-2">
        {state.lastError && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="min-w-0">
              OpenClaw couldn’t check the inbox ({new Date(state.lastError.occurredAt).toLocaleString()}): {state.lastError.message}
            </span>
          </p>
        )}
        {!collapsed && state.pending.map((candidate) => (
          <CandidateCard key={candidate.id} candidate={candidate} options={options} onUpdate={onUpdate} />
        ))}
      </div>
    </section>
  );
}

function CandidateCard({
  candidate,
  options,
  onUpdate,
}: {
  candidate: JobEmailUpdateCandidate;
  options: { listingId: string; label: string }[];
  onUpdate?: (request: JobEmailUpdateRequest) => Promise<void>;
}) {
  const suggested = candidate.suggestedListingIds.filter((id) => options.some((option) => option.listingId === id));
  // Preselect only an unambiguous suggestion; otherwise make the choice explicit.
  const [listingId, setListingId] = React.useState(suggested.length === 1 ? suggested[0] : '');
  const [stage, setStage] = React.useState<JobEmployerStage | ''>(candidate.suggestedStage ?? '');
  const [busy, setBusy] = React.useState<'apply' | 'dismiss' | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const fieldId = `email-update-${candidate.id}`;
  const informational=['still-reviewing','assessment-reminder'].includes(candidate.details?.eventKind??'');

  const run = async (kind: 'apply' | 'dismiss') => {
    if (!onUpdate || busy) return;
    if (kind === 'apply' && (!listingId || (!stage&&!informational))) return;
    setBusy(kind);
    setError(null);
    try {
      await onUpdate({
        action: 'resolve', candidateId: candidate.id,
        resolution: kind === 'apply' ? { kind: 'apply', listingId, ...(stage&&!informational?{stage}:{}) } : { kind: 'dismiss' },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Failed to save. Please try again.');
      setBusy(null);
    }
  };

  const field = 'min-h-9 w-full min-w-0 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
  const others = options.filter((option) => !suggested.includes(option.listingId));
  return (
    <article className="rounded-lg border border-sky-200 bg-white p-3 text-sm dark:border-sky-900 dark:bg-slate-900">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <p className="min-w-0 flex-1 basis-64 font-semibold text-slate-900 dark:text-slate-100">{candidate.subject || '(no subject)'}</p>
        {candidate.suggestedStage && <EmployerStageBadge stage={candidate.suggestedStage} />}
        <time className="shrink-0 text-xs text-slate-500 dark:text-slate-400" dateTime={candidate.receivedAt}>
          {new Date(candidate.receivedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </time>
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{candidate.from}</p>
      {candidate.summary && <p className="mt-1.5 text-slate-700 dark:text-slate-300">{candidate.summary}</p>}
      {candidate.reason && (
        <p className="mt-1 text-sky-800 dark:text-sky-300">
          <span className="text-xs font-semibold uppercase tracking-wide">Why it’s here </span>
          {candidate.reason}
        </p>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
        <label className="min-w-0 text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor={`${fieldId}-posting`}>
          Posting
          <select id={`${fieldId}-posting`} value={listingId} onChange={(event) => setListingId(event.target.value)} className={`mt-1 font-normal ${field}`}>
            <option value="">Choose a posting…</option>
            {suggested.length > 0 && (
              <optgroup label="OpenClaw’s suggestions">
                {suggested.map((id) => (
                  <option key={id} value={id}>{options.find((option) => option.listingId === id)?.label}</option>
                ))}
              </optgroup>
            )}
            <optgroup label="All applied postings">
              {others.map((option) => <option key={option.listingId} value={option.listingId}>{option.label}</option>)}
            </optgroup>
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300" htmlFor={`${fieldId}-stage`}>
          Stage
          <select disabled={informational} id={`${fieldId}-stage`} value={stage} onChange={(event) => setStage(event.target.value as JobEmployerStage | '')} className={`mt-1 font-normal ${field}`}>
            <option value="">{informational?'Informational — stage unchanged':'Choose…'}</option>
            {STAGES.map((value) => <option key={value} value={value}>{JOB_EMPLOYER_STAGE_LABELS[value]}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!onUpdate || busy !== null || !listingId || (!stage&&!informational)}
            onClick={() => run('apply')}
            className="inline-flex min-h-9 items-center gap-1 rounded bg-sky-600 px-3 py-1 font-semibold text-white disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" /> {busy === 'apply' ? 'Applying…' : 'Apply'}
          </button>
          <button
            type="button"
            disabled={!onUpdate || busy !== null}
            onClick={() => run('dismiss')}
            className="inline-flex min-h-9 items-center gap-1 rounded border border-slate-300 px-3 py-1 font-semibold text-slate-600 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
          >
            <X className="h-3.5 w-3.5" /> {busy === 'dismiss' ? 'Dismissing…' : 'Dismiss'}
          </button>
        </div>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
    </article>
  );
}

function formatAgo(milliseconds: number): string {
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}
