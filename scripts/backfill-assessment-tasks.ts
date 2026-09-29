// Adds the online-assessment journal task to applications that reached the
// assessment stage before OA tasks existed. Safe to re-run: an application
// whose OA task is still open is skipped.
//
//   node --import ./scripts/test-register.mjs scripts/backfill-assessment-tasks.ts          # preview
//   node --import ./scripts/test-register.mjs scripts/backfill-assessment-tasks.ts --apply  # write
import { mutateJobApplicationsStore } from '../src/app/api/jobs/application-store-utils';
import { ensureAssessmentTask } from '../src/app/api/jobs/assessment-task-utils';
import { readJobListings } from '../src/app/api/jobs/job-store-utils';
import { readGeneralTasks } from '../src/app/api/tasks/today/today-store-utils';

const apply = process.argv.includes('--apply');
const listings = readJobListings().listings;
const openTaskIds = new Set(readGeneralTasks('have-to-do').tasks.map((task) => task.id));

const run = async () => {
  await mutateJobApplicationsStore((store) => {
    const now = new Date().toISOString();
    for (const application of Object.values(store.applications)) {
      if (application.employerStage !== 'assessment') continue;
      const listing = listings.find((entry) => entry.id === application.listingId);
      const update = (application.employerUpdates ?? [])
        .filter((entry) => entry.stage === 'assessment')
        .sort((first, second) => second.receivedAt.localeCompare(first.receivedAt))[0];
      const label = `${listing?.company ?? application.listingId} — ${listing?.positionTitle ?? '?'}`;
      if (!listing || !update) {
        console.log(`skip (no posting or assessment email): ${label}`);
        continue;
      }
      if (application.assessmentTask && openTaskIds.has(application.assessmentTask.taskId)) {
        console.log(`skip (OA task already open): ${label}`);
        continue;
      }
      if (!apply) {
        console.log(`would add: ${label}`);
        continue;
      }
      ensureAssessmentTask(application, listing, update, now);
      console.log(`added ${application.assessmentTask?.taskId}: ${label}`);
    }
    // Preview: the unchanged store is rewritten as-is by the locked mutation.
  });
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
