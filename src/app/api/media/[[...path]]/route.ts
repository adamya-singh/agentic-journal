import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { view, enqueue, feedback, rank, syncRatings } from '@/lib/media/store';
import {
  confirmAccount,
  decide,
  decideBucket,
  decideChannel,
  channelRules,
  listVideos,
  restore,
  setChannelRules,
  summary,
  unkeep,
} from '@/lib/media/youtube-store';
import { markSeen, page, skip, vote } from '@/lib/media/feed-store';
import { addLink, feedTeaser, feedView } from '@/lib/media/feed-view';
import { FEED_ID } from '@/lib/media/feed-pools';
import { ensureFresh, markWatched, savePosition, syncEpisodes, tbpnView } from '@/lib/media/tbpn';
const feedId = z.string().regex(FEED_ID);
const compass = z.enum(['long', 'short']);
const feedQuery = z
  .object({
    compass: compass.default('long'),
    filter: z.enum(['queue', 'voted', 'skipped']).default('queue'),
    source: z.enum(['youtube', 'x', 'imdb']).optional(),
    exclude: z.array(feedId).max(3000).optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(40).optional(),
  })
  .strict();
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
    if (action === 'feed/summary') return result(feedTeaser());
    if (action === 'tbpn') {
      await ensureFresh();
      return result(tbpnView());
    }
    if (action === 'feed') {
      const body = feedQuery.parse({
        compass: q.get('compass') || undefined,
        filter: q.get('filter') || undefined,
        source: q.get('source') || undefined,
      });
      return result(feedView(body));
    }
    if (action === 'youtube/rules') return result({ channels: channelRules() });
    if (action === 'youtube/videos') {
      const offset = z.coerce.number().int().min(0).catch(0).parse(q.get('offset'));
      // A grid reloads all it shows after a decision, which can be several pages.
      const limit = z.coerce.number().int().min(1).max(240).catch(24).parse(q.get('limit'));
      const bucket = q.get('bucket');
      const filter = q.get('channel')
        ? { channel: channelKey.parse(q.get('channel')) }
        : bucket
          ? { bucket: z.enum(['barely', 'live']).parse(bucket) }
          : { oneOffs: true as const };
      return result(listVideos(filter, offset, limit));
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
    if (action === 'feed/page') return result(page(feedQuery.parse(await req.json())));
    if (action === 'feed/vote') {
      const body = z
        .object({ id: feedId, vote: z.enum(['up', 'down']).nullable(), compass: compass.default('long') })
        .strict()
        .parse(await req.json());
      return result(await vote(body.id, body.vote, body.compass));
    }
    if (action === 'feed/skip') {
      const body = z
        .object({ id: feedId, undo: z.boolean().optional(), compass: compass.default('long') })
        .strict()
        .parse(await req.json());
      return result(await skip(body.id, body.undo, body.compass));
    }
    if (action === 'feed/seen') {
      const body = z
        .object({ ids: z.array(feedId).min(1).max(100), compass: compass.default('long') })
        .strict()
        .parse(await req.json());
      return result(await markSeen(body.ids, body.compass));
    }
    if (action === 'feed/add') {
      const body = z
        .object({ url: z.string().url().max(500) })
        .strict()
        .parse(await req.json());
      return result(await addLink(body.url), 201);
    }
    if (action === 'tbpn/position') {
      const body = z
        .object({ id: videoId, position: z.number().min(0).max(86_400), ended: z.boolean().optional() })
        .strict()
        .parse(await req.json());
      return result(await savePosition(body.id, body.position, body.ended));
    }
    if (action === 'tbpn/watched') {
      const body = z
        .object({ id: videoId, done: z.boolean() })
        .strict()
        .parse(await req.json());
      await markWatched(body.id, body.done);
      return result(tbpnView());
    }
    if (action === 'tbpn/refresh') {
      await syncEpisodes();
      return result(tbpnView());
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
    if (action === 'youtube/rules') {
      const body = z
        .object({
          rules: z
            .record(channelKey, z.enum(['keep', 'skip']).nullable())
            .refine((r) => Object.keys(r).length >= 1 && Object.keys(r).length <= 500, {
              message: 'Send between 1 and 500 channels.',
            }),
        })
        .strict()
        .parse(await req.json());
      return result(await setChannelRules(body.rules));
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
