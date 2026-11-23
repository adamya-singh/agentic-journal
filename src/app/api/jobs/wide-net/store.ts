import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { jobsDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import {
  linkKey, roleKey, selectWideNetCandidates,
  WIDE_NET_FEED_URL, WIDE_NET_JUDGE_PER_RUN, WIDE_NET_QUEUE_TARGET, WIDE_NET_SOURCE, WIDE_NET_TURNED_DOWN_KEEP_DAYS,
  type WideNetCandidate, type WideNetFeedEntry, type WideNetRun, type WideNetState, type WideNetTurnedDown,
} from '@/lib/job-wide-net';
import { deployHoldsWorker } from '@/lib/deploy-hold';
import type { JobListing } from '@/lib/types';
import { readJobApplicationsStore } from '../application-store-utils';
import { wakeJobApplicationWorkerIfEnabled } from '../application-worker-utils';
import { readJobListings, writeJobListings } from '../job-store-utils';
import { cliJudgeDeps, judgeWideNetPostings, type JudgeDeps } from './judge';

const stateFile = () => path.join(jobsDataDir(), 'wide-net.json');
/** The feed is checked a few times a day; it changes daily. */
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60_000;

export function readWideNetState(): WideNetState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as Partial<WideNetState>;
    return {
      enabled: parsed.enabled !== false,
      ...(parsed.lastRun ? { lastRun: parsed.lastRun } : {}),
      ...(parsed.turnedDown && typeof parsed.turnedDown === 'object' ? { turnedDown: parsed.turnedDown } : {}),
    };
  } catch {
    return { enabled: true };
  }
}

export function writeWideNetState(state: WideNetState): void {
  writeJsonFileAtomic(stateFile(), state);
}

/** Wide-net postings the worker has not started yet. */
export function countWideNetWaiting(listings: JobListing[]): number {
  const applications = readJobApplicationsStore().applications;
  return listings.filter(
    (listing) =>
      listing.track === 'wide' &&
      (listing.status === 'saved' || listing.status === 'starred') &&
      (applications[listing.id]?.status ?? 'unstarted') === 'unstarted',
  ).length;
}

async function fetchFeed(): Promise<WideNetFeedEntry[]> {
  const response = await fetch(WIDE_NET_FEED_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' });
  if (!response.ok) throw new Error(`The SimplifyJobs feed answered ${response.status}`);
  const feed: unknown = await response.json();
  if (!Array.isArray(feed)) throw new Error('The SimplifyJobs feed is not a list any more');
  return feed as WideNetFeedEntry[];
}

let running: Promise<WideNetRun> | null = null;

/** A check is under way (the feed is being read or OpenClaw is judging). */
export const isWideNetRunning = () => running !== null;

const asListing = (candidate: Omit<WideNetCandidate, 'place'>, at: string): JobListing => ({
  ...candidate, id: randomUUID(), savedAt: at, statusHistory: [], createdAt: at, updatedAt: at,
});

/** Turned-down postings, without the ones too old to still be in the feed's recent window. */
function keptTurnedDown(turnedDown: WideNetState['turnedDown'], now: number): Record<string, WideNetTurnedDown> {
  const oldest = now - WIDE_NET_TURNED_DOWN_KEEP_DAYS * 86_400_000;
  return Object.fromEntries(Object.entries(turnedDown ?? {}).filter(([, entry]) => Date.parse(entry.at) >= oldest));
}

const known = (listings: JobListing[], turnedDown: Record<string, WideNetTurnedDown>) => [
  ...listings,
  ...Object.values(turnedDown).map((entry) => ({ company: entry.company, positionTitle: entry.title, link: entry.link })),
];

/**
 * Top the wide-net queue up: pick postings from the feed, have OpenClaw judge them, save the ones
 * it passes and remember the ones it turns down. One run at a time; a failed run is recorded, not thrown.
 */
export function runWideNetImport(
  trigger: WideNetRun['trigger'],
  loadFeed: () => Promise<WideNetFeedEntry[]> = fetchFeed,
  judge: JudgeDeps = cliJudgeDeps,
): Promise<WideNetRun> {
  running ??= (async () => {
    const at = new Date().toISOString();
    let run: WideNetRun;
    let turnedDown = keptTurnedDown(readWideNetState().turnedDown, Date.now());
    try {
      if (!judge.available()) throw new Error('OpenClaw is not available to judge postings, so nothing was added');
      const feed = await loadFeed();
      const before = readJobListings().listings;
      const { candidates, skipped } = selectWideNetCandidates(feed, known(before, turnedDown), {
        now: Date.now(),
        limit: WIDE_NET_QUEUE_TARGET - countWideNetWaiting(before) > 0 ? WIDE_NET_JUDGE_PER_RUN : 0,
      });
      const outcome = await judgeWideNetPostings(
        candidates.map((candidate) => ({
          key: linkKey(candidate.link), company: candidate.company, title: candidate.positionTitle,
          location: candidate.location, link: candidate.link, place: candidate.place,
        })),
        judge,
      );

      // Judging takes minutes. Read the box and the state again so nothing saved meanwhile is written over.
      const data = readJobListings();
      turnedDown = keptTurnedDown(readWideNetState().turnedDown, Date.now());
      const links = new Set(data.listings.map((listing) => linkKey(listing.link)));
      const roles = new Set(data.listings.map(roleKey));
      let room = WIDE_NET_QUEUE_TARGET - countWideNetWaiting(data.listings);
      const added: JobListing[] = [];
      let rejected = 0;
      let unjudged = 0;
      for (const { place, ...candidate } of candidates) {
        const key = linkKey(candidate.link);
        const verdict = outcome.verdicts[key];
        if (!verdict) {
          unjudged += 1;
        } else if (verdict.verdict === 'skip') {
          rejected += 1;
          turnedDown[key] = {
            company: candidate.company, title: candidate.positionTitle, location: candidate.location, link: candidate.link,
            place, ...(candidate.postedDate ? { postedDate: candidate.postedDate } : {}),
            ...(verdict.about ? { about: verdict.about } : {}), reason: verdict.reason, read: verdict.read, at,
          };
        } else if (room > 0 && !links.has(key) && !roles.has(roleKey(candidate))) {
          // A pass with no room left is not recorded: a later check judges it again.
          room -= 1;
          links.add(key);
          roles.add(roleKey(candidate));
          added.push(asListing({
            ...candidate,
            ...(verdict.about ? { companySummary: verdict.about } : {}),
            notes: `Wide net: ${verdict.reason}${verdict.read ? '' : ' (Judged without reading the posting.)'}`,
          }, at));
        }
      }
      if (added.length > 0) {
        data.listings.unshift(...added);
        writeJobListings(data);
        await wakeJobApplicationWorkerIfEnabled().catch((error) => console.error('Wide net worker wake failed:', error));
      }
      run = {
        at, trigger, added: added.length, turnedDown: rejected, unjudged,
        waiting: countWideNetWaiting(data.listings), skipped,
        ...(outcome.error && Object.keys(outcome.verdicts).length === 0 ? { error: `OpenClaw could not judge the postings: ${outcome.error}` } : {}),
      };
    } catch (error) {
      run = {
        at, trigger, added: 0, waiting: countWideNetWaiting(readJobListings().listings),
        error: error instanceof Error ? error.message : 'The wide-net check failed',
      };
    }
    writeWideNetState({ ...readWideNetState(), lastRun: run, turnedDown });
    return run;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** Adamya overrides the judge: a turned-down posting is saved to the wide net after all. */
export async function addTurnedDownPosting(key: string): Promise<boolean> {
  const state = readWideNetState();
  const entry = state.turnedDown?.[key];
  if (!entry) return false;
  const at = new Date().toISOString();
  const data = readJobListings();
  if (!data.listings.some((listing) => linkKey(listing.link) === key)) {
    data.listings.unshift(asListing({
      company: entry.company, companySummary: entry.about ?? 'Company description not available yet.',
      positionTitle: entry.title, location: entry.location, applicationCategories: ['new-grad'], track: 'wide',
      status: 'saved', salary: 'not listed', link: entry.link, source: WIDE_NET_SOURCE,
      notes: `Wide net: added by Adamya after OpenClaw turned it down (${entry.reason})`,
      ...(entry.postedDate ? { postedDate: entry.postedDate } : {}),
    }, at));
    writeJobListings(data);
    await wakeJobApplicationWorkerIfEnabled().catch((error) => console.error('Wide net worker wake failed:', error));
  }
  const latest = readWideNetState();
  writeWideNetState({
    ...latest,
    turnedDown: Object.fromEntries(Object.entries(latest.turnedDown ?? {}).filter(([entryKey]) => entryKey !== key)),
  });
  return true;
}

export async function runWideNetImportIfDue(): Promise<void> {
  const state = readWideNetState();
  if (!state.enabled || process.env.JOB_WIDE_NET_DISABLED === '1') return;
  if (state.lastRun && Date.now() - Date.parse(state.lastRun.at) < RUN_EVERY_MS) return;
  // A queued deploy is about to stop the gateway; a judging turn started now would be cut off.
  if (deployHoldsWorker()) return;
  await runWideNetImport('schedule');
}
