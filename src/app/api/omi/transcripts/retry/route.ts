import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TRANSCRIPT_DIR = path.join(process.cwd(), 'src/backend/data/omi-transcripts');

type RetryRequest = {
  date?: unknown;
  batchIds?: unknown;
};

type StatusFile = {
  date: string;
  createdAt?: string;
  updatedAt: string;
  segments: Record<string, StatusSegment>;
};

type StatusSegment = {
  id?: string;
  status?: string;
  retryCount?: number;
  lastRetryRequestedAt?: string;
  retryAfter?: string | null;
  operationName?: string | null;
  gcsUri?: string | null;
  uploadedAt?: string | null;
  failedAt?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  try {
    const payload = (await request.json()) as RetryRequest;
    const date = typeof payload.date === 'string' ? payload.date.trim() : '';

    if (!DATE_REGEX.test(date)) {
      return NextResponse.json(
        { success: false, error: 'date must use YYYY-MM-DD format' },
        { status: 400 }
      );
    }

    const batchIds = Array.isArray(payload.batchIds)
      ? payload.batchIds.filter((value): value is string => typeof value === 'string' && value.length > 0)
      : null;
    const statusPath = path.join(TRANSCRIPT_DIR, `${date}.status.json`);

    if (!fs.existsSync(statusPath)) {
      return NextResponse.json(
        { success: false, error: 'No transcript status exists for this date' },
        { status: 404 }
      );
    }

    const statusFile = readStatusFile(statusPath, date);
    const targets = batchIds ?? Object.entries(statusFile.segments)
      .filter(([_id, segment]) => segment.status === 'failed')
      .map(([id]) => id);

    if (targets.length === 0) {
      return NextResponse.json({
        success: true,
        date,
        updatedBatchIds: [],
        message: 'No failed transcript batches need retry',
      });
    }

    const missingTargets = targets.filter((id) => !statusFile.segments[id]);
    if (missingTargets.length > 0) {
      return NextResponse.json(
        { success: false, error: `Unknown batch id: ${missingTargets[0]}` },
        { status: 404 }
      );
    }

    const retryRequestedAt = new Date().toISOString();
    const updatedBatchIds: string[] = [];

    for (const id of targets) {
      const segment = statusFile.segments[id];
      if (segment.status === 'completed') {
        continue;
      }

      statusFile.segments[id] = {
        ...segment,
        status: 'pending',
        retryAfter: null,
        operationName: null,
        gcsUri: null,
        uploadedAt: null,
        failedAt: null,
        error: null,
        lastRetryRequestedAt: retryRequestedAt,
      };
      updatedBatchIds.push(id);
    }

    statusFile.updatedAt = retryRequestedAt;
    writeJsonAtomically(statusPath, statusFile);

    return NextResponse.json({
      success: true,
      date,
      updatedBatchIds,
      message: updatedBatchIds.length > 0
        ? 'Transcript batches marked for worker retry'
        : 'No retryable transcript batches were updated',
    });
  } catch (error) {
    console.error('Error marking Omi transcript retry:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function readStatusFile(statusPath: string, date: string): StatusFile {
  const parsed = JSON.parse(fs.readFileSync(statusPath, 'utf-8')) as Partial<StatusFile>;
  return {
    date,
    createdAt: parsed.createdAt,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    segments: parsed.segments && typeof parsed.segments === 'object' ? parsed.segments : {},
  };
}

function writeJsonAtomically(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  fs.renameSync(tempPath, filePath);
}
