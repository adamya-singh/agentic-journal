import { after, NextResponse } from 'next/server';
import { scheduleBriefFills } from '../brief-agent/worker';
import { loadSunrise } from './load';

/**
 * GET /api/tasks/sunrise
 * Everything the Sunrise hero on the home page draws, in one request: the Horizon (as /api/tasks/horizon), what
 * each task's form shows (from its hook when OpenClaw has started it, else from the rules' brief), Today's list,
 * the Current ranks and which tasks he has opened. Also nudges the brief worker, as the Horizon route does.
 */
export async function GET() {
  try {
    const data = loadSunrise();
    after(() => scheduleBriefFills());
    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error building sunrise:', error);
    return NextResponse.json({ success: false, error: 'Failed to build sunrise' }, { status: 500 });
  }
}
