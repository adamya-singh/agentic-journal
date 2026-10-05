import type { JobEmployerUpdate, JobEmailUpdateCandidate } from '@/lib/types';

export function emailMessageIds(email: { gmailMessageId?: string; emailMessageIds?: string[] }): string[] {
  return [...new Set([email.gmailMessageId, ...(email.emailMessageIds ?? [])].filter((id): id is string => !!id))];
}

const normalize = (value?: string) => (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const sender = (value?: string) => normalize(value?.match(/<([^>]+)>/)?.[1] ?? value);
type Email = Pick<JobEmployerUpdate, 'gmailMessageId' | 'gmailThreadId' | 'receivedAt' | 'from' | 'subject' | 'stage' | 'eventKind' | 'provider' | 'assessmentType' | 'deadline' | 'interviewRound' | 'assessmentUrl'>;

/** Timing is never enough: require the same sender, subject, event and compatible explicit details. */
export function sameEmployerEmail(first: Email, second: Email, sharedAssessment = false): boolean {
  if (!first.gmailMessageId || !second.gmailMessageId) return false;
  if (first.stage !== second.stage || (first.eventKind ?? 'stage-change') !== (second.eventKind ?? 'stage-change')) return false;
  if (!normalize(first.subject) || normalize(first.subject) !== normalize(second.subject) || !sender(first.from) || sender(first.from) !== sender(second.from)) return false;
  const distance = Math.abs(Date.parse(first.receivedAt) - Date.parse(second.receivedAt));
  // Repeated acknowledgements can arrive days later. Substantive events get a tight two-hour window.
  if (!Number.isFinite(distance) || distance > (first.stage === 'received' ? 7 * 24 : 2) * 3600_000) return false;
  for (const key of ['provider', 'assessmentType', 'deadline', 'interviewRound'] as const) {
    if (first[key] && second[key] && normalize(first[key]) !== normalize(second[key])) return false;
  }
  if (sharedAssessment) {
    return first.stage === 'assessment' && (
      (!!first.gmailThreadId && first.gmailThreadId === second.gmailThreadId) ||
      (!!first.assessmentUrl && first.assessmentUrl === second.assessmentUrl)
    );
  }
  return !(first.assessmentUrl && second.assessmentUrl && first.assessmentUrl !== second.assessmentUrl);
}

export function foldEmployerEmail(target: JobEmployerUpdate, incoming: Partial<JobEmployerUpdate>): void {
  target.emailMessageIds = [...new Set([...emailMessageIds(target), ...emailMessageIds(incoming)])];
  // Fill missing details, never overwrite a recorded deadline or invitation link.
  for (const key of ['gmailThreadId', 'provider', 'assessmentType', 'deadline', 'interviewRound', 'assessmentUrl', 'supportingParaphrase', 'outcomeReason', 'enrichedAt'] as const) {
    if (!target[key] && incoming[key]) target[key] = incoming[key];
  }
}

export function candidateEmail(candidate: JobEmailUpdateCandidate): Email {
  return { ...candidate, ...candidate.details, stage: candidate.suggestedStage ?? null };
}

export function sameCandidateEmail(first: JobEmailUpdateCandidate, second: JobEmailUpdateCandidate): boolean {
  // Do not combine different or unknown matches, even if the mail template is identical.
  const ids = (candidate: JobEmailUpdateCandidate) => [...candidate.suggestedListingIds].sort().join('\0');
  return first.suggestedListingIds.length > 0 && ids(first) === ids(second) && sameEmployerEmail(candidateEmail(first), candidateEmail(second));
}
