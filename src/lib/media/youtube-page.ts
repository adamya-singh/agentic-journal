import { VIDEO_ID } from './youtube-links.ts';

// Plain fetches of public YouTube pages (no sign-in, no browser) and the bits
// of their ytInitialData the Media page reads. Shared by Diet TBPN and Unwind.

export const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};
export async function page(url: string) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`YouTube answered ${r.status}.`);
  return r.text();
}
export function parseClock(s: string): number | undefined {
  if (!/^\d+(:\d{2}){1,2}$/.test(s)) return undefined;
  return s.split(':').reduce((a, p) => a * 60 + Number(p), 0);
}
export function initialData(html: string): unknown {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error('The YouTube page changed. Its videos could not be read.');
  return JSON.parse(m[1]);
}

// Who posted a video and how long it is, from its watch page.
export interface WatchFacts {
  videoId: string;
  title: string;
  channelId: string;
  channel: string;
  durationSec?: number;
}
export function parseWatch(html: string): WatchFacts | undefined {
  const m = html.match(/"videoDetails":(\{"videoId":"[^"]+"[\s\S]*?"author":"(?:[^"\\]|\\.)*"[\s\S]*?\})/);
  const get = (re: RegExp) => (m?.[1] ?? html).match(re)?.[1];
  const videoId = get(/"videoId":"([A-Za-z0-9_-]{11})"/);
  const channelId = get(/"channelId":"(UC[A-Za-z0-9_-]{22})"/);
  if (!videoId || !channelId) return undefined;
  const unescape = (s?: string) => (s ? (JSON.parse(`"${s}"`) as string) : '');
  const len = Number(get(/"lengthSeconds":"(\d+)"/));
  return {
    videoId,
    channelId,
    title: unescape(get(/"title":"((?:[^"\\]|\\.)*)"/)),
    channel: unescape(get(/"author":"((?:[^"\\]|\\.)*)"/)),
    durationSec: len > 0 ? len : undefined,
  };
}

// The videos on a search results page.
export interface SearchHit {
  videoId: string;
  title: string;
  channel: string;
  channelId?: string;
  durationSec?: number;
  verified: boolean;
}
interface VideoRenderer {
  videoId?: string;
  title?: { runs?: { text: string }[] };
  ownerText?: { runs?: { text: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }[] };
  lengthText?: { simpleText?: string };
  ownerBadges?: { metadataBadgeRenderer?: { style?: string } }[];
}
export function parseSearch(html: string): SearchHit[] {
  const out: SearchHit[] = [];
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    const v = (o as { videoRenderer?: VideoRenderer }).videoRenderer;
    if (v?.videoId && VIDEO_ID.test(v.videoId)) {
      const owner = v.ownerText?.runs?.[0];
      out.push({
        videoId: v.videoId,
        title: v.title?.runs?.map((r) => r.text).join('') || '',
        channel: owner?.text || '',
        channelId: owner?.navigationEndpoint?.browseEndpoint?.browseId,
        durationSec: v.lengthText?.simpleText ? parseClock(v.lengthText.simpleText) : undefined,
        verified: !!v.ownerBadges?.some((b) => /VERIFIED/.test(b.metadataBadgeRenderer?.style || '')),
      });
      return;
    }
    for (const x of Object.values(o)) walk(x);
  };
  walk(initialData(html));
  return out;
}
