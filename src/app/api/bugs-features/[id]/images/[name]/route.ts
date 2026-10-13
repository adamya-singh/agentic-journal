import { NextRequest, NextResponse } from 'next/server';
import { readImage } from '@/lib/bugs-features/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  const { id, name } = await params;
  const image = readImage(id, name);
  if (!image) return new NextResponse('Not found', { status: 404 });
  // Screenshot names are random and never reused, so each URL always means the same bytes.
  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.type,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
