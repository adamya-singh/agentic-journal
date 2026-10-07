import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addCronRun,
  addSample,
  addSegmentsToDays,
  buildBars,
  classifyUnitMessage,
  combineBars,
  levelFor,
  localDateKey,
  recentDateKeys,
  unionTimeline,
  windowUptime,
  type DayMap,
  type UnitEvent,
} from '../src/lib/uptime/history';

const at = (local: string) => new Date(local).getTime();
const HOUR = 60 * 60 * 1000;

test('systemd messages map to up/down transitions', () => {
  assert.deepEqual(classifyUnitMessage({ JOB_TYPE: 'start', JOB_RESULT: 'done', MESSAGE: 'Started x' }), { state: 'up' });
  assert.equal(classifyUnitMessage({ JOB_TYPE: 'start', MESSAGE: 'Starting x...' }), null);
  assert.equal(classifyUnitMessage({ JOB_TYPE: 'stop', JOB_RESULT: 'done' })?.state, 'down');
  assert.deepEqual(classifyUnitMessage({ MESSAGE: "x.service: Failed with result 'exit-code'." }), {
    state: 'down',
    note: 'Crashed (exit-code)',
  });
  assert.equal(classifyUnitMessage({ MESSAGE: 'x.service: A process of this unit has been killed by the OOM killer.' })?.state, undefined);
});

test('a multi-unit component is up while any unit is up, and unknown before its first event', () => {
  const boot = { start: at('2026-10-01T00:00:00'), end: at('2026-10-01T12:00:00') };
  const events: UnitEvent[] = [
    { at: at('2026-10-01T02:00:00'), unit: 'prod', state: 'up' },
    { at: at('2026-10-01T04:00:00'), unit: 'dev', state: 'up' },
    { at: at('2026-10-01T05:00:00'), unit: 'prod', state: 'down' },
    { at: at('2026-10-01T06:00:00'), unit: 'dev', state: 'down' },
    { at: at('2026-10-01T09:00:00'), unit: 'prod', state: 'up' },
  ];
  const days = addSegmentsToDays({}, unionTimeline(events, [boot]));
  const day = days['2026-10-01'];
  assert.equal(day.up, 7 * HOUR); // 02–06 and 09–12
  assert.equal(day.down, 3 * HOUR); // 06–09; 00–02 is before any event, so no data
});

test('reboots reset known units to down and time between boots is no data', () => {
  const boots = [
    { start: at('2026-10-01T00:00:00'), end: at('2026-10-01T10:00:00') },
    { start: at('2026-10-01T14:00:00'), end: at('2026-10-01T20:00:00') },
  ];
  const events: UnitEvent[] = [
    { at: at('2026-10-01T01:00:00'), unit: 'worker', state: 'up' },
    { at: at('2026-10-01T15:00:00'), unit: 'worker', state: 'up' },
  ];
  const day = addSegmentsToDays({}, unionTimeline(events, boots))['2026-10-01'];
  assert.equal(day.up, 9 * HOUR + 5 * HOUR);
  assert.equal(day.down, 1 * HOUR); // 14:00 boot until 15:00 start
});

test('segments are split at local midnight', () => {
  const days = addSegmentsToDays({}, [
    { start: at('2026-10-01T22:00:00'), end: at('2026-10-02T03:00:00'), state: 'up' },
  ]);
  assert.equal(days['2026-10-01'].up, 2 * HOUR);
  assert.equal(days['2026-10-02'].up, 3 * HOUR);
});

test('cron runs become run-based uptime with failure notes', () => {
  const days: DayMap = {};
  addCronRun(days, { at: at('2026-10-01T08:00:00'), status: 'ok' });
  addCronRun(days, { at: at('2026-10-01T12:00:00'), status: 'error', error: 'Ls failed' });
  addCronRun(days, { at: at('2026-10-01T18:00:00'), status: 'skipped' });
  const [bar] = buildBars(days, ['2026-10-01']);
  assert.equal(bar.uptime, 0.5);
  assert.equal(bar.level, 'major');
  assert.equal(bar.summary, '1 of 2 runs failed.');
  assert.deepEqual(bar.notes, ['12:00 — Ls failed']);
});

test('bar levels, empty days, and window uptime', () => {
  assert.equal(levelFor(null), 'none');
  assert.equal(levelFor(1), 'ok');
  assert.equal(levelFor(1, true), 'minor');
  assert.equal(levelFor(0.99), 'minor');
  assert.equal(levelFor(0.95), 'partial');
  assert.equal(levelFor(0.5), 'major');

  const days: DayMap = {};
  addSample(days, at('2026-10-01T10:00:00'), 99 * HOUR, 'operational');
  addSample(days, at('2026-10-02T10:00:00'), 1 * HOUR, 'major');
  addSample(days, at('2026-10-02T11:00:00'), 1 * HOUR, 'unknown');
  const keys = ['2026-09-30', '2026-10-01', '2026-10-02'];
  const bars = buildBars(days, keys);
  assert.equal(bars[0].level, 'none');
  assert.equal(bars[0].summary, 'No data exists for this day.');
  assert.equal(bars[1].summary, 'No downtime recorded on this day.');
  assert.equal(bars[2].uptime, 0);
  assert.equal(windowUptime(days, keys), 0.99);
});

test('group bars average members but never look better than the worst member', () => {
  const keys = ['2026-10-01'];
  const good = buildBars({ '2026-10-01': { up: 100, degraded: 0, down: 0 } }, keys);
  const bad = buildBars({ '2026-10-01': { up: 0, degraded: 0, down: 100 } }, keys);
  const empty = buildBars({}, keys);
  const [combined] = combineBars([good, bad, empty], keys);
  assert.equal(combined.uptime, 0.5);
  assert.equal(combined.level, 'major');
});

test('recent date keys end today in local time', () => {
  const now = at('2026-10-07T00:30:00');
  const keys = recentDateKeys(now, 90);
  assert.equal(keys.length, 90);
  assert.equal(keys[89], localDateKey(now));
  assert.equal(keys[89], '2026-10-07');
  assert.equal(keys[0], '2026-07-10');
});
