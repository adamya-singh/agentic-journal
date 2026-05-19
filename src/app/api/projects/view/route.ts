import { NextRequest, NextResponse } from 'next/server';
import { ListType, ProjectRoadmap, RoadmapCheckpoint, RoadmapTaskRef, Task } from '@/lib/types';
import { formatProjectTag, normalizeProjectList } from '@/lib/projects';
import { computeTodayTasksByList } from '../../tasks/today/staged-sync-utils';
import { readCompletedTaskIndex, readGeneralTasks } from '../../tasks/today/today-store-utils';
import { readProjectRoadmaps, taskRefKey } from '../roadmap-store-utils';

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const UNASSIGNED_KEY = '__unassigned__';

interface ProjectTaskView {
  id: string;
  text: string;
  listType: ListType;
  projects?: string[];
  parentTaskId?: string;
  parentTaskText?: string;
  dueDate?: string;
  dueTimeStart?: string;
  dueTimeEnd?: string;
  isDaily?: boolean;
  completed?: boolean;
  completedAt?: string;
  sourceDate?: string;
}

interface RoadmapTaskView extends ProjectTaskView {
  missing?: boolean;
}

interface RoadmapCheckpointView {
  id: string;
  title: string;
  description?: string;
  status: RoadmapCheckpoint['status'];
  tasks: RoadmapTaskView[];
  progress: {
    completed: number;
    total: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface ProjectRoadmapView {
  project: string;
  goal: string;
  checkpoints: RoadmapCheckpointView[];
  createdAt: string;
  updatedAt: string;
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
  roadmap: ProjectRoadmapView | null;
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
    roadmap: null,
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

function makeTaskView(
  task: Task,
  listType: ListType,
  getParentContext: (task: { parentTaskId?: string }) => { parentTaskId?: string; parentTaskText?: string },
  options?: { completedAt?: string; sourceDate?: string; completed?: boolean }
): ProjectTaskView {
  const projects = normalizeProjectList(task.projects);
  return {
    id: task.id,
    text: task.text,
    listType,
    ...(projects.length > 0 ? { projects } : {}),
    ...getParentContext(task),
    ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    ...(task.dueTimeStart ? { dueTimeStart: task.dueTimeStart } : {}),
    ...(task.dueTimeEnd ? { dueTimeEnd: task.dueTimeEnd } : {}),
    ...(task.isDaily ? { isDaily: true } : {}),
    ...(options?.completed ? { completed: true } : {}),
    ...(options?.completedAt ? { completedAt: options.completedAt } : {}),
    ...(options?.sourceDate ? { sourceDate: options.sourceDate } : {}),
  };
}

function buildRoadmapView(roadmap: ProjectRoadmap, taskViewsByKey: Map<string, ProjectTaskView>): ProjectRoadmapView {
  return {
    project: roadmap.project,
    goal: roadmap.goal,
    checkpoints: roadmap.checkpoints.map((checkpoint) => {
      const tasks = checkpoint.tasks.map((ref: RoadmapTaskRef): RoadmapTaskView => {
        const resolved = taskViewsByKey.get(taskRefKey(ref));
        if (resolved) {
          return resolved;
        }

        return {
          id: ref.taskId,
          text: 'Missing task',
          listType: ref.listType,
          missing: true,
        };
      });
      const completed = tasks.filter((task) => task.completed).length;

      return {
        id: checkpoint.id,
        title: checkpoint.title,
        ...(checkpoint.description ? { description: checkpoint.description } : {}),
        status: checkpoint.status,
        tasks,
        progress: {
          completed,
          total: tasks.length,
        },
        createdAt: checkpoint.createdAt,
        updatedAt: checkpoint.updatedAt,
      };
    }),
    createdAt: roadmap.createdAt,
    updatedAt: roadmap.updatedAt,
  };
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
    const roadmapsData = readProjectRoadmaps();
    const taskTextById = new Map<string, string>();
    const taskViewsByKey = new Map<string, ProjectTaskView>();

    const registerTaskText = (task: { id: string; text: string }) => {
      taskTextById.set(task.id, task.text);
    };

    [...generalHave, ...generalWant].forEach(registerTaskText);
    [...todayByList['have-to-do'], ...todayByList['want-to-do']].forEach(registerTaskText);
    Object.values(completedIndex.tasks).forEach(registerTaskText);

    const getParentContext = (task: { parentTaskId?: string } | { parentTaskId?: string | undefined; [key: string]: unknown }) => {
      if (!task.parentTaskId) {
        return {};
      }

      return {
        parentTaskId: task.parentTaskId,
        ...(taskTextById.get(task.parentTaskId) ? { parentTaskText: taskTextById.get(task.parentTaskId) } : {}),
      };
    };

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

    const registerTaskView = (taskView: ProjectTaskView) => {
      taskViewsByKey.set(taskRefKey({ taskId: taskView.id, listType: taskView.listType }), taskView);
    };

    const addGeneralTask = (task: Task, listType: ListType) => {
      const taskView = makeTaskView(task, listType, getParentContext);
      registerTaskView(taskView);

      for (const project of getProjectKeys(task)) {
        const group = getOrCreateGroup(project);
        pushUniqueTask(group.general, listType, taskView);
      }
    };

    const addTodayTask = (task: Task, listType: ListType) => {
      const taskView = makeTaskView(task, listType, getParentContext, {
        completed: task.completed === true,
      });
      registerTaskView(taskView);

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
      dueTimeStart?: string;
      dueTimeEnd?: string;
      isDaily?: boolean;
      projects?: string[];
      parentTaskId?: string;
    }) => {
      const projects = normalizeProjectList(snapshot.projects);
      const task: Task = {
        id: snapshot.id,
        text: snapshot.text,
        ...(projects.length > 0 ? { projects } : {}),
        ...(snapshot.dueDate ? { dueDate: snapshot.dueDate } : {}),
        ...(snapshot.dueTimeStart ? { dueTimeStart: snapshot.dueTimeStart } : {}),
        ...(snapshot.dueTimeEnd ? { dueTimeEnd: snapshot.dueTimeEnd } : {}),
        ...(snapshot.isDaily ? { isDaily: true } : {}),
        ...(snapshot.parentTaskId ? { parentTaskId: snapshot.parentTaskId } : {}),
      };
      const taskView = makeTaskView(task, snapshot.listType, getParentContext, {
        completed: true,
        completedAt: snapshot.completedAt,
        sourceDate: snapshot.sourceDate,
      });
      registerTaskView(taskView);

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

    for (const roadmap of Object.values(roadmapsData.roadmaps)) {
      const group = getOrCreateGroup(roadmap.project);
      group.roadmap = buildRoadmapView(roadmap, taskViewsByKey);
    }

    for (const group of groups.values()) {
      if (!group.roadmap && group.project !== UNASSIGNED_KEY && roadmapsData.roadmaps[group.project]) {
        group.roadmap = buildRoadmapView(roadmapsData.roadmaps[group.project], taskViewsByKey);
      }
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
