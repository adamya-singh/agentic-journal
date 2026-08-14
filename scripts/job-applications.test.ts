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
let screenshotsRoute: typeof import('../src/app/api/jobs/applications/screenshots/route');
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
  screenshotsRoute = await import('../src/app/api/jobs/applications/screenshots/route');
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
    schemaVersion: 1,
    workerEnabled: true,
    enabledApplicationCategories: ['spring-internship', 'new-grad'],
    applications: {},
    answerBank: [],
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
        schemaVersion: 1,
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

function pngFixture(): Buffer {
  // Synthetic PNG header/trailer with viewport-plausible dimensions (the
  // upload route validates structure + dimensions, not decodability).
  const buffer = Buffer.alloc(60);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(buffer, 0);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(1900, 16);
  buffer.writeUInt32BE(1600, 20);
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
