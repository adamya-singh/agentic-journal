import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { view, enqueue, feedback, rank, syncRatings } from '@/lib/media/store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const result = (data: unknown, status = 200) =>
  NextResponse.json({ success: true, data }, { status, headers: { 'Cache-Control': 'no-store' } });
function authorized(req: NextRequest) {
  const origin = req.headers.get('origin');
  return (
    !!origin &&
    [
      new URL(process.env.AGENTIC_JOURNAL_ORIGIN || 'https://ubuntu-laptop.taile85e97.ts.net')
        .origin,
      'http://127.0.0.1:3000',
      'http://localhost:3000',
    ].includes(origin)
  );
}
export async function GET() {
  try {
    return result(view());
  } catch {
    return NextResponse.json(
      { success: false, error: 'Media could not be loaded. Check local storage.' },
      { status: 500 },
    );
  }
}
export async function POST(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json(
      { success: false, error: 'A same-origin request is required.' },
      { status: 403 },
    );
  try {
    const action = req.nextUrl.pathname.replace('/api/media/', '');
    if (action === 'sync') return result({ jobId: await enqueue('sync') }, 202);
    if (action === 'feedback') {
      const body = z
        .object({
          id: z.string().regex(/^tt\d+$/),
          value: z.enum(['interested', 'dismissed']).nullable(),
        })
        .strict()
        .parse(await req.json());
      await feedback(body.id, body.value);
      return result(view());
    }
    if (action === 'ranking') {
      const id = z.string().regex(/^tt\d+$/),
        tier = z.enum(['S', 'A', 'B', 'C']);
      const body = z
        .discriminatedUnion('op', [
          z.object({ op: z.literal('tier'), id, tier }).strict(),
          z
            .object({ op: z.literal('place'), id, tier, index: z.number().int().min(0) })
            .strict(),
          z.object({ op: z.literal('skip'), id }).strict(),
          z.object({ op: z.literal('unrank'), id }).strict(),
        ])
        .parse(await req.json());
      await rank(body);
      return result(view());
    }
    if (action === 'ranking/sync') return result({ ...(await syncRatings()), view: view() }, 202);
    if (action === 'action') {
      const body = z
        .discriminatedUnion('action', [
          z.object({ action: z.literal('seen'), id: z.string().regex(/^tt\d+$/) }).strict(),
          z.object({ action: z.literal('watchlist'), id: z.string().regex(/^tt\d+$/) }).strict(),
          z
            .object({
              action: z.literal('rating'),
              id: z.string().regex(/^tt\d+$/),
              rating: z.number().int().min(1).max(10),
            })
            .strict(),
        ])
        .parse(await req.json());
      return result(
        { jobId: await enqueue(body.action, body.id, 'rating' in body ? body.rating : undefined) },
        202,
      );
    }
    return NextResponse.json({ success: false, error: 'Not found.' }, { status: 404 });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error:
          e instanceof z.ZodError || e instanceof SyntaxError
            ? 'Invalid media request.'
            : e instanceof Error
              ? e.message
              : 'Media action failed.',
      },
      { status: 400 },
    );
  }
}
