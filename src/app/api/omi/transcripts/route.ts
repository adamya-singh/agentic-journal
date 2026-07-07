import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TRANSCRIPT_DIR = path.join(process.cwd(), 'src/backend/data/omi-transcripts');
const AUDIO_DIR = path.join(process.cwd(), 'src/backend/data/omi-audio');
const QUEUE_DIR = path.join(process.cwd(), 'src/backend/data/omi-transcription-queue');
const JOURNAL_LINK_DIR = path.join(process.cwd(), 'src/backend/data/omi-journal-links');
const DEFAULT_TIMEZONE = 'America/New_York';
const NON_CONTENT_TRANSCRIPTS = new Set([
  '[background]',
  '[background].',
  '[no speech]',
  '[no speech].',
  '[inaudible]',
  '[inaudible].',
  '[silence]',
  '[silence].',
  '_no transcript text returned._',
]);

type OmiTranscriptSegment = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  startLabel: string;
  endLabel: string;
  durationSeconds: number | null;
  transcript: string;
  transcriptHash: string;
  journalLink: OmiTranscriptJournalLink;
};

type OmiTranscriptJournalLink = {
  status: 'unprocessed' | 'logged' | 'skipped' | 'requested' | 'stale';
  eligible: boolean;
  stale: boolean;
  journalRefs: OmiTranscriptJournalRef[];
  proposalId: string | null;
  runId: string | null;
  skipReason: string | null;
  updatedAt: string | null;
  loggedAt: string | null;
  skippedAt: string | null;
  requestedAt: string | null;
  requestSource: string | null;
};

type OmiTranscriptJournalRef = {
  date: string;
  journalEntryId: string;
  hour?: string;
  range?: {
    start: string;
    end: string;
  };
};

type OmiTranscriptBatchStatus = 'completed' | 'failed' | 'pending' | 'running' | 'missing';

type OmiTranscriptBatch = {
  id: string;
  status: OmiTranscriptBatchStatus;
  startedAt: string | null;
  endedAt: string | null;
  startLabel: string;
  endLabel: string;
  durationSeconds: number | null;
  chunkCount: number;
  transcriptChars: number | null;
  completedAt: string | null;
  failedAt: string | null;
  retryAfter: string | null;
  retryCount: number;
  lastRetryRequestedAt: string | null;
  recoverable: boolean;
  error: string | null;
};

type OmiTranscriptDay = {
  date: string;
  segments: OmiTranscriptSegment[];
  batches: OmiTranscriptBatch[];
  omittedSegmentCount: number;
  status: {
    exists: boolean;
    segmentCount: number;
    transcriptCharCount: number;
    audioChunkCount: number;
    queueChunkCount: number;
    completedBatchCount: number;
    failedBatchCount: number;
    pendingBatchCount: number;
    runningBatchCount: number;
    missingChunkCount: number;
    recoverableBatchCount: number;
    generatedAt?: string;
    newestTranscriptAt?: string;
    statusUpdatedAt?: string;
    queueUpdatedAt?: string;
  };
};

type RawTranscriptFile = {
  date?: string;
  generatedAt?: string;
  segments?: unknown[];
};

type RawTranscriptSegment = {
  id?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  durationSeconds?: unknown;
  transcript?: unknown;
  completedAt?: unknown;
};

type RawStatusFile = {
  updatedAt?: unknown;
  segments?: Record<string, RawStatusSegment>;
};

type RawStatusSegment = {
  id?: unknown;
  status?: unknown;
  sourceStartedAt?: unknown;
  sourceEndedAt?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  durationSeconds?: unknown;
  chunkCount?: unknown;
  chunkIds?: unknown;
  transcriptChars?: unknown;
  completedAt?: unknown;
  failedAt?: unknown;
  retryAfter?: unknown;
  retryCount?: unknown;
  lastRetryRequestedAt?: unknown;
  error?: unknown;
};

type RawManifestEntry = {
  chunkId?: unknown;
  receivedAt?: unknown;
};

type RawQueueFile = {
  updatedAt?: unknown;
  chunks?: unknown[];
};

type RawJournalLinksFile = {
  segments?: Record<string, RawJournalLinkSegment>;
};

type RawJournalLinkSegment = {
  status?: unknown;
  transcriptHash?: unknown;
  proposalId?: unknown;
  runId?: unknown;
  journalRefs?: unknown;
  skipReason?: unknown;
  updatedAt?: unknown;
  loggedAt?: unknown;
  skippedAt?: unknown;
  requestedAt?: unknown;
  requestSource?: unknown;
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const dates = getRequestedDates(searchParams);

    if (!dates.every(isValidDate)) {
      return NextResponse.json(
        { success: false, error: 'dates must use YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    const transcripts = Object.fromEntries(dates.map((date) => [date, readTranscriptDay(date)]));

    return NextResponse.json({
      success: true,
      dates,
      transcripts,
    });
  } catch (error) {
    console.error('Error reading Omi transcripts:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function getRequestedDates(searchParams: URLSearchParams): string[] {
  const explicitDates = searchParams
    .getAll('dates')
    .concat(searchParams.getAll('dates[]'))
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter(Boolean);

  if (explicitDates.length > 0) {
    return Array.from(new Set(explicitDates));
  }

  const weekOffset = Number(searchParams.get('weekOffset') ?? '0');
  return getWeekDates(Number.isInteger(weekOffset) ? weekOffset : 0);
}

function readTranscriptDay(date: string): OmiTranscriptDay {
  const rawPath = path.join(TRANSCRIPT_DIR, `${date}.raw.json`);
  const markdownPath = path.join(TRANSCRIPT_DIR, `${date}.md`);
  const status = readStatusFile(date);
  const manifestEntries = readManifestEntries(date);
  const queue = readQueueFile(date);
  const journalLinks = readJournalLinksFile(date);
  const baseDay = fs.existsSync(rawPath)
    ? readRawTranscriptDay(date, rawPath)
    : fs.existsSync(markdownPath)
      ? readMarkdownTranscriptDay(date, markdownPath)
      : emptyTranscriptDay(date, false);

  return mergeTranscriptStatus(mergeJournalLinks(baseDay, journalLinks), status, manifestEntries, queue);
}

function readRawTranscriptDay(date: string, rawPath: string): OmiTranscriptDay {
  try {
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8')) as RawTranscriptFile;
    const rawSegments = Array.isArray(raw.segments) ? raw.segments : [];
    const allSegments = rawSegments.map(normalizeRawSegment).sort(compareSegments);
    const segments = allSegments.filter((segment) => isUsableTranscript(segment.transcript));
    const newestTranscriptAt = rawSegments
      .map((segment) => {
        const completedAt = (segment as RawTranscriptSegment)?.completedAt;
        return typeof completedAt === 'string' ? completedAt : null;
      })
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1);

    return {
      date,
      segments,
      batches: [],
      omittedSegmentCount: allSegments.length - segments.length,
      status: {
        ...emptyTranscriptDay(date, true).status,
        exists: true,
        segmentCount: segments.length,
        transcriptCharCount: segments.reduce((total, segment) => total + segment.transcript.length, 0),
        ...(typeof raw.generatedAt === 'string' ? { generatedAt: raw.generatedAt } : {}),
        ...(newestTranscriptAt ? { newestTranscriptAt } : {}),
      },
    };
  } catch {
    return emptyTranscriptDay(date, true);
  }
}

function readMarkdownTranscriptDay(date: string, markdownPath: string): OmiTranscriptDay {
  try {
    const markdown = fs.readFileSync(markdownPath, 'utf-8');
    const generatedAt = markdown.match(/^Generated:\s*(.+)$/m)?.[1]?.trim();
    const sections = markdown.split(/^##\s+/m).slice(1);
    const allSegments = sections.map(normalizeMarkdownSection).sort(compareSegments);
    const segments = allSegments.filter((segment) => isUsableTranscript(segment.transcript));

    return {
      date,
      segments,
      batches: [],
      omittedSegmentCount: allSegments.length - segments.length,
      status: {
        ...emptyTranscriptDay(date, true).status,
        exists: true,
        segmentCount: segments.length,
        transcriptCharCount: segments.reduce((total, segment) => total + segment.transcript.length, 0),
        ...(generatedAt ? { generatedAt } : {}),
      },
    };
  } catch {
    return emptyTranscriptDay(date, true);
  }
}

function normalizeRawSegment(segment: unknown): OmiTranscriptSegment {
  const raw = (segment && typeof segment === 'object' ? segment : {}) as RawTranscriptSegment;
  const id = typeof raw.id === 'string' ? raw.id : 'unknown';
  const startedAt = typeof raw.startedAt === 'string' ? raw.startedAt : null;
  const endedAt = typeof raw.endedAt === 'string' ? raw.endedAt : null;
  const durationSeconds = typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds)
    ? raw.durationSeconds
    : null;
  const transcript = typeof raw.transcript === 'string' ? raw.transcript.trim() : '';
  const labels = labelsForSegment(id, startedAt, endedAt);

  return {
    id,
    startedAt,
    endedAt,
    startLabel: labels.startLabel,
    endLabel: labels.endLabel,
    durationSeconds,
    transcript,
    transcriptHash: hashTranscript(transcript),
    journalLink: emptyJournalLink(true),
  };
}

function normalizeMarkdownSection(section: string, index: number): OmiTranscriptSegment {
  const lines = section.split('\n');
  const heading = lines.shift()?.trim() || `segment-${index + 1}`;
  const sourceLineIndex = lines.findIndex((line) => line.startsWith('Source:'));
  const transcriptLines = lines
    .slice(sourceLineIndex >= 0 ? sourceLineIndex + 1 : 0)
    .map((line) => line.trim())
    .filter(Boolean);
  const transcript = transcriptLines.join(' ').trim();
  const labels = labelsForSegment(heading, null, null);

  return {
    id: heading,
    startedAt: null,
    endedAt: null,
    startLabel: labels.startLabel,
    endLabel: labels.endLabel,
    durationSeconds: parseMarkdownDuration(lines[sourceLineIndex] ?? ''),
    transcript,
    transcriptHash: hashTranscript(transcript),
    journalLink: emptyJournalLink(true),
  };
}

function labelsForSegment(id: string, startedAt: string | null, endedAt: string | null): {
  startLabel: string;
  endLabel: string;
} {
  const startFromDate = startedAt ? formatTimeLabel(startedAt) : null;
  const endFromDate = endedAt ? formatTimeLabel(endedAt) : null;

  if (startFromDate && endFromDate) {
    return { startLabel: startFromDate, endLabel: endFromDate };
  }

  const [rawStart, rawEnd] = id.split(/\s*--\s*|\s+-\s+/);
  return {
    startLabel: formatSegmentIdTime(rawStart) || 'Unknown',
    endLabel: formatSegmentIdTime(rawEnd) || '',
  };
}

function compareSegments(a: OmiTranscriptSegment, b: OmiTranscriptSegment): number {
  if (a.startedAt && b.startedAt) {
    return a.startedAt.localeCompare(b.startedAt);
  }
  return a.id.localeCompare(b.id);
}

function isUsableTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return normalized.length > 0 && !NON_CONTENT_TRANSCRIPTS.has(normalized);
}

function mergeJournalLinks(day: OmiTranscriptDay, journalLinks: RawJournalLinksFile | null): OmiTranscriptDay {
  return {
    ...day,
    segments: day.segments.map((segment) => ({
      ...segment,
      journalLink: normalizeJournalLink(journalLinks?.segments?.[segment.id], segment.transcriptHash),
    })),
  };
}

function normalizeJournalLink(rawLink: RawJournalLinkSegment | undefined, transcriptHash: string): OmiTranscriptJournalLink {
  if (!rawLink) {
    return emptyJournalLink(true);
  }

  const rawStatus = typeof rawLink.status === 'string' ? rawLink.status : 'unprocessed';
  const storedHash = typeof rawLink.transcriptHash === 'string' ? rawLink.transcriptHash : null;
  const stale = Boolean(storedHash && storedHash !== transcriptHash);
  let status: OmiTranscriptJournalLink['status'] = 'unprocessed';
  if (rawStatus === 'skipped' || rawStatus === 'ignored') {
    status = 'skipped';
  } else if (rawStatus === 'requested') {
    status = 'requested';
  } else if (stale) {
    status = 'stale';
  } else if (rawStatus === 'logged') {
    status = 'logged';
  }
  const eligible = rawStatus === 'requested'
    ? true
    : rawStatus === 'skipped' || rawStatus === 'ignored'
      ? false
      : rawStatus === 'logged'
        ? stale
        : rawStatus === 'unprocessed' && status === 'unprocessed';

  return {
    status,
    eligible,
    stale,
    journalRefs: normalizeJournalRefs(rawLink.journalRefs),
    proposalId: stringOrNull(rawLink.proposalId),
    runId: stringOrNull(rawLink.runId),
    skipReason: stringOrNull(rawLink.skipReason),
    updatedAt: stringOrNull(rawLink.updatedAt),
    loggedAt: stringOrNull(rawLink.loggedAt),
    skippedAt: stringOrNull(rawLink.skippedAt) ?? (rawStatus === 'ignored' ? stringOrNull(rawLink.updatedAt) : null),
    requestedAt: stringOrNull(rawLink.requestedAt),
    requestSource: stringOrNull(rawLink.requestSource),
  };
}

function normalizeJournalRefs(value: unknown): OmiTranscriptJournalRef[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== 'object' || item === null) {
      return [];
    }
    const ref = item as Record<string, unknown>;
    const date = stringOrNull(ref.date);
    const journalEntryId = stringOrNull(ref.journalEntryId);
    if (!date || !journalEntryId) {
      return [];
    }

    const normalized: OmiTranscriptJournalRef = { date, journalEntryId };
    const hour = stringOrNull(ref.hour);
    if (hour) {
      normalized.hour = hour;
    }

    const range = ref.range;
    if (typeof range === 'object' && range !== null) {
      const start = stringOrNull((range as Record<string, unknown>).start);
      const end = stringOrNull((range as Record<string, unknown>).end);
      if (start && end) {
        normalized.range = { start, end };
      }
    }

    return [normalized];
  });
}

function emptyJournalLink(eligible: boolean): OmiTranscriptJournalLink {
  return {
    status: 'unprocessed',
    eligible,
    stale: false,
    journalRefs: [],
    proposalId: null,
    runId: null,
    skipReason: null,
    updatedAt: null,
    loggedAt: null,
    skippedAt: null,
    requestedAt: null,
    requestSource: null,
  };
}

function hashTranscript(transcript: string): string {
  return createHash('sha256').update(transcript.trim().split(/\s+/).join(' ')).digest('hex');
}

function emptyTranscriptDay(date: string, exists: boolean): OmiTranscriptDay {
  return {
    date,
    segments: [],
    batches: [],
    omittedSegmentCount: 0,
    status: {
      exists,
      segmentCount: 0,
      transcriptCharCount: 0,
      audioChunkCount: 0,
      queueChunkCount: 0,
      completedBatchCount: 0,
      failedBatchCount: 0,
      pendingBatchCount: 0,
      runningBatchCount: 0,
      missingChunkCount: 0,
      recoverableBatchCount: 0,
    },
  };
}

function mergeTranscriptStatus(
  day: OmiTranscriptDay,
  statusFile: RawStatusFile | null,
  manifestEntries: RawManifestEntry[],
  queueFile: RawQueueFile | null
): OmiTranscriptDay {
  const statusSegments = Object.entries(statusFile?.segments ?? {});
  const batches = statusSegments
    .map(([id, segment]) => normalizeStatusBatch(id, segment))
    .sort(compareBatches);
  const knownChunkIds = new Set<string>();

  for (const [_id, segment] of statusSegments) {
    for (const chunkId of normalizeChunkIds(segment.chunkIds)) {
      knownChunkIds.add(chunkId);
    }
  }

  const missingChunkCount = manifestEntries.reduce((total, entry) => {
    const chunkId = typeof entry.chunkId === 'string' ? entry.chunkId : null;
    return chunkId && !knownChunkIds.has(chunkId) && !isManifestEntryCoveredByStatus(entry, statusSegments)
      ? total + 1
      : total;
  }, 0);
  const recoverableBatchCount =
    batches.filter((batch) => batch.recoverable).length + (missingChunkCount > 0 ? 1 : 0);

  return {
    ...day,
    batches,
    status: {
      ...day.status,
      exists: day.status.exists || Boolean(statusFile) || manifestEntries.length > 0,
      audioChunkCount: manifestEntries.length,
      queueChunkCount: Array.isArray(queueFile?.chunks) ? queueFile.chunks.length : 0,
      completedBatchCount: batches.filter((batch) => batch.status === 'completed').length,
      failedBatchCount: batches.filter((batch) => batch.status === 'failed').length,
      pendingBatchCount: batches.filter((batch) => batch.status === 'pending').length,
      runningBatchCount: batches.filter((batch) => batch.status === 'running').length,
      missingChunkCount,
      recoverableBatchCount,
      ...(typeof statusFile?.updatedAt === 'string' ? { statusUpdatedAt: statusFile.updatedAt } : {}),
      ...(typeof queueFile?.updatedAt === 'string' ? { queueUpdatedAt: queueFile.updatedAt } : {}),
    },
  };
}

function normalizeStatusBatch(id: string, segment: RawStatusSegment): OmiTranscriptBatch {
  const status = normalizeBatchStatus(segment.status);
  const startedAt = stringOrNull(segment.sourceStartedAt) ?? stringOrNull(segment.startedAt);
  const endedAt = stringOrNull(segment.sourceEndedAt) ?? stringOrNull(segment.endedAt);
  const labels = labelsForSegment(id, startedAt, endedAt);
  const retryAfter = stringOrNull(segment.retryAfter);

  return {
    id,
    status,
    startedAt,
    endedAt,
    startLabel: labels.startLabel,
    endLabel: labels.endLabel,
    durationSeconds: numberOrNull(segment.durationSeconds),
    chunkCount: numberOrZero(segment.chunkCount),
    transcriptChars: numberOrNull(segment.transcriptChars),
    completedAt: stringOrNull(segment.completedAt),
    failedAt: stringOrNull(segment.failedAt),
    retryAfter,
    retryCount: numberOrZero(segment.retryCount),
    lastRetryRequestedAt: stringOrNull(segment.lastRetryRequestedAt),
    recoverable: status === 'failed' && (!retryAfter || new Date(retryAfter).getTime() <= Date.now()),
    error: compactError(stringOrNull(segment.error)),
  };
}

function normalizeBatchStatus(value: unknown): OmiTranscriptBatchStatus {
  return value === 'completed' || value === 'failed' || value === 'pending' || value === 'running'
    ? value
    : 'missing';
}

function compareBatches(a: OmiTranscriptBatch, b: OmiTranscriptBatch): number {
  if (a.startedAt && b.startedAt) {
    return a.startedAt.localeCompare(b.startedAt);
  }
  return a.id.localeCompare(b.id);
}

function readStatusFile(date: string): RawStatusFile | null {
  return readJsonFile(path.join(TRANSCRIPT_DIR, `${date}.status.json`));
}

function readManifestEntries(date: string): RawManifestEntry[] {
  const manifestPath = path.join(AUDIO_DIR, date, 'manifest.jsonl');
  if (!fs.existsSync(manifestPath)) {
    return [];
  }

  return fs
    .readFileSync(manifestPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as RawManifestEntry];
      } catch {
        return [];
      }
    });
}

function readQueueFile(date: string): RawQueueFile | null {
  return readJsonFile(path.join(QUEUE_DIR, `${date}.json`));
}

function readJournalLinksFile(date: string): RawJournalLinksFile | null {
  return readJsonFile(path.join(JOURNAL_LINK_DIR, `${date}.json`));
}

function readJsonFile<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function normalizeChunkIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function isManifestEntryCoveredByStatus(
  entry: RawManifestEntry,
  statusSegments: Array<[string, RawStatusSegment]>
): boolean {
  const receivedAt = stringOrNull(entry.receivedAt);
  if (!receivedAt) {
    return false;
  }

  const receivedAtMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(receivedAtMs)) {
    return false;
  }

  return statusSegments.some(([_id, segment]) => {
    const startedAt = stringOrNull(segment.sourceStartedAt) ?? stringOrNull(segment.startedAt);
    const endedAt = stringOrNull(segment.sourceEndedAt) ?? stringOrNull(segment.endedAt);
    if (!startedAt || !endedAt) {
      return false;
    }

    const startedAtMs = new Date(startedAt).getTime();
    const endedAtMs = new Date(endedAt).getTime();
    return Number.isFinite(startedAtMs) && Number.isFinite(endedAtMs) && receivedAtMs >= startedAtMs && receivedAtMs <= endedAtMs;
  });
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function compactError(error: string | null): string | null {
  if (!error) {
    return null;
  }

  const objectMatch = error.match(/\{"code":\d+,"message":"([^"]+)"/);
  const message = objectMatch?.[1] ?? error;
  return message.length > 220 ? `${message.slice(0, 217)}...` : message;
}

function getWeekDates(offset: number): string[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday + offset * 7);

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(monday);
    date.setDate(monday.getDate() + index);
    return toISODate(date);
  });
}

function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isValidDate(value: string): boolean {
  return DATE_REGEX.test(value);
}

function formatTimeLabel(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString('en-US', {
    timeZone: getConfiguredTimezone(),
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

function getConfiguredTimezone(): string {
  const timezone = process.env.OMI_AUDIO_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

function formatSegmentIdTime(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const parts = value.trim().match(/^(\d{1,2})-(\d{2})(?:-\d{2})?$/);
  if (!parts) {
    return value.trim() || null;
  }

  return `${parts[1].padStart(2, '0')}:${parts[2]}`;
}

function parseMarkdownDuration(sourceLine: string): number | null {
  const minutesMatch = sourceLine.match(/(\d+(?:\.\d+)?)m/);
  const secondsMatch = sourceLine.match(/(\d+(?:\.\d+)?)s/);
  const minutes = minutesMatch ? Number(minutesMatch[1]) : 0;
  const seconds = secondsMatch ? Number(secondsMatch[1]) : 0;
  const total = minutes * 60 + seconds;
  return total > 0 ? total : null;
}
