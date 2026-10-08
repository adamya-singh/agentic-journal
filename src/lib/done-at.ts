// "Done, but when?": the pure half of finishing a task at a time other than now.
// Shared by the API (completion + journal write, OpenClaw proposals) and the Horizon pad,
// so it must not touch the filesystem.
//
// Times follow the rest of the app: a journal file is the calendar date and its hour keys
// are clock hours, read in the server's local zone (the same way task-actions.ts logs a
// completion at the current hour).
import { z } from 'zod';

export const JOURNAL_HOURS = [
  '7am', '8am', '9am', '10am', '11am', '12pm',
  '1pm', '2pm', '3pm', '4pm', '5pm', '6pm',
  '7pm', '8pm', '9pm', '10pm', '11pm', '12am',
  '1am', '2am', '3am', '4am', '5am', '6am',
] as const;

export type JournalSlot =
  | { kind: 'hour'; date: string; hour: string }
  | { kind: 'range'; date: string; start: string; end: string };

/** What OpenClaw proposes after reading "when did you finish it". */
export interface DoneProposal {
  completedAt: string;        // ISO
  rangeStart: string | null;  // ISO, set when the text implies how long it took
  timeIsGuess: boolean;
  note: string;
}

export type OpenClawDoneReply =
  | { kind: 'proposal'; proposal: DoneProposal }
  | { kind: 'question'; question: string };

const MAX_PAST_DAYS = 60;
const MAX_RANGE_HOURS = 16;
const FUTURE_SLACK_MS = 5 * 60_000;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function localDateIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function hourLabel(d: Date): string {
  const h = d.getHours();
  return `${h % 12 || 12}${h >= 12 ? 'pm' : 'am'}`;
}

/** "Tue Oct 6, 10 PM" / "Tue Oct 6, 10:30 PM" */
export function formatWhen(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  const time = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
  return `${WEEKDAYS[d.getDay()]} ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

function formatDay(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return `${WEEKDAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Where the done entry goes in the journal: the hour it was finished, or a range ending
 * there when OpenClaw knows when the work started. A range that would leave the day or
 * run against the journal's 7am-6am hour order falls back to the single hour.
 */
export function journalSlotFor(completedAt: Date, rangeStart?: Date | null): JournalSlot {
  const date = localDateIso(completedAt);
  const end = hourLabel(completedAt);
  if (rangeStart && rangeStart < completedAt) {
    const start = localDateIso(rangeStart) === date
      ? rangeStart
      : new Date(completedAt.getFullYear(), completedAt.getMonth(), completedAt.getDate());
    const startLabel = hourLabel(start);
    const startIndex = JOURNAL_HOURS.indexOf(startLabel as (typeof JOURNAL_HOURS)[number]);
    const endIndex = JOURNAL_HOURS.indexOf(end as (typeof JOURNAL_HOURS)[number]);
    if (startLabel !== end && startIndex >= 0 && startIndex < endIndex) {
      return { kind: 'range', date, start: startLabel, end };
    }
  }
  return { kind: 'hour', date, hour: end };
}

function span(ms: number): string {
  const mins = Math.round(Math.abs(ms) / 60_000);
  if (mins >= 1440) return `${Math.round(mins / 1440)}d`;
  if (mins >= 60) return `${Math.round(mins / 60)}h`;
  return `${mins}m`;
}

/** The lines the review bubble shows for a proposal. */
export function describeDone(completedAt: Date, rangeStart: Date | null, due: Date | null, timeIsGuess = false): string[] {
  const lines = [`Mark it done at ${formatWhen(completedAt)}${timeIsGuess ? ' (time is a guess)' : ''}`];
  if (due) {
    const diff = completedAt.getTime() - due.getTime();
    lines.push(Math.abs(diff) < 5 * 60_000
      ? 'That’s right on time'
      : diff > 0
        ? `That’s ${span(diff)} after it was due, so it counts as late`
        : `That’s ${span(diff)} before it was due, so it counts as on time`);
  }
  const slot = journalSlotFor(completedAt, rangeStart);
  lines.push(slot.kind === 'range'
    ? `Log it in your ${formatDay(slot.date)} journal from ${slot.start} to ${slot.end}`
    : `Log it in your ${formatDay(slot.date)} journal at ${slot.hour}`);
  return lines;
}

const ReplySchema = z.union([
  z.object({
    kind: z.literal('proposal'),
    completedAt: z.string(),
    rangeStart: z.string().nullable().optional(),
    timeIsGuess: z.boolean().optional(),
    note: z.string().optional(),
  }),
  z.object({ kind: z.literal('question'), question: z.string().min(1) }),
]);

/** Pulls the JSON object out of an agent reply that may be wrapped in a code fence or prose. */
export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  for (const candidate of [trimmed, trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)]) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next shape
    }
  }
  return null;
}

/** Checks OpenClaw's reply: the right shape, a real time, not in the future, not absurdly old. */
export function validateReply(raw: unknown, opts: { now: Date }): { ok: true; reply: OpenClawDoneReply } | { ok: false; error: string } {
  const parsed = ReplySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'reply was not the expected JSON' };
  const value = parsed.data;
  if (value.kind === 'question') return { ok: true, reply: { kind: 'question', question: value.question.trim() } };

  const completedAt = new Date(value.completedAt);
  if (Number.isNaN(completedAt.getTime())) return { ok: false, error: 'completedAt is not a time' };
  if (completedAt.getTime() > opts.now.getTime() + FUTURE_SLACK_MS) return { ok: false, error: 'completedAt is in the future' };
  if (opts.now.getTime() - completedAt.getTime() > MAX_PAST_DAYS * 86_400_000) return { ok: false, error: 'completedAt is too far back' };

  let rangeStart: string | null = null;
  if (value.rangeStart) {
    const start = new Date(value.rangeStart);
    const hours = (completedAt.getTime() - start.getTime()) / 3_600_000;
    if (Number.isNaN(start.getTime()) || hours <= 0 || hours > MAX_RANGE_HOURS) {
      return { ok: false, error: 'rangeStart must be before completedAt and within a day' };
    }
    rangeStart = start.toISOString();
  }

  return {
    ok: true,
    reply: {
      kind: 'proposal',
      proposal: {
        completedAt: completedAt.toISOString(),
        rangeStart,
        timeIsGuess: value.timeIsGuess === true,
        note: (value.note ?? '').trim(),
      },
    },
  };
}

function offsetIso(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  return `${localDateIso(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00${sign}${pad(off / 60)}:${pad(off % 60)}`;
}

const REPLY_FORMAT = `Reply with ONLY one JSON object, no prose and no code fence:
{"kind":"proposal","completedAt":"<ISO 8601 with offset>","rangeStart":null or "<ISO 8601 with offset>","timeIsGuess":true|false,"note":"<one short sentence>"}
or, if you cannot tell which day it was:
{"kind":"question","question":"<one short question>"}
Set rangeStart only when the text says how long it took or when the work started. Set timeIsGuess when no clock time was given and you picked one.`;

/** First message of a proposal's OpenClaw session. */
export function buildDonePrompt(input: { title: string; due: Date | null; dueIsImplied: boolean; now: Date; text: string }): string {
  return [
    'Agentic Journal is asking you to interpret when Adamya finished a task. Do not change anything: no task, journal or file writes, no messages. You may read his journal for context (e.g. "right after lab").',
    `Task: ${input.title}`,
    input.due ? `Due: ${offsetIso(input.due)}${input.dueIsImplied ? ' (assumed deadline)' : ''}` : 'Due: no due time',
    `Now: ${offsetIso(input.now)} (${WEEKDAYS[input.now.getDay()]})`,
    `He says he finished it: "${input.text}"`,
    'Work out when he finished. The time must not be in the future; a weekday with no other hint means the most recent one.',
    REPLY_FORMAT,
  ].join('\n');
}

/** Follow-up message in the same session when he replies to a proposal or question. */
export function buildDoneReplyPrompt(input: { now: Date; text: string }): string {
  return [
    `Adamya replies: "${input.text}"`,
    `Now: ${offsetIso(input.now)}. Revise your answer. Still change nothing.`,
    REPLY_FORMAT,
  ].join('\n');
}
