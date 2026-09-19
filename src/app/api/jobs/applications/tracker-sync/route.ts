import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { readJobListings } from '../../job-store-utils';
import { mutateJobApplicationsStore } from '../../application-store-utils';

export const runtime = 'nodejs';

const UpdateSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }),
  z.object({
    action: z.literal('complete'), listingId: z.string().min(1), leaseToken: z.string().min(1),
    cardId: z.string().min(1),
  }),
  z.object({
    action: z.literal('fail'), listingId: z.string().min(1), leaseToken: z.string().min(1),
    error: z.string().min(1), retryable: z.boolean().default(true),
  }),
]);

export async function POST(request: NextRequest) {
  try {
    const parsed = UpdateSchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid sync action' }, { status: 400 });
    const listings = readJobListings().listings;
    const result = await mutateJobApplicationsStore((store) => {
      const now = new Date();
      const nowIso = now.toISOString();
      if (parsed.data.action === 'claim') {
        for (const application of Object.values(store.applications)) {
          const sync = application.simplifySync;
          if (!sync || sync.status === 'synced') continue;
          if (sync.lease && Date.parse(sync.lease.expiresAt) > now.getTime()) continue;
          if (sync.nextRetryAt && Date.parse(sync.nextRetryAt) > now.getTime()) continue;
          const listing = listings.find((candidate) => candidate.id === application.listingId);
          if (!listing) continue;
          const leaseToken = randomUUID();
          sync.status = 'in-progress';
          sync.attemptCount += 1;
          sync.updatedAt = nowIso;
          sync.lease = {
            token: leaseToken,
            claimedAt: nowIso,
            expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
          };
          delete sync.nextRetryAt;
          return { listing, application, leaseToken };
        }
        return null;
      }
      const application = store.applications[parsed.data.listingId];
      const sync = application?.simplifySync;
      if (!sync?.lease || sync.lease.token !== parsed.data.leaseToken || Date.parse(sync.lease.expiresAt) <= now.getTime()) {
        throw new Error('Simplify synchronization lease is missing or expired');
      }
      if (parsed.data.action === 'complete') {
        sync.status = 'synced';
        sync.cardId = parsed.data.cardId;
        sync.updatedAt = nowIso;
        delete sync.lease;
        delete sync.error;
        delete sync.nextRetryAt;
      } else {
        sync.status = 'failed';
        sync.error = parsed.data.error;
        sync.updatedAt = nowIso;
        delete sync.lease;
        if (parsed.data.retryable) {
          const delayMinutes = Math.min(24 * 60, 5 * 6 ** Math.max(sync.attemptCount - 1, 0));
          sync.nextRetryAt = new Date(now.getTime() + delayMinutes * 60_000).toISOString();
        } else {
          delete sync.nextRetryAt;
        }
      }
      return { listingId: application.listingId, simplifySync: sync };
    });
    return NextResponse.json({ success: true, sync: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Simplify synchronization failed';
    return NextResponse.json({ success: false, error: message }, { status: /lease/i.test(message) ? 409 : 500 });
  }
}
