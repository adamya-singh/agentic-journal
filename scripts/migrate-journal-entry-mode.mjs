#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

const HOURS = [
  '7am', '8am', '9am', '10am', '11am', '12pm',
  '1pm', '2pm', '3pm', '4pm', '5pm', '6pm',
  '7pm', '8pm', '9pm', '10pm', '11pm', '12am',
  '1am', '2am', '3am', '4am', '5am', '6am',
];

function toEntryMode(value) {
  if (value === 'planned' || value === 'logged') {
    return value;
  }
  return value === true ? 'planned' : 'logged';
}

function migrateEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }

  const isTaskEntry = 'taskId' in entry && 'listType' in entry;
  const isTextEntry = 'text' in entry && !('taskId' in entry);
  if (!isTaskEntry && !isTextEntry) {
    return entry;
  }

  const migrated = { ...entry };
  migrated.entryMode = toEntryMode(entry.entryMode ?? entry.isPlan);
  delete migrated.isPlan;
  return migrated;
}

function migrateRange(range) {
  if (!range || typeof range !== 'object' || Array.isArray(range)) {
    return range;
  }

  const migrated = { ...range };
  migrated.entryMode = toEntryMode(range.entryMode ?? range.isPlan);
  delete migrated.isPlan;
  return migrated;
}

function migrateStagedEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return entry;
  }

  const migrated = { ...entry };
  delete migrated.isPlan;
  return migrated;
}

function migrateJournal(journal) {
  const migrated = { ...journal };
  let changed = false;

  for (const hour of HOURS) {
    const slot = migrated[hour];
    if (!slot) continue;

    if (Array.isArray(slot)) {
      const nextSlot = slot.map((entry) => migrateEntry(entry));
      if (JSON.stringify(nextSlot) !== JSON.stringify(slot)) {
        migrated[hour] = nextSlot;
        changed = true;
      }
      continue;
    }

    const nextSlot = migrateEntry(slot);
    if (JSON.stringify(nextSlot) !== JSON.stringify(slot)) {
      migrated[hour] = nextSlot;
      changed = true;
    }
  }

  if (Array.isArray(migrated.ranges)) {
    const nextRanges = migrated.ranges.map((range) => migrateRange(range));
    if (JSON.stringify(nextRanges) !== JSON.stringify(migrated.ranges)) {
      migrated.ranges = nextRanges;
      changed = true;
    }
  }

  if (Array.isArray(migrated.staged)) {
    const nextStaged = migrated.staged.map((entry) => migrateStagedEntry(entry));
    if (JSON.stringify(nextStaged) !== JSON.stringify(migrated.staged)) {
      migrated.staged = nextStaged;
      changed = true;
    }
  }

  return { migrated, changed };
}

function main() {
  const write = process.argv.includes('--write');

  if (!fs.existsSync(JOURNAL_DIR)) {
    console.error(`Journal directory not found: ${JOURNAL_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(JOURNAL_DIR).filter((name) => name.endsWith('.json')).sort();
  let changedFiles = 0;

  for (const fileName of files) {
    const filePath = path.join(JOURNAL_DIR, fileName);
    const originalText = fs.readFileSync(filePath, 'utf-8');
    const original = JSON.parse(originalText);
    const { migrated, changed } = migrateJournal(original);

    if (!changed) {
      continue;
    }

    changedFiles += 1;
    if (write) {
      fs.writeFileSync(filePath, JSON.stringify(migrated, null, 2), 'utf-8');
    }
  }

  const mode = write ? 'write' : 'check';
  console.log(`[migrate-journal-entry-mode] mode=${mode} files=${files.length} changed=${changedFiles}`);

  if (!write && changedFiles > 0) {
    process.exitCode = 2;
  }
}

main();
