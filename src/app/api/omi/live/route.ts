import * as fs from 'fs';
import * as path from 'path';
import { NextResponse } from 'next/server';
import { getLocalDateString, getOmiAudioDataDir } from '../audio/audio-store-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The manifest gets one appended line per accepted chunk, so its mtime is the newest
// audio arrival. Statting it keeps this cheap enough for the Transcripts page to poll
// every few seconds as its "is the Omi connected" signal.
export async function GET() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  // Yesterday's manifest covers the minutes after local midnight.
  const dates = Array.from(new Set([getLocalDateString(now), getLocalDateString(yesterday)]));

  let newestAudioAt: Date | null = null;
  for (const date of dates) {
    try {
      const { mtime } = fs.statSync(path.join(getOmiAudioDataDir(), date, 'manifest.jsonl'));
      if (!newestAudioAt || mtime > newestAudioAt) {
        newestAudioAt = mtime;
      }
    } catch {
      // No audio for that day.
    }
  }

  return NextResponse.json(
    {
      success: true,
      newestAudioAt: newestAudioAt?.toISOString() ?? null,
      checkedAt: now.toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
