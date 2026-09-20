import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';

const testRoot = mkdtempSync(path.join(tmpdir(), 'agentic-journal-applications-'));
const jobsDir = path.join(testRoot, 'jobs');
const resumeDir = path.join(testRoot, 'resumes');
process.env.JOB_APPLICATION_JOBS_DIR = jobsDir;
process.env.JOB_APPLICATION_RESUME_DIR = resumeDir;
process.env.OPENCLAW_CLI_PATH = path.join(testRoot, 'missing-openclaw-cli.mjs');

let store: typeof import('../src/app/api/jobs/application-store-utils');
let jobStore: typeof import('../src/app/api/jobs/job-store-utils');
let answersRoute: typeof import('../src/app/api/jobs/applications/answers/route');
let preferencesRoute: typeof import('../src/app/api/jobs/applications/preferences/route');
let controlRoute: typeof import('../src/app/api/jobs/applications/control/route');
let updateRoute: typeof import('../src/app/api/jobs/applications/update/route');
let reviewsRoute: typeof import('../src/app/api/jobs/applications/reviews/route');
let screenshotsRoute: typeof import('../src/app/api/jobs/applications/screenshots/route');
let questionScreenshotsRoute: typeof import('../src/app/api/jobs/applications/question-screenshots/route');
let questionScreenshotReadRoute: typeof import('../src/app/api/jobs/applications/question-screenshots/[listingId]/[screenshotId]/route');
let screenshotReadRoute: typeof import('../src/app/api/jobs/applications/screenshots/[listingId]/[screenshotId]/route');
const now = '2026-07-20T12:00:00.000Z';
const listings = [
  listing('saved-old', 'Software Engineer', 'saved', '2026-07-01T12:00:00.000Z'),
  listing('saved-new', 'Machine Learning Engineer', 'saved', '2026-07-19T12:00:00.000Z'),
  listing('starred', 'Platform Engineer', 'starred', '2026-06-01T12:00:00.000Z'),
  listing('applied', 'Applied Engineer', 'applied', '2026-05-01T12:00:00.000Z'),
  listing('archived', 'Archived Engineer', 'archived', '2026-04-01T12:00:00.000Z'),
];

before(async () => {
  store = await import('../src/app/api/jobs/application-store-utils');
  jobStore = await import('../src/app/api/jobs/job-store-utils');
  answersRoute = await import('../src/app/api/jobs/applications/answers/route');
  preferencesRoute = await import('../src/app/api/jobs/applications/preferences/route');
  controlRoute = await import('../src/app/api/jobs/applications/control/route');
  updateRoute = await import('../src/app/api/jobs/applications/update/route');
  reviewsRoute = await import('../src/app/api/jobs/applications/reviews/route');
  screenshotsRoute = await import('../src/app/api/jobs/applications/screenshots/route');
  questionScreenshotsRoute = await import('../src/app/api/jobs/applications/question-screenshots/route');
  questionScreenshotReadRoute =
    await import('../src/app/api/jobs/applications/question-screenshots/[listingId]/[screenshotId]/route');
  screenshotReadRoute =
    await import('../src/app/api/jobs/applications/screenshots/[listingId]/[screenshotId]/route');
  mkdirSync(jobsDir, { recursive: true });
  mkdirSync(resumeDir, { recursive: true });
  writeFileSync(path.join(resumeDir, 'Adamya_Singh_Resume_SWE.pdf'), '%PDF-test');
  writeFileSync(path.join(resumeDir, 'Adamya_Singh_Resume_MLE.pdf'), '%PDF-test');
  writeFileSync(
    path.join(jobsDir, 'listings.json'),
    `${JSON.stringify({ schemaVersion: 1, listings })}\n`,
    'utf8',
  );
  store.writeJobApplicationsStore({
    schemaVersion: 3,
    workerEnabled: true,
    enabledApplicationCategories: ['spring-internship', 'new-grad'],
    applications: {},
    answerBank: [],
    reviewItems: [],
  });
});

after(() => rmSync(testRoot, { recursive: true, force: true }));

describe('job application state', () => {
  test('normalizes legacy and explicit multi-season listing categories', () => {
    assert.equal(jobStore.readJobListings().schemaVersion, 2);
    assert.deepEqual(
      jobStore.normalizeApplicationCategories({
        positionTitle: 'Software Engineering Internship - Fall 2026 / Summer 2027',
        jobType: 'new-grad',
      }),
      ['fall-internship', 'summer-internship'],
    );
    assert.deepEqual(
      jobStore.normalizeApplicationCategories({
        positionTitle: 'Agent Engineer (New Grad, Summer 2026)',
        jobType: 'new-grad',
      }),
      ['new-grad'],
    );
    assert.deepEqual(jobStore.normalizeApplicationCategories({ jobType: 'spring-coop' }), [
      'spring-internship',
    ]);
  });

  test('validates and persists category preferences without overriding pause', async () => {
    const invalid = await postPreferences({ enabledApplicationCategories: ['invalid'] });
    assert.equal(invalid.status, 400);

    await store.mutateJobApplicationsStore((data) => {
      data.workerEnabled = false;
    });
    const empty = await postPreferences({ enabledApplicationCategories: [] });
    assert.equal(empty.status, 200);
    const blockedStart = await postControl({ action: 'start' });
    assert.equal(blockedStart.status, 409);
    const paused = await postPreferences({
      enabledApplicationCategories: ['spring-internship', 'new-grad'],
    });
    const pausedBody = await paused.json();
    assert.equal(paused.status, 200);
    assert.equal(pausedBody.worker, undefined);
    assert.deepEqual(pausedBody.enabledApplicationCategories, ['spring-internship', 'new-grad']);
    await store.mutateJobApplicationsStore((data) => {
      data.workerEnabled = true;
    });
  });

  test('projects virtual statuses without rewriting listings', () => {
    const beforeValue = readFileSync(path.join(jobsDir, 'listings.json'), 'utf8');
    const view = store.buildJobApplicationsView();
    assert.deepEqual(view.counts, {
      unstarted: 3,
      inProgress: 0,
      awaitingInput: 0,
      submitted: 1,
      closed: 0,
    });
    assert.equal(view.applications.archived, undefined);
    assert.equal(view.applications.applied.status, 'submitted');
    assert.equal(view.applications['saved-new'].resumeVariant, 'mle');
    assert.equal(view.categoryCounts['new-grad'], 3);
    assert.equal(view.eligibleBacklog, 3);
    assert.equal(readFileSync(path.join(jobsDir, 'listings.json'), 'utf8'), beforeValue);
  });

  test('wakes an active worker when a newly enabled category has actionable work', async () => {
    await store.mutateJobApplicationsStore((data) => {
      data.enabledApplicationCategories = ['spring-internship'];
    });
    const response = await postPreferences({
      enabledApplicationCategories: ['spring-internship', 'new-grad'],
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(body.worker);
  });

  test('shows archived listings only when their application is recorded closed', async () => {
    await store.mutateJobApplicationsStore((data) => {
      data.applications.archived = {
        listingId: 'archived',
        status: 'in-progress',
        resumeVariant: 'swe',
        attemptCount: 1,
        statusHistory: [],
        questions: [],
        createdAt: now,
        updatedAt: now,
      };
    });
    assert.equal(store.buildJobApplicationsView().applications.archived, undefined);
    await store.mutateJobApplicationsStore((data) => {
      store.setApplicationStatus(data.applications.archived, 'closed', now);
    });
    assert.equal(store.buildJobApplicationsView().applications.archived.status, 'closed');
  });

  test('prioritizes starred and prevents overlapping claims', async () => {
    const first = await store.claimNextJobApplication();
    assert.equal(first?.listing.id, 'starred');
    await store.mutateJobApplicationsStore((data) => {
      data.enabledApplicationCategories = ['spring-internship'];
    });
    assert.equal(await store.claimNextJobApplication(), null);
    await store.mutateJobApplicationsStore((data) => {
      store.releaseApplicationLease(data.applications.starred);
      store.setApplicationStatus(data.applications.starred, 'awaiting-user-input');
    });
    assert.equal(await store.claimNextJobApplication(), null);
    await store.mutateJobApplicationsStore((data) => {
      data.enabledApplicationCategories = ['new-grad'];
    });
    const second = await store.claimNextJobApplication();
    assert.equal(second?.listing.id, 'saved-new');
  });

  test('recovers stale leases', async () => {
    await store.mutateJobApplicationsStore((data) => {
      const application = data.applications['saved-new'];
      if (!application.lease) throw new Error('expected active lease');
      application.lease.expiresAt = '2020-01-01T00:00:00.000Z';
    });
    const recovered = await store.claimNextJobApplication();
    assert.equal(recovered?.listing.id, 'saved-new');
    assert.equal(recovered?.application.attemptCount, 2);
  });

  test('creates deterministic question IDs and confirmed answer entries', async () => {
    const params = {
      prompt: 'Are you authorized to work?',
      kind: 'single-select' as const,
      pageUrl: 'https://example.com/apply#question',
      options: [
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ],
    };
    assert.equal(
      store.createApplicationQuestionId(params),
      store.createApplicationQuestionId({ ...params, pageUrl: 'https://example.com/apply' }),
    );
    await store.mutateJobApplicationsStore((data) => {
      store.upsertConfirmedAnswer({
        store: data,
        listingId: 'saved-new',
        question: {
          id: store.createApplicationQuestionId(params),
          ...params,
          required: true,
          resolution: 'answered',
          discoveredAt: now,
        },
        answer: 'yes',
        confirmedAt: now,
      });
    });
    assert.equal(store.readJobApplicationsStore().answerBank.length, 1);
  });

  test('file answers: sanitize, parse, magic bytes, existence-gated bank matches', () => {
    assert.equal(store.sanitizeUploadFileName('../..//weird name!.pdf'), 'weird-name-.pdf');

    const uploadId = '12345678-1234-4123-8123-123456789abc';
    const ref = store.buildFileAnswer(uploadId, 'transcript.pdf');
    assert.deepEqual(store.parseFileAnswer(ref), { uploadId, fileName: 'transcript.pdf' });
    assert.equal(store.parseFileAnswer('file:not-a-uuid/x.pdf'), null);
    assert.equal(store.parseFileAnswer('file:12345678-1234-4123-8123-123456789abc/../x'), null);

    assert.equal(store.validateUploadBytes('a.pdf', Buffer.from('%PDF-1.4')), true);
    assert.equal(store.validateUploadBytes('a.pdf', Buffer.from('nope')), false);
    assert.equal(store.validateUploadBytes('a.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00])), true);
    assert.equal(store.validateUploadBytes('a.exe', Buffer.from('MZ')), false);

    assert.equal(store.applicationFileExists(ref), false);
    const filePath = store.getApplicationFilePath(uploadId, 'transcript.pdf');
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, '%PDF-1.4');
    assert.equal(store.applicationFileExists(ref), true);

    const question = {
      id: 'file-q1',
      prompt: 'Transcript',
      kind: 'file' as const,
      required: true,
      resolution: 'pending' as const,
      discoveredAt: now,
    };
    const bank = [
      {
        id: 'bank-file-1',
        normalizedPrompt: 'transcript',
        prompt: 'Transcript',
        kind: 'file' as const,
        answer: ref,
        confirmedAt: now,
        sourceListingId: 'saved-new',
      },
    ];
    assert.equal(store.findAnswerBankMatch(question, bank)?.usable, true);
    rmSync(path.dirname(filePath), { recursive: true, force: true });
    assert.equal(store.findAnswerBankMatch(question, bank)?.usable, false);
  });

  test('screenshot dimension gates reject over-tall and too-narrow images', () => {
    const syntheticPng = (width: number, height: number): Buffer => {
      const buffer = Buffer.alloc(60);
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
      buffer.write('IHDR', 12, 'ascii');
      buffer.writeUInt32BE(width, 16);
      buffer.writeUInt32BE(height, 20);
      buffer.write('IEND', buffer.length - 8, 'ascii');
      return buffer;
    };

    const good = syntheticPng(1900, 1800);
    assert.equal(store.isPng(good), true);
    assert.deepEqual(store.getPngDimensions(good), { width: 1900, height: 1800 });
    assert.equal(1800 <= store.JOB_APPLICATION_SCREENSHOT_MAX_HEIGHT_PX, true);
    assert.equal(1900 >= store.JOB_APPLICATION_SCREENSHOT_MIN_WIDTH_PX, true);

    const tall = store.getPngDimensions(syntheticPng(1900, 9800));
    assert.equal(tall.height > store.JOB_APPLICATION_SCREENSHOT_MAX_HEIGHT_PX, true);

    // The downscaled-sliver signature the OpenClaw tool produces for long pages.
    const sliver = store.getPngDimensions(syntheticPng(380, 2000));
    assert.equal(sliver.width < store.JOB_APPLICATION_SCREENSHOT_MIN_WIDTH_PX, true);
  });

  test('uses retry delays and validates both resume PDFs', () => {
    assert.deepEqual(store.JOB_APPLICATION_RETRY_DELAYS_MS, [
      5 * 60 * 1000,
      30 * 60 * 1000,
      120 * 60 * 1000,
    ]);
    assert.deepEqual(store.getJobApplicationReadiness().missingFiles, []);
    assert.equal(store.getJobApplicationReadiness().ready, true);
  });

  test('validates partial answers, explicit skips, and exactly-once wake decisions', async () => {
    const discoveredAt = new Date().toISOString();
    await store.mutateJobApplicationsStore((data) => {
      data.applications['saved-old'] = {
        listingId: 'saved-old',
        status: 'awaiting-user-input',
        resumeVariant: 'swe',
        attemptCount: 1,
        statusHistory: [{ status: 'awaiting-user-input', changedAt: discoveredAt }],
        questions: [
          {
            id: 'required-text',
            prompt: 'Why this role?',
            kind: 'text',
            required: true,
            resolution: 'pending',
            discoveredAt,
          },
          {
            id: 'optional-choice',
            prompt: 'Preferred office?',
            kind: 'single-select',
            required: false,
            options: [{ value: 'boston', label: 'Boston' }],
            resolution: 'pending',
            discoveredAt,
          },
        ],
        createdAt: discoveredAt,
        updatedAt: discoveredAt,
      };
    });

    const invalid = await postAnswers({
      listingId: 'saved-old',
      responses: [{ questionId: 'required-text', skip: true }],
    });
    assert.equal(invalid.status, 400);

    const partial = await postAnswers({
      listingId: 'saved-old',
      responses: [{ questionId: 'required-text', answer: 'I like the mission.' }],
    });
    assert.equal(partial.status, 200);
    assert.equal(
      store.readJobApplicationsStore().applications['saved-old'].status,
      'awaiting-user-input',
    );

    const final = await postAnswers({
      listingId: 'saved-old',
      resumeVariant: 'mle',
      responses: [{ questionId: 'optional-choice', skip: true }],
    });
    const finalBody = await final.json();
    assert.equal(final.status, 200);
    assert.ok(finalBody.worker, 'the final pending answer should make one wake attempt');
    assert.equal(finalBody.application.status, 'in-progress');
    assert.equal(finalBody.application.resumeOverride, 'mle');

    const duplicate = await postAnswers({
      listingId: 'saved-old',
      responses: [{ questionId: 'optional-choice', skip: true }],
    });
    const duplicateBody = await duplicate.json();
    assert.equal(duplicate.status, 200);
    assert.equal(duplicateBody.worker, undefined);
    assert.equal(store.readJobApplicationsStore().answerBank.length, 2);
  });

  test('guards submission and changes application and lead status once', async () => {
    const leaseToken = 'submission-lease';
    await store.mutateJobApplicationsStore((data) => {
      const application = data.applications['saved-old'];
      application.lease = {
        token: leaseToken,
        claimedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    });
    const missingCapture = await postUpdate({
      action: 'submission-attempted',
      listingId: 'saved-old',
      leaseToken,
    });
    assert.equal(missingCapture.status, 409);
    const started = await postUpdate({
      action: 'start-screenshot-capture',
      listingId: 'saved-old',
      leaseToken,
    });
    const startedBody = await started.json();
    const captureId = startedBody.application.incompleteScreenshotCapture.id as string;
    const invalidLeaseUpload = await postScreenshot({
      listingId: 'saved-old',
      leaseToken: 'wrong-lease',
      captureId,
      pageNumber: 1,
      segmentNumber: 1,
      label: 'Application',
      bytes: pngFixture(),
    });
    assert.equal(invalidLeaseUpload.status, 409);
    const invalidImage = await postScreenshot({
      listingId: 'saved-old',
      leaseToken,
      captureId,
      pageNumber: 1,
      segmentNumber: 1,
      label: 'Application',
      bytes: Buffer.from('not a png'),
    });
    assert.equal(invalidImage.status, 400);
    const uploaded = await postScreenshot({
      listingId: 'saved-old',
      leaseToken,
      captureId,
      pageNumber: 1,
      segmentNumber: 1,
      label: 'Application',
      bytes: pngFixture(),
    });
    assert.equal(uploaded.status, 201);
    const uploadedBody = await uploaded.json();
    const screenshotResponse = await screenshotReadRoute.GET(
      new Request('http://localhost/screenshot'),
      {
        params: Promise.resolve({
          listingId: 'saved-old',
          screenshotId: uploadedBody.screenshot.id,
        }),
      },
    );
    assert.equal(screenshotResponse.status, 200);
    assert.equal(screenshotResponse.headers.get('cache-control'), 'private, no-store, max-age=0');
    assert.deepEqual(Buffer.from(await screenshotResponse.arrayBuffer()), pngFixture());
    const duplicate = await postScreenshot({
      listingId: 'saved-old',
      leaseToken,
      captureId,
      pageNumber: 1,
      segmentNumber: 1,
      label: 'Duplicate',
      bytes: pngFixture(),
    });
    assert.equal(duplicate.status, 409);
    const completed = await postUpdate({
      action: 'complete-screenshot-capture',
      listingId: 'saved-old',
      leaseToken,
      captureId,
    });
    assert.equal(completed.status, 200);
    const premature = await postUpdate({
      action: 'submitted',
      listingId: 'saved-old',
      leaseToken,
    });
    assert.equal(premature.status, 409);
    assert.equal(
      (
        await postUpdate({
          action: 'submission-attempted',
          listingId: 'saved-old',
          leaseToken,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await postUpdate({
          action: 'submitted',
          listingId: 'saved-old',
          leaseToken,
          message: 'Thank you for applying',
        })
      ).status,
      200,
    );
    const saved = store.readJobApplicationsStore().applications['saved-old'];
    assert.equal(saved.status, 'submitted');
    assert.equal(saved.screenshotCapture?.screenshots.length, 1);
    assert.equal(saved.incompleteScreenshotCapture, undefined);
    assert.equal(saved.submissionEvidence?.message, 'Thank you for applying');
    assert.equal(
      JSON.parse(readFileSync(path.join(jobsDir, 'listings.json'), 'utf8')).listings.find(
        (candidate: { id: string }) => candidate.id === 'saved-old',
      ).status,
      'applied',
    );
  });

  test('retains partial screenshots and blocks submission after capture failure', async () => {
    const leaseToken = 'failed-capture-lease';
    await store.mutateJobApplicationsStore((data) => {
      data.applications.starred = {
        listingId: 'starred',
        status: 'in-progress',
        resumeVariant: 'swe',
        attemptCount: 1,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        questions: [],
        lease: {
          token: leaseToken,
          claimedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        createdAt: now,
        updatedAt: now,
      };
    });
    const started = await postUpdate({
      action: 'start-screenshot-capture',
      listingId: 'starred',
      leaseToken,
    });
    const captureId = (await started.json()).application.incompleteScreenshotCapture.id as string;
    assert.throws(() =>
      store.getApplicationScreenshotFilePath('../unsafe', '00000000-0000-4000-8000-000000000000'),
    );
    assert.equal(
      (
        await postScreenshot({
          listingId: 'starred',
          leaseToken,
          captureId,
          pageNumber: 1,
          segmentNumber: 1,
          label: 'Contact information',
          bytes: pngFixture(),
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await postUpdate({
          action: 'screenshot-capture-failed',
          listingId: 'starred',
          leaseToken,
          captureId,
          error: 'The review page remained blank after three capture attempts.',
        })
      ).status,
      200,
    );
    const application = store.readJobApplicationsStore().applications.starred;
    assert.equal(application.status, 'awaiting-user-input');
    assert.equal(application.lease, undefined);
    assert.equal(application.incompleteScreenshotCapture?.screenshots.length, 1);
    assert.match(application.incompleteScreenshotCapture?.error ?? '', /three capture attempts/);
    assert.ok(
      application.questions.some((question) => question.prompt === 'Screenshot capture needs help'),
    );
  });

  test('serializes concurrent atomic application updates', async () => {
    const increments = 12;
    await Promise.all(
      Array.from({ length: increments }, () =>
        store.mutateJobApplicationsStore((data) => {
          data.applications.starred.attemptCount += 1;
        }),
      ),
    );
    assert.equal(store.readJobApplicationsStore().applications.starred.attemptCount, 13);
  });

  test('progress heartbeats persist, require the lease, and clear on the next claim', async () => {
    const leaseToken = 'progress-lease';
    // The submission test above moved saved-old's lead to 'applied'; bring it
    // back into the claimable pool for this scenario.
    const listingsPath = path.join(jobsDir, 'listings.json');
    const storedListings = JSON.parse(readFileSync(listingsPath, 'utf8'));
    storedListings.listings.find(
      (candidate: { id: string; status: string }) => candidate.id === 'saved-old',
    ).status = 'saved';
    writeFileSync(listingsPath, `${JSON.stringify(storedListings)}\n`, 'utf8');
    await store.mutateJobApplicationsStore((data) => {
      data.workerEnabled = true;
      data.enabledApplicationCategories = ['spring-internship', 'new-grad'];
      for (const [id, application] of Object.entries(data.applications)) {
        store.releaseApplicationLease(application);
        if (id !== 'saved-old' && application.status !== 'submitted') {
          store.setApplicationStatus(application, 'awaiting-user-input', now);
          application.autoCompleteEligibleAt = '2100-01-01T00:00:00.000Z';
        }
      }
      data.applications['saved-old'] = {
        listingId: 'saved-old',
        status: 'in-progress',
        resumeVariant: 'swe',
        attemptCount: 1,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        questions: [],
        lease: {
          token: leaseToken,
          claimedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
        createdAt: now,
        updatedAt: now,
      };
    });

    const posted = await postUpdate({
      action: 'progress',
      listingId: 'saved-old',
      leaseToken,
      step: 'answer-questions',
      label: 'Answering questions',
      detail: 'question 5 of 12',
    });
    assert.equal(posted.status, 200);
    // Round-trips the normalization whitelist (a dropped field would vanish here).
    const persisted = store.readJobApplicationsStore().applications['saved-old'];
    assert.equal(persisted.progress?.step, 'answer-questions');
    assert.equal(persisted.progress?.label, 'Answering questions');
    assert.equal(persisted.progress?.detail, 'question 5 of 12');
    assert.ok(persisted.progress?.updatedAt);

    const rejected = await postUpdate({
      action: 'progress',
      listingId: 'saved-old',
      leaseToken: 'wrong-token',
      step: 'submit',
      label: 'Submitting',
    });
    assert.equal(rejected.status, 409);

    await store.mutateJobApplicationsStore((data) => {
      const application = data.applications['saved-old'];
      if (!application.lease) throw new Error('expected active lease');
      application.lease.expiresAt = '2020-01-01T00:00:00.000Z';
    });
    const reclaimed = await store.claimNextJobApplication();
    assert.equal(reclaimed?.listing.id, 'saved-old');
    assert.equal(reclaimed?.application.progress, undefined);
  });

  test('reconciles stale leases into the retry ladder without touching live runs', async () => {
    const staleLease = (expiresAt: string) => ({
      token: 'stale-token',
      claimedAt: '2026-07-20T11:00:00.000Z',
      expiresAt,
    });
    await store.mutateJobApplicationsStore((data) => {
      data.workerEnabled = true;
      // First-attempt dead run -> synthesized retry with backoff.
      data.applications['saved-new'] = {
        listingId: 'saved-new',
        status: 'in-progress',
        resumeVariant: 'mle',
        attemptCount: 1,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        questions: [],
        lease: staleLease('2020-01-01T00:00:00.000Z'),
        progress: { step: 'navigate', label: 'Navigating', updatedAt: now },
        incompleteScreenshotCapture: {
          id: '00000000-0000-4000-8000-00000000aaaa',
          attemptCount: 1,
          startedAt: now,
          screenshots: [],
        },
        createdAt: now,
        updatedAt: now,
      };
      // Third-attempt dead run -> escalates to the user.
      data.applications.starred = {
        listingId: 'starred',
        status: 'in-progress',
        resumeVariant: 'swe',
        attemptCount: 3,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        questions: [],
        lease: staleLease('2020-01-01T00:00:00.000Z'),
        createdAt: now,
        updatedAt: now,
      };
      // Died after submission-attempted -> ambiguous, never auto-retried.
      data.applications.applied = {
        listingId: 'applied',
        status: 'in-progress',
        resumeVariant: 'swe',
        attemptCount: 1,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        questions: [],
        submissionAttemptedAt: now,
        lease: staleLease('2020-01-01T00:00:00.000Z'),
        createdAt: now,
        updatedAt: now,
      };
      // Live run -> untouched.
      data.applications['saved-old'] = {
        listingId: 'saved-old',
        status: 'in-progress',
        resumeVariant: 'swe',
        attemptCount: 1,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        questions: [],
        lease: staleLease('2100-01-01T00:00:00.000Z'),
        progress: { step: 'capture', label: 'Capturing', updatedAt: now },
        createdAt: now,
        updatedAt: now,
      };
    });

    const result = await store.reconcileStaleJobApplicationLeases();
    assert.deepEqual(result.reconciled.map((entry) => entry.listingId).sort(), [
      'applied',
      'saved-new',
      'starred',
    ]);

    const data = store.readJobApplicationsStore();
    const retried = data.applications['saved-new'];
    assert.equal(retried.status, 'in-progress');
    assert.equal(retried.lastError?.code, 'run-interrupted');
    assert.equal(retried.lastError?.retryable, true);
    assert.equal(retried.lease, undefined);
    assert.equal(retried.progress, undefined);
    assert.ok(retried.nextRetryAt && Date.parse(retried.nextRetryAt) > Date.now());
    assert.match(retried.incompleteScreenshotCapture?.error ?? '', /Run interrupted/);

    const escalated = data.applications.starred;
    assert.equal(escalated.status, 'awaiting-user-input');
    assert.equal(escalated.lastError?.code, 'run-interrupted');
    assert.equal(escalated.lastError?.retryable, false);
    assert.equal(escalated.lease, undefined);
    assert.equal(escalated.nextRetryAt, undefined);
    assert.ok(
      escalated.questions.some(
        (question) => question.prompt === 'Automation needs help with this application',
      ),
    );

    const ambiguous = data.applications.applied;
    assert.equal(ambiguous.status, 'awaiting-user-input');
    assert.equal(ambiguous.lease, undefined);
    assert.equal(ambiguous.nextRetryAt, undefined);
    assert.ok(
      ambiguous.questions.some(
        (question) => question.prompt === 'Confirm whether this application was submitted',
      ),
    );

    const live = data.applications['saved-old'];
    assert.equal(live.status, 'in-progress');
    assert.equal(live.lease?.token, 'stale-token');
    assert.equal(live.lastError, undefined);
    assert.equal(live.progress?.step, 'capture');

    // With no stale leases left, the reconcile is a byte-identical no-op.
    const before = readFileSync(path.join(jobsDir, 'applications.json'), 'utf8');
    const second = await store.reconcileStaleJobApplicationLeases();
    assert.deepEqual(second.reconciled, []);
    assert.equal(readFileSync(path.join(jobsDir, 'applications.json'), 'utf8'), before);
  });

  test('queue preview mirrors claim ordering and exclusions', () => {
    const futureIso = '2100-01-01T00:00:00.000Z';
    const record = (
      listingId: string,
      overrides: Partial<import('../src/lib/types').JobApplicationRecord> = {},
    ) => ({
      listingId,
      status: 'unstarted' as const,
      resumeVariant: 'swe' as const,
      attemptCount: 0,
      statusHistory: [],
      questions: [],
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
    const previewListing = (id: string, status: string, savedAt: string) => ({
      ...listing(id, 'Software Engineer', status, savedAt),
      applicationCategories: ['new-grad' as const],
    });
    const preview = store.buildClaimQueuePreview(
      {
        schemaVersion: 2,
        workerEnabled: true,
        enabledApplicationCategories: ['new-grad'],
        applications: {
          'resume-req': record('resume-req', { resumeRequestedAt: now }),
          'blocked-awaiting': record('blocked-awaiting', { status: 'awaiting-user-input' }),
          'blocked-lease': record('blocked-lease', {
            status: 'in-progress',
            lease: { token: 'live', claimedAt: now, expiresAt: futureIso },
          }),
          'blocked-backoff': record('blocked-backoff', {
            status: 'in-progress',
            nextRetryAt: futureIso,
          }),
        },
        answerBank: [],
        reviewItems: [],
      } as never,
      [
        previewListing('saved-older', 'saved', '2026-07-01T12:00:00.000Z'),
        previewListing('blocked-awaiting', 'saved', '2026-07-18T12:00:00.000Z'),
        previewListing('blocked-lease', 'saved', '2026-07-18T12:00:00.000Z'),
        previewListing('blocked-backoff', 'saved', '2026-07-18T12:00:00.000Z'),
        previewListing('saved-newer', 'saved', '2026-07-19T12:00:00.000Z'),
        previewListing('starred-a', 'starred', '2026-06-01T12:00:00.000Z'),
        previewListing('resume-req', 'saved', '2026-07-05T12:00:00.000Z'),
        previewListing('archived-x', 'archived', '2026-07-18T12:00:00.000Z'),
      ] as never,
    );
    assert.deepEqual(
      preview.map((entry) => [entry.listingId, entry.rank, entry.reason]),
      [
        ['resume-req', 1, 'resume-requested'],
        ['starred-a', 2, 'starred'],
        ['saved-newer', 3, 'saved'],
        ['saved-older', 4, 'saved'],
      ],
    );
  });

  test('uses the exact 24-hour draft boundary without resetting after partial work', () => {
    const application: import('../src/lib/types').JobApplicationRecord = {
      listingId: 'boundary', status: 'in-progress' as const, resumeVariant: 'swe' as const,
      attemptCount: 1, statusHistory: [], createdAt: now, updatedAt: now,
      questions: [{ id: 'open', prompt: 'Why us?', kind: 'text', required: true, resolution: 'pending', discoveredAt: now }],
    };
    store.setApplicationStatus(application, 'awaiting-user-input', now);
    assert.equal(application.awaitingInputSince, now);
    assert.equal(application.autoCompleteEligibleAt, '2026-07-21T12:00:00.000Z');
    store.setApplicationStatus(application, 'awaiting-user-input', '2026-07-20T18:00:00.000Z');
    assert.equal(application.autoCompleteEligibleAt, '2026-07-21T12:00:00.000Z');
    assert.equal(store.isApplicationClaimable(application, new Date('2026-07-21T11:59:59.999Z')), false);
    assert.equal(store.isApplicationClaimable(application, new Date('2026-07-21T12:00:00.000Z')), true);
  });

  test('formats and deduplicates exact prefixed Google Doc entries', () => {
    const entry = store.buildGoogleDocAutoAnswerEntry({
      question: 'Which phone type?', company: 'Example', role: 'Engineer', answer: 'Home Cellular',
    });
    assert.equal(entry, 'openclaw - Which phone type? (Example — Engineer) Home Cellular');
    assert.equal(store.googleDocContainsExactEntry(`older\n${entry}\n`, entry), true);
    assert.equal(store.googleDocContainsExactEntry('openclaw - Which phone type? other', entry), false);
  });

  test('rejects wrong employment dates atomically and preserves refreshed source metadata', async () => {
    const dateSource = { experienceId: 'moodys', field: 'end' as const, value: '2026-08', attemptCount: 2 };
    const question = { id: 'employment-date', prompt: "Moody's Analytics (Intern) - End Date", kind: 'text' as const,
      required: true, resolution: 'pending' as const, discoveredAt: now, employmentDateField: 'end' as const, dateSource };
    await store.mutateJobApplicationsStore((data) => {
      data.applications['saved-new'] = {
        listingId: 'saved-new', status: 'in-progress', resumeVariant: 'mle', attemptCount: 2,
        statusHistory: [], questions: [question],
        lease: { token: 'date-lease', claimedAt: now, expiresAt: '2100-01-01T00:00:00.000Z' }, createdAt: now, updatedAt: now,
      };
    });
    assert.deepEqual(store.readJobApplicationsStore().applications['saved-new'].questions[0].dateSource, dateSource);
    const { dateSource: _source, ...withoutSource } = question;
    const merged = store.mergeApplicationQuestions([question], [withoutSource])[0];
    assert.equal(merged.dateSource, undefined);
    assert.equal(merged.employmentDateField, 'end');
    const payload = (answer: string) => ({ action: 'record-auto-answers', listingId: 'saved-new', leaseToken: 'date-lease',
      answers: [{ questionId: question.id, answer, confidence: 0.98, assumptions: ['Simplify date'],
        docAppend: { status: 'failed', entry: store.buildGoogleDocAutoAnswerEntry({ question: question.prompt, company: 'Example', role: 'Machine Learning Engineer', answer }), attemptedAt: now, error: 'unavailable' } }] });
    const reviewsBefore = store.readJobApplicationsStore().reviewItems.length;
    assert.equal((await postUpdate(payload('08/2025'))).status, 400);
    let data = store.readJobApplicationsStore();
    assert.equal(data.applications['saved-new'].questions[0].resolution, 'pending');
    assert.equal(data.reviewItems.length, reviewsBefore);
    assert.equal((await postUpdate({ action: 'record-questions', listingId: 'saved-new', leaseToken: 'date-lease', retainLease: true,
      questions: [{ ...question, dateSource: { ...dateSource, attemptCount: 1 } }] })).status, 400);
    assert.equal((await postUpdate({ action: 'record-questions', listingId: 'saved-new', leaseToken: 'date-lease', retainLease: true,
      questions: [withoutSource] })).status, 200);
    assert.equal((await postUpdate(payload('08/2026'))).status, 400);
    assert.equal((await postUpdate({ action: 'record-questions', listingId: 'saved-new', leaseToken: 'date-lease', retainLease: true, questions: [question] })).status, 200);
    assert.equal(store.readJobApplicationsStore().applications['saved-new'].lease?.token, 'date-lease');
    assert.equal((await postUpdate(payload('08/2026'))).status, 200);
  });

  test('records generated provenance, tolerates Doc failure, and confirms through review', async () => {
    const leaseToken = 'auto-answer-lease';
    await store.mutateJobApplicationsStore((data) => {
      data.applications['saved-new'] = {
        listingId: 'saved-new', status: 'in-progress', resumeVariant: 'mle', attemptCount: 2,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        questions: [{ id: 'phone-type', prompt: 'Which phone type?', kind: 'single-select', required: true,
          options: [{ value: 'Home Cellular', label: 'Home Cellular' }], resolution: 'pending', discoveredAt: now }],
        lease: { token: leaseToken, claimedAt: now, expiresAt: '2100-01-01T00:00:00.000Z' },
        createdAt: now, updatedAt: now,
      };
    });
    const response = await postUpdate({
      action: 'record-auto-answers', listingId: 'saved-new', leaseToken,
      answers: [{ questionId: 'phone-type', answer: 'Home Cellular', confidence: 0.62,
        assumptions: ['Phone type was not in confirmed sources.'],
        clarificationPrompt: 'I selected Home Cellular. Which phone type should I use in future?',
        docAppend: { status: 'failed', entry: 'openclaw - Which phone type? (Example — Machine Learning Engineer) Home Cellular', attemptedAt: now, error: 'Google Docs unavailable' } }],
    });
    assert.equal(response.status, 200);
    let data = store.readJobApplicationsStore();
    assert.equal(data.applications['saved-new'].questions[0].resolution, 'auto-resolved');
    assert.equal(data.applications['saved-new'].questions[0].generatedAnswer?.docAppend.status, 'failed');
    assert.equal(data.answerBank.some((entry) => entry.sourceListingId === 'saved-new' && entry.prompt === 'Which phone type?'), false);
    const review = data.reviewItems.find((item) => item.questionId === 'phone-type');
    assert.ok(review);
    await store.mutateJobApplicationsStore((store) => {
      store.applications['saved-new'].questions.push(
        { id: 'matching-phone', prompt: 'Which phone type?', kind: 'single-select', required: true,
          resolution: 'pending', discoveredAt: now, options: [{ value: 'Home Cellular', label: 'Home Cellular' }] },
        { id: 'different-options', prompt: 'Which phone type?', kind: 'single-select', required: true,
          resolution: 'pending', discoveredAt: now, options: [{ value: 'Work', label: 'Work' }] },
        { id: 'unrelated', prompt: 'Other question?', kind: 'text', required: true,
          resolution: 'pending', discoveredAt: now },
      );
    });
    const confirmed = await postReview({ reviewId: review.id, action: 'confirm' });
    assert.equal(confirmed.status, 200);
    const savedResult = await confirmed.json();
    assert.equal(savedResult.reviews[0].status, 'confirmed');
    assert.ok(savedResult.answerBank.some((entry: { prompt: string }) => entry.prompt === 'Which phone type?'));
    assert.ok(Array.isArray(savedResult.bankMatches));
    assert.deepEqual(savedResult.bankMatches.map((match: { questionId: string }) => match.questionId),
      ['matching-phone', 'different-options']);
    assert.equal(savedResult.bankMatches[0].bankMatch.usable, true);
    assert.equal(savedResult.bankMatches[1].bankMatch.usable, false);
    assert.match(confirmed.headers.get('Server-Timing')!, /review-save;dur=/);
    data = store.readJobApplicationsStore();
    assert.equal(data.reviewItems.find((item) => item.id === review.id)?.status, 'confirmed');
    assert.equal(data.answerBank.some((entry) => entry.prompt === 'Which phone type?'), true);
  });

  const draftEntry = (question: string, answer: string) =>
    `openclaw - ${question} (Example — Machine Learning Engineer) ${answer}`;
  const draftAnswer = (questionId: string, question: string, answer: string) => ({
    questionId, answer, confidence: 0.95, assumptions: [],
    docAppend: { status: 'saved' as const, entry: draftEntry(question, answer), attemptedAt: now },
  });
  async function seedDraft(leaseToken: string, overrides: Record<string, unknown> = {}) {
    await store.mutateJobApplicationsStore((data) => {
      data.reviewItems = data.reviewItems.filter((item) => item.listingId !== 'saved-new');
      data.answerBank = [];
      data.applications['saved-new'] = {
        listingId: 'saved-new', status: 'in-progress', resumeVariant: 'mle', attemptCount: 2,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        awaitingInputSince: now, autoCompleteEligibleAt: now,
        questions: [
          { id: 'phone-type', prompt: 'Which phone type?', kind: 'single-select', required: true,
            options: [{ value: 'cell', label: 'Home Cellular' }, { value: 'work', label: 'Work' }],
            resolution: 'pending', discoveredAt: now },
          { id: 'why', prompt: 'Why this team?', kind: 'text', required: false, resolution: 'pending', discoveredAt: now },
        ],
        lease: { token: leaseToken, claimedAt: now, expiresAt: '2100-01-01T00:00:00.000Z' },
        createdAt: now, updatedAt: now,
        ...overrides,
      } as import('../src/lib/types').JobApplicationRecord;
    });
    return postUpdate({
      action: 'record-auto-answers', listingId: 'saved-new', leaseToken,
      answers: [draftAnswer('phone-type', 'Which phone type?', 'cell'), draftAnswer('why', 'Why this team?', 'I like it.')],
    });
  }

  test('holds a fully drafted application for review and blocks submission until the deadline', async () => {
    const before = Date.now();
    const response = await seedDraft('hold-lease');
    assert.equal(response.status, 200);
    const body = await response.json();
    const data = store.readJobApplicationsStore();
    const application = data.applications['saved-new'];
    // Confident answers without assumptions are queued for review too.
    assert.equal(data.reviewItems.filter((item) => item.listingId === 'saved-new' && item.status === 'pending').length, 2);
    assert.equal(application.status, 'awaiting-user-input');
    assert.equal(application.lease, undefined);
    assert.ok(application.reviewHoldSince);
    assert.equal(body.reviewHold.until, application.autoSubmitEligibleAt);
    const until = Date.parse(application.autoSubmitEligibleAt!);
    assert.ok(until >= before + store.JOB_APPLICATION_REVIEW_WINDOW_MS);
    assert.ok(until <= Date.now() + store.JOB_APPLICATION_REVIEW_WINDOW_MS);
    assert.equal(store.isApplicationClaimable(application, new Date(until - 1)), false);
    assert.equal(store.isApplicationClaimable(application, new Date(until)), true);
    assert.equal(store.isSubmissionBlockedByReview(data, application, new Date(until - 1)), true);
    assert.equal(store.isSubmissionBlockedByReview(data, application, new Date(until)), false);

    // An agent that kept going anyway cannot reach the Submit click.
    await store.mutateJobApplicationsStore((mutable) => {
      mutable.applications['saved-new'].lease = { token: 'rogue', claimedAt: now, expiresAt: '2100-01-01T00:00:00.000Z' };
    });
    const blocked = await postUpdate({ action: 'submission-attempted', listingId: 'saved-new', leaseToken: 'rogue' });
    assert.equal(blocked.status, 409);
    assert.match((await blocked.json()).error, /awaiting review/);
    assert.equal(store.readJobApplicationsStore().applications['saved-new'].submissionAttemptedAt, undefined);
  });

  test('never extends a review deadline that was already stamped', async () => {
    const passed = '2026-01-01T00:00:00.000Z';
    const response = await seedDraft('redraft-lease', { autoSubmitEligibleAt: passed });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).reviewHold, undefined);
    const application = store.readJobApplicationsStore().applications['saved-new'];
    assert.equal(application.autoSubmitEligibleAt, passed);
    assert.equal(application.reviewHoldSince, undefined);
    assert.equal(application.status, 'in-progress');
    assert.equal(application.lease?.token, 'redraft-lease');
  });

  test('corrections rewrite the drafted answer and the last review releases the hold', async () => {
    await seedDraft('correct-lease');
    let data = store.readJobApplicationsStore();
    const [phone, why] = ['phone-type', 'why'].map((id) => data.reviewItems.find(
      (item) => item.listingId === 'saved-new' && item.questionId === id)!);

    const invalid = await postReview({ reviewId: phone.id, action: 'correct', answer: 'Fax' });
    assert.equal(invalid.status, 400);
    data = store.readJobApplicationsStore();
    assert.equal(data.reviewItems.find((item) => item.id === phone.id)?.status, 'pending');
    assert.equal(data.applications['saved-new'].questions[0].answer, 'cell');

    const corrected = await postReview({ reviewId: phone.id, action: 'correct', answer: 'work' });
    assert.equal(corrected.status, 200);
    const correctedBody = await corrected.json();
    assert.equal(correctedBody.reviews[0].status, 'corrected');
    assert.equal(correctedBody.released, undefined);
    assert.equal(correctedBody.application.status, 'awaiting-user-input');
    data = store.readJobApplicationsStore();
    assert.equal(data.applications['saved-new'].questions[0].answer, 'work');
    assert.equal(data.applications['saved-new'].questions[0].resolution, 'answered');
    assert.ok(data.applications['saved-new'].reviewHoldSince);

    const confirmed = await postReview({ reviewId: why.id, action: 'confirm' });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).application.status, 'in-progress');
    const application = store.readJobApplicationsStore().applications['saved-new'];
    assert.equal(application.status, 'in-progress');
    assert.equal(application.reviewHoldSince, undefined);
    assert.ok(application.resumeRequestedAt);
    assert.equal(application.questions[1].resolution, 'auto-resolved');
    assert.equal(store.isApplicationClaimable(application, new Date()), true);
    assert.equal(store.isSubmissionBlockedByReview(store.readJobApplicationsStore(), application, new Date()), false);
  });

  test('confirm-all resolves one application in a single transaction and releases it', async () => {
    await seedDraft('confirm-all-lease');
    const response = await postReview({ listingId: 'saved-new', action: 'confirm-all' });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.reviews.length, 2);
    assert.equal(body.application.status, 'in-progress');
    const data = store.readJobApplicationsStore();
    assert.equal(data.reviewItems.some((item) => item.listingId === 'saved-new' && item.status === 'pending'), false);
    assert.ok(data.applications['saved-new'].resumeRequestedAt);
    assert.equal((await postReview({ listingId: 'saved-new', action: 'confirm-all' })).status, 409);
  });

  test('claiming after the review deadline clears the hold but keeps the deadline', async () => {
    await seedDraft('deadline-lease');
    const passed = '2026-01-01T00:00:00.000Z';
    await store.mutateJobApplicationsStore((data) => {
      for (const [id, application] of Object.entries(data.applications)) {
        store.releaseApplicationLease(application);
        if (id !== 'saved-new' && application.status !== 'submitted' && application.status !== 'closed') {
          store.setApplicationStatus(application, 'awaiting-user-input', now);
          application.autoCompleteEligibleAt = '2100-01-01T00:00:00.000Z';
        }
      }
      data.applications['saved-new'].autoSubmitEligibleAt = passed;
    });
    const claim = await store.claimNextJobApplication();
    assert.equal(claim?.listing.id, 'saved-new');
    assert.equal(claim?.application.reviewHoldSince, undefined);
    assert.equal(claim?.application.autoSubmitEligibleAt, passed);
    assert.equal(claim?.application.questions.every((question) => question.resolution !== 'pending'), true);
  });

  test('stores one replaceable form screenshot per drafted question without gating the review hold', async () => {
    const leaseToken = 'question-shot-lease';
    await store.mutateJobApplicationsStore((data) => {
      data.reviewItems = data.reviewItems.filter((item) => item.listingId !== 'saved-new');
      data.applications['saved-new'] = {
        listingId: 'saved-new', status: 'in-progress', resumeVariant: 'mle', attemptCount: 4,
        statusHistory: [{ status: 'in-progress', changedAt: now }],
        awaitingInputSince: now, autoCompleteEligibleAt: now,
        questions: [
          { id: 'why', prompt: 'Why this team?', kind: 'text', required: true, resolution: 'pending', discoveredAt: now },
          { id: 'transcript', prompt: 'Upload transcript', kind: 'file', required: false, resolution: 'skipped', discoveredAt: now },
        ],
        lease: { token: leaseToken, claimedAt: now, expiresAt: '2100-01-01T00:00:00.000Z' },
        createdAt: now, updatedAt: now,
      };
    });
    const base = { listingId: 'saved-new', leaseToken, questionId: 'why' };

    assert.equal((await postQuestionScreenshot({ ...base, leaseToken: 'wrong', bytes: pngFixture(800, 240) })).status, 409);
    assert.equal((await postQuestionScreenshot({ ...base, questionId: 'missing', bytes: pngFixture(800, 240) })).status, 409);
    assert.equal((await postQuestionScreenshot({ ...base, questionId: 'transcript', bytes: pngFixture(800, 240) })).status, 409);
    assert.equal((await postQuestionScreenshot({ ...base, bytes: Buffer.from('not a png') })).status, 400);
    assert.equal((await postQuestionScreenshot({ ...base, bytes: pngFixture(800, 240), type: 'image/jpeg' })).status, 413);
    assert.equal((await postQuestionScreenshot({ ...base, bytes: pngFixture(800, 2400) })).status, 413);
    assert.equal((await postQuestionScreenshot({ ...base, bytes: pngFixture(60, 40) })).status, 413);
    assert.equal((await postQuestionScreenshot({ ...base, bytes: pngFixture(2600, 400) })).status, 413);
    assert.equal(store.readJobApplicationsStore().applications['saved-new'].questions[0].answerScreenshot, undefined);

    const firstBytes = pngFixture(800, 240, 1);
    const first = await postQuestionScreenshot({ ...base, bytes: firstBytes });
    assert.equal(first.status, 201);
    const firstShot = (await first.json()).screenshot;
    assert.deepEqual(
      { width: firstShot.width, height: firstShot.height, attemptCount: firstShot.attemptCount, byteSize: firstShot.byteSize },
      { width: 800, height: 240, attemptCount: 4, byteSize: firstBytes.length },
    );
    const served = await readQuestionScreenshot('saved-new', firstShot.id);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('cache-control'), 'private, max-age=31536000, immutable');
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), firstBytes);
    // A screenshot is only served through the application that owns it.
    assert.equal((await readQuestionScreenshot('saved-old', firstShot.id)).status, 404);
    assert.throws(() => store.getQuestionScreenshotFilePath('../unsafe'), /Invalid screenshot identifier/);

    const second = await postQuestionScreenshot({ ...base, bytes: pngFixture(640, 300, 2) });
    const secondShot = (await second.json()).screenshot;
    assert.notEqual(secondShot.id, firstShot.id);
    assert.equal((await readQuestionScreenshot('saved-new', firstShot.id)).status, 404);
    assert.throws(() => readFileSync(store.getQuestionScreenshotFilePath(firstShot.id)));
    assert.equal((await readQuestionScreenshot('saved-new', secondShot.id)).status, 200);

    // Rediscovering the question keeps its screenshot, and drafting still holds for review.
    const rediscovered = await postUpdate({
      action: 'record-questions', listingId: 'saved-new', leaseToken, retainLease: true,
      questions: [{ id: 'why', prompt: 'Why this team?', kind: 'text', required: true }],
    });
    assert.equal(rediscovered.status, 200);
    const drafted = await postUpdate({
      action: 'record-auto-answers', listingId: 'saved-new', leaseToken,
      answers: [draftAnswer('why', 'Why this team?', 'I like it.')],
    });
    assert.equal(drafted.status, 200);
    assert.ok((await drafted.json()).reviewHold);
    const question = store.readJobApplicationsStore().applications['saved-new'].questions[0];
    assert.equal(question.resolution, 'auto-resolved');
    assert.equal(question.answerScreenshot?.id, secondShot.id);
    const view = store.buildJobApplicationsView();
    assert.equal(view.applications['saved-new'].questions[0].answerScreenshot?.width, 640);
  });

  test('upgrades schema 2 autopilot stamps to the one-day draft delay exactly once', () => {
    const file = path.join(jobsDir, 'applications.json');
    const original = readFileSync(file, 'utf8');
    try {
      const raw = JSON.parse(original);
      raw.applications['saved-new'] = {
        ...raw.applications['saved-new'], status: 'awaiting-user-input',
        awaitingInputSince: now, autoCompleteEligibleAt: '2026-07-23T12:00:00.000Z',
      };
      writeFileSync(file, JSON.stringify({ ...raw, schemaVersion: 2 }), 'utf8');
      assert.equal(store.readJobApplicationsStore().schemaVersion, 3);
      assert.equal(store.readJobApplicationsStore().applications['saved-new'].autoCompleteEligibleAt, '2026-07-21T12:00:00.000Z');
      writeFileSync(file, JSON.stringify({ ...raw, schemaVersion: 3 }), 'utf8');
      assert.equal(store.readJobApplicationsStore().applications['saved-new'].autoCompleteEligibleAt, '2026-07-23T12:00:00.000Z');
    } finally {
      writeFileSync(file, original, 'utf8');
    }
  });
});

function postAnswers(body: unknown) {
  return answersRoute.POST(
    new NextRequest('http://localhost/api/jobs/applications/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function postUpdate(body: unknown) {
  return updateRoute.POST(
    new NextRequest('http://localhost/api/jobs/applications/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function postReview(body: unknown) {
  return reviewsRoute.POST(new NextRequest('http://localhost/api/jobs/applications/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
}

function postScreenshot(params: {
  listingId: string;
  leaseToken: string;
  captureId: string;
  pageNumber: number;
  segmentNumber: number;
  label: string;
  bytes: Buffer;
}) {
  const form = new FormData();
  form.set('listingId', params.listingId);
  form.set('leaseToken', params.leaseToken);
  form.set('captureId', params.captureId);
  form.set('pageNumber', String(params.pageNumber));
  form.set('segmentNumber', String(params.segmentNumber));
  form.set('label', params.label);
  form.set('image', new Blob([params.bytes], { type: 'image/png' }), 'application.png');
  return screenshotsRoute.POST(
    new NextRequest('http://localhost/api/jobs/applications/screenshots', {
      method: 'POST',
      body: form,
    }),
  );
}

function postQuestionScreenshot(params: {
  listingId: string; leaseToken: string; questionId: string; bytes: Buffer; type?: string;
}) {
  const form = new FormData();
  form.set('listingId', params.listingId);
  form.set('leaseToken', params.leaseToken);
  form.set('questionId', params.questionId);
  form.set('image', new Blob([params.bytes], { type: params.type ?? 'image/png' }), 'question.png');
  return questionScreenshotsRoute.POST(
    new NextRequest('http://localhost/api/jobs/applications/question-screenshots', { method: 'POST', body: form }),
  );
}

function readQuestionScreenshot(listingId: string, screenshotId: string) {
  return questionScreenshotReadRoute.GET(new Request('http://localhost/'), {
    params: Promise.resolve({ listingId, screenshotId }),
  });
}

function pngFixture(width = 1900, height = 1600, filler = 0): Buffer {
  // Synthetic PNG header/trailer with viewport-plausible dimensions (the
  // upload route validates structure + dimensions, not decodability).
  const buffer = Buffer.alloc(60, filler);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer.write('IEND', buffer.length - 8, 'ascii');
  return buffer;
}

function postPreferences(body: unknown) {
  return preferencesRoute.POST(
    new NextRequest('http://localhost/api/jobs/applications/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function postControl(body: unknown) {
  return controlRoute.POST(
    new NextRequest('http://localhost/api/jobs/applications/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

function listing(id: string, positionTitle: string, status: string, savedAt: string) {
  return {
    id,
    company: 'Example',
    companySummary: 'Example company',
    positionTitle,
    location: 'Remote',
    jobType: 'new-grad',
    status,
    salary: 'not listed',
    link: `https://example.com/${id}`,
    source: { name: 'fixture', link: 'https://example.com' },
    notes: 'Pros: fit. Cons: unknown.',
    savedAt,
    statusHistory: [],
    createdAt: savedAt,
    updatedAt: savedAt,
  };
}
