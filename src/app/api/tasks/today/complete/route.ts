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
  completed?: boolean;
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
 * Helper function to write general tasks to file
 */
function writeGeneralTasks(data: TasksData, listType: ListType): void {
  const tasksFile = getGeneralTasksFilePath(listType);
  const dir = path.dirname(tasksFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * POST /api/tasks/today/complete
 * Toggles the completion status of a task in the daily list
 * 
 * - If not completed: marks as completed and removes from general list
 * - If already completed: removes completed flag and adds back to general list
 * 
 * Body: { taskId: string, listType: 'have-to-do' | 'want-to-do', date: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, listType, date } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    // Validate taskId
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskId parameter is required and must be a string' },
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

    // Read current daily tasks
    const dailyData = readDailyTasks(date, listType);

    // Find the task in today's list by ID
    const taskIndex = dailyData.tasks.findIndex((task) => task.id === taskId);
    if (taskIndex === -1) {
      return NextResponse.json({
        success: false,
        error: 'Task not found in today\'s list',
      });
    }

    const task = dailyData.tasks[taskIndex];
    const wasCompleted = task.completed === true;

    if (wasCompleted) {
      // UNCOMPLETE: Remove completed flag and add back to general list
      delete dailyData.tasks[taskIndex].completed;
      
      // Add task back to general list (at the beginning since it was previously prioritized)
      const generalData = readGeneralTasks(listType);
      const alreadyInGeneral = generalData.tasks.some((t) => t.id === taskId);
      
      if (!alreadyInGeneral) {
        const taskToAdd: Task = { 
          id: task.id,
          text: task.text 
        };
        if (task.dueDate) {
          taskToAdd.dueDate = task.dueDate;
        }
        generalData.tasks.unshift(taskToAdd);
        writeGeneralTasks(generalData, listType);
      }

      // Write updated daily tasks
      writeDailyTasks(dailyData, date, listType);

      return NextResponse.json({
        success: true,
        completed: false,
        message: 'Task marked as incomplete and added back to general list',
      });
    } else {
      // COMPLETE: Mark as completed and remove from general list
      dailyData.tasks[taskIndex].completed = true;

      // Remove from general list by ID
      const generalData = readGeneralTasks(listType);
      generalData.tasks = generalData.tasks.filter((t) => t.id !== taskId);
      writeGeneralTasks(generalData, listType);

      // Write updated daily tasks
      writeDailyTasks(dailyData, date, listType);

      return NextResponse.json({
        success: true,
        completed: true,
        message: 'Task marked as completed and removed from general list',
      });
    }
  } catch (error) {
    console.error('Error toggling task completion:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

