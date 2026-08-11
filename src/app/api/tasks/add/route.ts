import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { handleDueDateSetup } from '../due-date-utils';
import type { Task, TasksData } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import { validateDueTimeRange } from '@/lib/due-time';
import { getDescendantTaskIds, validateParentTaskAssignment, buildChildrenByParentId } from '@/lib/tasks';
import { readGeneralTasks, writeGeneralTasks } from '../today/today-store-utils';
import { ensureCurrentSystemThroughToday, refreshActiveDailySnapshots } from '../current/current-store-utils';

const NOTES_MAX_LENGTH = 20000;

/**
 * POST /api/tasks/add
 * Appends a new task to the General backlog (subtasks insert after their parent's subtree).
 * General is unordered; ranking happens via Current admission.
 *
 * Body: { task: string, listType?: 'have-to-do' | 'want-to-do', dueDate?: string, dueTimeStart?: string, dueTimeEnd?: string, isDaily?: boolean, projects?: string[], notesMarkdown?: string, parentTaskId?: string }
 * - task: The task text to add
 * - listType: Which task list to add to (defaults to 'have-to-do')
 * - dueDate: Optional due date in ISO format (YYYY-MM-DD)
 * - isDaily: Optional flag to mark task as recurring daily
 * - projects: Optional list of project slugs/labels (normalized to kebab-case slugs)
 * - notesMarkdown: Optional markdown notes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { task, listType = 'have-to-do', dueDate, dueTimeStart, dueTimeEnd, isDaily, projects, notesMarkdown, parentTaskId } = body;

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
    if (parentTaskId !== undefined && typeof parentTaskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'parentTaskId must be a string when provided' },
        { status: 400 }
      );
    }

    const normalizedNotes = typeof notesMarkdown === 'string' ? notesMarkdown.trim() : '';
    const normalizedParentTaskId = typeof parentTaskId === 'string' ? parentTaskId.trim() : '';
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
    if (normalizedParentTaskId.length > 0) {
      newTask.parentTaskId = normalizedParentTaskId;
    }

    ensureCurrentSystemThroughToday();
    // Read current tasks
    const data = readGeneralTasks(listType) as TasksData;

    const parentValidation = validateParentTaskAssignment(data.tasks, newTask.id, normalizedParentTaskId);
    if (!parentValidation.valid) {
      return NextResponse.json(
        { success: false, error: parentValidation.error },
        { status: 400 }
      );
    }

    // Insert at specified position or append to end
    // Position is relative to task type (daily tasks vs regular tasks) for top-level tasks.
    if (normalizedParentTaskId.length > 0) {
      const childrenByParentId = buildChildrenByParentId(data.tasks);
      const subtreeIds = new Set([normalizedParentTaskId, ...getDescendantTaskIds(normalizedParentTaskId, childrenByParentId)]);
      let insertAt = data.tasks.findIndex((existingTask) => existingTask.id === normalizedParentTaskId);

      data.tasks.forEach((existingTask, index) => {
        if (subtreeIds.has(existingTask.id)) {
          insertAt = Math.max(insertAt, index);
        }
      });

      data.tasks.splice(insertAt + 1, 0, newTask);
    } else {
      // General lists are unordered backlogs; priority exists only in Current.
      data.tasks.push(newTask);
    }

    // Write updated tasks
    writeGeneralTasks(data, listType);

    // If task has a due date, ensure due-date journal + staged task are initialized
    if (newTask.dueDate) {
      handleDueDateSetup(newTask.dueDate, listType, newTask);
    }
    refreshActiveDailySnapshots();

    return NextResponse.json({
      success: true,
      message: 'Task added successfully',
      taskId: newTask.id,
      task: newTask,
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
