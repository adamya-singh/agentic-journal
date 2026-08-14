/**
 * Server-start hook (Next.js instrumentation): the closed-tab partner for the
 * job-application dead-run self-heal. The list route recovers stranded runs
 * while someone is looking at /jobs; this interval covers the rest of the
 * time. A tick is a single JSON file read unless a stale lease exists.
 */
const RECONCILE_INTERVAL_MS = 5 * 60 * 1000;

const REGISTERED_FLAG = Symbol.for('agentic-journal.jobs-reconcile-interval');

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const globalState = globalThis as { [REGISTERED_FLAG]?: boolean };
  if (globalState[REGISTERED_FLAG]) {
    return;
  }
  globalState[REGISTERED_FLAG] = true;

  const { reconcileAndWakeJobApplicationWorker } = await import(
    './app/api/jobs/application-worker-utils'
  );
  const interval = setInterval(() => {
    reconcileAndWakeJobApplicationWorker().catch((error) => {
      console.error('Scheduled job application reconcile failed:', error);
    });
  }, RECONCILE_INTERVAL_MS);
  interval.unref();
}
