import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
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
 * POST /api/tasks/update
 * Updates a task's text, dueDate, and/or isDaily flag
 * 
 * Body: { taskId?: string, oldText?: string, newText?: string, dueDate?: string, isDaily?: boolean, listType?: 'have-to-do' | 'want-to-do' }
 * - taskId: The unique ID of the task to update (preferred)
 * - oldText: Legacy text-based lookup (fallback if taskId not provided)
 * - newText: The new text for the task (optional)
 * - dueDate: The new due date in ISO format, or empty string to remove (optional)
 * - isDaily: Whether the task is daily recurring (optional)
 * - listType: Which task list to update in (defaults to 'have-to-do')
 * 
 * At least one of taskId or oldText must be provided.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, oldText, newText, dueDate, isDaily, listType = 'have-to-do' } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    // Validate that at least one identifier is provided
    const hasTaskId = taskId && typeof taskId === 'string' && taskId.trim().length > 0;
    const hasOldText = oldText && typeof oldText === 'string' && oldText.trim().length > 0;

    if (!hasTaskId && !hasOldText) {
      return NextResponse.json(
        { success: false, error: 'Either taskId or oldText parameter is required' },
        { status: 400 }
      );
    }

    // Read current tasks
    const data = readTasks(listType);

    // Find the task - prioritize taskId lookup, fall back to oldText
    let taskIndex = -1;
    if (hasTaskId) {
      taskIndex = data.tasks.findIndex(task => task.id === taskId.trim());
    }
    if (taskIndex === -1 && hasOldText) {
      const trimmedOldText = oldText.trim();
      taskIndex = data.tasks.findIndex(task => task.text === trimmedOldText);
    }

    if (taskIndex === -1) {
      const identifier = hasTaskId ? `ID: "${taskId}"` : `text: "${oldText}"`;
      return NextResponse.json({
        success: false,
        error: `Task not found with ${identifier}`,
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

    // Update or remove isDaily flag
    if (isDaily !== undefined) {
      if (isDaily === true) {
        data.tasks[taskIndex].isDaily = true;
      } else {
        delete data.tasks[taskIndex].isDaily;
      }
    }

    // Write updated tasks
    writeTasks(data, listType);

    // If task has a due date set (not removed), ensure due-date journal + staged task are initialized
    const updatedTask = data.tasks[taskIndex];
    if (updatedTask.dueDate) {
      handleDueDateSetup(updatedTask.dueDate, listType, updatedTask);
    }

    return NextResponse.json({
      success: true,
      message: 'Task updated successfully',
      previousTask,
      updatedTask,
    });
  } catch (error) {
    console.error('Error updating task:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
