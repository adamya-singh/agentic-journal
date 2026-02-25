import { NextRequest, NextResponse } from 'next/server';
import { ListType, Task } from '@/lib/types';
import { formatProjectTag, normalizeProjectList } from '@/lib/projects';
import { computeTodayTasksByList } from '../../tasks/today/staged-sync-utils';
import { readCompletedTaskIndex, readGeneralTasks } from '../../tasks/today/today-store-utils';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const UNASSIGNED_KEY = '__unassigned__';

interface ProjectTaskView {
  id: string;
  text: string;
  projects?: string[];
  dueDate?: string;
  isDaily?: boolean;
  completed?: boolean;
  completedAt?: string;
  sourceDate?: string;
}

interface ProjectBucket {
  haveToDo: ProjectTaskView[];
  wantToDo: ProjectTaskView[];
}

interface ProjectGroup {
  project: string;
  tagged: string;
  unified: ProjectTaskView[];
  general: ProjectBucket;
  today: ProjectBucket;
  completed: ProjectBucket;
  totals: {
    general: number;
    today: number;
    completed: number;
    all: number;
  };
}

function getCurrentDateISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function emptyBucket(): ProjectBucket {
  return {
    haveToDo: [],
    wantToDo: [],
  };
}

function toBucketKey(listType: ListType): 'haveToDo' | 'wantToDo' {
  return listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
}

function getProjectKeys(task: Pick<Task, 'projects'>): string[] {
  const normalized = normalizeProjectList(task.projects);
  return normalized.length > 0 ? normalized : [UNASSIGNED_KEY];
}

function createGroup(project: string): ProjectGroup {
  const tagged = project === UNASSIGNED_KEY ? '' : formatProjectTag(project);
  return {
    project,
    tagged,
    unified: [],
    general: emptyBucket(),
    today: emptyBucket(),
    completed: emptyBucket(),
    totals: {
      general: 0,
      today: 0,
      completed: 0,
      all: 0,
    },
  };
}

function pushUniqueTask(bucket: ProjectBucket, listType: ListType, task: ProjectTaskView): void {
  const key = toBucketKey(listType);
  const exists = bucket[key].some((entry) => entry.id === task.id);
  if (!exists) {
    bucket[key].push(task);
  }
}

function updateTotals(group: ProjectGroup): void {
  const general = group.general.haveToDo.length + group.general.wantToDo.length;
  const today = group.today.haveToDo.length + group.today.wantToDo.length;
  const completed = group.completed.haveToDo.length + group.completed.wantToDo.length;
  group.totals = {
    general,
    today,
    completed,
    all: general + today + completed,
  };
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isNaN(ts) ? 0 : ts;
}

function buildUnifiedList(group: ProjectGroup): ProjectTaskView[] {
  const orderedGeneral = [...group.general.haveToDo, ...group.general.wantToDo];
  const orderedToday = [...group.today.haveToDo, ...group.today.wantToDo];
  const orderedCompleted = [...group.completed.haveToDo, ...group.completed.wantToDo];

  const mergedById = new Map<string, ProjectTaskView>();
  const upsertMany = (tasks: ProjectTaskView[]) => {
    for (const task of tasks) {
      mergedById.set(task.id, task);
    }
  };

  // Precedence for field values: completed > today > general.
  upsertMany(orderedGeneral);
  upsertMany(orderedToday);
  upsertMany(orderedCompleted);

  const open: ProjectTaskView[] = [];
  const completed: ProjectTaskView[] = [];
  for (const task of mergedById.values()) {
    if (task.completed) {
      completed.push(task);
    } else {
      open.push(task);
    }
  }

  completed.sort((a, b) => toTimestamp(b.completedAt) - toTimestamp(a.completedAt));
  return [...open, ...completed];
}

/**
 * GET /api/projects/view
 * Returns tasks grouped by project for general, today, and completed lifecycle buckets.
 *
 * Query params:
 * - date: ISO date (YYYY-MM-DD) used for computing today's tasks (defaults to current date)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') ?? getCurrentDateISO();

    if (!DATE_REGEX.test(date)) {
      return NextResponse.json(
        { success: false, error: 'Invalid date. Must be in ISO format (YYYY-MM-DD).' },
        { status: 400 }
      );
    }

    const generalHave = readGeneralTasks('have-to-do').tasks;
    const generalWant = readGeneralTasks('want-to-do').tasks;
    const todayByList = computeTodayTasksByList(date);
    const completedIndex = readCompletedTaskIndex();

    const groups = new Map<string, ProjectGroup>();
    const getOrCreateGroup = (project: string): ProjectGroup => {
      const existing = groups.get(project);
      if (existing) {
        return existing;
      }
      const created = createGroup(project);
      groups.set(project, created);
      return created;
    };

    const addGeneralTask = (task: Task, listType: ListType) => {
      const projects = normalizeProjectList(task.projects);
      const taskView: ProjectTaskView = {
        id: task.id,
        text: task.text,
        ...(projects.length > 0 ? { projects } : {}),
        ...(task.dueDate ? { dueDate: task.dueDate } : {}),
        ...(task.isDaily ? { isDaily: true } : {}),
      };

      for (const project of getProjectKeys(task)) {
        const group = getOrCreateGroup(project);
        pushUniqueTask(group.general, listType, taskView);
      }
    };

    const addTodayTask = (task: Task, listType: ListType) => {
      const projects = normalizeProjectList(task.projects);
      const taskView: ProjectTaskView = {
        id: task.id,
        text: task.text,
        ...(projects.length > 0 ? { projects } : {}),
        ...(task.dueDate ? { dueDate: task.dueDate } : {}),
        ...(task.isDaily ? { isDaily: true } : {}),
        ...(task.completed === true ? { completed: true } : {}),
      };

      for (const project of getProjectKeys(task)) {
        const group = getOrCreateGroup(project);
        pushUniqueTask(group.today, listType, taskView);
      }
    };

    const addCompletedTask = (snapshot: {
      id: string;
      text: string;
      listType: ListType;
      completedAt?: string;
      sourceDate?: string;
      dueDate?: string;
      isDaily?: boolean;
      projects?: string[];
    }) => {
      const projects = normalizeProjectList(snapshot.projects);
      const taskView: ProjectTaskView = {
        id: snapshot.id,
        text: snapshot.text,
        completed: true,
        ...(projects.length > 0 ? { projects } : {}),
        ...(snapshot.dueDate ? { dueDate: snapshot.dueDate } : {}),
        ...(snapshot.isDaily ? { isDaily: true } : {}),
        ...(snapshot.completedAt ? { completedAt: snapshot.completedAt } : {}),
        ...(snapshot.sourceDate ? { sourceDate: snapshot.sourceDate } : {}),
      };

      for (const project of (projects.length > 0 ? projects : [UNASSIGNED_KEY])) {
        const group = getOrCreateGroup(project);
        pushUniqueTask(group.completed, snapshot.listType, taskView);
      }
    };

    for (const task of generalHave) {
      addGeneralTask(task, 'have-to-do');
    }
    for (const task of generalWant) {
      addGeneralTask(task, 'want-to-do');
    }
    for (const task of todayByList['have-to-do']) {
      addTodayTask(task, 'have-to-do');
    }
    for (const task of todayByList['want-to-do']) {
      addTodayTask(task, 'want-to-do');
    }

    for (const snapshot of Object.values(completedIndex.tasks)) {
      addCompletedTask(snapshot);
    }

    for (const group of groups.values()) {
      group.completed.haveToDo.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
      group.completed.wantToDo.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
      group.unified = buildUnifiedList(group);
      updateTotals(group);
    }

    const allGroups = Array.from(groups.values());
    const unassigned = allGroups.find((group) => group.project === UNASSIGNED_KEY) ?? createGroup(UNASSIGNED_KEY);
    const projects = allGroups
      .filter((group) => group.project !== UNASSIGNED_KEY)
      .sort((a, b) => a.project.localeCompare(b.project));

    return NextResponse.json({
      success: true,
      date,
      projects,
      unassigned,
    });
  } catch (error) {
    console.error('Error building project view:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
