import type { JobListing } from '@/lib/types';

/**
 * The job search's intake. Every posting any search finds comes through here: the public
 * SimplifyJobs new-grad feed, which the Journal reads itself, and whatever OpenClaw's daily search
 * (Jobright, SpeedyApply, company boards) found and did not keep. This file is the pure first cut,
 * the rules a posting's own facts settle (open, entry level, in the US, not seen before), New York
 * and the Bay Area first, then newest first. A posting's age is no rule: companies keep one open
 * for a whole hiring season, and the judge finds the ones that have closed. OpenClaw does the rest (job-wide-net-judge.ts): it screens the
 * titles for software and ML roles, then reads each one and puts it in North Star, the wide net,
 * or neither.
 * The fetch, the store and the schedule live in src/app/api/jobs/wide-net.
 */

export const WIDE_NET_FEED_URL =
  'https://raw.githubusercontent.com/SimplifyJobs/New-Grad-Positions/dev/.github/scripts/listings.json';
export const WIDE_NET_SOURCE = {
  name: 'SimplifyJobs',
  link: 'https://github.com/SimplifyJobs/New-Grad-Positions',
};
/** How many postings one check sends to OpenClaw to judge. */
export const WIDE_NET_JUDGE_PER_RUN = 24;
/** How many postings one check has OpenClaw screen by title. Screening is cheap: it opens nothing. */
export const WIDE_NET_SCREEN_PER_RUN = 180;
/** How long a turned-down posting is remembered, so it is not judged again while the feed still lists it. */
export const WIDE_NET_TURNED_DOWN_KEEP_DAYS = 60;
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
  sponsorship?: unknown;
}

/** A posting a search found and hands in to be judged, as OpenClaw's daily search does with what it did not keep. */
export interface WideNetOffer {
  company: string;
  title: string;
  /** As the posting writes it; several places are separated by ";". */
  location: string;
  link: string;
  /** Where it was found: Jobright, SpeedyApply, a company board. */
  source: string;
  postedDate?: string;
}

/** Where a posting is: New York or the Bay Area, remote in the US, or anywhere else in the US. */
export type WideNetPlace = 'hub' | 'remote' | 'elsewhere';

export type WideNetCandidate = Pick<
  JobListing,
  | 'company' | 'companySummary' | 'positionTitle' | 'location' | 'applicationCategories' | 'track'
  | 'status' | 'salary' | 'link' | 'source' | 'notes' | 'postedDate'
> & { place: WideNetPlace; /** The feed's category, a hint for the title screen. */ category?: string };

export interface WideNetSelection {
  candidates: WideNetCandidate[];
  /** Why the rest of the feed was left out, for the status line on the board. */
  skipped: { closed: number; notSoftware: number; clearance: number; old: number; outsideUs: number; level: number; duplicate: number; overLimit: number };
}

/** The feed's mark for roles that need a clearance: defense contractors, which the wide net leaves out. */
const CLEARANCE = /citizenship is required/i;
const NOT_ENTRY_LEVEL =
  /\b(?:senior|sr|staff|principal|lead|manager|director|head|ph\.?d|intern|internship|co-?op|ii|iii|iv)\b/i;
/** "Member of Technical Staff" is what many AI companies call an engineer of any level, not a staff engineer. */
const TECHNICAL_STAFF = /\bmembers? of (?:the )?technical staff\b/gi;
const notEntryLevel = (title: string) => NOT_ENTRY_LEVEL.test(title.replace(TECHNICAL_STAFF, ''));
const US_STATES = new Set(
  ('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK ' +
    'OR PA RI SC SD TN TX UT VT VA WA WV WI WY').split(' '),
);

/** The feed writes its biggest cities as bare abbreviations, with no state. */
const US_CITY_ABBREVIATIONS = /^(?:sf|nyc|la)$/i;
const HUB =
  /\b(?:sf|nyc)\b|san francisco|new york|brooklyn|manhattan|jersey city|hoboken|bay area|palo alto|mountain view|sunnyvale|san jose|santa clara|cupertino|menlo park|redwood city|foster city|san mateo|san bruno|san carlos|burlingame|oakland|berkeley|emeryville|fremont|milpitas|los gatos|los altos/i;

export function isUsLocation(location: string): boolean {
  const text = location.trim();
  if (/\b(?:usa|united states|u\.s\.)\b/i.test(text)) return true;
  if (/^remote$/i.test(text) || US_CITY_ABBREVIATIONS.test(text)) return true;
  const last = text.split(',').pop()?.trim().toUpperCase() ?? '';
  return US_STATES.has(last);
}

/** New York or the Bay Area if any of the US locations is there, then remote, then the rest of the country. */
export function placeOf(usLocations: string[]): WideNetPlace {
  if (usLocations.some((location) => HUB.test(location))) return 'hub';
  if (usLocations.some((location) => /\bremote\b/i.test(location))) return 'remote';
  return 'elsewhere';
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
 * Pick the feed entries worth a look: open, entry level, no clearance, in the US, not already in
 * `existing` (the box under either track, any status, plus the postings already turned
 * down), and not one OpenClaw's title screen already called not software (`notSoftware`, link
 * keys). New York and the Bay Area first, then newest first, at most `limit`. `maxAgeDays` leaves
 * older postings out when a caller wants that; by default age is not a reason.
 */
export type OfferOutcome = 'accepted' | 'duplicate' | 'level' | 'outside-us';

/**
 * The same first cut for postings a search hands in: entry level, in the US, and not already in
 * `existing` (the box, the turned down, and the ones still waiting to be judged). An offer has no
 * feed category, age or clearance mark; OpenClaw's screen and judge settle the rest.
 */
export function selectOfferedCandidates(
  offers: WideNetOffer[],
  existing: Pick<JobListing, 'company' | 'positionTitle' | 'link'>[],
): { candidates: WideNetCandidate[]; outcomes: OfferOutcome[] } {
  const links = new Set(existing.map((listing) => linkKey(listing.link)));
  const roles = new Set(existing.map(roleKey));
  const candidates: WideNetCandidate[] = [];
  const outcomes = offers.map((offer): OfferOutcome => {
    const company = offer.company.trim();
    const title = offer.title.trim();
    if (notEntryLevel(title)) return 'level';
    const usLocations = offer.location.split(/\s*[;|]\s*/).map((place) => place.trim()).filter(isUsLocation);
    if (usLocations.length === 0) return 'outside-us';
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
      link: cleanLink(offer.link),
      source: { name: offer.source.trim() || 'Unknown', link: cleanLink(offer.link) },
      notes: `Found on ${offer.source.trim() || 'a search'}.`,
      ...(offer.postedDate && /^\d{4}-\d{2}-\d{2}$/.test(offer.postedDate) ? { postedDate: offer.postedDate } : {}),
      place: placeOf(usLocations),
    };
    if (links.has(linkKey(candidate.link)) || roles.has(roleKey(candidate))) return 'duplicate';
    links.add(linkKey(candidate.link));
    roles.add(roleKey(candidate));
    candidates.push(candidate);
    return 'accepted';
  });
  return { candidates, outcomes };
}

export function selectWideNetCandidates(
  feed: WideNetFeedEntry[],
  existing: Pick<JobListing, 'company' | 'positionTitle' | 'link'>[],
  options: { now: number; limit: number; maxAgeDays?: number; notSoftware?: ReadonlySet<string> },
): WideNetSelection {
  const skipped = { closed: 0, notSoftware: 0, clearance: 0, old: 0, outsideUs: 0, level: 0, duplicate: 0, overLimit: 0 };
  const oldest = options.maxAgeDays === undefined ? 0 : options.now - options.maxAgeDays * 86_400_000;
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
    if (options.notSoftware?.has(linkKey(cleanLink(link)))) {
      skipped.notSoftware += 1;
      continue;
    }
    const category = typeof entry.category === 'string' ? entry.category.trim() : '';
    if (notEntryLevel(title) || (degrees.length > 0 && !degrees.some((degree) => /bachelor/i.test(String(degree))))) {
      skipped.level += 1;
      continue;
    }
    if (typeof entry.sponsorship === 'string' && CLEARANCE.test(entry.sponsorship)) {
      skipped.clearance += 1;
      continue;
    }
    const usLocations = locations.filter(isUsLocation);
    if (usLocations.length === 0) {
      skipped.outsideUs += 1;
      continue;
    }
    const place = placeOf(usLocations);
    if (!posted || posted < oldest) {
      skipped.old += 1;
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
      notes: `Wide net: from the SimplifyJobs new-grad feed${category ? ` (${category})` : ''}.`,
      postedDate: new Date(posted).toISOString().slice(0, 10),
      place,
      ...(category ? { category } : {}),
    };
    if (links.has(linkKey(candidate.link)) || roles.has(roleKey(candidate))) {
      skipped.duplicate += 1;
      continue;
    }
    links.add(linkKey(candidate.link));
    roles.add(roleKey(candidate));
    picked.push({ candidate, posted });
  }

  picked.sort(
    (first, second) =>
      Number(second.candidate.place === 'hub') - Number(first.candidate.place === 'hub') || second.posted - first.posted,
  );
  const limit = Math.max(0, options.limit);
  skipped.overLimit = Math.max(0, picked.length - limit);
  return { candidates: picked.slice(0, limit).map((entry) => entry.candidate), skipped };
}

export interface WideNetRun {
  at: string;
  /** How the run started: the schedule, the "Find more now" button, or a search handing postings in. */
  trigger: 'schedule' | 'manual' | 'offer';
  /** Postings saved to the wide net. */
  added: number;
  /** Postings the judge put in the North Star search instead. */
  addedToFocus?: number;
  /** Postings OpenClaw's title screen called not software in this run. */
  screenedOut?: number;
  /** Postings OpenClaw judged in this run and turned down. */
  turnedDown?: number;
  /** Postings sent to OpenClaw that came back without a verdict; the next check sends them again. */
  unjudged?: number;
  /** Open wide-net postings still waiting for the worker after this run. */
  waiting: number;
  skipped?: WideNetSelection['skipped'];
  error?: string;
}

/** A posting OpenClaw judged and turned down. Kept out of the box; Adamya can add it anyway. */
export interface WideNetTurnedDown {
  company: string;
  title: string;
  location: string;
  link: string;
  place: WideNetPlace;
  /** Where it was found. */
  source?: string;
  postedDate?: string;
  /** One line about the company, when OpenClaw gave one. */
  about?: string;
  reason: string;
  /** Whether OpenClaw could read the posting itself, or judged from the company, title and place. */
  read: boolean;
  at: string;
}

export interface WideNetState {
  /** Off stops new postings from being saved; ones already saved stay in the queue. */
  enabled: boolean;
  lastRun?: WideNetRun;
  /** By link key. */
  turnedDown?: Record<string, WideNetTurnedDown>;
  /** What OpenClaw's title screen said of a posting, by link key, so none is screened twice. */
  screened?: Record<string, { software: boolean; at: string }>;
  /** Postings a search handed in that are still waiting to be judged, by link key. */
  offered?: Record<string, WideNetCandidate>;
}
