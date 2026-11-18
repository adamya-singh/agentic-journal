// Up to two Telegram messages a day listing the applications OpenClaw has drafted and is holding for Adamya's
// review, with when each sends itself. The first goes at the first five-minute tick from 09:00 with something held;
// the second from 17:00, and only if something is held that the first did not mention (drafts are held for a day, so
// this is what tells him about the ones written after the morning message). Never in quiet hours. A failed send is
// retried on later ticks, four tries a day. JOB_REVIEW_NOTIFY_DISABLED=1 turns it off.
import * as fs from 'fs';
import * as path from 'path';
import { needsExplicitReview } from '@/lib/application-eligibility';
import { jobsDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { journalOriginFor } from '@/lib/same-origin';
import { localDay, quietHours } from '@/lib/task-work';
import { telegramAvailable, telegramSend, telegramSendArgs, telegramTarget } from '@/lib/telegram';
import type { CandidateFacts } from '@/lib/candidate-facts';
import type { JobApplicationRecord, JobListing } from '@/lib/types';
import { readJobApplicationsStore } from '../application-store-utils';
import { readJobListings } from '../job-store-utils';

/** Local hours from which the day's first and second message may go. */
export const REVIEW_NOTIFY_HOURS = [9, 17] as const;
const TRIES_PER_DAY = 4;
const MAX_LINES = 8;

/** One local day's sends: how many went, which applications they named, and how many tries were used. */
export interface ReviewNotifyState { day?: string; sent?: number; told?: string[]; tries?: number }
const stateFile = () => path.join(jobsDataDir(), 'review-notify.json');
function readState(): ReviewNotifyState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as ReviewNotifyState;
  } catch {
    return {};
  }
}

export interface HeldApplication {
  listingId: string;
  company: string;
  role: string;
  /** When it sends itself; absent when an answer needs his approval first, which no deadline waives. */
  sendsAt?: string;
  toApprove: number;
}

/** Applications that are fully drafted and waiting only for review, soonest to send first. */
export function heldForReview(
  applications: Record<string, JobApplicationRecord>,
  listings: JobListing[],
  facts?: CandidateFacts,
): HeldApplication[] {
  const byId = new Map(listings.map((listing) => [listing.id, listing]));
  const held: HeldApplication[] = [];
  for (const application of Object.values(applications)) {
    const listing = byId.get(application.listingId);
    if (
      !listing ||
      application.status !== 'awaiting-user-input' ||
      !application.reviewHoldSince ||
      application.questions.some((question) => question.resolution === 'pending')
    ) {
      continue;
    }
    const toApprove = application.questions.filter((question) => needsExplicitReview(question, facts)).length;
    held.push({
      listingId: listing.id,
      company: listing.company,
      role: listing.positionTitle,
      toApprove,
      ...(toApprove === 0 && application.autoSubmitEligibleAt ? { sendsAt: application.autoSubmitEligibleAt } : {}),
    });
  }
  return held.sort((first, second) => (first.sendsAt ?? '9').localeCompare(second.sendsAt ?? '9'));
}

const plain = (text: string) => text.replace(/[*`~_]/g, '').replace(/\s+/g, ' ').trim();
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function sendsLine(held: HeldApplication, now: Date): string {
  if (held.toApprove > 0) {
    return `waits for you to approve ${held.toApprove} eligibility answer${held.toApprove === 1 ? '' : 's'}`;
  }
  if (!held.sendsAt) return 'waits for your review';
  const at = new Date(held.sendsAt);
  if (at.getTime() <= now.getTime()) return 'sends on OpenClaw’s next run';
  const day = localDay(at) === localDay(now) ? 'today' : at.toLocaleDateString('en-US', { weekday: 'short' });
  return `sends itself ${day} ${at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
}

export function buildReviewMessage(held: HeldApplication[], origin: string, now: Date): string {
  const n = held.length;
  const lines = [`${n} job application${n === 1 ? ' is' : 's are'} drafted and ready to send`];
  for (const item of held.slice(0, MAX_LINES)) {
    lines.push(`• ${clip(plain(item.company), 30)}, ${clip(plain(item.role), 45)}: ${sendsLine(item, now)}`);
  }
  if (n > MAX_LINES) lines.push(`+ ${n - MAX_LINES} more`);
  lines.push(`Review: ${origin}/jobs`);
  return lines.join('\n');
}

export type ReviewNotifyDecision = 'send' | 'disabled' | 'quiet' | 'sent-today' | 'too-early' | 'tries-used' | 'nothing';

/** Pure: whether a message goes now. `held` is what is waiting for review at this moment. */
export function decideReviewNotify(input: { now: Date; disabled: boolean; state: ReviewNotifyState; held: string[] }): ReviewNotifyDecision {
  const { now } = input;
  if (input.disabled) return 'disabled';
  if (quietHours(now) || now.getHours() < REVIEW_NOTIFY_HOURS[0]) return 'quiet';
  const today = input.state.day === localDay(now) ? input.state : {};
  const sent = today.sent ?? 0;
  if (sent >= REVIEW_NOTIFY_HOURS.length) return 'sent-today';
  if (now.getHours() < REVIEW_NOTIFY_HOURS[sent]) return 'too-early';
  if ((today.tries ?? 0) >= TRIES_PER_DAY) return 'tries-used';
  // A second message repeats nothing: it goes only for applications the first did not name.
  const told = new Set(today.told ?? []);
  return input.held.some((listingId) => !told.has(listingId)) ? 'send' : 'nothing';
}

export interface ReviewNotifyDeps {
  available: () => boolean;
  target: () => Promise<string | null>;
  send: (args: string[]) => Promise<string>;
}
const telegramDeps: ReviewNotifyDeps = { available: telegramAvailable, target: telegramTarget, send: telegramSend };

let inFlight = false;

/** Sends the day's message when it is due. Never throws; safe to call on every tick. */
export async function notifyApplicationsReadyForReview(
  now = new Date(),
  deps: ReviewNotifyDeps = telegramDeps,
): Promise<{ decision: ReviewNotifyDecision | 'no-telegram' | 'sent' | 'failed' | 'busy'; message?: string }> {
  if (inFlight) return { decision: 'busy' };
  inFlight = true;
  try {
    const disabled = process.env.JOB_REVIEW_NOTIFY_DISABLED === '1';
    const today = localDay(now);
    const saved = readState();
    const state: ReviewNotifyState = saved.day === today ? saved : { day: today };
    // The clock and the day's count first; the stores are read only when a message could go.
    const early = decideReviewNotify({ now, disabled, state, held: ['?'] });
    if (early !== 'send') return { decision: early };
    const store = readJobApplicationsStore();
    const held = heldForReview(store.applications, readJobListings().listings, store.candidateFacts);
    const decision = decideReviewNotify({ now, disabled, state, held: held.map((item) => item.listingId) });
    if (decision !== 'send') return { decision };
    const target = deps.available() ? await deps.target() : null;
    if (!target) return { decision: 'no-telegram' };

    const message = buildReviewMessage(held, journalOriginFor(true), now);
    // Counted before it goes, so a send that hangs still uses one of the day's tries.
    const trying = { ...state, tries: (state.tries ?? 0) + 1 };
    writeJsonFileAtomic(stateFile(), trying);
    try {
      await deps.send(telegramSendArgs(target, message));
    } catch (error) {
      console.error('Job review notify: send failed:', error instanceof Error ? error.message : error);
      return { decision: 'failed' };
    }
    writeJsonFileAtomic(stateFile(), {
      ...trying,
      sent: (state.sent ?? 0) + 1,
      told: [...new Set([...(state.told ?? []), ...held.map((item) => item.listingId)])],
    });
    return { decision: 'sent', message };
  } catch (error) {
    console.error('Job review notify failed:', error instanceof Error ? error.message : error);
    return { decision: 'failed' };
  } finally {
    inFlight = false;
  }
}
