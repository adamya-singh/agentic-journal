'use client';

import React from 'react';
import Link from 'next/link';
import {
  Archive,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleX,
  Cog,
  ExternalLink,
  Hand,
  Images,
  ListOrdered,
  Mail,
  MessageSquareText,
  Search,
  Send,
  Star,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type {
  JobApplicationCategory,
  JobApplicationAnswer,
  JobApplicationAnswerScope,
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
import { CompanyLogo } from './mission/CompanyLogo';
import { BOARD_CSS } from './mission/board-css';
import { CATEGORY_COLOR, EMPLOYER_STAGE_COLOR } from './mission/colors';
import { MISSION_JOBS_CSS } from './mission/jobs-css';
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
    options?: { submittedByHand?: boolean },
  ) => Promise<{
    success: boolean;
    application?: JobApplicationRecord;
    worker?: { queued?: boolean; enabled?: boolean };
  } | void>;
  onApplicationReview?: (reviewId: string, action: 'confirm' | 'correct' | 'leave-blank', answer?: JobApplicationAnswer, scope?: JobApplicationAnswerScope) => Promise<void>;
  onApplicationReviewRedo?: (reviewId: string, instructions: string) => Promise<void>;
  onApplicationCancel?: (listingId: string, reason: string) => Promise<void>;
  onApplicationReviewConfirmAll?: (listingId: string, scopes?: Record<string, JobApplicationAnswerScope>) => Promise<void>;
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

// The pipeline's hues on the Mission trajectory; amber is the stage waiting on you.
const STAGE_COLORS: Record<JobBoardStage, string> = {
  needs: 'var(--now)',
  queued: 'var(--c-other)',
  applying: 'var(--em)',
  submitted: 'var(--c-tech)',
  heard: 'var(--c-screen)',
  closed: 'var(--dim)',
  archived: 'var(--dim)',
};

const STAGE_ICONS: Record<JobBoardStage, LucideIcon> = {
  needs: Hand,
  queued: ListOrdered,
  applying: Cog,
  submitted: Send,
  heard: Mail,
  closed: CircleX,
  archived: Archive,
};

const HEARD_FEED_SIZE = 8;

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

// Desktop column templates (star, logo, company · role, …); below lg each row stacks into a two-line card.
const ROW_COLUMNS: Record<RowLayout, string> = {
  listing: '28px 34px minmax(0,1fr) 9.5rem 10rem 8rem 4.5rem 56px',
  working: '28px 34px minmax(0,1fr) 9.5rem 10rem 10rem 56px',
  sent: '34px minmax(0,1fr) 9.5rem 5rem 10rem 6.5rem 56px',
  closed: '34px minmax(0,1fr) 5.5rem minmax(0,1fr) 56px',
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
  const enabledCategories = new Set(applications?.enabledApplicationCategories ?? []);
  const openApplication = (listingId: string) => setSelectedApplicationId(listingId);
  const count = (candidate: JobBoardStage) => (loading && !data ? '…' : stages[candidate].length);

  const heardCounts = stages.heard.reduce(
    (acc, listing) => {
      if (records[listing.id]?.employerStage === 'rejected') acc.rejected += 1;
      else acc.moving += 1;
      return acc;
    },
    { rejected: 0, moving: 0 },
  );
  const stageNote: Record<JobBoardStage, string> = {
    needs: review.blocking
      ? `${questionCount} with questions · ${review.blocking} to approve`
      : `${questionCount} with questions`,
    queued: applications ? `${applications.eligibleBacklog} in a category you apply to` : '',
    applying: 'open now or between attempts',
    submitted: 'waiting on employers',
    heard: `${heardCounts.moving} moving · ${heardCounts.rejected} rejected`,
    closed: 'posting gone or cancelled',
    archived: 'set aside before applying',
  };

  return (
    <>
      <div className="mi dark">
        <style>{MISSION_JOBS_CSS + BOARD_CSS}</style>
        <div className="mi-top">
          <h1 className="mi-title" style={{ margin: 0 }}>Applications <i>board</i></h1>
          <button
            type="button"
            className="btn sm"
            onClick={() => setAnswerBankOpen((open) => !open)}
            aria-expanded={answerBankOpen}
          >
            <MessageSquareText className="i s" aria-hidden="true" />
            Saved answers
            {applications && <span className="mono" style={{ color: 'var(--dim)' }}>{applications.answerBank.length}</span>}
          </button>
        </div>

        <div className="mi-body">
          {(error || applicationsError || actionError) && (
            <div role="alert" className="err">{error || applicationsError || actionError}</div>
          )}

          <section className="glass hero" aria-label="Autopilot and pipeline">
            <WorkerStatusPanel
              listings={allListings}
              applications={applications ?? null}
              onControl={onApplicationControl}
              onEmailUpdate={onEmailUpdate}
              onOpenApplication={openApplication}
              onError={setActionError}
            />

            <nav className="track" aria-label="Pipeline">
              {JOB_BOARD_STAGES.map((candidate, index) => {
                const ghost = candidate === 'closed' || candidate === 'archived';
                const StageIcon = STAGE_ICONS[candidate];
                return (
                  <React.Fragment key={candidate}>
                    {index === 5 && <span className="div" aria-hidden="true" />}
                    <button
                      type="button"
                      onClick={() => setStage(candidate, true)}
                      aria-current={stage === candidate ? 'true' : undefined}
                      className={`node${ghost ? ' ghost' : ''}`}
                      style={{ ['--k' as string]: STAGE_COLORS[candidate] }}
                    >
                      <span className="ring"><StageIcon className="i" aria-hidden="true" /></span>
                      <b>{count(candidate)}</b>
                      <span className="l">{JOB_BOARD_STAGE_LABELS[candidate]}</span>
                      <span className="s">{stageNote[candidate]}</span>
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>

            <fieldset className="applyto" disabled={!applications || !onApplicationCategoriesChange || categoryAction !== null}>
              <legend className="lab">
                Apply to
                {categoryAction && <span style={{ textTransform: 'none', letterSpacing: 0 }}> · saving…</span>}
              </legend>
              {APPLICATION_CATEGORIES.map((category) => (
                <button
                  key={category}
                  type="button"
                  className="chip"
                  aria-pressed={enabledCategories.has(category)}
                  onClick={() => toggleApplicationCategory(category)}
                >
                  <span className="dot" aria-hidden="true" />
                  {APPLICATION_CATEGORY_LABELS[category]}
                  <small>{applications?.categoryCounts[category] ?? 0}</small>
                </button>
              ))}
              <span className="hint" style={{ marginLeft: 'auto', fontSize: 12.5 }}>The worker only starts postings in a lit category.</span>
              {applications && applications.workerEnabled && applications.eligibleBacklog === 0 && unstartedQueued > 0 && (
                <p className="warn" style={{ margin: 0 }}>
                  None of the {unstartedQueued} queued postings are in a category you apply to, so the worker has nothing new to start.
                </p>
              )}
              {applications && !applications.readiness.ready && (
                <p className="warn" style={{ margin: 0 }}>Missing: {applications.readiness.missingFiles.join(', ')}</p>
              )}
            </fieldset>
          </section>

          <div className="split">
            <section aria-labelledby="needs-you-heading" className="main">
              <div className="sech" style={{ marginBottom: 0 }}>
                <h2 id="needs-you-heading">Needs you</h2>
                <span className="lab">
                  {applicationsLoading && !applications
                    ? 'Checking…'
                    : `${waitingCount} waiting${waitingCount > 0 ? ' · approvals, then emails, then oldest questions' : ''}`}
                </span>
              </div>
              {applications && waitingCount === 0 && (
                <p className="empty" style={{ margin: 0 }}>
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
                onOpenApplication={openApplication}
              />
              <EmailUpdatesPanel listings={allListings} applications={applications ?? null} onUpdate={onEmailUpdate} />
              <NeedsYouQueue
                listings={allListings}
                applications={applications ?? null}
                onOpen={openApplication}
                onExtend={onExtendAutopilot}
              />
            </section>

            <aside className="side" aria-label="Employer replies">
              <section aria-labelledby="heard-heading">
                <div className="sech">
                  <h2 id="heard-heading">Heard back</h2>
                  <span className="lab">{stages.heard.length} {stages.heard.length === 1 ? 'reply' : 'replies'}</span>
                </div>
                <div className="glass" style={{ padding: '6px 12px' }}>
                  {stages.heard.length === 0 ? (
                    <p className="hint" style={{ padding: '10px 4px' }}>No assessments, interviews, offers or rejections yet.</p>
                  ) : (
                    <ol className="tl feed">
                      {stages.heard.slice(0, HEARD_FEED_SIZE).map((listing) => {
                        const record = records[listing.id];
                        const employerStage = record?.employerStage;
                        return (
                          <li key={listing.id}>
                            <button type="button" onClick={() => openApplication(listing.id)}>
                              <CompanyLogo company={listing.company} link={listing.link} size="sm" />
                              <span className="co">{listing.company}</span>
                              <span className="w">{formatShortDate(lastEmployerReplyAt(record))}</span>
                              <span className="st">
                                {employerStage && (
                                  <span className="out" style={{ color: EMPLOYER_STAGE_COLOR[employerStage] }}>
                                    <i />{JOB_EMPLOYER_STAGE_LABELS[employerStage]}
                                  </span>
                                )}
                                <span className="ro">{listing.positionTitle}</span>
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '4px 12px', padding: '10px 4px', borderTop: '1px dashed var(--line)', fontSize: 12.5, whiteSpace: 'nowrap' }}>
                    {stages.heard.length > HEARD_FEED_SIZE ? (
                      <button type="button" style={{ color: 'var(--em)' }} onClick={() => setStage('heard', true)}>
                        All {stages.heard.length} in the table
                      </button>
                    ) : <span />}
                    <Link href="/jobs/overview" style={{ color: 'var(--em)' }}>Response times on Overview →</Link>
                  </div>
                </div>
              </section>

              {review.auditAnswers > 0 && (
                <button type="button" className="more" onClick={() => setSpotCheckOpen((open) => !open)} aria-expanded={spotCheckOpen}>
                  <CheckCheck className="i" style={{ color: 'var(--c-tech)' }} aria-hidden="true" />
                  <span>
                    <b style={{ color: 'var(--ink)' }}>{review.auditAnswers} answers</b> on {review.auditApps} sent application
                    {review.auditApps === 1 ? '' : 's'} are unchecked. Optional; spot-checks train future drafts.
                  </span>
                  <span className="btn sm" style={{ marginLeft: 'auto' }}>{spotCheckOpen ? 'Hide' : 'Spot-check'}</span>
                </button>
              )}
            </aside>
          </div>

          {spotCheckOpen && review.auditAnswers > 0 && (
            <section aria-label="Spot-check sent answers" className="glass" style={{ padding: 16 }}>
              <ApplicationReviewPanel
                scope="audit"
                applications={applications ?? null}
                onResolve={onApplicationReview}
                onRedo={onApplicationReviewRedo}
                onConfirmAll={onApplicationReviewConfirmAll}
                onCancel={onApplicationCancel}
                onExtend={onExtendAutopilot}
                onOpenApplication={openApplication}
              />
            </section>
          )}

          {answerBankOpen && (
            <div ref={answerBankRef} className="scroll-mt-4">
              <AnswerBankPanel onClose={() => setAnswerBankOpen(false)} />
            </div>
          )}

          <section ref={postingsRef} aria-labelledby="postings-heading" className="scroll-mt-4">
            <div className="sech" style={{ marginBottom: 4 }}>
              <h2 id="postings-heading">{JOB_BOARD_STAGE_LABELS[stage]}</h2>
              <span className="lab">
                {loading && !data ? 'Loading…' : `${stages[stage].length} posting${stages[stage].length === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="hint" style={{ margin: '0 0 14px' }}>{STAGE_HINTS[stage]}</p>
            <div className="tblhead">
              <div className="seg" role="group" aria-label="Stage">
                {JOB_BOARD_STAGES.map((candidate) => (
                  <button key={candidate} type="button" aria-pressed={stage === candidate} onClick={() => setStage(candidate)}>
                    {JOB_BOARD_STAGE_LABELS[candidate]} <small>{count(candidate)}</small>
                  </button>
                ))}
              </div>
              <label className="search" style={{ flex: '1 1 220px', maxWidth: 340 }}>
                <Search className="i s" aria-hidden="true" />
                <span className="sr-only">Search postings</span>
                <input
                  id="jobs-search"
                  type="search"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setLimit(PAGE_SIZE); }}
                  placeholder="Company, role or location"
                />
              </label>
            </div>

            {stageListings.length === 0 ? (
              <p className="empty" style={{ margin: 0, padding: '40px 16px' }}>
                {loading && !data
                  ? 'Loading postings…'
                  : normalizedQuery
                    ? `No ${JOB_BOARD_STAGE_LABELS[stage].toLowerCase()} postings match “${query.trim()}”.`
                    : `Nothing in ${JOB_BOARD_STAGE_LABELS[stage]} right now.`}
              </p>
            ) : (
              <div className="glass tbl">
                <ColumnHeader layout={layout} stage={stage} />
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {visibleListings.map((listing) => (
                    <PostingRow
                      key={listing.id}
                      listing={listing}
                      stage={stage}
                      layout={layout}
                      application={records[listing.id]}
                      enabledCategories={enabledCategories}
                      auditCount={review.auditByListing.get(listing.id) ?? 0}
                      open={openRowId === listing.id}
                      onToggle={() => setOpenRowId((current) => (current === listing.id ? null : listing.id))}
                      pending={pendingListingId === listing.id}
                      canChangeStatus={Boolean(onStatusChange)}
                      onToggleStar={() => toggleStar(listing)}
                      onSetStatus={(status) => setStatus(listing, status)}
                      onOpenApplication={() => openApplication(listing.id)}
                    />
                  ))}
                </ul>
                {stageListings.length > visibleListings.length && (
                  <button type="button" className="pager" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
                    Showing {visibleListings.length} of {stageListings.length} · show {Math.min(PAGE_SIZE, stageListings.length - visibleListings.length)} more
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

function ColumnHeader({ layout, stage }: { layout: RowLayout; stage: JobBoardStage }) {
  const columns: Record<RowLayout, string[]> = {
    listing: ['', '', 'Company · role', 'Type', 'Location', 'Salary', 'Posted', ''],
    working: ['', '', 'Company · role', 'Type', 'Location', 'Application', ''],
    sent: ['', 'Company · role', 'Type', stage === 'heard' ? 'Replied' : 'Sent', 'Employer', 'Answers', ''],
    closed: ['', 'Company · role', 'Closed', 'Why', ''],
  };
  return (
    <div className="trow h" style={{ ['--cols' as string]: ROW_COLUMNS[layout] }} aria-hidden="true">
      {columns[layout].map((label, index) => (
        <span key={index} className="lab">{label}</span>
      ))}
    </div>
  );
}

function PostingRow({
  listing,
  stage,
  layout,
  application,
  enabledCategories,
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
  enabledCategories: Set<JobApplicationCategory>;
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
  const starred = layout === 'listing' || layout === 'working';

  const star = (
    <button
      type="button"
      onClick={(event) => { stop(event); onToggleStar(); }}
      disabled={!canChangeStatus || pending || !starrable}
      title={!starrable ? 'Only saved postings can be starred' : status === 'starred' ? 'Unstar listing' : 'Star listing'}
      aria-label={status === 'starred' ? 'Unstar listing' : 'Star listing'}
      aria-pressed={status === 'starred'}
      className="star"
    >
      <Star className="i s" aria-hidden="true" />
    </button>
  );
  const pill = application ? (
    <span onClick={stop}>
      <ApplicationStatusButton application={application} onClick={onOpenApplication} />
    </span>
  ) : (
    <span className="c d">No application</span>
  );
  const answers = auditCount > 0
    ? <span className="c" style={{ color: 'var(--c-screen)' }}>{auditCount} to check</span>
    : <span className="c d">Checked</span>;
  const tags = <CategoryTags categories={listing.applicationCategories} enabled={enabledCategories} />;

  return (
    <li>
      <div onClick={onToggle} className={`trow${open ? ' open' : ''}`} style={{ ['--cols' as string]: ROW_COLUMNS[layout] }}>
        {starred && <span className="cells">{star}</span>}
        <CompanyLogo company={listing.company} link={listing.link} />
        <div style={{ minWidth: 0 }}>
          <div className="co">{listing.company}</div>
          <div className="ro" style={{ color: 'var(--ink2)', fontSize: 13 }}>{listing.positionTitle}</div>
          {/* Below lg the columns fold into one line. */}
          <div className="mob">
            {layout !== 'closed' && tags}
            {layout === 'closed' ? (
              <span style={{ minWidth: 0 }}>Closed {formatShortDate(application?.closedAt)} · {closedWhy}</span>
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
        <span className="cells">
          {starred && (
            <>
              <span>{tags}</span>
              <span className="c" title={listing.location}>{listing.location || '—'}</span>
            </>
          )}
          {layout === 'listing' && (
            <>
              <span className="c m" title={salary ?? undefined}>{salary ?? <span style={{ color: 'var(--dim)' }}>—</span>}</span>
              <span className="c d">{formatShortDate(listing.postedDate || listing.savedAt)}</span>
            </>
          )}
          {layout === 'working' && <span>{pill}</span>}
          {layout === 'sent' && (
            <>
              <span>{tags}</span>
              <span className="c d">{formatShortDate(date)}</span>
              <span>{pill}</span>
              <span>{answers}</span>
            </>
          )}
          {layout === 'closed' && (
            <>
              <span className="c d">{formatShortDate(application?.closedAt)}</span>
              <span className="c" title={closedWhy}>{closedWhy}</span>
            </>
          )}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {starred && <span className="mobonly">{star}</span>}
          <button
            type="button"
            onClick={(event) => { stop(event); onToggle(); }}
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`${open ? 'Hide' : 'Show'} details for ${listing.company} ${listing.positionTitle}`}
            className="star"
          >
            {open ? <ChevronDown className="i s" /> : <ChevronRight className="i s" />}
          </button>
        </span>
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

  return (
    <div id={id} className="det">
      <div style={{ minWidth: 0 }}>
        <div className="lab">About</div>
        <p>{listing.companySummary || 'Company description not available yet.'}</p>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="lab">OpenClaw’s notes</div>
        <p className="notes">{listing.notes || 'No notes'}</p>
      </div>
      <div style={{ minWidth: 0 }}>
        <div className="lab">Details</div>
        <dl>
          <div>
            <dt>Source · </dt>
            <dd><a href={source.link} target="_blank" rel="noreferrer" style={{ color: 'var(--em)' }}>{source.name}</a></dd>
          </div>
          <div><dt>Location · </dt><dd>{listing.location || 'Not listed'}</dd></div>
          <div><dt>Salary · </dt><dd>{salary ?? 'Not listed'}</dd></div>
          <div><dt>Posted · </dt><dd>{formatPostedDate(listing)}</dd></div>
          <div><dt>Saved · </dt><dd>{formatDate(listing.savedAt ?? listing.createdAt)}</dd></div>
          {listing.statusHistory.length > 0 && (
            <div>
              <dt>Status changes · </dt>
              <dd>{listing.statusHistory.map((entry) => `${STATUS_LABELS[entry.status]} ${formatShortDate(entry.changedAt)}`).join(', ')}</dd>
            </div>
          )}
        </dl>
        <div className="acts">
          <a href={listing.link} target="_blank" rel="noreferrer" className="btn sm">
            <ExternalLink className="i s" aria-hidden="true" /> Open posting
          </a>
          {application && (
            <button type="button" onClick={onOpenApplication} className="btn sm">Open application</button>
          )}
          {stage !== 'closed' && stage !== 'heard' && status !== 'archived' && (
            <select
              value={status}
              disabled={!canChangeStatus || pending}
              onChange={(event) => onSetStatus(event.target.value as JobListingStatus)}
              aria-label={`Status for ${listing.company} ${listing.positionTitle}`}
            >
              {ACTIVE_STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          )}
          {status === 'archived' ? (
            stage === 'archived' && (
              <button type="button" onClick={() => onSetStatus('saved')} disabled={!canChangeStatus || pending} className="btn sm">
                Restore to saved
              </button>
            )
          ) : (
            <button type="button" onClick={() => onSetStatus('archived')} disabled={!canChangeStatus || pending} className="btn sm danger">
              <Trash2 className="i s" aria-hidden="true" /> Archive
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const APPLICATION_STATUS_COLOR: Record<JobApplicationRecord['status'], string> = {
  unstarted: 'var(--dim)',
  'in-progress': 'var(--em)',
  'awaiting-user-input': 'var(--now)',
  submitted: 'var(--c-tech)',
  closed: 'var(--dim)',
};

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
      className="pill"
      style={{ ['--k' as string]: stage ? EMPLOYER_STAGE_COLOR[stage] : APPLICATION_STATUS_COLOR[application.status] }}
    >
      {label}
      {pendingCount > 0 ? ` · ${pendingCount}` : ''}
      {screenshotCount > 0 && (
        <>
          <span aria-hidden="true">·</span>
          <Images className="i" aria-hidden="true" />
          {screenshotCount}
        </>
      )}
      <ChevronRight className="i" aria-hidden="true" />
    </button>
  );
}

/** Category tags; a category the worker isn't applying to is striped. */
function CategoryTags({ categories, enabled }: { categories: JobApplicationCategory[]; enabled: Set<JobApplicationCategory> }) {
  return (
    <span className="tags">
      {categories.map((category) => (
        <span
          key={category}
          className={enabled.has(category) ? 'kind' : 'kind off'}
          style={{ ['--k' as string]: CATEGORY_COLOR[category] }}
          title={enabled.has(category) ? undefined : 'Not a category you apply to right now'}
        >
          {APPLICATION_CATEGORY_LABELS[category]}
        </span>
      ))}
    </span>
  );
}
