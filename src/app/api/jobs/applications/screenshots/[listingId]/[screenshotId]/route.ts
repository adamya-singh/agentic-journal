import * as fs from 'fs';
import { NextResponse } from 'next/server';
import {
  getApplicationScreenshotFilePath,
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
    const captures = [application?.screenshotCapture, application?.incompleteScreenshotCapture];
    const capture = captures.find((candidate) =>
      candidate?.screenshots.some((screenshot) => screenshot.id === screenshotId),
    );
    if (!capture) {
      return NextResponse.json({ success: false, error: 'Screenshot not found' }, { status: 404 });
    }
    const filePath = getApplicationScreenshotFilePath(capture.id, screenshotId);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ success: false, error: 'Screenshot not found' }, { status: 404 });
    }
    return new NextResponse(fs.readFileSync(filePath), {
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(fs.statSync(filePath).size),
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': `inline; filename="application-${screenshotId}.png"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error reading job application screenshot:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to read screenshot' },
      { status: 500 },
    );
  }
}
