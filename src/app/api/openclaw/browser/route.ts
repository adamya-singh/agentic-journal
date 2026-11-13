import { createHash } from 'crypto';
import { hostname } from 'os';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  captureBrowserFrame,
  closeBrowserTab,
  endManualBrowserSession,
  listBrowserTabs,
  openBrowserUrl,
  OpenClawBrowserError,
  resetBrowserViewports,
  sendBrowserInput,
  showBrowserTab,
  setBrowserViewport,
  touchManualBrowserSession,
} from '@/lib/openclaw-browser';
import { fromThisApp } from '@/lib/same-origin';
import { pageKey, safeWebUrl } from '@/lib/task-surfaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// OpenClaw's browser, for any page: the same bridge the job applications use (lib/openclaw-browser.ts), without a
// job posting behind it. A task's workspace shows its links here. These routes drive a real, signed-in browser,
// so they answer only this app's own pages, and only ever send the browser to http and https addresses.

const InputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('click'), x: z.number().finite(), y: z.number().finite() }),
  z.object({ type: z.literal('scroll'), x: z.number().finite(), y: z.number().finite(), deltaY: z.number().finite() }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(5000) }),
  z.object({
    type: z.literal('key'), key: z.string().min(1).max(20),
    ctrl: z.boolean().optional(), shift: z.boolean().optional(), alt: z.boolean().optional(), meta: z.boolean().optional(),
  }),
  z.object({ type: z.literal('navigate'), url: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal('back') }),
  z.object({ type: z.literal('forward') }),
  z.object({ type: z.literal('reload') }),
]);

const ActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open'), url: z.string().trim().min(1).max(2000) }),
  z.object({ action: z.literal('tabs') }),
  z.object({ action: z.literal('input'), targetId: z.string().min(1).max(200), input: InputSchema }),
  // Lay the page out for the space he sees it in; without a size, the tab gets its own window size back.
  z.object({
    action: z.literal('viewport'), targetId: z.string().min(1).max(200),
    width: z.number().int().min(320).max(2560).optional(), height: z.number().int().min(240).max(2000).optional(),
  }),
  z.object({ action: z.literal('show'), targetId: z.string().min(1).max(200) }),
  z.object({ action: z.literal('close'), targetIds: z.array(z.string().min(1).max(200)).min(1).max(40) }),
  z.object({ action: z.literal('end'), close: z.array(z.string().min(1).max(200)).max(40).optional() }),
]);

const refused = () => NextResponse.json({ success: false, error: 'Only the Journal’s own pages can use OpenClaw’s browser' }, { status: 403 });

/**
 * GET /api/openclaw/browser?targetId=<tab>[&have=<frame id>]
 * The live picture of one tab (a JPEG), with what the viewer needs to map clicks back onto it in the headers.
 * When the picture is the one the viewer already has (`have`), 204 with the same headers and no body.
 */
export async function GET(request: NextRequest) {
  if (!fromThisApp(request.headers)) return refused();
  const targetId = request.nextUrl.searchParams.get('targetId');
  if (!targetId) return NextResponse.json({ success: false, error: 'targetId is required' }, { status: 400 });
  try {
    // He is looking at the browser: the application worker waits (see touchManualBrowserSession).
    touchManualBrowserSession('workspace');
    const frame = await captureBrowserFrame(targetId);
    const frameId = createHash('sha1').update(frame.jpeg).digest('hex').slice(0, 16);
    const headers = {
      'Cache-Control': 'no-store',
      'X-Frame-Id': frameId,
      'X-Page-Url': encodeURIComponent(frame.url),
      'X-Page-Title': encodeURIComponent(frame.title),
      'X-Viewport-Width': String(frame.width),
      'X-Viewport-Height': String(frame.height),
    };
    if (request.nextUrl.searchParams.get('have') === frameId) return new NextResponse(null, { status: 204, headers });
    return new NextResponse(new Uint8Array(frame.jpeg), { headers: { ...headers, 'Content-Type': 'image/jpeg' } });
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST /api/openclaw/browser
 * { action: 'open', url }               a tab on that page (the one already open there, else a new one)
 *                                       → { targetId, url, title, host, created }; `created` is true when the Journal made the tab
 * { action: 'show', targetId }           bring a tab he comes back to to the front, so it has a picture to give
 * { action: 'close', targetIds }        close tabs the Journal made; one that was already open before is left alone → { closed, kept }
 * { action: 'tabs' }                    the pages open in OpenClaw's browser → { tabs, host }
 * { action: 'input', targetId, input }  a click, scroll, typing, a key, or navigate / back / forward / reload
 * { action: 'viewport', targetId, width?, height? }
 *                                       lay the page out for a window that size while he is viewing it; no size puts it back
 * { action: 'end', close? }             he is done: the application worker gets its browser back, any size set with
 *                                       'viewport' is undone, and the tabs in `close` that the Journal made are closed
 * `host` is the machine the browser runs on.
 */
export async function POST(request: NextRequest) {
  if (!fromThisApp(request.headers)) return refused();
  try {
    const parsed = ActionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.errors[0]?.message ?? 'Invalid browser action' }, { status: 400 });
    }
    const body = parsed.data;
    if (body.action === 'end') {
      for (const id of body.close ?? []) await closeBrowserTab(id).catch(() => false);
      await resetBrowserViewports();
      endManualBrowserSession('workspace');
      return NextResponse.json({ success: true });
    }
    if (body.action === 'close') {
      const closed: string[] = [];
      const kept: string[] = [];
      for (const id of body.targetIds) ((await closeBrowserTab(id)) ? closed : kept).push(id);
      return NextResponse.json({ success: true, closed, kept });
    }
    if (body.action === 'tabs') {
      const tabs = (await listBrowserTabs()).filter((tab) => /^https?:\/\//i.test(tab.url));
      return NextResponse.json({ success: true, tabs, host: hostname() });
    }
    touchManualBrowserSession('workspace');
    if (body.action === 'open') {
      const url = safeWebUrl(body.url);
      if (url === null) return NextResponse.json({ success: false, error: 'That is not a web address' }, { status: 400 });
      const tab = await openBrowserUrl(url, (a, b) => pageKey(a) === pageKey(b));
      return NextResponse.json({ success: true, targetId: tab.id, url: tab.url, title: tab.title, host: hostname(), created: tab.created });
    }
    if (body.action === 'show') {
      await showBrowserTab(body.targetId);
      return NextResponse.json({ success: true });
    }
    if (body.action === 'viewport') {
      const size = body.width && body.height ? { width: body.width, height: body.height } : null;
      try {
        await setBrowserViewport(body.targetId, size);
      } catch (error) {
        // A tab that is already gone (the workspace closed it as he left) has no size to put back.
        if (size !== null || !(error instanceof OpenClawBrowserError)) throw error;
      }
      return NextResponse.json({ success: true });
    }
    let input = body.input;
    if (input.type === 'navigate') {
      const url = safeWebUrl(input.url);
      if (url === null) return NextResponse.json({ success: false, error: 'That is not a web address' }, { status: 400 });
      input = { type: 'navigate', url };
    }
    await sendBrowserInput(body.targetId, input);
    return NextResponse.json({ success: true });
  } catch (error) {
    return failure(error);
  }
}

function failure(error: unknown) {
  const known = error instanceof OpenClawBrowserError;
  if (!known) console.error('OpenClaw browser bridge failed:', error);
  return NextResponse.json(
    { success: false, error: known ? error.message : 'OpenClaw’s browser could not be reached', unreachable: true },
    { status: known ? 502 : 500 },
  );
}
