import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { compassDir, readOverview, readPeriod } from '@/lib/compass/read';
import { listHistory, SHA_RE, showCommit } from '@/lib/compass/git';
import { PERIOD_ID_RE } from '@/lib/compass/read';

// Read-only view of OpenClaw's compass repo ($OPENCLAW_COMPASS_DIR). No Origin check: nothing here
// writes. A missing directory, file or git binary is an ordinary 200 with empty data; only unexpected
// filesystem errors reach the 500.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const result = (data: unknown, status = 200) =>
  NextResponse.json({ success: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
const notFound = () => NextResponse.json({ success: false, error: 'Not found.' }, { status: 404 });

export async function GET(req: NextRequest) {
  try {
    const action = decodeURIComponent(req.nextUrl.pathname.replace(/^\/api\/compass\/?/, ''));
    const q = req.nextUrl.searchParams;
    const dir = compassDir();
    if (!action) return result(readOverview(dir));
    if (action === 'history') {
      const scope = z.enum(['short', 'long', 'all']).catch('short').parse(q.get('scope'));
      const limit = z.coerce.number().int().min(1).max(200).catch(30).parse(q.get('limit'));
      return result(listHistory(dir, scope, limit));
    }
    const commit = /^history\/([^/]+)$/.exec(action);
    if (commit) {
      const sha = commit[1].toLowerCase();
      if (!SHA_RE.test(sha)) return notFound();
      const detail = showCommit(dir, sha);
      return detail ? result(detail) : notFound();
    }
    const period = /^periods\/([^/]+)$/.exec(action);
    if (period) {
      if (!PERIOD_ID_RE.test(period[1])) return notFound();
      const detail = readPeriod(period[1], dir);
      return detail ? result(detail) : notFound();
    }
    return notFound();
  } catch (e) {
    console.error('Compass could not be read:', e);
    return NextResponse.json(
      { success: false, error: 'The compass could not be read. Check the server log.' },
      { status: 500 },
    );
  }
}
