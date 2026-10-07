import { NextResponse } from 'next/server';
import { getUptimeView } from '@/lib/uptime/monitor';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(
      { success: true, data: await getUptimeView() },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Uptime check failed:', error);
    return NextResponse.json({ success: false, error: 'Uptime could not be checked.' }, { status: 500 });
  }
}
