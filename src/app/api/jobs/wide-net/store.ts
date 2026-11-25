import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { jobsDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import {
  linkKey, roleKey, selectOfferedCandidates, selectWideNetCandidates,
  WIDE_NET_FEED_URL, WIDE_NET_JUDGE_PER_RUN, WIDE_NET_QUEUE_TARGET, WIDE_NET_SOURCE, WIDE_NET_TURNED_DOWN_KEEP_DAYS,
  type OfferOutcome, type WideNetCandidate, type WideNetFeedEntry, type WideNetOffer, type WideNetRun, type WideNetState,
  type WideNetTurnedDown,
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
      ...(parsed.offered && typeof parsed.offered === 'object' ? { offered: parsed.offered } : {}),
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
 * One check: take the postings searches handed in and the new ones in the feed, have OpenClaw judge
 * them, save the ones it puts in a search and remember the ones it turns down. One run at a time;
 * a failed run is recorded, not thrown.
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
    const settled = new Set<string>();
    try {
      if (!judge.available()) throw new Error('OpenClaw is not available to judge postings, so nothing was added');
      // A feed that is down does not hold up what the searches handed in.
      let feedError: string | undefined;
      const feed = await loadFeed().catch((error) => {
        feedError = error instanceof Error ? error.message : 'The SimplifyJobs feed could not be read';
        return [] as WideNetFeedEntry[];
      });
      const before = readJobListings().listings;
      // With the wide net's queue full nothing is judged: a pass would have nowhere to go and be judged again.
      const wideHasRoom = WIDE_NET_QUEUE_TARGET - countWideNetWaiting(before) > 0;
      const offered = wideHasRoom ? Object.values(readWideNetState().offered ?? {}).slice(0, WIDE_NET_JUDGE_PER_RUN) : [];
      if (feedError && offered.length === 0) throw new Error(feedError);
      const { candidates: fromFeed, skipped } = selectWideNetCandidates(
        feed,
        known(before, turnedDown).concat(offered.map((candidate) => ({ company: candidate.company, positionTitle: candidate.positionTitle, link: candidate.link }))),
        { now: Date.now(), limit: wideHasRoom ? WIDE_NET_JUDGE_PER_RUN - offered.length : 0 },
      );
      const candidates = [...offered, ...fromFeed];
      const outcome = await judgeWideNetPostings(
        candidates.map((candidate) => ({
          key: linkKey(candidate.link), company: candidate.company, title: candidate.positionTitle,
          location: candidate.location, link: candidate.link, place: candidate.place,
          ...(candidate.source.name !== WIDE_NET_SOURCE.name ? { source: candidate.source.name } : {}),
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
        const unread = verdict?.read ? '' : ' (Judged without reading the posting.)';
        if (!verdict) {
          unjudged += 1;
        } else if (verdict.verdict === 'skip') {
          rejected += 1;
          settled.add(key);
          turnedDown[key] = {
            company: candidate.company, title: candidate.positionTitle, location: candidate.location, link: candidate.link,
            place, source: candidate.source.name, ...(candidate.postedDate ? { postedDate: candidate.postedDate } : {}),
            ...(verdict.about ? { about: verdict.about } : {}), reason: verdict.reason, read: verdict.read, at,
          };
        } else if (links.has(key) || roles.has(roleKey(candidate))) {
          settled.add(key);
        } else if (verdict.verdict === 'focus' || room > 0) {
          // A wide-net pass with no room left is not recorded: a later check judges it again.
          if (verdict.verdict === 'wide') room -= 1;
          settled.add(key);
          links.add(key);
          roles.add(roleKey(candidate));
          added.push(asListing({
            ...candidate,
            track: verdict.verdict,
            ...(verdict.about ? { companySummary: verdict.about } : {}),
            notes: verdict.verdict === 'focus'
              ? `${verdict.reason}${unread}\nPros: ${verdict.pros}\nCons: ${verdict.cons}`
              : `Wide net: ${verdict.reason}${unread}`,
          }, at));
        }
      }
      if (added.length > 0) {
        data.listings.unshift(...added);
        writeJobListings(data);
        await wakeJobApplicationWorkerIfEnabled().catch((error) => console.error('Wide net worker wake failed:', error));
      }
      const addedToFocus = added.filter((listing) => listing.track === 'focus').length;
      const error = outcome.error && Object.keys(outcome.verdicts).length === 0
        ? `OpenClaw could not judge the postings: ${outcome.error}`
        : feedError;
      run = {
        at, trigger, added: added.length - addedToFocus, addedToFocus, turnedDown: rejected, unjudged,
        waiting: countWideNetWaiting(data.listings), skipped, ...(error ? { error } : {}),
      };
    } catch (error) {
      run = {
        at, trigger, added: 0, waiting: countWideNetWaiting(readJobListings().listings),
        error: error instanceof Error ? error.message : 'The wide-net check failed',
      };
    }
    const latest = readWideNetState();
    writeWideNetState({
      ...latest, lastRun: run, turnedDown,
      offered: Object.fromEntries(Object.entries(latest.offered ?? {}).filter(([key]) => !settled.has(key))),
    });
    return run;
  })().finally(() => {
    running = null;
  });
  return running;
}

/** A handed-in posting waits this long at most before a check judges it, when the finder is on. */
const OFFER_RUN_AFTER_MS = 10 * 60 * 1000;
/** Handed-in postings that may wait at once; a search that hands in more is told the rest did not fit. */
const OFFERED_MAX = 400;

/**
 * A search hands in postings it found and did not keep. Each goes through the first cut and then
 * waits to be judged with everything else. Returns what became of each, in the order given.
 */
export function offerPostings(offers: WideNetOffer[]): { outcomes: (OfferOutcome | 'queue-full')[]; waiting: number } {
  const state = readWideNetState();
  const offered = { ...(state.offered ?? {}) };
  const waiting = Object.values(offered).map((candidate) => ({ company: candidate.company, positionTitle: candidate.positionTitle, link: candidate.link }));
  const turnedDown = keptTurnedDown(state.turnedDown, Date.now());
  const { candidates, outcomes } = selectOfferedCandidates(offers, known(readJobListings().listings, turnedDown).concat(waiting));
  const accepted = [...candidates];
  const result = outcomes.map((outcome): OfferOutcome | 'queue-full' => {
    if (outcome !== 'accepted') return outcome;
    const candidate = accepted.shift()!;
    if (Object.keys(offered).length >= OFFERED_MAX) return 'queue-full';
    offered[linkKey(candidate.link)] = candidate;
    return 'accepted';
  });
  writeWideNetState({ ...readWideNetState(), offered });
  return { outcomes: result, waiting: Object.keys(offered).length };
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
      status: 'saved', salary: 'not listed', link: entry.link,
      source: entry.source && entry.source !== WIDE_NET_SOURCE.name ? { name: entry.source, link: entry.link } : WIDE_NET_SOURCE,
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
  // Postings a search handed in are judged within minutes; the feed alone is checked a few times a day.
  const offersWaiting =
    Object.keys(state.offered ?? {}).length > 0 && countWideNetWaiting(readJobListings().listings) < WIDE_NET_QUEUE_TARGET;
  if (state.lastRun && Date.now() - Date.parse(state.lastRun.at) < (offersWaiting ? OFFER_RUN_AFTER_MS : RUN_EVERY_MS)) return;
  // A queued deploy is about to stop the gateway; a judging turn started now would be cut off.
  if (deployHoldsWorker()) return;
  await runWideNetImport(offersWaiting ? 'offer' : 'schedule');
}
