import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-worker-resume-'));
const jobsDir = path.join(testRoot, 'jobs');
const resumeDir = path.join(testRoot, 'resumes');
process.env.JOB_APPLICATION_JOBS_DIR = jobsDir;
process.env.JOB_APPLICATION_RESUME_DIR = resumeDir;
process.env.BACKEND_DATA_DIR = path.join(testRoot, 'backend');
// No OpenClaw here: every wake fails, as it does when the gateway is still starting after a boot.
process.env.OPENCLAW_CLI_PATH = path.join(testRoot, 'missing-openclaw-cli.mjs');

let store: typeof import('../src/app/api/jobs/application-store-utils');
let worker: typeof import('../src/app/api/jobs/application-worker-utils');
const at = '2026-11-18T10:00:00.000Z';
const setEnabled = (enabled: boolean) => store.mutateJobApplicationsStore((data) => { data.workerEnabled = enabled; });
const enabled = () => store.readJobApplicationsStore().workerEnabled;

before(async () => {
  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(resumeDir, { recursive: true });
  writeFileSync(path.join(resumeDir, 'Adamya_Singh_Resume_SWE.pdf'), '%PDF-test');
  writeFileSync(path.join(resumeDir, 'Adamya_Singh_Resume_MLE.pdf'), '%PDF-test');
  writeFileSync(path.join(jobsDir, 'listings.json'), JSON.stringify({ schemaVersion: 2, listings: [] }));
  store = await import('../src/app/api/jobs/application-store-utils');
  worker = await import('../src/app/api/jobs/application-worker-utils');
  await store.mutateJobApplicationsStore((data) => { data.enabledApplicationCategories = ['new-grad']; });
});
after(() => rmSync(testRoot, { recursive: true, force: true }));

test('a paused worker is switched back on when the machine has just booted', async () => {
  await setEnabled(false);
  assert.deepEqual(await worker.resumeJobApplicationWorkerAfterReboot({ uptimeSeconds: 120 }), {
    resumed: true, woken: false, reason: 'nothing to apply to',
  });
  assert.equal(enabled(), true);
});

test('a Journal restart without a reboot leaves a pause alone', async () => {
  await setEnabled(false);
  for (const uptimeSeconds of [3600, null]) {
    assert.equal((await worker.resumeJobApplicationWorkerAfterReboot({ uptimeSeconds })).reason, 'not a reboot');
  }
  assert.equal(enabled(), false);
});

test('it stays off when Start itself would refuse, or when switched off by flag', async () => {
  await setEnabled(false);
  await store.mutateJobApplicationsStore((data) => { data.enabledApplicationCategories = []; });
  assert.equal((await worker.resumeJobApplicationWorkerAfterReboot({ uptimeSeconds: 60 })).reason, 'no category selected');
  await store.mutateJobApplicationsStore((data) => { data.enabledApplicationCategories = ['new-grad']; });
  process.env.JOB_WORKER_RESUME_ON_BOOT_DISABLED = '1';
  assert.equal((await worker.resumeJobApplicationWorkerAfterReboot({ uptimeSeconds: 60 })).reason, 'disabled');
  delete process.env.JOB_WORKER_RESUME_ON_BOOT_DISABLED;
  assert.equal(enabled(), false);
});

test('with work waiting and OpenClaw not up yet, the worker stays on and the wake is retried', async () => {
  await setEnabled(false);
  writeFileSync(path.join(jobsDir, 'listings.json'), JSON.stringify({ schemaVersion: 2, listings: [{
    id: 'one', company: 'Acme', companySummary: 'x', positionTitle: 'Engineer', location: 'NYC',
    applicationCategories: ['new-grad'], track: 'focus', status: 'saved', salary: 'not listed',
    link: 'https://acme.com/1', source: { name: 'x', link: 'https://acme.com' }, notes: 'Pros: a. Cons: b.',
    savedAt: at, statusHistory: [], createdAt: at, updatedAt: at,
  }] }));
  const result = await worker.resumeJobApplicationWorkerAfterReboot({ uptimeSeconds: 60, retryMs: 1 });
  assert.deepEqual(result, { resumed: true, woken: false, reason: 'OpenClaw did not answer' });
  assert.equal(enabled(), true);
});
