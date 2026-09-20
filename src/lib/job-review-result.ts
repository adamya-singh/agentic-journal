import type {
  JobApplicationAnswerBankEntry, JobApplicationAnswerBankMatch,
  JobApplicationReviewItem, JobApplicationsViewData,
  JobApplicationAnswer, JobApplicationRecord,
} from './types';

/** Returned only after the review and answer bank have been persisted. */
export interface JobReviewResult {
  reviews: JobApplicationReviewItem[];
  /** The reviewed application; a finished review releases its hold. */
  application?: JobApplicationRecord;
  answerBank: JobApplicationAnswerBankEntry[];
  bankMatches: { listingId: string; questionId: string; bankMatch: JobApplicationAnswerBankMatch | null }[];
}

async function postJobReview(body: Record<string, unknown>, request: typeof fetch): Promise<JobReviewResult> {
  const response = await request('/api/jobs/applications/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Failed to resolve review');
  return data;
}

export function saveJobReview(
  reviewId: string, action: 'confirm' | 'correct', answer?: JobApplicationAnswer,
  request: typeof fetch = fetch,
): Promise<JobReviewResult> {
  return postJobReview({ reviewId, action, ...(answer !== undefined ? { answer } : {}) }, request);
}

/** Confirms every pending review of one application in a single transaction. */
export function saveJobReviewConfirmAll(listingId: string, request: typeof fetch = fetch): Promise<JobReviewResult> {
  return postJobReview({ listingId, action: 'confirm-all' }, request);
}

export function applyJobReviewResult(current: JobApplicationsViewData, result: JobReviewResult): JobApplicationsViewData {
  const applications = { ...current.applications };
  const previous = result.application && applications[result.application.listingId];
  if (result.application && previous) {
    // The server record carries no view-only bankMatch enrichment; keep it.
    const matches = new Map(previous.questions.map((question) => [question.id, question.bankMatch]));
    applications[result.application.listingId] = {
      ...result.application,
      questions: result.application.questions.map((question) => {
        const bankMatch = question.resolution === 'pending' ? matches.get(question.id) : undefined;
        return bankMatch ? { ...question, bankMatch } : question;
      }),
    };
  }
  const byListing = new Map<string, Map<string, JobApplicationAnswerBankMatch | null>>();
  for (const match of result.bankMatches) {
    if (!byListing.has(match.listingId)) byListing.set(match.listingId, new Map());
    byListing.get(match.listingId)!.set(match.questionId, match.bankMatch);
  }
  for (const [listingId, matches] of byListing) {
    const application = applications[listingId];
    if (!application) continue;
    applications[listingId] = { ...application, questions: application.questions.map((question) => {
      if (question.resolution !== 'pending' || !matches.has(question.id)) return question;
      return { ...question, bankMatch: matches.get(question.id) ?? undefined };
    }) };
  }
  const resolved = new Map(result.reviews.map((review) => [review.id, review]));
  return {
    ...current, applications, answerBank: result.answerBank,
    reviewItems: current.reviewItems.map((item) => resolved.get(item.id) ?? item),
  };
}
