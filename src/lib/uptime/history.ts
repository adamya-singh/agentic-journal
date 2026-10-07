/**
 * Pure uptime bookkeeping: turning service timelines, probe samples and cron
 * runs into per-day stats, and per-day stats into Statuspage-style bars. No
 * I/O here so the monitor and the tests share the exact same arithmetic.
 */

export type ComponentStatus = 'operational' | 'degraded' | 'partial' | 'major' | 'paused' | 'unknown';
export type BarLevel = 'none' | 'ok' | 'minor' | 'partial' | 'major';

/** Time-based components fill up/degraded/down (ms); cron jobs fill run counts. */
export interface DayStat {
  up: number;
  degraded: number;
  down: number;
  ok?: number;
  error?: number;
  skipped?: number;
  notes?: string[];
}

export type DayMap = Record<string, DayStat>;

export interface DayBar {
  date: string;
  level: BarLevel;
  /** 0–1, or null when nothing was observed that day. */
  uptime: number | null;
  notes: string[];
  summary: string;
}

export const MAX_NOTES_PER_DAY = 6;

export function localDateKey(ms: number): string {
  const date = new Date(ms);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function nextLocalMidnight(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

/** The last `count` local dates ending today, oldest first. */
export function recentDateKeys(nowMs: number, count: number): string[] {
  const today = new Date(nowMs);
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset, 12);
    keys.push(localDateKey(day.getTime()));
  }
  return keys;
}

export function emptyDay(): DayStat {
  return { up: 0, degraded: 0, down: 0 };
}

export function addNote(day: DayStat, note: string): void {
  const notes = day.notes ?? [];
  if (notes.includes(note)) return;
  if (notes.length >= MAX_NOTES_PER_DAY) {
    notes[MAX_NOTES_PER_DAY - 1] = 'More events this day';
  } else {
    notes.push(note);
  }
  day.notes = notes;
}

function dayFor(days: DayMap, key: string): DayStat {
  days[key] ??= emptyDay();
  return days[key];
}

// --- systemd timelines -------------------------------------------------------

export type UnitState = 'up' | 'down';

export interface UnitEvent {
  at: number;
  unit: string;
  state?: UnitState;
  note?: string;
}

export interface Segment {
  start: number;
  end: number;
  state: UnitState;
}

export interface BootWindow {
  start: number;
  end: number;
}

/**
 * Systemd's own messages about a unit → state changes. Only job completions
 * and terminal results count; "Starting…" / "Stopping…" are transitional.
 */
export function classifyUnitMessage(entry: {
  JOB_TYPE?: string;
  JOB_RESULT?: string;
  MESSAGE?: string;
}): Pick<UnitEvent, 'state' | 'note'> | null {
  const message = typeof entry.MESSAGE === 'string' ? entry.MESSAGE : '';
  if ((entry.JOB_TYPE === 'start' || entry.JOB_TYPE === 'restart') && entry.JOB_RESULT === 'done') {
    return { state: 'up' };
  }
  if (entry.JOB_TYPE === 'start' && entry.JOB_RESULT && entry.JOB_RESULT !== 'done') {
    return { state: 'down', note: `Failed to start (${entry.JOB_RESULT})` };
  }
  if (entry.JOB_TYPE === 'stop' && entry.JOB_RESULT === 'done') {
    return { state: 'down', note: 'Stopped' };
  }
  const failed = message.match(/Failed with result '([^']+)'/);
  if (failed) {
    return { state: 'down', note: `Crashed (${failed[1]})` };
  }
  if (message.includes('Deactivated successfully')) {
    return { state: 'down' };
  }
  if (message.includes('killed by the OOM killer')) {
    return { note: 'Process killed by the OOM killer' };
  }
  return null;
}

/**
 * Union timeline for a component backed by one or more units: up while any
 * unit is up. A unit is unknown until its first event (so a unit installed
 * last week is "no data" before that, not "down"), and every reboot resets
 * known units to down until systemd starts them again.
 */
export function unionTimeline(events: UnitEvent[], boots: BootWindow[]): Segment[] {
  const sorted = events.filter((event) => event.state).sort((a, b) => a.at - b.at);
  const segments: Segment[] = [];
  const states = new Map<string, UnitState>();
  let cursor = 0;

  const push = (start: number, end: number) => {
    if (end <= start || states.size === 0) return;
    const state: UnitState = [...states.values()].includes('up') ? 'up' : 'down';
    const last = segments[segments.length - 1];
    if (last && last.state === state && last.end === start) {
      last.end = end;
    } else {
      segments.push({ start, end, state });
    }
  };

  for (const boot of [...boots].sort((a, b) => a.start - b.start)) {
    for (const unit of states.keys()) states.set(unit, 'down');
    let position = boot.start;
    while (cursor < sorted.length && sorted[cursor].at < boot.start) cursor += 1;
    while (cursor < sorted.length && sorted[cursor].at <= boot.end) {
      const event = sorted[cursor];
      push(position, event.at);
      states.set(event.unit, event.state as UnitState);
      position = event.at;
      cursor += 1;
    }
    push(position, boot.end);
  }
  return segments;
}

/** Splits segments at local midnights and adds their durations to day stats. */
export function addSegmentsToDays(days: DayMap, segments: Segment[]): DayMap {
  for (const segment of segments) {
    let start = segment.start;
    while (start < segment.end) {
      const end = Math.min(segment.end, nextLocalMidnight(start));
      dayFor(days, localDateKey(start))[segment.state] += end - start;
      start = end;
    }
  }
  return days;
}

export function addEventNotesToDays(days: DayMap, events: UnitEvent[]): void {
  const oomCounts = new Map<string, number>();
  for (const event of events) {
    if (!event.note) continue;
    const key = localDateKey(event.at);
    if (event.note.includes('OOM')) {
      oomCounts.set(key, (oomCounts.get(key) ?? 0) + 1);
      continue;
    }
    addNote(dayFor(days, key), `${formatClock(event.at)} — ${event.note}`);
  }
  for (const [key, count] of oomCounts) {
    addNote(dayFor(days, key), `${count} process${count === 1 ? '' : 'es'} killed by the OOM killer`);
  }
}

// --- probe samples & cron runs ----------------------------------------------

export function addSample(days: DayMap, atMs: number, elapsedMs: number, status: ComponentStatus): void {
  if (status === 'unknown' || status === 'paused' || elapsedMs <= 0) return;
  const day = dayFor(days, localDateKey(atMs));
  if (status === 'operational') day.up += elapsedMs;
  else if (status === 'degraded') day.degraded += elapsedMs;
  else day.down += elapsedMs;
}

export interface CronRun {
  at: number;
  status: string;
  error?: string;
}

export function addCronRun(days: DayMap, run: CronRun): void {
  const day = dayFor(days, localDateKey(run.at));
  if (run.status === 'ok') day.ok = (day.ok ?? 0) + 1;
  else if (run.status === 'error') {
    day.error = (day.error ?? 0) + 1;
    addNote(day, `${formatClock(run.at)} — ${truncate(run.error || 'Run failed', 120)}`);
  } else day.skipped = (day.skipped ?? 0) + 1;
}

// --- bars & percentages -----------------------------------------------------

export function dayUptime(day: DayStat | undefined): number | null {
  if (!day) return null;
  const runs = (day.ok ?? 0) + (day.error ?? 0);
  if (runs > 0) return (day.ok ?? 0) / runs;
  const observed = day.up + day.degraded + day.down;
  return observed > 0 ? (day.up + day.degraded) / observed : null;
}

export function levelFor(uptime: number | null, hadDegradation = false): BarLevel {
  if (uptime === null) return 'none';
  if (uptime >= 0.999) return hadDegradation ? 'minor' : 'ok';
  if (uptime >= 0.98) return 'minor';
  if (uptime >= 0.9) return 'partial';
  return 'major';
}

function describeDay(day: DayStat | undefined, uptime: number | null): string {
  if (!day || uptime === null) return 'No data exists for this day.';
  const runs = (day.ok ?? 0) + (day.error ?? 0);
  if (runs > 0) {
    if (!day.error) return `All ${runs} run${runs === 1 ? '' : 's'} succeeded.`;
    return `${day.error} of ${runs} run${runs === 1 ? '' : 's'} failed.`;
  }
  const parts: string[] = [];
  if (day.down > 0) parts.push(`${formatDuration(day.down)} down`);
  if (day.degraded > 0) parts.push(`${formatDuration(day.degraded)} degraded`);
  return parts.length ? parts.join(', ') + '.' : 'No downtime recorded on this day.';
}

export function buildBars(days: DayMap, dateKeys: string[]): DayBar[] {
  return dateKeys.map((date) => {
    const day = days[date];
    const uptime = dayUptime(day);
    return {
      date,
      uptime,
      level: levelFor(uptime, (day?.degraded ?? 0) > 0),
      notes: day?.notes ?? [],
      summary: describeDay(day, uptime),
    };
  });
}

/** Overall uptime across a window, weighting each day by what was observed. */
export function windowUptime(days: DayMap, dateKeys: string[]): number | null {
  let runsOk = 0;
  let runs = 0;
  let upMs = 0;
  let observedMs = 0;
  for (const key of dateKeys) {
    const day = days[key];
    if (!day) continue;
    runsOk += day.ok ?? 0;
    runs += (day.ok ?? 0) + (day.error ?? 0);
    upMs += day.up + day.degraded;
    observedMs += day.up + day.degraded + day.down;
  }
  if (runs > 0) return runsOk / runs;
  return observedMs > 0 ? upMs / observedMs : null;
}

const LEVEL_RANK: Record<BarLevel, number> = { none: 0, ok: 1, minor: 2, partial: 3, major: 4 };

/** A group's bar for one day: average uptime of members with data, colored no better than its worst member. */
export function combineBars(memberBars: DayBar[][], dateKeys: string[]): DayBar[] {
  return dateKeys.map((date, index) => {
    const bars = memberBars.map((bars) => bars[index]).filter((bar) => bar && bar.uptime !== null);
    if (bars.length === 0) {
      return { date, uptime: null, level: 'none', notes: [], summary: 'No data exists for this day.' };
    }
    const uptime = bars.reduce((sum, bar) => sum + (bar.uptime as number), 0) / bars.length;
    const worst = bars.reduce<BarLevel>(
      (level, bar) => (LEVEL_RANK[bar.level] > LEVEL_RANK[level] ? bar.level : level),
      'ok',
    );
    const averaged = levelFor(uptime);
    return {
      date,
      uptime,
      level: LEVEL_RANK[worst] > LEVEL_RANK[averaged] ? worst : averaged,
      notes: [],
      summary: '',
    };
  });
}

const STATUS_RANK: Record<ComponentStatus, number> = {
  unknown: 0,
  paused: 0,
  operational: 1,
  degraded: 2,
  partial: 3,
  major: 4,
};

export function worstStatus(statuses: ComponentStatus[]): ComponentStatus {
  return statuses.reduce<ComponentStatus>(
    (worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst),
    'operational',
  );
}

// --- formatting ----------------------------------------------------------------

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '<1 min';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
