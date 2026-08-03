import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createApplicationScreenshotId,
  getApplicationScreenshotFilePath,
  isPng,
  JOB_APPLICATION_SCREENSHOT_MAX_BYTES,
  mutateJobApplicationsStore,
  requireApplicationLease,
} from '../../application-store-utils';

export const runtime = 'nodejs';

const MetadataSchema = z.object({
  listingId: z.string().min(1),
  leaseToken: z.string().min(1),
  captureId: z.string().uuid(),
  pageNumber: z.coerce.number().int().positive(),
  segmentNumber: z.coerce.number().int().positive(),
  label: z.string().trim().min(1).max(200),
  pageUrl: z.union([z.string().url(), z.literal('')]).optional(),
});

export async function POST(request: NextRequest) {
  let temporaryPath: string | undefined;
  let writtenPath: string | undefined;
  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength > JOB_APPLICATION_SCREENSHOT_MAX_BYTES + 1024 * 1024
    ) {
      return NextResponse.json(
        { success: false, error: 'Screenshot upload is too large' },
        { status: 413 },
      );
    }
    const formData = await request.formData();
    const parsed = MetadataSchema.safeParse({
      listingId: formData.get('listingId'),
      leaseToken: formData.get('leaseToken'),
      captureId: formData.get('captureId'),
      pageNumber: formData.get('pageNumber'),
      segmentNumber: formData.get('segmentNumber'),
      label: formData.get('label'),
      pageUrl: formData.get('pageUrl') ?? undefined,
    });
    const image = formData.get('image');
    if (!parsed.success || !(image instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.success
            ? 'A PNG image file is required'
            : (parsed.error.errors[0]?.message ?? 'Invalid screenshot metadata'),
        },
        { status: 400 },
      );
    }
    if (image.type !== 'image/png' || image.size > JOB_APPLICATION_SCREENSHOT_MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Screenshot must be a PNG no larger than 25 MB' },
        { status: 413 },
      );
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!isPng(bytes)) {
      return NextResponse.json(
        { success: false, error: 'Screenshot does not contain a valid PNG image' },
        { status: 400 },
      );
    }

    const screenshot = await mutateJobApplicationsStore((store) => {
      const application = requireApplicationLease(
        store.applications[parsed.data.listingId],
        parsed.data.leaseToken,
      );
      const capture = application.incompleteScreenshotCapture;
      if (!capture || capture.id !== parsed.data.captureId) {
        throw new Error('Screenshot capture is missing or no longer current');
      }
      if (capture.attemptCount !== application.attemptCount) {
        throw new Error('Screenshot capture belongs to a stale application attempt');
      }
      if (
        capture.screenshots.some(
          (candidate) =>
            candidate.pageNumber === parsed.data.pageNumber &&
            candidate.segmentNumber === parsed.data.segmentNumber,
        )
      ) {
        throw new Error('Screenshot page and segment ordering must be unique');
      }

      const now = new Date().toISOString();
      const id = createApplicationScreenshotId();
      const filePath = getApplicationScreenshotFilePath(capture.id, id);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, bytes, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      temporaryPath = undefined;
      writtenPath = filePath;
      const item = {
        id,
        pageNumber: parsed.data.pageNumber,
        segmentNumber: parsed.data.segmentNumber,
        label: parsed.data.label,
        ...(parsed.data.pageUrl ? { pageUrl: parsed.data.pageUrl } : {}),
        capturedAt: now,
        contentType: 'image/png' as const,
        byteSize: bytes.length,
      };
      capture.screenshots.push(item);
      application.updatedAt = now;
      return item;
    });

    return NextResponse.json({ success: true, screenshot }, { status: 201 });
  } catch (error) {
    if (temporaryPath) fs.rmSync(temporaryPath, { force: true });
    if (writtenPath) fs.rmSync(writtenPath, { force: true });
    const message = error instanceof Error ? error.message : 'Failed to upload screenshot';
    const status = /lease|capture|stale|ordering/i.test(message) ? 409 : 500;
    console.error('Error uploading job application screenshot:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
