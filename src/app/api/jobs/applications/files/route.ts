import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  JOB_APPLICATION_FILE_EXTENSIONS,
  JOB_APPLICATION_FILE_MAX_BYTES,
  buildFileAnswer,
  getApplicationFilePath,
  readJobApplicationsStore,
  sanitizeUploadFileName,
  validateUploadBytes,
} from '../../application-store-utils';

export const runtime = 'nodejs';

// User-side upload for kind:"file" questions. No lease: the user (not the
// worker) uploads, at the same trust level as the answers route. The returned
// reference becomes the question's answer through the normal save flow.
export async function POST(request: NextRequest) {
  let temporaryPath: string | null = null;
  let writtenPath: string | null = null;
  try {
    const contentLength = Number(request.headers.get('content-length') ?? 0);
    if (contentLength > JOB_APPLICATION_FILE_MAX_BYTES + 1024 * 1024) {
      return NextResponse.json({ success: false, error: 'File is too large' }, { status: 413 });
    }

    const formData = await request.formData();
    const listingId = formData.get('listingId');
    const questionId = formData.get('questionId');
    const file = formData.get('file');

    if (typeof listingId !== 'string' || typeof questionId !== 'string' || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: 'listingId, questionId, and file are required' },
        { status: 400 },
      );
    }

    const store = readJobApplicationsStore();
    const application = store.applications[listingId];
    if (!application) {
      return NextResponse.json({ success: false, error: 'Application not found' }, { status: 404 });
    }
    const question = application.questions.find((candidate) => candidate.id === questionId);
    if (!question || question.kind !== 'file' || question.resolution !== 'pending') {
      return NextResponse.json(
        { success: false, error: 'Question is not a pending file question' },
        { status: 400 },
      );
    }

    const fileName = sanitizeUploadFileName(file.name);
    const extension = path.extname(fileName).toLowerCase();
    if (!JOB_APPLICATION_FILE_EXTENSIONS[extension]) {
      return NextResponse.json(
        {
          success: false,
          error: `Unsupported file type — use ${Object.keys(JOB_APPLICATION_FILE_EXTENSIONS).join(', ')}`,
        },
        { status: 400 },
      );
    }
    if (file.size > JOB_APPLICATION_FILE_MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'File is too large (max 25 MB)' }, { status: 413 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (!validateUploadBytes(fileName, bytes)) {
      return NextResponse.json(
        { success: false, error: 'File contents do not match its extension' },
        { status: 400 },
      );
    }

    const uploadId = randomUUID();
    const filePath = getApplicationFilePath(uploadId, fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, bytes, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    writtenPath = filePath;
    temporaryPath = null;

    return NextResponse.json({
      success: true,
      reference: buildFileAnswer(uploadId, fileName),
      fileName,
      byteSize: bytes.length,
    });
  } catch (error) {
    for (const cleanupPath of [temporaryPath, writtenPath]) {
      if (cleanupPath) {
        try {
          fs.unlinkSync(cleanupPath);
        } catch {
          // best effort
        }
      }
    }
    console.error('Error uploading application file:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
