import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { mediaRoot, withLock } from './store.ts';
import { readAcquisitions } from './acquisition-store.ts';
import { jellyCall, serviceFetch } from './stack-clients.ts';
import { stackConfig, type StackConfig } from './stack-config.ts';

interface Stream {
  Index: number;
  Type: string;
  Language?: string;
  DisplayTitle?: string;
  IsDefault?: boolean;
  DeliveryUrl?: string;
  Codec?: string;
}
interface Source {
  Id: string;
  SupportsDirectPlay?: boolean;
  SupportsDirectStream?: boolean;
  TranscodingUrl?: string;
  MediaStreams: Stream[];
  RunTimeTicks?: number;
  Container?: string;
}
interface Session {
  token: string;
  itemId: string;
  showId: string;
  key: string;
  sourceId: string;
  playSessionId: string;
  expires: number;
  created: number;
  resources: Record<string, string>;
  position: number;
}
export interface Playback {
  token: string;
  src: string;
  hls: boolean;
  durationSec?: number;
  audio: { index: number; label: string }[];
  subtitles: { lang: string; src: string; label: string }[];
}
const sessionsFile = () => path.join(mediaRoot(), 'playback-sessions.json');
function readSessions(): Record<string, Session> {
  try {
    return JSON.parse(fs.readFileSync(sessionsFile(), 'utf8'));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error('Playback session storage unavailable.');
  }
}
async function sessions<T>(fn: (s: Record<string, Session>) => T | Promise<T>) {
  return withLock(async () => {
    const s = readSessions(),
      result = await fn(s),
      temp = `${sessionsFile()}.${randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(s), { mode: 0o600 });
    fs.renameSync(temp, sessionsFile());
    return result;
  }, 'playback');
}
function resourceUrl(s: Session, upstream: string, base: string, c: StackConfig) {
  const u = new URL(upstream, base);
  const origin = new URL(c.jellyfin.url).origin;
  const resourceId = u.pathname.match(
    /^\/videos\/([a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\//i,
  )?.[1];
  if (
    u.origin !== origin ||
    resourceId?.replaceAll('-', '').toLowerCase() !== s.itemId.replaceAll('-', '').toLowerCase() ||
    /%2f|%5c|\.\./i.test(u.pathname)
  )
    throw new Error('Jellyfin returned an unsupported media resource.');
  u.searchParams.delete('api_key');
  u.searchParams.delete('ApiKey');
  u.searchParams.delete('AccessToken');
  const route = u.pathname + u.search;
  const existing = Object.keys(s.resources).find((k) => s.resources[k] === route);
  if (!existing && Object.keys(s.resources).length >= 20000)
    throw new Error('Too many playback resources.');
  const key = existing || randomBytes(12).toString('hex');
  s.resources[key] = route;
  return `/api/media/playback/${s.token}/${key}`;
}
export function validateResource(upstream: string, itemId: string, base: string, c: StackConfig) {
  const dummy: Session = {
    token: '',
    itemId,
    showId: '',
    key: '',
    sourceId: '',
    playSessionId: '',
    expires: 0,
    created: 0,
    resources: {},
    position: 0,
  };
  resourceUrl(dummy, upstream, base, c);
  return Object.values(dummy.resources)[0];
}
export async function createPlayback(
  input: { id: string; key: string; audioIndex?: number; bitrate?: number; h264?: boolean },
  c = stackConfig(),
): Promise<Playback> {
  const items =
    readAcquisitions().requests[input.id]?.items.filter((x) => x.key === input.key) || [];
  if (items.length !== 1) throw new Error('This episode is not available in Jellyfin yet.');
  await reapPlayback(c);
  const token = randomBytes(32).toString('hex');
  // Reserve the single playback slot before a request can start transcoding.
  const s: Session = {
    token,
    itemId: items[0].itemId,
    showId: input.id,
    key: input.key,
    sourceId: '',
    playSessionId: '',
    expires: Date.now() + 120_000,
    created: Date.now(),
    resources: {},
    position: 0,
  };
  await sessions((all) => {
    if (Object.values(all).some((x) => x.expires > Date.now()))
      throw new Error('Another stream is active. Stop it before starting this one.');
    all[token] = s;
  });
  try {
    const profile = {
      Name: 'Journal browser',
      MaxStreamingBitrate: input.bitrate || 12_000_000,
      MaxStaticBitrate: 20_000_000,
      DirectPlayProfiles:
        input.h264 === false
          ? []
          : [{ Container: 'mp4,m4v', Type: 'Video', VideoCodec: 'h264', AudioCodec: 'aac,mp3' }],
      TranscodingProfiles: [
        {
          Container: 'ts',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Protocol: 'hls',
          Context: 'Streaming',
          MaxAudioChannels: '2',
          MinSegments: 2,
          BreakOnNonKeyFrames: true,
        },
      ],
      CodecProfiles: [
        {
          Type: 'Video',
          Codec: 'h264',
          Conditions: [
            {
              Condition: 'LessThanEqual',
              Property: 'Width',
              Value: String((input.bitrate || 12_000_000) <= 3_000_000 ? 1280 : 1920),
              IsRequired: true,
            },
            {
              Condition: 'LessThanEqual',
              Property: 'Height',
              Value: String((input.bitrate || 12_000_000) <= 3_000_000 ? 720 : 1080),
              IsRequired: true,
            },
          ],
        },
      ],
      ContainerProfiles: [],
      SubtitleProfiles: [
        { Format: 'vtt', Method: 'External' },
        { Format: 'srt', Method: 'External' },
        { Format: 'ass', Method: 'External' },
        { Format: 'ssa', Method: 'External' },
        { Format: 'pgssub', Method: 'Encode' },
      ],
    };
    const info = await jellyCall<{ PlaySessionId: string; MediaSources: Source[] }>(
      c,
      `Items/${s.itemId}/PlaybackInfo?UserId=${c.jellyfin.userId}`,
      {
        UserId: c.jellyfin.userId,
        IsPlayback: true,
        AutoOpenLiveStream: false,
        DeviceProfile: profile,
        EnableDirectPlay: input.h264 !== false,
        EnableDirectStream: true,
        EnableTranscoding: true,
        MaxStreamingBitrate: input.bitrate || 12_000_000,
        AudioStreamIndex: input.audioIndex,
        SubtitleStreamIndex: -1,
      },
    );
    const source = info.MediaSources[0];
    if (!source || !/^[a-f0-9]{32}$/i.test(s.itemId))
      throw new Error('Jellyfin has no playable source.');
    s.sourceId = source.Id;
    s.playSessionId = info.PlaySessionId;
    const direct = source.SupportsDirectPlay && input.h264 !== false;
    const route = direct
      ? `/Videos/${s.itemId}/stream?static=true&MediaSourceId=${encodeURIComponent(source.Id)}&PlaySessionId=${encodeURIComponent(s.playSessionId)}`
      : source.TranscodingUrl;
    if (!route) throw new Error('Jellyfin cannot prepare this format.');
    const src = resourceUrl(s, route, `${c.jellyfin.url}/`, c);
    const subtitles = source.MediaStreams.filter(
      (x) =>
        x.Type === 'Subtitle' && ['subrip', 'srt', 'webvtt', 'ass', 'ssa'].includes(x.Codec || ''),
    ).map((x) => ({
      lang: x.Language || 'und',
      label: x.DisplayTitle || x.Language || 'Subtitles',
      src: resourceUrl(
        s,
        `/Videos/${s.itemId}/${encodeURIComponent(s.sourceId)}/Subtitles/${x.Index}/0/Stream.vtt`,
        `${c.jellyfin.url}/`,
        c,
      ),
    }));
    await sessions((all) => {
      if (all[token]) all[token] = s;
    });
    await jellyCall(c, 'Sessions/Playing', {
      ItemId: s.itemId,
      MediaSourceId: s.sourceId,
      PlaySessionId: s.playSessionId,
      PositionTicks: 0,
      CanSeek: true,
      PlayMethod: direct ? 'DirectPlay' : 'Transcode',
    });
    return {
      token,
      src,
      hls: !direct,
      durationSec: source.RunTimeTicks ? source.RunTimeTicks / 10_000_000 : undefined,
      audio: source.MediaStreams.filter((x) => x.Type === 'Audio').map((x) => ({
        index: x.Index,
        label: x.DisplayTitle || x.Language || 'Original audio',
      })),
      subtitles,
    };
  } catch (e) {
    await stopPlayback(token, c).catch(() => {});
    throw e;
  }
}
export async function progressPlayback(
  token: string,
  position: number,
  paused = false,
  c = stackConfig(),
) {
  const s = await sessions((all) => {
    const s = all[token];
    if (!s || s.expires < Date.now()) throw new Error('Playback session expired.');
    s.expires = Date.now() + 120_000;
    s.position = position;
    return s;
  });
  await jellyCall(c, 'Sessions/Playing/Progress', {
    ItemId: s.itemId,
    MediaSourceId: s.sourceId,
    PlaySessionId: s.playSessionId,
    PositionTicks: Math.round(position * 10_000_000),
    IsPaused: paused,
    CanSeek: true,
  });
}
export async function stopPlayback(token: string, c = stackConfig()) {
  const s = readSessions()[token];
  if (!s) return;
  if (!s.playSessionId) {
    await sessions((all) => {
      delete all[token];
    });
    return;
  }
  try {
    await jellyCall(c, 'Sessions/Playing/Stopped', {
      ItemId: s.itemId,
      MediaSourceId: s.sourceId,
      PlaySessionId: s.playSessionId,
      PositionTicks: Math.round(s.position * 10_000_000),
    });
    if (s.playSessionId)
      await jellyCall(
        c,
        `Videos/ActiveEncodings?DeviceId=journal&PlaySessionId=${encodeURIComponent(s.playSessionId)}`,
        undefined,
        'DELETE',
      );
    await sessions((all) => {
      delete all[token];
    });
  } catch {
    await sessions((all) => {
      if (all[token]) all[token].expires = 0;
    });
    throw new Error('Jellyfin could not stop the stream; cleanup will retry.');
  }
}
export async function reapPlayback(c = stackConfig()) {
  for (const s of Object.values(readSessions()))
    if (s.expires < Date.now() || Date.now() - s.created > 6 * 3600_000)
      await stopPlayback(s.token, c);
}
export async function proxyPlayback(token: string, key: string, req: Request, c = stackConfig()) {
  const s = readSessions()[token],
    route = s?.resources[key];
  if (!s || s.expires < Date.now() || !route)
    return new Response('Playback expired.', { status: 404 });
  const headers = new Headers({ Authorization: `MediaBrowser Token="${c.jellyfin.apiKey}"` });
  const range = req.headers.get('range');
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('Range', range);
  const upstream = await serviceFetch(c.jellyfin.url + route, { headers, signal: req.signal });
  if (!upstream.ok) {
    await upstream.body?.cancel();
    return new Response('Media resource unavailable.', { status: upstream.status });
  }
  const responseHeaders = new Headers({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
  });
  for (const name of ['Content-Type', 'Content-Range', 'Accept-Ranges', 'Content-Length']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (/\.m3u8(?:\?|$)/i.test(route) && upstream.ok) {
    const text = await upstream.text();
    if (text.length > 4 * 1024 * 1024) throw new Error('Playback playlist is too large.');
    const rewritten = await sessions((all) => {
      const current = all[token];
      if (!current || current.expires < Date.now()) throw new Error('Playback expired.');
      return text
        .split('\n')
        .map((line) => {
          if (!line.trim()) return line;
          if (line.startsWith('#'))
            return line.replace(
              /URI="([^"]+)"/g,
              (_m, url: string) => `URI="${resourceUrl(current, url, c.jellyfin.url + route, c)}"`,
            );
          return resourceUrl(current, line.trim(), c.jellyfin.url + route, c);
        })
        .join('\n');
    });
    responseHeaders.delete('Content-Length');
    responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl');
    return new Response(rewritten, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
