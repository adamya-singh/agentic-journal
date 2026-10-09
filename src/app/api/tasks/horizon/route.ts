import { after, NextResponse } from 'next/server';
import { loadHorizon } from './load';
import { scheduleBriefFills } from '../brief-agent/worker';

/**
 * GET /api/tasks/horizon
 * The home page's priority horizon: dated tasks sorted into zones (holds, next 48h, this week,
 * next week, later), undated items from the ranked Current queue, and what was cleared this week.
 * Also nudges the brief worker, so tasks on the Horizon get OpenClaw's fill in the background.
 */
export async function GET() {
  try {
    const data = loadHorizon();
    after(() => scheduleBriefFills());
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error building horizon:', error);
    return NextResponse.json({ success: false, error: 'Failed to build horizon' }, { status: 500 });
  }
}
