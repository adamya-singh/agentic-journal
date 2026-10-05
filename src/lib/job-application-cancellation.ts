import type { JobApplicationRecord } from './types';

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
