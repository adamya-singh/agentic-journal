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

interface DayPlan {
  [hour: string]: string | { taskId: string; listType: ListType } | { text: string };
  ranges?: unknown[];
}

// Paths
const PLANS_DIR = path.join(process.cwd(), 'src/backend/data/daily-plans');
const DAILY_LISTS_DIR = path.join(process.cwd(), 'src/backend/data/tasks/daily-lists');

/**
 * Convert ISO date (YYYY-MM-DD) to MMDDYY format
 */
export function isoToMmddyy(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  const yy = year.slice(2);
  return `${month}${day}${yy}`;
}

/**
 * Get the empty plan template
 */
function getEmptyPlanTemplate(): DayPlan {
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
 * Ensure the daily plan file exists for the given date (MMDDYY format)
 * Creates an empty plan from template if it doesn't exist
 */
export function ensureDailyPlanExists(dateMmddyy: string): void {
  const planFilePath = path.join(PLANS_DIR, `${dateMmddyy}.json`);
  
  if (!fs.existsSync(planFilePath)) {
    // Ensure directory exists
    if (!fs.existsSync(PLANS_DIR)) {
      fs.mkdirSync(PLANS_DIR, { recursive: true });
    }
    
    const template = getEmptyPlanTemplate();
    fs.writeFileSync(planFilePath, JSON.stringify(template, null, 2), 'utf-8');
  }
}

/**
 * Ensure the today list exists and contains the task
 * Creates the list file if it doesn't exist, adds the task if not already present
 */
export function ensureTodayListExists(
  dateMmddyy: string,
  listType: ListType,
  task: Task
): void {
  const listFilePath = path.join(DAILY_LISTS_DIR, `${dateMmddyy}-${listType}.json`);
  
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
 * Add a task reference to the 8am slot in the daily plan
 * Only adds if the 8am slot is empty
 */
export function addTaskToPlanAt8am(
  dateMmddyy: string,
  taskId: string,
  listType: ListType
): void {
  const planFilePath = path.join(PLANS_DIR, `${dateMmddyy}.json`);
  
  if (!fs.existsSync(planFilePath)) {
    return; // Plan should exist from ensureDailyPlanExists
  }
  
  const content = fs.readFileSync(planFilePath, 'utf-8');
  const plan: DayPlan = JSON.parse(content);
  
  // Only add if 8am slot is empty
  if (plan['8am'] === '' || plan['8am'] === null || plan['8am'] === undefined) {
    plan['8am'] = { taskId, listType };
    fs.writeFileSync(planFilePath, JSON.stringify(plan, null, 2), 'utf-8');
  }
}

/**
 * Handle due date setup: creates plan, today list, and adds task to 8am slot
 * Call this when a task is created or updated with a due date
 */
export function handleDueDateSetup(
  isoDate: string,
  listType: ListType,
  task: Task
): void {
  const dateMmddyy = isoToMmddyy(isoDate);
  
  ensureDailyPlanExists(dateMmddyy);
  ensureTodayListExists(dateMmddyy, listType, task);
  addTaskToPlanAt8am(dateMmddyy, task.id, listType);
}

