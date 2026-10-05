import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssessmentDeadline } from '../src/lib/assessment-deadline';
import { eventDetails } from '../src/lib/job-event-details';
import { normalizeEmployerUpdates } from '../src/app/api/jobs/email-update-utils';

test('Confido Sunday invitation is due Friday, counting five business days from receipt', () => {
  const window = { count: 5, unit: 'business-days' as const };
  assert.equal(resolveAssessmentDeadline('2026-10-04T17:38:13Z', window), '2026-10-10T03:59:59.000Z');
  const details = eventDetails({ deadlineWindow: window }, '2026-10-04T17:38:13Z');
  assert.equal(details.deadline, '2026-10-10T03:59:59.000Z');
  assert.deepEqual(details.deadlineWindow, window);
});
test('calendar and elapsed-hour deadlines respect timezone boundaries and daylight saving', () => {
  assert.equal(resolveAssessmentDeadline('2026-10-05T02:00:00Z', { count: 1, unit: 'calendar-days' }), '2026-10-06T03:59:59.000Z');
  assert.equal(resolveAssessmentDeadline('2026-10-30T15:00:00Z', { count: 1, unit: 'business-days' }), '2026-11-03T04:59:59.000Z');
  assert.equal(resolveAssessmentDeadline('2026-10-31T15:00:00Z', { count: 48, unit: 'hours' }), '2026-11-02T15:00:00.000Z');
});
test('explicit deadlines win; absent deadlines stay absent; invalid windows are rejected', () => {
  assert.equal(eventDetails({}).deadline, undefined);
  assert.equal(eventDetails({ deadline: '2026-10-08T12:00:00Z', deadlineWindow: { count: 5, unit: 'business-days' } }, '2026-10-04T17:38:13Z').deadline, '2026-10-08T12:00:00Z');
  assert.deepEqual(eventDetails({ deadlineWindow: { count: -1, unit: 'business-days' } }), {});
  assert.deepEqual(eventDetails({ deadlineWindow: { count: 5, unit: 'business-days', timeZone: 'invalid' } }), {});
});
test('relative deadlines survive store normalization', () => {
  const [event] = normalizeEmployerUpdates([{ id: 'oa', source: 'email', stage: 'assessment', receivedAt: '2026-10-04T17:38:13Z', appliedAt: '2026-10-05T18:00:00Z', deadlineWindow: { count: 5, unit: 'business-days' } }]);
  assert.equal(event.deadline, '2026-10-10T03:59:59.000Z');
  assert.equal(event.deadlineWindow?.count, 5);
});
