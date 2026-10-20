import { NextRequest, NextResponse } from 'next/server';
import { readCaptureImage } from '@/lib/capture/images';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const image = readCaptureImage(name);
  if (!image) return new NextResponse('Not found', { status: 404 });
  // Image names are random and never reused, so each URL always means the same bytes.
  return new NextResponse(new Uint8Array(image.data), {
    headers: {
      'Content-Type': image.type,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
