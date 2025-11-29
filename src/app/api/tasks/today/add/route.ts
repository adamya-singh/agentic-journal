import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

type ListType = 'have-to-do' | 'want-to-do';

// Get the path for a date-specific task list
function getDailyTasksFilePath(date: string, listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/daily-lists/${date}-${listType}.json`);
}

interface Task {
  text: string;
  dueDate?: string;
}

interface TasksData {
  _comment: string;
  tasks: Task[];
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
 * POST /api/tasks/today/add
 * Adds a task to the daily list if not already present
 * 
 * Body: { taskText: string, listType: 'have-to-do' | 'want-to-do', date: string, dueDate?: string }
 * - taskText: The task text to add (serves as identifier)
 * - listType: Which task list to add to
 * - date: The date in MMDDYY format
 * - dueDate: Optional due date in ISO format (YYYY-MM-DD)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskText, listType, date, dueDate } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    // Validate taskText
    if (!taskText || typeof taskText !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskText parameter is required and must be a string' },
        { status: 400 }
      );
    }

    // Validate date
    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { success: false, error: 'date parameter is required and must be a string in MMDDYY format' },
        { status: 400 }
      );
    }

    const trimmedTaskText = taskText.trim();
    if (trimmedTaskText.length === 0) {
      return NextResponse.json(
        { success: false, error: 'taskText cannot be empty' },
        { status: 400 }
      );
    }

    // Read current daily tasks
    const data = readDailyTasks(date, listType);

    // Check if task already exists in today's list
    const alreadyExists = data.tasks.some((task) => task.text === trimmedTaskText);
    if (alreadyExists) {
      return NextResponse.json({
        success: true,
        alreadyExists: true,
        message: 'Task already in today\'s list',
      });
    }

    // Build task object
    const newTask: Task = { text: trimmedTaskText };
    if (dueDate && typeof dueDate === 'string') {
      newTask.dueDate = dueDate;
    }

    // Add to daily tasks
    data.tasks.push(newTask);

    // Write updated tasks
    writeDailyTasks(data, date, listType);

    return NextResponse.json({
      success: true,
      alreadyExists: false,
      message: 'Task added to today\'s list',
      taskCount: data.tasks.length,
    });
  } catch (error) {
    console.error('Error adding task to daily list:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

