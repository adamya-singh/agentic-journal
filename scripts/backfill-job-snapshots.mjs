// node --import ./scripts/test-register.mjs scripts/backfill-job-snapshots.mjs [--apply]
import {
  readJobApplicationsStore,
  mutateJobApplicationsStore,
} from '../src/app/api/jobs/application-store-utils.ts';
import { readJobListings } from '../src/app/api/jobs/job-store-utils.ts';
import { makeSnapshot } from '../src/lib/job-overview.ts';
const listings = readJobListings().listings;
function backfill(store, apply) {
  let count = 0;
  for (const a of Object.values(store.applications)) {
    if (a.submissionSnapshot || !a.submittedAt) continue;
    const listing = listings.find((l) => l.id === a.listingId);
    if (!listing) continue;
    count++;
    if (apply)
      a.submissionSnapshot = makeSnapshot(
        a,
        listing,
        true,
        /confirmed manually/i.test(a.submissionEvidence?.message ?? ''),
      );
  }
  return count;
}
const apply = process.argv.includes('--apply');
const count = apply
  ? await mutateJobApplicationsStore((s) => backfill(s, true))
  : backfill(readJobApplicationsStore(), false);
console.log(
  JSON.stringify({
    apply,
    count,
    note: 'Reconstructed only; no historical resume hashes inferred.',
  }),
);
