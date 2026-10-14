// Calendar-date helpers for the compass. Dates are New York calendar days written as YYYY-MM-DD
// and compared as strings; nothing here builds a local-midnight Date or slices toISOString().
import type { CompassStatus } from './types.ts';

export const NEW_YORK_TZ = 'America/New_York';
const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Today's calendar date in New York (en-CA formats as YYYY-MM-DD). */
export function todayInNewYork(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NEW_YORK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = ISO_DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const utc = new Date(Date.UTC(y, mo - 1, d));
  return utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
}

/** Whole days since the epoch for an ISO date, via Date.UTC so DST never shifts a day. */
export function dayNumber(iso: string): number {
  const m = ISO_DATE_RE.exec(iso);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
}

/** `to` minus `from` in calendar days (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

/** Inclusive length of a period in weeks, to one decimal ("10 weeks" for Oct 14 → Dec 22). */
export function weeksInclusive(start: string, end: string): number {
  const days = daysBetween(start, end) + 1;
  if (!Number.isFinite(days) || days <= 0) return 0;
  return Math.round((days / 7) * 10) / 10;
}

export interface StatusInput {
  start: string;
  end: string;
  reviewBy?: string | null;
  closed?: string | null;
}

/**
 * Status from New York calendar dates. A `closed:` key wins; otherwise the day decides.
 * An expired compass stays in force, which is why it is a status and not an absence.
 */
export function compassStatus(input: StatusInput, today: string): CompassStatus {
  if (input.closed && input.closed.trim()) return 'closed';
  if (today < input.start) return 'upcoming';
  if (today > input.end) return 'expired';
  if (input.reviewBy && input.reviewBy <= today && today <= input.end) return 'review-due';
  return 'active';
}

export interface PeriodProgress {
  /** Inclusive number of days in the period. */
  total: number;
  /** Days elapsed including today, clamped to 0..total. */
  elapsed: number;
  /** Days left after today, clamped to 0..total. */
  left: number;
  /** 0..100 */
  pct: number;
  /** Where the review_by tick sits, 0..100, or null without one. */
  reviewPct: number | null;
  /** Days until start (positive before the period) or since end (positive after). */
  daysToStart: number;
  daysSinceEnd: number;
}

/** Day counts for the progress track; day 1 is `start`, so "Day 1 of 70" on the first day. */
export function periodProgress(
  input: { start: string; end: string; reviewBy?: string | null },
  today: string,
): PeriodProgress {
  const total = Math.max(1, daysBetween(input.start, input.end) + 1);
  const rawElapsed = daysBetween(input.start, today) + 1;
  const elapsed = Math.min(total, Math.max(0, rawElapsed));
  const reviewDay =
    input.reviewBy && isIsoDate(input.reviewBy) ? daysBetween(input.start, input.reviewBy) : null;
  return {
    total,
    elapsed,
    left: total - elapsed,
    pct: Math.round((elapsed / total) * 1000) / 10,
    reviewPct:
      reviewDay === null
        ? null
        : Math.min(100, Math.max(0, Math.round((reviewDay / total) * 1000) / 10)),
    daysToStart: Math.max(0, daysBetween(today, input.start)),
    daysSinceEnd: Math.max(0, daysBetween(input.end, today)),
  };
}

function utcDate(iso: string): Date | null {
  const n = dayNumber(iso);
  return Number.isFinite(n) ? new Date(n * DAY_MS) : null;
}

/** "Oct 14" or, with the year, "Oct 14, 2026". Formats in UTC from the day number: no local shift. */
export function formatShortDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '';
  const d = utcDate(iso);
  if (!d) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(d);
}

/** "Oct 14 – Dec 22, 2026", or "Dec 23, 2026 – Jan 18, 2027" across a year boundary. */
export function formatPeriodRange(start: string, end: string): string {
  if (!isIsoDate(start) || !isIsoDate(end)) return [start, end].filter(Boolean).join(' – ');
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${formatShortDate(start, !sameYear)} – ${formatShortDate(end, true)}`;
}

/** "just now", "5 min ago", "3 h ago", "12 d ago"; "" when the timestamp is unusable. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = now - t;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (minutes < 1) return 'just now';
  const unit =
    minutes < 60
      ? `${minutes} min`
      : minutes < 2880
        ? `${Math.round(minutes / 60)} h`
        : `${Math.round(minutes / 1440)} d`;
  return diff >= 0 ? `${unit} ago` : `in ${unit}`;
}

/** Hours between a timestamp and now; Infinity when unusable. */
export function hoursSince(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? (now - t) / 3_600_000 : Infinity;
}
