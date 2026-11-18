import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { jobsDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import {
  selectWideNetCandidates, WIDE_NET_FEED_URL, WIDE_NET_QUEUE_TARGET,
  type WideNetFeedEntry, type WideNetRun, type WideNetState,
} from '@/lib/job-wide-net';
import type { JobListing } from '@/lib/types';
import { readJobApplicationsStore } from '../application-store-utils';
import { wakeJobApplicationWorkerIfEnabled } from '../application-worker-utils';
import { readJobListings, writeJobListings } from '../job-store-utils';

const stateFile = () => path.join(jobsDataDir(), 'wide-net.json');
/** The queue is topped up a few times a day; the feed itself changes daily. */
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 60_000;

export function readWideNetState(): WideNetState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf-8')) as Partial<WideNetState>;
    return { enabled: parsed.enabled !== false, ...(parsed.lastRun ? { lastRun: parsed.lastRun } : {}) };
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

/** Top the wide-net queue up from the feed. One run at a time; a failed run is recorded, not thrown. */
export function runWideNetImport(
  trigger: WideNetRun['trigger'],
  loadFeed: () => Promise<WideNetFeedEntry[]> = fetchFeed,
): Promise<WideNetRun> {
  running ??= (async () => {
    const at = new Date().toISOString();
    let run: WideNetRun;
    try {
      const feed = await loadFeed();
      // Read the box after the slow download so a posting saved meanwhile is not written over.
      const data = readJobListings();
      const room = WIDE_NET_QUEUE_TARGET - countWideNetWaiting(data.listings);
      const { candidates, skipped } = selectWideNetCandidates(feed, data.listings, { now: Date.now(), limit: room });
      if (candidates.length > 0) {
        data.listings.unshift(
          ...candidates.map((candidate) => ({
            ...candidate, id: randomUUID(), savedAt: at, statusHistory: [], createdAt: at, updatedAt: at,
          })),
        );
        writeJobListings(data);
        await wakeJobApplicationWorkerIfEnabled().catch((error) => console.error('Wide net worker wake failed:', error));
      }
      run = { at, trigger, added: candidates.length, waiting: countWideNetWaiting(data.listings), skipped };
    } catch (error) {
      run = {
        at, trigger, added: 0, waiting: countWideNetWaiting(readJobListings().listings),
        error: error instanceof Error ? error.message : 'The wide-net check failed',
      };
    }
    writeWideNetState({ ...readWideNetState(), lastRun: run });
    return run;
  })().finally(() => {
    running = null;
  });
  return running;
}

export async function runWideNetImportIfDue(): Promise<void> {
  const state = readWideNetState();
  if (!state.enabled || process.env.JOB_WIDE_NET_DISABLED === '1') return;
  if (state.lastRun && Date.now() - Date.parse(state.lastRun.at) < RUN_EVERY_MS) return;
  await runWideNetImport('schedule');
}
