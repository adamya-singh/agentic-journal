import type {
  JobApplicationRecord, JobApplicationsViewData, JobEmailUpdatesView, JobEmployerStage,
} from './types';

export const JOB_EMPLOYER_STAGE_LABELS: Record<JobEmployerStage, string> = {
  received: 'Received',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
};

export type JobEmailUpdateRequest =
  | {
    action: 'resolve'; candidateId: string;
    resolution: { kind: 'apply'; listingId: string; stage: JobEmployerStage } | { kind: 'dismiss' };
  }
  | { action: 'set-stage'; listingId: string; stage: JobEmployerStage | null }
  | { action: 'set-enabled'; enabled: boolean };

/** Returned only after the change has been persisted. */
export interface JobEmailUpdatesResult {
  emailUpdates: JobEmailUpdatesView;
  applications: JobApplicationRecord[];
}

export function normalizeEmailUpdatesView(value: unknown): JobEmailUpdatesView {
  const view = (value ?? {}) as Partial<JobEmailUpdatesView>;
  return {
    enabled: view.enabled !== false,
    ...(view.lastPolledAt ? { lastPolledAt: view.lastPolledAt } : {}),
    ...(view.lastError ? { lastError: view.lastError } : {}),
    pending: Array.isArray(view.pending) ? view.pending : [],
  };
}

export async function postJobEmailUpdate(
  body: JobEmailUpdateRequest, request: typeof fetch = fetch,
): Promise<JobEmailUpdatesResult> {
  const response = await request('/api/jobs/applications/email-updates', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'Failed to save the email update');
  return { emailUpdates: normalizeEmailUpdatesView(data.emailUpdates), applications: data.applications ?? [] };
}

export function applyJobEmailUpdatesResult(
  current: JobApplicationsViewData, result: JobEmailUpdatesResult,
): JobApplicationsViewData {
  const applications = { ...current.applications };
  for (const application of result.applications) {
    const previous = applications[application.listingId];
    // The server record carries no view-only bankMatch enrichment; keep it.
    const matches = new Map((previous?.questions ?? []).map((question) => [question.id, question.bankMatch]));
    applications[application.listingId] = {
      ...application,
      questions: application.questions.map((question) => {
        const bankMatch = question.resolution === 'pending' ? matches.get(question.id) : undefined;
        return bankMatch ? { ...question, bankMatch } : question;
      }),
    };
  }
  return { ...current, applications, emailUpdates: result.emailUpdates };
}
