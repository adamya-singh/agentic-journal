import type { JobApplicationQuestion, JobApplicationRecord } from './types';

export const SUBMISSION_CONFIRM_PROMPT = 'Confirm whether this application was submitted';

/** A historical attempt does not lock a stalled draft against human cancellation. */
export function isApplicationSubmissionInFlight(
  application: JobApplicationRecord | undefined,
  now = Date.now(),
): boolean {
  const lease = application?.lease;
  return Boolean(lease && application?.submissionAttemptedAt
    && Date.parse(lease.expiresAt) > now
    && Date.parse(application.submissionAttemptedAt) >= Date.parse(lease.claimedAt));
}

/**
 * Blockers OpenClaw reported after clicking Submit when the employer stopped it
 * (a CAPTCHA, say), so the attempt is known not to have gone through. Empty when
 * there was no attempt or when it may have landed (a run still holds or died with
 * its lease, or Adamya has yet to confirm whether it was submitted).
 */
export function stalledSubmissionBlockers(application: JobApplicationRecord | undefined): JobApplicationQuestion[] {
  if (!application?.submissionAttemptedAt || application.submittedAt || application.lease) return [];
  const pending = application.questions.filter((question) => question.kind === 'action' && question.resolution === 'pending');
  if (pending.some((question) => question.prompt === SUBMISSION_CONFIRM_PROMPT)) return [];
  const attemptedAt = Date.parse(application.submissionAttemptedAt);
  return pending.filter((question) => Date.parse(question.discoveredAt) >= attemptedAt);
}
