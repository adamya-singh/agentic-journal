import test from 'node:test';
import assert from 'node:assert/strict';
import { waitReasons, type Chat, type Playing } from '../src/lib/deploy-queue.ts';

const at = (hhmm: string) => new Date(`2026-11-07T${hhmm}:00`);
const minutesBefore = (d: Date, m: number) => d.getTime() - m * 60_000;
const noon = at('12:00');
const ps4 = (minutes: number, paused = false): Playing => ({
  DeviceName: 'Switchfin for PS4',
  LastPlaybackCheckIn: new Date(minutesBefore(noon, minutes)).toISOString(),
  NowPlayingItem: { Name: 'Episode 3' },
  PlayState: { IsPaused: paused },
});
const chat = (key: string, minutes: number, kind?: string): Chat => ({ key, kind, updatedAt: minutesBefore(noon, minutes) });

test('a queued deploy runs when nothing plays and only automations ran', () => {
  const automations = [chat('agent:main:cron:abc', 1, 'cron'), chat('agent:main:main:heartbeat', 2)];
  assert.deepEqual(waitReasons(noon, [], automations), []);
  // A device that stopped playing still has a session, without NowPlayingItem.
  assert.deepEqual(waitReasons(noon, [{ DeviceName: 'Switchfin for PS4' }], []), []);
});

test('playback, paused playback and recent chats hold a deploy back', () => {
  assert.deepEqual(waitReasons(noon, [ps4(1)], []), ['Switchfin for PS4 is playing Episode 3']);
  assert.deepEqual(waitReasons(noon, [ps4(1, true)], []), ['Switchfin for PS4 is paused on Episode 3']);
  assert.deepEqual(waitReasons(noon, [], [chat('agent:main:ios-1', 5)]), [
    'OpenClaw chat agent:main:ios-1 was active 5 min ago',
  ]);
});

test('playback and chats older than the quiet period no longer count', () => {
  assert.deepEqual(waitReasons(noon, [ps4(16)], [chat('agent:main:dashboard:1', 16)]), []);
});

test('the 05:00 reboot window and unreadable sources hold a deploy back', () => {
  assert.deepEqual(waitReasons(at('04:15'), [], []), ['the 05:00 daily reboot is close']);
  assert.deepEqual(waitReasons(at('05:15'), [], []), []);
  assert.equal(waitReasons(noon, new Error('Jellyfin request failed (401).'), []).length, 1);
  assert.equal(waitReasons(noon, [], new Error('spawn openclaw ENOENT')).length, 1);
});
