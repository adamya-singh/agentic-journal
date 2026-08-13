import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import {
  JOB_APPLICATION_FILE_EXTENSIONS,
  getApplicationFilePath,
} from '../../../../application-store-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INLINE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ uploadId: string; fileName: string }> },
) {
  try {
    const { uploadId, fileName } = await context.params;
    let filePath: string;
    try {
      filePath = getApplicationFilePath(uploadId, fileName);
    } catch {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }

    const contentType =
      JOB_APPLICATION_FILE_EXTENSIONS[path.extname(fileName).toLowerCase()] ??
      'application/octet-stream';
    const disposition = INLINE_TYPES.has(contentType) ? 'inline' : 'attachment';

    // fileName already matches the safe charset (getApplicationFilePath guard),
    // so it is header-safe as-is.
    return new NextResponse(fs.readFileSync(filePath), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fs.statSync(filePath).size),
        'Cache-Control': 'private, no-store, max-age=0',
        'Content-Disposition': `${disposition}; filename="${fileName}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error serving application file:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
