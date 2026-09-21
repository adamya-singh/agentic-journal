import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { mutateJobApplicationsStore } from '../../application-store-utils';

export const runtime = 'nodejs';

const ActionSchema = z.object({
  action: z.literal('extend'),
  listingId: z.string().min(1),
  hours: z.number().int().min(1).max(14 * 24).default(24),
});

class AutopilotRequestError extends Error {}

/**
 * Pushes back the next thing autopilot would do on its own for one application:
 * the auto-submit deadline while its drafted answers are under review, otherwise
 * the time autopilot drafts the remaining answers. A deadline that has already
 * passed restarts from now.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = ActionSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid autopilot request' }, { status: 400 });
    }
    const { listingId, hours } = parsed.data;
    const result = await mutateJobApplicationsStore((store) => {
      const application = store.applications[listingId];
      if (!application) throw new AutopilotRequestError('Job application not found');
      const now = Date.now();
      // Only while it is parked waiting on you: a run that already claimed it
      // must not have its deadline moved underneath it.
      if (
        application.status !== 'awaiting-user-input' ||
        (application.lease && Date.parse(application.lease.expiresAt) > now)
      ) {
        throw new AutopilotRequestError('Autopilot is not waiting on this application right now');
      }
      const field = application.reviewHoldSince ? 'autoSubmitEligibleAt' : 'autoCompleteEligibleAt';
      const current = application[field];
      if (!current) throw new AutopilotRequestError('This application has no autopilot date to extend');
      const extended = new Date(Math.max(Date.parse(current), now) + hours * 60 * 60 * 1000).toISOString();
      application[field] = extended;
      application.updatedAt = new Date(now).toISOString();
      return { application, field, extendedTo: extended };
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to extend the autopilot date';
    if (!(error instanceof AutopilotRequestError)) console.error('Error extending autopilot date:', error);
    return NextResponse.json(
      { success: false, error: message },
      { status: error instanceof AutopilotRequestError ? (/not found/i.test(message) ? 404 : 409) : 500 },
    );
  }
}
