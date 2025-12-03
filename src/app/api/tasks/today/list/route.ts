import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

type ListType = 'have-to-do' | 'want-to-do';

// Get the path for a date-specific task list
function getDailyTasksFilePath(date: string, listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/daily-lists/${date}-${listType}.json`);
}

// Get the path for the general task list
function getGeneralTasksFilePath(listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/${listType}.json`);
}

interface Task {
  id: string;
  text: string;
  dueDate?: string;
}

interface TasksData {
  _comment: string;
  tasks: Task[];
}

/**
 * Convert MMDDYY to YYYY-MM-DD format
 */
function mmddyyToIso(mmddyy: string): string {
  const month = mmddyy.slice(0, 2);
  const day = mmddyy.slice(2, 4);
  const year = '20' + mmddyy.slice(4, 6);
  return `${year}-${month}-${day}`;
}

/**
 * Helper function to read daily tasks from file
 */
function readDailyTasks(date: string, listType: ListType): TasksData {
  const tasksFile = getDailyTasksFilePath(date, listType);
  if (!fs.existsSync(tasksFile)) {
    return {
      _comment: 'Queue structure - first element is highest priority',
      tasks: [],
    };
  }
  const content = fs.readFileSync(tasksFile, 'utf-8');
  return JSON.parse(content);
}

/**
 * Helper function to write daily tasks to file
 */
function writeDailyTasks(data: TasksData, date: string, listType: ListType): void {
  const tasksFile = getDailyTasksFilePath(date, listType);
  const dir = path.dirname(tasksFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * Helper function to read general tasks from file
 */
function readGeneralTasks(listType: ListType): TasksData {
  const tasksFile = getGeneralTasksFilePath(listType);
  if (!fs.existsSync(tasksFile)) {
    return {
      _comment: 'Queue structure - first element is highest priority',
      tasks: [],
    };
  }
  const content = fs.readFileSync(tasksFile, 'utf-8');
  return JSON.parse(content);
}

/**
 * Auto-add tasks from general list that are due on the given date
 * Returns the updated daily tasks data
 */
function autoAddDueTasks(date: string, listType: ListType): TasksData {
  const dailyData = readDailyTasks(date, listType);
  const generalData = readGeneralTasks(listType);
  
  const isoDate = mmddyyToIso(date);
  const existingTaskIds = new Set(dailyData.tasks.map(t => t.id));
  
  // Find tasks due on this date that aren't already in today's list (by ID)
  const tasksToAdd = generalData.tasks.filter(
    task => task.dueDate === isoDate && !existingTaskIds.has(task.id)
  );
  
  if (tasksToAdd.length > 0) {
    // Add due tasks to the beginning of the list (they're urgent)
    dailyData.tasks = [...tasksToAdd, ...dailyData.tasks];
    writeDailyTasks(dailyData, date, listType);
  }
  
  return dailyData;
}

/**
 * GET /api/tasks/today/list
 * Returns the tasks for a specific date
 * 
 * Query params:
 * - listType: 'have-to-do' | 'want-to-do' (defaults to 'have-to-do')
 * - date: The date in MMDDYY format (required)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listType = (searchParams.get('listType') || 'have-to-do') as ListType;
    const date = searchParams.get('date');

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    // Validate date
    if (!date) {
      return NextResponse.json(
        { success: false, error: 'date parameter is required in MMDDYY format' },
        { status: 400 }
      );
    }

    // Auto-add tasks that are due on this date, then return the list
    const data = autoAddDueTasks(date, listType);

    return NextResponse.json({
      success: true,
      tasks: data.tasks,
      date,
    });
  } catch (error) {
    console.error('Error reading daily tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

