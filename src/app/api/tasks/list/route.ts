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
 * GET /api/tasks/list
 * Returns the current list of tasks in priority order
 * 
 * Query params:
 * - listType: 'have-to-do' | 'want-to-do' (defaults to 'have-to-do')
 * - isDaily: 'true' | 'false' (optional) - filter by daily/regular tasks
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const listType = (searchParams.get('listType') || 'have-to-do') as ListType;
    const isDailyParam = searchParams.get('isDaily');

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    const data = readTasks(listType);
    
    // Filter by isDaily if specified
    let tasks = data.tasks;
    if (isDailyParam === 'true') {
      tasks = tasks.filter(task => task.isDaily === true);
    } else if (isDailyParam === 'false') {
      tasks = tasks.filter(task => !task.isDaily);
    }

    return NextResponse.json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.error('Error reading tasks:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

