import fs from 'fs';
import { Readable } from 'stream';
import { NextRequest, NextResponse } from 'next/server';
import { fromThisApp } from '@/lib/same-origin';
import { fileKind, fileName, fileType, PAGE_WIDTHS, pageWidth } from '@/lib/task-files';
import { fileBlockOf, fileMeta, findWorkspaceFile, pdfFacts, pdfPage } from './store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The real files of a task's work, for its workspace: a `file` block of the task names a file inside OpenClaw's
// workspace folder, and this shows it as it is. A path is never taken from the request: only a task and one of its
// blocks. Only this app's own pages may ask (another site's page could otherwise read his files through his browser).

const fail = (status: number, error: string) => NextResponse.json({ success: false, error }, { status, headers: { 'Cache-Control': 'no-store' } });
const stream = (file: string) => Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream<Uint8Array>;

/**
 * GET /api/tasks/files?id=<taskId>&block=<blockId>                what the file is now: { name, folder, kind, size, mtime, pages, ratio }
 * GET /api/tasks/files?id=<taskId>&block=<blockId>&page=N&w=W     page N of a PDF as a PNG, W one of 320 | 1600 | 2400
 * GET /api/tasks/files?id=<taskId>&block=<blockId>&raw=1[&dl=1]   the file itself (dl: as a download)
 */
export async function GET(request: NextRequest) {
  if (!fromThisApp(request.headers)) return fail(403, 'Only the Journal’s own pages may read a task’s files.');
  const params = request.nextUrl.searchParams;
  const id = params.get('id');
  const blockId = params.get('block');
  if (!id || !blockId) return fail(400, 'Missing id or block.');
  try {
    const block = fileBlockOf(id, blockId);
    if (!block) return fail(404, 'This task has no file block with that id.');
    const file = findWorkspaceFile(block.path);
    if (!file) return fail(404, `The file is not in OpenClaw’s workspace folder any more: ${block.path}`);

    if (params.has('page')) {
      const page = Number(params.get('page'));
      const asked = Number(params.get('w'));
      const pdf = fileKind(file.rel) === 'pdf' ? await pdfFacts(file) : null;
      if (!pdf) return fail(415, 'This file has no pages that can be drawn.');
      if (!Number.isInteger(page) || page < 1 || page > pdf.pages) return fail(400, `The file has ${pdf.pages} page${pdf.pages === 1 ? '' : 's'}.`);
      const image = await pdfPage(file, page, pageWidth(Number.isFinite(asked) && asked > 0 ? asked : PAGE_WIDTHS[1]));
      if (!image) return fail(500, 'The page could not be drawn.');
      return new NextResponse(stream(image), {
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(fs.statSync(image).size),
          // The address carries the file's version (v), so a page drawn once is good for as long as it is asked for.
          'Cache-Control': params.has('v') ? 'private, max-age=31536000, immutable' : 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    }

    if (params.has('raw')) {
      const kind = fileKind(file.rel);
      const inline = kind !== 'other' && !params.has('dl');
      return new NextResponse(stream(file.abs), {
        headers: {
          'Content-Type': fileType(file.rel),
          'Content-Length': String(file.size),
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(fileName(file.rel))}`,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
          // Whatever the file holds, it runs nothing in this app's name. (A PDF is left to the browser's own viewer,
          // which will not open inside a sandbox.)
          ...(kind === 'pdf' ? {} : { 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'" }),
        },
      });
    }

    return NextResponse.json({ success: true, data: await fileMeta(file) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('task files: could not read:', error);
    return fail(500, 'The file could not be read.');
  }
}
