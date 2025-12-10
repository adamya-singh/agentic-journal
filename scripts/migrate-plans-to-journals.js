#!/usr/bin/env node
/**
 * Migration script to consolidate daily-plans into journals
 * 
 * This script:
 * 1. Reads all plan files from daily-plans/
 * 2. For each plan entry, adds isPlan: true flag
 * 3. Merges plan entries into corresponding journal files
 * 4. Creates journal files if they don't exist
 * 5. Optionally deletes the daily-plans directory after migration
 * 
 * Run with: node scripts/migrate-plans-to-journals.js
 * Add --delete flag to remove daily-plans directory after migration
 */

const fs = require('fs');
const path = require('path');

const PLANS_DIR = path.join(__dirname, '../src/backend/data/daily-plans');
const JOURNAL_DIR = path.join(__dirname, '../src/backend/data/journal');

// Valid hours of the day
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

// Get the empty journal template
function getEmptyJournal() {
  const journal = {};
  for (const hour of VALID_HOURS) {
    journal[hour] = '';
  }
  journal.ranges = [];
  return journal;
}

// Check if an entry has content (not empty)
function hasContent(entry) {
  if (!entry) return false;
  if (typeof entry === 'string') return entry.trim() !== '';
  if (typeof entry === 'object') {
    // TaskEntry has taskId, TextEntry has text
    return entry.taskId || (entry.text && entry.text.trim() !== '');
  }
  return false;
}

// Add isPlan flag to an entry
function addIsPlanFlag(entry) {
  if (typeof entry === 'string' && entry.trim() !== '') {
    return { text: entry, isPlan: true };
  }
  if (typeof entry === 'object' && entry !== null) {
    return { ...entry, isPlan: true };
  }
  return entry;
}

// Read and parse a JSON file
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Error reading ${filePath}:`, error.message);
    return null;
  }
}

// Write JSON to a file
function writeJsonFile(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// Migrate a single plan file into a journal
function migratePlanToJournal(planFile) {
  const planPath = path.join(PLANS_DIR, planFile);
  const journalPath = path.join(JOURNAL_DIR, planFile);
  
  console.log(`\nProcessing: ${planFile}`);
  
  // Read the plan file
  const plan = readJsonFile(planPath);
  if (!plan) {
    console.log(`  Skipping: Could not read plan file`);
    return { migrated: 0, skipped: 1 };
  }
  
  // Read the existing journal or create new one
  let journal;
  if (fs.existsSync(journalPath)) {
    journal = readJsonFile(journalPath);
    if (!journal) {
      console.log(`  Skipping: Could not read existing journal`);
      return { migrated: 0, skipped: 1 };
    }
    console.log(`  Merging with existing journal`);
  } else {
    journal = getEmptyJournal();
    console.log(`  Creating new journal`);
  }
  
  // Ensure ranges array exists
  if (!journal.ranges) {
    journal.ranges = [];
  }
  
  let entriesAdded = 0;
  
  // Migrate hourly entries
  for (const hour of VALID_HOURS) {
    const planEntry = plan[hour];
    if (hasContent(planEntry)) {
      const migratedEntry = addIsPlanFlag(planEntry);
      
      // Check if journal already has content at this hour
      const existingEntry = journal[hour];
      if (hasContent(existingEntry)) {
        // Journal already has an entry - don't overwrite, log warning
        console.log(`  Warning: Hour ${hour} already has journal entry, keeping existing`);
      } else {
        journal[hour] = migratedEntry;
        console.log(`  Migrated: ${hour} -> isPlan entry`);
        entriesAdded++;
      }
    }
  }
  
  // Migrate range entries
  if (plan.ranges && Array.isArray(plan.ranges)) {
    for (const range of plan.ranges) {
      if (hasContent(range) || range.taskId) {
        const migratedRange = addIsPlanFlag(range);
        
        // Check if this range already exists
        const existingRange = journal.ranges.find(
          r => r.start === range.start && r.end === range.end
        );
        
        if (existingRange) {
          console.log(`  Warning: Range ${range.start}-${range.end} already exists, keeping existing`);
        } else {
          journal.ranges.push(migratedRange);
          console.log(`  Migrated: ${range.start}-${range.end} -> isPlan range`);
          entriesAdded++;
        }
      }
    }
  }
  
  // Write the updated journal
  writeJsonFile(journalPath, journal);
  console.log(`  Saved: ${entriesAdded} entries migrated`);
  
  return { migrated: 1, skipped: 0, entriesAdded };
}

// Main migration function
function main() {
  const args = process.argv.slice(2);
  const shouldDelete = args.includes('--delete');
  
  console.log('='.repeat(60));
  console.log('Daily Plans to Journals Migration');
  console.log('='.repeat(60));
  
  // Check if plans directory exists
  if (!fs.existsSync(PLANS_DIR)) {
    console.log('\nNo daily-plans directory found. Nothing to migrate.');
    return;
  }
  
  // Get all plan files (excluding format.json)
  const planFiles = fs.readdirSync(PLANS_DIR)
    .filter(f => f.endsWith('.json') && f !== 'format.json');
  
  if (planFiles.length === 0) {
    console.log('\nNo plan files found to migrate.');
    return;
  }
  
  console.log(`\nFound ${planFiles.length} plan files to migrate:`);
  planFiles.forEach(f => console.log(`  - ${f}`));
  
  // Migrate each plan file
  let totalMigrated = 0;
  let totalSkipped = 0;
  let totalEntries = 0;
  
  for (const planFile of planFiles) {
    const result = migratePlanToJournal(planFile);
    totalMigrated += result.migrated;
    totalSkipped += result.skipped;
    totalEntries += result.entriesAdded || 0;
  }
  
  console.log('\n' + '='.repeat(60));
  console.log('Migration Summary');
  console.log('='.repeat(60));
  console.log(`Files migrated: ${totalMigrated}`);
  console.log(`Files skipped:  ${totalSkipped}`);
  console.log(`Total entries:  ${totalEntries}`);
  
  // Delete daily-plans directory if requested
  if (shouldDelete && totalMigrated > 0) {
    console.log('\nDeleting daily-plans directory...');
    fs.rmSync(PLANS_DIR, { recursive: true, force: true });
    console.log('Daily-plans directory deleted.');
  } else if (totalMigrated > 0) {
    console.log('\nTo delete the daily-plans directory, run with --delete flag:');
    console.log('  node scripts/migrate-plans-to-journals.js --delete');
  }
  
  console.log('\nMigration complete!');
}

main();

