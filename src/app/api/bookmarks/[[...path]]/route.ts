import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  listBookmarks,
  getBookmark,
  updateBookmark,
  withLock,
  readState,
  writeJson,
} from '@/lib/bookmarks/store';
import {
  appOrigin,
  beginOAuth,
  completeOAuth,
  connectionFailure,
  credentials,
  equal,
  safeReason,
  XError,
} from '@/lib/bookmarks/x-client';
import { status, startSync, cancelSync, settings, importFolders } from '@/lib/bookmarks/sync';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const result = (data: unknown, code = 200) =>
  NextResponse.json(
    { success: true, data },
    { status: code, headers: { 'Cache-Control': 'no-store' } },
  );
function authorized(req: NextRequest) {
  const origin = req.headers.get('origin');
  if (origin)
    return [appOrigin(), 'http://127.0.0.1:3000', 'http://localhost:3000'].includes(origin);
  const token = credentials().localKey;
  return !!token && equal(req.headers.get('authorization') || '', `Bearer ${token}`);
}
export async function GET(req: NextRequest) {
  const action = req.nextUrl.pathname.replace('/api/bookmarks', '').replace(/^\//, '');
  try {
    if (action === 'oauth/callback') {
      const target = new URL('/bookmarks', appOrigin());
      try {
        const denied = req.nextUrl.searchParams.get('error');
        if (denied)
          throw new XError('authorize', 'Authorization was cancelled or denied on X.', {
            stage: 'authorize',
            reason: safeReason(denied) || 'error',
          });
        if (['queued', 'running'].includes(readState().job?.status || ''))
          throw new XError('busy', 'Cancel the current import before reconnecting.', {
            stage: 'busy',
          });
        const user = await completeOAuth(
          req.nextUrl.searchParams.get('code') || '',
          req.nextUrl.searchParams.get('state') || '',
          req.cookies.get('x_bookmarks_state')?.value || '',
        );
        await withLock(() => {
          const s = readState();
          s.accountId = user.id;
          s.username = user.username;
          delete s.lastConnectionError;
          writeJson('state.json', s);
        });
        target.searchParams.set('connected', 'true');
      } catch (e) {
        const failure = connectionFailure(e);
        // Sanitized fields only: never the callback query, cookies or X response bodies.
        console.warn(
          `[bookmarks] X connection failed stage=${failure.stage} status=${failure.status ?? '-'} reason=${failure.reason ?? '-'}`,
        );
        await withLock(() => {
          const s = readState();
          s.lastConnectionError = failure;
          writeJson('state.json', s);
        }).catch(() => undefined);
        target.searchParams.set('connection_error', failure.stage);
      }
      const response = NextResponse.redirect(target);
      response.cookies.set('x_bookmarks_state', '', {
        maxAge: 0,
        path: '/api/bookmarks/oauth',
        httpOnly: true,
        secure: appOrigin().startsWith('https:'),
        sameSite: 'lax',
      });
      return response;
    }
    if (!action) return result(listBookmarks(req.nextUrl.searchParams));
    if (action === 'status') return result(status());
    if (action === 'item') {
      const item = getBookmark(req.nextUrl.searchParams.get('key') || '');
      return item
        ? result(item)
        : NextResponse.json({ success: false, error: 'Bookmark not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: false, error: 'Not found.' }, { status: 404 });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Bookmarks could not be loaded. Check local storage.' },
      { status: 500 },
    );
  }
}
export async function POST(req: NextRequest) {
  if (!authorized(req))
    return NextResponse.json(
      { success: false, error: 'A same-origin request or local CLI token is required.' },
      { status: 403 },
    );
  const action = req.nextUrl.pathname.replace('/api/bookmarks/', '');
  try {
    if (action === 'oauth/start') {
      if (['queued', 'running'].includes(readState().job?.status || ''))
        throw new Error('Cancel the current import before reconnecting.');
      const auth = await beginOAuth();
      const response = result({ url: auth.url });
      response.cookies.set('x_bookmarks_state', auth.state, {
        maxAge: 600,
        httpOnly: true,
        secure: appOrigin().startsWith('https:'),
        sameSite: 'lax',
        path: '/api/bookmarks/oauth',
      });
      return response;
    }
    if (action === 'sync' || action === 'resume')
      return result({ jobId: await startSync(action === 'resume') }, 202);
    if (action === 'folders') return result(await importFolders());
    if (action === 'cancel') {
      await cancelSync();
      return result(status());
    }
    if (action === 'settings') {
      const update = z
        .object({ budgetConfirmed: z.boolean().optional(), pilotReviewed: z.boolean().optional() })
        .strict()
        .parse(await req.json());
      await settings(update);
      return result(status());
    }
    if (action === 'item') {
      const body = z
        .object({
          key: z.string().regex(/^\d+:\d+$/),
          favorite: z.boolean().optional(),
          read: z.boolean().optional(),
          tags: z
            .array(z.string().trim().min(1).max(40))
            .max(30)
            .transform((v) => [...new Set(v)])
            .optional(),
        })
        .strict()
        .parse(await req.json());
      const { key, ...update } = body;
      return result(await updateBookmark(key, update));
    }
    return NextResponse.json({ success: false, error: 'Not found.' }, { status: 404 });
  } catch (e) {
    return NextResponse.json(
      {
        success: false,
        error:
          e instanceof z.ZodError || e instanceof SyntaxError
            ? 'Invalid bookmark request.'
            : e instanceof Error
              ? e.message
              : 'Bookmark action failed.',
      },
      { status: 400 },
    );
  }
}
