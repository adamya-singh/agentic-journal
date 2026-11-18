import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isUsLocation, linkKey, selectWideNetCandidates, type WideNetFeedEntry } from '../src/lib/job-wide-net';

const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-wide-net-'));
process.env.JOB_APPLICATION_JOBS_DIR = path.join(testRoot, 'jobs');
process.env.JOB_APPLICATION_RESUME_DIR = path.join(testRoot, 'resumes');
process.env.BACKEND_DATA_DIR = path.join(testRoot, 'backend');
process.env.OPENCLAW_CLI_PATH = path.join(testRoot, 'missing-openclaw-cli.mjs');

let store: typeof import('../src/app/api/jobs/application-store-utils');
let jobStore: typeof import('../src/app/api/jobs/job-store-utils');
let wideNet: typeof import('../src/app/api/jobs/wide-net/store');
let routeUtils: typeof import('../src/app/api/jobs/route-utils');
let updateRoute: typeof import('../src/app/api/jobs/update/route');
before(async () => {
  store = await import('../src/app/api/jobs/application-store-utils');
  jobStore = await import('../src/app/api/jobs/job-store-utils');
  wideNet = await import('../src/app/api/jobs/wide-net/store');
  routeUtils = await import('../src/app/api/jobs/route-utils');
  updateRoute = await import('../src/app/api/jobs/update/route');
});
after(() => rmSync(testRoot, { recursive: true, force: true }));

const NOW = Date.parse('2026-11-18T12:00:00Z');
const daysAgo = (days: number) => Math.round((NOW - days * 86_400_000) / 1000);
const entry = (overrides: Partial<WideNetFeedEntry> = {}): WideNetFeedEntry => ({
  company_name: 'Acme', title: 'Software Engineer, New Grad', url: 'https://acme.com/jobs/1?utm_source=Simplify&ref=Simplify',
  locations: ['New York, NY'], category: 'Software', active: true, is_visible: true, date_posted: daysAgo(2),
  degrees: ["Bachelor's"], ...overrides,
});
const pick = (feed: WideNetFeedEntry[], existing: Parameters<typeof selectWideNetCandidates>[1] = [], limit = 10) =>
  selectWideNetCandidates(feed, existing, { now: NOW, limit });

test('a feed entry becomes a saved wide-net posting', () => {
  const { candidates } = pick([entry()]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(
    { ...candidates[0], notes: undefined },
    {
      company: 'Acme', companySummary: 'Company description not available yet.',
      positionTitle: 'Software Engineer, New Grad', location: 'New York, NY', applicationCategories: ['new-grad'],
      track: 'wide', status: 'saved', salary: 'not listed', link: 'https://acme.com/jobs/1',
      source: { name: 'SimplifyJobs', link: 'https://github.com/SimplifyJobs/New-Grad-Positions' },
      notes: undefined, postedDate: '2026-11-16',
    },
  );
  assert.match(candidates[0].notes, /^Wide net:/);
});

test('only open, recent, entry-level software and ML roles in the US are kept', () => {
  const each = (overrides: Partial<WideNetFeedEntry>) => entry({ url: `https://jobs.example.com/${String(overrides.company_name)}`, ...overrides });
  const { candidates, skipped } = pick([
    each({ company_name: 'Closed', active: false }),
    each({ company_name: 'Hidden', is_visible: false }),
    each({ company_name: 'Chips', category: 'Hardware' }),
    each({ company_name: 'Numbers', category: 'AI/ML/Data', title: 'Data Analyst' }),
    each({ company_name: 'Models', category: 'AI/ML/Data', title: 'Machine Learning Engineer' }),
    each({ company_name: 'Old', date_posted: daysAgo(30) }),
    each({ company_name: 'North', locations: ['Montreal, QC, Canada'] }),
    each({ company_name: 'Both', locations: ['Toronto, ON, Canada', 'Remote in USA'] }),
    each({ company_name: 'Senior', title: 'Senior Software Engineer' }),
    each({ company_name: 'Two', title: 'Software Engineer II' }),
    each({ company_name: 'Doctor', degrees: ['PhD'] }),
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.company), ['Models', 'Both']);
  assert.equal(candidates[1].location, 'Remote in USA');
  assert.deepEqual(skipped, { closed: 2, notSoftware: 2, old: 1, outsideUs: 1, level: 3, duplicate: 0, overLimit: 0 });
});

test('a posting already in the box under either track is never saved again', () => {
  const existing = [
    { company: 'Acme, Inc.', positionTitle: 'Software Engineer - New Grad', link: 'https://other.com/x' },
    { company: 'Zed', positionTitle: 'Engineer', link: 'https://zed.com/jobs/9/?utm_campaign=x' },
  ];
  const { candidates, skipped } = pick(
    [
      entry(),
      entry({ company_name: 'Zed', title: 'Backend Engineer', url: 'https://zed.com/jobs/9' }),
      entry({ company_name: 'New', url: 'https://new.com/1' }),
      entry({ company_name: 'New', url: 'https://new.com/2', locations: ['Austin, TX'] }),
    ],
    existing,
  );
  assert.deepEqual(candidates.map((candidate) => candidate.link), ['https://new.com/1']);
  assert.equal(skipped.duplicate, 3);
});

test('the newest postings win when the queue has little room', () => {
  const feed = [1, 5, 3].map((days) => entry({ company_name: `Co${days}`, url: `https://co.com/${days}`, date_posted: daysAgo(days) }));
  const { candidates, skipped } = pick(feed, [], 2);
  assert.deepEqual(candidates.map((candidate) => candidate.company), ['Co1', 'Co3']);
  assert.equal(skipped.overLimit, 1);
  assert.equal(pick(feed, [], -4).candidates.length, 0);
});

test('US locations and link keys', () => {
  assert.equal(isUsLocation('San Francisco, CA'), true);
  assert.equal(isUsLocation('Remote in USA'), true);
  assert.equal(isUsLocation('London, UK'), false);
  assert.equal(isUsLocation('Vancouver, BC, Canada'), false);
  assert.equal(linkKey('https://A.com/jobs/1/?utm_source=x&gh_src=y#apply'), linkKey('https://a.com/jobs/1'));
  assert.notEqual(linkKey('https://a.com/jobs?id=1'), linkKey('https://a.com/jobs?id=2'));
});

test('the worker takes North Star postings before the wide net', () => {
  const order = [
    store.claimPriority({ resumeRequestedAt: '2026-11-18T00:00:00Z' }, { status: 'saved', track: 'wide' }),
    store.claimPriority({}, { status: 'starred', track: 'focus' }),
    store.claimPriority({}, { status: 'saved', track: 'focus' }),
    store.claimPriority({}, { status: 'starred', track: 'wide' }),
    store.claimPriority({}, { status: 'saved', track: 'wide' }),
  ];
  assert.deepEqual(order, [0, 1, 2, 3, 4]);
});

test('a run tops the queue up, records itself, and a second run adds nothing', async () => {
  const feed = Array.from({ length: 60 }, (_, index) =>
    entry({ company_name: `Company ${index}`, url: `https://jobs.example.com/${index}`, date_posted: Math.round(Date.now() / 1000) - index * 600 }));
  const first = await wideNet.runWideNetImport('manual', async () => feed);
  assert.equal(first.added, 40);
  assert.equal(first.waiting, 40);
  const stored = jobStore.readJobListings().listings;
  assert.equal(stored.length, 40);
  assert.ok(stored.every((listing) => listing.track === 'wide' && listing.status === 'saved' && listing.id));
  assert.equal(stored[0].company, 'Company 0');

  const second = await wideNet.runWideNetImport('schedule', async () => feed);
  assert.equal(second.added, 0);
  assert.equal(wideNet.readWideNetState().lastRun?.trigger, 'schedule');

  const failed = await wideNet.runWideNetImport('manual', async () => { throw new Error('feed down'); });
  assert.equal(failed.error, 'feed down');
  assert.equal(jobStore.readJobListings().listings.length, 40);
});

test('postings without a track read as North Star, and the track survives a write', () => {
  const data = jobStore.readJobListings();
  delete (data.listings[0] as { track?: string }).track;
  jobStore.writeJobListings(data);
  const reread = jobStore.readJobListings().listings;
  assert.equal(reread[0].track, 'focus');
  assert.equal(reread[1].track, 'wide');
  assert.match(readFileSync(path.join(process.env.JOB_APPLICATION_JOBS_DIR!, 'listings.json'), 'utf-8'), /"track": "wide"/);
});

test('only North Star postings need Pros and Cons in their notes', async () => {
  const fields = {
    company: 'Acme', companySummary: 'Makes things.', positionTitle: 'Engineer', location: 'NYC',
    applicationCategories: ['new-grad'], salary: 'not listed', link: 'https://acme.com/1',
    source: { name: 'x', link: 'https://acme.com' }, notes: 'Found in the feed.',
  };
  assert.equal(routeUtils.JobListingFieldsSchema.safeParse(fields).success, false);
  assert.equal(routeUtils.JobListingFieldsSchema.safeParse({ ...fields, track: 'wide' }).success, true);
  const parsed = routeUtils.JobListingFieldsSchema.parse({ ...fields, notes: 'Pros: a. Cons: b.' });
  assert.equal(parsed.track, 'focus');

  const { NextRequest } = await import('next/server');
  const wide = jobStore.readJobListings().listings.find((listing) => listing.track === 'wide')!;
  const update = (body: object) =>
    updateRoute.POST(new NextRequest('http://localhost/api/jobs/update', { method: 'POST', body: JSON.stringify(body) }));
  assert.equal((await update({ id: wide.id, track: 'focus' })).status, 400);
  assert.equal((await update({ id: wide.id, notes: 'Still unjudged.' })).status, 200);
  assert.equal((await update({ id: wide.id, track: 'focus', notes: 'Pros: strong team. Cons: none yet.' })).status, 200);
  assert.equal(jobStore.readJobListings().listings.find((listing) => listing.id === wide.id)!.track, 'focus');
});
