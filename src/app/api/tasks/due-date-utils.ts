import * as fs from 'fs';
import * as path from 'path';

type ListType = 'have-to-do' | 'want-to-do';

interface Task {
  id: string;
  text: string;
  dueDate?: string;
}

interface TasksData {
  _comment: string;
  tasks: Task[];
}

interface TaskJournalRangeEntry {
  start: string;
  end: string;
  taskId: string;
  listType: ListType;
  isPlan: boolean;
}

interface DayJournal {
  [hour: string]: string | { taskId: string; listType: ListType; isPlan?: boolean } | { text: string; isPlan?: boolean };
  ranges?: TaskJournalRangeEntry[];
}

// Paths
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const DAILY_LISTS_DIR = path.join(process.cwd(), 'src/backend/data/tasks/daily-lists');

/**
 * Get the empty journal template
 */
function getEmptyJournalTemplate(): DayJournal {
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
 * Ensure the today list exists and contains the task
 * Creates the list file if it doesn't exist, adds the task if not already present
 */
export function ensureTodayListExists(
  dateIso: string,
  listType: ListType,
  task: Task
): void {
  const listFilePath = path.join(DAILY_LISTS_DIR, `${dateIso}-${listType}.json`);
  
  // Ensure directory exists
  if (!fs.existsSync(DAILY_LISTS_DIR)) {
    fs.mkdirSync(DAILY_LISTS_DIR, { recursive: true });
  }
  
  let data: TasksData;
  
  if (fs.existsSync(listFilePath)) {
    const content = fs.readFileSync(listFilePath, 'utf-8');
    data = JSON.parse(content);
  } else {
    data = {
      _comment: 'Queue structure - first element is highest priority',
      tasks: [],
    };
  }
  
  // Check if task already exists by ID
  const taskExists = data.tasks.some((t) => t.id === task.id);
  
  if (!taskExists) {
    // Add task to the beginning (due tasks are urgent)
    data.tasks.unshift(task);
    fs.writeFileSync(listFilePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  }
}

/**
 * Add a task as a range entry at 8am (8am-8am) in the daily journal with isPlan: true
 * All due tasks are added as ranges so multiple tasks can share the same time
 */
export function addTaskAsRangeAt8am(
  dateIso: string,
  taskId: string,
  listType: ListType
): void {
  const journalFilePath = path.join(JOURNAL_DIR, `${dateIso}.json`);
  
  if (!fs.existsSync(journalFilePath)) {
    return; // Journal should exist from ensureDailyJournalExists
  }
  
  const content = fs.readFileSync(journalFilePath, 'utf-8');
  const journal: DayJournal = JSON.parse(content);
  
  // Ensure ranges array exists
  if (!journal.ranges) {
    journal.ranges = [];
  }
  
  // Check if this task is already in ranges
  const taskAlreadyExists = journal.ranges.some(
    (range) => range.taskId === taskId
  );
  
  if (!taskAlreadyExists) {
    // Add task as a range entry at 8am with isPlan: true
    journal.ranges.push({
      start: '8am',
      end: '8am',
      taskId,
      listType,
      isPlan: true,
    });
    fs.writeFileSync(journalFilePath, JSON.stringify(journal, null, 2), 'utf-8');
  }
}

/**
 * Handle due date setup: creates journal, today list, and adds task as range at 8am
 * Call this when a task is created or updated with a due date
 * @param dateIso - Date in ISO format (YYYY-MM-DD)
 */
export function handleDueDateSetup(
  dateIso: string,
  listType: ListType,
  task: Task
): void {
  ensureDailyJournalExists(dateIso);
  ensureTodayListExists(dateIso, listType, task);
  addTaskAsRangeAt8am(dateIso, task.id, listType);
}
