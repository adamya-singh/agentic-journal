import { NextRequest, NextResponse } from 'next/server';
import { searchSessions } from '@/lib/session-index/view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/session-index/search?q=: sessions to link to a card by hand. */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').slice(0, 200);
  try {
    return NextResponse.json({ success: true, data: searchSessions(q) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ success: false, error: e instanceof Error ? e.message : 'Search failed.' }, { status: 500 });
  }
}
