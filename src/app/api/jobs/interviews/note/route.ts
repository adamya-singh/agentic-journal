import fs from 'fs';
import path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { processDir, readInterviews, readNoteBody } from '@/lib/interviews/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?process=<id|listing:ID>&note=<id> → { body }; add &raw=1 for an attached file (the offer letter PDF). */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const key = q.get('process') ?? '';
  const index = readInterviews();
  // ?all=1 → every text note's body, for searching across notes on the page.
  if (q.get('all') === '1') {
    const bodies: Record<string, string> = {};
    for (const p of index.processes) for (const n of p.notes) {
      if (n.kind === 'file') continue;
      try { bodies[`${p.id}|${n.id}`] = readNoteBody(p, n); } catch {}
    }
    return NextResponse.json({ success: true, data: { bodies } });
  }
  const process = key.startsWith('listing:')
    ? index.processes.find((p) => p.listingId === key.slice('listing:'.length))
    : index.processes.find((p) => p.id === key);
  const note = process?.notes.find((n) => n.id === q.get('note'));
  if (!process || !note) return NextResponse.json({ success: false, error: 'Note not found' }, { status: 404 });
  try {
    if (q.get('raw') === '1') {
      const file = path.join(processDir(process), path.basename(note.file));
      const type = note.file.endsWith('.pdf') ? 'application/pdf' : 'text/markdown; charset=utf-8';
      return new NextResponse(fs.readFileSync(file), {
        headers: { 'content-type': type, 'content-disposition': `inline; filename="${path.basename(note.file)}"`, 'x-content-type-options': 'nosniff' },
      });
    }
    return NextResponse.json({ success: true, data: { body: readNoteBody(process, note) } });
  } catch {
    return NextResponse.json({ success: false, error: 'That note is missing on disk' }, { status: 404 });
  }
}
