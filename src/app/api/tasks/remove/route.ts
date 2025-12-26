import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
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
 * POST /api/tasks/remove
 * Removes a task from the list by its text
 * 
 * Body: { text: string, listType?: 'have-to-do' | 'want-to-do' }
 * - text: The exact text of the task to remove
 * - listType: Which task list to remove from (defaults to 'have-to-do')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, listType = 'have-to-do' } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Text parameter is required and must be a string' },
        { status: 400 }
      );
    }

    const trimmedText = text.trim();
    if (trimmedText.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Text cannot be empty' },
        { status: 400 }
      );
    }

    // Read current tasks
    const data = readTasks(listType);

    // Find and remove the task
    const initialLength = data.tasks.length;
    const removedTask = data.tasks.find(task => task.text === trimmedText);
    data.tasks = data.tasks.filter(task => task.text !== trimmedText);

    if (data.tasks.length === initialLength) {
      return NextResponse.json({
        success: true,
        removed: false,
        message: 'Task not found in list',
      });
    }

    // Write updated tasks
    writeTasks(data, listType);

    return NextResponse.json({
      success: true,
      removed: true,
      message: 'Task removed successfully',
      removedTask,
      taskCount: data.tasks.length,
    });
  } catch (error) {
    console.error('Error removing task:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

