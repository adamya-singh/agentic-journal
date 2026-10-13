import type { JobApplicationRecord, JobListing } from '@/lib/types';

/**
 * Where a posting stands, as one stage per posting. The Jobs board's pipeline
 * counts and its table both come from this partition, so they always agree.
 */
export type JobBoardStage = 'needs' | 'queued' | 'applying' | 'submitted' | 'heard' | 'closed' | 'archived';

export const JOB_BOARD_STAGES: JobBoardStage[] = ['needs', 'queued', 'applying', 'submitted', 'heard', 'closed', 'archived'];

export const JOB_BOARD_STAGE_LABELS: Record<JobBoardStage, string> = {
  needs: 'Needs you',
  queued: 'Queued',
  applying: 'Applying',
  submitted: 'Submitted',
  heard: 'Heard back',
  closed: 'Closed',
  archived: 'Archived',
};

/** Employer replies that move a posting past "Submitted". "Received" is only an acknowledgement. */
const HEARD_BACK = new Set(['assessment', 'interview', 'offer', 'rejected']);

export function jobBoardStage(listing: JobListing, application?: JobApplicationRecord): JobBoardStage {
  // An employer reply outranks everything, even a later archive.
  if (application?.employerStage && HEARD_BACK.has(application.employerStage)) return 'heard';
  if (application?.status === 'submitted') return 'submitted';
  if (application?.status === 'closed') return 'closed';
  // Questions block the application even when its listing was archived.
  if (application?.status === 'awaiting-user-input') return 'needs';
  if (listing.status === 'archived') return 'archived';
  if (listing.status === 'applied') return 'submitted';
  if (application?.status === 'in-progress') return 'applying';
  return 'queued';
}

/** When an application last became blocked on the user's answers. */
export function blockedSince(application: JobApplicationRecord): string {
  return [...application.statusHistory].reverse().find((entry) => entry.status === 'awaiting-user-input')?.changedAt
    ?? application.updatedAt;
}

export function lastEmployerReplyAt(application?: JobApplicationRecord): string {
  return [...(application?.employerUpdates ?? [])]
    .reverse()
    .find((update) => update.stage && HEARD_BACK.has(update.stage))?.receivedAt ?? '';
}

const newestFirst = (first: string | undefined, second: string | undefined) => (second ?? '').localeCompare(first ?? '');

export function groupJobBoardStages(
  listings: JobListing[],
  applications: Record<string, JobApplicationRecord> = {},
): Record<JobBoardStage, JobListing[]> {
  const groups = Object.fromEntries(JOB_BOARD_STAGES.map((stage) => [stage, [] as JobListing[]])) as Record<JobBoardStage, JobListing[]>;
  for (const listing of listings) groups[jobBoardStage(listing, applications[listing.id])].push(listing);

  const app = (listing: JobListing) => applications[listing.id];
  // Oldest blocked first: drain the backlog.
  groups.needs.sort((a, b) => blockedSince(app(a)!).localeCompare(blockedSince(app(b)!)));
  groups.queued.sort((a, b) =>
    Number(b.status === 'starred') - Number(a.status === 'starred') ||
    newestFirst(a.savedAt ?? a.createdAt, b.savedAt ?? b.createdAt));
  groups.applying.sort((a, b) => newestFirst(app(a)?.updatedAt, app(b)?.updatedAt));
  groups.submitted.sort((a, b) => newestFirst(app(a)?.submittedAt ?? a.updatedAt, app(b)?.submittedAt ?? b.updatedAt));
  groups.heard.sort((a, b) => newestFirst(lastEmployerReplyAt(app(a)), lastEmployerReplyAt(app(b))));
  groups.closed.sort((a, b) => newestFirst(app(a)?.closedAt, app(b)?.closedAt));
  groups.archived.sort((a, b) => newestFirst(a.updatedAt, b.updatedAt));
  return groups;
}
