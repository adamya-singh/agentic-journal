import { randomUUID } from 'crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import type { JobApplicationRecord, JobEmailUpdatesView, JobListing } from '@/lib/types';
import { readJobListings } from '../../job-store-utils';
import {
  materializeJobApplication,
  mutateJobApplicationsStore,
  readJobApplicationsStore,
} from '../../application-store-utils';
import {
  applyEmployerUpdate,
  autoApplyConfidenceForStage,
  JOB_EMAIL_UPDATE_RECEIVED_AUTO_APPLY_CONFIDENCE,
  JOB_EMAIL_UPDATE_AUTO_APPLY_CONFIDENCE,
  JOB_EMAIL_UPDATE_FIRST_POLL_LOOKBACK_MS,
  JOB_EMAIL_UPDATE_POLL_OVERLAP_MS,
  JOB_EMAIL_UPDATE_SUMMARY_MAX_LENGTH,
  markEmailProcessed,
  toEmailUpdatesView,
} from '../../email-update-utils';
import {
  syncJobEmailUpdatesCron,
  wakeJobApplicationWorkerIfEnabled,
} from '../../application-worker-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const StageSchema = z.enum(['received', 'assessment', 'interview', 'offer', 'rejected']);

const EmailSchema = z.object({
  gmailMessageId: z.string().min(1).max(200),
  gmailThreadId: z.string().min(1).max(200).optional(),
  receivedAt: z.string().datetime({ offset: true }),
  from: z.string().trim().max(320).default(''),
  subject: z.string().trim().max(500).default(''),
  // Never the body: one sentence written by the agent.
  summary: z.string().trim().max(JOB_EMAIL_UPDATE_SUMMARY_MAX_LENGTH).default(''),
  relevant: z.boolean(),
  stage: StageSchema.optional(),
  listingId: z.string().min(1).optional(),
  alternatives: z.array(z.string().min(1)).max(10).default([]),
  confidence: z.number().min(0).max(1).default(0),
  reason: z.string().trim().max(500).default(''),
});

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('record'), emails: z.array(EmailSchema).max(200) }),
  z.object({ action: z.literal('poll-failed'), error: z.string().trim().min(1).max(500) }),
  z.object({
    action: z.literal('resolve'), candidateId: z.string().min(1),
    resolution: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('apply'), listingId: z.string().min(1), stage: StageSchema }),
      z.object({ kind: z.literal('dismiss') }),
    ]),
  }),
  z.object({ action: z.literal('set-stage'), listingId: z.string().min(1), stage: StageSchema.nullable() }),
  z.object({ action: z.literal('set-enabled'), enabled: z.boolean() }),
]);

export interface JobEmailUpdatesResult {
  emailUpdates: JobEmailUpdatesView;
  /** Applications whose employer stage or history changed. */
  applications: JobApplicationRecord[];
  summary?: { applied: number; queued: number; ignored: number; skipped: number };
}

/** A posting an employer email can refer to: applied for and not withdrawn from the board. */
function isTrackable(listing: JobListing, application: JobApplicationRecord | undefined): boolean {
  return listing.status === 'applied' || application?.status === 'submitted';
}

/** What the agent needs for one pass: the time window, handled ids, and the postings to match against. */
export async function GET() {
  try {
    const store = readJobApplicationsStore();
    const state = store.emailUpdates;
    const now = Date.now();
    const since = new Date(
      state.lastPolledAt
        ? Date.parse(state.lastPolledAt) - JOB_EMAIL_UPDATE_POLL_OVERLAP_MS
        : now - JOB_EMAIL_UPDATE_FIRST_POLL_LOOKBACK_MS,
    ).toISOString();
    const listings = readJobListings().listings.flatMap((listing) => {
      const application = store.applications[listing.id];
      if (!isTrackable(listing, application)) return [];
      let linkHost = '';
      try {
        linkHost = new URL(application?.canonicalApplicationUrl ?? listing.link).hostname;
      } catch {}
      return [{
        listingId: listing.id,
        company: listing.company,
        positionTitle: listing.positionTitle,
        location: listing.location,
        linkHost,
        submittedAt: application?.submittedAt ?? listing.updatedAt,
        employerStage: application?.employerStage ?? null,
      }];
    });
    return NextResponse.json({
      success: true,
      enabled: state.enabled,
      since,
      autoApplyConfidence: JOB_EMAIL_UPDATE_AUTO_APPLY_CONFIDENCE,
      receivedAutoApplyConfidence: JOB_EMAIL_UPDATE_RECEIVED_AUTO_APPLY_CONFIDENCE,
      knownMessageIds: Object.keys(state.processed),
      listings,
    });
  } catch (error) {
    console.error('Error reading job email update context:', error);
    return NextResponse.json({ success: false, error: 'Failed to read email update context' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = ActionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message ?? 'Invalid email update action' },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const listings = readJobListings().listings;
    let stageChanged = false;
    const result = await mutateJobApplicationsStore<JobEmailUpdatesResult>((store) => {
      const state = store.emailUpdates;
      const now = new Date().toISOString();
      const changed = new Map<string, JobApplicationRecord>();
      const trackable = (listingId: string | undefined) => {
        const listing = listings.find((candidate) => candidate.id === listingId);
        return listing && isTrackable(listing, store.applications[listing.id]) ? listing : undefined;
      };
      const apply = (listingId: string, update: Parameters<typeof applyEmployerUpdate>[1]) => {
        const application = materializeJobApplication(store, listingId);
        if (applyEmployerUpdate(application, update, now)) stageChanged = true;
        changed.set(listingId, application);
      };

      if (input.action === 'record') {
        const summary = { applied: 0, queued: 0, ignored: 0, skipped: 0 };
        for (const email of input.emails) {
          if (state.processed[email.gmailMessageId]) {
            summary.skipped += 1;
            continue;
          }
          if (!email.relevant) {
            markEmailProcessed(state, email.gmailMessageId, { at: now, outcome: 'ignored' });
            summary.ignored += 1;
            continue;
          }
          const listing = trackable(email.listingId);
          // The agent only reports; whether an email is trusted enough to act on is decided here.
          const confident = listing !== undefined && email.stage !== undefined &&
            email.alternatives.length === 0 &&
            email.confidence >= autoApplyConfidenceForStage(email.stage);
          if (confident) {
            apply(listing.id, {
              source: 'email', stage: email.stage!, receivedAt: email.receivedAt,
              gmailMessageId: email.gmailMessageId,
              ...(email.gmailThreadId ? { gmailThreadId: email.gmailThreadId } : {}),
              from: email.from, subject: email.subject, summary: email.summary, confidence: email.confidence,
            });
            markEmailProcessed(state, email.gmailMessageId, { at: now, outcome: 'applied', listingId: listing.id });
            summary.applied += 1;
            continue;
          }
          const suggestedListingIds = [...new Set([email.listingId, ...email.alternatives])]
            .filter((id): id is string => trackable(id) !== undefined);
          state.pending.push({
            id: randomUUID(),
            gmailMessageId: email.gmailMessageId,
            ...(email.gmailThreadId ? { gmailThreadId: email.gmailThreadId } : {}),
            receivedAt: email.receivedAt,
            from: email.from,
            subject: email.subject,
            summary: email.summary,
            ...(email.stage ? { suggestedStage: email.stage } : {}),
            suggestedListingIds,
            confidence: email.confidence,
            reason: email.reason,
            createdAt: now,
          });
          markEmailProcessed(state, email.gmailMessageId, { at: now, outcome: 'queued' });
          summary.queued += 1;
        }
        state.lastPolledAt = now;
        delete state.lastError;
        return { emailUpdates: toEmailUpdatesView(state), applications: [...changed.values()], summary };
      }

      if (input.action === 'poll-failed') {
        state.lastError = { message: input.error, occurredAt: now };
      }

      if (input.action === 'resolve') {
        const candidate = state.pending.find((entry) => entry.id === input.candidateId);
        if (!candidate) throw new Error('Email update not found');
        const resolution = input.resolution;
        if (resolution.kind === 'apply') {
          if (!trackable(resolution.listingId)) throw new Error('Job posting not found among applied postings');
          apply(resolution.listingId, {
            source: 'email', stage: resolution.stage, receivedAt: candidate.receivedAt,
            gmailMessageId: candidate.gmailMessageId,
            ...(candidate.gmailThreadId ? { gmailThreadId: candidate.gmailThreadId } : {}),
            from: candidate.from, subject: candidate.subject, summary: candidate.summary,
            confidence: candidate.confidence,
          });
          markEmailProcessed(state, candidate.gmailMessageId, { at: now, outcome: 'applied', listingId: resolution.listingId });
        } else {
          markEmailProcessed(state, candidate.gmailMessageId, { at: now, outcome: 'ignored' });
        }
        state.pending = state.pending.filter((entry) => entry.id !== candidate.id);
      }

      if (input.action === 'set-stage') {
        if (!trackable(input.listingId)) throw new Error('Job posting not found among applied postings');
        apply(input.listingId, { source: 'manual', stage: input.stage, receivedAt: now });
      }

      if (input.action === 'set-enabled') {
        state.enabled = input.enabled;
      }

      return { emailUpdates: toEmailUpdatesView(state), applications: [...changed.values()] };
    });

    const followUps: Array<() => Promise<unknown>> = [];
    // A stage change queued a Simplify card move; let the worker pick it up now.
    if (stageChanged) followUps.push(() => wakeJobApplicationWorkerIfEnabled());
    if (input.action === 'set-enabled') followUps.push(() => syncJobEmailUpdatesCron());
    for (const followUp of followUps) {
      const run = () => followUp().catch((error) => {
        console.error('Job email update follow-up failed:', error);
      });
      try {
        after(run);
      } catch {
        // No request scope (direct handler invocation): fire and forget.
        void run();
      }
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update email updates';
    console.error('Error updating job email updates:', error);
    return NextResponse.json({ success: false, error: message }, { status: /not found/i.test(message) ? 404 : 500 });
  }
}
