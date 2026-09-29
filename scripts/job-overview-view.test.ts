import assert from 'node:assert/strict';
import { test } from 'node:test';
import { overview } from '../src/lib/job-overview';
import {
  DEFAULT_FILTERS,
  activeChips,
  attentionItems,
  bucketActivity,
  comparisonCards,
  comparisonEmptyState,
  currentStage,
  dailyActivity,
  deriveView,
  expandIds,
  filtersFromQuery,
  filtersToQuery,
  lastActivityAt,
  sortRows,
  stageDistribution,
  timeline,
  timingRows,
  tileCounts,
  type OverviewFilters,
} from '../src/lib/job-overview-view';
import { summarize, observedPatterns, type OverviewRow } from '../src/lib/job-overview';
import type {
  JobApplicationRecord,
  JobListing,
  JobEmployerUpdate,
  JobApplicationsStoreData,
} from '../src/lib/types';

const NOW = Date.parse('2026-09-22T16:00:00Z');
const listing = (id: string, status: JobListing['status'] = 'applied'): JobListing => ({
  id,
  company: `Co ${id}`,
  positionTitle: id.startsWith('ml') ? 'Machine Learning Engineer' : 'Software Engineer',
  companySummary: '',
  location: 'NY',
  applicationCategories: ['new-grad'],
  status,
  salary: '',
  link: `https://example.com/jobs/${id}`,
  source: { name: 'Board', link: '' },
  notes: '',
  savedAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  statusHistory: [],
});
const application = (
  id: string,
  submittedAt: string | undefined,
  extra: Partial<JobApplicationRecord> = {},
): JobApplicationRecord => ({
  listingId: id,
  status: submittedAt ? 'submitted' : 'unstarted',
  resumeVariant: id.startsWith('ml') ? 'mle' : 'swe',
  attemptCount: 1,
  statusHistory: [],
  questions: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  ...(submittedAt
    ? {
        submittedAt,
        submissionAttemptedAt: new Date(Date.parse(submittedAt) - 40000).toISOString(),
      }
    : {}),
  ...extra,
});
const event = (
  stage: JobEmployerUpdate['stage'],
  at: string,
  extra: Partial<JobEmployerUpdate> = {},
): JobEmployerUpdate => ({
  id: `${stage}-${at}`,
  stage,
  receivedAt: at,
  appliedAt: '2026-09-22T00:00:00Z',
  source: 'email',
  ...extra,
});
function rows(
  entries: { listing: JobListing; application?: JobApplicationRecord }[],
  milestones: Record<string, import('../src/lib/job-overview').Milestone[]> = {},
  groups: { id: string; listingIds: string[] }[] = [],
) {
  const store = {
    applications: Object.fromEntries(
      entries.filter((e) => e.application).map((e) => [e.listing.id, e.application]),
    ),
    emailUpdates: { enabled: true, pending: [], processed: {} },
  } as unknown as JobApplicationsStoreData;
  return overview(
    entries.map((e) => e.listing),
    store,
    { milestones, groups },
    NOW,
  );
}
const fixture = () =>
  rows([
    {
      listing: listing('a'),
      application: application('a', '2026-09-20T12:00:00Z', {
        employerUpdates: [
          event('received', '2026-09-20T12:01:00Z'),
          event('rejected', '2026-09-22T03:30:00Z', { outcomeReason: 'Position filled' }),
        ],
      }),
    },
    {
      listing: listing('ml-b'),
      application: application('ml-b', '2026-08-01T12:00:00Z', {
        employerUpdates: [event('assessment', '2026-08-01T12:03:00Z')],
      }),
    },
    { listing: listing('c', 'saved'), application: application('c', undefined) },
    {
      listing: listing('d', 'archived'),
      application: application('d', undefined, { status: 'closed', closedAt: '2026-09-10T00:00:00Z' }),
    },
  ]);

test('period narrows the cohort but never hides unsubmitted records', () => {
  const data = fixture();
  const all = deriveView(data.rows, data.groups, DEFAULT_FILTERS, null, NOW);
  assert.equal(all.records.length, 4);
  assert.equal(all.cohort.length, 2);
  assert.equal(all.closedBeforeSubmit, 1);
  const recent = deriveView(data.rows, data.groups, { ...DEFAULT_FILTERS, period: '30' }, null, NOW);
  assert.deepEqual(recent.cohort.map((r) => r.id), ['a']);
  assert.equal(recent.records.length, 4);
  assert.equal(recent.closedBeforeSubmit, 1);
  const closed = deriveView(
    data.rows,
    data.groups,
    { ...DEFAULT_FILTERS, period: '30', status: 'closed' },
    null,
    NOW,
  );
  assert.deepEqual(closed.table.map((r) => r.id), ['d']);
});

test('outcome tiles use facet semantics: focus changes, cohort and stats do not', () => {
  const data = fixture();
  const view = deriveView(data.rows, data.groups, { ...DEFAULT_FILTERS, outcome: 'rejected' }, null, NOW);
  assert.equal(view.cohort.length, 2);
  assert.deepEqual(view.focus.map((r) => r.id), ['a']);
  assert.deepEqual(view.table.map((r) => r.id), ['a']);
  const counts = tileCounts(view.cohort, summarize(view.cohort, 14, NOW));
  assert.equal(counts.submitted, 2);
  assert.equal(counts.received, 2);
  assert.equal(counts.rejected, 1);
  assert.equal(counts.assessment, 1);
  assert.equal(counts.awaiting, 0);
  const ack = deriveView(data.rows, data.groups, { ...DEFAULT_FILTERS, outcome: 'received' }, null, NOW);
  assert.equal(ack.focus.length, 2);
});

test('a chart day matches submissions and employer responses in Eastern time', () => {
  const data = fixture();
  // 2026-09-22T03:30Z is still Sep 21 in New York.
  const view = deriveView(data.rows, data.groups, { ...DEFAULT_FILTERS, day: '2026-09-21' }, null, NOW);
  assert.deepEqual(view.table.map((r) => r.id), ['a']);
  const none = deriveView(data.rows, data.groups, { ...DEFAULT_FILTERS, day: '2026-09-22' }, null, NOW);
  assert.equal(none.table.length, 0);
});

test('cited sets expand to confirmed duplicate groups so merged rows still match', () => {
  const groups = [{ id: 'g', listingIds: ['a', 'ml-b'] }];
  assert.deepEqual([...expandIds(['a'], groups)].sort(), ['a', 'ml-b']);
  assert.deepEqual([...expandIds(['zzz'], groups)], ['zzz']);
  const data = rows(
    [
      { listing: listing('a'), application: application('a', '2026-09-20T12:00:00Z') },
      { listing: listing('ml-b'), application: application('ml-b', '2026-09-21T12:00:00Z') },
    ],
    {},
    groups,
  );
  const merged = deriveView(
    data.rows,
    data.groups,
    { ...DEFAULT_FILTERS, merge: true },
    { label: 'cited', ids: ['ml-b'] },
    NOW,
  );
  assert.equal(merged.merged, 1);
  assert.deepEqual(merged.focus.map((r) => r.id), ['a']);
});

test('current stage ignores informational events and honors resets and withdrawals', () => {
  const base = fixture().rows.find((r) => r.id === 'a')!;
  assert.equal(currentStage(base), 'rejected');
  const reminded: OverviewRow = {
    ...base,
    events: [
      event('assessment', '2026-09-20T13:00:00Z'),
      event('assessment', '2026-09-21T13:00:00Z', { eventKind: 'assessment-reminder' }),
      event('received', '2026-09-22T13:00:00Z'),
    ],
  };
  assert.equal(currentStage(reminded), 'assessment');
  const reset: OverviewRow = {
    ...base,
    events: [event('assessment', '2026-09-20T13:00:00Z'), event(null, '2026-09-21T13:00:00Z', { source: 'manual' })],
  };
  assert.equal(currentStage(reset), 'none');
  const withdrawn: OverviewRow = {
    ...base,
    milestones: [
      {
        id: 'm',
        kind: 'withdrawn',
        occurredAt: '2026-09-21T00:00:00Z',
        createdAt: '2026-09-21T00:00:00Z',
        source: 'manual',
        note: '',
      },
    ],
  };
  assert.equal(currentStage(withdrawn), 'withdrawn');
  const dist = stageDistribution([base, reminded, reset, withdrawn]);
  assert.equal(dist.rejected, 1);
  assert.equal(dist.assessment, 1);
  assert.equal(dist.none, 1);
  assert.equal(dist.withdrawn, 1);
});

test('daily activity buckets by Eastern day, fills gaps, and folds into weeks', () => {
  const data = fixture();
  const days = dailyActivity(data.rows, '2026-09-19', '2026-09-22', NOW);
  assert.deepEqual(days.map((d) => d.day), ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22']);
  assert.deepEqual(days[1].submissions, ['a']);
  assert.deepEqual(days[2].responses, [{ id: 'a', stage: 'rejected' }]);
  assert.equal(days[3].responses.length, 0);
  const weeks = bucketActivity(days, 2);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].end, '2026-09-20');
  assert.equal(weeks[1].responses.length, 1);
  const auto = dailyActivity(data.rows, '', '', NOW);
  assert.equal(auto[0].day, '2026-08-01');
  assert.equal(auto[auto.length - 1].day, '2026-09-22');
});

test('attention items surface open assessments and overdue analysis only', () => {
  const data = fixture();
  const analysis = { report: null, stale: true, error: null };
  const items = attentionItems({ ...data, analysis }, NOW);
  assert.deepEqual(items.map((i) => i.kind), ['assessment-open', 'analysis-overdue']);
  assert.equal(items[0].id, 'ml-b');
  assert.equal(items[0].milestoneKind, 'assessment-completed');
  const recorded = rows(
    [
      {
        listing: listing('ml-b'),
        application: application('ml-b', '2026-08-01T12:00:00Z', {
          employerUpdates: [event('assessment', '2026-08-01T12:03:00Z')],
        }),
      },
    ],
    {
      'ml-b': [
        {
          id: 'm',
          kind: 'assessment-completed',
          occurredAt: '2026-08-02T00:00:00Z',
          createdAt: '2026-08-02T00:00:00Z',
          source: 'manual',
          note: '',
        },
      ],
    },
  );
  const fresh = {
    report: { generatedAt: new Date(NOW - 3600000).toISOString(), cutoff: '', model: '', insights: [] },
    stale: true,
    error: null,
  };
  assert.deepEqual(attentionItems({ ...recorded, analysis: fresh }, NOW), []);
  const old = { ...fresh, report: { ...fresh.report, generatedAt: new Date(NOW - 40 * 3600000).toISOString() } };
  assert.deepEqual(
    attentionItems({ ...recorded, analysis: old }, NOW).map((i) => i.kind),
    ['analysis-overdue'],
  );
  const pending = { ...recorded, emailUpdates: { ...recorded.emailUpdates, pending: 2 }, analysis: fresh };
  assert.equal(attentionItems(pending, NOW)[0].kind, 'emails-pending');
});

test('comparison cards only render dimensions with two named groups of ten', () => {
  const entries = [] as { listing: JobListing; application: JobApplicationRecord }[];
  for (let i = 0; i < 12; i++)
    entries.push({
      listing: listing(`swe-${i}`),
      application: application(`swe-${i}`, '2026-08-01T12:00:00Z', {
        employerUpdates: i < 3 ? [event('rejected', '2026-08-05T12:00:00Z')] : [],
      }),
    });
  for (let i = 0; i < 11; i++)
    entries.push({
      listing: listing(`ml-${i}`),
      application: application(`ml-${i}`, '2026-08-01T12:00:00Z'),
    });
  const data = rows(entries);
  const stats = summarize(data.rows, 14, NOW);
  const cards = comparisonCards(stats, observedPatterns(stats));
  const resume = cards.find((c) => c.dimension === 'resume');
  assert.ok(resume);
  assert.deepEqual(resume.outcomes, ['rejected']);
  assert.deepEqual(resume.groups.map((g) => g.value), ['swe', 'mle']);
  assert.ok(!cards.some((c) => c.dimension === 'resumeHash'));
  assert.ok(!cards.some((c) => c.dimension === 'location'));
  const sparse = summarize(fixture().rows, 14, NOW);
  assert.deepEqual(comparisonCards(sparse, []), []);
  assert.match(comparisonEmptyState(sparse), /at least 10 mature applications/);
});

test('timing rows hide quartiles under five observations', () => {
  const stats = summarize(fixture().rows, 14, NOW);
  const t = timingRows(stats.times);
  const rejected = t.find((r) => r.key === 'rejected')!;
  assert.equal(rejected.n, 1);
  assert.equal(typeof rejected.median, 'number');
  assert.equal(rejected.q1, null);
  assert.equal(t.find((r) => r.key === 'interview')!.median, null);
});

test('filters round-trip through the query string and produce chips', () => {
  const f: OverviewFilters = {
    ...DEFAULT_FILTERS,
    period: 'custom',
    start: '2026-09-01',
    end: '2026-09-22',
    resume: 'mle',
    search: 'nvidia',
    outcome: 'awaiting',
    status: 'all',
    day: '2026-09-20',
    merge: true,
  };
  const query = filtersToQuery(f, { w: '30', application: 'x' });
  const parsed = filtersFromQuery(new URLSearchParams(query));
  assert.deepEqual(parsed, f);
  assert.ok(query.includes('w=30') && query.includes('application=x'));
  assert.equal(filtersToQuery(DEFAULT_FILTERS), '');
  const junk = filtersFromQuery(new URLSearchParams('p=weird&outcome=nope&status=bad&day=notaday&from=2026-01-01'));
  assert.deepEqual(junk, DEFAULT_FILTERS);
  const chips = activeChips(f, { label: 'Cited by AI', ids: ['a'] });
  assert.deepEqual(
    chips.map((c) => c.key),
    ['period', 'resume', 'search', 'outcome', 'day', 'cited'],
  );
});

test('last activity and sorting use real timestamps, and timelines interleave milestones', () => {
  const data = rows(
    [
      {
        listing: listing('a'),
        application: application('a', '2026-09-20T12:00:00Z', {
          employerUpdates: [event('received', '2026-09-20T08:01:00-04:00')],
        }),
      },
      { listing: listing('b'), application: application('b', '2026-09-21T12:00:00Z') },
    ],
    {
      a: [
        {
          id: 'm',
          kind: 'interview-scheduled',
          occurredAt: '2026-09-25T15:00:00Z',
          createdAt: '2026-09-22T00:00:00Z',
          source: 'manual',
          note: 'On-site',
        },
      ],
    },
  );
  const a = data.rows.find((r) => r.id === 'a')!;
  assert.equal(lastActivityAt(a), '2026-09-25T15:00:00Z');
  assert.deepEqual(sortRows(data.rows, 'activity').map((r) => r.id), ['a', 'b']);
  assert.deepEqual(sortRows(data.rows, 'submitted').map((r) => r.id), ['b', 'a']);
  assert.deepEqual(timeline(a).map((t) => t.kind), ['submitted', 'event', 'milestone']);
});
