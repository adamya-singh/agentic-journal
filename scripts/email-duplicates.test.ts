import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameEmployerEmail, foldEmployerEmail, sameCandidateEmail } from '../src/app/api/jobs/email-duplicate-utils';
import { applyEmployerUpdate, normalizeEmployerUpdates } from '../src/app/api/jobs/email-update-utils';
import type { JobApplicationRecord, JobEmployerUpdate } from '../src/lib/types';
const first: JobEmployerUpdate = {
  id: 'event', source: 'email', stage: 'assessment', gmailMessageId: 'one', gmailThreadId: 'thread',
  receivedAt: '2026-09-22T10:22:21Z', appliedAt: '2026-09-23T00:00:00Z',
  from: 'Coderbyte <do-not-reply@coderbyte.com>', subject: 'Netic AI invites you to take an assessment', provider: 'Coderbyte',
};
const second = { ...first, gmailMessageId: 'two', receivedAt: '2026-09-22T10:53:57Z' };
test('folds close duplicate email IDs, keeps details and survives persistence', () => {
  const application = { employerUpdates: [{ ...first }], employerStage: 'assessment' } as JobApplicationRecord;
  assert.equal(applyEmployerUpdate(application, { ...second, deadline: '2026-09-30T00:00:00Z' }, '2026-09-24T00:00:00Z'), false);
  assert.equal(application.employerUpdates!.length, 1);
  assert.deepEqual(normalizeEmployerUpdates(application.employerUpdates)[0].emailMessageIds, ['one', 'two']);
  assert.equal(application.employerUpdates![0].deadline, '2026-09-30T00:00:00Z');
  assert.equal(application.simplifySync, undefined);
  foldEmployerEmail(application.employerUpdates![0], second);
  assert.deepEqual(application.employerUpdates![0].emailMessageIds, ['one', 'two']);
});
test('does not merge reminders, new rounds, conflicting deadlines, distant invitations or different senders', () => {
  for (const changes of [
    { eventKind: 'assessment-reminder' as const, stage: null }, { interviewRound: 'onsite' },
    { deadline: '2026-10-01T00:00:00Z' }, { receivedAt: '2026-09-23T10:53:57Z' },
    { from: 'different@example.com' }, { subject: 'Another assessment' },
  ]) assert.equal(sameEmployerEmail({ ...first, interviewRound: 'phone', deadline: '2026-09-30T00:00:00Z' }, { ...second, ...changes }), false);
  assert.equal(sameEmployerEmail({ ...first, source: 'manual', gmailMessageId: undefined } as JobEmployerUpdate, second), false);
});
test('sharing assessments across roles requires a matching thread or exact assessment URL', () => {
  assert.equal(sameEmployerEmail(first, second, true), true);
  assert.equal(sameEmployerEmail(first, { ...second, gmailThreadId: 'different' }, true), false);
  assert.equal(sameEmployerEmail({ ...first, assessmentUrl: 'https://example.com/one' }, { ...second, assessmentUrl: 'https://example.com/two' }), false);
});
test('candidate matching preserves uncertainty and distinct posting matches', () => {
  const candidate = { ...first, from: first.from!, subject: first.subject!, suggestedStage: 'assessment' as const, suggestedListingIds: ['a'], confidence: 0.5, summary: '', reason: '', createdAt: first.appliedAt, gmailMessageId: 'one' };
  assert.equal(sameCandidateEmail(candidate, { ...candidate, gmailMessageId: 'two' }), true);
  assert.equal(sameCandidateEmail(candidate, { ...candidate, suggestedListingIds: ['b'] }), false);
  assert.equal(sameCandidateEmail({ ...candidate, suggestedListingIds: [] }, { ...candidate, suggestedListingIds: [] }), false);
});
