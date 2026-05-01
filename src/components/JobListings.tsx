'use client';

import React from 'react';
import { BriefcaseBusiness, ExternalLink, Star, Trash2 } from 'lucide-react';
import { JobListing, JobListingStatus, JobListingsData, JobType } from '@/lib/types';

interface JobListingsProps {
  data: JobListingsData | null;
  loading?: boolean;
  error?: string | null;
  onStatusChange?: (id: string, status: JobListingStatus) => Promise<void>;
}

const JOB_TYPE_LABELS: Record<JobType, string> = {
  'fall-coop': 'Fall co-op',
  'spring-coop': 'Spring co-op',
  'new-grad': 'New grad',
};

const STATUS_LABELS: Record<JobListingStatus, string> = {
  saved: 'Saved',
  starred: 'Starred',
  applied: 'Applied',
  archived: 'Archived',
};

const ACTIVE_STATUS_OPTIONS: Array<{ value: Exclude<JobListingStatus, 'archived'>; label: string }> = [
  { value: 'saved', label: 'Saved' },
  { value: 'starred', label: 'Starred' },
  { value: 'applied', label: 'Applied' },
];

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatJobType(jobType: JobType): string {
  return JOB_TYPE_LABELS[jobType] ?? jobType;
}

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

export function JobListings({ data, loading = false, error = null, onStatusChange }: JobListingsProps) {
  const [pendingListingId, setPendingListingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const listings = (data?.listings ?? [])
    .filter((listing) => getStatus(listing) !== 'archived')
    .sort((first, second) => {
      const firstStarred = getStatus(first) === 'starred';
      const secondStarred = getStatus(second) === 'starred';

      if (firstStarred === secondStarred) {
        return 0;
      }

      return firstStarred ? -1 : 1;
    });

  const setStatus = async (listing: JobListing, status: JobListingStatus) => {
    if (!onStatusChange || pendingListingId) {
      return;
    }

    setPendingListingId(listing.id);
    setActionError(null);
    try {
      await onStatusChange(listing.id, status);
    } catch (statusError) {
      setActionError(statusError instanceof Error ? statusError.message : 'Failed to update listing');
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

  return (
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
          <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
            {loading ? 'Loading...' : `${listings.length} listing${listings.length === 1 ? '' : 's'}`}
          </div>
        </div>

        {(error || actionError) && (
          <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error || actionError}
          </div>
        )}

        {listings.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-base font-medium text-slate-700 dark:text-slate-200">
              No job listings yet.
            </p>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              OpenClaw can add opportunities here as it finds them.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800/70">
                <tr>
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
                  <th className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Link
                  </th>
                  <th className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {listings.map((listing) => {
                  const status = getStatus(listing);
                  const source = getSource(listing);
                  const pending = pendingListingId === listing.id;
                  const starDisabled = !onStatusChange || pending || status === 'applied';

                  return (
                    <tr key={listing.id} className="align-top">
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
                        <span className="inline-flex whitespace-nowrap rounded-md bg-cyan-50 px-2 py-1 text-xs font-semibold text-cyan-700 ring-1 ring-inset ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-800">
                          {formatJobType(listing.jobType)}
                        </span>
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
                            <dt className="inline font-semibold text-slate-700 dark:text-slate-200">Posted: </dt>
                            <dd className="inline">{formatPostedDate(listing)}</dd>
                          </div>
                          <div>
                            <dt className="inline font-semibold text-slate-700 dark:text-slate-200">Saved: </dt>
                            <dd className="inline">{formatDate(listing.savedAt ?? listing.createdAt)}</dd>
                          </div>
                          <div>
                            <dt className="font-semibold text-slate-700 dark:text-slate-200">Status changes:</dt>
                            <dd className="mt-0.5 whitespace-pre-wrap">{getStatusHistoryText(listing)}</dd>
                          </div>
                        </dl>
                      </td>
                      <td className="px-5 py-4 text-sm">
                        <select
                          value={status === 'archived' ? 'saved' : status}
                          disabled={!onStatusChange || pending}
                          onChange={(event) => setStatus(listing, event.target.value as JobListingStatus)}
                          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-indigo-400 dark:focus:ring-indigo-900/60"
                          aria-label={`Status for ${listing.company} ${listing.positionTitle}`}
                        >
                          {ACTIVE_STATUS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
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
                      <td className="px-5 py-4 text-right text-sm">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => toggleStar(listing)}
                            disabled={starDisabled}
                            title={status === 'applied' ? 'Applied listings use the status dropdown' : status === 'starred' ? 'Unstar listing' : 'Star listing'}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 text-slate-500 transition hover:bg-amber-50 hover:text-amber-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-amber-950/30 dark:hover:text-amber-300"
                            aria-label={status === 'starred' ? 'Unstar listing' : 'Star listing'}
                          >
                            <Star className={`h-4 w-4 ${status === 'starred' ? 'fill-amber-400 text-amber-500' : ''}`} aria-hidden="true" />
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
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
