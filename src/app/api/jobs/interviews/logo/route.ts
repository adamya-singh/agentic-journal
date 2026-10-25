import fs from 'fs';
import { NextRequest, NextResponse } from 'next/server';
import { companyDomain } from '@/lib/company-domain';
import { cachedLogo, ensureLogo } from '@/lib/interviews/logos';
import { readInterviews } from '@/lib/interviews/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET ?domain=example.com → the company's logo, fetched once and kept on disk. 404 when none was found.
 * GET ?company=Acme&link=<posting url> resolves the domain from the curated map or the posting's own site.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const company = params.get('company');
  const domain = (company
    ? companyDomain(company, params.get('link') ?? undefined, readInterviews().domains) ?? ''
    : params.get('domain') ?? '').toLowerCase();
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
