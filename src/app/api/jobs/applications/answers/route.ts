import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { JobApplicationAnswer, JobApplicationQuestion } from '@/lib/types';
import {
  getJobApplicationReadiness,
  materializeJobApplication,
  mutateJobApplicationsStore,
  releaseApplicationLease,
  setApplicationStatus,
  updateJobListingLeadStatus,
  upsertConfirmedAnswer,
} from '../../application-store-utils';
import { triggerJobApplicationWorker } from '../../application-worker-utils';

export const runtime = 'nodejs';

const AnswerSchema = z.union([z.string(), z.array(z.string())]);
const RequestSchema = z.object({
  listingId: z.string().min(1),
  resumeVariant: z.enum(['swe', 'mle']).optional(),
  responses: z
    .array(
      z
        .object({
          questionId: z.string().min(1),
          answer: AnswerSchema.optional(),
          skip: z.boolean().optional(),
        })
        .refine((value) => value.skip === true || value.answer !== undefined, {
          message: 'Each response requires an answer or explicit skip',
        }),
    )
    .default([]),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = RequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid answers' },
        { status: 400 },
      );
    }

    const readiness = getJobApplicationReadiness();
    const result = await mutateJobApplicationsStore((store) => {
      const application = materializeJobApplication(store, parsed.data.listingId);
      const now = new Date().toISOString();
      const pendingBefore = application.questions.filter(
        (question) => question.resolution === 'pending',
      ).length;

      if (parsed.data.resumeVariant) {
        application.resumeOverride = parsed.data.resumeVariant;
        application.resumeVariant = parsed.data.resumeVariant;
      }

      for (const response of parsed.data.responses) {
        const question = application.questions.find(
          (candidate) => candidate.id === response.questionId,
        );
        if (!question) {
          throw new Error(`Question not found: ${response.questionId}`);
        }
        if (response.skip === true) {
          if (question.required) {
            throw new Error(`Required question cannot be skipped: ${question.prompt}`);
          }
          delete question.answer;
          question.resolution = 'skipped';
          question.answeredAt = now;
          continue;
        }

        const answer = validateAnswer(question, response.answer);
        question.answer = answer;
        question.resolution = 'answered';
        question.answeredAt = now;
        if (question.kind !== 'action' && question.kind !== 'file') {
          upsertConfirmedAnswer({
            store,
            listingId: parsed.data.listingId,
            question,
            answer,
            confirmedAt: now,
          });
        }
      }

      const pendingAfter = application.questions.filter(
        (question) => question.resolution === 'pending',
      ).length;
      const ambiguity = application.questions.find(
        (question) =>
          question.prompt === 'Confirm whether this application was submitted' &&
          question.resolution === 'answered',
      );
      if (ambiguity && typeof ambiguity.answer === 'string') {
        const answer = ambiguity.answer.trim().toLowerCase();
        if (['submitted', 'yes', 'confirmed'].includes(answer)) {
          setApplicationStatus(application, 'submitted', now);
          application.submittedAt = now;
          application.submissionEvidence = {
            message: 'Submission confirmed manually in Agentic Journal',
          };
          delete application.resumeRequestedAt;
          releaseApplicationLease(application);
          updateJobListingLeadStatus(parsed.data.listingId, 'applied');
          return { application, shouldWake: false };
        }
        if (['retry', 'not submitted', 'no'].includes(answer)) {
          delete application.submissionAttemptedAt;
        } else {
          throw new Error('Submission confirmation must be “submitted” or “retry”');
        }
      }

      let shouldWake = false;
      if (pendingAfter === 0 && application.status === 'awaiting-user-input') {
        setApplicationStatus(application, 'in-progress', now);
        application.resumeRequestedAt = now;
        delete application.nextRetryAt;
        releaseApplicationLease(application);
        if (readiness.ready) {
          store.workerEnabled = true;
          shouldWake = pendingBefore > 0;
        }
      } else {
        application.updatedAt = now;
      }
      return { application, shouldWake };
    });

    const worker = result.shouldWake ? await triggerJobApplicationWorker() : undefined;
    return NextResponse.json({
      success: true,
      application: result.application,
      ...(worker ? { worker } : {}),
      readiness,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to save answers';
    const status = /not found/i.test(message)
      ? 404
      : /question|required|answer|confirmation/i.test(message)
        ? 400
        : 500;
    console.error('Error saving job application answers:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

function validateAnswer(
  question: JobApplicationQuestion,
  answer: JobApplicationAnswer | undefined,
): JobApplicationAnswer {
  if (answer === undefined) {
    throw new Error(`Answer is required: ${question.prompt}`);
  }
  if (question.kind === 'multi-select') {
    if (!Array.isArray(answer) || answer.length === 0) {
      throw new Error(`Select at least one answer: ${question.prompt}`);
    }
    validateChoices(question, answer);
    return answer;
  }
  if (Array.isArray(answer) || answer.trim().length === 0) {
    throw new Error(`Answer is required: ${question.prompt}`);
  }
  if (question.kind === 'single-select') {
    validateChoices(question, [answer]);
  }
  return answer.trim();
}

function validateChoices(question: JobApplicationQuestion, answers: string[]): void {
  const allowed = new Set(question.options?.map((option) => option.value) ?? []);
  if (allowed.size === 0 || answers.some((answer) => !allowed.has(answer))) {
    throw new Error(`Answer is not one of the available choices: ${question.prompt}`);
  }
}
