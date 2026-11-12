import path from 'path';
import type { AssessmentPreview, JobApplicationRecord, JobApplicationsStoreData, JobListing } from '@/lib/types';
import { isOpenClawCliAvailable, runOpenClawCli } from '@/lib/openclaw-cron';
import { mutateInterviews, writeNoteFile } from '@/lib/interviews/store';
import { saveNote } from '@/lib/interviews/actions';
import { readGeneralTasks } from '../tasks/today/today-store-utils';
import { readJobListings } from './job-store-utils';
import { mutateJobApplicationsStore, readJobApplicationsStore } from './application-store-utils';
import { currentAssessment, syncAssessmentTask } from './assessment-task-utils';

// OA previews: as soon as an OA task has its link, OpenClaw opens it in its own
// browser without pressing start and saves everything the landing page shows
// (skill: agentic-journal-oa-preview). The full capture becomes an 'oa' note in
// the Interviews casebook; a short summary goes on the OA task.

export const PREVIEW_MAX_ATTEMPTS = 3;
/** A request that has not produced a result by then is asked for again. */
export const PREVIEW_RETRY_MS = 2 * 60 * 60 * 1000;
export const PREVIEW_NOTE_TITLE = 'OA preview: what the page shows';
export const PREVIEW_SUMMARY_MAX = 10;
export const PREVIEW_ATTACHMENT_MAX = 20;
export const PREVIEW_ATTACHMENT_MAX_BYTES = 15 * 1024 * 1024;
export const PREVIEW_ATTACHMENT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'pdf', 'txt', 'md', 'csv', 'json', 'zip', 'docx'];

export const OA_PREVIEW_CRON_NAME = 'Agentic Journal OA Preview';
export const OA_PREVIEW_MESSAGE =
  'Use the agentic-journal-oa-preview skill and preview every pending online assessment. ' +
  'Open each OA link in the managed openclaw browser and save everything the page shows without starting it: ' +
  'never click Start, Begin, Continue, Accept, Agree, Next, Submit or anything that could start a timer, record consent or submit. ' +
  'Save each preview with the skill CLI, then stop. Never use Claude. If the Journal is unreachable, stop and report one line; never build, deploy or restart anything.';

export interface PendingAssessmentPreview {
  listingId: string;
  company: string;
  positionTitle: string;
  assessmentUrl: string;
  provider?: string;
  assessmentType?: string;
  deadline?: string;
  taskId: string;
  attempts: number;
  lastError?: string;
}

type Source = { listings: JobListing[]; applications: Record<string, JobApplicationRecord> };

const openTaskIds = () => new Set(readGeneralTasks('have-to-do').tasks.map((task) => task.id));

/** The OA link of an application whose OA task is still open, or undefined. */
function openAssessmentUrl(application: JobApplicationRecord, open: Set<string>): string | undefined {
  const taskId = application.assessmentTask?.taskId;
  if (!taskId || !open.has(taskId)) return undefined;
  return currentAssessment(application).url;
}

/** Not yet captured for this link, and not given up on. */
function previewOutstanding(preview: AssessmentPreview | undefined, url: string): boolean {
  if (!preview || preview.url !== url) return true;
  return (preview.status === 'requested' || preview.status === 'failed') && preview.attempts < PREVIEW_MAX_ATTEMPTS;
}

/** Outstanding and either never asked for or asked for long enough ago that the run must have died. */
export function previewDue(preview: AssessmentPreview | undefined, url: string, nowMs: number): boolean {
  if (!previewOutstanding(preview, url)) return false;
  if (!preview || preview.url !== url || !preview.requestedAt) return true;
  return nowMs - Date.parse(preview.requestedAt) >= PREVIEW_RETRY_MS;
}

/** What OpenClaw should preview now: every open OA with a link that has no capture yet. */
export function listPendingPreviews(source: Source = loadSource()): PendingAssessmentPreview[] {
  const open = openTaskIds();
  return Object.values(source.applications).flatMap((application) => {
    const url = openAssessmentUrl(application, open);
    const preview = application.assessmentTask?.preview;
    const listing = source.listings.find((item) => item.id === application.listingId);
    if (!url || !listing || !previewOutstanding(preview, url)) return [];
    const { provider, assessmentType, deadline } = currentAssessment(application);
    const sameLink = preview?.url === url;
    return [{
      listingId: listing.id, company: listing.company, positionTitle: listing.positionTitle,
      assessmentUrl: url, provider, assessmentType, deadline,
      taskId: application.assessmentTask!.taskId,
      attempts: sameLink ? preview!.attempts : 0,
      ...(sameLink && preview!.error ? { lastError: preview!.error } : {}),
    }];
  });
}

/** Marks every due preview as requested; returns their listing ids. */
export function requestDuePreviews(store: JobApplicationsStoreData, now: string): string[] {
  const open = openTaskIds();
  const nowMs = Date.parse(now);
  const requested: string[] = [];
  for (const application of Object.values(store.applications)) {
    const url = openAssessmentUrl(application, open);
    const previous = application.assessmentTask?.preview;
    if (!url || !previewDue(previous, url, nowMs)) continue;
    const sameLink = previous?.url === url;
    application.assessmentTask!.preview = {
      ...(sameLink ? previous : {}),
      url, status: 'requested', attempts: (sameLink ? previous!.attempts : 0) + 1, requestedAt: now,
    };
    application.updatedAt = now;
    requested.push(application.listingId);
  }
  return requested;
}

let lastWakeCheckMs = 0;

/**
 * Wakes OpenClaw once for every OA that has a link and no preview yet. Called
 * after email updates land and from the server's reconcile interval; cheap when
 * nothing is due. Returns the listing ids it asked OpenClaw to preview.
 */
export async function wakeAssessmentPreviewsIfDue(options: { force?: boolean } = {}): Promise<string[]> {
  if (process.env.OA_PREVIEW_DISABLED === '1' || !isOpenClawCliAvailable()) return [];
  if (!options.force && Date.now() - lastWakeCheckMs < 60_000) return [];
  lastWakeCheckMs = Date.now();
  const now = new Date().toISOString();
  // A read first, so the common case takes no store lock.
  const open = openTaskIds();
  const anyDue = Object.values(readJobApplicationsStore().applications).some((application) => {
    const url = openAssessmentUrl(application, open);
    return url && previewDue(application.assessmentTask?.preview, url, Date.parse(now));
  });
  if (!anyDue) return [];
  const requested = await mutateJobApplicationsStore((store) => requestDuePreviews(store, now));
  if (requested.length === 0) return [];
  await runOpenClawCli([
    'cron', 'add',
    '--name', OA_PREVIEW_CRON_NAME,
    '--description', 'Opens new OA links without starting them and saves what the page shows to the Journal',
    '--at', new Date(Date.now() + 15_000).toISOString(),
    '--session', 'isolated',
    '--message', OA_PREVIEW_MESSAGE,
    '--delete-after-run',
    '--no-deliver',
    '--timeout-seconds', '1200',
    '--json',
  ]);
  return requested;
}

export interface PreviewAttachment {
  /** File name to store it under (sanitised; extension decides the type). */
  name: string;
  data: Buffer;
  title?: string;
}

export interface SavePreviewInput {
  listingId: string;
  status: 'saved' | 'blocked';
  /** Markdown: everything the page showed. */
  body: string;
  summary: string[];
  attachments?: PreviewAttachment[];
}

function attachmentFileName(name: string): string {
  const base = path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  const ext = path.extname(base).slice(1).toLowerCase();
  if (!base || !PREVIEW_ATTACHMENT_EXTENSIONS.includes(ext)) {
    throw new Error(`Attachment type not allowed: ${name} (use ${PREVIEW_ATTACHMENT_EXTENSIONS.join(', ')})`);
  }
  return `oa-preview-${base}`;
}

/** Writes the capture to the casebook and the summary to the OA task. */
export async function saveAssessmentPreview(input: SavePreviewInput, now = new Date().toISOString()) {
  const summary = input.summary.map((line) => line.trim()).filter(Boolean);
  if (!input.body.trim()) throw new Error('The preview needs the page content');
  if (summary.length === 0 || summary.length > PREVIEW_SUMMARY_MAX) throw new Error(`Give 1 to ${PREVIEW_SUMMARY_MAX} summary lines`);
  if (summary.some((line) => line.length > 300)) throw new Error('Keep each summary line under 300 characters');
  const attachments = (input.attachments ?? []).map((file) => ({ ...file, file: attachmentFileName(file.name) }));
  if (attachments.length > PREVIEW_ATTACHMENT_MAX) throw new Error(`At most ${PREVIEW_ATTACHMENT_MAX} attachments`);
  for (const file of attachments) {
    if (file.data.length === 0 || file.data.length > PREVIEW_ATTACHMENT_MAX_BYTES) throw new Error(`Attachment is empty or over 15 MB: ${file.name}`);
  }

  const source = loadSource();
  const application = source.applications[input.listingId];
  const listing = source.listings.find((item) => item.id === input.listingId);
  const { url, invitation } = application ? currentAssessment(application) : { url: undefined, invitation: undefined };
  if (!application?.assessmentTask || !listing || !url) throw new Error('No online assessment with a link for that posting');
  const previous = application.assessmentTask.preview?.url === url ? application.assessmentTask.preview : undefined;

  const { processId, noteId } = await mutateInterviews((index) => {
    const known = previous?.processId && index.processes.some((p) => p.id === previous.processId);
    const key = known ? previous!.processId! : `listing:${listing.id}`;
    const existingNote = known && previous?.noteId &&
      index.processes.find((p) => p.id === previous.processId)?.notes.some((n) => n.id === previous.noteId);
    const round = invitation ? `oa-${invitation.id}` : 'before';
    const note = saveNote(index, {
      key, noteId: existingNote ? previous!.noteId : undefined, title: PREVIEW_NOTE_TITLE,
      kind: 'oa', round, body: input.body, author: 'openclaw', date: now,
    }, source);
    const process = index.processes.find((p) => p.notes.includes(note))!;
    for (const file of attachments) {
      const bytes = writeNoteFile(process, file.file, file.data);
      const same = process.notes.find((n) => n.file === file.file);
      if (same) Object.assign(same, { bytes, date: now, ...(file.title ? { title: file.title } : {}) });
      else process.notes.push({
        id: `${note.id}:${file.file}`, title: file.title?.trim() || file.name, kind: 'file', round,
        date: now, author: 'openclaw', file: file.file, bytes,
      });
    }
    return { processId: process.id, noteId: note.id };
  });

  return mutateJobApplicationsStore((store) => {
    const record = store.applications[input.listingId];
    if (!record?.assessmentTask) throw new Error('No online assessment for that posting');
    const prior = record.assessmentTask.preview?.url === url ? record.assessmentTask.preview : undefined;
    record.assessmentTask.preview = {
      url, status: input.status, attempts: prior?.attempts ?? 0,
      ...(prior?.requestedAt ? { requestedAt: prior.requestedAt } : {}),
      at: now, summary, processId, noteId,
    };
    record.updatedAt = now;
    syncAssessmentTask(record, listing);
    return { listingId: input.listingId, status: input.status, processId, noteId, attachments: attachments.length };
  });
}

/** The run could not capture the page; the Journal asks again later, up to PREVIEW_MAX_ATTEMPTS. */
export async function failAssessmentPreview(listingId: string, error: string, now = new Date().toISOString()) {
  return mutateJobApplicationsStore((store) => {
    const record = store.applications[listingId];
    const url = record ? currentAssessment(record).url : undefined;
    if (!record?.assessmentTask || !url) throw new Error('No online assessment with a link for that posting');
    const prior = record.assessmentTask.preview?.url === url ? record.assessmentTask.preview : undefined;
    record.assessmentTask.preview = {
      ...prior, url, status: 'failed', attempts: prior?.attempts ?? 0, at: now, error: error.trim().slice(0, 500),
    };
    record.updatedAt = now;
    return { listingId, status: 'failed', attempts: record.assessmentTask.preview.attempts, willRetry: record.assessmentTask.preview.attempts < PREVIEW_MAX_ATTEMPTS };
  });
}

function loadSource(): Source {
  return { listings: readJobListings().listings, applications: readJobApplicationsStore().applications };
}
