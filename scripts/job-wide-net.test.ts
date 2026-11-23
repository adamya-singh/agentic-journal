import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isUsLocation, linkKey, placeOf, selectOfferedCandidates, selectWideNetCandidates, type WideNetFeedEntry, type WideNetOffer } from '../src/lib/job-wide-net';
import { buildJudgeBatches, buildJudgePrompt, validateJudgeReply, type JudgeItem } from '../src/lib/job-wide-net-judge';
import type { JudgeDeps } from '../src/app/api/jobs/wide-net/judge';

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

/** A judge that puts every posting in the wide net, except those a test turns down or sends to North Star. */
const judgeWith = (
  skip: (company: string) => boolean = () => false, calls: string[] = [], focus: (company: string) => boolean = () => false,
): JudgeDeps => ({
  available: () => true,
  forAgents: () => '',
  turn: async ({ message }) => {
    calls.push(message);
    const reply: Record<string, object> = {};
    for (const line of message.split('\n').filter((text) => text.startsWith('{"id":"p'))) {
      const item = JSON.parse(line) as { id: string; company: string };
      reply[item.id] = skip(item.company)
        ? { verdict: 'skip', reason: `${item.company} is not a tech company.`, read: true }
        : focus(item.company)
        ? { verdict: 'focus', reason: 'Inference work at an AI lab.', pros: 'Real inference work.', cons: 'Early stage.', about: `${item.company} trains models.`, read: false }
        : { verdict: 'wide', reason: 'Backend work at a known tech company.', about: `${item.company} makes software.`, read: true };
    }
    return JSON.stringify(reply);
  },
});

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
      notes: undefined, postedDate: '2026-11-16', place: 'hub',
    },
  );
  assert.match(candidates[0].notes, /^Wide net:/);
});

test('only open, recent, entry-level software and ML roles in the US with no clearance are kept', () => {
  const each = (overrides: Partial<WideNetFeedEntry>) => entry({ url: `https://jobs.example.com/${String(overrides.company_name)}`, ...overrides });
  const { candidates, skipped } = pick([
    each({ company_name: 'Closed', active: false }),
    each({ company_name: 'Hidden', is_visible: false }),
    each({ company_name: 'Chips', category: 'Hardware' }),
    each({ company_name: 'Numbers', category: 'AI/ML/Data', title: 'Data Analyst' }),
    each({ company_name: 'Models', category: 'AI/ML/Data', title: 'Machine Learning Engineer' }),
    each({ company_name: 'Old', date_posted: daysAgo(31) }),
    each({ company_name: 'Old Elsewhere', date_posted: daysAgo(20), locations: ['Austin, TX'] }),
    each({ company_name: 'Older Hub', date_posted: daysAgo(20), locations: ['SF'] }),
    each({ company_name: 'Labels', category: 'AI/ML/Data', title: 'Data Annotator - AI Training' }),
    each({ company_name: 'Cleared', sponsorship: 'U.S. Citizenship is Required' }),
    each({ company_name: 'North', locations: ['Montreal, QC, Canada'] }),
    each({ company_name: 'Both', locations: ['Toronto, ON, Canada', 'Remote in USA'] }),
    each({ company_name: 'Senior', title: 'Senior Software Engineer' }),
    each({ company_name: 'Two', title: 'Software Engineer II' }),
    each({ company_name: 'Doctor', degrees: ['PhD'] }),
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.company), ['Models', 'Older Hub', 'Both']);
  assert.equal(candidates[2].location, 'Remote in USA');
  assert.equal(candidates[2].place, 'remote');
  assert.deepEqual(skipped, { closed: 2, notSoftware: 3, clearance: 1, old: 2, outsideUs: 1, level: 3, duplicate: 0, overLimit: 0 });
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

test('New York and the Bay Area come before the rest of the country, however new the rest is', () => {
  const feed = [
    entry({ company_name: 'Texas', url: 'https://co.com/tx', locations: ['Austin, TX'], date_posted: daysAgo(1) }),
    entry({ company_name: 'Remote', url: 'https://co.com/remote', locations: ['Remote in USA'], date_posted: daysAgo(2) }),
    entry({ company_name: 'Bay', url: 'https://co.com/bay', locations: ['Austin, TX', 'Sunnyvale, CA'], date_posted: daysAgo(9) }),
    entry({ company_name: 'City', url: 'https://co.com/nyc', locations: ['NYC'], date_posted: daysAgo(5) }),
  ];
  assert.deepEqual(pick(feed).candidates.map((candidate) => `${candidate.company} ${candidate.place}`),
    ['City hub', 'Bay hub', 'Texas elsewhere', 'Remote remote']);
  assert.equal(placeOf(['Buffalo, NY']), 'elsewhere');
  assert.equal(placeOf(['Newark, CA']), 'elsewhere');
  assert.equal(placeOf(['San Francisco, CA']), 'hub');
});

test('the judge is asked about each posting and its reply is read item by item', () => {
  const items: JudgeItem[] = Array.from({ length: 10 }, (_, index) => ({
    key: `acme.com/jobs/${index}`, company: `Acme ${index}`, title: 'Software Engineer', location: 'NYC',
    link: `https://acme.com/jobs/${index}`, place: index === 0 ? 'elsewhere' : 'hub',
  }));
  const batches = buildJudgeBatches(items);
  assert.deepEqual(batches.map((batch) => batch.items.length), [8, 2]);
  assert.equal(batches[1].aliases.p1, 'acme.com/jobs/8');

  const prompt = buildJudgePrompt(batches[0], { forAgents: 'Prefer inference work.' });
  assert.match(prompt, /"id":"p1","company":"Acme 0".*"place":"elsewhere in the US","link":"https:\/\/acme.com\/jobs\/0"/);
  assert.match(prompt, /Prefer inference work\./);
  assert.match(prompt, /Do not use the browser/);
  assert.match(buildJudgePrompt(buildJudgeBatches([{ ...items[0], source: 'Jobright' }])[0]), /"found":"Jobright"/);
  assert.doesNotMatch(buildJudgePrompt(batches[0]), /guidance for agents/);

  const check = validateJudgeReply(
    {
      P1: { verdict: 'Wide', reason: '  Builds   the payments API. ', about: 'Payments company.', read: true },
      p2: { verdict: 'skip', reason: 'An insurer; the role is SQL reporting.' },
      p3: { verdict: 'maybe', reason: 'Unsure.' },
      p4: { verdict: 'wide' },
      p5: { verdict: 'focus', reason: 'Inference at a lab.', pros: 'Kernel work.' },
      p6: { verdict: 'focus', reason: 'Inference at a lab.', pros: 'Kernel work.', cons: 'Small team.', read: true },
      p99: { verdict: 'wide', reason: 'Not one of ours.' },
    },
    batches[0].aliases,
  );
  assert.deepEqual(check.verdicts, {
    'acme.com/jobs/0': { verdict: 'wide', reason: 'Builds the payments API.', about: 'Payments company.', read: true },
    'acme.com/jobs/1': { verdict: 'skip', reason: 'An insurer; the role is SQL reporting.', read: false },
    'acme.com/jobs/5': { verdict: 'focus', reason: 'Inference at a lab.', pros: 'Kernel work.', cons: 'Small team.', read: true },
  });
  assert.equal(check.missing.length, 5);
  assert.equal(check.problems.length, 4);
  assert.equal(validateJudgeReply(null, batches[0].aliases).missing.length, 8);
});

test('US locations and link keys', () => {
  assert.equal(isUsLocation('San Francisco, CA'), true);
  assert.equal(isUsLocation('Remote in USA'), true);
  assert.equal(isUsLocation('NYC'), true);
  assert.equal(isUsLocation('SF'), true);
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

test('a run saves only what the judge passes, remembers what it turned down, and never asks twice', async () => {
  const feed = Array.from({ length: 60 }, (_, index) =>
    entry({ company_name: `Company ${index}`, url: `https://jobs.example.com/${index}`, date_posted: Math.round(Date.now() / 1000) - index * 600 }));
  const calls: string[] = [];
  const judge = judgeWith((company) => Number(company.split(' ')[1]) % 4 === 0, calls);

  const none = await wideNet.runWideNetImport('manual', async () => feed);
  assert.match(none.error ?? '', /OpenClaw is not available/);
  assert.equal(jobStore.readJobListings().listings.length, 0);

  const first = await wideNet.runWideNetImport('manual', async () => feed, judge);
  assert.equal(calls.length, 3);
  assert.deepEqual({ added: first.added, turnedDown: first.turnedDown, unjudged: first.unjudged, waiting: first.waiting },
    { added: 18, turnedDown: 6, unjudged: 0, waiting: 18 });
  const stored = jobStore.readJobListings().listings;
  assert.equal(stored.length, 18);
  assert.ok(stored.every((listing) => listing.track === 'wide' && listing.status === 'saved' && listing.id && !('place' in listing)));
  assert.equal(stored[0].company, 'Company 1');
  assert.equal(stored[0].notes, 'Wide net: Backend work at a known tech company.');
  assert.equal(stored[0].companySummary, 'Company 1 makes software.');
  const turnedDown = wideNet.readWideNetState().turnedDown ?? {};
  assert.deepEqual(Object.values(turnedDown).map((entry) => entry.company).sort(),
    ['Company 0', 'Company 12', 'Company 16', 'Company 20', 'Company 4', 'Company 8']);
  assert.equal(turnedDown['jobs.example.com/0'].reason, 'Company 0 is not a tech company.');

  // The next check starts after the 24 already judged: neither the saved nor the turned down are sent again.
  calls.length = 0;
  const second = await wideNet.runWideNetImport('schedule', async () => feed, judge);
  assert.equal(second.added, 18);
  assert.doesNotMatch(calls.join('\n'), /"company":"Company (?:0|1|23)"/);
  assert.match(calls[0], /"company":"Company 24"/);
  assert.equal(wideNet.readWideNetState().lastRun?.trigger, 'schedule');

  // The queue has room for four more; a pass beyond that is left for a later check, not lost.
  const third = await wideNet.runWideNetImport('schedule', async () => feed, judge);
  assert.deepEqual({ added: third.added, waiting: third.waiting }, { added: 4, waiting: 40 });
  calls.length = 0;
  const full = await wideNet.runWideNetImport('schedule', async () => feed, judge);
  assert.equal(full.added, 0);
  assert.equal(calls.length, 0);

  const failed = await wideNet.runWideNetImport('manual', async () => { throw new Error('feed down'); }, judge);
  assert.equal(failed.error, 'feed down');
  assert.equal(jobStore.readJobListings().listings.length, 40);
  assert.ok(Object.keys(wideNet.readWideNetState().turnedDown ?? {}).length >= 6);
});

test('a turn that fails leaves its postings unjudged, and Adamya can add a turned-down posting anyway', async () => {
  const data = jobStore.readJobListings();
  data.listings = data.listings.slice(0, 30);
  jobStore.writeJobListings(data);
  const feed = [entry({ company_name: 'Fresh', url: 'https://fresh.example.com/1', date_posted: Math.round(Date.now() / 1000) })];
  const down: JudgeDeps = { ...judgeWith(), turn: async () => { throw new Error('gateway closed'); } };
  const failed = await wideNet.runWideNetImport('manual', async () => feed, down);
  assert.deepEqual({ added: failed.added, unjudged: failed.unjudged }, { added: 0, unjudged: 1 });
  assert.match(failed.error ?? '', /gateway closed/);

  const run = await wideNet.runWideNetImport('manual', async () => feed, judgeWith(() => true));
  assert.deepEqual({ added: run.added, turnedDown: run.turnedDown }, { added: 0, turnedDown: 1 });
  assert.equal(await wideNet.addTurnedDownPosting('nowhere.example.com/1'), false);
  assert.equal(await wideNet.addTurnedDownPosting('fresh.example.com/1'), true);
  const added = jobStore.readJobListings().listings[0];
  assert.deepEqual({ company: added.company, track: added.track, status: added.status }, { company: 'Fresh', track: 'wide', status: 'saved' });
  assert.match(added.notes, /added by Adamya after OpenClaw turned it down/);
  assert.equal(wideNet.readWideNetState().turnedDown?.['fresh.example.com/1'], undefined);
  assert.equal((await wideNet.runWideNetImport('manual', async () => feed, judgeWith())).added, 0);
});

test('a search hands postings in, and each is judged for both searches', async () => {
  const data = jobStore.readJobListings();
  data.listings = data.listings.slice(0, 30);
  jobStore.writeJobListings(data);
  const offer = (overrides: Partial<WideNetOffer>): WideNetOffer => ({
    company: 'Lab', title: 'Software Engineer, Inference', location: 'San Francisco, CA; London, UK',
    link: 'https://lab.example.com/1?utm_source=jobright', source: 'Jobright', postedDate: '2026-11-20', ...overrides,
  });
  const offers = [
    offer({}),
    offer({ company: 'Shop', title: 'Software Engineer', link: 'https://shop.example.com/1', location: 'Austin, TX', source: 'SpeedyApply' }),
    offer({ company: 'Bank', title: 'Software Engineer', link: 'https://bank.example.com/1' }),
    offer({ company: 'Old Hand', title: 'Senior Software Engineer', link: 'https://old.example.com/1' }),
    offer({ company: 'Abroad', link: 'https://abroad.example.com/1', location: 'Toronto, ON, Canada' }),
    offer({ company: 'Desk', title: 'Sales Associate', link: 'https://desk.example.com/1' }),
    offer({ company: 'Fresh', title: 'Software Engineer, New Grad', link: 'https://fresh.example.com/1' }),
    offer({ company: 'Lab', link: 'https://lab.example.com/1' }),
  ];
  const { candidates } = selectOfferedCandidates(offers.slice(0, 1), []);
  assert.deepEqual(
    { location: candidates[0].location, place: candidates[0].place, link: candidates[0].link, source: candidates[0].source.name, postedDate: candidates[0].postedDate },
    { location: 'San Francisco, CA', place: 'hub', link: 'https://lab.example.com/1', source: 'Jobright', postedDate: '2026-11-20' },
  );

  const handed = wideNet.offerPostings(offers);
  assert.deepEqual(handed.outcomes, ['accepted', 'accepted', 'accepted', 'level', 'outside-us', 'not-software', 'duplicate', 'duplicate']);
  assert.equal(handed.waiting, 3);
  assert.deepEqual(wideNet.offerPostings(offers.slice(0, 1)).outcomes, ['duplicate']);

  const calls: string[] = [];
  const run = await wideNet.runWideNetImport('offer', async () => { throw new Error('feed down'); },
    judgeWith((company) => company === 'Bank', calls, (company) => company === 'Lab'));
  assert.match(calls[0], /"company":"Lab".*"found":"Jobright"/);
  assert.deepEqual({ added: run.added, addedToFocus: run.addedToFocus, turnedDown: run.turnedDown, error: run.error },
    { added: 1, addedToFocus: 1, turnedDown: 1, error: 'feed down' });
  const [lab, shop] = ['Lab', 'Shop'].map((company) => jobStore.readJobListings().listings.find((listing) => listing.company === company)!);
  assert.deepEqual({ track: lab.track, source: lab.source.name, notes: lab.notes },
    { track: 'focus', source: 'Jobright', notes: 'Inference work at an AI lab. (Judged without reading the posting.)\nPros: Real inference work.\nCons: Early stage.' });
  assert.deepEqual({ track: shop.track, source: shop.source.name }, { track: 'wide', source: 'SpeedyApply' });
  const state = wideNet.readWideNetState();
  assert.deepEqual(state.offered, {});
  assert.equal(state.turnedDown?.['bank.example.com/1'].source, 'Jobright');
});

test('the source is read from the first line of the notes, whatever shape they are in', () => {
  const data = jobStore.readJobListings();
  const base = data.listings.find((listing) => listing.company === 'Lab')!;
  const withNotes = (id: string, notes: string, name = 'Unknown') => ({ ...base, id, link: `https://x.example.com/${id}`, notes, source: { name, link: '' } });
  data.listings.push(
    withNotes('a', 'Source: Jobright.\nPros: one.\nCons: two.'),
    withNotes('b', 'source: SpeedyApply\nAdvances the focus bet.\nPros: one.\nCons: two.'),
    withNotes('c', 'Source: Autonomous Search (Greenhouse). Pros: one. Cons: two.'),
    withNotes('d', 'Source: SimplifyJobs.\nPros: one.', 'Jobright'),
    withNotes('e', 'Pros: one. Cons: two.'),
  );
  jobStore.writeJobListings(data);
  const read = Object.fromEntries(jobStore.readJobListings().listings.map((listing) => [listing.id, listing]));
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map((id) => read[id].source.name),
    ['Jobright', 'SpeedyApply', 'Autonomous Search (Greenhouse)', 'Jobright', 'Unknown']);
  assert.equal(read.a.notes, 'Pros: one.\nCons: two.');
  assert.equal(read.b.notes, 'Advances the focus bet.\nPros: one.\nCons: two.');
  assert.equal(read.a.source.link, 'https://x.example.com/a');
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
