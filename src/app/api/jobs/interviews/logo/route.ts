import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { cachedLogo, ensureLogo } from '@/lib/interviews/logos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?domain=example.com → the company's logo, fetched once and kept on disk. 404 when none was found. */
export async function GET(request: NextRequest) {
  const domain = (request.nextUrl.searchParams.get('domain') ?? '').toLowerCase();
  const cached = cachedLogo(domain);
  const logo = cached === 'miss' ? undefined : cached ?? (await ensureLogo(domain));
  if (!logo) return new NextResponse(null, { status: 404, headers: { 'cache-control': 'public, max-age=3600' } });
  return new NextResponse(fs.readFileSync(logo.file), {
    headers: {
      'content-type': logo.type,
      'cache-control': 'public, max-age=604800',
      'x-content-type-options': 'nosniff',
      // SVGs come from other sites: never let one run script on this origin.
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    },
  });
}
