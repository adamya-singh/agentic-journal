import { NextRequest, NextResponse } from 'next/server';
import { ListType, Task } from '@/lib/types';
import { computeTodayTasks } from '../today-compute-utils';
import {
  findLegacyDailyTaskById,
  refreshCompletedTaskIndexForTask,
  removeCompletedTaskIndexSnapshot,
  readCompletedTaskSnapshots,
  readGeneralTasks,
  readTodayOverrides,
  removeCompletedTaskSnapshot,
  upsertCompletedTaskIndexSnapshot,
  upsertCompletedTaskSnapshot,
  writeGeneralTasks,
  TaskCompletionSnapshot,
} from '../today-store-utils';

function buildCompletionSnapshot(task: Task, listType: ListType): TaskCompletionSnapshot {
  const snapshot: TaskCompletionSnapshot = {
    id: task.id,
    text: task.text,
    completed: true,
    completedAt: new Date().toISOString(),
    listType,
  };

  if (task.dueDate) {
    snapshot.dueDate = task.dueDate;
  }

  if (task.isDaily) {
    snapshot.isDaily = true;
  }

  return snapshot;
}

function toRestoredTask(snapshot: TaskCompletionSnapshot): Task {
  const task: Task = {
    id: snapshot.id,
    text: snapshot.text,
  };

  if (snapshot.dueDate) {
    task.dueDate = snapshot.dueDate;
  }

  if (snapshot.isDaily) {
    task.isDaily = true;
  }

  return task;
}

/**
 * POST /api/tasks/today/complete
 * Toggles completion status for a task in a computed today list.
 *
 * - Complete: write completion snapshot for this date, remove from general list (non-daily only)
 * - Uncomplete: remove completion snapshot for this date, re-add to general list (non-daily only)
 *
 * Body: { taskId: string, listType: 'have-to-do' | 'want-to-do', date: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, listType, date } = body;

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

    if (!date || typeof date !== 'string') {
      return NextResponse.json(
        { success: false, error: 'date parameter is required and must be a string in ISO format (YYYY-MM-DD)' },
        { status: 400 }
      );
    }

    const typedListType = listType as ListType;
    const generalData = readGeneralTasks(typedListType);
    const completedSnapshots = readCompletedTaskSnapshots(date, typedListType);
    const existingSnapshot = completedSnapshots.find((snapshot) => snapshot.id === taskId) ?? null;

    if (existingSnapshot) {
      // UNCOMPLETE
      const { removed, removedSnapshot } = removeCompletedTaskSnapshot(date, typedListType, taskId);
      if (!removed) {
        return NextResponse.json({
          success: false,
          error: 'Task completion record not found for this day',
        });
      }

      const snapshotToRestore = removedSnapshot ?? existingSnapshot;
      const wasDaily = snapshotToRestore.isDaily === true;
      removeCompletedTaskIndexSnapshot(taskId);
      refreshCompletedTaskIndexForTask(taskId);

      if (!wasDaily) {
        const alreadyInGeneral = generalData.tasks.some((task) => task.id === taskId);
        if (!alreadyInGeneral) {
          generalData.tasks.unshift(toRestoredTask(snapshotToRestore));
          writeGeneralTasks(generalData, typedListType);
        }
      }

      return NextResponse.json({
        success: true,
        completed: false,
        message: wasDaily
          ? 'Daily task marked as incomplete'
          : 'Task marked as incomplete and added back to general list',
      });
    }

    // COMPLETE
    const overrides = readTodayOverrides(date, typedListType);
    const computedTodayTasks = computeTodayTasks({
      date,
      generalTasks: generalData.tasks,
      overrides,
      completedSnapshots,
    });

    const taskFromToday = computedTodayTasks.find((task) => task.id === taskId) ?? null;
    const taskFromGeneral = generalData.tasks.find((task) => task.id === taskId) ?? null;
    const taskFromLegacyDaily = findLegacyDailyTaskById(date, typedListType, taskId);

    const taskToComplete = taskFromToday ?? taskFromGeneral ?? taskFromLegacyDaily;

    if (!taskToComplete) {
      return NextResponse.json({
        success: false,
        error: 'Task not found in today\'s list',
      });
    }

    const completionSnapshot = buildCompletionSnapshot(taskToComplete, typedListType);
    upsertCompletedTaskSnapshot(date, typedListType, completionSnapshot);
    upsertCompletedTaskIndexSnapshot(taskId, completionSnapshot, date);

    if (!taskToComplete.isDaily) {
      const initialLength = generalData.tasks.length;
      generalData.tasks = generalData.tasks.filter((task) => task.id !== taskId);
      if (generalData.tasks.length !== initialLength) {
        writeGeneralTasks(generalData, typedListType);
      }
    }

    return NextResponse.json({
      success: true,
      completed: true,
      message: taskToComplete.isDaily
        ? 'Daily task marked as completed (stays in general list for tomorrow)'
        : 'Task marked as completed and removed from general list',
    });
  } catch (error) {
    console.error('Error toggling task completion:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
