import type { JobListing } from '@/lib/types';

/**
 * The wide net: every entry-level SWE and MLE posting in the public SimplifyJobs new-grad feed
 * that Adamya could apply to, with no judgement about fit. This file is the pure part (which
 * feed entries become postings); the fetch, the store and the schedule live in
 * src/app/api/jobs/wide-net.
 */

export const WIDE_NET_FEED_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json';
export const WIDE_NET_SOURCE = {
  name: 'SimplifyJobs',
  link: 'https://github.com/SimplifyJobs/New-Grad-Positions',
};
/** Postings older than this are mostly filled or flooded with applicants. */
export const WIDE_NET_MAX_AGE_DAYS = 14;
/** How many wide-net postings may wait for the worker at once. A check tops the queue up to this. */
export const WIDE_NET_QUEUE_TARGET = 40;

export interface WideNetFeedEntry {
  company_name?: unknown;
  title?: unknown;
  url?: unknown;
  locations?: unknown;
  category?: unknown;
  active?: unknown;
  is_visible?: unknown;
  date_posted?: unknown;
  degrees?: unknown;
}

export type WideNetCandidate = Pick<
  JobListing,
  | 'company' | 'companySummary' | 'positionTitle' | 'location' | 'applicationCategories' | 'track'
  | 'status' | 'salary' | 'link' | 'source' | 'notes' | 'postedDate'
>;

export interface WideNetSelection {
  candidates: WideNetCandidate[];
  /** Why the rest of the feed was left out, for the status line on the board. */
  skipped: { closed: number; notSoftware: number; old: number; outsideUs: number; level: number; duplicate: number; overLimit: number };
}

const CATEGORIES = /^(software|ai\/ml\/data|software engineering|data science, ai & machine learning)$/i;
const ROLE = /engineer|developer|scientist|programmer|software|machine learning|\b(?:swe|sde|ml|ai|mle)\b/i;
const NOT_THE_ROLE = /analyst|technician|sales|support|mechanical|electrical|civil|hardware|manufactur|test engineer|field/i;
const NOT_ENTRY_LEVEL =
  /\b(?:senior|sr|staff|principal|lead|manager|director|head|ph\.?d|intern|internship|co-?op|ii|iii|iv)\b/i;
const US_STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK ' +
    'OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '),
);

export function isUsLocation(location: string): boolean {
  const text = location.trim();
  if (/\b(?:usa|united states|u\.s\.)\b/i.test(text)) return true;
  if (/^remote$/i.test(text)) return true;
  const last = text.split(',').pop()?.trim().toUpperCase() ?? '';
  return US_STATES.has(last);
}

/** Same posting, whatever tracking parameters the link carries. */
export function linkKey(link: string): string {
  try {
    const url = new URL(link.trim());
    for (const name of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|source$|src$|gh_src$)/i.test(name)) url.searchParams.delete(name);
    }
    url.hash = '';
    return `${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase();
  } catch {
    return link.trim().toLowerCase();
  }
}

const words = (value: string) =>
  value
    .toLowerCase()
    .replace(/\b(?:inc|llc|corp|corporation|co|company|ltd)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Company and title only: the same role in another city is one application's worth of signal. */
export function roleKey(listing: Pick<JobListing, 'company' | 'positionTitle'>): string {
  return `${words(listing.company)}|${words(listing.positionTitle)}`;
}

function cleanLink(link: string): string {
  try {
    const url = new URL(link.trim());
    for (const name of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(name) || (name === 'ref' && /simplify/i.test(url.searchParams.get(name) ?? ''))) {
        url.searchParams.delete(name);
      }
    }
    return url.toString();
  } catch {
    return link.trim();
  }
}

/**
 * Pick the feed entries to save: open, software or ML, entry level, in the US, recent, and not
 * already in the box under either track (any status, archived included). Newest first, at most `limit`.
 */
export function selectWideNetCandidates(
  feed: WideNetFeedEntry[],
  existing: Pick<JobListing, 'company' | 'positionTitle' | 'link'>[],
  options: { now: number; limit: number; maxAgeDays?: number },
): WideNetSelection {
  const skipped = { closed: 0, notSoftware: 0, old: 0, outsideUs: 0, level: 0, duplicate: 0, overLimit: 0 };
  const oldest = options.now - (options.maxAgeDays ?? WIDE_NET_MAX_AGE_DAYS) * 86_400_000;
  const links = new Set(existing.map((listing) => linkKey(listing.link)));
  const roles = new Set(existing.map(roleKey));
  const picked: { candidate: WideNetCandidate; posted: number }[] = [];

  for (const entry of feed) {
    const company = typeof entry.company_name === 'string' ? entry.company_name.trim() : '';
    const title = typeof entry.title === 'string' ? entry.title.trim() : '';
    const link = typeof entry.url === 'string' ? entry.url.trim() : '';
    const posted = typeof entry.date_posted === 'number' ? entry.date_posted * 1000 : 0;
    const locations = Array.isArray(entry.locations)
      ? entry.locations.filter((value): value is string => typeof value === 'string')
      : [];
    const degrees = Array.isArray(entry.degrees) ? entry.degrees : [];

    if (entry.active !== true || entry.is_visible !== true || !company || !title || !/^https?:\/\//.test(link)) {
      skipped.closed += 1;
      continue;
    }
    if (typeof entry.category !== 'string' || !CATEGORIES.test(entry.category.trim()) || !ROLE.test(title) || NOT_THE_ROLE.test(title)) {
      skipped.notSoftware += 1;
      continue;
    }
    if (NOT_ENTRY_LEVEL.test(title) || (degrees.length > 0 && !degrees.some((degree) => /bachelor/i.test(String(degree))))) {
      skipped.level += 1;
      continue;
    }
    if (!posted || posted < oldest) {
      skipped.old += 1;
      continue;
    }
    const usLocations = locations.filter(isUsLocation);
    if (usLocations.length === 0) {
      skipped.outsideUs += 1;
      continue;
    }
    const candidate: WideNetCandidate = {
      company,
      companySummary: 'Company description not available yet.',
      positionTitle: title,
      location: usLocations.length > 3
        ? `${usLocations.slice(0, 3).join('; ')} +${usLocations.length - 3} more`
        : usLocations.join('; '),
      applicationCategories: ['new-grad'],
      track: 'wide',
      status: 'saved',
      salary: 'not listed',
      link: cleanLink(link),
      source: WIDE_NET_SOURCE,
      notes: `Wide net: saved automatically from the SimplifyJobs new-grad feed (${entry.category.trim()}). Not judged for fit.`,
      postedDate: new Date(posted).toISOString().slice(0, 10),
    };
    if (links.has(linkKey(candidate.link)) || roles.has(roleKey(candidate))) {
      skipped.duplicate += 1;
      continue;
    }
    links.add(linkKey(candidate.link));
    roles.add(roleKey(candidate));
    picked.push({ candidate, posted });
  }

  picked.sort((first, second) => second.posted - first.posted);
  const limit = Math.max(0, options.limit);
  skipped.overLimit = Math.max(0, picked.length - limit);
  return { candidates: picked.slice(0, limit).map((entry) => entry.candidate), skipped };
}

export interface WideNetRun {
  at: string;
  /** How the run started: the schedule, or the "Find more now" button. */
  trigger: 'schedule' | 'manual';
  added: number;
  /** Open wide-net postings still waiting for the worker after this run. */
  waiting: number;
  skipped?: WideNetSelection['skipped'];
  error?: string;
}

export interface WideNetState {
  /** Off stops new postings from being saved; ones already saved stay in the queue. */
  enabled: boolean;
  lastRun?: WideNetRun;
}
