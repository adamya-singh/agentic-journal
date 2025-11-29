import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

type ListType = 'have-to-do' | 'want-to-do';

// Get the path for a specific task list
function getTasksFilePath(listType: ListType): string {
  return path.join(process.cwd(), `src/backend/data/tasks/${listType}.json`);
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
 * POST /api/tasks/update
 * Updates a task's text and/or dueDate
 * 
 * Body: { oldText: string, newText?: string, dueDate?: string, listType?: 'have-to-do' | 'want-to-do' }
 * - oldText: The current text of the task to update
 * - newText: The new text for the task (optional)
 * - dueDate: The new due date in ISO format, or empty string to remove (optional)
 * - listType: Which task list to update in (defaults to 'have-to-do')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { oldText, newText, dueDate, listType = 'have-to-do' } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!oldText || typeof oldText !== 'string') {
      return NextResponse.json(
        { success: false, error: 'oldText parameter is required and must be a string' },
        { status: 400 }
      );
    }

    const trimmedOldText = oldText.trim();
    if (trimmedOldText.length === 0) {
      return NextResponse.json(
        { success: false, error: 'oldText cannot be empty' },
        { status: 400 }
      );
    }

    // Read current tasks
    const data = readTasks(listType);

    // Find the task
    const taskIndex = data.tasks.findIndex(task => task.text === trimmedOldText);
    if (taskIndex === -1) {
      return NextResponse.json({
        success: false,
        error: `Task not found: "${trimmedOldText}"`,
      });
    }

    const previousTask = { ...data.tasks[taskIndex] };

    // Update text if provided
    if (newText !== undefined && typeof newText === 'string') {
      const trimmedNewText = newText.trim();
      if (trimmedNewText.length > 0) {
        data.tasks[taskIndex].text = trimmedNewText;
      }
    }

    // Update or remove due date
    if (dueDate !== undefined) {
      if (dueDate === '') {
        delete data.tasks[taskIndex].dueDate;
      } else if (typeof dueDate === 'string') {
        data.tasks[taskIndex].dueDate = dueDate;
      }
    }

    // Write updated tasks
    writeTasks(data, listType);

    return NextResponse.json({
      success: true,
      message: 'Task updated successfully',
      previousTask,
      updatedTask: data.tasks[taskIndex],
    });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

