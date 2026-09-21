'use client';

/* eslint-disable @next/next/no-img-element -- screenshots use private dynamic URLs and must retain original resolution. */

import React from 'react';
import { CalendarPlus, Check, CheckCheck, ChevronDown, ChevronRight, Clock, Images, MessageCircleQuestion, Pencil, Send, ZoomIn } from 'lucide-react';
import { ScreenshotLightbox } from './ScreenshotLightbox';
import type {
  JobApplicationAnswer,
  JobApplicationQuestion,
  JobApplicationReviewItem,
  JobApplicationsViewData,
} from '@/lib/types';

const COLLAPSED_STORAGE_KEY = 'jobs.reviewPanel.collapsed';
const LOW_CONFIDENCE = 0.7;
const RELEASED_NOTICE_MS = 6000;

type ResolveHandler = (reviewId: string, action: 'confirm' | 'correct', answer?: JobApplicationAnswer) => Promise<void>;

interface ReviewGroup {
  listingId: string;
  company: string;
  role: string;
  items: JobApplicationReviewItem[];
  total: number;
  /** Review deadline while OpenClaw is holding the submission for this review. */
  holdUntil?: string;
  submittedAt?: string;
  closed: boolean;
  /** Full-page screenshots of the filled application exist (opens the gallery). */
  hasFullScreenshots: boolean;
}

export function ApplicationReviewPanel({
  applications,
  onResolve,
  onConfirmAll,
  onOpenApplication,
  onExtend,
}: {
  applications: JobApplicationsViewData | null;
  onResolve?: ResolveHandler;
  onConfirmAll?: (listingId: string) => Promise<void>;
  onOpenApplication?: (listingId: string) => void;
  onExtend?: (listingId: string) => Promise<void>;
}) {
  // The fold state is remembered so a long queue doesn't push the rest of the
  // page down on every visit (it matters most on mobile).
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

  const groups = React.useMemo(() => buildGroups(applications), [applications]);

  // undefined = follow the default (only the first group is open).
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({});
  const [released, setReleased] = React.useState<{ listingId: string; label: string } | null>(null);
  React.useEffect(() => {
    if (!released) return;
    const timer = window.setTimeout(() => setReleased(null), RELEASED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [released]);

  const pendingCount = groups.reduce((sum, group) => sum + group.items.length, 0);
  if (pendingCount === 0 && !released) return null;

  const heldCount = groups.filter((group) => group.holdUntil).length;
  const noteReleased = (group: ReviewGroup, resolving: number) => {
    if (group.holdUntil && resolving >= group.items.length) {
      setReleased({ listingId: group.listingId, label: `${group.company} · ${group.role}` });
    }
  };

  return (
    <section className="border-b border-violet-200 bg-violet-50/50 px-5 py-4 dark:border-violet-900/60 dark:bg-violet-950/10">
      <h3>
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="application-review-items"
          className="-my-2 flex min-h-11 w-full items-center gap-2 text-left text-sm font-semibold text-violet-900 dark:text-violet-200"
        >
          <MessageCircleQuestion className="h-4 w-4 shrink-0 text-violet-600" />
          <span className="min-w-0 flex-1">
            Review OpenClaw’s answer choices ({pendingCount})
            {heldCount > 0 && (
              <span className="ml-2 font-normal text-amber-700 dark:text-amber-300">
                {heldCount} application{heldCount === 1 ? '' : 's'} waiting to submit
              </span>
            )}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-violet-700 dark:text-violet-300">
            {collapsed ? 'Show' : 'Hide'}
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        </button>
      </h3>
      <div id="application-review-items" hidden={collapsed} className="mt-3 space-y-2">
        {released && (
          <p role="status" className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
            <Send className="h-4 w-4 shrink-0" />
            <span className="min-w-0">
              All reviewed — OpenClaw {applications?.workerEnabled ? 'is submitting' : 'will submit'}{' '}
              <span className="font-semibold">{released.label}</span>{' '}
              {applications?.workerEnabled ? 'now.' : 'once the worker is started.'}
            </span>
          </p>
        )}
        {!collapsed && groups.map((group, index) => (
          <ReviewGroupCard
            key={group.listingId}
            group={group}
            now={now}
            open={openGroups[group.listingId] ?? index === 0}
            onToggle={(open) => setOpenGroups((current) => ({ ...current, [group.listingId]: open }))}
            questions={applications?.applications[group.listingId]?.questions}
            onResolve={onResolve && (async (reviewId, action, answer) => {
              await onResolve(reviewId, action, answer);
              noteReleased(group, 1);
            })}
            onConfirmAll={onConfirmAll && (async () => {
              await onConfirmAll(group.listingId);
              noteReleased(group, group.items.length);
            })}
            onOpenApplication={onOpenApplication && (() => onOpenApplication(group.listingId))}
            onExtend={onExtend && (() => onExtend(group.listingId))}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewGroupCard({
  group,
  now,
  open,
  onToggle,
  questions,
  onResolve,
  onConfirmAll,
  onOpenApplication,
  onExtend,
}: {
  group: ReviewGroup;
  now: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  questions?: JobApplicationQuestion[];
  onResolve?: ResolveHandler;
  onConfirmAll?: () => Promise<void>;
  onOpenApplication?: () => void;
  onExtend?: () => Promise<void>;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<{ id: string; message: string } | null>(null);
  const bodyId = `application-review-group-${group.listingId}`;
  const reviewed = group.total - group.items.length;

  const run = async (id: string, task: () => Promise<void>): Promise<boolean> => {
    if (busy) return false;
    setBusy(id);
    setError(null);
    try {
      await task();
      return true;
    } catch (caught) {
      setError({ id, message: caught instanceof Error ? caught.message : 'Failed to save review. Please try again.' });
      return false;
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="overflow-hidden rounded-lg border border-violet-200 bg-white text-sm dark:border-violet-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1.5">
        <button
          type="button"
          onClick={() => onToggle(!open)}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-h-11 min-w-0 flex-1 basis-56 items-center gap-2 text-left"
        >
          {open
            ? <ChevronDown className="h-4 w-4 shrink-0 text-violet-500" />
            : <ChevronRight className="h-4 w-4 shrink-0 text-violet-500" />}
          <span className="min-w-0 flex-1">
            <span className="block truncate font-semibold text-slate-900 dark:text-slate-100">{group.company}</span>
            <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{group.role}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <GroupStatusChip group={group} now={now} />
          {onExtend && group.holdUntil && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('extend', onExtend)}
              title="Give yourself another day before OpenClaw submits this application on its own"
              className="inline-flex min-h-8 items-center gap-1 rounded border border-amber-300 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50 disabled:opacity-50 dark:border-amber-800 dark:text-amber-200 dark:hover:bg-amber-950/40"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              +1 day
            </button>
          )}
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {reviewed}/{group.total}
          </span>
          {onOpenApplication && group.hasFullScreenshots && (
            <button
              type="button"
              onClick={onOpenApplication}
              title="Open the application with its full-page screenshots"
              className="inline-flex min-h-8 items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Images className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Full screenshots</span>
            </button>
          )}
          {onConfirmAll && group.items.length > 1 && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run('all', onConfirmAll)}
              className="inline-flex min-h-8 items-center gap-1 rounded border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/40"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {busy === 'all' ? 'Confirming…' : `Confirm all ${group.items.length}`}
            </button>
          )}
        </div>
      </div>
      <div
        role="progressbar"
        aria-label={`${reviewed} of ${group.total} answers reviewed`}
        aria-valuemin={0}
        aria-valuemax={group.total}
        aria-valuenow={reviewed}
        className="h-0.5 bg-violet-100 dark:bg-violet-950"
      >
        <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${(reviewed / group.total) * 100}%` }} />
      </div>
      {(error?.id === 'all' || error?.id === 'extend') && <p role="alert" className="px-3 pt-2 text-sm text-red-700 dark:text-red-300">{error.message}</p>}
      {open && (
        <ul id={bodyId} className="divide-y divide-violet-100 dark:divide-violet-900/50">
          {group.items.map((item) => (
            <ReviewRow
              key={item.id}
              listingId={group.listingId}
              item={item}
              question={questions?.find((question) => question.id === item.questionId)}
              busy={busy === item.id}
              disabled={!onResolve || busy !== null}
              error={error?.id === item.id ? error.message : null}
              onConfirm={() => run(item.id, () => onResolve!(item.id, 'confirm'))}
              onCorrect={(answer) => run(item.id, () => onResolve!(item.id, 'correct', answer))}
            />
          ))}
        </ul>
      )}
    </article>
  );
}

function GroupStatusChip({ group, now }: { group: ReviewGroup; now: number }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset';
  if (group.holdUntil) {
    const remaining = Date.parse(group.holdUntil) - now;
    return (
      <span
        title={`OpenClaw submits when you finish this review, or automatically on ${new Date(group.holdUntil).toLocaleString()}`}
        className={`${base} bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800`}
      >
        <Clock className="h-3 w-3" />
        {remaining <= 0 ? 'Auto-submit due' : `Submits in ${formatCountdown(remaining)}`}
      </span>
    );
  }
  if (group.submittedAt) {
    return (
      <span className={`${base} bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700`}>
        Submitted {new Date(group.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
    );
  }
  if (group.closed) {
    return (
      <span className={`${base} bg-slate-100 text-slate-500 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700`}>
        Closed
      </span>
    );
  }
  return (
    <span className={`${base} bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-200 dark:ring-blue-800`}>
      Not submitted yet
    </span>
  );
}

function ReviewRow({
  listingId,
  item,
  question,
  busy,
  disabled,
  error,
  onConfirm,
  onCorrect,
}: {
  listingId: string;
  item: JobApplicationReviewItem;
  question?: JobApplicationQuestion;
  busy: boolean;
  disabled: boolean;
  error: string | null;
  onConfirm: () => Promise<boolean>;
  onCorrect: (answer: JobApplicationAnswer) => Promise<boolean>;
}) {
  const [draft, setDraft] = React.useState<JobApplicationAnswer | null>(null);
  const used = formatAnswer(item.answerUsed, question);
  // The server writes this fallback when OpenClaw had no specific doubt; it
  // only repeats the "Used" line, so leave it out.
  const genericPrompt = item.clarificationPrompt.startsWith('I used “') &&
    item.clarificationPrompt.endsWith('What should I use in future?');
  const lowConfidence = item.confidence < LOW_CONFIDENCE;
  const draftEmpty = draft === null || (Array.isArray(draft) ? draft.length === 0 : !draft.trim());

  const screenshot = question?.answerScreenshot;
  // The capture predates any correction; say so rather than imply it is current.
  const screenshotStale = screenshot !== undefined && question?.answer !== undefined &&
    formatAnswer(question.answer, question) !== used;

  return (
    // With a screenshot: text and actions stack in the left column and the capture
    // takes the wider right one; on phones it sits between the answer and the actions.
    <li className={`px-3 py-2.5 ${screenshot ? 'sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:grid-rows-[auto_1fr] sm:gap-x-4' : ''}`}>
      <div className="min-w-0 sm:col-start-1 sm:row-start-1">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 font-medium text-slate-900 dark:text-slate-100">{item.question}</p>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium tabular-nums ${lowConfidence
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}
            title="OpenClaw’s confidence in this answer"
          >
            {Math.round(item.confidence * 100)}%
          </span>
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Used </span>
          {used}
        </p>
        {!genericPrompt && <p className="mt-1 text-violet-800 dark:text-violet-300">{item.clarificationPrompt}</p>}
      </div>
      {screenshot && (
        <QuestionScreenshot
          src={`/api/jobs/applications/question-screenshots/${encodeURIComponent(listingId)}/${encodeURIComponent(screenshot.id)}`}
          screenshot={screenshot}
          question={item.question}
          stale={screenshotStale}
        />
      )}
      <div className="min-w-0 sm:col-start-1 sm:row-start-2">
        {draft === null ? (
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={onConfirm}
              className="inline-flex min-h-9 items-center gap-1 rounded bg-emerald-600 px-3 py-1 font-semibold text-white disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> {busy ? 'Saving…' : 'Confirm'}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => setDraft(initialDraft(item.answerUsed, question))}
              className="inline-flex min-h-9 items-center gap-1 rounded border border-violet-300 px-3 py-1 font-semibold text-violet-700 disabled:opacity-50 dark:border-violet-700 dark:text-violet-300"
            >
              <Pencil className="h-3.5 w-3.5" /> Correct
            </button>
          </div>
        ) : (
          <form
            className="mt-2 space-y-2"
            onSubmit={async (event) => {
              event.preventDefault();
              if (draftEmpty || disabled) return;
              if (await onCorrect(draft)) setDraft(null);
            }}
          >
            <CorrectionEditor question={question} value={draft} onChange={setDraft} label={item.question} />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={draftEmpty || disabled}
                className="min-h-9 rounded bg-violet-600 px-3 py-1 font-semibold text-white disabled:opacity-50"
              >
                {busy ? 'Saving…' : 'Save correction'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setDraft(null)}
                className="min-h-9 rounded px-3 py-1 font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
        {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      </div>
    </li>
  );
}

function QuestionScreenshot({
  src,
  screenshot,
  question,
  stale,
}: {
  src: string;
  screenshot: NonNullable<JobApplicationQuestion['answerScreenshot']>;
  question: string;
  stale: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  if (failed) return null;
  const alt = `Application form: ${question}`;
  const captured = new Date(screenshot.capturedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <figure className="mt-2 min-w-0 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Enlarge screenshot of “${question}” on the application form`}
        className="group relative block max-w-full overflow-hidden rounded border border-slate-200 bg-white text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-500 dark:border-slate-700"
      >
        <img
          src={src}
          alt={alt}
          width={screenshot.width}
          height={screenshot.height}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-auto max-h-56 w-auto max-w-full object-contain object-left-top sm:max-h-64"
        />
        <span className="pointer-events-none absolute right-1 top-1 rounded bg-slate-900/70 p-1 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <ZoomIn className="h-3.5 w-3.5" />
        </span>
      </button>
      <figcaption className={`mt-1 text-[11px] ${stale ? 'text-amber-700 dark:text-amber-300' : 'text-slate-400'}`}>
        {stale ? 'Screenshot shows OpenClaw’s original draft' : `As entered on the form · ${captured}`}
      </figcaption>
      {open && <ScreenshotLightbox src={src} alt={alt} caption={question} onClose={close} />}
    </figure>
  );
}

function CorrectionEditor({
  question,
  value,
  onChange,
  label,
}: {
  question?: JobApplicationQuestion;
  value: JobApplicationAnswer;
  onChange: (value: JobApplicationAnswer) => void;
  label: string;
}) {
  const field = 'w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100';
  const options = question?.options ?? [];
  if (question?.kind === 'single-select' && options.length > 0) {
    return (
      <select aria-label={label} value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} className={field} autoFocus>
        <option value="" disabled>Choose an answer…</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    );
  }
  if (question?.kind === 'multi-select' && options.length > 0) {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset className="space-y-1">
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <label key={option.value} className="flex min-h-8 items-center gap-2 text-slate-800 dark:text-slate-200">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) => onChange(event.target.checked
                ? [...selected, option.value]
                : selected.filter((candidate) => candidate !== option.value))}
            />
            {option.label}
          </label>
        ))}
      </fieldset>
    );
  }
  const text = Array.isArray(value) ? value.join(', ') : value;
  return question?.multiline || text.length > 80
    ? <textarea aria-label={label} value={text} onChange={(event) => onChange(event.target.value)} rows={4} className={field} autoFocus />
    : <input aria-label={label} value={text} onChange={(event) => onChange(event.target.value)} className={field} autoFocus />;
}

function buildGroups(applications: JobApplicationsViewData | null): ReviewGroup[] {
  const byListing = new Map<string, ReviewGroup>();
  for (const item of applications?.reviewItems ?? []) {
    let group = byListing.get(item.listingId);
    if (!group) {
      const application = applications?.applications[item.listingId];
      group = {
        listingId: item.listingId,
        company: item.company,
        role: item.role,
        items: [],
        total: 0,
        holdUntil: application?.reviewHoldSince ? application.autoSubmitEligibleAt : undefined,
        submittedAt: application?.submittedAt ?? item.submittedAt,
        closed: application?.status === 'closed',
        hasFullScreenshots: (application?.screenshotCapture?.screenshots.length ?? 0) > 0,
      };
      byListing.set(item.listingId, group);
    }
    group.total += 1;
    if (item.status === 'pending') group.items.push(item);
  }
  // Applications waiting on this review come first (soonest deadline on top),
  // then unsubmitted ones, then after-the-fact reviews, newest submission first.
  const rank = (group: ReviewGroup) => (group.holdUntil ? 0 : group.submittedAt || group.closed ? 2 : 1);
  return [...byListing.values()]
    .filter((group) => group.items.length > 0)
    .sort((a, b) =>
      rank(a) - rank(b) ||
      (a.holdUntil ?? '').localeCompare(b.holdUntil ?? '') ||
      (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
}

/** Option values are what the form submits; show their labels instead. */
function formatAnswer(answer: JobApplicationAnswer, question?: JobApplicationQuestion): string {
  const label = (value: string) => question?.options?.find((option) => option.value === value)?.label ?? value;
  return Array.isArray(answer) ? answer.map(label).join(', ') : label(answer);
}

/** OpenClaw may have recorded an option by label; editors work on values. */
function initialDraft(answer: JobApplicationAnswer, question?: JobApplicationQuestion): JobApplicationAnswer {
  const toValue = (candidate: string) =>
    question?.options?.find((option) => option.value === candidate || option.label === candidate)?.value ?? candidate;
  if (question?.kind === 'multi-select') return (Array.isArray(answer) ? answer : [answer]).map(toValue);
  if (question?.kind === 'single-select') return toValue(Array.isArray(answer) ? answer[0] ?? '' : answer);
  return Array.isArray(answer) ? answer.join(', ') : answer;
}

function formatCountdown(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.ceil(milliseconds / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
}
