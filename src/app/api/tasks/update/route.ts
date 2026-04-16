import { NextRequest, NextResponse } from 'next/server';
import { handleDueDateSetup } from '../due-date-utils';
import { TasksData } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import { validateDueTimeRange } from '@/lib/due-time';
import { validateParentTaskAssignment } from '@/lib/tasks';
import { readGeneralTasks, writeGeneralTasks } from '../today/today-store-utils';

const NOTES_MAX_LENGTH = 20000;

/**
 * POST /api/tasks/update
 * Updates a task's text, dueDate, and/or isDaily flag
 * 
 * Body: { taskId?: string, oldText?: string, newText?: string, dueDate?: string, dueTimeStart?: string, dueTimeEnd?: string, isDaily?: boolean, projects?: string[], notesMarkdown?: string, parentTaskId?: string, listType?: 'have-to-do' | 'want-to-do' }
 * - taskId: The unique ID of the task to update (preferred)
 * - oldText: Legacy text-based lookup (fallback if taskId not provided)
 * - newText: The new text for the task (optional)
 * - dueDate: The new due date in ISO format, or empty string to remove (optional)
 * - isDaily: Whether the task is daily recurring (optional)
 * - projects: Optional full replacement list of project slugs/labels (normalized to kebab-case slugs)
 * - notesMarkdown: Optional full replacement markdown notes (empty string clears notes)
 * - listType: Which task list to update in (defaults to 'have-to-do')
 * 
 * At least one of taskId or oldText must be provided.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { taskId, oldText, newText, dueDate, dueTimeStart, dueTimeEnd, isDaily, projects, notesMarkdown, parentTaskId, listType = 'have-to-do' } = body;

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
    if (typeof notesMarkdown === 'string' && notesMarkdown.trim().length > NOTES_MAX_LENGTH) {
      return NextResponse.json(
        { success: false, error: `notesMarkdown cannot exceed ${NOTES_MAX_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (parentTaskId !== undefined && typeof parentTaskId !== 'string') {
      return NextResponse.json(
        { success: false, error: 'parentTaskId must be a string when provided' },
        { status: 400 }
      );
    }

    // Read current tasks
    const data = readGeneralTasks(listType) as TasksData;

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
        delete data.tasks[taskIndex].dueTimeStart;
        delete data.tasks[taskIndex].dueTimeEnd;
      } else if (typeof dueDate === 'string') {
        data.tasks[taskIndex].dueDate = dueDate;
      }
    }

    if (dueTimeStart !== undefined || dueTimeEnd !== undefined) {
      if (typeof dueTimeStart === 'string' && dueTimeStart.trim() === '') {
        delete data.tasks[taskIndex].dueTimeStart;
        delete data.tasks[taskIndex].dueTimeEnd;
      } else {
        const currentStart = data.tasks[taskIndex].dueTimeStart;
        const currentEnd = data.tasks[taskIndex].dueTimeEnd;
        const nextStartRaw = typeof dueTimeStart === 'string' ? dueTimeStart.trim() : currentStart;
        const nextEndRaw = typeof dueTimeEnd === 'string' ? dueTimeEnd.trim() : currentEnd;
        const nextStart = nextStartRaw && nextStartRaw.length > 0 ? nextStartRaw : undefined;
        const nextEnd = nextEndRaw && nextEndRaw.length > 0 ? nextEndRaw : undefined;

        const validation = validateDueTimeRange(nextStart, nextEnd);
        if (!validation.valid) {
          return NextResponse.json(
            { success: false, error: validation.error },
            { status: 400 }
          );
        }

        const effectiveDueDate = dueDate !== undefined
          ? (typeof dueDate === 'string' && dueDate.trim().length > 0 ? dueDate.trim() : undefined)
          : data.tasks[taskIndex].dueDate;

        if (!effectiveDueDate && (nextStart || nextEnd)) {
          return NextResponse.json(
            { success: false, error: 'dueTimeStart/dueTimeEnd require dueDate' },
            { status: 400 }
          );
        }

        if (nextStart) {
          data.tasks[taskIndex].dueTimeStart = nextStart;
        } else {
          delete data.tasks[taskIndex].dueTimeStart;
        }
        if (nextEnd) {
          data.tasks[taskIndex].dueTimeEnd = nextEnd;
        } else {
          delete data.tasks[taskIndex].dueTimeEnd;
        }
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

    if (projects !== undefined) {
      const normalizedProjects = normalizeProjectList(projects);
      if (normalizedProjects.length > 0) {
        data.tasks[taskIndex].projects = normalizedProjects;
      } else {
        delete data.tasks[taskIndex].projects;
      }
    }

    if (notesMarkdown !== undefined) {
      const normalizedNotes = notesMarkdown.trim();
      if (normalizedNotes.length > 0) {
        data.tasks[taskIndex].notesMarkdown = normalizedNotes;
      } else {
        delete data.tasks[taskIndex].notesMarkdown;
      }
    }

    if (parentTaskId !== undefined) {
      const normalizedParentTaskId = parentTaskId.trim();
      const validation = validateParentTaskAssignment(data.tasks, data.tasks[taskIndex].id, normalizedParentTaskId);
      if (!validation.valid) {
        return NextResponse.json(
          { success: false, error: validation.error },
          { status: 400 }
        );
      }

      if (normalizedParentTaskId.length > 0) {
        data.tasks[taskIndex].parentTaskId = normalizedParentTaskId;
      } else {
        delete data.tasks[taskIndex].parentTaskId;
      }
    }

    // Write updated tasks
    writeGeneralTasks(data, listType);

    // Ensure due-date setup / due-time auto-plan state is synchronized (including cleanup on retime/removal).
    const updatedTask = data.tasks[taskIndex];
    const targetDate = updatedTask.dueDate || previousTask.dueDate;
    if (targetDate) {
      handleDueDateSetup(targetDate, listType, updatedTask, previousTask);
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
