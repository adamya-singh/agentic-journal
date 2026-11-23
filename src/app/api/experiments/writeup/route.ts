import { NextResponse } from 'next/server';
import { ExperimentError } from '@/lib/experiments/store';
import { readWriteup, writeWriteup } from '@/lib/experiments/writeups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const answer = (data: unknown) => NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
const refuse = (e: unknown) => NextResponse.json(
  { success: false, error: e instanceof Error ? e.message : 'The write-up could not be saved.' },
  { status: e instanceof ExperimentError ? e.status : 500 },
);

/** GET /api/experiments/writeup?id=53: the write-up of one experiment, or null. */
export async function GET(request: Request) {
  try { return answer(readWriteup(new URL(request.url).searchParams.get('id') ?? '')); } catch (e) { return refuse(e); }
}

/** PUT /api/experiments/writeup {id, writeup}: the whole write-up (lib/experiments/types.ts's Writeup, without `updated`), or null to remove it. */
export async function PUT(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { id?: unknown; writeup?: unknown } | null;
    if (!body || typeof body.id !== 'string' || body.writeup === undefined) throw new ExperimentError('Send {id, writeup}.');
    return answer(writeWriteup(body.id, body.writeup));
  } catch (e) { return refuse(e); }
}
