import * as fs from 'fs';
import * as path from 'path';
import type {
  JobApplicationCategory,
  JobListing,
  JobListingSource,
  JobListingStatus,
  JobListingStatusHistoryEntry,
  JobListingsData,
  LegacyJobType,
} from '@/lib/types';

const JOBS_DIR =
  process.env.JOB_APPLICATION_JOBS_DIR || path.join(process.cwd(), 'src/backend/data/jobs');
const JOBS_FILE = path.join(JOBS_DIR, 'listings.json');

export function getEmptyJobListingsData(): JobListingsData {
  return {
    schemaVersion: 2,
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
    schemaVersion: 2,
    listings: Array.isArray(parsed.listings)
      ? parsed.listings.map((listing) => normalizeJobListing(listing))
      : [],
  };
}

export function writeJobListings(data: JobListingsData): void {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  const temporaryPath = `${JOBS_FILE}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(
    temporaryPath,
    `${JSON.stringify({ ...data, schemaVersion: 2 }, null, 2)}\n`,
    'utf-8',
  );
  fs.renameSync(temporaryPath, JOBS_FILE);
}

export function ensureJobListingsFile(): JobListingsData {
  const data = readJobListings();
  writeJobListings(data);
  return data;
}

type StoredJobListing = Partial<JobListing> & { jobType?: unknown };

function normalizeJobListing(listing: StoredJobListing): JobListing {
  const fallbackTimestamp = new Date().toISOString();
  const link = normalizeString(listing.link);
  const sourceFromNotes = parseSourceFromNotes(listing.notes);
  const savedAt =
    normalizeTimestamp(listing.savedAt) ??
    normalizeTimestamp(listing.createdAt) ??
    fallbackTimestamp;
  const createdAt = normalizeTimestamp(listing.createdAt) ?? savedAt;
  const updatedAt = normalizeTimestamp(listing.updatedAt) ?? createdAt;
  const postedDate = normalizePostedDate(listing.postedDate);
  const postedDateText = normalizeNonEmptyString(listing.postedDateText);
  const normalized: JobListing = {
    id: normalizeString(listing.id),
    company: normalizeString(listing.company),
    companySummary:
      normalizeString(listing.companySummary) || 'Company description not available yet.',
    positionTitle: normalizeString(listing.positionTitle),
    location: normalizeString(listing.location),
    applicationCategories: normalizeApplicationCategories(listing),
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

function normalizeSource(
  source: unknown,
  sourceNameFromNotes: string | undefined,
  listingLink: string,
): JobListingSource {
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

const APPLICATION_CATEGORIES: JobApplicationCategory[] = [
  'fall-internship',
  'spring-internship',
  'summer-internship',
  'new-grad',
];

export function normalizeApplicationCategories(listing: {
  applicationCategories?: unknown;
  jobType?: unknown;
  positionTitle?: unknown;
}): JobApplicationCategory[] {
  const storedCategories = listing.applicationCategories;
  if (Array.isArray(storedCategories)) {
    const categories = APPLICATION_CATEGORIES.filter((category) =>
      storedCategories.includes(category),
    );
    if (categories.length > 0) {
      return categories;
    }
  }

  const titleCategories = inferExplicitInternshipCategories(listing.positionTitle);
  if (titleCategories.length > 0) {
    return titleCategories;
  }

  const legacyType = listing.jobType as LegacyJobType | undefined;
  if (legacyType === 'fall-coop') {
    return ['fall-internship'];
  }
  if (legacyType === 'spring-coop') {
    return ['spring-internship'];
  }
  return ['new-grad'];
}

export function inferExplicitInternshipCategories(title: unknown): JobApplicationCategory[] {
  if (typeof title !== 'string' || !/\b(?:intern(?:ship)?|co[ -]?op)\b/i.test(title)) {
    return [];
  }

  return APPLICATION_CATEGORIES.filter((category) => {
    if (category === 'new-grad') {
      return false;
    }
    const season = category.slice(0, category.indexOf('-'));
    return new RegExp(`\\b${season}\\b`, 'i').test(title);
  });
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
