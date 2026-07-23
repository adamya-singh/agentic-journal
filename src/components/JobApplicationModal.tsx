'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';
import type {
  JobApplicationAnswer,
  JobApplicationQuestion,
  JobApplicationRecord,
  JobApplicationResumeVariant,
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
  ) => Promise<void>;
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

  React.useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

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
    try {
      const responses = pendingQuestions.flatMap<JobApplicationResponseInput>((question) => {
        if (skipped.has(question.id)) {
          return [{ questionId: question.id, skip: true }];
        }
        const answer = answers[question.id];
        if (!hasAnswer(answer)) return [];
        return [{ questionId: question.id, answer }];
      });
      await onSave(listing.id, resumeVariant, responses);
      onClose();
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
        if (event.target === event.currentTarget) onClose();
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
          </div>
          <button
            type="button"
            onClick={onClose}
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
                  <QuestionField
                    key={question.id}
                    question={question}
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
                ))}
              </div>
            )}
          </section>

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

          {error && <p className="text-sm font-medium text-red-600 dark:text-red-300">{error}</p>}
        </div>

        <div className="sticky bottom-0 flex justify-end border-t border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save and resume application
          </button>
        </div>
      </div>
    </div>
  );
}

function QuestionField({
  question,
  value,
  skipped,
  onChange,
  onSkip,
}: {
  question: JobApplicationQuestion;
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
      ) : question.multiline || question.kind === 'action' || question.kind === 'file' ? (
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

function hasAnswer(answer: JobApplicationAnswer | undefined): answer is JobApplicationAnswer {
  return typeof answer === 'string'
    ? answer.trim().length > 0
    : Array.isArray(answer) && answer.length > 0;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
