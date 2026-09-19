import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyJobReviewResult, saveJobReview, type JobReviewResult } from '../src/lib/job-review-result';
import type { JobApplicationsViewData } from '../src/lib/types';

test('review waits for successful save and makes exactly one request', async () => {
  let finish!: (response: Response) => void;
  let completed = false;
  const calls: string[] = [];
  const request = (async (url, options) => {
    calls.push(String(url));
    assert.deepEqual(JSON.parse(options!.body as string), { reviewId: 'review', action: 'correct', answer: '08/2026' });
    return new Promise<Response>((resolve) => { finish = resolve; });
  }) as typeof fetch;
  const save = saveJobReview('review', 'correct', '08/2026', request).then((result) => { completed = true; return result; });
  await Promise.resolve();
  assert.equal(completed, false);
  finish(Response.json({ success: true, review: { id: 'review', status: 'corrected' }, answerBank: [], bankMatches: [] }));
  assert.equal((await save).review.status, 'corrected');
  assert.deepEqual(calls, ['/api/jobs/applications/reviews']);
});

test('failed saves reject without returning a committed result', async () => {
  await assert.rejects(saveJobReview('review', 'confirm', undefined,
    (async () => Response.json({ success: false, error: 'disk failure' }, { status: 500 })) as typeof fetch), /disk failure/);
});

test('committed review updates the answer bank and pending suggestions without changing worker state', () => {
  const current = {
    workerEnabled: true, schedulerHealth: { healthy: true }, counts: { inProgress: 1 },
    reviewItems: [{ id: 'review', status: 'pending' }, { id: 'other', status: 'pending' }], answerBank: [],
    applications: { app: { questions: [{ id: 'question', resolution: 'pending' },
      { id: 'unrelated', resolution: 'pending', bankMatch: { entryId: 'previous' } }] },
      unrelated: { questions: [{ id: 'other-question', resolution: 'pending' }] } },
  } as unknown as JobApplicationsViewData;
  const result = { review: { id: 'review', status: 'confirmed' }, answerBank: [{ id: 'answer' }],
    bankMatches: [{ listingId: 'app', questionId: 'question', bankMatch: { entryId: 'answer', answer: 'Yes', usable: true } }],
  } as JobReviewResult;
  const next = applyJobReviewResult(current, result);
  assert.equal(next.reviewItems[0].status, 'confirmed');
  assert.equal(next.reviewItems[1].status, 'pending');
  assert.equal(current.reviewItems[0].status, 'pending');
  assert.equal(next.applications.app.questions[0].bankMatch?.entryId, 'answer');
  assert.equal(next.answerBank, result.answerBank);
  assert.equal(next.schedulerHealth, current.schedulerHealth);
  assert.equal(next.counts, current.counts);
  assert.equal(next.applications.unrelated, current.applications.unrelated);
  assert.equal(next.applications.app.questions[1], current.applications.app.questions[1]);
});
