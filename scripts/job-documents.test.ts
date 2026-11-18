import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { JobApplicationQuestion, JobApplicationRecord } from '../src/lib/types';

const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-documents-'));
const jobsDir = path.join(testRoot, 'jobs');
process.env.JOB_APPLICATION_JOBS_DIR = jobsDir;
process.env.JOB_APPLICATION_RESUME_DIR = path.join(testRoot, 'resumes');
process.env.BACKEND_DATA_DIR = path.join(testRoot, 'backend');
process.env.OPENCLAW_CLI_PATH = path.join(testRoot, 'missing-openclaw-cli.mjs');

let store: typeof import('../src/app/api/jobs/application-store-utils');
let route: typeof import('../src/app/api/jobs/applications/documents/route');
let notify: typeof import('../src/app/api/jobs/applications/review-notify');
const now = '2026-11-18T15:00:00.000Z';
const file = (prompt: string, required = true): JobApplicationQuestion =>
  ({ id: prompt, prompt, kind: 'file', required, resolution: 'pending', discoveredAt: now });
const waiting = (listingId: string, questions: JobApplicationQuestion[], extra: Partial<JobApplicationRecord> = {}): JobApplicationRecord => ({
  listingId, status: 'awaiting-user-input', resumeVariant: 'swe', attemptCount: 1, statusHistory: [],
  awaitingInputSince: now, questions, createdAt: now, updatedAt: now, ...extra,
});
const upload = (name: string, bytes: string, kind = 'transcript') => {
  const body = new FormData();
  body.set('kind', kind);
  body.set('file', new File([bytes], name, { type: 'application/pdf' }));
  return route.POST(new NextRequest('http://localhost/api/jobs/applications/documents', { method: 'POST', body }));
};

before(async () => {
  mkdirSync(jobsDir, { recursive: true });
  writeFileSync(path.join(jobsDir, 'listings.json'), JSON.stringify({ schemaVersion: 2, listings: [] }));
  store = await import('../src/app/api/jobs/application-store-utils');
  route = await import('../src/app/api/jobs/applications/documents/route');
  notify = await import('../src/app/api/jobs/applications/review-notify');
});
after(() => rmSync(testRoot, { recursive: true, force: true }));

test('a transcript upload is recognised however the posting words it', () => {
  const kind = (prompt: string) => store.standingDocumentFor({ kind: 'file', prompt });
  for (const prompt of [
    'Undergraduate Transcript', 'Academic Transcripts', 'Transcript',
    'Please provide a recent transcript of your undergraduate studies.*',
    'Please attach a single PDF with transcripts from all undergraduate and graduate institutions',
  ]) assert.equal(kind(prompt), 'transcript', prompt);
  for (const prompt of [
    'Graduate Transcript', 'Please provide a recent transcript of your graduate studies (if applicable)',
    'Please upload any graduate transcript (MS, PhD)',
  ]) assert.equal(kind(prompt), 'graduate-transcript', prompt);
  assert.equal(kind('Cover Letter'), null);
  assert.equal(store.standingDocumentFor({ kind: 'text', prompt: 'Transcript' }), null);
});

test('without a saved transcript the question waits; an optional graduate transcript is skipped', () => {
  const undergraduate = file('Undergraduate Transcript');
  const optionalGraduate = file('Graduate Transcript', false);
  const requiredGraduate = file('Graduate Transcript');
  assert.equal(store.answerFromDocuments(undergraduate, {}, now), false);
  assert.equal(store.answerFromDocuments(optionalGraduate, {}, now), true);
  assert.equal(optionalGraduate.resolution, 'skipped');
  assert.equal(store.answerFromDocuments(requiredGraduate, {}, now), false);
  assert.equal(requiredGraduate.resolution, 'pending');
});

test('saving the transcript answers every application waiting on it and sends them back to the worker', async () => {
  await store.mutateJobApplicationsStore((data) => {
    data.applications.ready = waiting('ready', [file('Please provide a recent transcript of your undergraduate studies.*'), file('Graduate Transcript', false)]);
    data.applications.more = waiting('more', [file('Undergraduate Transcript'), file('Cover Letter', false)]);
  });
  assert.equal((await upload('notes.txt', 'hello')).status, 400);
  assert.equal((await upload('transcript.pdf', 'not a pdf')).status, 400);
  assert.equal((await upload('transcript.pdf', '%PDF-1.4 x', 'passport')).status, 400);

  const saved = await (await upload('Adamya Singh Transcript.pdf', '%PDF-1.4 transcript')).json();
  assert.equal(saved.success, true);
  assert.deepEqual(saved.released, ['ready']);
  assert.equal(saved.documents.transcript.fileName, 'Adamya-Singh-Transcript.pdf');

  const data = store.readJobApplicationsStore();
  const [undergraduate, graduate] = data.applications.ready.questions;
  assert.equal(undergraduate.answer, saved.documents.transcript.answer);
  assert.equal(undergraduate.resolution, 'answered');
  assert.equal(graduate.resolution, 'skipped');
  assert.equal(data.applications.ready.status, 'in-progress');
  assert.ok(data.applications.ready.resumeRequestedAt);
  // The cover letter still needs him, so this one stays, with its transcript already answered.
  assert.equal(data.applications.more.status, 'awaiting-user-input');
  assert.equal(data.applications.more.questions[0].resolution, 'answered');
  assert.ok(store.applicationFileExists(saved.documents.transcript.answer));
  assert.deepEqual((await (await route.GET()).json()).documents, saved.documents);

  // A transcript question the worker reports later never stops the application.
  const later = file('Academic Transcripts');
  assert.equal(store.answerFromMemory(later, data, now), true);
  assert.equal(later.answer, saved.documents.transcript.answer);
});

test('the daily message lists drafted applications and when each sends itself', () => {
  const listing = (id: string, company: string) => ({ id, company, positionTitle: 'Software Engineer', track: 'focus' } as never);
  const drafted = (id: string, sendsAt: string, questions: JobApplicationQuestion[] = []) =>
    waiting(id, questions, { reviewHoldSince: now, autoSubmitEligibleAt: sendsAt });
  const eligibility: JobApplicationQuestion = {
    id: 'visa', prompt: 'Will you require visa sponsorship?', kind: 'single-select', required: true,
    resolution: 'auto-resolved', answer: 'No', discoveredAt: now,
  };
  const held = notify.heldForReview({
    later: drafted('later', '2026-11-19T20:00:00.000Z'),
    sooner: drafted('sooner', '2026-11-19T14:00:00.000Z'),
    approve: drafted('approve', '2026-11-19T10:00:00.000Z', [eligibility]),
    questions: waiting('questions', [file('Cover Letter')]),
    sent: { ...drafted('sent', now), status: 'submitted' },
  }, [listing('later', 'Later Co'), listing('sooner', 'Sooner Co'), listing('approve', 'Approve Co'), listing('questions', 'Q'), listing('sent', 'S')]);
  assert.deepEqual(held.map((item) => item.company), ['Sooner Co', 'Later Co', 'Approve Co']);

  const message = notify.buildReviewMessage(held, 'https://journal.example', new Date('2026-11-19T14:30:00.000Z'));
  const lines = message.split('\n');
  assert.equal(lines[0], '3 job applications are drafted and ready to send');
  assert.match(lines[1], /^• Sooner Co, Software Engineer: sends on OpenClaw’s next run$/);
  assert.match(lines[2], /^• Later Co, Software Engineer: sends itself today /);
  assert.equal(lines[3], '• Approve Co, Software Engineer: waits for you to approve 1 eligibility answer');
  assert.equal(lines[4], 'Review: https://journal.example/jobs');
});

test('the message goes once a day, from 09:00, only when something is held', () => {
  const at = (hour: number) => new Date(2026, 10, 19, hour, 5);
  const decide = (now: Date, state = {}, held = 2, disabled = false) => notify.decideReviewNotify({ now, disabled, state, held });
  assert.equal(decide(at(8)), 'quiet');
  assert.equal(decide(at(23)), 'quiet');
  assert.equal(decide(at(9)), 'send');
  assert.equal(decide(at(9), {}, 0), 'nothing');
  assert.equal(decide(at(15), { lastSentAt: at(9).toISOString() }), 'sent-today');
  assert.equal(decide(at(9), { lastSentAt: new Date(2026, 10, 18, 9, 5).toISOString() }), 'send');
  assert.equal(decide(at(9), { tries: { date: '2026-11-19', count: 3 } }), 'tries-used');
  assert.equal(decide(at(9), {}, 2, true), 'disabled');
});

test('a sent message is recorded, and a failed send is not', async () => {
  await store.mutateJobApplicationsStore((data) => {
    data.applications.held = waiting('held', [], { reviewHoldSince: now, autoSubmitEligibleAt: '2026-11-20T15:00:00.000Z' });
  });
  writeFileSync(path.join(jobsDir, 'listings.json'), JSON.stringify({ schemaVersion: 2, listings: [{
    id: 'held', company: 'Held Co', companySummary: 'x', positionTitle: 'Engineer', location: 'NYC', applicationCategories: ['new-grad'],
    status: 'saved', salary: 'not listed', link: 'https://held.example/1', source: { name: 'x', link: 'https://held.example' },
    notes: 'Pros: a. Cons: b.', savedAt: now, statusHistory: [], createdAt: now, updatedAt: now,
  }] }));
  const sent: string[][] = [];
  const deps = (fail: boolean) => ({
    available: () => true, target: async () => '42',
    send: async (args: string[]) => { if (fail) throw new Error('down'); sent.push(args); return 'sent'; },
  });
  const morning = new Date(2026, 10, 19, 9, 5);
  assert.equal((await notify.notifyApplicationsReadyForReview(morning, deps(true))).decision, 'failed');
  const result = await notify.notifyApplicationsReadyForReview(morning, deps(false));
  assert.equal(result.decision, 'sent');
  assert.match(result.message!, /^1 job application is drafted and ready to send\n• Held Co, Engineer: sends itself /);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][sent[0].indexOf('--target') + 1], '42');
  assert.equal((await notify.notifyApplicationsReadyForReview(new Date(2026, 10, 19, 15, 0), deps(false))).decision, 'sent-today');
});
