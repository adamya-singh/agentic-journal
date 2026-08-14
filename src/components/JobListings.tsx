'use client';

import React from 'react';
import { BriefcaseBusiness, ExternalLink, Star, Trash2 } from 'lucide-react';
import type {
  JobApplicationCategory,
  JobApplicationRecord,
  JobApplicationResumeVariant,
  JobApplicationsViewData,
  JobListing,
  JobListingStatus,
  JobListingsData,
} from '@/lib/types';
import { JobApplicationModal } from './JobApplicationModal';
import type { JobApplicationResponseInput } from './JobApplicationModal';
import { AnswerBankPanel } from './AnswerBankPanel';
import { NeedsYouQueue } from './NeedsYouQueue';
import { WorkerStatusPanel } from './WorkerStatusPanel';

interface JobListingsProps {
  data: JobListingsData | null;
  loading?: boolean;
  error?: string | null;
  onStatusChange?: (id: string, status: JobListingStatus) => Promise<void>;
  applications?: JobApplicationsViewData | null;
  applicationsLoading?: boolean;
  applicationsError?: string | null;
  onApplicationControl?: (action: 'start' | 'pause') => Promise<void>;
  onApplicationCategoriesChange?: (categories: JobApplicationCategory[]) => Promise<void>;
  onApplicationSave?: (
    listingId: string,
    resumeVariant: JobApplicationResumeVariant,
    responses: JobApplicationResponseInput[],
  ) => Promise<{
    success: boolean;
    application?: JobApplicationRecord;
    worker?: { queued?: boolean; enabled?: boolean };
  } | void>;
}

const APPLICATION_CATEGORY_LABELS: Record<JobApplicationCategory, string> = {
  'fall-internship': 'Fall internship',
  'spring-internship': 'Spring internship',
  'summer-internship': 'Summer internship',
  'new-grad': 'New grad',
};

const APPLICATION_CATEGORIES = Object.keys(APPLICATION_CATEGORY_LABELS) as JobApplicationCategory[];

const STATUS_LABELS: Record<JobListingStatus, string> = {
  saved: 'Saved',
  starred: 'Starred',
  applied: 'Applied',
  archived: 'Archived',
};

const ACTIVE_STATUS_OPTIONS: Array<{
  value: Exclude<JobListingStatus, 'archived'>;
  label: string;
}> = [
  { value: 'saved', label: 'Saved' },
  { value: 'starred', label: 'Starred' },
  { value: 'applied', label: 'Applied' },
];

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function getStatus(listing: JobListing): JobListingStatus {
  return listing.status ?? 'saved';
}

function getSource(listing: JobListing): { name: string; link: string } {
  return {
    name: listing.source?.name || 'Unknown',
    link: listing.source?.link || listing.link,
  };
}

function formatDate(value?: string): string {
  if (!value) {
    return 'Not listed';
  }

  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? 'Not listed' : DATE_FORMATTER.format(date);
}

function formatPostedDate(listing: JobListing): string {
  const postedDate = formatDate(listing.postedDate);
  const postedDateText = listing.postedDateText?.trim();

  if (postedDateText && postedDate !== 'Not listed') {
    return `${postedDateText} (${postedDate})`;
  }

  return postedDateText || postedDate;
}

function getStatusHistoryText(listing: JobListing): string {
  if (!listing.statusHistory.length) {
    return 'No status changes yet';
  }

  return listing.statusHistory
    .map((entry) => `${STATUS_LABELS[entry.status]}: ${formatDate(entry.changedAt)}`)
    .join('\n');
}

export function JobListings({
  data,
  loading = false,
  error = null,
  onStatusChange,
  applications,
  applicationsLoading = false,
  applicationsError = null,
  onApplicationControl,
  onApplicationCategoriesChange,
  onApplicationSave,
}: JobListingsProps) {
  const [pendingListingId, setPendingListingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<'active' | 'applied' | 'closed'>('active');
  const [selectedApplicationId, setSelectedApplicationId] = React.useState<string | null>(null);
  const [categoryAction, setCategoryAction] = React.useState<JobApplicationCategory | null>(null);
  const nonArchivedListings = (data?.listings ?? []).filter(
    (listing) => getStatus(listing) !== 'archived',
  );
  const activeListings = nonArchivedListings
    .filter((listing) => getStatus(listing) !== 'applied')
    .sort((first, second) => {
      const firstStarred = getStatus(first) === 'starred';
      const secondStarred = getStatus(second) === 'starred';

      if (firstStarred === secondStarred) {
        return 0;
      }

      return firstStarred ? -1 : 1;
    });
  const appliedListings = nonArchivedListings.filter((listing) => getStatus(listing) === 'applied');
  // Closing an application archives its listing, so the closed view is the
  // join of archived listings with a recorded closed application.
  const closedListings = (data?.listings ?? [])
    .filter(
      (listing) =>
        getStatus(listing) === 'archived' &&
        applications?.applications[listing.id]?.status === 'closed',
    )
    .sort(
      (first, second) =>
        Date.parse(applications?.applications[second.id]?.closedAt ?? '') -
        Date.parse(applications?.applications[first.id]?.closedAt ?? ''),
    );
  const listings =
    viewMode === 'active' ? activeListings : viewMode === 'applied' ? appliedListings : closedListings;
  const closedMode = viewMode === 'closed';

  const setStatus = async (listing: JobListing, status: JobListingStatus) => {
    if (!onStatusChange || pendingListingId) {
      return;
    }

    setPendingListingId(listing.id);
    setActionError(null);
    try {
      await onStatusChange(listing.id, status);
    } catch (statusError) {
      setActionError(
        statusError instanceof Error ? statusError.message : 'Failed to update listing',
      );
    } finally {
      setPendingListingId(null);
    }
  };

  const toggleStar = async (listing: JobListing) => {
    const status = getStatus(listing);
    if (status === 'applied') {
      return;
    }

    await setStatus(listing, status === 'starred' ? 'saved' : 'starred');
  };

  const toggleApplicationCategory = async (category: JobApplicationCategory) => {
    if (!applications || !onApplicationCategoriesChange || categoryAction) return;
    const enabled = applications.enabledApplicationCategories.includes(category);
    const nextCategories = enabled
      ? applications.enabledApplicationCategories.filter((candidate) => candidate !== category)
      : APPLICATION_CATEGORIES.filter(
          (candidate) =>
            candidate === category || applications.enabledApplicationCategories.includes(candidate),
        );
    setCategoryAction(category);
    setActionError(null);
    try {
      await onApplicationCategoriesChange(nextCategories);
    } catch (categoryError) {
      setActionError(
        categoryError instanceof Error
          ? categoryError.message
          : 'Failed to update application categories',
      );
    } finally {
      setCategoryAction(null);
    }
  };

  const selectedListing = data?.listings.find((listing) => listing.id === selectedApplicationId);
  const selectedApplication = selectedApplicationId
    ? applications?.applications[selectedApplicationId]
    : undefined;

  return (
    <>
      <section className="w-full px-4 pb-12 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-7xl rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-700 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                <BriefcaseBusiness className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100">
                  Job Listings
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  OpenClaw-maintained opportunities
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:items-end">
              <div
                role="group"
                aria-label="Listing view"
                className="inline-flex overflow-hidden rounded-md border border-slate-300 shadow-sm dark:border-slate-700"
              >
                {(
                  [
                    { value: 'active', label: `Active · ${activeListings.length}` },
                    { value: 'applied', label: `Applied · ${appliedListings.length}` },
                    { value: 'closed', label: `Closed · ${closedListings.length}` },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setViewMode(option.value)}
                    aria-pressed={viewMode === option.value}
                    className={`h-9 px-3 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-200 dark:focus:ring-indigo-900/60 ${
                      viewMode === option.value
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200'
                        : 'bg-white text-slate-600 hover:bg-slate-50 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {loading
                  ? 'Loading...'
                  : `${listings.length} ${viewMode === 'active' ? '' : `${viewMode} `}listing${listings.length === 1 ? '' : 's'}`}
              </div>
            </div>
          </div>

          {(error || applicationsError || actionError) && (
            <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error || applicationsError || actionError}
            </div>
          )}

          <NeedsYouQueue
            listings={data?.listings ?? []}
            applications={applications ?? null}
            onOpen={(listingId) => setSelectedApplicationId(listingId)}
          />

          <WorkerStatusPanel
            listings={data?.listings ?? []}
            applications={applications ?? null}
            onControl={onApplicationControl}
            onOpenApplication={(listingId) => setSelectedApplicationId(listingId)}
            onError={setActionError}
          />

          <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 px-5 py-3 dark:border-slate-700 dark:bg-slate-950/30">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                {applicationsLoading || !applications ? (
                  <span>Checking application readiness…</span>
                ) : (
                  <>
                    <span>
                      <strong>{applications.eligibleBacklog}</strong> eligible backlog
                    </span>
                    <span>
                      <strong>{applications.counts.unstarted}</strong> total unstarted
                    </span>
                    <span>
                      <strong>{applications.counts.inProgress}</strong> in progress
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        document
                          .getElementById('needs-you-queue')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      }
                      className="text-amber-700 hover:underline dark:text-amber-300"
                    >
                      <strong>{applications.counts.awaitingInput}</strong> awaiting input
                    </button>
                    <span>
                      <strong>{applications.counts.submitted}</strong> submitted
                    </span>
                    {!applications.readiness.ready && (
                      <span className="font-medium text-amber-700 dark:text-amber-300">
                        Missing: {applications.readiness.missingFiles.join(', ')}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
            <fieldset
              disabled={!applications || !onApplicationCategoriesChange || categoryAction !== null}
            >
              <legend className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                Apply to
                {categoryAction && <span className="ml-2 font-normal text-slate-500">Saving…</span>}
              </legend>
              <div className="flex flex-wrap gap-2">
                {APPLICATION_CATEGORIES.map((category) => {
                  const checked =
                    applications?.enabledApplicationCategories.includes(category) ?? false;
                  return (
                    <label
                      key={category}
                      className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${checked ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-200' : 'border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'} has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleApplicationCategory(category)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span>{APPLICATION_CATEGORY_LABELS[category]}</span>
                      <span className="text-slate-400">
                        {applications?.categoryCounts[category] ?? 0}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <AnswerBankPanel />

          {listings.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-base font-medium text-slate-700 dark:text-slate-200">
                {viewMode === 'applied'
                  ? 'No applied job listings yet.'
                  : viewMode === 'closed'
                    ? 'No closed applications yet.'
                    : 'No active job listings yet.'}
              </p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {viewMode === 'applied'
                  ? 'Jobs marked applied will appear here.'
                  : viewMode === 'closed'
                    ? 'Applications the worker closes (posting gone, role filled) land here.'
                    : 'OpenClaw can add opportunities here as it finds them.'}
              </p>
            </div>
          ) : (
            <>
              {/* Mobile card list */}
              <ul className="sm:hidden divide-y divide-slate-200 dark:divide-slate-700">
                {listings.map((listing) => {
                  const status = getStatus(listing);
                  const source = getSource(listing);
                  const pending = pendingListingId === listing.id;
                  const starDisabled = !onStatusChange || pending || status === 'applied';
                  const application = applications?.applications[listing.id];

                  return (
                    <li key={listing.id} className="px-4 py-4 space-y-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-semibold text-slate-900 dark:text-slate-100 break-words">
                            {listing.company}
                          </div>
                          <div className="mt-0.5 text-sm text-slate-700 dark:text-slate-200 break-words">
                            {listing.positionTitle}
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 break-words">
                            {listing.companySummary || 'Company description not available yet.'}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => toggleStar(listing)}
                            disabled={starDisabled}
                            title={
                              status === 'applied'
                                ? 'Applied listings use the status dropdown'
                                : status === 'starred'
                                  ? 'Unstar listing'
                                  : 'Star listing'
                            }
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-amber-950/30 dark:hover:text-amber-300"
                            aria-label={status === 'starred' ? 'Unstar listing' : 'Star listing'}
                          >
                            <Star
                              className={`h-4 w-4 ${status === 'starred' ? 'fill-amber-400 text-amber-500' : ''}`}
                              aria-hidden="true"
                            />
                          </button>
                          <button
                            type="button"
                            onClick={() => setStatus(listing, 'archived')}
                            disabled={!onStatusChange || pending}
                            title="Archive listing"
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                            aria-label="Archive listing"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                        <ApplicationCategoryBadges categories={listing.applicationCategories} />
                        <span className="break-words">{listing.location}</span>
                        <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">
                          |
                        </span>
                        <span className="break-words">{listing.salary}</span>
                        {application && (
                          <ApplicationStatusButton
                            application={application}
                            onClick={() => setSelectedApplicationId(listing.id)}
                          />
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        <a
                          href={listing.link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                        >
                          Open posting
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                        </a>
                        <a
                          href={source.link}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 break-words font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                        >
                          {source.name}
                          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                        </a>
                      </div>

                      <details className="text-xs text-slate-600 dark:text-slate-300">
                        <summary className="cursor-pointer select-none font-semibold text-slate-700 dark:text-slate-200">
                          Notes
                        </summary>
                        <p className="mt-2 whitespace-pre-wrap break-words">
                          {listing.notes || 'No notes'}
                        </p>
                      </details>

                      <dl className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                        <div>
                          <dt className="inline font-semibold text-slate-700 dark:text-slate-200">
                            Posted:{' '}
                          </dt>
                          <dd className="inline">{formatPostedDate(listing)}</dd>
                        </div>
                        <div>
                          <dt className="inline font-semibold text-slate-700 dark:text-slate-200">
                            Saved:{' '}
                          </dt>
                          <dd className="inline">
                            {formatDate(listing.savedAt ?? listing.createdAt)}
                          </dd>
                        </div>
                      </dl>

                      {closedMode ? (
                        <div className="text-xs text-slate-600 dark:text-slate-300">
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            Closed:{' '}
                          </span>
                          {formatDate(application?.closedAt)}
                          {application?.closedReason ? ` — ${application.closedReason}` : ''}
                        </div>
                      ) : (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                            Status
                          </label>
                          <select
                            value={status === 'archived' ? 'saved' : status}
                            disabled={!onStatusChange || pending}
                            onChange={(event) =>
                              setStatus(listing, event.target.value as JobListingStatus)
                            }
                            className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-indigo-400 dark:focus:ring-indigo-900/60"
                            aria-label={`Status for ${listing.company} ${listing.positionTitle}`}
                          >
                            {ACTIVE_STATUS_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>

              {/* Desktop table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
                  <thead className="bg-slate-50 dark:bg-slate-800/70">
                    <tr>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Actions
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Application
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Link
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Company
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Position
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Location
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Type
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Salary
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Source
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Notes
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Dates
                      </th>
                      <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
                    {listings.map((listing) => {
                      const status = getStatus(listing);
                      const source = getSource(listing);
                      const pending = pendingListingId === listing.id;
                      const starDisabled = !onStatusChange || pending || status === 'applied';
                      const application = applications?.applications[listing.id];

                      return (
                        <tr key={listing.id} className="align-top">
                          <td className="px-5 py-4 text-left text-sm">
                            <div className="flex justify-start gap-2">
                              <button
                                type="button"
                                onClick={() => toggleStar(listing)}
                                disabled={starDisabled}
                                title={
                                  status === 'applied'
                                    ? 'Applied listings use the status dropdown'
                                    : status === 'starred'
                                      ? 'Unstar listing'
                                      : 'Star listing'
                                }
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-amber-950/30 dark:hover:text-amber-300"
                                aria-label={
                                  status === 'starred' ? 'Unstar listing' : 'Star listing'
                                }
                              >
                                <Star
                                  className={`h-4 w-4 ${status === 'starred' ? 'fill-amber-400 text-amber-500' : ''}`}
                                  aria-hidden="true"
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => setStatus(listing, 'archived')}
                                disabled={!onStatusChange || pending}
                                title="Archive listing"
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-red-950/30 dark:hover:text-red-300"
                                aria-label="Archive listing"
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" />
                              </button>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-sm">
                            {application ? (
                              <ApplicationStatusButton
                                application={application}
                                onClick={() => setSelectedApplicationId(listing.id)}
                              />
                            ) : (
                              <span className="text-xs text-slate-400">Not eligible</span>
                            )}
                          </td>
                          <td className="px-5 py-4 text-sm">
                            <a
                              href={listing.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 whitespace-nowrap font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                            >
                              Open
                              <ExternalLink className="h-4 w-4" aria-hidden="true" />
                            </a>
                          </td>
                          <td className="max-w-48 px-5 py-4 text-sm font-semibold text-slate-900 dark:text-slate-100">
                            <span className="block break-words">{listing.company}</span>
                            <span className="mt-1 block text-xs font-normal leading-5 text-slate-500 dark:text-slate-400">
                              {listing.companySummary || 'Company description not available yet.'}
                            </span>
                          </td>
                          <td className="max-w-72 px-5 py-4 text-sm text-slate-700 dark:text-slate-200">
                            <span className="block break-words">{listing.positionTitle}</span>
                          </td>
                          <td className="max-w-52 px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                            <span className="block break-words">{listing.location}</span>
                          </td>
                          <td className="px-5 py-4 text-sm">
                            <ApplicationCategoryBadges categories={listing.applicationCategories} />
                          </td>
                          <td className="max-w-44 px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                            <span className="block break-words">{listing.salary}</span>
                          </td>
                          <td className="max-w-44 px-5 py-4 text-sm">
                            <a
                              href={source.link}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 break-words font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200"
                            >
                              {source.name}
                              <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                            </a>
                          </td>
                          <td className="min-w-64 max-w-96 px-5 py-4 text-sm text-slate-600 dark:text-slate-300">
                            <span className="block whitespace-pre-wrap break-words">
                              {listing.notes || 'No notes'}
                            </span>
                          </td>
                          <td className="min-w-44 px-5 py-4 text-xs text-slate-600 dark:text-slate-300">
                            <dl className="space-y-1">
                              <div>
                                <dt className="inline font-semibold text-slate-700 dark:text-slate-200">
                                  Posted:{' '}
                                </dt>
                                <dd className="inline">{formatPostedDate(listing)}</dd>
                              </div>
                              <div>
                                <dt className="inline font-semibold text-slate-700 dark:text-slate-200">
                                  Saved:{' '}
                                </dt>
                                <dd className="inline">
                                  {formatDate(listing.savedAt ?? listing.createdAt)}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-semibold text-slate-700 dark:text-slate-200">
                                  Status changes:
                                </dt>
                                <dd className="mt-0.5 whitespace-pre-wrap">
                                  {getStatusHistoryText(listing)}
                                </dd>
                              </div>
                            </dl>
                          </td>
                          <td className="px-5 py-4 text-sm">
                            {closedMode ? (
                              <div className="min-w-40 text-xs text-slate-600 dark:text-slate-300">
                                <div className="font-semibold text-slate-700 dark:text-slate-200">
                                  Closed {formatDate(application?.closedAt)}
                                </div>
                                {application?.closedReason && (
                                  <div className="mt-0.5 break-words">
                                    {application.closedReason}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <select
                                value={status === 'archived' ? 'saved' : status}
                                disabled={!onStatusChange || pending}
                                onChange={(event) =>
                                  setStatus(listing, event.target.value as JobListingStatus)
                                }
                                className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-indigo-400 dark:focus:ring-indigo-900/60"
                                aria-label={`Status for ${listing.company} ${listing.positionTitle}`}
                              >
                                {ACTIVE_STATUS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </section>
      {selectedListing && selectedApplication && onApplicationSave && (
        <JobApplicationModal
          key={selectedListing.id}
          listing={selectedListing}
          application={selectedApplication}
          onClose={() => setSelectedApplicationId(null)}
          onSave={onApplicationSave}
        />
      )}
    </>
  );
}

function ApplicationStatusButton({
  application,
  onClick,
}: {
  application: JobApplicationRecord;
  onClick: () => void;
}) {
  const pendingCount = application.questions.filter(
    (question) => question.resolution === 'pending',
  ).length;
  const labels: Record<JobApplicationRecord['status'], string> = {
    unstarted: 'Unstarted',
    'in-progress': 'In progress',
    'awaiting-user-input': 'Needs input',
    submitted: 'Submitted',
    closed: 'Closed',
  };
  const colors: Record<JobApplicationRecord['status'], string> = {
    unstarted:
      'bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:ring-slate-700',
    'in-progress':
      'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-800',
    'awaiting-user-input':
      'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800',
    submitted:
      'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800',
    closed:
      'bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset transition hover:brightness-95 ${colors[application.status]}`}
    >
      {labels[application.status]}
      {pendingCount > 0 ? ` · ${pendingCount}` : ''}
    </button>
  );
}

function ApplicationCategoryBadges({ categories }: { categories: JobApplicationCategory[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {categories.map((category) => (
        <span
          key={category}
          className="inline-flex whitespace-nowrap rounded-md bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700 ring-1 ring-inset ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-800"
        >
          {APPLICATION_CATEGORY_LABELS[category]}
        </span>
      ))}
    </span>
  );
}
