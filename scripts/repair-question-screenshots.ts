/** Replace visually reviewed question images without changing application workflow state.
 * node --import ./scripts/test-register.mjs scripts/repair-question-screenshots.ts manifest.json [--apply]
 * Manifest and source images are local maintenance artifacts, never committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  createApplicationScreenshotId,
  getPngDimensions,
  getQuestionScreenshotFilePath,
  isPng,
  mutateJobApplicationsStore,
  readJobApplicationsStore,
} from '../src/app/api/jobs/application-store-utils';
import type { JobApplicationsStoreData } from '../src/lib/types';

interface Replacement {
  listingId: string;
  questionId: string;
  oldScreenshotId: string;
  originalAnswer: unknown;
  path: string;
  sha256: string;
  verified: boolean;
  capturedAt: string;
  attemptCount: number;
  sourceParts?: { sourceScreenshotId: string }[];
}

function withoutQuestionImages(store: JobApplicationsStoreData) {
  const copy = structuredClone(store);
  for (const application of Object.values(copy.applications)) {
    for (const question of application.questions) delete question.answerScreenshot;
  }
  return copy;
}

export async function repairQuestionScreenshots(rows: Replacement[], apply = false) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('Empty repair manifest');
  const seen = new Set<string>();
  const prepared = rows.map(row => {
    const key = `${row.listingId}/${row.questionId}`;
    if (seen.has(key)) throw new Error(`Duplicate question: ${key}`);
    seen.add(key);
    if (row.verified !== true || !path.isAbsolute(row.path)) throw new Error(`Unreviewed image: ${key}`);
    const bytes = fs.readFileSync(row.path);
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Image changed after review: ${key}`);
    if (!isPng(bytes) || bytes.length > 5 * 1024 * 1024) throw new Error(`Invalid PNG: ${key}`);
    const { width, height } = getPngDimensions(bytes);
    if (width < 120 || width > 2000 || height > 2200) throw new Error(`Invalid image dimensions: ${key}`);
    if (!Number.isInteger(row.attemptCount) || row.attemptCount < 1 || !Number.isFinite(Date.parse(row.capturedAt))) {
      throw new Error(`Invalid capture metadata: ${key}`);
    }
    return { row, bytes, width, height, id: createApplicationScreenshotId() };
  });
  const validate = (store: JobApplicationsStoreData) => {
    for (const { row } of prepared) {
      const application = store.applications[row.listingId];
      const question = application?.questions.find(q => q.id === row.questionId);
      if (!question || question.answerScreenshot?.id !== row.oldScreenshotId ||
          !isDeepStrictEqual(question.answer, row.originalAnswer)) {
        throw new Error(`Question changed since repair was prepared: ${row.questionId}`);
      }
      if (application.lease && Date.parse(application.lease.expiresAt) > Date.now()) {
        throw new Error(`Application has an active worker: ${row.listingId}`);
      }
      if (row.sourceParts?.length) {
        const capture = application.screenshotCapture;
        if (capture?.attemptCount !== row.attemptCount || !row.sourceParts.every(part =>
          capture.screenshots.some(image => image.id === part.sourceScreenshotId))) {
          throw new Error(`Archive does not belong to this application: ${row.questionId}`);
        }
      } else if (row.attemptCount !== application.attemptCount) {
        throw new Error(`Live capture attempt changed: ${row.questionId}`);
      }
    }
  };
  if (!apply) {
    validate(readJobApplicationsStore());
    return { applied: false, count: prepared.length };
  }
  const written: string[] = [];
  try {
    return await mutateJobApplicationsStore(store => {
      validate(store);
      const before = withoutQuestionImages(store);
      for (const { row, bytes, width, height, id } of prepared) {
        const destination = getQuestionScreenshotFilePath(id);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, bytes, { flag: 'wx', mode: 0o600 });
        written.push(destination);
        const question = store.applications[row.listingId].questions.find(q => q.id === row.questionId)!;
        question.answerScreenshot = {
          id, attemptCount: row.attemptCount, capturedAt: row.capturedAt,
          width, height, byteSize: bytes.length,
        };
      }
      if (!isDeepStrictEqual(before, withoutQuestionImages(store))) throw new Error('Repair changed application workflow state');
      return { applied: true, count: prepared.length, replacements: prepared.map(({ row, id }) => ({
        listingId: row.listingId, questionId: row.questionId, oldScreenshotId: row.oldScreenshotId, id,
      })) };
    });
  } catch (error) {
    // Original images are retained; failed writes never remove historical evidence.
    for (const destination of written) fs.rmSync(destination, { force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const manifest = process.argv[2];
  if (!manifest) throw new Error('Usage: repair-question-screenshots.ts manifest.json [--apply]');
  const rows = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  console.log(JSON.stringify(await repairQuestionScreenshots(rows, process.argv.includes('--apply')), null, 2));
}
