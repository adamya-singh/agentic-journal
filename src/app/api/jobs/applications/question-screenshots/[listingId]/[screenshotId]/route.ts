import * as fs from 'fs';
import { NextResponse } from 'next/server';
import {
  getQuestionScreenshotFilePath,
  readJobApplicationsStore,
} from '../../../../application-store-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ listingId: string; screenshotId: string }> },
) {
  try {
    const { listingId, screenshotId } = await context.params;
    const application = readJobApplicationsStore().applications[listingId];
    const owned = application?.questions.some(
      (question) => question.answerScreenshot?.id === screenshotId,
    );
    if (!owned) {
      return NextResponse.json({ success: false, error: 'Screenshot not found' }, { status: 404 });
    }
    const filePath = getQuestionScreenshotFilePath(screenshotId);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ success: false, error: 'Screenshot not found' }, { status: 404 });
    }
    const bytes = fs.readFileSync(filePath);
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(bytes.length),
        // Every upload gets a fresh id, so the bytes behind a URL never change.
        'Cache-Control': 'private, max-age=31536000, immutable',
        'Content-Disposition': `inline; filename="question-${screenshotId}.png"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error reading job application question screenshot:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read screenshot' },
      { status: 500 },
    );
  }
}
