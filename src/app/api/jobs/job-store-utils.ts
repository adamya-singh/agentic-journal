import * as fs from 'fs';
import * as path from 'path';
import { JobListing, JobListingSource, JobListingStatus, JobListingStatusHistoryEntry, JobListingsData, JobType } from '@/lib/types';

const JOBS_DIR = path.join(process.cwd(), 'src/backend/data/jobs');
const JOBS_FILE = path.join(JOBS_DIR, 'listings.json');

export function getEmptyJobListingsData(): JobListingsData {
  return {
    schemaVersion: 1,
    listings: [],
  };
}

export function readJobListings(): JobListingsData {
  if (!fs.existsSync(JOBS_FILE)) {
    return getEmptyJobListingsData();
  }

  const content = fs.readFileSync(JOBS_FILE, 'utf-8');
  const parsed = JSON.parse(content) as Partial<JobListingsData>;

  return {
    schemaVersion: 1,
    listings: Array.isArray(parsed.listings) ? parsed.listings.map((listing) => normalizeJobListing(listing)) : [],
  };
}

export function writeJobListings(data: JobListingsData): void {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function ensureJobListingsFile(): JobListingsData {
  const data = readJobListings();
  writeJobListings(data);
  return data;
}

function normalizeJobListing(listing: Partial<JobListing>): JobListing {
  const fallbackTimestamp = new Date().toISOString();
  const link = normalizeString(listing.link);
  const sourceFromNotes = parseSourceFromNotes(listing.notes);
  const savedAt = normalizeTimestamp(listing.savedAt) ?? normalizeTimestamp(listing.createdAt) ?? fallbackTimestamp;
  const createdAt = normalizeTimestamp(listing.createdAt) ?? savedAt;
  const updatedAt = normalizeTimestamp(listing.updatedAt) ?? createdAt;
  const postedDate = normalizePostedDate(listing.postedDate);
  const postedDateText = normalizeNonEmptyString(listing.postedDateText);
  const normalized: JobListing = {
    id: normalizeString(listing.id),
    company: normalizeString(listing.company),
    companySummary: normalizeString(listing.companySummary) || 'Company description not available yet.',
    positionTitle: normalizeString(listing.positionTitle),
    location: normalizeString(listing.location),
    jobType: normalizeJobType(listing.jobType),
    status: normalizeStatus(listing.status),
    salary: normalizeString(listing.salary),
    link,
    source: normalizeSource(listing.source, sourceFromNotes?.name, link),
    notes: sourceFromNotes?.notes ?? normalizeString(listing.notes),
    savedAt,
    statusHistory: normalizeStatusHistory(listing.statusHistory),
    createdAt,
    updatedAt,
  };

  if (postedDate) {
    normalized.postedDate = postedDate;
  }

  if (postedDateText) {
    normalized.postedDateText = postedDateText;
  }

  return normalized;
}

function normalizeSource(source: unknown, sourceNameFromNotes: string | undefined, listingLink: string): JobListingSource {
  const fallbackName = sourceNameFromNotes || 'Unknown';
  const fallbackLink = listingLink;

  if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
    const record = source as Record<string, unknown>;
    const name = normalizeString(record.name) || fallbackName;
    const link = normalizeString(record.link) || fallbackLink;
    return { name, link };
  }

  return {
    name: fallbackName,
    link: fallbackLink,
  };
}

function parseSourceFromNotes(value: unknown): { name: string; notes: string } | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const match = value.match(/^\s*Source:\s*([^.\n]+)\.\s*(.*)$/i);
  if (!match) {
    return undefined;
  }

  return {
    name: match[1].trim(),
    notes: match[2].trim(),
  };
}

function normalizeStatus(status: unknown): JobListingStatus {
  return status === 'starred' || status === 'applied' || status === 'archived' ? status : 'saved';
}

function normalizeJobType(jobType: unknown): JobType {
  return jobType === 'fall-coop' || jobType === 'spring-coop' || jobType === 'new-grad' ? jobType : 'new-grad';
}

function normalizeStatusHistory(value: unknown): JobListingStatusHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      return [];
    }

    const status = normalizeStatus((entry as Record<string, unknown>).status);
    const changedAt = normalizeTimestamp((entry as Record<string, unknown>).changedAt);
    return changedAt ? [{ status, changedAt }] : [];
  });
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeTimestamp(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function normalizePostedDate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : undefined;
}
