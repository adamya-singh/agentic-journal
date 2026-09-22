import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { captureSubmissionSnapshot } from '../../application-store-utils';
import { DateSourceSchema, EmploymentDateError, validateEmploymentDate } from '@/lib/employment-dates';
import type { JobApplicationQuestion, JobApplicationRecord } from '@/lib/types';
import { readJobListings } from '../../job-store-utils';
import {
  createActionQuestion,
  buildGoogleDocAutoAnswerEntry,
  createApplicationQuestionId,
  completeApplicationScreenshotCapture,
  deleteApplicationScreenshotCaptureFiles,
  failApplicationScreenshotCapture,
  hasCurrentCompleteScreenshotCapture,
  holdApplicationForReview,
  isSubmissionBlockedByReview,
  JOB_APPLICATION_RETRY_DELAYS_MS,
  mergeApplicationQuestions,
  mutateJobApplicationsStore,
  releaseApplicationLease,
  requireApplicationLease,
  setApplicationStatus,
  startApplicationScreenshotCapture,
  updateJobListingLeadStatus,
  validateAutoAnswer,
} from '../../application-store-utils';

export const runtime = 'nodejs';

const AnswerSchema = z.union([z.string(), z.array(z.string())]);
const QuestionOptionSchema = z.object({ value: z.string(), label: z.string() });
const QuestionSchema = z.object({
  employmentDateField: z.enum(['start', 'end']).optional(),
  dateSource: DateSourceSchema.optional(),
  id: z.string().min(1).optional(),
  prompt: z.string().min(1),
  kind: z.enum(['text', 'single-select', 'multi-select', 'file', 'action']),
  required: z.boolean(),
  helpText: z.string().optional(),
  pageUrl: z.string().url().optional(),
  section: z.string().optional(),
  options: z.array(QuestionOptionSchema).optional(),
  multiline: z.boolean().optional(),
  answer: AnswerSchema.optional(),
  suggestion: z
    .object({
      answer: AnswerSchema,
      sourceAnswerId: z.string().min(1),
      confidence: z.number().min(0).max(1),
      category: z.enum(['standard', 'legal', 'certification', 'demographic']).optional(),
    })
    .optional(),
  resolution: z.enum(['pending', 'answered', 'skipped', 'auto-resolved']).default('pending'),
  discoveredAt: z.string().datetime().optional(),
  answeredAt: z.string().datetime().optional(),
});

const BaseSchema = z.object({
  listingId: z.string().min(1),
  leaseToken: z.string().min(1),
});

const AutoAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: AnswerSchema,
  confidence: z.number().min(0).max(1),
  assumptions: z.array(z.string().min(1)).default([]),
  clarificationPrompt: z.string().min(1).optional(),
  docAppend: z.object({
    status: z.enum(['saved', 'failed']),
    entry: z.string().min(1),
    attemptedAt: z.string().datetime(),
    error: z.string().min(1).optional(),
  }),
});

const UpdateSchema = z.discriminatedUnion('action', [
  BaseSchema.extend({
    action: z.literal('record-questions'),
    questions: z.array(QuestionSchema),
    retainLease: z.boolean().optional(),
  }),
  BaseSchema.extend({
    action: z.literal('record-auto-answers'),
    answers: z.array(AutoAnswerSchema).min(1),
  }),
  BaseSchema.extend({
    action: z.literal('set-canonical-url'),
    url: z.string().url(),
  }),
  BaseSchema.extend({ action: z.literal('submission-attempted') }),
  BaseSchema.extend({ action: z.literal('start-screenshot-capture') }),
  BaseSchema.extend({
    action: z.literal('complete-screenshot-capture'),
    captureId: z.string().uuid(),
  }),
  BaseSchema.extend({
    action: z.literal('screenshot-capture-failed'),
    captureId: z.string().uuid(),
    error: z.string().min(1),
    pageUrl: z.string().url().optional(),
  }),
  BaseSchema.extend({
    action: z.literal('submitted'),
    url: z.string().url().optional(),
    message: z.string().optional(),
  }),
  BaseSchema.extend({
    action: z.literal('closed'),
    reason: z.string().min(1),
  }),
  BaseSchema.extend({
    action: z.literal('retry'),
    code: z.string().min(1),
    message: z.string().min(1),
  }),
  BaseSchema.extend({
    action: z.literal('awaiting-action'),
    prompt: z.string().min(1),
    helpText: z.string().optional(),
    pageUrl: z.string().url().optional(),
  }),
  BaseSchema.extend({
    action: z.literal('ambiguous-submission'),
    pageUrl: z.string().url().optional(),
  }),
  BaseSchema.extend({
    action: z.literal('progress'),
    step: z.string().min(1),
    label: z.string().min(1),
    detail: z.string().optional(),
  }),
  BaseSchema.extend({ action: z.literal('release') }),
]);

export async function POST(request: NextRequest) {
  try {
    const parsed = UpdateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid application update' },
        { status: 400 },
      );
    }

    const cleanupCaptureIds: string[] = [];
    let reviewHold: { until: string } | undefined;
    const result = await mutateJobApplicationsStore<JobApplicationRecord>((store) => {
      const application = requireApplicationLease(
        store.applications[parsed.data.listingId],
        parsed.data.leaseToken,
      );
      const now = new Date().toISOString();

      if (parsed.data.action === 'record-questions') {
        const questions: JobApplicationQuestion[] = parsed.data.questions.map((question) => ({
          ...question,
          id:
            question.id ??
            createApplicationQuestionId({
              prompt: question.prompt,
              kind: question.kind,
              pageUrl: question.pageUrl,
              options: question.options,
            }),
          resolution: question.resolution,
          discoveredAt: question.discoveredAt ?? now,
        }));
        application.questions = mergeApplicationQuestions(application.questions, questions);
        for (const question of questions) {
          if (question.dateSource && question.dateSource.attemptCount !== application.attemptCount) {
            throw new EmploymentDateError('Fresh Simplify date source required for the current attempt');
          }
        }
        if (!parsed.data.retainLease && application.questions.some((question) => question.resolution === 'pending')) {
          setApplicationStatus(application, 'awaiting-user-input', now);
          releaseApplicationLease(application);
        } else {
          application.updatedAt = now;
        }
      }

      if (parsed.data.action === 'record-auto-answers') {
        const listing = readJobListings().listings.find(
          (candidate) => candidate.id === parsed.data.listingId,
        );
        if (!listing) throw new Error('Job listing not found');
        for (const generated of parsed.data.answers) {
          const question = application.questions.find(
            (candidate) => candidate.id === generated.questionId,
          );
          if (!question || question.resolution !== 'pending') {
            throw new Error(`Pending question not found: ${generated.questionId}`);
          }
          validateAutoAnswer(question, generated.answer);
          validateEmploymentDate(question, generated.answer, application.attemptCount);
          const expectedDocEntry = buildGoogleDocAutoAnswerEntry({
            question: question.prompt,
            company: listing.company,
            role: listing.positionTitle,
            answer: generated.answer,
          });
          if (generated.docAppend.entry !== expectedDocEntry) {
            throw new Error(`Google Doc entry does not use the required prefix and format: ${question.prompt}`);
          }
          question.answer = generated.answer;
          question.resolution = 'auto-resolved';
          question.answeredAt = now;
          question.generatedAnswer = {
            source: 'chatgpt-web',
            generatedAt: now,
            confidence: generated.confidence,
            assumptions: generated.assumptions,
            ...(generated.clarificationPrompt
              ? { clarificationPrompt: generated.clarificationPrompt }
              : {}),
            docAppend: generated.docAppend,
          };
          // Every generated answer is queued for review before submission.
          const clarificationPrompt = generated.clarificationPrompt ??
            `I used “${formatAnswer(generated.answer)}”. What should I use in future?`;
          const existing = store.reviewItems.find(
            (item) => item.listingId === application.listingId && item.questionId === question.id,
          );
          if (!existing) {
            store.reviewItems.push({
              id: randomUUID(),
              listingId: application.listingId,
              questionId: question.id,
              question: question.prompt,
              answerUsed: generated.answer,
              clarificationPrompt,
              confidence: generated.confidence,
              company: listing.company,
              role: listing.positionTitle,
              createdAt: now,
              status: 'pending',
            });
          }
        }
        application.updatedAt = now;
        if (application.questions.some((question) => question.resolution === 'pending')) {
          setApplicationStatus(application, 'awaiting-user-input', now);
          releaseApplicationLease(application);
        } else {
          const until = holdApplicationForReview(store, application, now);
          if (until) reviewHold = { until };
        }
      }

      if (parsed.data.action === 'set-canonical-url') {
        application.canonicalApplicationUrl = parsed.data.url;
        application.updatedAt = now;
      }

      if (parsed.data.action === 'submission-attempted') {
        if (application.submissionAttemptedAt) {
          throw new Error('Submission has already been attempted for this application');
        }
        if (isSubmissionBlockedByReview(store, application, new Date(now))) {
          throw new Error(
            `Auto-answers are still awaiting review until ${application.autoSubmitEligibleAt}; release the lease and stop`,
          );
        }
        if (!hasCurrentCompleteScreenshotCapture(application)) {
          throw new Error(
            'A complete screenshot capture from the current attempt is required before submission',
          );
        }
        application.submissionAttemptedAt = now;
        application.updatedAt = now;
      }

      if (parsed.data.action === 'start-screenshot-capture') {
        const started = startApplicationScreenshotCapture(application, now);
        if (started.supersededCaptureId) cleanupCaptureIds.push(started.supersededCaptureId);
      }

      if (parsed.data.action === 'complete-screenshot-capture') {
        const completed = completeApplicationScreenshotCapture(
          application,
          parsed.data.captureId,
          now,
        );
        if (
          completed.supersededCaptureId &&
          completed.supersededCaptureId !== completed.capture.id
        ) {
          cleanupCaptureIds.push(completed.supersededCaptureId);
        }
      }

      if (parsed.data.action === 'screenshot-capture-failed') {
        failApplicationScreenshotCapture(
          application,
          parsed.data.captureId,
          parsed.data.error,
          now,
        );
        application.questions = mergeApplicationQuestions(
          application.questions.filter(
            (question) => question.prompt !== 'Screenshot capture needs help',
          ),
          [
            createActionQuestion({
              prompt: 'Screenshot capture needs help',
              helpText: `Submission was not attempted because the worker could not save every filled application page after three attempts. ${parsed.data.error}`,
              pageUrl: parsed.data.pageUrl,
              now,
            }),
          ],
        );
        setApplicationStatus(application, 'awaiting-user-input', now);
        releaseApplicationLease(application);
      }

      if (parsed.data.action === 'submitted') {
        if (!application.submissionAttemptedAt) {
          throw new Error('Record submission-attempted before marking an application submitted');
        }
        if (!parsed.data.url?.trim() && !parsed.data.message?.trim()) {
          throw new Error('Visible employer confirmation evidence is required');
        }
        setApplicationStatus(application, 'submitted', now);
        application.submittedAt = now;
        application.submissionEvidence = {
          ...(parsed.data.url ? { url: parsed.data.url } : {}),
          ...(parsed.data.message ? { message: parsed.data.message } : {}),
        };
        application.simplifySync = {
          status: 'pending',
          attemptCount: application.simplifySync?.attemptCount ?? 0,
          updatedAt: now,
        };
        captureSubmissionSnapshot(application);
        for (const item of store.reviewItems) {
          if (item.listingId === application.listingId && !item.submittedAt) item.submittedAt = now;
        }
        delete application.resumeRequestedAt;
        delete application.lastError;
        delete application.progress;
        releaseApplicationLease(application);
        updateJobListingLeadStatus(parsed.data.listingId, 'applied');
      }

      if (parsed.data.action === 'closed') {
        setApplicationStatus(application, 'closed', now);
        application.closedAt = now;
        application.closedReason = parsed.data.reason;
        delete application.resumeRequestedAt;
        delete application.progress;
        releaseApplicationLease(application);
        updateJobListingLeadStatus(parsed.data.listingId, 'archived');
      }

      if (parsed.data.action === 'retry') {
        const retryIndex = Math.min(
          Math.max(application.attemptCount - 1, 0),
          JOB_APPLICATION_RETRY_DELAYS_MS.length - 1,
        );
        application.lastError = {
          code: parsed.data.code,
          message: parsed.data.message,
          occurredAt: now,
          retryable: application.attemptCount < 3,
        };
        releaseApplicationLease(application);
        if (application.attemptCount >= 3) {
          application.questions = mergeApplicationQuestions(application.questions, [
            createActionQuestion({
              prompt: 'Automation needs help with this application',
              helpText: parsed.data.message,
              required: true,
              now,
            }),
          ]);
          setApplicationStatus(application, 'awaiting-user-input', now);
        } else {
          application.nextRetryAt = new Date(
            Date.now() + JOB_APPLICATION_RETRY_DELAYS_MS[retryIndex],
          ).toISOString();
          setApplicationStatus(application, 'in-progress', now);
        }
      }

      if (parsed.data.action === 'awaiting-action') {
        application.questions = mergeApplicationQuestions(application.questions, [
          createActionQuestion({
            prompt: parsed.data.prompt,
            helpText: parsed.data.helpText,
            pageUrl: parsed.data.pageUrl,
            now,
          }),
        ]);
        setApplicationStatus(application, 'awaiting-user-input', now);
        releaseApplicationLease(application);
      }

      if (parsed.data.action === 'ambiguous-submission') {
        application.questions = mergeApplicationQuestions(application.questions, [
          createActionQuestion({
            prompt: 'Confirm whether this application was submitted',
            helpText:
              'Open the application and answer “submitted” or “retry”. The worker will not click Submit again until you resolve this.',
            pageUrl: parsed.data.pageUrl,
            now,
          }),
        ]);
        setApplicationStatus(application, 'awaiting-user-input', now);
        releaseApplicationLease(application);
      }

      if (parsed.data.action === 'progress') {
        application.progress = {
          step: parsed.data.step,
          label: parsed.data.label,
          ...(parsed.data.detail ? { detail: parsed.data.detail } : {}),
          updatedAt: now,
        };
        // Deliberately no status change and no history entry — progress is a
        // cheap heartbeat, not a lifecycle transition.
      }

      if (parsed.data.action === 'release') {
        application.updatedAt = now;
        releaseApplicationLease(application);
      }

      return application;
    });

    cleanupCaptureIds.forEach(deleteApplicationScreenshotCaptureFiles);
    return NextResponse.json({ success: true, application: result, ...(reviewHold ? { reviewHold } : {}) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update job application';
    const status = error instanceof EmploymentDateError ? 400 : /lease|already|not found|submission-attempted|screenshot|awaiting review/i.test(message)
      ? 409
      : 500;
    console.error('Error updating job application:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

function formatAnswer(answer: string | string[]): string {
  return Array.isArray(answer) ? answer.join(', ') : answer;
}
