'use client';

/* eslint-disable @next/next/no-img-element -- screenshots use private dynamic URLs and must retain original resolution */

import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Images,
  Loader2,
  X,
} from 'lucide-react';
import type {
  JobApplicationAnswer,
  JobApplicationQuestion,
  JobApplicationRecord,
  JobApplicationResumeVariant,
  JobApplicationScreenshotCapture,
  JobListing,
} from '@/lib/types';

export interface JobApplicationResponseInput {
  questionId: string;
  answer?: JobApplicationAnswer;
  skip?: boolean;
}

interface JobApplicationModalProps {
  listing: JobListing;
  application: JobApplicationRecord;
  onClose: () => void;
  onSave: (
    listingId: string,
    resumeVariant: JobApplicationResumeVariant,
    responses: JobApplicationResponseInput[],
  ) => Promise<{
    success: boolean;
    application?: JobApplicationRecord;
    worker?: { queued?: boolean; enabled?: boolean };
  } | void>;
}

interface AnswerDraft {
  answers: Record<string, JobApplicationAnswer>;
  skipped: string[];
  savedAt: string;
}

function draftKey(listingId: string): string {
  return `job-app-draft:${listingId}`;
}

const STATUS_LABELS: Record<JobApplicationRecord['status'], string> = {
  unstarted: 'Unstarted',
  'in-progress': 'In progress',
  'awaiting-user-input': 'Awaiting your input',
  submitted: 'Submitted',
  closed: 'Closed',
};

export function JobApplicationModal({
  listing,
  application,
  onClose,
  onSave,
}: JobApplicationModalProps) {
  const pendingQuestions = application.questions.filter(
    (question) => question.resolution === 'pending',
  );
  const [resumeVariant, setResumeVariant] = React.useState<JobApplicationResumeVariant>(
    application.resumeOverride ?? application.resumeVariant,
  );
  const [answers, setAnswers] = React.useState<Record<string, JobApplicationAnswer>>(() =>
    Object.fromEntries(
      pendingQuestions.flatMap((question) => {
        const value = question.answer ?? question.suggestion?.answer;
        return value === undefined ? [] : [[question.id, value]];
      }),
    ),
  );
  const [skipped, setSkipped] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saveNotice, setSaveNotice] = React.useState<string | null>(null);

  const backdropArmedRef = React.useRef(false);

  // Dirty tracking: the seeded initial state, snapshotted once. A restored
  // draft intentionally counts as dirty (it differs from the seed).
  const initialStateRef = React.useRef<string | null>(null);
  const serializeState = React.useCallback(
    (a: Record<string, JobApplicationAnswer>, s: Set<string>) =>
      JSON.stringify([a, [...s].sort()]),
    [],
  );
  if (initialStateRef.current === null) {
    initialStateRef.current = serializeState(answers, skipped);
  }
  const isDirty = serializeState(answers, skipped) !== initialStateRef.current;
  const isDirtyRef = React.useRef(isDirty);
  isDirtyRef.current = isDirty;

  // Restore a local draft for still-pending questions (drafts win over seeds).
  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(draftKey(listing.id));
      if (!raw) return;
      const draft = JSON.parse(raw) as AnswerDraft;
      const pendingIds = new Set(
        application.questions
          .filter((question) => question.resolution === 'pending')
          .map((question) => question.id),
      );
      setAnswers((current) => {
        const next = { ...current };
        for (const [id, value] of Object.entries(draft.answers ?? {})) {
          if (pendingIds.has(id)) next[id] = value;
        }
        return next;
      });
      setSkipped(
        (current) =>
          new Set([...current, ...(draft.skipped ?? []).filter((id) => pendingIds.has(id))]),
      );
    } catch {
      // Corrupt draft — ignore.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once per mount
  }, []);

  // Persist a draft (debounced) whenever local edits exist.
  React.useEffect(() => {
    if (!isDirty) return;
    const timer = setTimeout(() => {
      try {
        const draft: AnswerDraft = {
          answers,
          skipped: [...skipped],
          savedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(draftKey(listing.id), JSON.stringify(draft));
      } catch {
        // Best-effort persistence.
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [answers, skipped, isDirty, listing.id]);

  const clearDraft = React.useCallback(() => {
    try {
      window.localStorage.removeItem(draftKey(listing.id));
    } catch {
      // ignore
    }
  }, [listing.id]);

  const requestClose = React.useCallback(() => {
    if (isDirtyRef.current) {
      const discard = window.confirm(
        'You have unsaved answers. Close anyway? (They are kept as a local draft and will be restored next time.)',
      );
      if (!discard) return;
    }
    onClose();
  }, [onClose]);

  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [requestClose]);

  const unresolvedQuestions = pendingQuestions.filter(
    (question) => !skipped.has(question.id) && !hasAnswer(answers[question.id]),
  );
  const answeredCount = pendingQuestions.length - unresolvedQuestions.length;
  const requiredRemaining = unresolvedQuestions.filter((question) => question.required).length;

  const focusQuestion = React.useCallback((questionId: string, scroll: boolean) => {
    const element = document.querySelector(`[data-question-id="${questionId}"]`);
    if (!element) return;
    if (scroll) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const input = element.querySelector('input, textarea, select') as HTMLElement | null;
    input?.focus?.({ preventScroll: true });
  }, []);

  const jumpToNextUnanswered = () => {
    const target = unresolvedQuestions[0];
    if (target) focusQuestion(target.id, true);
  };

  // Focus the first unanswered field on open (no scroll — the modal opens at top).
  React.useEffect(() => {
    const first = pendingQuestions.find(
      (question) => !skipped.has(question.id) && !hasAnswer(answers[question.id]),
    );
    if (first) focusQuestion(first.id, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mount
  }, []);

  const acceptSuggestions = () => {
    setAnswers((current) => {
      const next = { ...current };
      for (const question of pendingQuestions) {
        if (question.suggestion) next[question.id] = question.suggestion.answer;
      }
      return next;
    });
    setSkipped((current) => {
      const next = new Set(current);
      pendingQuestions.forEach((question) => {
        if (question.suggestion) next.delete(question.id);
      });
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaveNotice(null);
    try {
      const responses = pendingQuestions.flatMap<JobApplicationResponseInput>((question) => {
        if (skipped.has(question.id)) {
          return [{ questionId: question.id, skip: true }];
        }
        const answer = answers[question.id];
        if (!hasAnswer(answer)) return [];
        return [{ questionId: question.id, answer }];
      });
      const result = await onSave(listing.id, resumeVariant, responses);
      const updated = result && 'application' in result ? result.application : undefined;
      const remaining = updated
        ? updated.questions.filter((question) => question.resolution === 'pending').length
        : 0;

      if (remaining === 0) {
        clearDraft();
        onClose();
        return;
      }

      // Partial save: stay open, prune resolved ids from local state, and say
      // plainly that the worker only resumes when everything is answered.
      const stillPending = new Set(
        updated!.questions
          .filter((question) => question.resolution === 'pending')
          .map((question) => question.id),
      );
      setAnswers((current) =>
        Object.fromEntries(Object.entries(current).filter(([id]) => stillPending.has(id))),
      );
      setSkipped((current) => new Set([...current].filter((id) => stillPending.has(id))));
      initialStateRef.current = null; // re-snapshot on next render against pruned state
      setSaveNotice(
        `Saved ${responses.length} — ${remaining} question${remaining === 1 ? '' : 's'} remaining. The worker resumes only when all questions are answered or skipped.`,
      );
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save answers');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="job-application-title"
      onMouseDown={(event) => {
        // Only arm backdrop-close when the press STARTED on the backdrop, so a
        // text-selection drag that ends outside the panel can't close the modal.
        backdropArmedRef.current = event.target === event.currentTarget;
      }}
      onMouseUp={(event) => {
        if (backdropArmedRef.current && event.target === event.currentTarget) {
          requestClose();
        }
        backdropArmedRef.current = false;
      }}
    >
      <div className="max-h-[96vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:max-w-3xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
              {STATUS_LABELS[application.status]}
            </p>
            <h2
              id="job-application-title"
              className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100"
            >
              {listing.positionTitle}
            </h2>
            <p className="truncate text-sm text-slate-500 dark:text-slate-400">{listing.company}</p>
            {pendingQuestions.length > 0 && (
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span className="font-medium">
                  {answeredCount} of {pendingQuestions.length} answered
                </span>
                {requiredRemaining > 0 && (
                  <span className="text-amber-600 dark:text-amber-400">
                    · {requiredRemaining} required remaining
                  </span>
                )}
                {unresolvedQuestions.length > 0 && (
                  <button
                    type="button"
                    onClick={jumpToNextUnanswered}
                    className="font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                  >
                    Next unanswered ↓
                  </button>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Close application"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          <section className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Resume
              <select
                value={resumeVariant}
                onChange={(event) =>
                  setResumeVariant(event.target.value as JobApplicationResumeVariant)
                }
                className="mt-1.5 h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-900"
              >
                <option value="swe">Software engineering</option>
                <option value="mle">Machine learning</option>
              </select>
            </label>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              <p>
                <span className="font-semibold">Attempts:</span> {application.attemptCount}
              </p>
              <p className="mt-1">
                <span className="font-semibold">Updated:</span>{' '}
                {formatDateTime(application.updatedAt)}
              </p>
              {(application.canonicalApplicationUrl || listing.link) && (
                <a
                  href={application.canonicalApplicationUrl || listing.link}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-300"
                >
                  Open application <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </section>

          {application.lastError && (
            <div className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong>{application.lastError.code}</strong>
                <p>{application.lastError.message}</p>
              </div>
            </div>
          )}

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                  Remaining questions
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Optional questions must be answered or explicitly skipped.
                </p>
              </div>
              {pendingQuestions.some((question) => question.suggestion) && (
                <button
                  type="button"
                  onClick={acceptSuggestions}
                  className="h-9 rounded-md border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-200"
                >
                  Accept suggestions
                </button>
              )}
            </div>

            {pendingQuestions.length === 0 ? (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> No questions need your input.
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {pendingQuestions.map((question) => (
                  <div key={question.id} data-question-id={question.id}>
                    <QuestionField
                      question={question}
                      listingId={listing.id}
                    value={answers[question.id]}
                    skipped={skipped.has(question.id)}
                    onChange={(value) => {
                      setAnswers((current) => ({ ...current, [question.id]: value }));
                      setSkipped((current) => {
                        const next = new Set(current);
                        next.delete(question.id);
                        return next;
                      });
                    }}
                      onSkip={(skip) => {
                        setSkipped((current) => {
                          const next = new Set(current);
                          if (skip) next.add(question.id);
                          else next.delete(question.id);
                          return next;
                        });
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <ApplicationScreenshotGallery listingId={listing.id} application={application} />

          {application.statusHistory.length > 0 && (
            <details className="rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-700">
              <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-200">
                Progress history
              </summary>
              <ol className="mt-3 space-y-2 text-slate-600 dark:text-slate-300">
                {application.statusHistory
                  .slice()
                  .reverse()
                  .map((entry, index) => (
                    <li key={`${entry.changedAt}-${index}`} className="flex justify-between gap-4">
                      <span>{STATUS_LABELS[entry.status]}</span>
                      <time>{formatDateTime(entry.changedAt)}</time>
                    </li>
                  ))}
              </ol>
            </details>
          )}

          {saveNotice && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" /> {saveNotice}
            </div>
          )}
          {error && <p className="text-sm font-medium text-red-600 dark:text-red-300">{error}</p>}
        </div>

        {application.status !== 'submitted' && (
          <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {unresolvedQuestions.length > 0
                ? `${unresolvedQuestions.length} question${unresolvedQuestions.length === 1 ? '' : 's'} still unanswered`
                : pendingQuestions.length > 0
                  ? 'All questions answered — saving resumes the worker'
                  : ''}
            </p>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {unresolvedQuestions.length > 0
                ? `Save answers (${unresolvedQuestions.length} remaining)`
                : 'Save & resume application'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ApplicationScreenshotGallery({
  listingId,
  application,
}: {
  listingId: string;
  application: JobApplicationRecord;
}) {
  const captures = [
    ...(application.screenshotCapture
      ? [{ capture: application.screenshotCapture, complete: true }]
      : []),
    ...(application.incompleteScreenshotCapture
      ? [{ capture: application.incompleteScreenshotCapture, complete: false }]
      : []),
  ];
  const images = captures.flatMap(({ capture, complete }) =>
    capture.screenshots.map((screenshot) => ({ capture, complete, screenshot })),
  );
  const [selectedIndex, setSelectedIndex] = React.useState<number | null>(null);
  const [failedImages, setFailedImages] = React.useState<Set<string>>(new Set());
  const selected = selectedIndex === null ? undefined : images[selectedIndex];

  React.useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        setSelectedIndex(null);
      }
      if (event.key === 'ArrowLeft')
        setSelectedIndex((current) =>
          current === null ? null : (current - 1 + images.length) % images.length,
        );
      if (event.key === 'ArrowRight')
        setSelectedIndex((current) => (current === null ? null : (current + 1) % images.length));
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [images.length, selected]);

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-slate-100">
            Application screenshots
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Filled application pages captured before submission.
          </p>
        </div>
        {application.incompleteScreenshotCapture ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-200 dark:ring-amber-800">
            Incomplete
          </span>
        ) : application.screenshotCapture ? (
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:ring-emerald-800">
            Complete
          </span>
        ) : null}
      </div>

      {captures.length === 0 ? (
        <div className="mt-3 flex gap-3 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <Images className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            {application.status === 'submitted'
              ? 'This application was submitted before screenshot capture was available.'
              : 'Screenshots will appear here after the automation fills the application.'}
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-5">
          {captures.map(({ capture, complete }) => (
            <ScreenshotCaptureSection
              key={capture.id}
              listingId={listingId}
              capture={capture}
              complete={complete}
              failedImages={failedImages}
              onImageError={(url) => setFailedImages((current) => new Set(current).add(url))}
              onSelect={(screenshotId) =>
                setSelectedIndex(images.findIndex((item) => item.screenshot.id === screenshotId))
              }
            />
          ))}
        </div>
      )}

      {selected && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-slate-950/95 p-3 sm:p-6"
          role="dialog"
          aria-modal="true"
          aria-label={`Application screenshot ${selectedIndex! + 1} of ${images.length}`}
          onMouseDown={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setSelectedIndex(null);
          }}
        >
          <div className="mb-3 flex items-center justify-between gap-3 text-white">
            <div className="min-w-0">
              <p className="truncate font-semibold">{selected.screenshot.label}</p>
              <p className="text-xs text-slate-300">
                Page {selected.screenshot.pageNumber}
                {pageSegmentCount(selected.capture, selected.screenshot.pageNumber) > 1
                  ? ` · Segment ${selected.screenshot.segmentNumber}`
                  : ''}{' '}
                · {selectedIndex! + 1} of {images.length}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <a
                href={screenshotUrl(listingId, selected.screenshot.id)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"
                aria-label="Open full-resolution screenshot in a new tab"
              >
                <ExternalLink className="h-5 w-5" />
              </a>
              <button
                type="button"
                onClick={() => setSelectedIndex(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-white/10"
                aria-label="Close screenshot viewer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="relative flex min-h-0 flex-1 items-center justify-center">
            <img
              src={screenshotUrl(listingId, selected.screenshot.id)}
              alt={`${selected.screenshot.label}, page ${selected.screenshot.pageNumber}`}
              className="max-h-full max-w-full rounded-md object-contain"
            />
            {images.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIndex((selectedIndex! - 1 + images.length) % images.length)
                  }
                  className="absolute left-0 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-950/70 text-white hover:bg-slate-900"
                  aria-label="Previous screenshot"
                >
                  <ChevronLeft className="h-6 w-6" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedIndex((selectedIndex! + 1) % images.length)}
                  className="absolute right-0 inline-flex h-11 w-11 items-center justify-center rounded-full bg-slate-950/70 text-white hover:bg-slate-900"
                  aria-label="Next screenshot"
                >
                  <ChevronRight className="h-6 w-6" />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function ScreenshotCaptureSection({
  listingId,
  capture,
  complete,
  failedImages,
  onImageError,
  onSelect,
}: {
  listingId: string;
  capture: JobApplicationScreenshotCapture;
  complete: boolean;
  failedImages: Set<string>;
  onImageError: (url: string) => void;
  onSelect: (screenshotId: string) => void;
}) {
  const pages = capture.screenshots.reduce((grouped, screenshot) => {
    const page = grouped.get(screenshot.pageNumber) ?? [];
    page.push(screenshot);
    grouped.set(screenshot.pageNumber, page);
    return grouped;
  }, new Map<number, JobApplicationScreenshotCapture['screenshots']>());
  return (
    <div
      className={`rounded-xl border p-4 ${
        complete
          ? 'border-slate-200 dark:border-slate-700'
          : 'border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold text-slate-800 dark:text-slate-200">
          {complete ? 'Latest complete capture' : 'Incomplete capture'}
        </p>
        <time className="text-xs text-slate-500 dark:text-slate-400">
          {formatDateTime(capture.completedAt ?? capture.failedAt ?? capture.startedAt)}
        </time>
      </div>
      {!complete && capture.error && (
        <div className="mt-3 flex gap-2 text-sm text-amber-800 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{capture.error}</p>
        </div>
      )}
      {capture.screenshots.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
          No application pages were saved before capture stopped.
        </p>
      ) : (
        <div className="mt-4 space-y-4">
          {[...pages.entries()]
            .sort(([first], [second]) => first - second)
            .map(([pageNumber, screenshots]) => (
              <div key={pageNumber}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Page {pageNumber} · {screenshots[0]?.label}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {screenshots
                    .slice()
                    .sort((first, second) => first.segmentNumber - second.segmentNumber)
                    .map((screenshot) => {
                      const url = screenshotUrl(listingId, screenshot.id);
                      return (
                        <button
                          key={screenshot.id}
                          type="button"
                          onClick={() => onSelect(screenshot.id)}
                          className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left transition hover:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400 dark:border-slate-700 dark:bg-slate-950"
                        >
                          {failedImages.has(url) ? (
                            <span className="flex aspect-[4/3] items-center justify-center p-3 text-center text-xs text-red-600 dark:text-red-300">
                              Screenshot could not be loaded
                            </span>
                          ) : (
                            <img
                              src={url}
                              alt={`${screenshot.label}, page ${pageNumber}, segment ${screenshot.segmentNumber}`}
                              loading="lazy"
                              onError={() => onImageError(url)}
                              className="aspect-[4/3] w-full object-cover object-top"
                            />
                          )}
                          <span className="block truncate px-2 py-1.5 text-xs text-slate-600 dark:text-slate-300">
                            {screenshots.length > 1
                              ? `Segment ${screenshot.segmentNumber}`
                              : screenshot.label}
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

function screenshotUrl(listingId: string, screenshotId: string): string {
  return `/api/jobs/applications/screenshots/${encodeURIComponent(listingId)}/${encodeURIComponent(screenshotId)}`;
}

function pageSegmentCount(capture: JobApplicationScreenshotCapture, pageNumber: number): number {
  return capture.screenshots.filter((screenshot) => screenshot.pageNumber === pageNumber).length;
}

function QuestionField({
  question,
  listingId,
  value,
  skipped,
  onChange,
  onSkip,
}: {
  question: JobApplicationQuestion;
  listingId: string;
  value?: JobApplicationAnswer;
  skipped: boolean;
  onChange: (answer: JobApplicationAnswer) => void;
  onSkip: (skip: boolean) => void;
}) {
  const isSubmissionConfirmation =
    question.prompt === 'Confirm whether this application was submitted';
  return (
    <fieldset
      className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"
      disabled={skipped}
    >
      <legend className="px-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
        {question.prompt} {question.required ? <span className="text-red-500">*</span> : null}
      </legend>
      {question.helpText && (
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">{question.helpText}</p>
      )}
      {question.suggestion && (
        <p className="mb-2 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-200">
          Autofilled suggestion · {Math.round(question.suggestion.confidence * 100)}%
        </p>
      )}
      {question.bankMatch && question.bankMatch.usable && (
        <button
          type="button"
          onClick={() => onChange(question.bankMatch!.answer)}
          className="mb-2 block max-w-full truncate rounded-full border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-left text-xs font-medium text-teal-700 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200 dark:hover:bg-teal-900/50"
          title="Fill with your previously saved answer"
        >
          Use previous answer: “{formatAnswerPreview(question.bankMatch.answer)}”
        </button>
      )}
      {question.bankMatch && !question.bankMatch.usable && (
        <p className="mb-2 text-xs italic text-slate-400 dark:text-slate-500">
          You previously answered a similar question: “{formatAnswerPreview(question.bankMatch.answer)}” (options differ here)
        </p>
      )}
      {question.kind === 'single-select' && question.options ? (
        <div className="space-y-2">
          {question.options.map((option) => (
            <label
              key={option.value}
              className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200"
            >
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
                className="mt-0.5"
              />
              {option.label}
            </label>
          ))}
        </div>
      ) : question.kind === 'multi-select' && question.options ? (
        <div className="space-y-2">
          {question.options.map((option) => {
            const selected = Array.isArray(value) ? value : [];
            return (
              <label
                key={option.value}
                className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, option.value]
                        : selected.filter((item) => item !== option.value),
                    )
                  }
                  className="mt-0.5"
                />
                {option.label}
              </label>
            );
          })}
        </div>
      ) : isSubmissionConfirmation ? (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
        >
          <option value="">Choose…</option>
          <option value="submitted">It was submitted</option>
          <option value="retry">It was not submitted; retry</option>
        </select>
      ) : question.kind === 'file' ? (
        <FileAnswerField
          listingId={listingId}
          questionId={question.id}
          value={typeof value === 'string' ? value : undefined}
          onChange={onChange}
          onClear={() => onChange('')}
        />
      ) : question.multiline || question.kind === 'action' ? (
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
      ) : (
        <input
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"
        />
      )}
      {!question.required && (
        <label className="mt-3 flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={skipped}
            onChange={(event) => onSkip(event.target.checked)}
          />{' '}
          Skip this optional question
        </label>
      )}
      {(question.section || question.pageUrl) && (
        <p className="mt-3 text-xs text-slate-400">{question.section || 'Application page'}</p>
      )}
    </fieldset>
  );
}

const FILE_ANSWER_PATTERN =
  /^file:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([A-Za-z0-9._-]{1,100})$/i;

function parseFileAnswerClient(answer: unknown): { uploadId: string; fileName: string } | null {
  if (typeof answer !== 'string') return null;
  const match = FILE_ANSWER_PATTERN.exec(answer);
  return match ? { uploadId: match[1], fileName: match[2] } : null;
}

function FileAnswerField({
  listingId,
  questionId,
  value,
  onChange,
  onClear,
}: {
  listingId: string;
  questionId: string;
  value?: string;
  onChange: (answer: string) => void;
  onClear: () => void;
}) {
  const [uploading, setUploading] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const parsed = parseFileAnswerClient(value);

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('listingId', listingId);
      formData.append('questionId', questionId);
      formData.append('file', file);
      const response = await fetch('/api/jobs/applications/files', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Upload failed');
      }
      onChange(data.reference);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.docx"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
      {parsed ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950/40">
          <Images className="h-4 w-4 shrink-0 text-slate-400" />
          <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">
            {parsed.fileName}
          </span>
          <a
            href={`/api/jobs/applications/files/${encodeURIComponent(parsed.uploadId)}/${encodeURIComponent(parsed.fileName)}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
          >
            view
          </a>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-slate-500 hover:underline dark:text-slate-300"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={onClear}
            disabled={uploading}
            className="ml-auto text-slate-400 hover:text-red-500"
            title="Remove file"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-dashed border-slate-300 bg-white px-3 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300 dark:hover:bg-slate-900"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
          {uploading ? 'Uploading…' : 'Choose a file… (PDF, image, or docx · max 25 MB)'}
        </button>
      )}
      {uploadError && (
        <p className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-300">{uploadError}</p>
      )}
    </div>
  );
}

function hasAnswer(answer: JobApplicationAnswer | undefined): answer is JobApplicationAnswer {
  return typeof answer === 'string'
    ? answer.trim().length > 0
    : Array.isArray(answer) && answer.length > 0;
}

function formatAnswerPreview(answer: JobApplicationAnswer): string {
  const fileRef = parseFileAnswerClient(answer);
  const text = fileRef ? fileRef.fileName : Array.isArray(answer) ? answer.join(', ') : answer;
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
