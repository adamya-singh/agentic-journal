import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  createApplicationScreenshotId,
  deleteQuestionScreenshotFile,
  getPngDimensions,
  getQuestionScreenshotFilePath,
  isPng,
  JOB_APPLICATION_QUESTION_SCREENSHOT_MAX_BYTES,
  JOB_APPLICATION_QUESTION_SCREENSHOT_MAX_WIDTH_PX,
  JOB_APPLICATION_QUESTION_SCREENSHOT_MIN_WIDTH_PX,
  JOB_APPLICATION_SCREENSHOT_MAX_HEIGHT_PX,
  mutateJobApplicationsStore,
  requireApplicationLease,
} from '../../application-store-utils';

export const runtime = 'nodejs';

const MetadataSchema = z.object({
  listingId: z.string().min(1),
  leaseToken: z.string().min(1),
  questionId: z.string().min(1),
});

/**
 * Element screenshot of one question with its answer entered on the live form,
 * shown next to that answer in the review queue. Best-effort evidence: it never
 * gates answers, the review hold, or submission. Re-uploading replaces it.
 */
export async function POST(request: NextRequest) {
  let temporaryPath: string | undefined;
  let writtenPath: string | undefined;
  try {
    const contentLength = Number(request.headers.get('content-length'));
    if (
      Number.isFinite(contentLength) &&
      contentLength > JOB_APPLICATION_QUESTION_SCREENSHOT_MAX_BYTES + 1024 * 1024
    ) {
      return NextResponse.json(
        { success: false, error: 'Question screenshot upload is too large' },
        { status: 413 },
      );
    }
    const formData = await request.formData();
    const parsed = MetadataSchema.safeParse({
      listingId: formData.get('listingId'),
      leaseToken: formData.get('leaseToken'),
      questionId: formData.get('questionId'),
    });
    const image = formData.get('image');
    if (!parsed.success || !(image instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: parsed.success
            ? 'A PNG image file is required'
            : (parsed.error.errors[0]?.message ?? 'Invalid question screenshot metadata'),
        },
        { status: 400 },
      );
    }
    if (image.type !== 'image/png' || image.size > JOB_APPLICATION_QUESTION_SCREENSHOT_MAX_BYTES) {
      return NextResponse.json(
        { success: false, error: 'Question screenshot must be a PNG no larger than 5 MB' },
        { status: 413 },
      );
    }
    const bytes = Buffer.from(await image.arrayBuffer());
    if (!isPng(bytes)) {
      return NextResponse.json(
        { success: false, error: 'Question screenshot does not contain a valid PNG image' },
        { status: 400 },
      );
    }
    const { width, height } = getPngDimensions(bytes);
    if (
      height > JOB_APPLICATION_SCREENSHOT_MAX_HEIGHT_PX ||
      width > JOB_APPLICATION_QUESTION_SCREENSHOT_MAX_WIDTH_PX ||
      width < JOB_APPLICATION_QUESTION_SCREENSHOT_MIN_WIDTH_PX
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Question screenshot is ${width}x${height}px — capture only the question's own container (${JOB_APPLICATION_QUESTION_SCREENSHOT_MIN_WIDTH_PX}-${JOB_APPLICATION_QUESTION_SCREENSHOT_MAX_WIDTH_PX}px wide, at most ${JOB_APPLICATION_SCREENSHOT_MAX_HEIGHT_PX}px tall)`,
        },
        { status: 413 },
      );
    }

    const result = await mutateJobApplicationsStore((store) => {
      const application = requireApplicationLease(
        store.applications[parsed.data.listingId],
        parsed.data.leaseToken,
      );
      const question = application.questions.find(
        (candidate) => candidate.id === parsed.data.questionId,
      );
      if (!question) {
        throw new Error(`Question not found: ${parsed.data.questionId}`);
      }
      if (question.kind === 'file' || question.kind === 'action') {
        throw new Error(`Question has no form answer to screenshot: ${question.prompt}`);
      }

      const now = new Date().toISOString();
      const id = createApplicationScreenshotId();
      const filePath = getQuestionScreenshotFilePath(id);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, bytes, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      temporaryPath = undefined;
      writtenPath = filePath;
      const supersededId = question.answerScreenshot?.id;
      question.answerScreenshot = {
        id,
        attemptCount: application.attemptCount,
        capturedAt: now,
        width,
        height,
        byteSize: bytes.length,
      };
      application.updatedAt = now;
      return { screenshot: question.answerScreenshot, supersededId };
    });

    deleteQuestionScreenshotFile(result.supersededId);
    return NextResponse.json({ success: true, screenshot: result.screenshot }, { status: 201 });
  } catch (error) {
    if (temporaryPath) fs.rmSync(temporaryPath, { force: true });
    if (writtenPath) fs.rmSync(writtenPath, { force: true });
    const message = error instanceof Error ? error.message : 'Failed to upload question screenshot';
    const status = /lease|not found|no form answer/i.test(message) ? 409 : 500;
    console.error('Error uploading job application question screenshot:', error);
    return NextResponse.json({ success: false, error: message }, { status });
  }
}
