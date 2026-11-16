import { NextResponse } from 'next/server';
import { listOpenClawModels } from '@/lib/openclaw-agent';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/openclaw/models
 *   { models: [{ key, name, isDefault }], defaultKey }: the models OpenClaw is set up with, for the selector in a
 *   task's workspace. 503 when OpenClaw is not here or could not say.
 */
export async function GET() {
  const list = await listOpenClawModels();
  if (!list) return NextResponse.json({ success: false, error: 'OpenClaw’s models could not be read.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ success: true, data: list }, { headers: { 'Cache-Control': 'no-store' } });
}
