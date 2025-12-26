import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { handleDueDateSetup } from '../due-date-utils';
import { Task, TasksData, ListType } from '@/lib/types';

// Get the path for a specific task list
function getTasksFilePath(listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/${listType}.json`);
}

/**
 * Helper function to read tasks from file
 */
function readTasks(listType: ListType): TasksData {
  const tasksFile = getTasksFilePath(listType);
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
 * Helper function to write tasks to file
 */
function writeTasks(data: TasksData, listType: ListType): void {
  const tasksFile = getTasksFilePath(listType);
  const dir = path.dirname(tasksFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * POST /api/tasks/add
 * Adds a new task to the list at the specified position (or appends to end if no position given)
 * 
 * Body: { task: string, position?: number, listType?: 'have-to-do' | 'want-to-do', dueDate?: string, isDaily?: boolean }
 * - task: The task text to add
 * - position: Optional index where to insert the task (0 = highest priority)
 * - listType: Which task list to add to (defaults to 'have-to-do')
 * - dueDate: Optional due date in ISO format (YYYY-MM-DD)
 * - isDaily: Optional flag to mark task as recurring daily
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { task, position, listType = 'have-to-do', dueDate, isDaily } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!task || typeof task !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Task parameter is required and must be a string' },
        { status: 400 }
      );
    }

    const trimmedTask = task.trim();
    if (trimmedTask.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Task cannot be empty' },
        { status: 400 }
      );
    }

    // Build task object with generated UUID
    const newTask: Task = { 
      id: randomUUID(),
      text: trimmedTask 
    };
    if (dueDate && typeof dueDate === 'string') {
      newTask.dueDate = dueDate;
    }
    if (isDaily === true) {
      newTask.isDaily = true;
    }

    // Read current tasks
    const data = readTasks(listType);

    // Insert at specified position or append to end
    if (typeof position === 'number' && position >= 0 && position <= data.tasks.length) {
      data.tasks.splice(position, 0, newTask);
    } else {
      // Default: push to end
      data.tasks.push(newTask);
    }

    // Write updated tasks
    writeTasks(data, listType);

    // If task has a due date, auto-create plan/today list and add to 8am slot
    if (newTask.dueDate) {
      handleDueDateSetup(newTask.dueDate, listType, newTask);
    }

    return NextResponse.json({
      success: true,
      message: 'Task added successfully',
      taskId: newTask.id,
      taskCount: data.tasks.length,
      insertedAt: typeof position === 'number' ? position : data.tasks.length - 1,
    });
  } catch (error) {
    console.error('Error adding task:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

