import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { handleDueDateSetup } from '../due-date-utils';
import { Task, TasksData, ListType } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import { validateDueTimeRange } from '@/lib/due-time';

const NOTES_MAX_LENGTH = 20000;

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
 * Body: { task: string, position?: number, listType?: 'have-to-do' | 'want-to-do', dueDate?: string, dueTimeStart?: string, dueTimeEnd?: string, isDaily?: boolean, projects?: string[], notesMarkdown?: string }
 * - task: The task text to add
 * - position: Optional index where to insert the task (0 = highest priority)
 * - listType: Which task list to add to (defaults to 'have-to-do')
 * - dueDate: Optional due date in ISO format (YYYY-MM-DD)
 * - isDaily: Optional flag to mark task as recurring daily
 * - projects: Optional list of project slugs/labels (normalized to kebab-case slugs)
 * - notesMarkdown: Optional markdown notes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { task, position, listType = 'have-to-do', dueDate, dueTimeStart, dueTimeEnd, isDaily, projects, notesMarkdown } = body;

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

    if (projects !== undefined && !Array.isArray(projects)) {
      return NextResponse.json(
        { success: false, error: 'projects must be an array of strings when provided' },
        { status: 400 }
      );
    }

    if (notesMarkdown !== undefined && typeof notesMarkdown !== 'string') {
      return NextResponse.json(
        { success: false, error: 'notesMarkdown must be a string when provided' },
        { status: 400 }
      );
    }

    if (dueTimeStart !== undefined && typeof dueTimeStart !== 'string') {
      return NextResponse.json(
        { success: false, error: 'dueTimeStart must be a string in HH:mm format when provided' },
        { status: 400 }
      );
    }
    if (dueTimeEnd !== undefined && typeof dueTimeEnd !== 'string') {
      return NextResponse.json(
        { success: false, error: 'dueTimeEnd must be a string in HH:mm format when provided' },
        { status: 400 }
      );
    }

    const normalizedNotes = typeof notesMarkdown === 'string' ? notesMarkdown.trim() : '';
    const normalizedDueDate = typeof dueDate === 'string' ? dueDate.trim() : '';
    const normalizedDueTimeStart = typeof dueTimeStart === 'string' ? dueTimeStart.trim() : '';
    const normalizedDueTimeEnd = typeof dueTimeEnd === 'string' ? dueTimeEnd.trim() : '';
    const dueTimeStartValue = normalizedDueTimeStart.length > 0 ? normalizedDueTimeStart : undefined;
    const dueTimeEndValue = normalizedDueTimeEnd.length > 0 ? normalizedDueTimeEnd : undefined;

    if (!normalizedDueDate && (dueTimeStartValue || dueTimeEndValue)) {
      return NextResponse.json(
        { success: false, error: 'dueTimeStart/dueTimeEnd require dueDate' },
        { status: 400 }
      );
    }

    const dueTimeValidation = validateDueTimeRange(dueTimeStartValue, dueTimeEndValue);
    if (!dueTimeValidation.valid) {
      return NextResponse.json(
        { success: false, error: dueTimeValidation.error },
        { status: 400 }
      );
    }

    if (normalizedNotes.length > NOTES_MAX_LENGTH) {
      return NextResponse.json(
        { success: false, error: `notesMarkdown cannot exceed ${NOTES_MAX_LENGTH} characters` },
        { status: 400 }
      );
    }

    // Build task object with generated UUID
    const newTask: Task = { 
      id: randomUUID(),
      text: trimmedTask 
    };
    if (normalizedDueDate) {
      newTask.dueDate = normalizedDueDate;
    }
    if (dueTimeStartValue) {
      newTask.dueTimeStart = dueTimeStartValue;
    }
    if (dueTimeEndValue) {
      newTask.dueTimeEnd = dueTimeEndValue;
    }
    if (isDaily === true) {
      newTask.isDaily = true;
    }
    const normalizedProjects = normalizeProjectList(projects);
    if (normalizedProjects.length > 0) {
      newTask.projects = normalizedProjects;
    }
    if (normalizedNotes.length > 0) {
      newTask.notesMarkdown = normalizedNotes;
    }

    // Read current tasks
    const data = readTasks(listType);

    // Insert at specified position or append to end
    // Position is relative to task type (daily tasks vs regular tasks)
    if (typeof position === 'number' && position >= 0) {
      // Find indices of tasks matching the type we're adding
      const matchingIndices: number[] = [];
      data.tasks.forEach((t, idx) => {
        const taskIsDaily = t.isDaily === true;
        const newTaskIsDaily = isDaily === true;
        if (taskIsDaily === newTaskIsDaily) {
          matchingIndices.push(idx);
        }
      });

      // Calculate actual insertion index
      let actualPosition: number;
      if (matchingIndices.length === 0) {
        // No tasks of this type exist yet
        // Daily tasks go at the beginning, regular tasks go at the end
        actualPosition = isDaily === true ? 0 : data.tasks.length;
      } else if (position >= matchingIndices.length) {
        // Insert after all tasks of this type
        actualPosition = matchingIndices[matchingIndices.length - 1] + 1;
      } else {
        // Insert at the position of the nth task of this type
        actualPosition = matchingIndices[position];
      }

      data.tasks.splice(actualPosition, 0, newTask);
    } else {
      // Default: push to end
      data.tasks.push(newTask);
    }

    // Write updated tasks
    writeTasks(data, listType);

    // If task has a due date, ensure due-date journal + staged task are initialized
    if (newTask.dueDate) {
      handleDueDateSetup(newTask.dueDate, listType, newTask);
    }

    return NextResponse.json({
      success: true,
      message: 'Task added successfully',
      taskId: newTask.id,
      task: newTask,
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
