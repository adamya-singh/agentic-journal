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

interface TaskPlanRangeEntry {
  start: string;
  end: string;
  taskId: string;
  listType: ListType;
}

interface DayPlan {
  [hour: string]: string | { taskId: string; listType: ListType } | { text: string };
  ranges?: TaskPlanRangeEntry[];
}

// Paths
const PLANS_DIR = path.join(process.cwd(), 'src/backend/data/daily-plans');
const DAILY_LISTS_DIR = path.join(process.cwd(), 'src/backend/data/tasks/daily-lists');

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
 * Ensure the daily plan file exists for the given date (ISO format: YYYY-MM-DD)
 * Creates an empty plan from template if it doesn't exist
 */
export function ensureDailyPlanExists(dateIso: string): void {
  const planFilePath = path.join(PLANS_DIR, `${dateIso}.json`);
  
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
 * Add a task as a range entry at 8am (8am-8am) in the daily plan
 * All due tasks are added as ranges so multiple tasks can share the same time
 */
export function addTaskAsRangeAt8am(
  dateIso: string,
  taskId: string,
  listType: ListType
): void {
  const planFilePath = path.join(PLANS_DIR, `${dateIso}.json`);
  
  if (!fs.existsSync(planFilePath)) {
    return; // Plan should exist from ensureDailyPlanExists
  }
  
  const content = fs.readFileSync(planFilePath, 'utf-8');
  const plan: DayPlan = JSON.parse(content);
  
  // Ensure ranges array exists
  if (!plan.ranges) {
    plan.ranges = [];
  }
  
  // Check if this task is already in ranges
  const taskAlreadyExists = plan.ranges.some(
    (range) => range.taskId === taskId
  );
  
  if (!taskAlreadyExists) {
    // Add task as a range entry at 8am
    plan.ranges.push({
      start: '8am',
      end: '8am',
      taskId,
      listType,
    });
    fs.writeFileSync(planFilePath, JSON.stringify(plan, null, 2), 'utf-8');
  }
}

/**
 * Handle due date setup: creates plan, today list, and adds task as range at 8am
 * Call this when a task is created or updated with a due date
 * @param dateIso - Date in ISO format (YYYY-MM-DD)
 */
export function handleDueDateSetup(
  dateIso: string,
  listType: ListType,
  task: Task
): void {
  ensureDailyPlanExists(dateIso);
  ensureTodayListExists(dateIso, listType, task);
  addTaskAsRangeAt8am(dateIso, task.id, listType);
}
