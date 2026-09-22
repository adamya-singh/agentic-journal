import { randomUUID } from 'crypto';
import { eventDetails } from '@/lib/job-event-details';
import type {
  JobApplicationRecord,
  JobApplicationSimplifySync,
  JobEmailUpdateCandidate,
  JobEmailUpdatesState,
  JobEmailUpdatesView,
  JobEmployerStage,
  JobEmployerUpdate,
  JobSimplifyTrackerStatus,
} from '@/lib/types';

export const JOB_EMPLOYER_STAGES: JobEmployerStage[] = [
  'received',
  'assessment',
  'interview',
  'offer',
  'rejected',
];

// An email is applied without confirmation only at or above this confidence,
// with exactly one matching posting. Everything else waits for the user.
export const JOB_EMAIL_UPDATE_AUTO_APPLY_CONFIDENCE = 0.85;
// A plain "application received" notice changes nothing that matters (it never
// overrides a real stage or moves a Simplify card), so it needs less certainty.
export const JOB_EMAIL_UPDATE_RECEIVED_AUTO_APPLY_CONFIDENCE = 0.8;

export function autoApplyConfidenceForStage(stage: JobEmployerStage): number {
  return stage === 'received'
    ? JOB_EMAIL_UPDATE_RECEIVED_AUTO_APPLY_CONFIDENCE
    : JOB_EMAIL_UPDATE_AUTO_APPLY_CONFIDENCE;
}
export const JOB_EMAIL_UPDATE_FIRST_POLL_LOOKBACK_MS = 45 * 24 * 60 * 60 * 1000;
export const JOB_EMAIL_UPDATE_POLL_OVERLAP_MS = 6 * 60 * 60 * 1000;
export const JOB_EMAIL_UPDATE_SUMMARY_MAX_LENGTH = 300;
const PROCESSED_LEDGER_LIMIT = 5000;

const SIMPLIFY_STATUS_BY_STAGE: Record<JobEmployerStage, JobSimplifyTrackerStatus> = {
  received: 'Applied',
  assessment: 'Screen',
  interview: 'Interviewing',
  offer: 'Offer',
  rejected: 'Rejected',
};

export function getEmptyEmailUpdatesState(): JobEmailUpdatesState {
  return { enabled: true, pending: [], processed: {} };
}

export function isJobEmployerStage(value: unknown): value is JobEmployerStage {
  return typeof value === 'string' && (JOB_EMPLOYER_STAGES as string[]).includes(value);
}

export function simplifyStatusForStage(stage: JobEmployerStage | undefined): JobSimplifyTrackerStatus {
  return stage ? SIMPLIFY_STATUS_BY_STAGE[stage] : 'Applied';
}

/**
 * A failed sync with no retry time was failed for good (for example the tracker
 * has no such column); it stays parked until a new stage change re-arms it.
 */
export function isSimplifySyncClaimable(sync: JobApplicationSimplifySync | undefined, now: Date): boolean {
  if (!sync || sync.status === 'synced') return false;
  if (sync.status === 'failed' && !sync.nextRetryAt) return false;
  if (sync.lease && Date.parse(sync.lease.expiresAt) > now.getTime()) return false;
  if (sync.nextRetryAt && Date.parse(sync.nextRetryAt) > now.getTime()) return false;
  return true;
}

/**
 * The stage follows the newest update. A plain "application received" notice
 * never overrides a real stage, since those acknowledgements often arrive late
 * or repeat.
 */
export function deriveEmployerStage(updates: JobEmployerUpdate[]): JobEmployerStage | undefined {
  const newestFirst = [...updates].sort(
    (first, second) =>
      Date.parse(second.receivedAt) - Date.parse(first.receivedAt) || Date.parse(second.appliedAt) - Date.parse(first.appliedAt),
  );
  for (const update of newestFirst) {
    if (update.eventKind === 'still-reviewing' || update.eventKind === 'assessment-reminder') continue;
    if (update.stage === null) return undefined;
    if (update.stage !== 'received') return update.stage;
  }
  return newestFirst.some(update => update.stage === 'received' && !['still-reviewing','assessment-reminder'].includes(update.eventKind ?? '')) ? 'received' : undefined;
}

/** Queue the durable Simplify task that moves this application's card to its new column. */
function queueSimplifyStageSync(application: JobApplicationRecord, now: string): void {
  const targetStatus = simplifyStatusForStage(application.employerStage);
  const current = application.simplifySync;
  const currentTarget = current?.targetStatus ?? 'Applied';
  if (current && currentTarget === targetStatus && current.status !== 'failed') return;
  application.simplifySync = {
    status: 'pending',
    targetStatus,
    attemptCount: 0,
    updatedAt: now,
    ...(current?.cardId ? { cardId: current.cardId } : {}),
  };
}

/** Records an employer update and returns true when the application's stage changed. */
export function applyEmployerUpdate(
  application: JobApplicationRecord,
  update: Omit<JobEmployerUpdate, 'id' | 'appliedAt'>,
  now: string,
): boolean {
  const previous = application.employerStage;
  application.employerUpdates = [
    ...(application.employerUpdates ?? []),
    { ...update, id: randomUUID(), appliedAt: now },
  ];
  const next = deriveEmployerStage(application.employerUpdates);
  if (next) application.employerStage = next;
  else delete application.employerStage;
  application.updatedAt = now;
  if (next === previous) return false;
  // "Received" and a reset both mean the card belongs in Applied.
  queueSimplifyStageSync(application, now);
  return true;
}

export function markEmailProcessed(
  state: JobEmailUpdatesState,
  gmailMessageId: string,
  entry: JobEmailUpdatesState['processed'][string],
): void {
  state.processed[gmailMessageId] = entry;
  const ids = Object.keys(state.processed);
  if (ids.length <= PROCESSED_LEDGER_LIMIT) return;
  const pending = new Set(state.pending.map((candidate) => candidate.gmailMessageId));
  ids
    .filter((id) => !pending.has(id))
    .sort((first, second) => state.processed[first].at.localeCompare(state.processed[second].at))
    .slice(0, ids.length - PROCESSED_LEDGER_LIMIT)
    .forEach((id) => delete state.processed[id]);
}

export function toEmailUpdatesView(state: JobEmailUpdatesState): JobEmailUpdatesView {
  return {
    enabled: state.enabled,
    ...(state.lastPolledAt ? { lastPolledAt: state.lastPolledAt } : {}),
    ...(state.lastError ? { lastError: state.lastError } : {}),
    pending: state.pending,
  };
}

// ============ Load-time normalizers (unknown fields are dropped) ============

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const confidence = (value: unknown): number | undefined =>
  typeof value === 'number' && value >= 0 && value <= 1 ? value : undefined;

export function normalizeEmployerUpdates(value: unknown): JobEmployerUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): JobEmployerUpdate[] => {
    if (!isRecord(entry)) return [];
    const id = text(entry.id);
    const receivedAt = text(entry.receivedAt);
    const appliedAt = text(entry.appliedAt);
    const stage = entry.stage === null ? null : isJobEmployerStage(entry.stage) ? entry.stage : undefined;
    if (!id || !receivedAt || !appliedAt || stage === undefined) return [];
    const score = confidence(entry.confidence);
    return [{
      ...eventDetails(entry),
      ...(text(entry.enrichedAt) ? {enrichedAt:text(entry.enrichedAt)} : {}),
      id,
      source: entry.source === 'manual' ? 'manual' : 'email',
      stage,
      receivedAt,
      appliedAt,
      ...(text(entry.gmailMessageId) ? { gmailMessageId: text(entry.gmailMessageId) } : {}),
      ...(text(entry.gmailThreadId) ? { gmailThreadId: text(entry.gmailThreadId) } : {}),
      ...(text(entry.from) ? { from: text(entry.from) } : {}),
      ...(text(entry.subject) ? { subject: text(entry.subject) } : {}),
      ...(text(entry.summary) ? { summary: text(entry.summary) } : {}),
      ...(score !== undefined ? { confidence: score } : {}),
    }];
  });
}

function normalizeCandidate(value: unknown): JobEmailUpdateCandidate[] {
  if (!isRecord(value)) return [];
  const id = text(value.id);
  const gmailMessageId = text(value.gmailMessageId);
  const receivedAt = text(value.receivedAt);
  const createdAt = text(value.createdAt);
  if (!id || !gmailMessageId || !receivedAt || !createdAt) return [];
  return [{
    details: eventDetails(value.details),
    ...(text(value.enrichedAt) ? {enrichedAt:text(value.enrichedAt)} : {}),
    id,
    gmailMessageId,
    ...(text(value.gmailThreadId) ? { gmailThreadId: text(value.gmailThreadId) } : {}),
    receivedAt,
    from: text(value.from),
    subject: text(value.subject),
    summary: text(value.summary),
    ...(isJobEmployerStage(value.suggestedStage) ? { suggestedStage: value.suggestedStage } : {}),
    suggestedListingIds: Array.isArray(value.suggestedListingIds)
      ? value.suggestedListingIds.map(text).filter(Boolean)
      : [],
    confidence: confidence(value.confidence) ?? 0,
    reason: text(value.reason),
    createdAt,
  }];
}

export function normalizeEmailUpdatesState(value: unknown): JobEmailUpdatesState {
  const state = getEmptyEmailUpdatesState();
  if (!isRecord(value)) return state;
  state.enabled = value.enabled !== false;
  if (text(value.lastPolledAt)) state.lastPolledAt = text(value.lastPolledAt);
  if (isRecord(value.lastError) && text(value.lastError.message) && text(value.lastError.occurredAt)) {
    state.lastError = { message: text(value.lastError.message), occurredAt: text(value.lastError.occurredAt) };
  }
  if (Array.isArray(value.pending)) state.pending = value.pending.flatMap(normalizeCandidate);
  if (isRecord(value.processed)) {
    for (const [messageId, entry] of Object.entries(value.processed)) {
      if (!isRecord(entry) || !text(entry.at)) continue;
      const outcome = entry.outcome;
      if (outcome !== 'applied' && outcome !== 'queued' && outcome !== 'ignored') continue;
      state.processed[messageId] = {
        at: text(entry.at),
        outcome,
        ...(text(entry.listingId) ? { listingId: text(entry.listingId) } : {}),
      };
    }
  }
  return state;
}
