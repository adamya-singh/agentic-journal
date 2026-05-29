import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { normalizeProjectList, normalizeProjectSlug } from '@/lib/projects';
import { ListType, RoadmapCheckpointStatus, RoadmapTaskRef, Task, TasksData } from '@/lib/types';
import { validateDueTimeRange } from '@/lib/due-time';
import { handleDueDateSetup } from '../../tasks/due-date-utils';
import { readGeneralTasks, writeGeneralTasks } from '../../tasks/today/today-store-utils';
import { ensureCurrentSystemThroughToday, refreshActiveDailySnapshots } from '../../tasks/current/current-store-utils';
import {
  createCheckpoint,
  getRoadmap,
  removeTaskRefFromRoadmap,
  taskRefKey,
  updateRoadmap,
} from '../roadmap-store-utils';

const NOTES_MAX_LENGTH = 20000;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isListType(value: unknown): value is ListType {
  return value === 'have-to-do' || value === 'want-to-do';
}

function isStatus(value: unknown): value is RoadmapCheckpointStatus {
  return value === 'not-started' || value === 'in-progress' || value === 'completed';
}

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

function normalizeProjectOrError(value: unknown): { project: string } | { error: string } {
  if (typeof value !== 'string') {
    return { error: 'project is required' };
  }

  const project = normalizeProjectSlug(value);
  if (project.length === 0 || project === '__unassigned__') {
    return { error: 'Invalid project' };
  }

  return { project };
}

function findCheckpointIndex(checkpoints: { id: string }[], checkpointId: unknown): number {
  if (typeof checkpointId !== 'string' || checkpointId.trim().length === 0) {
    return -1;
  }
  return checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId.trim());
}

function appendTaskToList(data: TasksData, task: Task): number {
  data.tasks.push(task);
  return data.tasks.length - 1;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectParam = searchParams.get('project');

    if (!projectParam) {
      return badRequest('project is required');
    }

    const normalized = normalizeProjectOrError(projectParam);
    if ('error' in normalized) {
      return badRequest(normalized.error);
    }

    return NextResponse.json({
      success: true,
      roadmap: getRoadmap(normalized.project),
    });
  } catch (error) {
    console.error('Error reading project roadmap:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    const normalized = normalizeProjectOrError(body.project);
    if ('error' in normalized) {
      return badRequest(normalized.error);
    }

    const project = normalized.project;

    if (action === 'set-goal') {
      if (typeof body.goal !== 'string') {
        return badRequest('goal must be a string');
      }

      const roadmap = updateRoadmap(project, (current) => ({
        ...current,
        goal: body.goal.trim(),
      }));

      return NextResponse.json({ success: true, roadmap });
    }

    if (action === 'add-checkpoint') {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return badRequest('title is required');
      }
      if (body.status !== undefined && !isStatus(body.status)) {
        return badRequest('Invalid checkpoint status');
      }
      if (body.description !== undefined && typeof body.description !== 'string') {
        return badRequest('description must be a string');
      }

      const checkpoint = createCheckpoint(body.title, {
        description: body.description,
        status: body.status,
      });
      const roadmap = updateRoadmap(project, (current) => ({
        ...current,
        checkpoints: [...current.checkpoints, checkpoint],
      }));

      return NextResponse.json({ success: true, roadmap, checkpoint });
    }

    if (action === 'update-checkpoint') {
      if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim().length === 0)) {
        return badRequest('title must be a non-empty string');
      }
      if (body.description !== undefined && typeof body.description !== 'string') {
        return badRequest('description must be a string');
      }
      if (body.status !== undefined && !isStatus(body.status)) {
        return badRequest('Invalid checkpoint status');
      }

      let found = false;
      const roadmap = updateRoadmap(project, (current) => ({
        ...current,
        checkpoints: current.checkpoints.map((checkpoint) => {
          if (checkpoint.id !== body.checkpointId) {
            return checkpoint;
          }

          found = true;
          const description = typeof body.description === 'string' ? body.description.trim() : checkpoint.description;
          return {
            ...checkpoint,
            ...(typeof body.title === 'string' ? { title: body.title.trim() } : {}),
            ...(description && description.length > 0 ? { description } : { description: undefined }),
            ...(body.status ? { status: body.status } : {}),
            updatedAt: new Date().toISOString(),
          };
        }),
      }));

      if (!found) {
        return badRequest('Checkpoint not found');
      }

      return NextResponse.json({ success: true, roadmap });
    }

    if (action === 'reorder-checkpoint') {
      if (typeof body.newIndex !== 'number' || !Number.isInteger(body.newIndex) || body.newIndex < 0) {
        return badRequest('newIndex must be a non-negative integer');
      }

      let found = false;
      const roadmap = updateRoadmap(project, (current) => {
        const index = findCheckpointIndex(current.checkpoints, body.checkpointId);
        if (index === -1) {
          return current;
        }

        found = true;
        const next = [...current.checkpoints];
        const [checkpoint] = next.splice(index, 1);
        next.splice(Math.min(body.newIndex, next.length), 0, checkpoint);
        return { ...current, checkpoints: next };
      });

      if (!found) {
        return badRequest('Checkpoint not found');
      }

      return NextResponse.json({ success: true, roadmap });
    }

    if (action === 'remove-checkpoint') {
      let removed = false;
      const roadmap = updateRoadmap(project, (current) => {
        const checkpoints = current.checkpoints.filter((checkpoint) => {
          if (checkpoint.id === body.checkpointId) {
            removed = true;
            return false;
          }
          return true;
        });
        return { ...current, checkpoints };
      });

      if (!removed) {
        return badRequest('Checkpoint not found');
      }

      return NextResponse.json({ success: true, roadmap });
    }

    if (action === 'link-task' || action === 'unlink-task') {
      if (typeof body.taskId !== 'string' || body.taskId.trim().length === 0) {
        return badRequest('taskId is required');
      }
      if (!isListType(body.listType)) {
        return badRequest('Invalid listType');
      }

      if (action === 'link-task') {
        const roadmap = getRoadmap(project);
        if (!roadmap || !roadmap.checkpoints.some((checkpoint) => checkpoint.id === body.checkpointId)) {
          return badRequest('Checkpoint not found');
        }
      }

      const ref: RoadmapTaskRef = { taskId: body.taskId.trim(), listType: body.listType };
      let found = false;
      const roadmap = updateRoadmap(project, (current) => {
        const withoutExisting = removeTaskRefFromRoadmap(current, ref);
        if (action === 'unlink-task') {
          return withoutExisting;
        }

        return {
          ...withoutExisting,
          checkpoints: withoutExisting.checkpoints.map((checkpoint) => {
            if (checkpoint.id !== body.checkpointId) {
              return checkpoint;
            }
            found = true;
            return {
              ...checkpoint,
              tasks: [...checkpoint.tasks, ref],
              updatedAt: new Date().toISOString(),
            };
          }),
        };
      });

      if (action === 'link-task' && !found) {
        return badRequest('Checkpoint not found');
      }

      return NextResponse.json({ success: true, roadmap });
    }

    if (action === 'create-task') {
      ensureCurrentSystemThroughToday();
      if (typeof body.checkpointId !== 'string' || body.checkpointId.trim().length === 0) {
        return badRequest('checkpointId is required');
      }
      if (typeof body.text !== 'string' || body.text.trim().length === 0) {
        return badRequest('text is required');
      }
      if (!isListType(body.listType)) {
        return badRequest('Invalid listType');
      }
      if (body.dueDate !== undefined && body.dueDate !== '' && (typeof body.dueDate !== 'string' || !DATE_REGEX.test(body.dueDate))) {
        return badRequest('Invalid dueDate');
      }
      if (body.dueTimeStart !== undefined && typeof body.dueTimeStart !== 'string') {
        return badRequest('dueTimeStart must be a string');
      }
      if (body.dueTimeEnd !== undefined && typeof body.dueTimeEnd !== 'string') {
        return badRequest('dueTimeEnd must be a string');
      }
      if (body.notesMarkdown !== undefined && typeof body.notesMarkdown !== 'string') {
        return badRequest('notesMarkdown must be a string');
      }

      const notesMarkdown = typeof body.notesMarkdown === 'string' ? body.notesMarkdown.trim() : '';
      if (notesMarkdown.length > NOTES_MAX_LENGTH) {
        return badRequest(`notesMarkdown cannot exceed ${NOTES_MAX_LENGTH} characters`);
      }

      const dueDate = typeof body.dueDate === 'string' && body.dueDate.trim().length > 0 ? body.dueDate.trim() : undefined;
      const dueTimeStart = typeof body.dueTimeStart === 'string' && body.dueTimeStart.trim().length > 0 ? body.dueTimeStart.trim() : undefined;
      const dueTimeEnd = typeof body.dueTimeEnd === 'string' && body.dueTimeEnd.trim().length > 0 ? body.dueTimeEnd.trim() : undefined;

      if (!dueDate && (dueTimeStart || dueTimeEnd)) {
        return badRequest('dueTimeStart/dueTimeEnd require dueDate');
      }

      const dueTimeValidation = validateDueTimeRange(dueTimeStart, dueTimeEnd);
      if (!dueTimeValidation.valid) {
        return badRequest(dueTimeValidation.error);
      }

      const roadmap = getRoadmap(project);
      if (!roadmap || !roadmap.checkpoints.some((checkpoint) => checkpoint.id === body.checkpointId)) {
        return badRequest('Checkpoint not found');
      }

      const projectTags = normalizeProjectList([project, ...normalizeProjectList(body.projects)]);
      const task: Task = {
        id: randomUUID(),
        text: body.text.trim(),
        projects: projectTags,
        ...(dueDate ? { dueDate } : {}),
        ...(dueTimeStart ? { dueTimeStart } : {}),
        ...(dueTimeEnd ? { dueTimeEnd } : {}),
        ...(body.isDaily === true ? { isDaily: true } : {}),
        ...(notesMarkdown.length > 0 ? { notesMarkdown } : {}),
      };

      const tasksData = readGeneralTasks(body.listType);
      const insertedAt = appendTaskToList(tasksData, task);
      writeGeneralTasks(tasksData, body.listType);

      if (task.dueDate) {
        handleDueDateSetup(task.dueDate, body.listType, task);
      }
      refreshActiveDailySnapshots();

      const ref: RoadmapTaskRef = { taskId: task.id, listType: body.listType };
      const updatedRoadmap = updateRoadmap(project, (current) => {
        const withoutExisting = removeTaskRefFromRoadmap(current, ref);
        return {
          ...withoutExisting,
          checkpoints: withoutExisting.checkpoints.map((checkpoint) => {
            if (checkpoint.id !== body.checkpointId) {
              return checkpoint;
            }
            return {
              ...checkpoint,
              tasks: [...checkpoint.tasks.filter((taskRef) => taskRefKey(taskRef) !== taskRefKey(ref)), ref],
              updatedAt: new Date().toISOString(),
            };
          }),
        };
      });

      return NextResponse.json({
        success: true,
        roadmap: updatedRoadmap,
        task,
        taskId: task.id,
        insertedAt,
      });
    }

    return badRequest('Unknown roadmap action');
  } catch (error) {
    console.error('Error updating project roadmap:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
