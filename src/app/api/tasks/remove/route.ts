import { NextRequest, NextResponse } from 'next/server';
import { TasksData, ListType } from '@/lib/types';
import { getDescendantTaskIds, buildChildrenByParentId } from '@/lib/tasks';
import { handleDueDateSetup } from '../due-date-utils';
import {
  readGeneralTasks,
  removeCompletedTaskIndexSnapshots,
  removeTaskIdsFromCompletedSnapshots,
  removeTaskIdsFromTodayOverrides,
  writeGeneralTasks,
} from '../today/today-store-utils';

/**
 * POST /api/tasks/remove
 * Removes a task from the list by its ID
 * 
 * Body: { taskId: string, listType?: 'have-to-do' | 'want-to-do', recursive?: boolean }
 * - taskId: The ID of the task to remove
 * - listType: Which task list to remove from (defaults to 'have-to-do')
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, listType = 'have-to-do', recursive = false } = body;

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

    if (taskId.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'taskId cannot be empty' },
        { status: 400 }
      );
    }

    // Read current tasks
    const data = readGeneralTasks(listType) as TasksData;

    const removedTask = data.tasks.find(task => task.id === taskId) ?? null;
    if (!removedTask) {
      return NextResponse.json({
        success: true,
        removed: false,
        message: 'Task not found in list',
      });
    }

    const childrenByParentId = buildChildrenByParentId(data.tasks);
    const descendantTaskIds = getDescendantTaskIds(taskId, childrenByParentId);

    if (descendantTaskIds.length > 0 && recursive !== true) {
      return NextResponse.json(
        {
          success: false,
          removed: false,
          error: 'Task has subtasks and requires recursive deletion',
          requiresRecursiveDelete: true,
          descendantCount: descendantTaskIds.length,
        },
        { status: 400 }
      );
    }

    const removedIds = [taskId, ...descendantTaskIds];
    const removedIdSet = new Set(removedIds);
    const removedTasks = data.tasks.filter((task) => removedIdSet.has(task.id));
    data.tasks = data.tasks.filter((task) => !removedIdSet.has(task.id));

    for (const task of removedTasks) {
      if (task.dueDate) {
        handleDueDateSetup(task.dueDate, listType as ListType, { id: task.id, text: task.text }, task);
      }
    }

    // Write updated tasks
    writeGeneralTasks(data, listType as ListType);
    removeTaskIdsFromTodayOverrides(removedIds, listType as ListType);
    removeTaskIdsFromCompletedSnapshots(removedIds, listType as ListType);
    removeCompletedTaskIndexSnapshots(removedIds);

    return NextResponse.json({
      success: true,
      removed: true,
      message: removedIds.length > 1 ? 'Task and subtasks removed successfully' : 'Task removed successfully',
      removedTask,
      removedTaskIds: removedIds,
      descendantCount: descendantTaskIds.length,
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
