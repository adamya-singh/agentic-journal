'use client';

import React from 'react';
import { CheckCheck, ChevronDown, ChevronRight, ExternalLink, Images, Search, Star, Trash2 } from 'lucide-react';
import type {
  JobApplicationCategory,
  JobApplicationAnswer,
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
import { ApplicationReviewPanel } from './ApplicationReviewPanel';
import { EmailUpdatesPanel } from './EmailUpdatesPanel';
import { EMPLOYER_STAGE_STYLES } from './EmployerStageBadge';
import { JOB_EMPLOYER_STAGE_LABELS, type JobEmailUpdateRequest } from '@/lib/job-email-updates';
import {
  JOB_BOARD_STAGES,
  JOB_BOARD_STAGE_LABELS,
  groupJobBoardStages,
  lastEmployerReplyAt,
  type JobBoardStage,
} from '@/lib/job-board-stages';

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
  onApplicationReview?: (reviewId: string, action: 'confirm' | 'correct' | 'leave-blank', answer?: JobApplicationAnswer) => Promise<void>;
  onApplicationReviewRedo?: (reviewId: string, instructions: string) => Promise<void>;
  onApplicationCancel?: (listingId: string, reason: string) => Promise<void>;
  onApplicationReviewConfirmAll?: (listingId: string) => Promise<void>;
  onEmailUpdate?: (request: JobEmailUpdateRequest) => Promise<void>;
  /** Pushes an application's next autopilot date (draft or auto-submit) back by a day. */
  onExtendAutopilot?: (listingId: string) => Promise<void>;
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

const STAGE_STORAGE_KEY = 'jobs.board.stage';
const PAGE_SIZE = 50;

/** One sentence under the table title saying what the selected stage holds. */
const STAGE_HINTS: Record<JobBoardStage, string> = {
  needs: 'Applications paused until you answer their questions. Answer them from Needs you above.',
  queued: 'Saved postings the worker hasn’t started. It only starts ones in a category you apply to.',
  applying: 'Applications OpenClaw has open now or is between attempts on.',
  submitted: 'Sent and waiting on the employer.',
  heard: 'Employers that replied with an assessment, interview, offer or rejection.',
  closed: 'Applications stopped because the posting disappeared, the role filled, or you cancelled.',
  archived: 'Postings you archived before an application went out.',
};

const STAGE_BARS: Record<JobBoardStage, string> = {
  needs: 'bg-amber-400',
  queued: 'bg-slate-300 dark:bg-slate-500',
  applying: 'bg-blue-500',
  submitted: 'bg-emerald-500',
  heard: 'bg-violet-500',
  closed: 'bg-slate-400 dark:bg-slate-600',
  archived: 'bg-slate-300 dark:bg-slate-600',
};

type RowLayout = 'listing' | 'working' | 'sent' | 'closed';

const STAGE_LAYOUT: Record<JobBoardStage, RowLayout> = {
  needs: 'working',
  queued: 'listing',
  applying: 'working',
  submitted: 'sent',
  heard: 'sent',
  closed: 'closed',
  archived: 'listing',
};

// Desktop column templates; below lg each row stacks into a two-line card.
const ROW_GRID: Record<RowLayout, string> = {
  listing: 'lg:grid-cols-[1.75rem_minmax(0,1fr)_8.5rem_9rem_7rem_4.5rem_1.25rem]',
  working: 'lg:grid-cols-[1.75rem_minmax(0,1fr)_8.5rem_9rem_9rem_1.25rem]',
  sent: 'lg:grid-cols-[minmax(0,1fr)_8.5rem_4.5rem_9.5rem_6.5rem_1.25rem]',
  closed: 'lg:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)_1.25rem]',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function getStatus(listing: JobListing): JobListingStatus {
  return listing.status ?? 'saved';
}

function getSource(listing: JobListing): { name: string; link: string } {
  return {
    name: listing.source?.name || 'Unknown',
    link: listing.source?.link || listing.link,
  };
}

function parseDate(value?: string): Date | null {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value?: string): string {
  const date = parseDate(value);
  return date ? DATE_FORMATTER.format(date) : 'Not listed';
}

function formatShortDate(value?: string): string {
  const date = parseDate(value);
  return date ? SHORT_DATE_FORMATTER.format(date) : '—';
}

function formatPostedDate(listing: JobListing): string {
  const postedDate = formatDate(listing.postedDate);
  const postedDateText = listing.postedDateText?.trim();

  if (postedDateText && postedDate !== 'Not listed') {
    return `${postedDateText} (${postedDate})`;
  }

  return postedDateText || postedDate;
}

function displaySalary(salary: string): string | null {
  const value = salary?.trim();
  return !value || /^(not listed|unknown|n\/a)$/i.test(value) ? null : value;
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
  onApplicationReview,
  onApplicationReviewRedo,
  onApplicationReviewConfirmAll,
  onApplicationCancel,
  onEmailUpdate,
  onExtendAutopilot,
}: JobListingsProps) {
  const [pendingListingId, setPendingListingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [stage, setStageState] = React.useState<JobBoardStage>('queued');
  const [query, setQuery] = React.useState('');
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const [openRowId, setOpenRowId] = React.useState<string | null>(null);
  const [spotCheckOpen, setSpotCheckOpen] = React.useState(false);
  const [answerBankOpen, setAnswerBankOpen] = React.useState(false);
  const [selectedApplicationId, setSelectedApplicationId] = React.useState<string | null>(null);
  const [categoryAction, setCategoryAction] = React.useState<JobApplicationCategory | null>(null);
  const answerBankRef = React.useRef<HTMLDivElement>(null);
  const postingsRef = React.useRef<HTMLElement>(null);

  // Deep link from the Overview: /jobs?application=<listingId> opens that record.
  React.useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('application');
    if (id) setSelectedApplicationId(id);
    try {
      const saved = window.localStorage.getItem(STAGE_STORAGE_KEY);
      if (saved && (JOB_BOARD_STAGES as string[]).includes(saved)) setStageState(saved as JobBoardStage);
    } catch {}
  }, []);

  React.useEffect(() => {
    if (answerBankOpen) answerBankRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [answerBankOpen]);

  const setStage = (next: JobBoardStage, scroll = false) => {
    setStageState(next);
    setLimit(PAGE_SIZE);
    setOpenRowId(null);
    try {
      window.localStorage.setItem(STAGE_STORAGE_KEY, next);
    } catch {}
    if (scroll) postingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const allListings = React.useMemo(() => data?.listings ?? [], [data]);
  const records = React.useMemo(() => applications?.applications ?? {}, [applications]);
  const stages = React.useMemo(() => groupJobBoardStages(allListings, records), [allListings, records]);

  // Review queue split: answers on unsent applications block a submission;
  // answers on sent ones are an optional spot-check.
  const review = React.useMemo(() => {
    const blocking = new Set<string>();
    const auditApps = new Set<string>();
    const auditByListing = new Map<string, number>();
    let auditAnswers = 0;
    for (const item of applications?.reviewItems ?? []) {
      const record = records[item.listingId];
      const sent = Boolean(record?.submittedAt || item.submittedAt || record?.status === 'closed');
      if (item.status === 'pending') {
        if (sent) {
          auditApps.add(item.listingId);
          auditAnswers += 1;
          auditByListing.set(item.listingId, (auditByListing.get(item.listingId) ?? 0) + 1);
        } else {
          blocking.add(item.listingId);
        }
      } else if (item.status === 'redo-requested' && !sent) {
        const question = record?.questions.find((candidate) => candidate.id === item.questionId);
        if (question?.resolution === 'pending' && question.redoRequest) blocking.add(item.listingId);
      }
    }
    return { blocking: blocking.size, auditApps: auditApps.size, auditAnswers, auditByListing };
  }, [applications, records]);

  // Same rows NeedsYouQueue lists: drafts held only for review live in the review panel.
  const questionCount = stages.needs.filter((listing) => {
    const record = records[listing.id];
    return record?.questions.some((question) => question.resolution === 'pending' && !question.redoRequest);
  }).length;
  const emailCount = applications?.emailUpdates.pending.length ?? 0;
  const waitingCount = questionCount + review.blocking + emailCount;
  const unstartedQueued = stages.queued.filter((listing) => records[listing.id]?.status === 'unstarted').length;

  const normalizedQuery = query.trim().toLowerCase();
  const stageListings = normalizedQuery
    ? stages[stage].filter((listing) =>
        `${listing.company} ${listing.positionTitle} ${listing.location}`.toLowerCase().includes(normalizedQuery))
    : stages[stage];
  const visibleListings = stageListings.slice(0, limit);
  const layout = STAGE_LAYOUT[stage];

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
    if (status === 'applied' || status === 'archived') {
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
  const maxStageCount = Math.max(1, ...JOB_BOARD_STAGES.map((candidate) => stages[candidate].length));

  return (
    <>
      <div className="flex flex-col gap-8 pb-12 lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
        <aside className="order-2 space-y-6 lg:sticky lg:top-4 lg:order-1">
          <WorkerStatusPanel
            listings={allListings}
            applications={applications ?? null}
            onControl={onApplicationControl}
            onEmailUpdate={onEmailUpdate}
            onOpenApplication={(listingId) => setSelectedApplicationId(listingId)}
            onError={setActionError}
          />

          <fieldset disabled={!applications || !onApplicationCategoriesChange || categoryAction !== null}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Apply to
              {categoryAction && <span className="ml-2 font-normal normal-case tracking-normal">Saving…</span>}
            </legend>
            <div className="mt-2 space-y-0.5">
              {APPLICATION_CATEGORIES.map((category) => (
                <label
                  key={category}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 dark:text-slate-200 dark:hover:bg-slate-800/60"
                >
                  <input
                    type="checkbox"
                    checked={applications?.enabledApplicationCategories.includes(category) ?? false}
                    onChange={() => toggleApplicationCategory(category)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="flex-1">{APPLICATION_CATEGORY_LABELS[category]}</span>
                  <span className="text-xs tabular-nums text-slate-400">{applications?.categoryCounts[category] ?? 0}</span>
                </label>
              ))}
            </div>
            {applications && applications.workerEnabled && applications.eligibleBacklog === 0 && unstartedQueued > 0 && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                None of the {unstartedQueued} queued postings are in a category you apply to, so the worker has nothing new to start.
              </p>
            )}
            {applications && !applications.readiness.ready && (
              <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                Missing: {applications.readiness.missingFiles.join(', ')}
              </p>
            )}
          </fieldset>

          <nav aria-label="Pipeline">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Pipeline</h3>
            <div className="mt-2 space-y-0.5">
              {JOB_BOARD_STAGES.map((candidate) => {
                const count = stages[candidate].length;
                return (
                  <button
                    key={candidate}
                    type="button"
                    onClick={() => setStage(candidate, true)}
                    aria-current={stage === candidate ? 'true' : undefined}
                    className={`flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm transition ${
                      stage === candidate
                        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-200'
                        : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="w-24 shrink-0">{JOB_BOARD_STAGE_LABELS[candidate]}</span>
                    <span className="h-1.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
                      <span
                        className={`block h-1.5 rounded-full ${STAGE_BARS[candidate]}`}
                        style={{ width: `${count ? Math.max(4, (count / maxStageCount) * 100) : 0}%` }}
                      />
                    </span>
                    <span className="w-8 shrink-0 text-right text-xs tabular-nums text-slate-500 dark:text-slate-400">
                      {loading && !data ? '…' : count}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>

          <button
            type="button"
            onClick={() => setAnswerBankOpen((open) => !open)}
            aria-expanded={answerBankOpen}
            className="inline-flex items-center gap-1 px-2 text-sm font-medium text-indigo-600 hover:text-indigo-800 dark:text-indigo-300 dark:hover:text-indigo-200"
          >
            Saved answers{applications ? ` (${applications.answerBank.length})` : ''}
            <ChevronRight className={`h-4 w-4 transition ${answerBankOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
          </button>
        </aside>

        <div className="order-1 min-w-0 space-y-10 lg:order-2">
          {(error || applicationsError || actionError) && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {error || applicationsError || actionError}
            </div>
          )}

          <section aria-labelledby="needs-you-heading" className="space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="needs-you-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Needs you
                <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                  {applicationsLoading && !applications ? 'Checking…' : `${waitingCount} waiting`}
                </span>
              </h2>
              {waitingCount > 0 && (
                <span className="text-xs text-slate-500 dark:text-slate-400">Approvals first, then employer emails, then oldest questions</span>
              )}
            </div>
            {applications && waitingCount === 0 && (
              <p className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                Nothing is waiting on you. Questions, approvals and unmatched employer emails show up here.
              </p>
            )}
            <ApplicationReviewPanel
              scope="blocking"
              applications={applications ?? null}
              onResolve={onApplicationReview}
              onRedo={onApplicationReviewRedo}
              onConfirmAll={onApplicationReviewConfirmAll}
              onCancel={onApplicationCancel}
              onExtend={onExtendAutopilot}
              onOpenApplication={(listingId) => setSelectedApplicationId(listingId)}
            />
            <EmailUpdatesPanel
              listings={allListings}
              applications={applications ?? null}
              onUpdate={onEmailUpdate}
            />
            <NeedsYouQueue
              listings={allListings}
              applications={applications ?? null}
              onOpen={(listingId) => setSelectedApplicationId(listingId)}
              onExtend={onExtendAutopilot}
            />
            {review.auditAnswers > 0 && (
              <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700">
                <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                  <CheckCheck className="h-4 w-4 shrink-0 text-violet-500" aria-hidden="true" />
                  <span className="min-w-0 flex-1 text-slate-600 dark:text-slate-300">
                    <span className="font-medium text-slate-900 dark:text-slate-100">{review.auditAnswers} answers</span>{' '}
                    on {review.auditApps} sent application{review.auditApps === 1 ? '' : 's'} haven’t been spot-checked. Optional; it trains future drafts.
                  </span>
                  <button
                    type="button"
                    onClick={() => setSpotCheckOpen((open) => !open)}
                    aria-expanded={spotCheckOpen}
                    className="min-h-8 rounded-md border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {spotCheckOpen ? 'Hide spot-check' : 'Start spot-check'}
                  </button>
                </div>
                {spotCheckOpen && (
                  <div className="border-t border-dashed border-slate-300 px-4 py-3 dark:border-slate-700">
                    <ApplicationReviewPanel
                      scope="audit"
                      applications={applications ?? null}
                      onResolve={onApplicationReview}
                      onRedo={onApplicationReviewRedo}
                      onConfirmAll={onApplicationReviewConfirmAll}
                      onCancel={onApplicationCancel}
                      onExtend={onExtendAutopilot}
                      onOpenApplication={(listingId) => setSelectedApplicationId(listingId)}
                    />
                  </div>
                )}
              </div>
            )}
          </section>

          {answerBankOpen && (
            <div ref={answerBankRef} className="scroll-mt-4">
              <AnswerBankPanel onClose={() => setAnswerBankOpen(false)} />
            </div>
          )}

          <section ref={postingsRef} aria-labelledby="postings-heading" className="scroll-mt-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0">
                <h2 id="postings-heading" className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {JOB_BOARD_STAGE_LABELS[stage]}
                  <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                    {loading && !data ? 'Loading…' : `${stages[stage].length} posting${stages[stage].length === 1 ? '' : 's'}`}
                  </span>
                </h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{STAGE_HINTS[stage]}</p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <label className="sr-only" htmlFor="jobs-stage-select">Stage</label>
                <select
                  id="jobs-stage-select"
                  value={stage}
                  onChange={(event) => setStage(event.target.value as JobBoardStage)}
                  className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-700 lg:hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  {JOB_BOARD_STAGES.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {JOB_BOARD_STAGE_LABELS[candidate]} · {stages[candidate].length}
                    </option>
                  ))}
                </select>
                <label className="relative min-w-0 flex-1 sm:w-60 sm:flex-none">
                  <span className="sr-only">Search postings</span>
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <input
                    id="jobs-search"
                    type="search"
                    value={query}
                    onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
                    placeholder="Company, role or location"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white pl-8 pr-2 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>
            </div>

            {stageListings.length === 0 ? (
              <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
                {loading && !data
                  ? 'Loading postings…'
                  : normalizedQuery
                    ? `No ${JOB_BOARD_STAGE_LABELS[stage].toLowerCase()} postings match “${query.trim()}”.`
                    : `Nothing in ${JOB_BOARD_STAGE_LABELS[stage]} right now.`}
              </p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <ColumnHeader layout={layout} stage={stage} />
                <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                  {visibleListings.map((listing) => (
                    <PostingRow
                      key={listing.id}
                      listing={listing}
                      stage={stage}
                      layout={layout}
                      application={records[listing.id]}
                      auditCount={review.auditByListing.get(listing.id) ?? 0}
                      open={openRowId === listing.id}
                      onToggle={() => setOpenRowId((current) => (current === listing.id ? null : listing.id))}
                      pending={pendingListingId === listing.id}
                      canChangeStatus={Boolean(onStatusChange)}
                      onToggleStar={() => toggleStar(listing)}
                      onSetStatus={(status) => setStatus(listing, status)}
                      onOpenApplication={() => setSelectedApplicationId(listing.id)}
                    />
                  ))}
                </ul>
                {stageListings.length > visibleListings.length && (
                  <button
                    type="button"
                    onClick={() => setLimit((current) => current + PAGE_SIZE)}
                    className="flex w-full items-center justify-center gap-1 border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-800/40 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    Showing {visibleListings.length} of {stageListings.length} · Show {Math.min(PAGE_SIZE, stageListings.length - visibleListings.length)} more
                  </button>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
      {selectedListing && selectedApplication && onApplicationSave && (
        <JobApplicationModal
          key={selectedListing.id}
          listing={selectedListing}
          application={selectedApplication}
          onClose={() => setSelectedApplicationId(null)}
          onSave={onApplicationSave}
          onEmailUpdate={onEmailUpdate}
        />
      )}
    </>
  );
}

const HEADER_CELL = 'text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';

function ColumnHeader({ layout, stage }: { layout: RowLayout; stage: JobBoardStage }) {
  const columns: Record<RowLayout, string[]> = {
    listing: ['', 'Company · role', 'Type', 'Location', 'Salary', 'Posted', ''],
    working: ['', 'Company · role', 'Type', 'Location', 'Application', ''],
    sent: ['Company · role', 'Type', stage === 'heard' ? 'Replied' : 'Sent', 'Employer', 'Answers', ''],
    closed: ['Company · role', 'Closed', 'Why', ''],
  };
  return (
    <div className={`hidden gap-x-3 bg-slate-50 px-4 py-2 lg:grid dark:bg-slate-800/60 ${ROW_GRID[layout]}`}>
      {columns[layout].map((label, index) => (
        <span key={index} className={HEADER_CELL}>{label}</span>
      ))}
    </div>
  );
}

function PostingRow({
  listing,
  stage,
  layout,
  application,
  auditCount,
  open,
  onToggle,
  pending,
  canChangeStatus,
  onToggleStar,
  onSetStatus,
  onOpenApplication,
}: {
  listing: JobListing;
  stage: JobBoardStage;
  layout: RowLayout;
  application?: JobApplicationRecord;
  auditCount: number;
  open: boolean;
  onToggle: () => void;
  pending: boolean;
  canChangeStatus: boolean;
  onToggleStar: () => void;
  onSetStatus: (status: JobListingStatus) => void;
  onOpenApplication: () => void;
}) {
  const status = getStatus(listing);
  const salary = displaySalary(listing.salary);
  const detailsId = `posting-details-${listing.id}`;
  const starrable = status !== 'applied' && status !== 'archived';
  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const date = stage === 'heard' ? lastEmployerReplyAt(application) : application?.submittedAt ?? listing.updatedAt;
  const closedWhy = application?.cancelledAt
    ? `Cancelled${application.closedReason ? `: ${application.closedReason}` : ''}`
    : application?.closedReason || '—';

  const star = (
    <button
      type="button"
      onClick={(event) => { stop(event); onToggleStar(); }}
      disabled={!canChangeStatus || pending || !starrable}
      title={!starrable ? 'Only saved postings can be starred' : status === 'starred' ? 'Unstar listing' : 'Star listing'}
      aria-label={status === 'starred' ? 'Unstar listing' : 'Star listing'}
      className="grid h-7 w-7 place-items-center rounded text-slate-300 transition hover:text-amber-500 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-600 dark:hover:text-amber-300"
    >
      <Star className={`h-4 w-4 ${status === 'starred' ? 'fill-amber-400 text-amber-500' : ''}`} aria-hidden="true" />
    </button>
  );
  const pill = application ? (
    <span onClick={stop}>
      <ApplicationStatusButton application={application} onClick={onOpenApplication} />
    </span>
  ) : (
    <span className="text-xs text-slate-400">No application</span>
  );
  const answers = auditCount > 0
    ? <span className="text-xs text-violet-700 dark:text-violet-300">{auditCount} to check</span>
    : <span className="text-xs text-slate-400">Checked</span>;
  const cell = 'hidden min-w-0 truncate text-sm text-slate-600 lg:block dark:text-slate-300';

  return (
    <li>
      <div
        onClick={onToggle}
        className={`grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/40 ${ROW_GRID[layout]} ${open ? 'bg-slate-50 dark:bg-slate-800/40' : ''}`}
      >
        {(layout === 'listing' || layout === 'working') && <div className="hidden lg:block">{star}</div>}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{listing.company}</div>
          <div className="truncate text-sm text-slate-600 dark:text-slate-300">{listing.positionTitle}</div>
          {/* Below lg the columns fold into one line. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 lg:hidden dark:text-slate-400">
            {layout !== 'closed' && <ApplicationCategoryBadges categories={listing.applicationCategories} />}
            {layout === 'closed' ? (
              <span className="min-w-0 truncate">Closed {formatShortDate(application?.closedAt)} · {closedWhy}</span>
            ) : layout === 'sent' ? (
              <>
                <span>{stage === 'heard' ? 'Replied' : 'Sent'} {formatShortDate(date)}</span>
                {pill}
                {auditCount > 0 && answers}
              </>
            ) : (
              <>
                {listing.location && <span>{listing.location}</span>}
                {salary && <span>· {salary}</span>}
                {layout === 'working' && pill}
              </>
            )}
          </div>
        </div>
        {(layout === 'listing' || layout === 'working') && (
          <>
            <div className="hidden lg:block"><ApplicationCategoryBadges categories={listing.applicationCategories} /></div>
            <div className={cell} title={listing.location}>{listing.location || '—'}</div>
          </>
        )}
        {layout === 'listing' && (
          <>
            <div className={cell} title={salary ?? undefined}>{salary ?? <span className="text-slate-400">—</span>}</div>
            <div className={`${cell} tabular-nums text-slate-500`}>{formatShortDate(listing.postedDate || listing.savedAt)}</div>
          </>
        )}
        {layout === 'working' && <div className="hidden lg:block">{pill}</div>}
        {layout === 'sent' && (
          <>
            <div className="hidden lg:block"><ApplicationCategoryBadges categories={listing.applicationCategories} /></div>
            <div className={`${cell} tabular-nums`}>{formatShortDate(date)}</div>
            <div className="hidden lg:block">{pill}</div>
            <div className="hidden lg:block">{answers}</div>
          </>
        )}
        {layout === 'closed' && (
          <>
            <div className={`${cell} tabular-nums`}>{formatShortDate(application?.closedAt)}</div>
            <div className={cell} title={closedWhy}>{closedWhy}</div>
          </>
        )}
        <div className="flex items-center gap-1">
          {(layout === 'listing' || layout === 'working') && <span className="lg:hidden">{star}</span>}
          <button
            type="button"
            onClick={(event) => { stop(event); onToggle(); }}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`${open ? 'Hide' : 'Show'} details for ${listing.company} ${listing.positionTitle}`}
            className="grid h-7 w-5 place-items-center rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {open && (
        <PostingDetails
          id={detailsId}
          listing={listing}
          stage={stage}
          application={application}
          pending={pending}
          canChangeStatus={canChangeStatus}
          onSetStatus={onSetStatus}
          onOpenApplication={onOpenApplication}
        />
      )}
    </li>
  );
}

function PostingDetails({
  id,
  listing,
  stage,
  application,
  pending,
  canChangeStatus,
  onSetStatus,
  onOpenApplication,
}: {
  id: string;
  listing: JobListing;
  stage: JobBoardStage;
  application?: JobApplicationRecord;
  pending: boolean;
  canChangeStatus: boolean;
  onSetStatus: (status: JobListingStatus) => void;
  onOpenApplication: () => void;
}) {
  const status = getStatus(listing);
  const source = getSource(listing);
  const salary = displaySalary(listing.salary);
  const label = 'text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400';
  const button = 'inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800';

  return (
    <div id={id} className="grid gap-5 border-t border-slate-100 bg-slate-50 px-4 py-4 text-sm md:grid-cols-[1fr_1.3fr_1fr] dark:border-slate-800 dark:bg-slate-800/30">
      <div className="min-w-0">
        <div className={label}>About</div>
        <p className="mt-1 text-slate-700 dark:text-slate-200">{listing.companySummary || 'Company description not available yet.'}</p>
      </div>
      <div className="min-w-0">
        <div className={label}>OpenClaw’s notes</div>
        <p className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-slate-700 dark:text-slate-200">{listing.notes || 'No notes'}</p>
      </div>
      <div className="min-w-0 space-y-3">
        <div>
          <div className={label}>Details</div>
          <dl className="mt-1 space-y-0.5 text-slate-600 dark:text-slate-300">
            <div>
              <dt className="inline">Source · </dt>
              <dd className="inline">
                <a href={source.link} target="_blank" rel="noreferrer" className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-300 dark:hover:text-indigo-200">
                  {source.name}
                </a>
              </dd>
            </div>
            <div><dt className="inline">Location · </dt><dd className="inline">{listing.location || 'Not listed'}</dd></div>
            <div><dt className="inline">Salary · </dt><dd className="inline">{salary ?? 'Not listed'}</dd></div>
            <div><dt className="inline">Posted · </dt><dd className="inline">{formatPostedDate(listing)}</dd></div>
            <div><dt className="inline">Saved · </dt><dd className="inline">{formatDate(listing.savedAt ?? listing.createdAt)}</dd></div>
            {listing.statusHistory.length > 0 && (
              <div>
                <dt className="inline">Status changes · </dt>
                <dd className="inline">
                  {listing.statusHistory.map((entry) => `${STATUS_LABELS[entry.status]} ${formatShortDate(entry.changedAt)}`).join(', ')}
                </dd>
              </div>
            )}
          </dl>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href={listing.link} target="_blank" rel="noreferrer" className={button}>
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open posting
          </a>
          {application && (
            <button type="button" onClick={onOpenApplication} className={button}>Open application</button>
          )}
          {stage !== 'closed' && stage !== 'heard' && status !== 'archived' && (
            <select
              value={status}
              disabled={!canChangeStatus || pending}
              onChange={(event) => onSetStatus(event.target.value as JobListingStatus)}
              aria-label={`Status for ${listing.company} ${listing.positionTitle}`}
              className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              {ACTIVE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          {status === 'archived' ? (
            stage === 'archived' && (
              <button type="button" onClick={() => onSetStatus('saved')} disabled={!canChangeStatus || pending} className={button}>
                Restore to saved
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => onSetStatus('archived')}
              disabled={!canChangeStatus || pending}
              className={`${button} text-red-600 dark:text-red-300`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Archive
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ApplicationStatusButton({
  application,
  onClick,
}: {
  application: JobApplicationRecord;
  onClick: () => void;
}) {
  // Redos are OpenClaw's to redraft, so they don't count as questions for Adamya.
  const pendingCount = application.questions.filter(
    (question) => question.resolution === 'pending' && !question.redoRequest,
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
  // Submitted applications open onto their verification screenshots, so the
  // pill says so instead of reading as a passive status badge.
  const screenshotCount =
    application.status === 'submitted' ? (application.screenshotCapture?.screenshots.length ?? 0) : 0;
  // Once the employer has replied, their stage says more than "Submitted".
  const stage =
    application.employerStage && application.employerStage !== 'received'
      ? application.employerStage
      : undefined;
  // Drafted by autopilot and parked until its answers are reviewed.
  const label = application.cancelledAt ? 'Cancelled' : stage
    ? JOB_EMPLOYER_STAGE_LABELS[stage]
    : application.status === 'awaiting-user-input' && application.reviewHoldSince && pendingCount === 0
      ? 'Review answers'
      : labels[application.status];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} — open application details${
        screenshotCount > 0 ? ` and ${screenshotCount} screenshot${screenshotCount === 1 ? '' : 's'}` : ''
      }`}
      className={`inline-flex min-h-7 items-center gap-1 whitespace-nowrap rounded-full py-0.5 pl-2.5 pr-1.5 text-xs font-semibold ring-1 ring-inset transition hover:brightness-95 active:brightness-90 ${stage ? EMPLOYER_STAGE_STYLES[stage] : colors[application.status]}`}
    >
      {label}
      {pendingCount > 0 ? ` · ${pendingCount}` : ''}
      {screenshotCount > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <Images className="h-3.5 w-3.5" aria-hidden="true" />
          {screenshotCount}
        </>
      )}
      <ChevronRight className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
    </button>
  );
}

function ApplicationCategoryBadges({ categories }: { categories: JobApplicationCategory[] }) {
  return (
    <span className="flex flex-wrap gap-1">
      {categories.map((category) => (
        <span
          key={category}
          className="inline-flex whitespace-nowrap rounded-md bg-cyan-50 px-2 py-0.5 text-xs font-semibold text-cyan-700 ring-1 ring-inset ring-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-200 dark:ring-cyan-800"
        >
          {APPLICATION_CATEGORY_LABELS[category]}
        </span>
      ))}
    </span>
  );
}
