import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { findAnswerBankMatch, mutateJobApplicationsStore, upsertConfirmedAnswer } from '../../application-store-utils';
import type { JobReviewResult } from '@/lib/job-review-result';

export const runtime = 'nodejs';

const ReviewSchema = z.object({
  reviewId: z.string().min(1),
  action: z.enum(['confirm', 'correct']),
  answer: z.union([z.string(), z.array(z.string())]).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const parsed = ReviewSchema.safeParse(await request.json());
    if (!parsed.success || (parsed.data.action === 'correct' && parsed.data.answer === undefined)) {
      return NextResponse.json({ success: false, error: 'Invalid review response' }, { status: 400 });
    }
    const result = await mutateJobApplicationsStore<JobReviewResult>((store) => {
      const item = store.reviewItems.find((candidate) => candidate.id === parsed.data.reviewId);
      if (!item) throw new Error('Review item not found');
      if (item.status !== 'pending') throw new Error('Review item has already been resolved');
      const application = store.applications[item.listingId];
      const question = application?.questions.find((candidate) => candidate.id === item.questionId);
      if (!question) throw new Error('Review question not found');
      const answer = parsed.data.action === 'correct' ? parsed.data.answer! : item.answerUsed;
      const now = new Date().toISOString();
      upsertConfirmedAnswer({ store, listingId: item.listingId, question, answer, confirmedAt: now });
      item.status = parsed.data.action === 'correct' ? 'corrected' : 'confirmed';
      if (parsed.data.action === 'correct') item.correctedAnswer = answer;
      item.resolvedAt = now;
      return {
        review: item,
        answerBank: store.answerBank,
        bankMatches: Object.values(store.applications).flatMap((application) =>
          application.questions.filter((question) => question.resolution === 'pending').map((question) => ({
            listingId: application.listingId,
            questionId: question.id,
            bankMatch: findAnswerBankMatch(question, store.answerBank) ?? null,
          })),
        ),
      };
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update review';
    return NextResponse.json({ success: false, error: message }, { status: /not found|already/i.test(message) ? 409 : 500 });
  }
}
