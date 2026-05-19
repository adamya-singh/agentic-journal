import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import {
  ListType,
  ProjectRoadmap,
  ProjectRoadmapsData,
  RoadmapCheckpoint,
  RoadmapCheckpointStatus,
  RoadmapTaskRef,
} from '@/lib/types';
import { normalizeProjectSlug } from '@/lib/projects';

const PROJECTS_DIR = path.join(process.cwd(), 'src/backend/data/projects');
const ROADMAPS_PATH = path.join(PROJECTS_DIR, 'roadmaps.json');

const DEFAULT_ROADMAPS_DATA: ProjectRoadmapsData = {
  _comment: 'Project roadmaps keyed by normalized project slug',
  schemaVersion: 1,
  roadmaps: {},
};

function ensureDirExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toStatus(value: unknown): RoadmapCheckpointStatus {
  if (value === 'in-progress' || value === 'completed') {
    return value;
  }
  return 'not-started';
}

function toListType(value: unknown): ListType | null {
  if (value === 'have-to-do' || value === 'want-to-do') {
    return value;
  }
  return null;
}

function toTaskRef(value: unknown): RoadmapTaskRef | null {
  if (!isRecord(value) || typeof value.taskId !== 'string') {
    return null;
  }

  const listType = toListType(value.listType);
  if (!listType) {
    return null;
  }

  const taskId = value.taskId.trim();
  if (taskId.length === 0) {
    return null;
  }

  return { taskId, listType };
}

function uniqueTaskRefs(values: unknown[]): RoadmapTaskRef[] {
  const refs: RoadmapTaskRef[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const ref = toTaskRef(value);
    if (!ref) {
      continue;
    }

    const key = taskRefKey(ref);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    refs.push(ref);
  }

  return refs;
}

function toCheckpoint(value: unknown): RoadmapCheckpoint | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.title !== 'string') {
    return null;
  }

  const id = value.id.trim();
  const title = value.title.trim();
  if (id.length === 0 || title.length === 0) {
    return null;
  }

  const now = new Date().toISOString();
  const description = typeof value.description === 'string' ? value.description.trim() : '';

  return {
    id,
    title,
    ...(description.length > 0 ? { description } : {}),
    status: toStatus(value.status),
    tasks: Array.isArray(value.tasks) ? uniqueTaskRefs(value.tasks) : [],
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

function toRoadmap(project: string, value: unknown): ProjectRoadmap | null {
  if (!isRecord(value)) {
    return null;
  }

  const normalizedProject = normalizeProjectSlug(project);
  if (normalizedProject.length === 0 || normalizedProject === '__unassigned__') {
    return null;
  }

  const now = new Date().toISOString();
  const goal = typeof value.goal === 'string' ? value.goal.trim() : '';
  const checkpoints = Array.isArray(value.checkpoints)
    ? value.checkpoints.map(toCheckpoint).filter((checkpoint): checkpoint is RoadmapCheckpoint => checkpoint !== null)
    : [];

  return {
    project: normalizedProject,
    goal,
    checkpoints,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  };
}

function normalizeData(value: unknown): ProjectRoadmapsData {
  if (!isRecord(value)) {
    return { ...DEFAULT_ROADMAPS_DATA, roadmaps: {} };
  }

  const rawRoadmaps = isRecord(value.roadmaps) ? value.roadmaps : {};
  const roadmaps: Record<string, ProjectRoadmap> = {};

  for (const [project, rawRoadmap] of Object.entries(rawRoadmaps)) {
    const normalizedProject = normalizeProjectSlug(project);
    const roadmap = toRoadmap(normalizedProject, rawRoadmap);
    if (roadmap) {
      roadmaps[normalizedProject] = roadmap;
    }
  }

  return {
    _comment: DEFAULT_ROADMAPS_DATA._comment,
    schemaVersion: 1,
    roadmaps,
  };
}

export function taskRefKey(ref: RoadmapTaskRef): string {
  return `${ref.taskId}:${ref.listType}`;
}

export function readProjectRoadmaps(): ProjectRoadmapsData {
  if (!fs.existsSync(ROADMAPS_PATH)) {
    return { ...DEFAULT_ROADMAPS_DATA, roadmaps: {} };
  }

  try {
    return normalizeData(JSON.parse(fs.readFileSync(ROADMAPS_PATH, 'utf-8')) as unknown);
  } catch {
    return { ...DEFAULT_ROADMAPS_DATA, roadmaps: {} };
  }
}

export function writeProjectRoadmaps(data: ProjectRoadmapsData): void {
  ensureDirExists(ROADMAPS_PATH);
  fs.writeFileSync(
    ROADMAPS_PATH,
    JSON.stringify({ ...DEFAULT_ROADMAPS_DATA, roadmaps: data.roadmaps }, null, 2) + '\n',
    'utf-8'
  );
}

export function getRoadmap(project: string): ProjectRoadmap | null {
  const normalizedProject = normalizeProjectSlug(project);
  if (normalizedProject.length === 0 || normalizedProject === '__unassigned__') {
    return null;
  }

  return readProjectRoadmaps().roadmaps[normalizedProject] ?? null;
}

export function createEmptyRoadmap(project: string): ProjectRoadmap {
  const normalizedProject = normalizeProjectSlug(project);
  const now = new Date().toISOString();

  return {
    project: normalizedProject,
    goal: '',
    checkpoints: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function updateRoadmap(
  project: string,
  updater: (roadmap: ProjectRoadmap) => ProjectRoadmap
): ProjectRoadmap {
  const normalizedProject = normalizeProjectSlug(project);
  if (normalizedProject.length === 0 || normalizedProject === '__unassigned__') {
    throw new Error('Invalid project');
  }

  const data = readProjectRoadmaps();
  const current = data.roadmaps[normalizedProject] ?? createEmptyRoadmap(normalizedProject);
  const updated = {
    ...updater(current),
    project: normalizedProject,
    updatedAt: new Date().toISOString(),
  };

  data.roadmaps[normalizedProject] = updated;
  writeProjectRoadmaps(data);
  return updated;
}

export function createCheckpoint(
  title: string,
  options?: { description?: string; status?: RoadmapCheckpointStatus }
): RoadmapCheckpoint {
  const now = new Date().toISOString();
  const description = options?.description?.trim() ?? '';

  return {
    id: randomUUID(),
    title: title.trim(),
    ...(description.length > 0 ? { description } : {}),
    status: options?.status ?? 'not-started',
    tasks: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function removeTaskRefFromRoadmap(roadmap: ProjectRoadmap, ref: RoadmapTaskRef): ProjectRoadmap {
  const key = taskRefKey(ref);
  return {
    ...roadmap,
    checkpoints: roadmap.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      tasks: checkpoint.tasks.filter((taskRef) => taskRefKey(taskRef) !== key),
    })),
  };
}
