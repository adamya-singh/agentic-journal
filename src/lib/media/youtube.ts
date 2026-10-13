import type { Browser, Page } from 'playwright-core';
import { BrowserUnavailable, openOpenClawPage } from './openclaw-page.ts';

// Reads YouTube watch history from OpenClaw's signed-in Chrome. Read-only:
// it loads /feed/history and asks YouTube for further pages the way the page
// itself does. It never clicks anything that changes the account or history.

export class YouTubeError extends Error {}
export interface YouTubeAccount {
  id: string;
  name: string;
  handle?: string;
}
export interface HistoryVideo {
  videoId: string;
  title: string;
  channelId?: string;
  channelName?: string;
  channelHandle?: string;
  durationSec?: number;
  live?: boolean;
  short?: boolean;
  // 0–1 from YouTube's red resume bar; absent when the page shows none.
  progress?: number;
  watchedDay: string;
}
export interface HistoryPage {
  videos: HistoryVideo[];
  continuation?: string;
  // The day heading in force at the end of the page, for a continuation that has none.
  lastDay?: string;
}
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const thumbnailUrl = (videoId: string) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
export const watchUrl = (videoId: string, short?: boolean) =>
  short
    ? `https://www.youtube.com/shorts/${videoId}`
    : `https://www.youtube.com/watch?v=${videoId}`;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : undefined;
const at = (v: unknown, ...path: (string | number)[]): unknown =>
  path.reduce<unknown>(
    (n, k) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[k] : undefined),
    v,
  );
// YouTube text comes as {simpleText}, {runs:[{text}]} or {content}.
export function text(v: unknown): string | undefined {
  const o = obj(v);
  if (!o) return typeof v === 'string' ? v : undefined;
  if (typeof o.simpleText === 'string') return o.simpleText;
  if (typeof o.content === 'string') return o.content;
  if (Array.isArray(o.runs)) return o.runs.map((r) => (obj(r)?.text as string) || '').join('');
  return undefined;
}
export function parseDuration(s?: string): number | undefined {
  if (!s || !/^\d+(:\d{1,2}){1,2}$/.test(s.trim())) return undefined;
  return s
    .trim()
    .split(':')
    .reduce((n, p) => n * 60 + Number(p), 0);
}
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
// History section headings: "Today", "Yesterday", "Monday", "Oct 3", "Mar 12, 2025".
export function resolveDay(heading: string, today: Date): string | undefined {
  const h = heading.trim().toLowerCase();
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (h === 'today') return iso(base);
  if (h === 'yesterday') return iso(new Date(base.getTime() - 86_400_000));
  const weekday = DAYS.indexOf(h);
  if (weekday >= 0) {
    const back = (base.getDay() - weekday + 7) % 7 || 7;
    return iso(new Date(base.getFullYear(), base.getMonth(), base.getDate() - back));
  }
  const m = /^([a-z]{3})[a-z]*\.? (\d{1,2})(?:, (\d{4}))?$/.exec(h);
  if (!m || MONTHS.indexOf(m[1]) < 0) return undefined;
  const month = MONTHS.indexOf(m[1]),
    day = Number(m[2]);
  let year = m[3] ? Number(m[3]) : base.getFullYear();
  // A heading without a year that lands in the future belongs to last year.
  if (!m[3] && new Date(year, month, day) > base) year--;
  return iso(new Date(year, month, day));
}

function channelFrom(endpoint: unknown) {
  const browse = obj(at(endpoint, 'browseEndpoint'));
  const id = typeof browse?.browseId === 'string' ? browse.browseId : undefined;
  const url = typeof browse?.canonicalBaseUrl === 'string' ? browse.canonicalBaseUrl : undefined;
  return {
    channelId: id?.startsWith('UC') ? id : undefined,
    channelHandle: url?.startsWith('/@') ? decodeURIComponent(url.slice(1)) : undefined,
  };
}
function fromVideoRenderer(r: Json, day: string): HistoryVideo | undefined {
  const videoId = r.videoId;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return undefined;
  const owner = obj(at(r, 'ownerText', 'runs', 0)) || obj(at(r, 'longBylineText', 'runs', 0));
  const overlays = (Array.isArray(r.thumbnailOverlays) ? r.thumbnailOverlays : []) as Json[];
  const resume = overlays.map((o) => obj(o.thumbnailOverlayResumePlaybackRenderer)).find(Boolean);
  const status = overlays.map((o) => obj(o.thumbnailOverlayTimeStatusRenderer)).find(Boolean);
  const length = text(r.lengthText) || text(status?.text);
  return {
    videoId,
    title: text(r.title) || 'Untitled video',
    channelName: owner?.text as string | undefined,
    ...channelFrom(owner?.navigationEndpoint),
    durationSec: parseDuration(length),
    live: status?.style === 'LIVE' || /live/i.test(String(length || '')) || undefined,
    progress:
      typeof resume?.percentDurationWatched === 'number'
        ? Math.min(1, resume.percentDurationWatched / 100)
        : undefined,
    watchedDay: day,
  };
}
function fromLockup(r: Json, day: string): HistoryVideo | undefined {
  const videoId = r.contentId;
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return undefined;
  if (r.contentType && !String(r.contentType).includes('VIDEO')) return undefined;
  const meta = obj(at(r, 'metadata', 'lockupMetadataViewModel'));
  const rows = (at(meta, 'metadata', 'contentMetadataViewModel', 'metadataRows') || []) as Json[];
  // The first metadata part is the channel name; the channel avatar's tap command
  // (or, in older layouts, the name's own link) carries the channel id and handle.
  const part = obj(at(rows, 0, 'metadataParts', 0, 'text'));
  const tap =
    at(
      meta,
      'image',
      'decoratedAvatarViewModel',
      'rendererContext',
      'commandContext',
      'onTap',
      'innertubeCommand',
    ) ?? at(part, 'commandRuns', 0, 'onTap', 'innertubeCommand');
  const overlays = JSON.stringify(at(r, 'contentImage') ?? at(r, 'image') ?? {});
  const badge = /"thumbnailBadgeViewModel":\{[^{}]*?"text":"([^"]+)"/.exec(overlays)?.[1];
  const percent = /"startPercent":(\d+(?:\.\d+)?)/.exec(overlays)?.[1];
  return {
    videoId,
    title: text(meta?.title) || 'Untitled video',
    channelName: typeof part?.content === 'string' ? part.content : undefined,
    ...channelFrom(tap),
    durationSec: parseDuration(badge),
    live: (badge && /live/i.test(badge)) || undefined,
    progress: percent ? Math.min(1, Number(percent) / 100) : undefined,
    watchedDay: day,
  };
}
function fromShort(r: Json, day: string): HistoryVideo | undefined {
  const videoId =
    r.videoId ??
    at(r, 'onTap', 'innertubeCommand', 'reelWatchEndpoint', 'videoId') ??
    (typeof r.entityId === 'string' ? r.entityId.replace(/^shorts-shelf-item-/, '') : undefined);
  if (typeof videoId !== 'string' || !VIDEO_ID.test(videoId)) return undefined;
  return {
    videoId,
    title: text(r.headline) || text(at(r, 'overlayMetadata', 'primaryText')) || 'Short',
    short: true,
    watchedDay: day,
  };
}

// Walks a history page (ytInitialData or a continuation response) in order,
// keeping track of the day heading each video sits under.
export function parseHistoryPage(json: unknown, today: Date, fallbackDay?: string): HistoryPage {
  const videos: HistoryVideo[] = [];
  let continuation: string | undefined;
  let day = fallbackDay || iso(today);
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    const o = obj(node);
    if (!o) return;
    for (const [key, value] of Object.entries(o)) {
      const v = obj(value);
      if (key === 'itemSectionRenderer' && v) {
        const heading = text(at(v, 'header', 'itemSectionHeaderRenderer', 'title'));
        day = (heading && resolveDay(heading, today)) || day;
        visit(v.contents);
      } else if (key === 'videoRenderer' && v) {
        const video = fromVideoRenderer(v, day);
        if (video) videos.push(video);
      } else if (key === 'lockupViewModel' && v) {
        const video = fromLockup(v, day);
        if (video) videos.push(video);
      } else if ((key === 'reelItemRenderer' || key === 'shortsLockupViewModel') && v) {
        const video = fromShort(v, day);
        if (video) videos.push(video);
      } else if (key === 'continuationItemRenderer' && v) {
        const token = at(v, 'continuationEndpoint', 'continuationCommand', 'token');
        if (typeof token === 'string') continuation = token;
      } else if (
        !['topbar', 'frameworkUpdates', 'responseContext', 'secondaryContents'].includes(key)
      )
        visit(value);
    }
  };
  visit(json);
  return { videos, continuation, lastDay: day };
}

// The signed-in account from YouTube's account menu response.
export function parseAccountMenu(json: unknown): { name?: string; handle?: string } {
  const s = JSON.stringify(json);
  const header = /"activeAccountHeaderRenderer":(\{.*?"channelHandle":\{[^}]*\}|\{.*?\}\})/.exec(s);
  const src = header ? header[1] : s;
  const name = /"accountName":\{"simpleText":"([^"]+)"/.exec(src)?.[1];
  const handle = /"channelHandle":\{"simpleText":"([^"]+)"/.exec(src)?.[1];
  return { name: name && JSON.parse(`"${name}"`), handle: handle && JSON.parse(`"${handle}"`) };
}

export interface ReadResult {
  complete: boolean;
  cursor?: string;
  lastDay?: string;
}
export interface YouTubeSession {
  account: YouTubeAccount | null;
  readHistory(opts: {
    cursor?: string;
    lastDay?: string;
    budgetMs: number;
    // Return true to stop early (an incremental sync has caught up).
    onBatch: (videos: HistoryVideo[], lastDay?: string) => Promise<boolean>;
  }): Promise<ReadResult>;
  close(): Promise<void>;
}

const HISTORY = 'https://www.youtube.com/feed/history';
const PAGE_GAP_MS = 1200;

export async function connectYouTube(): Promise<YouTubeSession> {
  let browser: Browser | undefined, page: Page | undefined;
  try {
    ({ browser, page } = await openOpenClawPage());
    // Thumbnails and video streams are not needed; block them without intercepting requests.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setBlockedURLs', {
      urls: ['*i.ytimg.com*', '*.googlevideo.com*', '*yt3.ggpht.com*'],
    });
    page.setDefaultTimeout(20_000);
    await page.goto(HISTORY, { waitUntil: 'commit', timeout: 45_000 });
    await page.waitForFunction(() => 'ytInitialData' in window && 'ytcfg' in window, null, {
      timeout: 45_000,
    });
    const cfg = await page.evaluate(() => {
      const c = (window as unknown as { ytcfg: { get(k: string): unknown } }).ytcfg;
      return { loggedIn: c.get('LOGGED_IN'), id: c.get('DATASYNC_ID') };
    });
    let account: YouTubeAccount | null = null;
    if (cfg.loggedIn === true && typeof cfg.id === 'string') {
      const menu = await readAccountMenu(page);
      account = {
        // DATASYNC_ID is "<account>||<delegated channel>"; it is stable per signed-in account.
        id: cfg.id,
        name: menu.name || 'YouTube account',
        handle: menu.handle,
      };
    }
    return new BrowserYouTube(browser, page, account);
  } catch (e) {
    if (page) await page.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    if (e instanceof YouTubeError) throw e;
    if (e instanceof BrowserUnavailable)
      throw new YouTubeError('Start the local OpenClaw browser, then sync YouTube again.');
    throw new YouTubeError(
      "Could not open YouTube in OpenClaw's browser. Check that it is running and signed in, then retry.",
    );
  }
}

async function readAccountMenu(page: Page) {
  try {
    const response = page.waitForResponse(
      (r) => r.url().includes('/youtubei/v1/account/account_menu'),
      {
        timeout: 10_000,
      },
    );
    await page.locator('button#avatar-btn, #avatar-btn').first().click({ timeout: 10_000 });
    const parsed = parseAccountMenu(await (await response).json());
    await page.keyboard.press('Escape').catch(() => undefined);
    return parsed;
  } catch {
    return {};
  }
}

class BrowserYouTube implements YouTubeSession {
  private browser: Browser;
  private page: Page;
  public account: YouTubeAccount | null;
  constructor(browser: Browser, page: Page, account: YouTubeAccount | null) {
    this.browser = browser;
    this.page = page;
    this.account = account;
  }
  async close() {
    await this.page.close().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
  // Asks for the next page the way YouTube's own client does, from inside the page.
  private async fetchContinuation(token: string): Promise<unknown> {
    return this.page.evaluate(async (token) => {
      const c = (window as unknown as { ytcfg: { get(k: string): unknown } }).ytcfg;
      const sapisid = /(?:^|; )(?:__Secure-3PAPISID|SAPISID)=([^;]+)/.exec(document.cookie)?.[1];
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Origin': location.origin,
        'X-Goog-AuthUser': String(c.get('SESSION_INDEX') ?? 0),
        'X-Youtube-Client-Name': String(c.get('INNERTUBE_CONTEXT_CLIENT_NAME') ?? 1),
        'X-Youtube-Client-Version': String(c.get('INNERTUBE_CLIENT_VERSION') ?? ''),
      };
      const visitor = c.get('VISITOR_DATA');
      if (typeof visitor === 'string') headers['X-Goog-Visitor-Id'] = visitor;
      if (sapisid) {
        const ts = Math.floor(Date.now() / 1000);
        const digest = await crypto.subtle.digest(
          'SHA-1',
          new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`),
        );
        const hex = [...new Uint8Array(digest)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        headers.Authorization = `SAPISIDHASH ${ts}_${hex}`;
      }
      const r = await fetch(
        `/youtubei/v1/browse?key=${c.get('INNERTUBE_API_KEY')}&prettyPrint=false`,
        {
          method: 'POST',
          credentials: 'include',
          headers,
          body: JSON.stringify({ context: c.get('INNERTUBE_CONTEXT'), continuation: token }),
        },
      );
      if (!r.ok) throw new Error(`browse ${r.status}`);
      return r.json();
    }, token);
  }
  async readHistory({
    cursor,
    lastDay,
    budgetMs,
    onBatch,
  }: Parameters<YouTubeSession['readHistory']>[0]): Promise<ReadResult> {
    if (!this.account)
      throw new YouTubeError("Sign in to YouTube in OpenClaw's browser, then sync again.");
    const started = Date.now();
    const today = new Date();
    let token = cursor;
    let day = lastDay;
    if (!token) {
      const first = parseHistoryPage(
        await this.page.evaluate(
          () => (window as unknown as { ytInitialData: unknown }).ytInitialData,
        ),
        today,
      );
      day = first.lastDay;
      if (await onBatch(first.videos, day)) return { complete: false, lastDay: day };
      if (!first.continuation) return { complete: true, lastDay: day };
      token = first.continuation;
    }
    while (token) {
      if (Date.now() - started > budgetMs) return { complete: false, cursor: token, lastDay: day };
      await this.page.waitForTimeout(PAGE_GAP_MS);
      let json: unknown;
      try {
        json = await this.fetchContinuation(token);
      } catch {
        throw new YouTubeError('YouTube stopped returning history pages. Sync again later.');
      }
      const next = parseHistoryPage(json, today, day);
      day = next.lastDay;
      if (await onBatch(next.videos, day)) return { complete: false, lastDay: day };
      token = next.continuation;
    }
    return { complete: true, lastDay: day };
  }
}

// Channel names for videos the history page lists without one (Shorts), from
// YouTube's public oEmbed endpoint. No account data is involved.
export async function lookupChannel(
  videoId: string,
): Promise<{ channelName?: string; channelHandle?: string } | undefined> {
  if (!VIDEO_ID.test(videoId)) return undefined;
  try {
    const r = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(videoId))}`,
      { signal: AbortSignal.timeout(8_000) },
    );
    if (!r.ok) return undefined;
    const d = (await r.json()) as { author_name?: string; author_url?: string };
    const handle = /youtube\.com\/(@[^/?#]+)/.exec(d.author_url || '')?.[1];
    return { channelName: d.author_name, channelHandle: handle && decodeURIComponent(handle) };
  } catch {
    return undefined;
  }
}
