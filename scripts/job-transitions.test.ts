import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { JobApplicationRecord } from '../src/lib/types';

// What an application may do once it is finished, and what a repeated blocker looks like.
const root = mkdtempSync(path.join(tmpdir(), 'agentic-journal-transitions-'));
const jobsDir = path.join(root, 'jobs');
process.env.JOB_APPLICATION_JOBS_DIR = jobsDir;
process.env.JOB_APPLICATION_RESUME_DIR = path.join(root, 'resumes');
process.env.BACKEND_DATA_DIR = path.join(root, 'backend');
process.env.OPENCLAW_CLI_PATH = path.join(root, 'missing-openclaw-cli.mjs');

let store: typeof import('../src/app/api/jobs/application-store-utils');
let answers: typeof import('../src/app/api/jobs/applications/answers/route');
let update: typeof import('../src/app/api/jobs/applications/update/route');
const CONFIRM = 'Confirm whether this application was submitted';
const now = '2026-11-12T12:00:00.000Z';
const at = (minutes: number) => new Date(Date.parse(now) + minutes * 60_000).toISOString();

function application(id: string, over: Partial<JobApplicationRecord> = {}): JobApplicationRecord {
  return {
    listingId: id, status: 'in-progress', resumeVariant: 'swe', attemptCount: 1,
    statusHistory: [], questions: [], createdAt: now, updatedAt: now, ...over,
  };
}
const post = (route: { POST: (r: NextRequest) => Promise<Response> }, body: unknown) =>
  route.POST(new NextRequest('http://localhost/api', { method: 'POST', body: JSON.stringify(body) }));
const put = (record: JobApplicationRecord) =>
  store.mutateJobApplicationsStore((data) => {
    data.applications[record.listingId] = record;
  });
const get = (id: string) => store.readJobApplicationsStore().applications[id];
const lease = () => ({ token: 'lease', claimedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() });

before(async () => {
  mkdirSync(jobsDir, { recursive: true });
  const listing = (id: string) => ({
    id, title: 'Engineer', company: 'Acme', url: `https://example.com/${id}`, status: 'saved',
    statusHistory: [], createdAt: now, updatedAt: now, savedAt: now,
  });
  writeFileSync(path.join(jobsDir, 'listings.json'), JSON.stringify({ listings: ['a', 'b', 'c', 'd'].map(listing) }));
  store = await import('../src/app/api/jobs/application-store-utils');
  answers = await import('../src/app/api/jobs/applications/answers/route');
  update = await import('../src/app/api/jobs/applications/update/route');
});

test('submitted and closed are final', () => {
  for (const status of ['submitted', 'closed'] as const) {
    const record = application('x', { status });
    assert.throws(() => store.setApplicationStatus(record, 'in-progress', now), /already/);
    assert.throws(() => store.setApplicationStatus(record, status === 'closed' ? 'submitted' : 'closed', now), /already/);
    store.setApplicationStatus(record, status, now);
    assert.equal(record.status, status);
  }
});

test('an answers POST cannot stamp a finished application again', async () => {
  const confirmed = store.createActionQuestion({ prompt: CONFIRM, now });
  await put(application('a', {
    status: 'submitted', submittedAt: now, submissionAttemptedAt: now,
    questions: [{ ...confirmed, resolution: 'answered', answer: 'submitted', answeredAt: now }],
    simplifySync: { status: 'synced', attemptCount: 1, updatedAt: now, cardId: 'card-1' },
  }));
  const response = await post(answers, { listingId: 'a' });
  assert.notEqual(response.status, 200);
  assert.equal(get('a').submittedAt, now);
  assert.equal(get('a').simplifySync?.cardId, 'card-1');
});

test('an old “retry” answer is not read again by a later POST', async () => {
  const retried = store.createActionQuestion({ prompt: CONFIRM, now });
  const blocker = store.createActionQuestion({ prompt: 'Sign in to Workday', pageUrl: 'https://example.com/login', now: at(5) });
  await put(application('b', {
    status: 'awaiting-user-input',
    // The worker clicked Submit again after the retry, then hit a sign-in wall.
    submissionAttemptedAt: at(4),
    questions: [{ ...retried, resolution: 'answered', answer: 'retry', answeredAt: at(1) }, blocker],
  }));
  const response = await post(answers, { listingId: 'b', responses: [{ questionId: blocker.id, answer: 'done' }] });
  assert.equal(response.status, 200);
  assert.equal(get('b').submissionAttemptedAt, at(4));
});

test('a blocker reported again after it was answered waits on him again', () => {
  const first = store.createActionQuestion({ prompt: 'Automation needs help with this application', now });
  const answered = { ...first, resolution: 'answered' as const, answer: 'done', answeredAt: at(1) };
  const again = store.createActionQuestion({ prompt: 'Automation needs help with this application', now: at(60) });
  assert.equal(again.id, first.id);
  const merged = store.mergeApplicationQuestions([answered], [again]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].resolution, 'pending');
  assert.equal(merged[0].answer, undefined);
  assert.equal(merged[0].occurrences, 2);
  assert.equal(merged[0].firstDiscoveredAt, now);
});

test('a worker that finds the posting closed after an unconfirmed Submit asks instead of archiving', async () => {
  await put(application('c', { submissionAttemptedAt: now, lease: lease() }));
  const response = await post(update, { action: 'closed', listingId: 'c', leaseToken: 'lease', reason: 'Posting no longer accepts applications' });
  assert.equal(response.status, 200);
  const record = get('c');
  assert.equal(record.status, 'awaiting-user-input');
  assert.equal(record.closedAt, undefined);
  assert.ok(record.questions.some((question) => question.prompt === CONFIRM && question.resolution === 'pending'));
});

test('a tracker move waits while a Submit click is unconfirmed', () => {
  const sync = { status: 'pending' as const, attemptCount: 0, updatedAt: now };
  const time = new Date(at(10));
  assert.equal(store.isTrackerMoveClaimable(application('d', { simplifySync: sync, submissionAttemptedAt: now }), time), false);
  assert.equal(
    store.isTrackerMoveClaimable(application('d', { status: 'submitted', simplifySync: sync, submissionAttemptedAt: now, submittedAt: now }), time),
    true,
  );
  // Applied to by hand, outside the Journal: no attempt on record, the card still moves.
  assert.equal(store.isTrackerMoveClaimable(application('d', { simplifySync: sync }), time), true);
});
