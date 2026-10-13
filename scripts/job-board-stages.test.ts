import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JOB_BOARD_STAGES, groupJobBoardStages, jobBoardStage } from '../src/lib/job-board-stages';
import type { JobApplicationRecord, JobListing } from '../src/lib/types';

function listing(id: string, overrides: Partial<JobListing> = {}): JobListing {
  return {
    id, company: id, companySummary: '', positionTitle: 'Engineer', location: 'NYC',
    applicationCategories: ['new-grad'], status: 'saved', salary: '', link: '', source: { name: 'x', link: '' },
    notes: '', savedAt: '2026-10-01T00:00:00Z', statusHistory: [], createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z', ...overrides,
  };
}

function application(listingId: string, overrides: Partial<JobApplicationRecord> = {}): JobApplicationRecord {
  return {
    listingId, status: 'unstarted', statusHistory: [], questions: [],
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', ...overrides,
  } as JobApplicationRecord;
}

test('each posting lands in exactly one stage', () => {
  const cases: Array<[JobListing, JobApplicationRecord | undefined, string]> = [
    [listing('a'), application('a'), 'queued'],
    [listing('b'), undefined, 'queued'],
    [listing('c'), application('c', { status: 'in-progress' }), 'applying'],
    [listing('d'), application('d', { status: 'awaiting-user-input' }), 'needs'],
    [listing('e', { status: 'archived' }), application('e', { status: 'awaiting-user-input' }), 'needs'],
    [listing('f', { status: 'applied' }), application('f', { status: 'submitted', employerStage: 'received' }), 'submitted'],
    [listing('g', { status: 'archived' }), application('g', { status: 'submitted', employerStage: 'rejected' }), 'heard'],
    [listing('h', { status: 'applied' }), application('h', { status: 'submitted', employerStage: 'assessment' }), 'heard'],
    [listing('i', { status: 'archived' }), application('i', { status: 'closed' }), 'closed'],
    [listing('j', { status: 'saved' }), application('j', { status: 'closed' }), 'closed'],
    [listing('k', { status: 'archived' }), undefined, 'archived'],
    [listing('l', { status: 'archived' }), application('l'), 'archived'],
    [listing('m', { status: 'applied' }), undefined, 'submitted'],
  ];
  for (const [item, record, stage] of cases) {
    assert.equal(jobBoardStage(item, record), stage, item.id);
  }
  const groups = groupJobBoardStages(
    cases.map(([item]) => item),
    Object.fromEntries(cases.filter(([, record]) => record).map(([item, record]) => [item.id, record!])),
  );
  assert.equal(JOB_BOARD_STAGES.reduce((sum, stage) => sum + groups[stage].length, 0), cases.length);
});

test('stages sort the way each one is worked', () => {
  const listings = [
    listing('old-question'), listing('new-question'),
    listing('saved-new', { savedAt: '2026-10-05T00:00:00Z' }), listing('starred-old', { status: 'starred', savedAt: '2026-09-01T00:00:00Z' }),
    listing('sent-early', { status: 'applied' }), listing('sent-late', { status: 'applied' }),
  ];
  const blocked = (at: string) => [{ status: 'awaiting-user-input' as const, changedAt: at }];
  const groups = groupJobBoardStages(listings, {
    'old-question': application('old-question', { status: 'awaiting-user-input', statusHistory: blocked('2026-09-01T00:00:00Z'), updatedAt: '2026-10-09T00:00:00Z' }),
    'new-question': application('new-question', { status: 'awaiting-user-input', statusHistory: blocked('2026-10-01T00:00:00Z') }),
    'sent-early': application('sent-early', { status: 'submitted', submittedAt: '2026-09-02T00:00:00Z' }),
    'sent-late': application('sent-late', { status: 'submitted', submittedAt: '2026-10-02T00:00:00Z' }),
  });
  assert.deepEqual(groups.needs.map((item) => item.id), ['old-question', 'new-question']);
  assert.deepEqual(groups.queued.map((item) => item.id), ['starred-old', 'saved-new']);
  assert.deepEqual(groups.submitted.map((item) => item.id), ['sent-late', 'sent-early']);
});
