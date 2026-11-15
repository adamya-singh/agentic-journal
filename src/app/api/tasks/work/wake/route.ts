import { NextResponse } from 'next/server';
import { wakeState, wakeTaskWorker, type WakeResult } from '../cron';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** What a wake came to, in words for the brief's strip. */
const WAKE_WORDS: Record<WakeResult['decision'], string> = {
  wake: 'OpenClaw is starting now',
  running: 'OpenClaw is on a run already; this is next in line',
  throttled: 'OpenClaw was just started; give it a moment',
  'backed-off': 'OpenClaw was just started; give it a moment',
  'browser-busy': 'OpenClaw’s browser is in use (a job application, or you); it starts when that is free',
  nothing: 'Nothing is in line for OpenClaw right now',
  disabled: 'The task worker is switched off on this server',
  'no-cli': 'OpenClaw is not reachable from here',
  'no-job': 'OpenClaw’s task worker is not set up; it is set up on the next check',
  'cron-disabled': 'The task worker is turned off in OpenClaw',
  failed: 'OpenClaw could not be started; the Journal tries again within five minutes',
};

/**
 * POST /api/tasks/work/wake → { decision, said }. Adamya's "Start now": starts a run of the task worker at once
 * instead of at the next five-minute check. His press skips the wait after an earlier wake; everything else that
 * holds a run back (one already going, the browser in use, nothing to claim) still does. The run takes the first
 * task in line, which is the one he handed over last only when nothing is ahead of it.
 */
export async function POST() {
  const state = wakeState();
  if (!state.inFlight) Object.assign(state, { lastWakeAt: 0, backoffUntil: 0, wakeSettled: true });
  const result = await wakeTaskWorker();
  return NextResponse.json({ success: true, data: { decision: result.decision, said: WAKE_WORDS[result.decision] } });
}
