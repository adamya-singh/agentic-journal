import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { readJson, writeJson, withLock, safeUrl, journalOrigin } from './store.ts';
import type { BookmarkSource, ConnectionFailure } from './types.ts';

const linkSchema = z.object({
  url: z.string().optional(),
  expanded_url: z.string().optional(),
  unwound_url: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  images: z.array(z.object({ url: z.string() })).optional(),
});
const entitiesSchema = z.object({ urls: z.array(linkSchema).optional() });
const noteSchema = z.object({ text: z.string(), entities: entitiesSchema.optional() });
const postSchema = z.object({
  id: z.string().regex(/^\d{1,19}$/),
  text: z.string(),
  author_id: z.string().optional(),
  created_at: z.string().optional(),
  note_post: noteSchema.optional(),
  note_tweet: noteSchema.optional(),
  entities: entitiesSchema.optional(),
  attachments: z.object({ media_keys: z.array(z.string()).max(4).optional() }).optional(),
});
const includesSchema = z.object({
  users: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        username: z.string().optional(),
        profile_image_url: z.string().optional(),
      }),
    )
    .optional(),
  media: z
    .array(
      z.object({
        media_key: z.string(),
        type: z.string(),
        url: z.string().optional(),
        preview_image_url: z.string().optional(),
        alt_text: z.string().optional(),
        width: z.number().optional(),
        height: z.number().optional(),
      }),
    )
    .optional(),
});
const pageSchema = z.object({
  data: z.array(postSchema).optional(),
  includes: includesSchema.optional(),
  meta: z.object({
    result_count: z.number().int().min(0),
    next_token: z.string().min(1).optional(),
  }),
  errors: z.array(z.unknown()).optional(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().finite().positive(),
});
type XPost = z.infer<typeof postSchema>;
type XIncludes = z.infer<typeof includesSchema>;

interface Credentials {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  accountId?: string;
  localKey?: string;
  pending?: { stateHash: string; verifier: string; expiresAt: number };
}
export const credentials = () => readJson<Credentials>('credentials.json', {});
export const appOrigin = journalOrigin;
export const callbackUrl = () => `${appOrigin()}/api/bookmarks/oauth/callback`;
export const configured = () => !!process.env.X_CLIENT_ID && !!process.env.X_CLIENT_SECRET;
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
export function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export async function localKey() {
  return withLock(() => {
    const c = credentials();
    if (!c.localKey) {
      c.localKey = randomBytes(32).toString('hex');
      writeJson('credentials.json', c);
    }
    return c.localKey;
  });
}
export async function beginOAuth() {
  if (!configured()) throw new Error('Set X_CLIENT_ID and X_CLIENT_SECRET on the server first.');
  const state = randomBytes(32).toString('base64url'),
    verifier = randomBytes(48).toString('base64url');
  await withLock(() => {
    const c = credentials();
    c.pending = { stateHash: digest(state), verifier, expiresAt: Date.now() + 600_000 };
    writeJson('credentials.json', c);
  });
  const url = new URL('https://x.com/i/oauth2/authorize');
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID!,
    redirect_uri: callbackUrl(),
    scope: 'bookmark.read tweet.read users.read offline.access',
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.href, state };
}
export type ConnectionStage =
  | 'authorize'
  | 'state'
  | 'busy'
  | 'token_exchange'
  | 'account_lookup'
  | 'account_mismatch'
  | 'storage';
export class XError extends Error {
  kind: string;
  status?: number;
  reason?: string;
  stage?: ConnectionStage;
  constructor(
    kind: string,
    message: string,
    detail: { status?: number; reason?: string; stage?: ConnectionStage } = {},
  ) {
    super(message);
    this.kind = kind;
    Object.assign(this, detail);
  }
}
// Only short identifier-like codes leave this module; raw X bodies, descriptions and details never do.
export function safeReason(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.startsWith('https://') ? value.slice(value.lastIndexOf('/') + 1) : value;
  return /^[A-Za-z][A-Za-z0-9 _.-]{0,59}$/.test(v) ? v : undefined;
}
function errorReason(body: unknown) {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>,
    first = Array.isArray(b.errors)
      ? (b.errors[0] as Record<string, unknown> | undefined)
      : undefined;
  const summary =
    safeReason(b.error) ||
    safeReason(b.title) ||
    safeReason(b.type) ||
    safeReason(first?.title) ||
    safeReason(first?.type);
  // X's specific code (e.g. client-not-enrolled) explains a generic title like "Client Forbidden".
  const code = safeReason(b.reason) || safeReason(first?.reason);
  return [summary, code !== summary && code].filter(Boolean).join(' - ') || undefined;
}
export async function xRequest(
  url: string,
  options: RequestInit = {},
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetcher(url, { ...options, signal: AbortSignal.timeout(30_000) });
  } catch (e) {
    const name = (e as Error)?.name;
    throw new XError('network', 'X could not be reached. Resume manually when ready.', {
      reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'unreachable',
    });
  }
  if (!response.ok) {
    const kind =
      response.status === 429
        ? 'rate_limit'
        : response.status === 402
          ? 'credits'
          : [401, 403].includes(response.status)
            ? 'authentication'
            : response.status === 400
              ? 'invalid_request'
              : 'upstream';
    const messages: Record<string, string> = {
      rate_limit: 'X rate limit reached. Resume manually later.',
      credits: 'X credits or spending limit reached. Check the Developer Console.',
      authentication: 'X access was denied. Reconnect your account or check app access.',
      invalid_request: 'X rejected the request or pagination cursor.',
      upstream: 'X returned an error. Resume manually later.',
    };
    const reason = errorReason(await response.json().catch(() => undefined));
    throw new XError(kind, messages[kind], { status: response.status, reason });
  }
  try {
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new XError('malformed', 'X returned an invalid response.', { status: response.status });
  }
}
async function exchange(params: Record<string, string>, fetcher: typeof fetch) {
  let body: Record<string, unknown>;
  try {
    body = await xRequest(
      'https://api.x.com/2/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64')}`,
        },
        body: new URLSearchParams(params).toString(),
      },
      fetcher,
    );
  } catch (e) {
    if (e instanceof XError && e.kind === 'invalid_request')
      throw new XError(
        'authentication',
        params.grant_type === 'authorization_code'
          ? 'X rejected the authorization code. Start Connect X again.'
          : 'X credentials could not be renewed. Reconnect your account.',
        { status: e.status, reason: e.reason },
      );
    throw e;
  }
  const token = tokenSchema.safeParse(body);
  if (!token.success)
    throw new XError('malformed', 'X returned invalid credentials.', {
      reason: `invalid_${String(token.error.issues[0]?.path[0] ?? 'body')}`,
    });
  return token.data;
}
export async function completeOAuth(
  code: string,
  state: string,
  cookie: string,
  fetcher: typeof fetch = fetch,
) {
  // Hold the store lock through exchange so a state is single-use and refreshes cannot overwrite it.
  return withLock(async () => {
    const c = credentials(),
      pending = c.pending;
    if (
      !code ||
      !pending ||
      pending.expiresAt < Date.now() ||
      !equal(state, cookie) ||
      !equal(digest(state), pending.stateHash)
    )
      throw new XError(
        'state',
        'Connection expired or could not be verified. Start Connect X again.',
        {
          stage: 'state',
          reason: !code
            ? 'missing_code'
            : !pending
              ? 'no_pending_request'
              : pending.expiresAt < Date.now()
                ? 'expired'
                : !equal(state, cookie)
                  ? 'cookie_mismatch'
                  : 'state_mismatch',
        },
      );
    delete c.pending;
    writeJson('credentials.json', c);
    const atStage = async <T>(stage: ConnectionStage, run: () => Promise<T>) => {
      try {
        return await run();
      } catch (e) {
        if (e instanceof XError) {
          e.stage = stage;
          throw e;
        }
        throw new XError('unexpected', 'X connection failed unexpectedly.', { stage });
      }
    };
    const token = await atStage('token_exchange', () =>
      exchange(
        {
          grant_type: 'authorization_code',
          code,
          redirect_uri: callbackUrl(),
          code_verifier: pending.verifier,
        },
        fetcher,
      ),
    );
    const userResponse = await atStage('account_lookup', () =>
      xRequest(
        'https://api.x.com/2/users/me',
        { headers: { Authorization: `Bearer ${token.access_token}` } },
        fetcher,
      ),
    );
    const parsedUser = z
      .object({ data: z.object({ id: z.string().regex(/^\d{1,19}$/), username: z.string() }) })
      .safeParse(userResponse);
    if (!parsedUser.success)
      throw new XError('malformed', 'X did not return a valid account.', {
        stage: 'account_lookup',
        status: 200,
        reason: errorReason(userResponse) || 'invalid_account_body',
      });
    const user = parsedUser.data;
    if (c.accountId && c.accountId !== user.data.id)
      throw new XError(
        'account_mismatch',
        'Connect the original X account. This collection supports one account.',
        { stage: 'account_mismatch' },
      );
    writeJson('credentials.json', {
      ...c,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + token.expires_in * 1000,
      accountId: user.data.id,
    });
    return { id: user.data.id as string, username: user.data.username as string };
  });
}
const stageLabels: Record<ConnectionStage, string> = {
  authorize: 'X did not authorize the app',
  state: 'The connection request could not be matched',
  busy: 'An import is in progress',
  token_exchange: 'X authorized the app, but exchanging the authorization code failed',
  account_lookup: 'X issued access, but the account lookup (GET /2/users/me) failed',
  account_mismatch: 'A different X account was authorized',
  storage: 'Credentials could not be saved',
};
function stageAdvice(e: XError) {
  if (e.stage === 'account_lookup' && e.kind === 'credits')
    return 'Add X API credits (or raise the spending limit) in the Developer Console, then connect again.';
  if (e.stage === 'account_lookup' && e.reason?.includes('client-not-enrolled'))
    return 'Attach the X app to a Project with v2 API access in the Developer Console, then connect again.';
  if (e.stage === 'account_lookup' && e.kind === 'authentication')
    return 'Check the app has Read permission with users.read and tweet.read, then connect again.';
  if (e.stage === 'token_exchange' && e.kind === 'authentication')
    return 'Check the Client ID/Secret and that the callback URL in the X app matches exactly, then connect again.';
  return e.message;
}
/** Converts any callback failure into a diagnostic safe to log, store and show. */
export function connectionFailure(e: unknown): ConnectionFailure {
  const at = new Date().toISOString();
  if (!(e instanceof XError) || !e.stage)
    return {
      stage: 'storage',
      message: `${stageLabels.storage}. Check local bookmark storage.`,
      at,
    };
  const detail = [e.status && `HTTP ${e.status}`, e.reason].filter(Boolean).join(', ');
  return {
    stage: e.stage,
    ...(e.status ? { status: e.status } : {}),
    ...(e.reason ? { reason: e.reason } : {}),
    message: `${stageLabels[e.stage]}${detail ? ` (${detail})` : ''}. ${stageAdvice(e)}`,
    at,
  };
}
export async function accessToken(fetcher: typeof fetch = fetch) {
  return withLock(async () => {
    const c = credentials();
    if (!c.accessToken) throw new XError('authentication', 'Connect your X account first.');
    if ((c.expiresAt || 0) > Date.now() + 60_000) return c.accessToken;
    if (!c.refreshToken) throw new XError('authentication', 'Reconnect X to renew access.');
    const t = await exchange(
      { grant_type: 'refresh_token', refresh_token: c.refreshToken },
      fetcher,
    );
    writeJson('credentials.json', {
      ...c,
      accessToken: t.access_token,
      refreshToken: t.refresh_token || c.refreshToken,
      expiresAt: Date.now() + t.expires_in * 1000,
    });
    return t.access_token as string;
  });
}
export async function fetchPage(
  accountId: string,
  cursor: string | undefined,
  limit: number,
  fetcher: typeof fetch = fetch,
) {
  const token = await accessToken(fetcher);
  const url = new URL(`https://api.x.com/2/users/${accountId}/bookmarks`);
  url.search = new URLSearchParams({
    max_results: String(limit),
    'post.fields': 'created_at,text,note_post,entities,attachments',
    expansions: 'author_id,attachments.media_keys',
    'user.fields': 'name,username,profile_image_url',
    'media.fields': 'type,url,preview_image_url,alt_text,width,height',
    ...(cursor ? { pagination_token: cursor } : {}),
  }).toString();
  const body = await xRequest(url.href, { headers: { Authorization: `Bearer ${token}` } }, fetcher);
  const parsedPage = pageSchema.safeParse(body);
  if (!parsedPage.success || parsedPage.data.errors?.length)
    throw new XError(
      'malformed',
      'X returned an incomplete page. Nothing from this page was saved.',
    );
  const parsed = parsedPage.data,
    data = parsed.data || [];
  if (data.length !== parsed.meta.result_count || data.length > limit)
    throw new XError('malformed', 'X returned invalid bookmark records.');
  return { data, includes: parsed.includes || {}, next: parsed.meta.next_token };
}
export function normalizePost(
  post: XPost,
  includes: XIncludes,
  accountId: string,
  importedAt: string,
): BookmarkSource {
  const author = (includes.users || []).find((u) => u.id === post.author_id);
  const entities = post.note_post?.entities || post.note_tweet?.entities || post.entities || {};
  const links = (entities.urls || []).flatMap((l) => {
    const url = safeUrl(l.unwound_url || l.expanded_url || l.url);
    return url
      ? [
          {
            url,
            domain: new URL(url).hostname,
            title: typeof l.title === 'string' ? l.title : undefined,
            description: typeof l.description === 'string' ? l.description : undefined,
            image: safeUrl(l.images?.[0]?.url),
          },
        ]
      : [];
  });
  return {
    id: post.id,
    accountId,
    text: post.note_post?.text || post.note_tweet?.text || post.text,
    url: `https://x.com/i/status/${post.id}`,
    importedAt,
    publishedAt: typeof post.created_at === 'string' ? post.created_at : undefined,
    author: {
      id: post.author_id || '',
      name: author?.name || 'X author',
      username: author?.username || '',
      avatar: safeUrl(author?.profile_image_url),
    },
    media: (post.attachments?.media_keys || []).flatMap((key: string) => {
      const m = (includes.media || []).find((v) => v.media_key === key);
      return m
        ? [
            {
              type: m.type,
              url: safeUrl(m.url),
              preview: safeUrl(m.preview_image_url),
              alt: typeof m.alt_text === 'string' ? m.alt_text : undefined,
              width: m.width,
              height: m.height,
            },
          ]
        : [];
    }),
    links,
  };
}
