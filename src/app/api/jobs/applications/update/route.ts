import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { JobApplicationQuestion } from '@/lib/types';
import {
  createActionQuestion,
  createApplicationQuestionId,
  completeApplicationScreenshotCapture,
  deleteApplicationScreenshotCaptureFiles,
  failApplicationScreenshotCapture,
  hasCurrentCompleteScreenshotCapture,
  JOB_APPLICATION_RETRY_DELAYS_MS,
  mergeApplicationQuestions,
  mutateJobApplicationsStore,
  releaseApplicationLease,
  requireApplicationLease,
  setApplicationStatus,
  startApplicationScreenshotCapture,
  updateJobListingLeadStatus,
} from '../../application-store-utils';

export const runtime = 'nodejs';

const AnswerSchema = z.union([z.string(), z.array(z.string())]);
const QuestionOptionSchema = z.object({ value: z.string(), label: z.string() });
const QuestionSchema = z.object({
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

const UpdateSchema = z.discriminatedUnion('action', [
  BaseSchema.extend({
    action: z.literal('record-questions'),
    questions: z.array(QuestionSchema),
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
    const result = await mutateJobApplicationsStore((store) => {
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
        if (application.questions.some((question) => question.resolution === 'pending')) {
          setApplicationStatus(application, 'awaiting-user-input', now);
          releaseApplicationLease(application);
        } else {
          application.updatedAt = now;
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
        setApplicationStatus(application, 'submitted', now);
        application.submittedAt = now;
        application.submissionEvidence = {
          ...(parsed.data.url ? { url: parsed.data.url } : {}),
          ...(parsed.data.message ? { message: parsed.data.message } : {}),
        };
        delete application.resumeRequestedAt;
        delete application.lastError;
        releaseApplicationLease(application);
        updateJobListingLeadStatus(parsed.data.listingId, 'applied');
      }

      if (parsed.data.action === 'closed') {
        setApplicationStatus(application, 'closed', now);
        application.closedAt = now;
        application.closedReason = parsed.data.reason;
        delete application.resumeRequestedAt;
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

      if (parsed.data.action === 'release') {
        application.updatedAt = now;
        releaseApplicationLease(application);
      }

      return application;
    });

    cleanupCaptureIds.forEach(deleteApplicationScreenshotCaptureFiles);
    return NextResponse.json({ success: true, application: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update job application';
    const status = /lease|already|not found|submission-attempted|screenshot/i.test(message)
      ? 409
      : 500;
    console.error('Error updating job application:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
