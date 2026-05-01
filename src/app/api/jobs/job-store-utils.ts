import * as fs from 'fs';
import * as path from 'path';
import { JobListing, JobListingStatus, JobListingsData } from '@/lib/types';

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
    listings: Array.isArray(parsed.listings) ? parsed.listings.map(normalizeJobListing) : [],
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

function normalizeJobListing(listing: JobListing): JobListing {
  return {
    ...listing,
    status: normalizeStatus(listing.status),
  };
}

function normalizeStatus(status: unknown): JobListingStatus {
  return status === 'starred' || status === 'applied' || status === 'archived' ? status : 'saved';
}
