import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  automation,
  duration,
  elapsed,
  makeSnapshot,
  overview,
  summarize,
  easternInput,
  easternIso,
  groupOpportunities,
  observedPatterns,
  canonical,
} from '../src/lib/job-overview';
import {
  applyEmployerUpdate,
  deriveEmployerStage,
  normalizeEmployerUpdates,
} from '../src/app/api/jobs/email-update-utils';
import type {
  JobApplicationRecord,
  JobListing,
  JobEmployerUpdate,
  JobApplicationsStoreData,
} from '../src/lib/types';

const listing: JobListing = {
  id: 'a',
  company: 'Acme',
  positionTitle: 'AI Engineer',
  companySummary: '',
  location: 'NY',
  applicationCategories: ['new-grad'],
  status: 'applied',
  salary: '',
  link: 'https://example.com/jobs/123/apply',
  source: { name: 'Board', link: '' },
  notes: '',
  savedAt: '2026-09-01T00:00:00Z',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  statusHistory: [],
};
const application = (): JobApplicationRecord => ({
  listingId: 'a',
  status: 'submitted',
  resumeVariant: 'swe',
  attemptCount: 1,
  statusHistory: [],
  questions: [],
  createdAt: listing.createdAt,
  updatedAt: listing.createdAt,
  submittedAt: '2026-09-01T12:00:40Z',
  submissionAttemptedAt: '2026-09-01T12:00:00Z',
});
const event = (
  stage: JobEmployerUpdate['stage'],
  at: string,
  id = String(stage),
): JobEmployerUpdate => ({
  id,
  stage,
  receivedAt: at,
  appliedAt: '2026-09-22T00:00:00Z',
  source: 'email',
});
function view(a = application(), now = Date.parse('2026-09-22T12:00:00Z')) {
  const store = {
    applications: { a },
    emailUpdates: { enabled: true, pending: [], processed: {} },
  } as unknown as JobApplicationsStoreData;
  return overview([listing], store, { milestones: {}, groups: [] }, now);
}
test('duplicate matching preserves job query IDs and normalizes requisitions', () => {
  assert.notEqual(
    canonical('https://example.com/jobs?jobId=123'),
    canonical('https://example.com/jobs?jobId=456'),
  );
  assert.equal(
    canonical('https://example.com/jobs/Engineer_JR12345'),
    canonical('https://example.com/jobs/Developer_JR12345'),
  );
  assert.equal(
    canonical('https://example.com/jobs/123/apply?utm_source=mail'),
    canonical('https://example.com/jobs/123'),
  );
});
test('timing thresholds preserve signed durations and tolerate ingestion delay', () => {
  assert.equal(duration('2026-09-01T08:00:00-04:00', '2026-09-01T12:00:40Z'), 40000);
  assert.equal(automation(-120000), 'likely automated');
  assert.equal(automation(-120001), 'unknown');
  assert.equal(automation(300000), 'likely automated');
  assert.equal(automation(300001), 'rapid response');
  assert.equal(automation(3600001), 'unknown');
  assert.equal(elapsed(-30000), 'Around submission');
  assert.equal(duration('bad', 'bad'), null);
});

test('Eastern milestone entry handles DST and round trips', () => {
  assert.equal(easternIso('2026-09-22T09:30'), '2026-09-22T13:30:00.000Z');
  assert.equal(easternInput('2026-12-22T14:30:00Z'), '2026-12-22T09:30');
  assert.throws(() => easternIso('2026-03-08T02:30'));
});
test('snapshot answers and evidence stay detached from later changes', () => {
  const a = application();
  a.questions = [
    {
      id: 'q',
      prompt: 'Technical skills',
      kind: 'multi-select',
      required: true,
      resolution: 'answered',
      discoveredAt: a.createdAt,
      answer: ['TypeScript'],
    },
  ];
  a.submissionEvidence = { message: 'Received' };
  const snapshot = makeSnapshot(a, listing, false);
  (a.questions[0].answer as string[]).push('Python');
  a.submissionEvidence.message = 'changed';
  assert.deepEqual(snapshot.answers[0].answer, ['TypeScript']);
  assert.equal(snapshot.evidence?.message, 'Received');
});
test('confirmed duplicate groups deduplicate outcomes and recompute timing', () => {
  const r = view().rows[0];
  const other = { ...r, id: 'b', events: [event('assessment', '2026-09-01T12:01:00Z')] };
  const grouped = groupOpportunities([r, other], [{ id: 'g', listingIds: ['a', 'b'] }]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].assessmentMs, 60000);
  assert.equal(grouped[0].automation, 'likely automated');
  assert.deepEqual(groupOpportunities([r], []), [r]);
  assert.equal(observedPatterns(summarize(view().rows)).length, 0);
});
test('first outcomes survive rejection and repeated assessment invitations', () => {
  const a = application();
  a.employerUpdates = [
    event('rejected', '2026-09-03T12:00:00Z'),
    event('assessment', '2026-09-01T12:03:00Z', 'first'),
    event('assessment', '2026-09-02T12:00:00Z', 'repeat'),
  ];
  const data = view(a),
    stats = summarize(data.rows, 14, Date.parse('2026-09-22T12:00:00Z'));
  assert.equal(stats.counts.assessment, 1);
  assert.equal(stats.counts.rejected, 1);
  assert.equal(data.rows[0].first.assessment?.id, 'first');
  assert.equal(data.rows[0].assessmentMs, 180000);
  assert.equal(stats.times['assessment-next'].n, 1);
});
test('mature cohorts exclude recent applications and use event time not ingestion', () => {
  const a = application();
  a.employerUpdates = [event('rejected', '2026-09-02T12:00:00Z')];
  assert.equal(summarize(view(a).rows, 14, Date.parse('2026-09-05T12:00:00Z')).eligible, 0);
  const stats = summarize(view(a).rows, 14, Date.parse('2026-09-22T12:00:00Z'));
  assert.equal(stats.comparisons[0].outcomes.rejected, 1);
  a.employerUpdates = [event('rejected', '2026-09-20T12:00:00Z')];
  assert.equal(
    summarize(view(a).rows, 14, Date.parse('2026-09-22T12:00:00Z')).comparisons[0].outcomes
      .rejected,
    0,
  );
});
test('manual confirmation time is never treated as actual submission', () => {
  const a = application();
  a.submissionEvidence = { message: 'Submission confirmed manually in Agentic Journal' };
  a.submissionSnapshot = makeSnapshot(a, listing, false, true);
  assert.equal(a.submissionSnapshot.baseline, undefined);
  assert.equal(view(a).rows[0].baseline, undefined);
  assert.equal(makeSnapshot(a, listing, true, true).resumeHash, undefined);
});
test('pre-submission closure is distinct from employer rejection', () => {
  const a = application();
  delete a.submittedAt;
  delete a.submissionAttemptedAt;
  a.status = 'closed';
  const l = { ...listing, status: 'archived' as const };
  const store = {
    applications: { a },
    emailUpdates: { enabled: true, pending: [], processed: {} },
  } as unknown as JobApplicationsStoreData;
  const stats = summarize(overview([l], store, { milestones: {}, groups: [] }).rows);
  assert.equal(stats.closed, 1);
  assert.equal(stats.counts.rejected, 0);
  assert.equal(stats.submitted, 0);
});
test('informational events do not reset employer stages or move Simplify', () => {
  const a = application();
  a.employerStage = 'assessment';
  a.employerUpdates = [event('assessment', '2026-09-02T00:00:00Z')];
  a.simplifySync = {
    status: 'synced',
    targetStatus: 'Screen',
    attemptCount: 1,
    updatedAt: '2026-09-02T00:00:00Z',
  };
  const old = structuredClone(a.simplifySync);
  applyEmployerUpdate(
    a,
    {
      source: 'email',
      stage: null,
      eventKind: 'still-reviewing',
      receivedAt: '2026-09-03T00:00:00Z',
    },
    '2026-09-22T00:00:00Z',
  );
  assert.equal(a.employerStage, 'assessment');
  assert.deepEqual(a.simplifySync, old);
  assert.equal(
    deriveEmployerStage([{ ...event(null, '2026-09-03T00:00:00Z'), eventKind: 'still-reviewing' }]),
    undefined,
  );
});
test('mixed-offset events sort by actual time and details survive normalization', () => {
  const updates = [
    event('assessment', '2026-09-01T10:00:00-04:00'),
    {
      ...event('rejected', '2026-09-01T13:00:00Z'),
      outcomeReason: 'Position cancelled',
      enrichedAt: '2026-09-22T00:00:00Z',
    },
  ];
  assert.equal(deriveEmployerStage(updates), 'assessment');
  assert.equal(normalizeEmployerUpdates(updates)[1].outcomeReason, 'Position cancelled');
});
test('correction history retains only active milestones for analysis', () => {
  const a = application();
  const store = {
    applications: { a },
    emailUpdates: { enabled: true, pending: [], processed: {} },
  } as unknown as JobApplicationsStoreData;
  const base = {
    source: 'manual' as const,
    occurredAt: '2026-09-02T12:00:00Z',
    createdAt: '2026-09-02T12:00:00Z',
    note: '',
  };
  const row = overview([listing], store, {
    groups: [],
    milestones: {
      a: [
        { ...base, id: 'm1', kind: 'assessment-completed' },
        { ...base, id: 'm2', kind: 'assessment-passed', supersedes: 'm1' },
      ],
    },
  }).rows[0];
  assert.equal(row.milestones.length, 1);
  assert.equal(row.milestoneHistory.length, 2);
  assert.equal(row.first.interview, undefined);
});
test('new metadata persists, enrichment is idempotent and read endpoints do not write', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'overview-test-'));
  process.env.JOB_APPLICATION_JOBS_DIR = root;
  try {
    const { NextRequest } = await import('next/server');
    const store = await import('../src/app/api/jobs/application-store-utils');
    const emails = await import('../src/app/api/jobs/applications/email-updates/route');
    const a = application();
    a.employerUpdates = [{ ...event('rejected', '2026-09-02T12:00:00Z'), gmailMessageId: 'msg' }];
    a.submissionSnapshot = makeSnapshot(a, listing, true);
    a.simplifySync = {
      status: 'synced',
      targetStatus: 'Rejected',
      attemptCount: 1,
      updatedAt: '2026-09-03T00:00:00Z',
    };
    writeFileSync(
      path.join(root, 'listings.json'),
      JSON.stringify({ schemaVersion: 2, listings: [listing] }),
    );
    store.writeJobApplicationsStore({
      ...store.getEmptyJobApplicationsStore(),
      applications: { a },
    });
    assert.deepEqual(
      store.readJobApplicationsStore().applications.a.submissionSnapshot,
      JSON.parse(JSON.stringify(a.submissionSnapshot)),
    );
    for (let i = 0; i < 2; i++) {
      const r = await emails.POST(
        new NextRequest('http://localhost/api/jobs/applications/email-updates', {
          method: 'POST',
          body: JSON.stringify({
            action: 'enrich',
            emails: [{ gmailMessageId: 'msg', outcomeReason: 'Position cancelled' }],
          }),
        }),
      );
      assert.equal(r.status, 200);
    }
    const saved = store.readJobApplicationsStore();
    assert.equal(saved.applications.a.employerUpdates?.length, 1);
    assert.deepEqual(saved.applications.a.simplifySync, a.simplifySync);
    assert.equal(saved.emailUpdates.lastPolledAt, undefined);
    const overviewRoute = await import('../src/app/api/jobs/overview/route');
    const before = readFileSync(path.join(root, 'applications.json'), 'utf8');
    assert.equal(
      (await overviewRoute.GET(new NextRequest('http://localhost/api/jobs/overview'))).status,
      200,
    );
    assert.equal(readFileSync(path.join(root, 'applications.json'), 'utf8'), before);
    const { validateInsights, generateAnalysis, safeQualifications } =
      await import('../src/app/api/jobs/overview/analysis/service');
    assert.throws(() =>
      validateInsights(
        [
          {
            kind: 'hypothesis',
            text: 'Maybe role fit',
            limitations: 'Small sample',
            applicationIds: ['missing'],
            eventIds: [],
          },
        ],
        view(),
      ),
    );
    assert.throws(() =>
      validateInsights(
        [
          {
            kind: 'hypothesis',
            text: '50% rejected',
            limitations: 'Small sample',
            applicationIds: ['a'],
            eventIds: [],
          },
        ],
        view(),
      ),
    );
    const redacted = safeQualifications({
      ...view().rows[0],
      answers: [
        { prompt: 'Gender', answer: 'private', provenance: 'answered' },
        { prompt: 'Project Password', answer: 'secret', provenance: 'answered' },
        {
          prompt: 'Technical skills',
          answer: 'TypeScript https://private.example/token person@example.com',
          provenance: 'generated',
        },
      ],
    });
    assert.equal(redacted.length, 1);
    assert.ok(!JSON.stringify(redacted).includes('private.example'));
    assert.ok(!JSON.stringify(redacted).includes('person@example'));
    const previous = { fingerprint: 'old', generatedAt: '2026-09-01', insights: [] };
    writeFileSync(path.join(root, 'overview-analysis.json'), JSON.stringify(previous));
    const failing = (async () => {
      throw new Error('model unavailable');
    }) as never;
    await assert.rejects(generateAnalysis(true, failing));
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(root, 'overview-analysis.json'), 'utf8')),
      previous,
    );
    const mock = (async () => ({
      object: {
        insights: [
          {
            kind: 'hypothesis',
            text: 'Role specialization may matter; compare similar roles to test this.',
            limitations: 'Sparse observations and selection differences.',
            applicationIds: ['a'],
            eventIds: [],
          },
        ],
      },
    })) as never;
    const generated = await generateAnalysis(true, mock);
    assert.equal(generated.insights.length, 1);
    assert.equal((await generateAnalysis(false, failing)).generatedAt, generated.generatedAt);
    const milestoneRequest = (supersedes?: string) =>
      new NextRequest('http://localhost/api/jobs/overview', {
        method: 'POST',
        body: JSON.stringify({
          action: 'milestone',
          listingId: 'a',
          kind: supersedes ? 'assessment-passed' : 'assessment-completed',
          occurredAt: '2026-09-03T12:00:00Z',
          note: '',
          ...(supersedes ? { supersedes } : {}),
        }),
      });
    assert.equal((await overviewRoute.POST(milestoneRequest())).status, 200);
    const firstMilestone = JSON.parse(
      readFileSync(path.join(root, 'overview-metadata.json'), 'utf8'),
    ).milestones.a[0].id;
    assert.equal((await overviewRoute.POST(milestoneRequest(firstMilestone))).status, 200);
    assert.equal((await overviewRoute.POST(milestoneRequest(firstMilestone))).status, 400);
    const { withOverviewLock } = await import('../src/app/api/jobs/overview/store');
    let release!: () => void;
    const pending = withOverviewLock(
      'test',
      () =>
        new Promise<void>((r) => {
          release = r;
        }),
    );
    await assert.rejects(withOverviewLock('test', async () => {}));
    release();
    await pending;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
