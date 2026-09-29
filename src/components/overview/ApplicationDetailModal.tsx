'use client';

/* eslint-disable @next/next/no-img-element -- screenshots are private, dynamic URLs served by this app. */

import React from 'react';
import { ExternalLink, Mail, X } from 'lucide-react';
import { EmployerStageBadge } from '@/components/EmployerStageBadge';
import { ScreenshotLightbox } from '@/components/ScreenshotLightbox';
import { epoch, type Milestone, type OverviewRow } from '@/lib/job-overview';
import {
  AUTOMATION_LABELS,
  MILESTONE_LABELS,
  currentStage,
  formatEastern,
  relativeTime,
  sinceSubmission,
  timeline,
} from '@/lib/job-overview-view';
import type { MilestoneInput } from '@/lib/useOverviewData';
import { MilestoneForm } from './MilestoneForm';
import { Button, Pill } from './primitives';

const RECORD_STATUS: Record<OverviewRow['status'], string> = {
  unstarted: 'Not started',
  'in-progress': 'In progress',
  'awaiting-user-input': 'Needs input',
  submitted: 'Submitted',
  closed: 'Closed',
};
const SOURCE_LABEL = {
  automated: 'captured automatically at submission',
  'manual-confirmation': 'confirmed by hand, so no timing baseline',
  historical: 'historical record',
} as const;
const gmailUrl = (id: string) => `https://mail.google.com/mail/u/0/#all/${id}`;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-800 dark:text-slate-100">{children}</dd>
    </div>
  );
}

/**
 * Everything the system knows about one application, in the order it
 * happened. A custom modal rather than <dialog> so the screenshot lightbox
 * can capture Escape without also closing this.
 */
export function ApplicationDetailModal({
  row,
  initialMilestoneKind,
  onClose,
  onSaveMilestone,
  now,
}: {
  row: OverviewRow;
  initialMilestoneKind?: Milestone['kind'];
  onClose: () => void;
  onSaveMilestone: (input: MilestoneInput) => Promise<void>;
  now: number;
}) {
  const [correcting, setCorrecting] = React.useState<Milestone | null>(null);
  const [lightbox, setLightbox] = React.useState<{ src: string; alt: string } | null>(null);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const formRef = React.useRef<HTMLDivElement>(null);
  const backdropArmed = React.useRef(false);
  const titleId = React.useId();

  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const main = document.querySelector('main');
    main?.setAttribute('inert', '');
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Bubble phase: the lightbox listens in the capture phase and stops
    // propagation, so Escape closes only the topmost layer.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      main?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);
  React.useEffect(() => {
    if (initialMilestoneKind) formRef.current?.scrollIntoView({ block: 'center' });
  }, [initialMilestoneKind]);

  const stage = currentStage(row);
  const entries = timeline(row);
  const corrections = row.milestoneHistory.filter((m) => m.supersedes);
  const screenshots = row.snapshot?.screenshots?.screenshots ?? [];
  const beginCorrection = (m: Milestone) => {
    setCorrecting(m);
    formRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(event) => {
        backdropArmed.current = event.target === event.currentTarget;
      }}
      onMouseUp={(event) => {
        if (backdropArmed.current && event.target === event.currentTarget) onClose();
        backdropArmed.current = false;
      }}
    >
      <div className="max-h-[96vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-2xl dark:bg-slate-900 sm:max-w-3xl sm:rounded-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">
              {RECORD_STATUS[row.status]}
              {stage !== 'none' && stage !== 'withdrawn' && <EmployerStageBadge stage={stage} />}
              {stage === 'withdrawn' && <Pill>Withdrawn</Pill>}
            </p>
            <h2 id={titleId} className="mt-1 text-lg font-semibold text-slate-900 dark:text-slate-100">
              {row.company}
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">{row.role}</p>
            <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {row.url && (
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Posting
                </a>
              )}
              <a
                href={`/jobs?application=${encodeURIComponent(row.id)}`}
                className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:underline dark:text-indigo-300"
              >
                Open on Board
              </a>
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-5 px-5 py-5">
          <dl className="grid gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950/40 sm:grid-cols-2">
            <Fact label="Submitted">
              {row.submitted ? formatEastern(row.submittedAt) : 'Not submitted'}
              {row.submitted && row.snapshot && (
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  {SOURCE_LABEL[row.snapshot.timestampSource]}
                </span>
              )}
            </Fact>
            <Fact label="Timing baseline">
              {row.baseline ? formatEastern(row.baseline) : 'None'}
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {row.baseline
                  ? 'verified submission attempt; response times count from here'
                  : 'response times cannot be measured for this application'}
              </span>
            </Fact>
            <Fact label="Resume">
              {row.resume}
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                {row.reconstructed
                  ? 'reconstructed snapshot; exact file version not recorded'
                  : `file hash ${row.resumeHash.slice(0, 12)}`}
              </span>
            </Fact>
            <Fact label="Assessment timing">
              {row.first.assessment ? (
                <>
                  {sinceSubmission(row.assessmentMs)}
                  <span className="block text-xs text-slate-500 dark:text-slate-400">
                    {AUTOMATION_LABELS[row.automation]}
                  </span>
                </>
              ) : (
                <span className="text-slate-500 dark:text-slate-400">No assessment invitation</span>
              )}
            </Fact>
          </dl>
          {row.evidence?.message && (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200">
              {row.evidence.message}
              {row.evidence.url && (
                <a
                  href={row.evidence.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 inline-flex items-center gap-1 text-xs font-medium underline"
                >
                  Confirmation page <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </p>
          )}

          <section aria-labelledby={`${titleId}-timeline`}>
            <h3 id={`${titleId}-timeline`} className="font-semibold text-slate-900 dark:text-slate-100">
              Timeline
            </h3>
            {entries.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Nothing recorded yet.</p>
            ) : (
              <ol className="mt-2 space-y-3">
                {entries.map((entry, index) => (
                  <li
                    key={`${entry.kind}-${index}`}
                    className="border-l-2 border-slate-200 pl-3 dark:border-slate-700"
                  >
                    {entry.kind === 'submitted' && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <Pill tone="indigo">Submitted</Pill>
                        <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={entry.at}>
                          {formatEastern(entry.at)}
                        </time>
                      </div>
                    )}
                    {entry.kind === 'event' && (
                      <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {entry.event.stage ? (
                            <EmployerStageBadge stage={entry.event.stage} />
                          ) : (
                            <Pill>Reset to applied</Pill>
                          )}
                          {entry.event.eventKind && entry.event.eventKind !== 'stage-change' && (
                            <Pill>
                              {entry.event.eventKind === 'still-reviewing' ? 'Still reviewing' : 'Reminder'}
                            </Pill>
                          )}
                          <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={entry.at}>
                            {formatEastern(entry.at)}
                          </time>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            {relativeTime(entry.at, now)}
                            {row.baseline && entry.event.stage && entry.event.stage !== 'received'
                              ? ` · ${sinceSubmission((epoch(entry.at) ?? 0) - (epoch(row.baseline) ?? 0))}`
                              : ''}
                            {entry.event.source === 'manual' ? ' · set by you' : ''}
                          </span>
                        </div>
                        {entry.event.subject && (
                          <p className="mt-0.5 break-words text-sm font-medium text-slate-800 dark:text-slate-200">
                            {entry.event.subject}
                          </p>
                        )}
                        {entry.event.summary && (
                          <p className="mt-0.5 break-words text-sm text-slate-600 dark:text-slate-300">
                            {entry.event.summary}
                          </p>
                        )}
                        {(entry.event.provider ||
                          entry.event.assessmentType ||
                          entry.event.deadline ||
                          entry.event.interviewRound ||
                          entry.event.outcomeReason) && (
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                            {[
                              entry.event.provider,
                              entry.event.assessmentType,
                              entry.event.interviewRound,
                              entry.event.deadline ? `due ${formatEastern(entry.event.deadline)}` : '',
                              entry.event.outcomeReason ? `reason: ${entry.event.outcomeReason}` : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        {entry.event.supportingParaphrase && (
                          <p className="mt-0.5 text-xs italic text-slate-500 dark:text-slate-400">
                            “{entry.event.supportingParaphrase}”
                          </p>
                        )}
                        <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-400 dark:text-slate-500">
                          {entry.event.from && <span className="truncate">{entry.event.from}</span>}
                          {entry.event.gmailMessageId && (
                            <a
                              href={gmailUrl(entry.event.gmailMessageId)}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-300"
                            >
                              <Mail className="h-3 w-3" aria-hidden="true" /> Open email
                            </a>
                          )}
                        </p>
                      </>
                    )}
                    {entry.kind === 'milestone' && (
                      <>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <Pill tone="violet">{MILESTONE_LABELS[entry.milestone.kind]}</Pill>
                          <time className="text-xs text-slate-500 dark:text-slate-400" dateTime={entry.at}>
                            {formatEastern(entry.at)}
                          </time>
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            recorded by you {relativeTime(entry.milestone.createdAt, now)}
                            {entry.milestone.supersedes ? ' · correction' : ''}
                          </span>
                          <Button
                            variant="ghost"
                            className="ml-auto"
                            onClick={() => beginCorrection(entry.milestone)}
                          >
                            Correct
                          </Button>
                        </div>
                        {entry.milestone.note && (
                          <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">
                            {entry.milestone.note}
                          </p>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {row.submitted && (
            <div ref={formRef}>
              <MilestoneForm
                key={correcting?.id ?? `new-${initialMilestoneKind ?? ''}`}
                listingId={row.id}
                initialKind={initialMilestoneKind}
                correcting={correcting}
                onCancelCorrection={() => setCorrecting(null)}
                onSubmit={onSaveMilestone}
              />
            </div>
          )}

          {corrections.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Correction history ({corrections.length})
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                {row.milestoneHistory.map((m) => (
                  <li key={m.id}>
                    {MILESTONE_LABELS[m.kind]} · {formatEastern(m.occurredAt)} · entered{' '}
                    {formatEastern(m.createdAt)}
                    {m.supersedes ? ' (correction)' : ''}
                    {row.milestoneHistory.some((n) => n.supersedes === m.id) ? ' · superseded' : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {row.answers.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Submitted answers ({row.answers.length})
              </summary>
              <ul className="mt-2 space-y-3">
                {row.answers.map((q, i) => (
                  <li key={i}>
                    <p className="font-medium text-slate-800 dark:text-slate-200">{q.prompt}</p>
                    <p className="whitespace-pre-wrap break-words text-slate-700 dark:text-slate-300">
                      {Array.isArray(q.answer) ? q.answer.join(', ') : (q.answer ?? 'Not recorded')}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">{q.provenance}</p>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {screenshots.length > 0 && (
            <section>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Form screenshots ({screenshots.length})
              </h3>
              <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {screenshots.map((s) => {
                  const src = `/api/jobs/applications/screenshots/${row.id}/${s.id}`;
                  const alt = `${s.label} · page ${s.pageNumber}`;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setLightbox({ src, alt })}
                        className="block w-full overflow-hidden rounded border border-slate-200 bg-white text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:border-slate-700"
                      >
                        <img
                          src={src}
                          alt={alt}
                          loading="lazy"
                          decoding="async"
                          className="h-32 w-full object-cover object-top"
                        />
                      </button>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {s.label} · page {s.pageNumber} · {formatEastern(s.capturedAt, 'date')}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <p className="text-xs text-slate-400 dark:text-slate-500">
            {row.snapshot
              ? row.reconstructed
                ? 'Snapshot reconstructed from the stored record after submission; historical contents may be incomplete.'
                : 'Immutable snapshot captured at submission.'
              : 'No submission snapshot.'}
          </p>
        </div>
      </div>
      {lightbox && (
        <ScreenshotLightbox src={lightbox.src} alt={lightbox.alt} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}
