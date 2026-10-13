import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { view, enqueue, feedback, rank, syncRatings } from '@/lib/media/store';
import {
  confirmAccount,
  decide,
  decideBucket,
  decideChannel,
  listVideos,
  restore,
  summary,
  unkeep,
} from '@/lib/media/youtube-store';
// Media titles: IMDb ids, or kept YouTube videos.
const titleId = z.string().regex(/^(tt\d+|yt:[A-Za-z0-9_-]{11})$/);
const videoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
const channelKey = z.string().min(1).max(200);
const status = z.enum(['pending', 'kept', 'skipped']);
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
export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.pathname.replace(/^\/api\/media\/?/, '');
    const q = req.nextUrl.searchParams;
    if (action === 'youtube') {
      const sort = z.enum(['videos', 'hours', 'recent']).catch('videos').parse(q.get('sort'));
      return result(summary(sort));
    }
    if (action === 'youtube/videos') {
      const offset = z.coerce.number().int().min(0).catch(0).parse(q.get('offset'));
      const bucket = q.get('bucket');
      const filter = q.get('channel')
        ? { channel: channelKey.parse(q.get('channel')) }
        : bucket
          ? { bucket: z.enum(['barely', 'live']).parse(bucket) }
          : { oneOffs: true as const };
      return result(listVideos(filter, offset));
    }
    if (action) return NextResponse.json({ success: false, error: 'Not found.' }, { status: 404 });
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
          id: titleId,
          value: z.enum(['interested', 'dismissed']).nullable(),
        })
        .strict()
        .parse(await req.json());
      await feedback(body.id, body.value);
      return result(view());
    }
    if (action === 'ranking') {
      const id = titleId,
        tier = z.enum(['S', 'A', 'B', 'C']);
      const body = z
        .discriminatedUnion('op', [
          z.object({ op: z.literal('tier'), id, tier }).strict(),
          z.object({ op: z.literal('place'), id, tier, index: z.number().int().min(0) }).strict(),
          z.object({ op: z.literal('skip'), id }).strict(),
          z.object({ op: z.literal('unrank'), id }).strict(),
        ])
        .parse(await req.json());
      await rank(body);
      return result(view());
    }
    if (action === 'youtube/sync') return result({ jobId: await enqueue('youtube-sync') }, 202);
    if (action === 'youtube/account') {
      const body = z
        .object({ confirm: z.boolean() })
        .strict()
        .parse(await req.json());
      const account = await confirmAccount(body.confirm);
      // Confirming starts the import straight away.
      return result({ account, jobId: account ? await enqueue('youtube-sync') : undefined });
    }
    if (action === 'youtube/decide') {
      const body = z
        .object({ ids: z.array(videoId).min(1).max(500), status })
        .strict()
        .parse(await req.json());
      return result(await decide(body.ids, body.status));
    }
    if (action === 'youtube/channel') {
      const body = z
        .object({ channel: channelKey, status, remember: z.boolean() })
        .strict()
        .parse(await req.json());
      return result(await decideChannel(body.channel, body.status, body.remember));
    }
    if (action === 'youtube/bucket') {
      const body = z
        .object({ bucket: z.enum(['barely', 'live', 'oneOffs']) })
        .strict()
        .parse(await req.json());
      return result(await decideBucket(body.bucket));
    }
    if (action === 'youtube/restore') {
      const body = z
        .object({
          previous: z.record(videoId, status),
          rules: z.record(channelKey, z.enum(['keep', 'skip']).nullable()).optional(),
        })
        .strict()
        .parse(await req.json());
      await restore(body.previous, body.rules);
      return result({});
    }
    if (action === 'youtube/unkeep') {
      const body = z
        .object({ id: titleId })
        .strict()
        .parse(await req.json());
      if (!body.id.startsWith('yt:')) throw new Error('Only YouTube videos can be removed here.');
      const done = await unkeep(body.id.slice(3));
      return result({ ...done, view: view() });
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
