import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  answerPolarity, describeCandidateFacts, eligibilityConflict, normalizeCandidateFacts, type CandidateFacts,
} from '../src/lib/candidate-facts';
import { needsExplicitReview } from '../src/lib/application-eligibility';
import type { JobApplicationQuestion, JobApplicationRecord } from '../src/lib/types';

const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-facts-'));
const jobsDir = path.join(testRoot, 'jobs');
process.env.JOB_APPLICATION_JOBS_DIR = jobsDir;
process.env.JOB_APPLICATION_RESUME_DIR = path.join(testRoot, 'resumes');
process.env.BACKEND_DATA_DIR = path.join(testRoot, 'backend');
process.env.OPENCLAW_CLI_PATH = path.join(testRoot, 'missing-openclaw-cli.mjs');

let store: typeof import('../src/app/api/jobs/application-store-utils');
let route: typeof import('../src/app/api/jobs/applications/candidate-facts/route');
before(async () => {
  mkdirSync(jobsDir, { recursive: true });
  writeFileSync(path.join(jobsDir, 'listings.json'), JSON.stringify({ schemaVersion: 2, listings: [] }));
  store = await import('../src/app/api/jobs/application-store-utils');
  route = await import('../src/app/api/jobs/applications/candidate-facts/route');
});
after(() => rmSync(testRoot, { recursive: true, force: true }));

const now = '2026-11-18T18:00:00.000Z';
const FACTS: CandidateFacts = {
  workAuthorization: 'any-employer', sponsorship: 'never', citizenship: 'us-citizen', clearance: 'none-willing',
  onsite: 'any', relocation: 'anywhere-us', earliestStart: '2027-01', restrictions: 'none', confirmedAt: now,
};
const drafted = (prompt: string, answer: string | string[]): JobApplicationQuestion => ({
  id: prompt, prompt, kind: 'single-select', required: true, resolution: 'auto-resolved', answer, discoveredAt: now,
  generatedAnswer: { source: 'chatgpt-web', generatedAt: now, confidence: 0.9, assumptions: [] } as never,
});
const conflict = (prompt: string, answer: string | string[], facts = FACTS) => eligibilityConflict({ prompt, answer }, facts);

test('answers that agree with the standing facts raise no conflict', () => {
  for (const [prompt, answer] of [
    ['Will you now or in the future require sponsorship for employment visa status in this country?*', 'No'],
    ['Sponsorship Requirements', 'I will not require sponsorship now or in the future to work in the US'],
    ['If so, please explain (visa status and expiration). If you do not require sponsorship, please type "N/A".', 'N/A'],
    ['Are you legally authorized to work in the United States?', 'YES: If you currently hold a valid work permit'],
    ['Work Authorization*', 'I am authorized to work for any employer in the country in which this position is based.'],
    ['Are you a citizen or lawful permanent resident of Cuba, Syria, Iran, North Korea, or the Crimea region?', 'No'],
    ['Are you currently, or have you been previously, suspended/debarred by any Government entity?', 'No'],
    ['Are you a U.S. citizen, U.S. lawful permanent resident, or protected individual?', 'Yes'],
    ['Are you able to work on-site at our office 3-5 days per week?*', 'Yes'],
    ['Are you willing to relocate to the Bay Area?*', 'Yes'],
    ['Are you currently pursuing or recently completed a graduate degree (MS or PhD)?', 'No'],
    ['Would you require an export license under the circumstances described below?', 'No'],
    ['Are you able and willing to obtain a security clearance?', 'Yes'],
    ['Do you currently hold an active security clearance?', 'No'],
  ] as const) assert.equal(conflict(prompt, answer), null, prompt);
});

test('answers that touch no standing fact are left to the ordinary review window', () => {
  assert.equal(conflict('Which country do you intend to work from?', 'New York City, United States'), null);
  assert.equal(conflict('Bachelor\'s degree or equivalent practical experience.', 'Yes'), null);
  assert.equal(conflict('Please list ALL the countries that you have citizenship in.', 'United States of America'), null);
});

test('an answer that contradicts a fact, or is unclear where the fact says no, waits for him', () => {
  assert.match(conflict('Will you require visa sponsorship?', 'Yes')!, /visa sponsorship.*say no/);
  assert.match(conflict('Sponsorship Requirements', 'I will require sponsorship in the future')!, /visa sponsorship/);
  assert.match(conflict('Are you authorized to work in the United States?', 'No')!, /work authorization.*say yes/);
  assert.match(conflict('Are you willing to relocate?', 'No, I need to stay in New Jersey')!, /relocation/);
  assert.match(conflict('Are you open to working 5 days a week onsite in San Francisco', 'No')!, /on-site work/);
  assert.match(conflict('Have you ever been debarred?', 'Yes')!, /debarment/);
  assert.match(conflict('Do you currently hold an active security clearance?', 'Yes')!, /security clearance/);
  // A "yes" fact only objects to a clear no: a select value such as "1" passes.
  assert.equal(conflict('Are you able to work on-site at our office 3-5 days per week?*', '1'), null);
});

test('a fact that is not a plain yes or no leaves the question for him each time', () => {
  assert.match(conflict('Will you require sponsorship?', 'No', { ...FACTS, sponsorship: 'later' })!, /leave visa sponsorship for you/);
  assert.match(conflict('Are you able to work in-person in San Jose?', 'Yes', { ...FACTS, onsite: 'hybrid' })!, /on-site work for you/);
  assert.match(conflict('Have you been debarred?', 'No', { ...FACTS, restrictions: 'some' })!, /for you/);
});

test('yes and no are read from the start of an answer, then from its negation', () => {
  assert.equal(answerPolarity('Yes, I can work in New York'), 'yes');
  assert.equal(answerPolarity('NO'), 'no');
  assert.equal(answerPolarity('I do not require sponsorship'), 'no');
  assert.equal(answerPolarity(['Mountain View, CA', 'Seattle, WA']), 'unclear');
  assert.equal(answerPolarity(undefined), 'unclear');
});

test('the review rule: every drafted eligibility answer waits without facts, only conflicts with them', () => {
  const agrees = drafted('Will you now or in the future require visa sponsorship?', 'No');
  const contradicts = drafted('Will you now or in the future require visa sponsorship?', 'Yes');
  assert.equal(needsExplicitReview(agrees), true);
  assert.equal(needsExplicitReview(agrees, FACTS), false);
  assert.equal(needsExplicitReview(contradicts, FACTS), true);
  // His own confirmation of that exact answer settles it either way.
  assert.equal(needsExplicitReview({ ...contradicts, eligibilityReviewedAnswer: 'Yes' }, FACTS), false);
  // A redo he asked for still waits for him.
  assert.equal(needsExplicitReview({ ...agrees, redoRequest: { instructions: 'shorter', requestedAt: now } } as never, FACTS), true);
});

test('saving the facts lets a held application with agreeing answers be sent once its review day is over', async () => {
  const held: JobApplicationRecord = {
    listingId: 'held', status: 'awaiting-user-input', resumeVariant: 'swe', attemptCount: 1, statusHistory: [],
    awaitingInputSince: now, autoCompleteEligibleAt: now, reviewHoldSince: now, autoSubmitEligibleAt: '2026-11-19T18:00:00.000Z',
    questions: [drafted('Are you legally eligible to work in the country of employment?', 'Yes')], createdAt: now, updatedAt: now,
  };
  const afterDeadline = new Date('2026-11-19T18:00:01.000Z');
  assert.equal(store.isApplicationClaimable(held, afterDeadline), false);
  assert.equal(store.isApplicationClaimable(held, afterDeadline, FACTS), true);
  // The review day itself still holds it.
  assert.equal(store.isApplicationClaimable(held, new Date('2026-11-19T17:00:00.000Z'), FACTS), false);

  const post = (body: object) =>
    route.POST(new NextRequest('http://localhost/api/jobs/applications/candidate-facts', { method: 'POST', body: JSON.stringify(body) }));
  assert.equal((await post({ ...FACTS, sponsorship: 'sometimes' })).status, 400);
  assert.equal((await post({ workAuthorization: 'any-employer' })).status, 400);
  const saved = await (await post(FACTS)).json();
  assert.equal(saved.success, true);
  assert.notEqual(saved.facts.confirmedAt, now);
  assert.deepEqual({ ...store.readJobApplicationsStore().candidateFacts, confirmedAt: now }, FACTS);
  assert.deepEqual((await (await route.GET()).json()).facts, saved.facts);
});

test('the facts read as sentences for the worker, and bad stored facts are dropped', () => {
  const lines = describeCandidateFacts(FACTS);
  assert.ok(lines.includes('Visa sponsorship: Never needed, now or in the future.'));
  assert.ok(lines.includes('Citizenship: US citizen, no other citizenship.'));
  assert.ok(lines.includes('Earliest full-time start: 2027-01.'));
  assert.equal(normalizeCandidateFacts({ ...FACTS, onsite: 'sometimes' }), undefined);
  assert.equal(normalizeCandidateFacts({ ...FACTS, earliestStart: 'January' }), undefined);
  assert.equal(normalizeCandidateFacts(null), undefined);
});

test('a failing application is retried through the whole ladder before it asks for help', () => {
  const application: JobApplicationRecord = {
    listingId: 'flaky', status: 'in-progress', resumeVariant: 'swe', attemptCount: 1, statusHistory: [], questions: [],
    createdAt: now, updatedAt: now,
  };
  const failure = { code: 'browser-timeout', message: 'Browser timed out when opening listing URL.', source: 'worker' as const };
  const waits: number[] = [];
  let at = Date.parse(now);
  for (let run = 1; run < store.JOB_APPLICATION_FAILURE_LIMIT; run += 1) {
    const nowIso = new Date(at).toISOString();
    const next = store.retryOrAskForHelp(application, store.recordApplicationFailure(application, failure, nowIso), failure.message, nowIso);
    assert.equal(application.status, 'in-progress', `failure ${run}`);
    waits.push(Date.parse(next!) - at);
    at = Date.parse(next!);
  }
  assert.deepEqual(waits, [...store.JOB_APPLICATION_RETRY_DELAYS_MS]);
  assert.equal(application.questions.length, 0);
  const lastIso = new Date(at).toISOString();
  assert.equal(store.retryOrAskForHelp(application, store.recordApplicationFailure(application, failure, lastIso), failure.message, lastIso), undefined);
  assert.equal(application.status, 'awaiting-user-input');
  assert.equal(application.questions[0].prompt, store.AUTOMATION_HELP_PROMPT);
  assert.match(application.questions[0].helpText ?? '', /Browser timed out.*tried 7 times over two days/);
});
