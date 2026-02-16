import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import { TasksData, ListType } from '@/lib/types';

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
 * POST /api/tasks/reorder
 * Moves a task to a new position in the priority queue
 * 
 * Body: { taskId: string, newPosition: number, listType?: 'have-to-do' | 'want-to-do' }
 * - taskId: The unique ID of the task to move
 * - newPosition: The new position index (0 = highest priority)
 * - listType: Which task list to reorder in (defaults to 'have-to-do')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, newPosition, listType = 'have-to-do', positionMode = 'absolute' } = body;

    // Validate listType
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json(
        { success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' },
        { status: 400 }
      );
    }

    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'taskId parameter is required and must be a string' },
        { status: 400 }
      );
    }

    if (typeof newPosition !== 'number' || newPosition < 0) {
      return NextResponse.json(
        { success: false, error: 'newPosition must be a non-negative number' },
        { status: 400 }
      );
    }

    if (positionMode !== 'absolute' && positionMode !== 'type-relative') {
      return NextResponse.json(
        { success: false, error: 'positionMode must be "absolute" or "type-relative"' },
        { status: 400 }
      );
    }

    // Read current tasks
    const data = readTasks(listType);

    // Find the task by ID
    const currentIndex = data.tasks.findIndex(task => task.id === taskId);
    if (currentIndex === -1) {
      return NextResponse.json({
        success: false,
        error: `Task not found with ID: "${taskId}"`,
      });
    }

    const currentTask = data.tasks[currentIndex];
    let clampedPosition: number;
    let clampedRelativePosition: number | undefined;

    if (positionMode === 'absolute') {
      // Clamp position to valid range
      clampedPosition = Math.min(newPosition, data.tasks.length - 1);

      if (currentIndex === clampedPosition) {
        return NextResponse.json({
          success: true,
          message: 'Task is already at the specified position',
          position: clampedPosition,
        });
      }

      // Remove from current position and insert at new absolute position
      const [task] = data.tasks.splice(currentIndex, 1);
      data.tasks.splice(clampedPosition, 0, task);
    } else {
      const taskIsDaily = currentTask.isDaily === true;
      const tasksWithoutCurrent = [...data.tasks];
      const [task] = tasksWithoutCurrent.splice(currentIndex, 1);

      // Build the absolute indices of tasks that match the moved task's daily/regular type
      const matchingIndices: number[] = [];
      tasksWithoutCurrent.forEach((t, idx) => {
        if ((t.isDaily === true) === taskIsDaily) {
          matchingIndices.push(idx);
        }
      });

      clampedRelativePosition = Math.min(newPosition, matchingIndices.length);

      if (matchingIndices.length === 0) {
        // If no same-type tasks remain, daily tasks go first, regular tasks go last
        clampedPosition = taskIsDaily ? 0 : tasksWithoutCurrent.length;
      } else if (clampedRelativePosition >= matchingIndices.length) {
        // Insert after all same-type tasks
        clampedPosition = matchingIndices[matchingIndices.length - 1] + 1;
      } else {
        // Insert at the index of the Nth same-type task
        clampedPosition = matchingIndices[clampedRelativePosition];
      }

      tasksWithoutCurrent.splice(clampedPosition, 0, task);
      data.tasks = tasksWithoutCurrent;
    }

    // Write updated tasks
    writeTasks(data, listType);

    return NextResponse.json({
      success: true,
      message: `Task moved from position ${currentIndex} to ${clampedPosition}`,
      previousPosition: currentIndex,
      newPosition: clampedPosition,
      ...(positionMode === 'type-relative' ? { relativePosition: clampedRelativePosition } : {}),
      task: data.tasks[clampedPosition],
    });
  } catch (error) {
    console.error('Error reordering task:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
