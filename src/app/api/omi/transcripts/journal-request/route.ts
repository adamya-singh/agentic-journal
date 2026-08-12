import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  findOpenClawCronJob,
  isOpenClawCliAvailable,
  parseJsonObjectOutput,
  runOpenClawCli,
} from '@/lib/openclaw-cron';

export const runtime = 'nodejs';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TRANSCRIPT_DIR = path.join(process.cwd(), 'src/backend/data/omi-transcripts');
const JOURNAL_LINK_DIR = path.join(process.cwd(), 'src/backend/data/omi-journal-links');
const OPENCLAW_CRON_JOB_NAME = 'Omi Transcript Journal Ingestion';
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

type RawTranscriptFile = {
  segments?: unknown[];
};

type RawTranscriptSegment = {
  id?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
  completedAt?: unknown;
  transcript?: unknown;
};

type OmiSegment = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  completedAt: string | null;
  transcript: string;
  transcriptHash: string;
};

type RawJournalLinksFile = {
  schemaVersion?: unknown;
  date?: unknown;
  segments?: Record<string, RawJournalLinkSegment>;
};

type RawJournalLinkSegment = {
  status?: unknown;
  transcriptHash?: unknown;
  requestSource?: unknown;
  requestedAt?: unknown;
  updatedAt?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { date?: unknown; segmentId?: unknown };
    const date = typeof body.date === 'string' ? body.date : '';
    const segmentId = typeof body.segmentId === 'string' ? body.segmentId : '';

    if (!DATE_REGEX.test(date)) {
      return NextResponse.json({ success: false, error: 'date must use YYYY-MM-DD format' }, { status: 400 });
    }
    if (!segmentId.trim()) {
      return NextResponse.json({ success: false, error: 'segmentId is required' }, { status: 400 });
    }

    const segment = readSegment(date, segmentId);
    if (!segment) {
      return NextResponse.json({ success: false, error: 'Omi transcript segment not found' }, { status: 404 });
    }
    if (!isUsableTranscript(segment.transcript)) {
      return NextResponse.json({ success: false, error: 'Omi transcript segment is not content' }, { status: 400 });
    }
    if (!segment.completedAt) {
      return NextResponse.json({ success: false, error: 'Omi transcript segment is not completed' }, { status: 400 });
    }

    const ledgerPath = path.join(JOURNAL_LINK_DIR, `${date}.json`);
    const ledger = readLedger(date);
    const existing = ledger.segments?.[segmentId];
    if (existing?.status === 'logged') {
      return NextResponse.json({ success: false, error: 'Omi transcript segment is already logged' }, { status: 409 });
    }

    const nowIso = new Date().toISOString();
    const alreadyRequested =
      existing?.status === 'requested' &&
      existing.transcriptHash === segment.transcriptHash;

    if (!alreadyRequested) {
      ledger.segments = ledger.segments ?? {};
      ledger.segments[segmentId] = {
        status: 'requested',
        transcriptHash: segment.transcriptHash,
        requestSource: 'transcripts-page',
        requestedAt: nowIso,
        updatedAt: nowIso,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      };
      writeJsonAtomically(ledgerPath, ledger);
    }

    const queue = await queueOmiIngestionCron();

    return NextResponse.json({
      success: true,
      date,
      segmentId,
      status: 'requested',
      alreadyRequested,
      cronQueued: queue.queued,
      cronRunId: queue.runId,
      cronQueueError: queue.error,
    });
  } catch (error) {
    console.error('Error requesting Omi journal ingestion:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function readSegment(date: string, segmentId: string): OmiSegment | null {
  const rawPath = path.join(TRANSCRIPT_DIR, `${date}.raw.json`);
  if (!fs.existsSync(rawPath)) {
    return null;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8')) as RawTranscriptFile;
    const segments = Array.isArray(raw.segments) ? raw.segments : [];
    for (const item of segments) {
      const segment = normalizeRawSegment(item);
      if (segment?.id === segmentId) {
        return segment;
      }
    }
  } catch {
    return null;
  }

  return null;
}

function normalizeRawSegment(raw: unknown): OmiSegment | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const segment = raw as RawTranscriptSegment;
  if (typeof segment.id !== 'string' || typeof segment.transcript !== 'string') {
    return null;
  }

  const transcript = segment.transcript.trim();
  return {
    id: segment.id,
    startedAt: typeof segment.startedAt === 'string' ? segment.startedAt : null,
    endedAt: typeof segment.endedAt === 'string' ? segment.endedAt : null,
    completedAt: typeof segment.completedAt === 'string' ? segment.completedAt : null,
    transcript,
    transcriptHash: hashTranscript(transcript),
  };
}

function readLedger(date: string): Required<Pick<RawJournalLinksFile, 'segments'>> & RawJournalLinksFile {
  const filePath = path.join(JOURNAL_LINK_DIR, `${date}.json`);
  if (!fs.existsSync(filePath)) {
    return { schemaVersion: 1, date, segments: {} };
  }

  try {
    const ledger = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RawJournalLinksFile;
    return {
      ...ledger,
      schemaVersion: typeof ledger.schemaVersion === 'number' ? ledger.schemaVersion : 1,
      date,
      segments: ledger.segments && typeof ledger.segments === 'object' ? ledger.segments : {},
    };
  } catch {
    return { schemaVersion: 1, date, segments: {} };
  }
}

function isUsableTranscript(transcript: string): boolean {
  const normalized = transcript.trim().toLowerCase();
  return normalized.length > 0 && !NON_CONTENT_TRANSCRIPTS.has(normalized);
}

function hashTranscript(transcript: string): string {
  return createHash('sha256').update(transcript.trim().split(/\s+/).join(' ')).digest('hex');
}

function writeJsonAtomically(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

async function queueOmiIngestionCron(): Promise<{ queued: boolean; runId?: string; error?: string }> {
  try {
    if (!isOpenClawCliAvailable()) {
      return { queued: false, error: 'OpenClaw CLI not found' };
    }
    const job = await findOpenClawCronJob({
      jobId: process.env.OPENCLAW_OMI_INGEST_CRON_ID,
      jobName: OPENCLAW_CRON_JOB_NAME,
      timeoutMs: 30_000,
    });
    if (!job) {
      return { queued: false, error: 'OpenClaw Omi ingestion cron job not found' };
    }
    if (!job.enabled) {
      return { queued: false, error: 'OpenClaw Omi ingestion cron job is disabled' };
    }

    // Note: `cron run` takes no --json flag in current OpenClaw; runId is
    // best-effort parsed from whatever the CLI prints.
    const stdout = await runOpenClawCli(['cron', 'run', job.id], 30_000);
    const parsed = parseJsonObjectOutput(stdout);
    const runId = typeof parsed?.runId === 'string' ? parsed.runId : undefined;
    return { queued: true, runId };
  } catch (error) {
    return {
      queued: false,
      error: error instanceof Error ? error.message : 'Unable to queue OpenClaw cron job',
    };
  }
}
