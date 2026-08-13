import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type {
  JobApplicationCategory,
  JobApplicationCategoryCounts,
  JobApplicationAnswer,
  JobApplicationAnswerBankEntry,
  JobApplicationAnswerBankMatch,
  JobApplicationCounts,
  JobApplicationQuestion,
  JobApplicationQuestionKind,
  JobApplicationReadiness,
  JobApplicationRecord,
  JobApplicationScreenshotCapture,
  JobApplicationsStoreData,
  JobApplicationsViewData,
  JobApplicationStatus,
  JobListing,
} from '@/lib/types';
import { readJobListings, writeJobListings } from './job-store-utils';

const JOBS_DIR =
  process.env.JOB_APPLICATION_JOBS_DIR || path.join(process.cwd(), 'src/backend/data/jobs');
const APPLICATIONS_FILE = path.join(JOBS_DIR, 'applications.json');
const APPLICATIONS_LOCK_FILE = path.join(JOBS_DIR, '.applications.lock');
const SCREENSHOTS_DIR =
  process.env.JOB_APPLICATION_SCREENSHOTS_DIR || path.join(JOBS_DIR, 'application-screenshots');
const APPLICATION_FILES_DIR =
  process.env.JOB_APPLICATION_FILES_DIR || path.join(JOBS_DIR, 'application-files');
const DEFAULT_RESUME_DIR = '/home/rpi5/.openclaw/workspace/job-applications/resumes';
const RESUME_DIR = process.env.JOB_APPLICATION_RESUME_DIR || DEFAULT_RESUME_DIR;
const LEASE_DURATION_MS = 30 * 60 * 1000;
const LOCK_STALE_MS = 2 * 60 * 1000;

export const JOB_APPLICATION_RESUME_FILES = {
  swe: 'Adamya_Singh_Resume_SWE.pdf',
  mle: 'Adamya_Singh_Resume_MLE.pdf',
} as const;

export const JOB_APPLICATION_CATEGORIES: JobApplicationCategory[] = [
  'fall-internship',
  'spring-internship',
  'summer-internship',
  'new-grad',
];
export const DEFAULT_ENABLED_APPLICATION_CATEGORIES: JobApplicationCategory[] = [
  'spring-internship',
  'new-grad',
];

export const JOB_APPLICATION_RETRY_DELAYS_MS = [
  5 * 60 * 1000,
  30 * 60 * 1000,
  120 * 60 * 1000,
] as const;

export const JOB_APPLICATION_SCREENSHOT_MAX_BYTES = 25 * 1024 * 1024;
const OPAQUE_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ClaimedJobApplication {
  listing: JobListing;
  application: JobApplicationRecord;
  leaseToken: string;
  answerBank: JobApplicationAnswerBankEntry[];
}

export function getEmptyJobApplicationsStore(): JobApplicationsStoreData {
  return {
    schemaVersion: 1,
    workerEnabled: false,
    enabledApplicationCategories: [...DEFAULT_ENABLED_APPLICATION_CATEGORIES],
    applications: {},
    answerBank: [],
  };
}

export function readJobApplicationsStore(): JobApplicationsStoreData {
  if (!fs.existsSync(APPLICATIONS_FILE)) {
    return getEmptyJobApplicationsStore();
  }

  const parsed = JSON.parse(
    fs.readFileSync(APPLICATIONS_FILE, 'utf-8'),
  ) as Partial<JobApplicationsStoreData>;
  const applications: Record<string, JobApplicationRecord> = {};
  if (parsed.applications && typeof parsed.applications === 'object') {
    for (const [listingId, value] of Object.entries(parsed.applications)) {
      const normalized = normalizeApplicationRecord(listingId, value);
      if (normalized) {
        applications[listingId] = normalized;
      }
    }
  }

  const answerBank = Array.isArray(parsed.answerBank)
    ? parsed.answerBank.flatMap((entry) => normalizeAnswerBankEntry(entry))
    : [];

  return {
    schemaVersion: 1,
    workerEnabled: parsed.workerEnabled === true,
    enabledApplicationCategories: normalizeEnabledApplicationCategories(
      parsed.enabledApplicationCategories,
    ),
    applications,
    answerBank,
  };
}

export function writeJobApplicationsStore(data: JobApplicationsStoreData): void {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  const temporaryPath = `${APPLICATIONS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  fs.renameSync(temporaryPath, APPLICATIONS_FILE);
}

export async function mutateJobApplicationsStore<T>(
  mutator: (data: JobApplicationsStoreData) => T | Promise<T>,
): Promise<T> {
  await acquireStoreLock();
  try {
    const data = readJobApplicationsStore();
    const result = await mutator(data);
    writeJobApplicationsStore(data);
    return result;
  } finally {
    try {
      fs.unlinkSync(APPLICATIONS_LOCK_FILE);
    } catch {
      // The lock may already have been cleared after a process interruption.
    }
  }
}

export function getJobApplicationReadiness(): JobApplicationReadiness {
  const missingFiles = Object.values(JOB_APPLICATION_RESUME_FILES).filter(
    (fileName) => !isUsablePdf(path.join(RESUME_DIR, fileName)),
  );

  return {
    ready: missingFiles.length === 0,
    resumeDirectory: RESUME_DIR,
    missingFiles,
  };
}

export function buildJobApplicationsView(): JobApplicationsViewData {
  const listings = readJobListings().listings;
  const store = readJobApplicationsStore();
  const applications: Record<string, JobApplicationRecord> = {};
  const counts: JobApplicationCounts = {
    unstarted: 0,
    inProgress: 0,
    awaitingInput: 0,
    submitted: 0,
    closed: 0,
  };
  const categoryCounts: JobApplicationCategoryCounts = {
    'fall-internship': 0,
    'spring-internship': 0,
    'summer-internship': 0,
    'new-grad': 0,
  };
  let eligibleBacklog = 0;

  for (const listing of listings) {
    const application = resolveApplicationForListing(listing, store);
    if (!application) {
      continue;
    }
    // resolveApplicationForListing returns store records by reference; clone
    // before attaching view-only bankMatch enrichment so it never persists.
    applications[listing.id] = enrichApplicationWithBankMatches(application, store.answerBank);
    incrementStatusCount(counts, application.status);
    if (listing.status === 'saved' || listing.status === 'starred') {
      for (const category of listing.applicationCategories) {
        categoryCounts[category] += 1;
      }
      if (
        application.status === 'unstarted' &&
        hasEnabledCategory(listing, store.enabledApplicationCategories)
      ) {
        eligibleBacklog += 1;
      }
    }
  }

  return {
    schemaVersion: 1,
    workerEnabled: store.workerEnabled,
    enabledApplicationCategories: store.enabledApplicationCategories,
    readiness: getJobApplicationReadiness(),
    counts,
    categoryCounts,
    eligibleBacklog,
    applications,
    answerBank: store.answerBank,
  };
}

function enrichApplicationWithBankMatches(
  application: JobApplicationRecord,
  bank: JobApplicationAnswerBankEntry[],
): JobApplicationRecord {
  if (bank.length === 0 || !application.questions.some((q) => q.resolution === 'pending')) {
    return application;
  }
  return {
    ...application,
    questions: application.questions.map((question) => {
      if (question.resolution !== 'pending') {
        return question;
      }
      const bankMatch = findAnswerBankMatch(question, bank);
      return bankMatch ? { ...question, bankMatch } : question;
    }),
  };
}

export async function claimNextJobApplication(): Promise<ClaimedJobApplication | null> {
  return mutateJobApplicationsStore((store) => {
    if (!store.workerEnabled || !getJobApplicationReadiness().ready) {
      return null;
    }

    const now = new Date();
    const activeLease = Object.values(store.applications).some(
      (application) => application.lease && Date.parse(application.lease.expiresAt) > now.getTime(),
    );
    if (activeLease) {
      return null;
    }
    const candidates = readJobListings()
      .listings.filter(
        (listing) =>
          (listing.status === 'saved' || listing.status === 'starred') &&
          hasEnabledCategory(listing, store.enabledApplicationCategories),
      )
      .flatMap((listing) => {
        const application = store.applications[listing.id] ?? createVirtualApplication(listing);
        if (!isApplicationClaimable(application, now)) {
          return [];
        }
        const priority = application.resumeRequestedAt ? 0 : listing.status === 'starred' ? 1 : 2;
        const dateValue = Date.parse(listing.postedDate ?? listing.savedAt ?? listing.createdAt);
        return [
          { listing, application, priority, dateValue: Number.isNaN(dateValue) ? 0 : dateValue },
        ];
      })
      .sort(
        (first, second) => first.priority - second.priority || second.dateValue - first.dateValue,
      );

    const selected = candidates[0];
    if (!selected) {
      return null;
    }

    const nowIso = now.toISOString();
    const leaseToken = randomUUID();
    const application: JobApplicationRecord = {
      ...selected.application,
      status: 'in-progress',
      resumeVariant:
        selected.application.resumeOverride ??
        selected.application.resumeVariant ??
        chooseResumeVariant(selected.listing),
      attemptCount: selected.application.attemptCount + 1,
      lastAttemptAt: nowIso,
      updatedAt: nowIso,
      lease: {
        token: leaseToken,
        claimedAt: nowIso,
        expiresAt: new Date(now.getTime() + LEASE_DURATION_MS).toISOString(),
      },
    };
    delete application.nextRetryAt;
    if (selected.application.status !== 'in-progress') {
      application.statusHistory = [
        ...selected.application.statusHistory,
        { status: 'in-progress', changedAt: nowIso },
      ];
    }

    store.applications[selected.listing.id] = application;
    return {
      listing: selected.listing,
      application,
      leaseToken,
      answerBank: store.answerBank,
    };
  });
}

export function hasActionableJobApplications(): boolean {
  const store = readJobApplicationsStore();
  if (!store.workerEnabled || store.enabledApplicationCategories.length === 0) {
    return false;
  }
  const now = new Date();
  if (
    Object.values(store.applications).some(
      (application) => application.lease && Date.parse(application.lease.expiresAt) > now.getTime(),
    )
  ) {
    return false;
  }
  return readJobListings().listings.some((listing) => {
    if (
      (listing.status !== 'saved' && listing.status !== 'starred') ||
      !hasEnabledCategory(listing, store.enabledApplicationCategories)
    ) {
      return false;
    }
    return isApplicationClaimable(
      store.applications[listing.id] ?? createVirtualApplication(listing),
      now,
    );
  });
}

export function hasEnabledCategory(
  listing: Pick<JobListing, 'applicationCategories'>,
  enabledCategories: JobApplicationCategory[],
): boolean {
  return listing.applicationCategories.some((category) => enabledCategories.includes(category));
}

export function requireApplicationLease(
  application: JobApplicationRecord | undefined,
  leaseToken: string,
): JobApplicationRecord {
  if (!application) {
    throw new Error('Job application not found');
  }
  if (!application.lease || application.lease.token !== leaseToken) {
    throw new Error('Job application lease is missing or no longer valid');
  }
  if (Date.parse(application.lease.expiresAt) <= Date.now()) {
    throw new Error('Job application lease has expired');
  }
  return application;
}

export function setApplicationStatus(
  application: JobApplicationRecord,
  status: JobApplicationStatus,
  changedAt = new Date().toISOString(),
): void {
  if (application.status !== status) {
    application.status = status;
    application.statusHistory.push({ status, changedAt });
  }
  application.updatedAt = changedAt;
}

export function releaseApplicationLease(application: JobApplicationRecord): void {
  delete application.lease;
}

export function startApplicationScreenshotCapture(
  application: JobApplicationRecord,
  startedAt = new Date().toISOString(),
): { capture: JobApplicationScreenshotCapture; supersededCaptureId?: string } {
  const supersededCaptureId = application.incompleteScreenshotCapture?.id;
  const capture: JobApplicationScreenshotCapture = {
    id: randomUUID(),
    attemptCount: application.attemptCount,
    startedAt,
    screenshots: [],
  };
  application.incompleteScreenshotCapture = capture;
  application.updatedAt = startedAt;
  return { capture, supersededCaptureId };
}

export function completeApplicationScreenshotCapture(
  application: JobApplicationRecord,
  captureId: string,
  completedAt = new Date().toISOString(),
): { capture: JobApplicationScreenshotCapture; supersededCaptureId?: string } {
  const capture = application.incompleteScreenshotCapture;
  if (!capture || capture.id !== captureId) {
    throw new Error('Screenshot capture is missing or no longer current');
  }
  if (capture.attemptCount !== application.attemptCount) {
    throw new Error('Screenshot capture belongs to a stale application attempt');
  }
  validateCompleteScreenshotOrdering(capture);
  capture.screenshots.sort(
    (first, second) =>
      first.pageNumber - second.pageNumber || first.segmentNumber - second.segmentNumber,
  );
  capture.completedAt = completedAt;
  delete capture.failedAt;
  delete capture.error;
  const supersededCaptureId = application.screenshotCapture?.id;
  application.screenshotCapture = capture;
  delete application.incompleteScreenshotCapture;
  application.updatedAt = completedAt;
  return { capture, supersededCaptureId };
}

export function failApplicationScreenshotCapture(
  application: JobApplicationRecord,
  captureId: string,
  error: string,
  failedAt = new Date().toISOString(),
): JobApplicationScreenshotCapture {
  const capture = application.incompleteScreenshotCapture;
  if (!capture || capture.id !== captureId) {
    throw new Error('Screenshot capture is missing or no longer current');
  }
  capture.failedAt = failedAt;
  capture.error = error;
  application.updatedAt = failedAt;
  return capture;
}

export function hasCurrentCompleteScreenshotCapture(application: JobApplicationRecord): boolean {
  return Boolean(
    application.screenshotCapture?.completedAt &&
    application.screenshotCapture.attemptCount === application.attemptCount &&
    application.screenshotCapture.screenshots.length > 0,
  );
}

export function getApplicationScreenshotFilePath(captureId: string, screenshotId: string): string {
  if (!OPAQUE_ID_PATTERN.test(captureId) || !OPAQUE_ID_PATTERN.test(screenshotId)) {
    throw new Error('Invalid screenshot identifier');
  }
  return path.join(SCREENSHOTS_DIR, captureId, `${screenshotId}.png`);
}

export function deleteApplicationScreenshotCaptureFiles(captureId: string | undefined): void {
  if (!captureId || !OPAQUE_ID_PATTERN.test(captureId)) return;
  try {
    fs.rmSync(path.join(SCREENSHOTS_DIR, captureId), { recursive: true, force: true });
  } catch (error) {
    console.error(`Unable to remove superseded screenshot capture ${captureId}:`, error);
  }
}

export function isPng(buffer: Buffer): boolean {
  return (
    buffer.length >= 45 &&
    buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    buffer.subarray(12, 16).toString('ascii') === 'IHDR' &&
    buffer.readUInt32BE(16) > 0 &&
    buffer.readUInt32BE(20) > 0 &&
    buffer.subarray(buffer.length - 8, buffer.length - 4).toString('ascii') === 'IEND'
  );
}

export function createApplicationScreenshotId(): string {
  return randomUUID();
}

// ============ User-uploaded answer files (kind: "file" questions) ============

export const JOB_APPLICATION_FILE_MAX_BYTES = 25 * 1024 * 1024;

const SAFE_FILE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const FILE_ANSWER_PATTERN =
  /^file:([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/([A-Za-z0-9._-]{1,100})$/i;

export const JOB_APPLICATION_FILE_EXTENSIONS: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function sanitizeUploadFileName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '');
  const capped = base.slice(0, 100);
  return capped.length > 0 ? capped : 'upload';
}

export function getApplicationFilePath(uploadId: string, fileName: string): string {
  if (!OPAQUE_ID_PATTERN.test(uploadId) || !SAFE_FILE_NAME_PATTERN.test(fileName)) {
    throw new Error('Invalid file identifier');
  }
  return path.join(APPLICATION_FILES_DIR, uploadId, fileName);
}

export function buildFileAnswer(uploadId: string, fileName: string): string {
  return `file:${uploadId}/${fileName}`;
}

export function parseFileAnswer(
  answer: unknown,
): { uploadId: string; fileName: string } | null {
  if (typeof answer !== 'string') return null;
  const match = FILE_ANSWER_PATTERN.exec(answer);
  return match ? { uploadId: match[1], fileName: match[2] } : null;
}

export function applicationFileExists(answer: unknown): boolean {
  const parsed = parseFileAnswer(answer);
  if (!parsed) return false;
  try {
    return fs.existsSync(getApplicationFilePath(parsed.uploadId, parsed.fileName));
  } catch {
    return false;
  }
}

export function isPdf(buffer: Buffer): boolean {
  return buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-';
}

export function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function isZipBased(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/** Validates that the file's magic bytes agree with its extension. */
export function validateUploadBytes(fileName: string, bytes: Buffer): boolean {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.pdf':
      return isPdf(bytes);
    case '.png':
      return isPng(bytes);
    case '.jpg':
    case '.jpeg':
      return isJpeg(bytes);
    case '.docx':
      return isZipBased(bytes);
    default:
      return false;
  }
}

export function materializeJobApplication(
  store: JobApplicationsStoreData,
  listingId: string,
): JobApplicationRecord {
  const existing = store.applications[listingId];
  if (existing) return existing;
  const listing = readJobListings().listings.find((candidate) => candidate.id === listingId);
  if (!listing || listing.status === 'archived') {
    throw new Error('Job application not found');
  }
  const application = createVirtualApplication(listing);
  store.applications[listingId] = application;
  return application;
}

export function createApplicationQuestionId(params: {
  prompt: string;
  kind: JobApplicationQuestionKind;
  pageUrl?: string;
  options?: Array<{ value: string; label: string }>;
}): string {
  const input = [
    normalizePrompt(params.prompt),
    params.kind,
    normalizePageUrl(params.pageUrl),
    optionsFingerprint(params.options),
  ].join('|');
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

export function normalizePrompt(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
}

export function optionsFingerprint(
  options?: Array<{ value: string; label: string }>,
): string | undefined {
  if (!options?.length) {
    return undefined;
  }
  return createHash('sha256')
    .update(
      options
        .map(
          (option) => `${option.value.trim().toLowerCase()}:${option.label.trim().toLowerCase()}`,
        )
        .sort()
        .join('|'),
    )
    .digest('hex')
    .slice(0, 16);
}

/**
 * Finds the best saved answer for a question. Tiered: an exact
 * (normalizedPrompt, kind, optionsFingerprint) match wins; otherwise a
 * (normalizedPrompt, kind) match ignoring options. Select-kind matches at the
 * relaxed tier are only "usable" when every stored value appears among the new
 * question's options — otherwise the match is reference-only.
 */
export function findAnswerBankMatch(
  question: JobApplicationQuestion,
  bank: JobApplicationAnswerBankEntry[],
): JobApplicationAnswerBankMatch | null {
  const normalizedPrompt = normalizePrompt(question.prompt);
  const fingerprint = optionsFingerprint(question.options);
  let best: { entry: JobApplicationAnswerBankEntry; tier: 'exact' | 'kind' } | null = null;
  for (const entry of bank) {
    if (entry.normalizedPrompt !== normalizedPrompt || entry.kind !== question.kind) {
      continue;
    }
    if (entry.optionsFingerprint === fingerprint) {
      best = { entry, tier: 'exact' };
      break;
    }
    if (!best) {
      best = { entry, tier: 'kind' };
    }
  }
  if (!best) {
    return null;
  }

  let usable = true;
  if (question.kind === 'file') {
    // A saved file answer is only offerable while the file still exists.
    usable = applicationFileExists(best.entry.answer);
  } else if (
    best.tier === 'kind' &&
    (question.kind === 'single-select' || question.kind === 'multi-select')
  ) {
    const optionValues = new Set(
      (question.options ?? []).flatMap((option) => [
        option.value.trim().toLowerCase(),
        option.label.trim().toLowerCase(),
      ]),
    );
    const answers = Array.isArray(best.entry.answer) ? best.entry.answer : [best.entry.answer];
    usable = answers.every((answer) => optionValues.has(answer.trim().toLowerCase()));
  }

  return {
    entryId: best.entry.id,
    answer: best.entry.answer,
    prompt: best.entry.prompt,
    tier: best.tier,
    usable,
  };
}

export function upsertConfirmedAnswer(params: {
  store: JobApplicationsStoreData;
  listingId: string;
  question: JobApplicationQuestion;
  answer: JobApplicationAnswer;
  confirmedAt: string;
}): void {
  const normalizedPrompt = normalizePrompt(params.question.prompt);
  const fingerprint = optionsFingerprint(params.question.options);
  const existing = params.store.answerBank.find(
    (entry) =>
      entry.normalizedPrompt === normalizedPrompt &&
      entry.kind === params.question.kind &&
      entry.optionsFingerprint === fingerprint,
  );
  const entry: JobApplicationAnswerBankEntry = {
    id: existing?.id ?? randomUUID(),
    normalizedPrompt,
    prompt: params.question.prompt,
    kind: params.question.kind,
    ...(fingerprint ? { optionsFingerprint: fingerprint } : {}),
    answer: params.answer,
    confirmedAt: params.confirmedAt,
    sourceListingId: params.listingId,
  };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    params.store.answerBank.push(entry);
  }
}

export function createActionQuestion(params: {
  prompt: string;
  helpText?: string;
  pageUrl?: string;
  required?: boolean;
  now?: string;
}): JobApplicationQuestion {
  const now = params.now ?? new Date().toISOString();
  return {
    id: createApplicationQuestionId({
      prompt: params.prompt,
      kind: 'action',
      pageUrl: params.pageUrl,
    }),
    prompt: params.prompt,
    kind: 'action',
    required: params.required ?? true,
    ...(params.helpText ? { helpText: params.helpText } : {}),
    ...(params.pageUrl ? { pageUrl: params.pageUrl } : {}),
    resolution: 'pending',
    discoveredAt: now,
  };
}

export function mergeApplicationQuestions(
  current: JobApplicationQuestion[],
  incoming: JobApplicationQuestion[],
): JobApplicationQuestion[] {
  const currentById = new Map(current.map((question) => [question.id, question]));
  const merged = incoming.map((question) => {
    const existing = currentById.get(question.id);
    if (!existing) {
      return question;
    }
    if (existing.resolution !== 'pending') {
      return {
        ...question,
        answer: existing.answer,
        resolution: existing.resolution,
        answeredAt: existing.answeredAt,
      };
    }
    return {
      ...question,
      ...(existing.answer !== undefined ? { answer: existing.answer } : {}),
    };
  });
  const incomingIds = new Set(incoming.map((question) => question.id));
  return [...merged, ...current.filter((question) => !incomingIds.has(question.id))];
}

export function updateJobListingLeadStatus(
  listingId: string,
  status: 'applied' | 'archived',
): void {
  const data = readJobListings();
  const listing = data.listings.find((candidate) => candidate.id === listingId);
  if (!listing || listing.status === status) return;
  const now = new Date().toISOString();
  listing.status = status;
  listing.updatedAt = now;
  listing.statusHistory = [...listing.statusHistory, { status, changedAt: now }];
  writeJobListings(data);
}

function resolveApplicationForListing(
  listing: JobListing,
  store: JobApplicationsStoreData,
): JobApplicationRecord | null {
  const existing = store.applications[listing.id];
  if (listing.status === 'archived') {
    return existing?.status === 'closed' ? existing : null;
  }
  if (existing) {
    return existing;
  }
  if (listing.status === 'saved' || listing.status === 'starred' || listing.status === 'applied') {
    return createVirtualApplication(listing);
  }
  return null;
}

function createVirtualApplication(listing: JobListing): JobApplicationRecord {
  const createdAt = listing.savedAt || listing.createdAt || new Date().toISOString();
  const status: JobApplicationStatus = listing.status === 'applied' ? 'submitted' : 'unstarted';
  return {
    listingId: listing.id,
    status,
    resumeVariant: chooseResumeVariant(listing),
    attemptCount: 0,
    statusHistory: status === 'submitted' ? [{ status, changedAt: listing.updatedAt }] : [],
    questions: [],
    ...(status === 'submitted' ? { submittedAt: listing.updatedAt } : {}),
    createdAt,
    updatedAt: listing.updatedAt || createdAt,
  };
}

function chooseResumeVariant(listing: JobListing): 'swe' | 'mle' {
  const text = `${listing.positionTitle} ${listing.notes}`.toLowerCase();
  const mlePattern =
    /\b(machine learning|ml engineer|artificial intelligence|ai engineer|data scien|deep learning|llm|nlp|natural language|computer vision|research engineer|research scientist|modeling)\b/;
  return mlePattern.test(text) ? 'mle' : 'swe';
}

function isApplicationClaimable(application: JobApplicationRecord, now: Date): boolean {
  if (
    application.status === 'submitted' ||
    application.status === 'closed' ||
    application.status === 'awaiting-user-input'
  ) {
    return false;
  }
  if (application.lease && Date.parse(application.lease.expiresAt) > now.getTime()) {
    return false;
  }
  if (application.nextRetryAt && Date.parse(application.nextRetryAt) > now.getTime()) {
    return false;
  }
  if (application.submissionAttemptedAt && !application.submittedAt) {
    return false;
  }
  return true;
}

function incrementStatusCount(counts: JobApplicationCounts, status: JobApplicationStatus): void {
  if (status === 'unstarted') counts.unstarted += 1;
  if (status === 'in-progress') counts.inProgress += 1;
  if (status === 'awaiting-user-input') counts.awaitingInput += 1;
  if (status === 'submitted') counts.submitted += 1;
  if (status === 'closed') counts.closed += 1;
}

function normalizeApplicationRecord(
  listingId: string,
  value: unknown,
): JobApplicationRecord | null {
  if (!isRecord(value)) {
    return null;
  }
  const now = new Date().toISOString();
  const status = normalizeApplicationStatus(value.status);
  const createdAt = normalizeString(value.createdAt) || now;
  const questions = Array.isArray(value.questions)
    ? value.questions.flatMap((question) => normalizeQuestion(question))
    : [];
  const record: JobApplicationRecord = {
    listingId,
    status,
    resumeVariant: value.resumeVariant === 'mle' ? 'mle' : 'swe',
    attemptCount: normalizeNonNegativeInteger(value.attemptCount),
    statusHistory: Array.isArray(value.statusHistory)
      ? value.statusHistory.flatMap((entry) => normalizeApplicationStatusHistory(entry))
      : [],
    questions,
    createdAt,
    updatedAt: normalizeString(value.updatedAt) || createdAt,
  };

  if (value.resumeOverride === 'swe' || value.resumeOverride === 'mle')
    record.resumeOverride = value.resumeOverride;
  if (normalizeString(value.canonicalApplicationUrl))
    record.canonicalApplicationUrl = normalizeString(value.canonicalApplicationUrl);
  if (normalizeString(value.nextRetryAt)) record.nextRetryAt = normalizeString(value.nextRetryAt);
  if (normalizeString(value.resumeRequestedAt))
    record.resumeRequestedAt = normalizeString(value.resumeRequestedAt);
  if (normalizeString(value.lastAttemptAt))
    record.lastAttemptAt = normalizeString(value.lastAttemptAt);
  if (normalizeString(value.submissionAttemptedAt))
    record.submissionAttemptedAt = normalizeString(value.submissionAttemptedAt);
  if (normalizeString(value.submittedAt)) record.submittedAt = normalizeString(value.submittedAt);
  if (normalizeString(value.closedAt)) record.closedAt = normalizeString(value.closedAt);
  if (normalizeString(value.closedReason))
    record.closedReason = normalizeString(value.closedReason);
  if (isRecord(value.lease)) {
    const token = normalizeString(value.lease.token);
    const claimedAt = normalizeString(value.lease.claimedAt);
    const expiresAt = normalizeString(value.lease.expiresAt);
    if (token && claimedAt && expiresAt) record.lease = { token, claimedAt, expiresAt };
  }
  if (isRecord(value.lastError)) {
    const code = normalizeString(value.lastError.code);
    const message = normalizeString(value.lastError.message);
    const occurredAt = normalizeString(value.lastError.occurredAt);
    if (code && message && occurredAt) {
      record.lastError = {
        code,
        message,
        occurredAt,
        retryable: value.lastError.retryable === true,
      };
    }
  }
  if (isRecord(value.submissionEvidence)) {
    record.submissionEvidence = {
      ...(normalizeString(value.submissionEvidence.url)
        ? { url: normalizeString(value.submissionEvidence.url) }
        : {}),
      ...(normalizeString(value.submissionEvidence.message)
        ? { message: normalizeString(value.submissionEvidence.message) }
        : {}),
    };
  }
  const screenshotCapture = normalizeScreenshotCapture(value.screenshotCapture, true);
  if (screenshotCapture) record.screenshotCapture = screenshotCapture;
  const incompleteScreenshotCapture = normalizeScreenshotCapture(
    value.incompleteScreenshotCapture,
    false,
  );
  if (incompleteScreenshotCapture) record.incompleteScreenshotCapture = incompleteScreenshotCapture;
  return record;
}

function normalizeScreenshotCapture(
  value: unknown,
  requireComplete: boolean,
): JobApplicationScreenshotCapture | undefined {
  if (!isRecord(value)) return undefined;
  const id = normalizeString(value.id);
  const startedAt = normalizeString(value.startedAt);
  const attemptCount = normalizeNonNegativeInteger(value.attemptCount);
  if (!OPAQUE_ID_PATTERN.test(id) || !startedAt || attemptCount < 1) return undefined;
  const screenshots = Array.isArray(value.screenshots)
    ? value.screenshots.flatMap((screenshot) => {
        if (!isRecord(screenshot)) return [];
        const screenshotId = normalizeString(screenshot.id);
        const pageNumber = normalizePositiveInteger(screenshot.pageNumber);
        const segmentNumber = normalizePositiveInteger(screenshot.segmentNumber);
        const label = normalizeString(screenshot.label);
        const capturedAt = normalizeString(screenshot.capturedAt);
        const byteSize = normalizePositiveInteger(screenshot.byteSize);
        if (
          !OPAQUE_ID_PATTERN.test(screenshotId) ||
          !pageNumber ||
          !segmentNumber ||
          !label ||
          !capturedAt ||
          !byteSize ||
          screenshot.contentType !== 'image/png'
        ) {
          return [];
        }
        return [
          {
            id: screenshotId,
            pageNumber,
            segmentNumber,
            label,
            ...(normalizeString(screenshot.pageUrl)
              ? { pageUrl: normalizeString(screenshot.pageUrl) }
              : {}),
            capturedAt,
            contentType: 'image/png' as const,
            byteSize,
          },
        ];
      })
    : [];
  const completedAt = normalizeString(value.completedAt);
  if (requireComplete && (!completedAt || screenshots.length === 0)) return undefined;
  return {
    id,
    attemptCount,
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    ...(normalizeString(value.failedAt) ? { failedAt: normalizeString(value.failedAt) } : {}),
    ...(normalizeString(value.error) ? { error: normalizeString(value.error) } : {}),
    screenshots,
  };
}

function validateCompleteScreenshotOrdering(capture: JobApplicationScreenshotCapture): void {
  if (capture.screenshots.length === 0) {
    throw new Error('At least one application screenshot is required');
  }
  const keys = new Set<string>();
  const segmentsByPage = new Map<number, number[]>();
  for (const screenshot of capture.screenshots) {
    const key = `${screenshot.pageNumber}:${screenshot.segmentNumber}`;
    if (keys.has(key)) throw new Error('Screenshot page and segment ordering must be unique');
    keys.add(key);
    const segments = segmentsByPage.get(screenshot.pageNumber) ?? [];
    segments.push(screenshot.segmentNumber);
    segmentsByPage.set(screenshot.pageNumber, segments);
  }
  const pages = [...segmentsByPage.keys()].sort((first, second) => first - second);
  if (pages.some((page, index) => page !== index + 1)) {
    throw new Error('Screenshot page numbering must be contiguous and start at one');
  }
  for (const segments of segmentsByPage.values()) {
    segments.sort((first, second) => first - second);
    if (segments.some((segment, index) => segment !== index + 1)) {
      throw new Error('Screenshot segment numbering must be contiguous and start at one');
    }
  }
}

function normalizeQuestion(value: unknown): JobApplicationQuestion[] {
  if (!isRecord(value)) return [];
  const prompt = normalizeString(value.prompt).trim();
  const kind = normalizeQuestionKind(value.kind);
  if (!prompt || !kind) return [];
  const options = Array.isArray(value.options)
    ? value.options.flatMap((option) => {
        if (!isRecord(option)) return [];
        const optionValue = normalizeString(option.value);
        const label = normalizeString(option.label);
        return optionValue && label ? [{ value: optionValue, label }] : [];
      })
    : undefined;
  const question: JobApplicationQuestion = {
    id:
      normalizeString(value.id) ||
      createApplicationQuestionId({
        prompt,
        kind,
        pageUrl: normalizeString(value.pageUrl),
        options,
      }),
    prompt,
    kind,
    required: value.required === true,
    ...(options?.length ? { options } : {}),
    resolution: normalizeQuestionResolution(value.resolution),
    discoveredAt: normalizeString(value.discoveredAt) || new Date().toISOString(),
  };
  if (normalizeString(value.helpText)) question.helpText = normalizeString(value.helpText);
  if (normalizeString(value.pageUrl)) question.pageUrl = normalizeString(value.pageUrl);
  if (normalizeString(value.section)) question.section = normalizeString(value.section);
  if (value.multiline === true) question.multiline = true;
  const answer = normalizeAnswer(value.answer);
  if (answer !== undefined) question.answer = answer;
  if (normalizeString(value.answeredAt)) question.answeredAt = normalizeString(value.answeredAt);
  if (isRecord(value.suggestion)) {
    const suggestedAnswer = normalizeAnswer(value.suggestion.answer);
    const sourceAnswerId = normalizeString(value.suggestion.sourceAnswerId);
    const confidence =
      typeof value.suggestion.confidence === 'number' ? value.suggestion.confidence : 0;
    if (suggestedAnswer !== undefined && sourceAnswerId && confidence >= 0 && confidence <= 1) {
      question.suggestion = {
        answer: suggestedAnswer,
        sourceAnswerId,
        confidence,
        ...(value.suggestion.category === 'legal' ||
        value.suggestion.category === 'certification' ||
        value.suggestion.category === 'demographic'
          ? { category: value.suggestion.category }
          : { category: 'standard' }),
      };
    }
  }
  return [question];
}

function normalizeAnswerBankEntry(value: unknown): JobApplicationAnswerBankEntry[] {
  if (!isRecord(value)) return [];
  const answer = normalizeAnswer(value.answer);
  const id = normalizeString(value.id);
  const normalizedPrompt = normalizeString(value.normalizedPrompt);
  const prompt = normalizeString(value.prompt);
  const kind = normalizeQuestionKind(value.kind);
  const confirmedAt = normalizeString(value.confirmedAt);
  const sourceListingId = normalizeString(value.sourceListingId);
  if (
    answer === undefined ||
    !id ||
    !normalizedPrompt ||
    !prompt ||
    !kind ||
    !confirmedAt ||
    !sourceListingId
  ) {
    return [];
  }
  return [
    {
      id,
      normalizedPrompt,
      prompt,
      kind,
      ...(normalizeString(value.optionsFingerprint)
        ? { optionsFingerprint: normalizeString(value.optionsFingerprint) }
        : {}),
      answer,
      confirmedAt,
      sourceListingId,
    },
  ];
}

function normalizeApplicationStatus(value: unknown): JobApplicationStatus {
  return value === 'in-progress' ||
    value === 'awaiting-user-input' ||
    value === 'submitted' ||
    value === 'closed'
    ? value
    : 'unstarted';
}

function normalizeQuestionKind(value: unknown): JobApplicationQuestionKind | null {
  return value === 'text' ||
    value === 'single-select' ||
    value === 'multi-select' ||
    value === 'file' ||
    value === 'action'
    ? value
    : null;
}

function normalizeQuestionResolution(value: unknown): JobApplicationQuestion['resolution'] {
  return value === 'answered' || value === 'skipped' || value === 'auto-resolved'
    ? value
    : 'pending';
}

function normalizeApplicationStatusHistory(value: unknown): JobApplicationRecord['statusHistory'] {
  if (!isRecord(value)) return [];
  const changedAt = normalizeString(value.changedAt);
  if (!changedAt) return [];
  return [{ status: normalizeApplicationStatus(value.status), changedAt }];
}

function normalizeAnswer(value: unknown): JobApplicationAnswer | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  return undefined;
}

function normalizeEnabledApplicationCategories(value: unknown): JobApplicationCategory[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_ENABLED_APPLICATION_CATEGORIES];
  }
  return JOB_APPLICATION_CATEGORIES.filter((category) => value.includes(category));
}

function normalizePageUrl(value: string | undefined): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.trim();
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNonNegativeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUsablePdf(filePath: string): boolean {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile() || stats.size < 5) return false;
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const header = Buffer.alloc(5);
      fs.readSync(descriptor, header, 0, 5, 0);
      return header.toString('ascii') === '%PDF-';
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return false;
  }
}

async function acquireStoreLock(): Promise<void> {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const descriptor = fs.openSync(APPLICATIONS_LOCK_FILE, 'wx');
      fs.writeFileSync(descriptor, `${process.pid}\n`, 'utf-8');
      fs.closeSync(descriptor);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      try {
        const stats = fs.statSync(APPLICATIONS_LOCK_FILE);
        if (Date.now() - stats.mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(APPLICATIONS_LOCK_FILE);
          continue;
        }
      } catch {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Timed out waiting for the job application store lock');
}
