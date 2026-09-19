#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const jobsDir = process.env.JOB_APPLICATION_JOBS_DIR || path.join(process.cwd(), 'src/backend/data/jobs');
const applicationsPath = path.join(jobsDir, 'applications.json');
const listingsPath = path.join(jobsDir, 'listings.json');
const write = process.argv.includes('--write');
const atArgument = process.argv.find((argument) => argument.startsWith('--at='));
const requestedAt = atArgument ? atArgument.slice(5) : new Date().toISOString();
const migrationAt = new Date(requestedAt);
if (Number.isNaN(migrationAt.getTime())) throw new Error(`Invalid migration time: ${requestedAt}`);

const store = JSON.parse(fs.readFileSync(applicationsPath, 'utf8'));
const listings = JSON.parse(fs.readFileSync(listingsPath, 'utf8')).listings ?? [];
const effectiveAt = store.autopilotMigrationAt || migrationAt.toISOString();
const eligibleAt = new Date(Date.parse(effectiveAt) + 72 * 60 * 60 * 1000).toISOString();
store.schemaVersion = 2;
store.reviewItems = Array.isArray(store.reviewItems) ? store.reviewItems : [];
store.answerBank = Array.isArray(store.answerBank) ? store.answerBank : [];
store.applications = store.applications && typeof store.applications === 'object' ? store.applications : {};
store.autopilotMigrationAt = effectiveAt;
store.workerEnabled = false;

let awaitingMigrated = 0;
let simplifyQueued = 0;
for (const application of Object.values(store.applications)) {
  if (application.status === 'awaiting-user-input' && !application.awaitingInputSince) {
    application.awaitingInputSince = effectiveAt;
    application.autoCompleteEligibleAt = eligibleAt;
    awaitingMigrated += 1;
  }
}
for (const listing of listings) {
  if (listing.status !== 'applied') continue;
  let application = store.applications[listing.id];
  if (!application) {
    const submittedAt = listing.updatedAt || listing.savedAt || listing.createdAt || effectiveAt;
    application = {
      listingId: listing.id,
      status: 'submitted',
      resumeVariant: /machine learning|\bmle\b|artificial intelligence|data scien/i.test(`${listing.positionTitle} ${listing.notes || ''}`) ? 'mle' : 'swe',
      attemptCount: 0,
      statusHistory: [{ status: 'submitted', changedAt: submittedAt }],
      questions: [], submittedAt, createdAt: listing.savedAt || listing.createdAt || submittedAt,
      updatedAt: submittedAt,
    };
    store.applications[listing.id] = application;
  }
  if (application.simplifySync?.status !== 'synced') {
    application.simplifySync = {
      status: 'pending',
      attemptCount: application.simplifySync?.attemptCount || 0,
      updatedAt: effectiveAt,
    };
    simplifyQueued += 1;
  }
}

const summary = { migrationAt: effectiveAt, eligibleAt, awaitingMigrated, simplifyQueued, write };
if (write) {
  const backupStamp = effectiveAt.replace(/[:.]/g, '-');
  const backupPath = path.join(jobsDir, `applications.pre-autopilot-${backupStamp}.json`);
  if (!fs.existsSync(backupPath)) fs.copyFileSync(applicationsPath, backupPath);
  const temporaryPath = `${applicationsPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(temporaryPath, applicationsPath);
}
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
