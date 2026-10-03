import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

// Exercise the actual CLI and persistence lock using synthetic state and PNG evidence.
const repository = process.cwd();
test('repair preserves workflow state, retains evidence, and rejects stale or unreviewed images', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'question-image-repair-test-'));
  try {
    const listingId = 'fixture-listing';
    const timestamp = '2026-10-03T12:00:00.000Z';
    const image = path.join(directory, 'reviewed.png');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAHgAAAAUCAIAAADJMG6kAAAAWUlEQVR4nO3YsQkAIAwFUb+4/8pxg3SeoPfaNOFIIaaqhs6btxf4haEhhoYYGrL6cRJmjzc0LwsvGmJoiKEhhoYYGmJoiKEhhoYYGmJoSPyPZnjREENDDA3ZIIwJI1mmajYAAAAASUVORK5CYII=', 'base64');
    fs.writeFileSync(image, png);
    const source = path.join(directory, 'original.png');
    fs.writeFileSync(source, png);
    const question = { id: 'fixture-question', prompt: 'Example?', kind: 'text', required: true,
      resolution: 'answered', discoveredAt: timestamp, answer: 'Saved answer',
      answerScreenshot: { id: 'fcb5baed-251d-48df-9155-485da4608cd0', attemptCount: 2,
        capturedAt: timestamp, width: 120, height: 20, byteSize: png.length } };
    const application: any = { listingId, status: 'submitted', resumeVariant: 'swe', attemptCount: 2,
      statusHistory: [], questions: [question], createdAt: timestamp, updatedAt: timestamp,
      reviewHoldSince: timestamp, submittedAt: timestamp };
    const original = { schemaVersion: 3, workerEnabled: false,
      enabledApplicationCategories: ['spring-internship', 'new-grad'], applications: { [listingId]: application },
      answerBank: [], reviewItems: [], emailUpdates: { enabled: false, pending: [], processed: {} } };
    const storePath = path.join(directory, 'applications.json');
    fs.writeFileSync(storePath, JSON.stringify(original));
    const rows = [{ listingId, questionId: question.id, oldScreenshotId: question.answerScreenshot.id,
      originalAnswer: question.answer, path: image, sha256: createHash('sha256').update(fs.readFileSync(image)).digest('hex'),
      verified: true, capturedAt: new Date().toISOString(), attemptCount: application.attemptCount }];
    const manifest = path.join(directory, 'manifest.json');
    const run = (apply = false) => {
      fs.writeFileSync(manifest, JSON.stringify(rows));
      return spawnSync(process.execPath, ['--import', './scripts/test-register.mjs', 'scripts/repair-question-screenshots.ts', manifest,
        ...(apply ? ['--apply'] : [])], { cwd: repository, encoding: 'utf8', env: { ...process.env,
          JOB_APPLICATION_JOBS_DIR: directory, JOB_APPLICATION_SCREENSHOTS_DIR: path.join(directory, 'images') } });
    };
    const strip = (store: any) => {
      for (const app of Object.values(store.applications) as any[]) for (const q of app.questions) delete q.answerScreenshot;
      return store;
    };
    assert.equal(run().status, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(storePath, 'utf8')), original);
    rows[0].verified = false;
    assert.notEqual(run(true).status, 0);
    rows[0].verified = true;
    original.applications[listingId].lease = { token: 'test', claimedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60000).toISOString() };
    fs.writeFileSync(storePath, JSON.stringify(original));
    assert.notEqual(run(true).status, 0);
    delete original.applications[listingId].lease;
    fs.writeFileSync(storePath, JSON.stringify(original));
    rows[0].sha256 = 'bad';
    assert.notEqual(run(true).status, 0);
    rows[0].sha256 = createHash('sha256').update(fs.readFileSync(image)).digest('hex');
    const applied = run(true);
    assert.equal(applied.status, 0, applied.stderr);
    const after = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const replacement = after.applications[listingId].questions.find((q: any) => q.id === question.id).answerScreenshot;
    assert.notEqual(replacement.id, rows[0].oldScreenshotId);
    assert.deepEqual(fs.readFileSync(path.join(directory, 'images/question-answers', `${replacement.id}.png`)), fs.readFileSync(image));
    assert.ok(fs.existsSync(source));
    assert.deepEqual(strip(after), strip(structuredClone(original)));
    assert.notEqual(run(true).status, 0, 'stale manifest must not overwrite the newer image');
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
