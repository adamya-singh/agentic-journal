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
import {
  addShows,
  approveChannel,
  calibrate,
  calibrationItems,
  editTaste,
  markEpisode,
  readUnwind,
  savePosition as saveShowPosition,
  setShowState,
  want,
} from '@/lib/media/unwind-store';
import { unwindView, watchView } from '@/lib/media/unwind-view';
import { addYouTubeSource, findSources } from '@/lib/media/unwind-sources';
import { searchShows, searchTitles } from '@/lib/media/catalog';
import { readLibrary, resolveInLibrary, setMatch } from '@/lib/media/library';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { matchFiles } from '@/lib/media/library-sync';
import { YT_URL } from '@/lib/media/feed-store';
const feedId = z.string().regex(FEED_ID);
const compass = z.enum(['long', 'short', 'taste']);
const track = z.enum(['pretrain', 'unwind']);
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
// Unwind: shows and films are IMDb ids; an episode is S1E3, a film's only "episode" is film.
const showId = z.string().regex(/^tt\d{5,10}$/);
const epKey = z.string().regex(/^(S\d{1,3}E\d{1,4}|film)$/);
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
// Streams a library file (or one of its subtitles), honoring Range so the player can seek.
// The id goes through the library index; a path never comes from the request.
function serveLibrary(req: NextRequest, fileId: string, sub?: number) {
  const f = readLibrary().files[fileId];
  const rel = sub === undefined ? (f?.status === 'ready' ? f.playPath : undefined) : f?.subtitles[sub]?.file;
  if (!rel) return NextResponse.json({ success: false, error: 'Not playable yet.' }, { status: 404 });
  let file: string, size: number;
  try {
    file = resolveInLibrary(rel);
    size = fs.statSync(file).size;
  } catch {
    return NextResponse.json({ success: false, error: 'The file is gone. Rescan the library.' }, { status: 404 });
  }
  const type = sub !== undefined ? 'text/vtt; charset=utf-8' : /\.webm$/i.test(rel) ? 'video/webm' : 'video/mp4';
  const headers: Record<string, string> = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, max-age=3600' };
  const range = req.headers.get('range')?.match(/^bytes=(\d*)-(\d*)$/);
  let start = 0,
    end = size - 1,
    status = 200;
  if (range && (range[1] || range[2])) {
    start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  headers['Content-Length'] = String(end - start + 1);
  return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream, { status, headers });
}
export async function GET(req: NextRequest) {
  try {
    const action = req.nextUrl.pathname.replace(/^\/api\/media\/?/, '');
    const q = req.nextUrl.searchParams;
    const stream = action.match(/^unwind\/(?:stream\/([a-f0-9]{16})|subs\/([a-f0-9]{16})\/(\d{1,2}))$/);
    if (stream) return stream[1] ? serveLibrary(req, stream[1]) : serveLibrary(req, stream[2], Number(stream[3]));
    if (action === 'youtube') {
      const sort = z.enum(['videos', 'hours', 'recent']).catch('videos').parse(q.get('sort'));
      return result(summary(sort));
    }
    if (action === 'feed/summary') return result(feedTeaser(track.catch('pretrain').parse(q.get('track'))));
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
    if (action === 'unwind') return result(unwindView());
    if (action === 'unwind/watch') {
      const v = watchView(showId.parse(q.get('id')), q.get('ep') ? epKey.parse(q.get('ep')) : undefined);
      if (!v) return NextResponse.json({ success: false, error: 'Not in Unwind.' }, { status: 404 });
      return result(v);
    }
    if (action === 'unwind/taste') {
      const u = readUnwind();
      return result({
        taste: u.taste,
        channels: Object.values(u.officialChannels),
        calibrate: await calibrationItems(),
        anchors: u.taste.anchors.map((id) => {
          const t = view().library.find((x) => x.id === id) || u.shows[id];
          return { id, title: t?.title || id, poster: t?.poster };
        }),
      });
    }
    if (action === 'unwind/search') {
      const text = z.string().trim().min(2).max(100).parse(q.get('q'));
      const [films, shows] = await Promise.all([searchTitles(text).catch(() => []), searchShows(text).catch(() => [])]);
      const seen = new Set<string>();
      const hits = [
        ...shows.filter((s) => s.imdb).map((s) => ({ id: s.imdb!, kind: 'series' as const, title: s.name, year: undefined, poster: s.poster, network: s.network })),
        ...films.map((f) => ({ ...f, network: undefined })),
      ].filter((h) => !seen.has(h.id) && seen.add(h.id));
      return result(hits.slice(0, 10));
    }
    if (action === 'unwind/library') {
      const files = Object.values(readLibrary().files);
      return result({
        unmatched: files.filter((f) => !f.match).map((f) => ({ id: f.id, rel: f.rel, guess: f.guess, status: f.status })),
        failed: files.filter((f) => f.status === 'failed').map((f) => ({ id: f.id, rel: f.rel, error: f.error })),
        preparing: files.filter((f) => ['settling', 'new', 'preparing'].includes(f.status)).length,
        ready: files.filter((f) => f.status === 'ready').length,
      });
    }
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
        .object({ url: z.string().url().max(500), track: track.default('pretrain') })
        .strict()
        .parse(await req.json());
      return result(await addLink(body.url, body.track), 201);
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
    if (action === 'unwind/position') {
      const body = z
        .object({
          id: showId,
          key: epKey,
          position: z.number().min(0).max(86_400),
          duration: z.number().min(0).max(86_400).optional(),
          ended: z.boolean().optional(),
        })
        .strict()
        .parse(await req.json());
      return result(await saveShowPosition(body.id, body.key, body.position, body.duration, body.ended));
    }
    if (action === 'unwind/watched') {
      const body = z.object({ id: showId, key: epKey, done: z.boolean() }).strict().parse(await req.json());
      await markEpisode(body.id, body.key, body.done);
      return result(unwindView());
    }
    if (action === 'unwind/state') {
      const body = z
        .object({ id: showId, state: z.enum(['deck', 'watching', 'paused', 'finished', 'dropped']) })
        .strict()
        .parse(await req.json());
      await setShowState(body.id, body.state);
      return result(unwindView());
    }
    if (action === 'unwind/want') {
      const body = z.object({ id: showId, on: z.boolean() }).strict().parse(await req.json());
      await want(body.id, body.on);
      return result(unwindView());
    }
    if (action === 'unwind/add') {
      const body = z.object({ id: showId }).strict().parse(await req.json());
      const r = await addShows([{ id: body.id }], 'you');
      if (r.unknown.length) throw new Error(r.unknown[0].reason);
      return result(unwindView(), 201);
    }
    if (action === 'unwind/taste') {
      const mood = z.object({ name: z.string().max(40), examples: z.string().max(160) });
      const never = z.object({
        name: z.string().max(80),
        channels: z.array(z.string().max(80)).max(40),
        keywords: z.array(z.string().max(80)).max(40),
        on: z.boolean(),
      });
      const body = z
        .object({
          summary: z.string().max(1200).optional(),
          moods: z.array(mood).max(20).optional(),
          anchors: z.array(showId).max(40).optional(),
          never: z.array(never).max(20).optional(),
        })
        .strict()
        .parse(await req.json());
      return result(await editTaste(body));
    }
    if (action === 'unwind/calibrate') {
      const body = z
        .object({ id: showId, answer: z.enum(['loved', 'want', 'not']).nullable() })
        .strict()
        .parse(await req.json());
      return result(await calibrate(body.id, body.answer));
    }
    if (action === 'unwind/channel') {
      const body = z
        .object({ channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/), approved: z.boolean() })
        .strict()
        .parse(await req.json());
      await approveChannel(body.channelId, body.approved);
      return result(Object.values(readUnwind().officialChannels));
    }
    if (action === 'unwind/source') {
      const body = z.object({ id: showId, key: epKey, url: z.string().url().max(500) }).strict().parse(await req.json());
      const vid = body.url.match(YT_URL)?.[1];
      if (!vid) throw new Error('Paste a YouTube link.');
      return result(await addYouTubeSource(body.id, body.key, vid, 'you'));
    }
    if (action === 'unwind/find') {
      const body = z.object({ id: showId }).strict().parse(await req.json());
      return result(await findSources(body.id, { episodes: 3, by: 'you' }));
    }
    if (action === 'unwind/match') {
      const body = z
        .object({ fileId: z.string().regex(/^[a-f0-9]{16}$/), id: showId, key: epKey })
        .strict()
        .parse(await req.json());
      if (!readUnwind().shows[body.id]) {
        const r = await addShows([{ id: body.id }], 'you');
        if (r.unknown.length) throw new Error(r.unknown[0].reason);
      }
      await setMatch(body.fileId, { showId: body.id, key: body.key }, 'you');
      await matchFiles();
      return result(unwindView());
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
