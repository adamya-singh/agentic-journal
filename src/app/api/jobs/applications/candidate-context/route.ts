import { NextRequest, NextResponse } from 'next/server';
import { JOB_APPLICATION_CANDIDATE_CONTEXT, hasStaleGraduationContext } from '@/lib/application-eligibility';
import { mutateJobApplicationsStore, releaseApplicationLease, setApplicationStatus } from '../../application-store-utils';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ success: true, candidateContext: JOB_APPLICATION_CANDIDATE_CONTEXT });
}

/** Invalidate old graduation estimates without rewriting submitted history. */
export async function POST(request: NextRequest) {
  if ((await request.json()).action !== 'refresh') {
    return NextResponse.json({ success: false, error: 'action must be refresh' }, { status: 400 });
  }
  const result = await mutateJobApplicationsStore((store) => {
    const now = new Date().toISOString();
    const invalidated: Array<{ listingId: string; questionId: string }> = [];
    const oldBankSize = store.answerBank.length;
    store.answerBank = store.answerBank.filter((entry) => !hasStaleGraduationContext(entry));
    for (const application of Object.values(store.applications)) {
      if (application.status === 'submitted' || application.status === 'closed' || application.submissionAttemptedAt) continue;
      if (application.lease && Date.parse(application.lease.expiresAt) > Date.now()) continue;
      for (const question of application.questions) {
        if (!hasStaleGraduationContext(question)) continue;
        invalidated.push({ listingId: application.listingId, questionId: question.id });
        question.resolution = 'pending';
        delete question.answer;
        delete question.generatedAnswer;
        delete question.eligibilityReviewedAnswer;
        delete question.answeredAt;
        delete question.answerScreenshot;
        delete question.suggestion;
        store.reviewItems = store.reviewItems.filter((item) =>
          item.listingId !== application.listingId || item.questionId !== question.id || item.status !== 'pending');
      }
      if (invalidated.some((entry) => entry.listingId === application.listingId)) {
        setApplicationStatus(application, 'awaiting-user-input', now);
        delete application.reviewHoldSince;
        releaseApplicationLease(application);
      }
    }
    return { invalidated, removedStaleBankAnswers: oldBankSize - store.answerBank.length };
  });
  return NextResponse.json({ success: true, candidateContext: JOB_APPLICATION_CANDIDATE_CONTEXT, ...result });
}
