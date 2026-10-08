import { NextRequest, NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';
import type { ListType } from '@/lib/types';
import { journalDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { DayJournalWithRanges } from '../../../journal/plan-lifecycle-utils';
import { markMissedPlansForDate } from '../../../journal/plan-lifecycle-utils';
import { findLegacyDailyTaskById, readCompletedTaskSnapshots } from '../today-store-utils';
import { getDescendantTaskIds } from '@/lib/tasks';
import { ensureCurrentSystemThroughToday } from '../../current/current-store-utils';
import { completeTaskForDate, uncompleteTaskForDate } from '../completion-utils';

function markMissedPlansIfJournalExists(date: string): void {
  const journalFilePath = path.join(journalDataDir(), `${date}.json`);
  if (!fs.existsSync(journalFilePath)) {
    return;
  }
  try {
    const content = fs.readFileSync(journalFilePath, 'utf-8');
    const journal = JSON.parse(content) as DayJournalWithRanges;
    const changed = markMissedPlansForDate(journal, date, new Date());
    if (changed) {
      writeJsonFileAtomic(journalFilePath, journal);
    }
  } catch {
    // Non-critical best-effort sync.
  }
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
    ensureCurrentSystemThroughToday();
    markMissedPlansIfJournalExists(date);
    const completedSnapshots = readCompletedTaskSnapshots(date, typedListType);
    const existingSnapshot = completedSnapshots.find((snapshot) => snapshot.id === taskId) ?? null;

    if (existingSnapshot) {
      // UNCOMPLETE
      const result = uncompleteTaskForDate(date, typedListType, taskId);
      if (result.status === 'not-found') {
        return NextResponse.json({
          success: false,
          error: 'Task completion record not found for this day',
        });
      }

      return NextResponse.json({
        success: true,
        completed: false,
        message: result.wasDaily
          ? 'Daily task marked as incomplete'
          : 'Task marked as incomplete and added back to general list',
      });
    }

    // COMPLETE
    const result = completeTaskForDate(date, typedListType, taskId);

    if (result.status === 'not-found') {
      return NextResponse.json({
        success: false,
        error: 'Task not found in today\'s list',
      });
    }

    if (result.status === 'blocked') {
      return NextResponse.json(
        {
          success: false,
          error: 'Task has incomplete subtasks',
          blockedByOpenSubtasks: true,
          openSubtaskCount: result.openSubtasks.length,
          openSubtasks: result.openSubtasks,
        },
        { status: 400 }
      );
    }

    if (result.status === 'already-completed') {
      return NextResponse.json({
        success: false,
        error: 'Task is already completed for this date',
      });
    }

    const { task: taskToComplete, generalTasks, computedTodayTasks, childrenByParentId, completedTodayIds } = result;

    let promptToCompleteParent = false;
    let parentTask: { id: string; text: string; listType: ListType } | null = null;
    if (taskToComplete.parentTaskId) {
      const parentId = taskToComplete.parentTaskId;
      const completedAfterThisAction = new Set(completedTodayIds);
      completedAfterThisAction.add(taskToComplete.id);

      const openSiblingDescendants = getDescendantTaskIds(parentId, childrenByParentId).filter(
        (descendantId) => !completedAfterThisAction.has(descendantId)
      );

      if (openSiblingDescendants.length === 0) {
        const parentFromGeneral = generalTasks.find((task) => task.id === parentId) ?? null;
        const parentFromToday = computedTodayTasks.find((task) => task.id === parentId) ?? null;
        const parentFromLegacy = findLegacyDailyTaskById(date, typedListType, parentId);
        const resolvedParent = parentFromGeneral ?? parentFromToday ?? parentFromLegacy ?? null;

        if (resolvedParent) {
          promptToCompleteParent = true;
          parentTask = {
            id: resolvedParent.id,
            text: resolvedParent.text,
            listType: typedListType,
          };
        }
      }
    }

    return NextResponse.json({
      success: true,
      completed: true,
      message: taskToComplete.isDaily
        ? 'Daily task marked as completed (stays in general list for tomorrow)'
        : 'Task marked as completed and removed from general list',
      promptToCompleteParent,
      parentTask,
    });
  } catch (error) {
    console.error('Error toggling task completion:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
