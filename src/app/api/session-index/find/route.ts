import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { fromThisApp } from '@/lib/same-origin';
import { appOf, boundOf, findSessions, hostOf, sessionDetail, FIND_LIMIT_MAX } from '@/lib/session-index/find';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const QuerySchema = z.object({
  q: z.string().max(300).optional(),
  app: z.string().max(20).optional().refine((v) => v === undefined || v === '' || appOf(v) !== null, 'app is openclaw, claude-code or codex'),
  device: z.string().max(40).optional().refine((v) => v === undefined || v === '' || hostOf(v) !== null, 'device is laptop, PC or Mac'),
  folder: z.string().max(200).optional(),
  after: z.string().max(40).optional().refine((v) => !v || boundOf(v, false) !== null, 'after is a date (YYYY-MM-DD)'),
  before: z.string().max(40).optional().refine((v) => !v || boundOf(v, true) !== null, 'before is a date (YYYY-MM-DD)'),
  limit: z.coerce.number().int().min(1).max(FIND_LIMIT_MAX).optional(),
  uid: z.string().min(3).max(220).optional(),
}).strict();

/**
 * GET /api/session-index/find: a read-only search of the session index, for OpenClaw when Adamya asks it to find a
 * session to link to a task (lib/session-finder.ts tells it how). Every parameter is optional:
 *   q (words), app (openclaw | claude-code | codex), device (laptop | PC | Mac), folder (part of it),
 *   after / before (dates), limit (1–25)  → the sessions that fit, best first
 *   uid                                     → one session in detail, with the text the index holds of it
 * Another site's page may not read it; curl on this machine may.
 */
export async function GET(req: NextRequest) {
  if (!fromThisApp(req.headers)) return NextResponse.json({ success: false, error: 'Only the Journal’s own pages and this machine may search sessions.' }, { status: 403 });
  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues.map((i) => i.message || `${i.path.join('.')} is not right`).join('; ') }, { status: 400 });
  }
  const p = parsed.data;
  try {
    if (p.uid) {
      const detail = sessionDetail(p.uid);
      if (!detail) return NextResponse.json({ success: false, error: 'No session in the index has that uid.' }, { status: 404 });
      return NextResponse.json({ success: true, data: detail }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const data = findSessions({ q: p.q, app: appOf(p.app) ?? undefined, host: hostOf(p.device) ?? undefined, folder: p.folder, after: p.after, before: p.before, limit: p.limit });
    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Search failed.' }, { status: 500 });
  }
}
