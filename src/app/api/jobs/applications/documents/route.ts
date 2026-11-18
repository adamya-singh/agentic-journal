import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  JOB_APPLICATION_FILE_MAX_BYTES,
  buildFileAnswer,
  getApplicationFilePath,
  isPdf,
  mutateJobApplicationsStore,
  readJobApplicationsStore,
  releaseApplicationsAnsweredByBank,
  sanitizeUploadFileName,
} from '../../application-store-utils';
import { wakeJobApplicationWorkerIfEnabled } from '../../application-worker-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json({ success: true, documents: readJobApplicationsStore().documents });
  } catch (error) {
    console.error('Error reading application documents:', error);
    return NextResponse.json({ success: false, error: 'Failed to read documents' }, { status: 500 });
  }
}

/**
 * Saves (or replaces) a standing document. Every application already waiting on that upload is
 * answered with it and goes back to the worker; later ones never stop for it.
 */
export async function POST(request: NextRequest) {
  let writtenPath: string | null = null;
  try {
    const formData = await request.formData();
    const kind = formData.get('kind');
    const file = formData.get('file');
    if (kind !== 'transcript' || !(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'kind must be transcript, with a file' }, { status: 400 });
    }
    if (file.size > JOB_APPLICATION_FILE_MAX_BYTES) {
      return NextResponse.json({ success: false, error: 'File is too large (max 25 MB)' }, { status: 413 });
    }
    const fileName = sanitizeUploadFileName(file.name);
    const bytes = Buffer.from(await file.arrayBuffer());
    if (path.extname(fileName).toLowerCase() !== '.pdf' || !isPdf(bytes)) {
      return NextResponse.json({ success: false, error: 'The transcript must be a PDF' }, { status: 400 });
    }

    const uploadId = randomUUID();
    const filePath = getApplicationFilePath(uploadId, fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, bytes, { mode: 0o600 });
    fs.renameSync(temporaryPath, filePath);
    writtenPath = filePath;

    const now = new Date().toISOString();
    const result = await mutateJobApplicationsStore((store) => {
      store.documents.transcript = { answer: buildFileAnswer(uploadId, fileName), fileName, savedAt: now };
      return { documents: store.documents, released: releaseApplicationsAnsweredByBank(store, now) };
    });
    if (result.released.length > 0) {
      await wakeJobApplicationWorkerIfEnabled().catch((error) => console.error('Worker wake after document save failed:', error));
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (writtenPath) fs.rmSync(path.dirname(writtenPath), { recursive: true, force: true });
    console.error('Error saving application document:', error);
    return NextResponse.json({ success: false, error: 'Failed to save the document' }, { status: 500 });
  }
}
