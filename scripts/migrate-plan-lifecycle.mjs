#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const write = process.argv.includes('--write');

function migrateTaskEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return { entry, changed: false };
  }
  if (!('taskId' in entry) || !('listType' in entry) || entry.entryMode !== 'planned') {
    return { entry, changed: false };
  }

  const next = { ...entry };
  let changed = false;
  const nowIso = new Date().toISOString();

  if (!next.planId) {
    next.planId = crypto.randomUUID();
    changed = true;
  }
  if (!next.planStatus) {
    next.planStatus = 'active';
    changed = true;
  }
  if (!next.planCreatedAt) {
    next.planCreatedAt = nowIso;
    changed = true;
  }
  if (!next.planUpdatedAt) {
    next.planUpdatedAt = nowIso;
    changed = true;
  }

  return { entry: next, changed };
}

function migrateSlot(slot) {
  if (!slot || typeof slot === 'string') {
    return { slot, changed: false };
  }

  if (Array.isArray(slot)) {
    let changed = false;
    const next = slot.map((item) => {
      const result = migrateTaskEntry(item);
      changed = changed || result.changed;
      return result.entry;
    });
    return { slot: next, changed };
  }

  const result = migrateTaskEntry(slot);
  return { slot: result.entry, changed: result.changed };
}

function migrateJournal(journal) {
  const next = { ...journal };
  let changed = false;

  for (const [key, value] of Object.entries(journal)) {
    if (key === 'ranges' || key === 'staged' || key === 'indicators') {
      continue;
    }
    const result = migrateSlot(value);
    if (result.changed) {
      next[key] = result.slot;
      changed = true;
    }
  }

  if (Array.isArray(journal.ranges)) {
    const ranges = [];
    let rangesChanged = false;
    for (const range of journal.ranges) {
      const result = migrateTaskEntry(range);
      ranges.push(result.entry);
      rangesChanged = rangesChanged || result.changed;
    }
    if (rangesChanged) {
      next.ranges = ranges;
      changed = true;
    }
  }

  return { journal: next, changed };
}

function run() {
  if (!fs.existsSync(JOURNAL_DIR)) {
    console.error(`Journal directory not found: ${JOURNAL_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(JOURNAL_DIR)
    .filter((name) => name.endsWith('.json') && name !== 'format.json')
    .sort();

  let changedFiles = 0;
  for (const fileName of files) {
    const filePath = path.join(JOURNAL_DIR, fileName);
    const original = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const { journal, changed } = migrateJournal(original);
    if (!changed) continue;

    changedFiles += 1;
    if (write) {
      fs.writeFileSync(filePath, JSON.stringify(journal, null, 2), 'utf-8');
    }
  }

  const mode = write ? 'write' : 'check';
  console.log(`[migrate-plan-lifecycle] mode=${mode} files=${files.length} changed=${changedFiles}`);
}

run();
