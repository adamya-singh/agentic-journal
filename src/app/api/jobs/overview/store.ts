import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { overview, milestoneKinds, type OverviewExtras } from '@/lib/job-overview';
import { readJobApplicationsStore } from '../application-store-utils';
import { readJobListings } from '../job-store-utils';

export const directory = () =>
  process.env.JOB_APPLICATION_JOBS_DIR || path.join(process.cwd(), 'src/backend/data/jobs');
export function readJson<T>(name: string, fallback: T): T {
  const file = path.join(directory(), name);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}
export function saveJson(name: string, value: unknown) {
  fs.mkdirSync(directory(), { recursive: true });
  const file = path.join(directory(), name);
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
export function readExtras(): OverviewExtras {
  return readJson('overview-metadata.json', { milestones: {}, groups: [] });
}
export function readOverview() {
  return overview(readJobListings().listings, readJobApplicationsStore(), readExtras());
}
export const MutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('milestone'),
    listingId: z.string(),
    kind: z.enum(milestoneKinds),
    occurredAt: z.string().datetime({ offset: true }),
    note: z.string().max(500).default(''),
    supersedes: z.string().optional(),
  }),
  z.object({ action: z.literal('group'), listingIds: z.array(z.string()).min(2).max(20) }),
  z.object({ action: z.literal('ungroup'), id: z.string() }),
]);
export async function withOverviewLock<T>(name: string, run: () => Promise<T>): Promise<T> {
  fs.mkdirSync(directory(), { recursive: true });
  const lock = path.join(directory(), `.${name}.lock`);
  // Exclusive files serialize across Next workers; stale locks recover after crashes.
  try {
    if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 300000) fs.unlinkSync(lock);
  } catch {}
  let fd: number;
  try {
    fd = fs.openSync(lock, 'wx');
  } catch {
    throw new Error('An operation is already running. Try again shortly.');
  }
  try {
    return await run();
  } finally {
    fs.closeSync(fd);
    fs.unlinkSync(lock);
  }
}
