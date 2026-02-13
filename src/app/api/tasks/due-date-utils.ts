import * as fs from 'fs';
import * as path from 'path';
import { Task, ListType, JournalRangeEntry, StagedTaskEntry, JournalHourSlot } from '@/lib/types';

// Local DayJournal type that matches the file structure
interface DayJournalFile {
  [key: string]: JournalHourSlot | JournalRangeEntry[] | StagedTaskEntry[] | undefined;
  ranges?: JournalRangeEntry[];
  staged?: StagedTaskEntry[];
}

// Paths
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');

/**
 * Get the empty journal template
 */
function getEmptyJournalTemplate(): DayJournalFile {
  return {
    '7am': '',
    '8am': '',
    '9am': '',
    '10am': '',
    '11am': '',
    '12pm': '',
    '1pm': '',
    '2pm': '',
    '3pm': '',
    '4pm': '',
    '5pm': '',
    '6pm': '',
    '7pm': '',
    '8pm': '',
    '9pm': '',
    '10pm': '',
    '11pm': '',
    '12am': '',
    '1am': '',
    '2am': '',
    '3am': '',
    '4am': '',
    '5am': '',
    '6am': '',
    ranges: [],
    staged: [],
  };
}

/**
 * Ensure the daily journal file exists for the given date (ISO format: YYYY-MM-DD)
 * Creates an empty journal from template if it doesn't exist
 */
export function ensureDailyJournalExists(dateIso: string): void {
  const journalFilePath = path.join(JOURNAL_DIR, `${dateIso}.json`);
  
  if (!fs.existsSync(journalFilePath)) {
    // Ensure directory exists
    if (!fs.existsSync(JOURNAL_DIR)) {
      fs.mkdirSync(JOURNAL_DIR, { recursive: true });
    }
    
    const template = getEmptyJournalTemplate();
    fs.writeFileSync(journalFilePath, JSON.stringify(template, null, 2), 'utf-8');
  }
}

/**
 * Add a task to the staged area in the daily journal.
 * Staged tasks are due on this day but not yet scheduled to a specific time
 */
export function addTaskToStaged(
  dateIso: string,
  taskId: string,
  listType: ListType
): void {
  const journalFilePath = path.join(JOURNAL_DIR, `${dateIso}.json`);
  
  if (!fs.existsSync(journalFilePath)) {
    return; // Journal should exist from ensureDailyJournalExists
  }
  
  const content = fs.readFileSync(journalFilePath, 'utf-8');
  const journal: DayJournalFile = JSON.parse(content);
  
  // Ensure staged array exists
  if (!journal.staged) {
    journal.staged = [];
  }
  
  // Check if this task is already staged
  const taskAlreadyExists = journal.staged.some(
    (entry) => entry.taskId === taskId
  );
  
  if (!taskAlreadyExists) {
    // Add task to staged area
    journal.staged.push({
      taskId,
      listType,
    });
    fs.writeFileSync(journalFilePath, JSON.stringify(journal, null, 2), 'utf-8');
  }
}

/**
 * Handle due date setup: creates journal and adds task to staged area.
 * Today's visible task list is now computed dynamically at read time.
 * Call this when a task is created or updated with a due date
 * @param dateIso - Date in ISO format (YYYY-MM-DD)
 */
export function handleDueDateSetup(
  dateIso: string,
  listType: ListType,
  task: Task
): void {
  ensureDailyJournalExists(dateIso);
  addTaskToStaged(dateIso, task.id, listType);
}
