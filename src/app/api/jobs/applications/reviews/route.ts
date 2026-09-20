import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  findAnswerBankMatch,
  mutateJobApplicationsStore,
  normalizePrompt,
  releaseReviewHoldIfComplete,
  upsertConfirmedAnswer,
  validateAutoAnswer,
} from '../../application-store-utils';
import { wakeJobApplicationWorkerIfEnabled } from '../../application-worker-utils';
import type { JobReviewResult } from '@/lib/job-review-result';
import type { JobApplicationAnswer, JobApplicationQuestion } from '@/lib/types';

export const runtime = 'nodejs';

const ReviewSchema = z.union([
  z.object({
    reviewId: z.string().min(1),
    action: z.enum(['confirm', 'correct']),
    answer: z.union([z.string(), z.array(z.string())]).optional(),
  }),
  z.object({
    listingId: z.string().min(1),
    action: z.literal('confirm-all'),
  }),
]);

class ReviewAnswerError extends Error {}

export async function POST(request: NextRequest) {
  const startedAt = performance.now();
  try {
    const parsed = ReviewSchema.safeParse(await request.json());
    if (!parsed.success || (parsed.data.action === 'correct' && parsed.data.answer === undefined)) {
      return NextResponse.json({ success: false, error: 'Invalid review response' }, { status: 400 });
    }
    const input = parsed.data;
    const result = await mutateJobApplicationsStore<JobReviewResult & { released: boolean }>((store) => {
      const items = input.action === 'confirm-all'
        ? store.reviewItems.filter((candidate) => candidate.listingId === input.listingId && candidate.status === 'pending')
        : store.reviewItems.filter((candidate) => candidate.id === input.reviewId);
      if (items.length === 0) throw new Error('Review item not found');
      const now = new Date().toISOString();
      const changed: JobApplicationQuestion[] = [];
      for (const item of items) {
        if (item.status !== 'pending') throw new Error('Review item has already been resolved');
        const application = store.applications[item.listingId];
        const question = application?.questions.find((candidate) => candidate.id === item.questionId);
        if (!application || !question) throw new Error('Review question not found');
        let answer: JobApplicationAnswer = item.answerUsed;
        if (input.action === 'correct') {
          answer = normalizeCorrection(question, input.answer!);
          // Until the application is submitted a correction replaces the
          // drafted answer, so the resumed run fills in what was reviewed.
          if (application.status !== 'submitted' && application.status !== 'closed') {
            try {
              validateAutoAnswer(question, answer);
            } catch (error) {
              throw new ReviewAnswerError(error instanceof Error ? error.message : 'Invalid correction');
            }
            question.answer = answer;
            question.resolution = 'answered';
            question.answeredAt = now;
            application.updatedAt = now;
          }
          item.correctedAnswer = answer;
        }
        upsertConfirmedAnswer({ store, listingId: item.listingId, question, answer, confirmedAt: now });
        item.status = input.action === 'correct' ? 'corrected' : 'confirmed';
        item.resolvedAt = now;
        changed.push(question);
      }
      const listingId = items[0].listingId;
      const released = releaseReviewHoldIfComplete(store, listingId, now);
      // Only the reviewed prompts/kinds can acquire a different best match. Keep
      // all choice-set variants: exact and relaxed matches can both change.
      const changedKeys = new Set(changed.map((question) => `${question.kind}\n${normalizePrompt(question.prompt)}`));
      return {
        reviews: items,
        application: store.applications[listingId],
        answerBank: store.answerBank,
        bankMatches: Object.values(store.applications).flatMap((application) =>
          application.questions.filter((candidate) => candidate.resolution === 'pending'
            && changedKeys.has(`${candidate.kind}\n${normalizePrompt(candidate.prompt)}`)).map((question) => ({
            listingId: application.listingId,
            questionId: question.id,
            bankMatch: findAnswerBankMatch(question, store.answerBank) ?? null,
          })),
        ),
        released,
      };
    });
    // The transaction (including its atomic file replacement) has completed.
    // Waking the worker shells out to the OpenClaw CLI; never block the save on it.
    if (result.released) {
      const wake = () => wakeJobApplicationWorkerIfEnabled().catch((error) => {
        console.error('Failed to wake job application worker after review:', error);
      });
      try {
        after(wake);
      } catch {
        // No request scope (direct handler invocation): fire and forget.
        void wake();
      }
    }
    const { released: _released, ...payload } = result;
    void _released;
    return NextResponse.json({ success: true, ...payload }, {
      headers: { 'Server-Timing': `review-save;dur=${(performance.now() - startedAt).toFixed(1)}` },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update review';
    const status = error instanceof ReviewAnswerError ? 400 : /not found|already/i.test(message) ? 409 : 500;
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

function normalizeCorrection(question: JobApplicationQuestion, answer: JobApplicationAnswer): JobApplicationAnswer {
  if (question.kind === 'multi-select') {
    return Array.isArray(answer) ? answer : answer.split(',').map((value) => value.trim()).filter(Boolean);
  }
  return Array.isArray(answer) ? answer.join(', ') : answer.trim();
}
