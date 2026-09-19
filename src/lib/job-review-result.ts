import type {
  JobApplicationAnswerBankEntry, JobApplicationAnswerBankMatch,
  JobApplicationReviewItem, JobApplicationsViewData,
  JobApplicationAnswer,
} from './types';

/** Returned only after the review and answer bank have been persisted. */
export interface JobReviewResult {
  review: JobApplicationReviewItem;
  answerBank: JobApplicationAnswerBankEntry[];
  bankMatches: { listingId: string; questionId: string; bankMatch: JobApplicationAnswerBankMatch | null }[];
}

export async function saveJobReview(
  reviewId: string, action: 'confirm' | 'correct', answer?: JobApplicationAnswer,
  request: typeof fetch = fetch,
): Promise<JobReviewResult> {
  const response = await request('/api/jobs/applications/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewId, action, ...(answer !== undefined ? { answer } : {}) }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Failed to resolve review');
  return data;
}

export function applyJobReviewResult(current: JobApplicationsViewData, result: JobReviewResult): JobApplicationsViewData {
  const applications = { ...current.applications };
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
  return {
    ...current, applications, answerBank: result.answerBank,
    reviewItems: current.reviewItems.map((item) => item.id === result.review.id ? result.review : item),
  };
}
