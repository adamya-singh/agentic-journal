import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { JobApplicationRecord, JobListing } from '../src/lib/types';
const root = mkdtempSync(path.join(tmpdir(), 'oa-preview-'));
process.env.BACKEND_DATA_DIR = root;
process.env.OA_PREVIEW_DISABLED = '1';
after(() => rmSync(root, { recursive: true, force: true }));

const URL_1 = 'https://you.ashbyhq.com/Acme/assignment/abc';

async function seed() {
  const { ensureAssessmentTask } = await import('../src/app/api/jobs/assessment-task-utils');
  const { writeJobListings } = await import('../src/app/api/jobs/job-store-utils');
  const { mutateJobApplicationsStore } = await import('../src/app/api/jobs/application-store-utils');
  const listing = { id: 'acme', company: 'Acme', positionTitle: 'FDE', link: 'https://example.com/job', savedAt: '2026-10-14T00:00:00Z' } as JobListing;
  writeJobListings({ listings: [listing] } as never);
  await mutateJobApplicationsStore((store) => {
    const application = {
      listingId: 'acme', status: 'submitted', submittedAt: '2026-10-14T00:00:00Z', employerStage: 'assessment',
      employerUpdates: [{ id: 'inv', source: 'email', stage: 'assessment', receivedAt: '2026-10-22T18:50:00Z', appliedAt: '2026-10-22T19:00:00Z', provider: 'Ashby', assessmentType: 'take-home', assessmentUrl: URL_1 }],
      createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-22T19:00:00Z',
    } as unknown as JobApplicationRecord;
    ensureAssessmentTask(application, listing, '2026-10-22T19:00:00Z');
    store.applications.acme = application;
  });
  return listing;
}

test('an OA with a link is due a preview once, and the saved capture reaches the casebook and the task', async () => {
  await seed();
  const preview = await import('../src/app/api/jobs/assessment-preview-utils');
  const { mutateJobApplicationsStore, readJobApplicationsStore } = await import('../src/app/api/jobs/application-store-utils');
  const { readGeneralTasks } = await import('../src/app/api/tasks/today/today-store-utils');
  const { readInterviews, processDir } = await import('../src/lib/interviews/store');

  assert.deepEqual(preview.listPendingPreviews().map((p) => p.listingId), ['acme']);
  const now = '2026-10-25T20:00:00.000Z';
  assert.deepEqual(await mutateJobApplicationsStore((store) => preview.requestDuePreviews(store, now)), ['acme']);
  // Requested and survives a store round-trip; not asked again until the retry window passes, but still pending for the run.
  assert.equal(readJobApplicationsStore().applications.acme.assessmentTask?.preview?.status, 'requested');
  assert.deepEqual(await mutateJobApplicationsStore((store) => preview.requestDuePreviews(store, now)), []);
  assert.equal(preview.listPendingPreviews().length, 1);
  const later = new Date(Date.parse(now) + preview.PREVIEW_RETRY_MS).toISOString();
  assert.deepEqual(await mutateJobApplicationsStore((store) => preview.requestDuePreviews(store, later)), ['acme']);
  assert.equal(readJobApplicationsStore().applications.acme.assessmentTask?.preview?.attempts, 2);

  await assert.rejects(preview.saveAssessmentPreview({ listingId: 'acme', status: 'saved', body: 'x', summary: ['ok'], attachments: [{ name: 'run.sh', data: Buffer.from('x') }] }), /not allowed/);
  const saved = await preview.saveAssessmentPreview({
    listingId: 'acme', status: 'saved', body: '# Acme\n\nWrite a memo.', summary: ['Take-home memo, 2–4 hours', 'Submit as PDF'],
    attachments: [{ name: 'page-1.png', data: Buffer.from('png') }],
  }, '2026-10-25T21:00:00.000Z');
  assert.equal(preview.listPendingPreviews().length, 0);

  const process = readInterviews().processes.find((p) => p.listingId === 'acme')!;
  const note = process.notes.find((n) => n.id === saved.noteId)!;
  assert.equal(note.kind, 'oa');
  assert.equal(note.author, 'openclaw');
  assert.equal(note.round, 'oa-inv');
  assert.equal(readFileSync(path.join(processDir(process), note.file), 'utf8'), '# Acme\n\nWrite a memo.');
  assert.ok(process.notes.some((n) => n.kind === 'file' && n.file === 'oa-preview-page-1.png'));

  const record = readJobApplicationsStore().applications.acme;
  const task = readGeneralTasks('have-to-do').tasks.find((t) => t.id === record.assessmentTask!.taskId)!;
  assert.match(task.notesMarkdown!, /\*\*What the OA page shows\*\* \(OpenClaw opened the link without starting it/);
  assert.match(task.notesMarkdown!, /- Take-home memo, 2–4 hours\n- Submit as PDF/);
  assert.ok(task.notesMarkdown!.includes(`process=${encodeURIComponent(saved.processId)}&note=${saved.noteId}`));

  // A second save replaces the same note rather than adding another.
  const again = await preview.saveAssessmentPreview({ listingId: 'acme', status: 'saved', body: 'v2', summary: ['v2'], attachments: [{ name: 'page-1.png', data: Buffer.from('png2') }] });
  assert.equal(again.noteId, saved.noteId);
  const after2 = readInterviews().processes.find((p) => p.listingId === 'acme')!;
  assert.equal(after2.notes.filter((n) => n.kind === 'oa').length, 1);
  assert.equal(after2.notes.filter((n) => n.kind === 'file').length, 1);

  // A new link in a reminder means a new preview.
  await mutateJobApplicationsStore((store) => {
    store.applications.acme.employerUpdates!.push({ id: 'rem', source: 'email', stage: null, eventKind: 'assessment-reminder', receivedAt: '2026-10-26T12:00:00Z', appliedAt: '2026-10-26T12:00:00Z', assessmentUrl: 'https://you.ashbyhq.com/Acme/assignment/new' } as never);
  });
  assert.deepEqual(preview.listPendingPreviews().map((p) => [p.assessmentUrl, p.attempts]), [['https://you.ashbyhq.com/Acme/assignment/new', 0]]);
});

test('failed runs stop being retried after the attempt limit', async () => {
  const preview = await import('../src/app/api/jobs/assessment-preview-utils');
  const url = 'https://example.com/oa';
  const failed = { url, status: 'failed' as const, attempts: preview.PREVIEW_MAX_ATTEMPTS - 1, requestedAt: '2026-10-25T00:00:00Z' };
  assert.equal(preview.previewDue(failed, url, Date.parse('2026-10-25T01:00:00Z')), false);
  assert.equal(preview.previewDue(failed, url, Date.parse('2026-10-25T03:00:00Z')), true);
  assert.equal(preview.previewDue({ ...failed, attempts: preview.PREVIEW_MAX_ATTEMPTS }, url, Date.parse('2026-10-26T00:00:00Z')), false);
  assert.equal(preview.previewDue({ ...failed, status: 'blocked' }, url, Date.parse('2026-10-26T00:00:00Z')), false);
});
