import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

// Path to the tasks file
const TASKS_FILE = path.join(process.cwd(), 'src/backend/data/tasks/have-to-do.json');

interface TasksData {
  _comment: string;
  tasks: string[];
}

/**
 * Helper function to read tasks from file
 */
function readTasks(): TasksData {
  if (!fs.existsSync(TASKS_FILE)) {
    return {
      _comment: 'Stack structure - last element is top of stack',
      tasks: [],
    };
  }
  const content = fs.readFileSync(TASKS_FILE, 'utf-8');
  return JSON.parse(content);
}

/**
 * Helper function to write tasks to file
 */
function writeTasks(data: TasksData): void {
  const dir = path.dirname(TASKS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

/**
 * POST /api/tasks/add
 * Adds a new task to the stack (appends to end of array)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { task } = body;

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

    // Read current tasks
    const data = readTasks();

    // Push new task to end of array (top of stack)
    data.tasks.push(trimmedTask);

    // Write updated tasks
    writeTasks(data);

    return NextResponse.json({
      success: true,
      message: 'Task added successfully',
      taskCount: data.tasks.length,
    });
  } catch (error) {
    console.error('Error adding task:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

