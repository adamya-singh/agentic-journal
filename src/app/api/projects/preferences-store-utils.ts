import * as fs from 'fs';
import * as path from 'path';
import type { ProjectPreferencesData } from '@/lib/types';
import { normalizeProjectSlug } from '@/lib/projects';

const PROJECTS_DIR = path.join(process.cwd(), 'src/backend/data/projects');
const PREFERENCES_PATH = path.join(PROJECTS_DIR, 'preferences.json');

const DEFAULT_PREFERENCES_DATA: ProjectPreferencesData = {
  _comment: 'Project preferences keyed by normalized project slug',
  schemaVersion: 1,
  pinnedProjects: [],
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

function normalizePinnedProjects(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const pinnedProjects: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const project = normalizeProjectSlug(value);
    if (project.length === 0 || project === '__unassigned__' || seen.has(project)) {
      continue;
    }

    seen.add(project);
    pinnedProjects.push(project);
  }

  return pinnedProjects;
}

function normalizeData(value: unknown): ProjectPreferencesData {
  if (!isRecord(value)) {
    return { ...DEFAULT_PREFERENCES_DATA, pinnedProjects: [] };
  }

  return {
    ...DEFAULT_PREFERENCES_DATA,
    pinnedProjects: normalizePinnedProjects(value.pinnedProjects),
  };
}

export function readProjectPreferences(): ProjectPreferencesData {
  if (!fs.existsSync(PREFERENCES_PATH)) {
    return { ...DEFAULT_PREFERENCES_DATA, pinnedProjects: [] };
  }

  try {
    return normalizeData(JSON.parse(fs.readFileSync(PREFERENCES_PATH, 'utf-8')) as unknown);
  } catch {
    return { ...DEFAULT_PREFERENCES_DATA, pinnedProjects: [] };
  }
}

export function writeProjectPreferences(data: ProjectPreferencesData): void {
  ensureDirExists(PREFERENCES_PATH);
  fs.writeFileSync(
    PREFERENCES_PATH,
    JSON.stringify(
      {
        ...DEFAULT_PREFERENCES_DATA,
        pinnedProjects: normalizePinnedProjects(data.pinnedProjects),
      },
      null,
      2
    ) + '\n',
    'utf-8'
  );
}

export function setProjectPinned(project: string, pinned: boolean): ProjectPreferencesData {
  const normalizedProject = normalizeProjectSlug(project);
  if (normalizedProject.length === 0 || normalizedProject === '__unassigned__') {
    throw new Error('Invalid project');
  }

  const data = readProjectPreferences();
  const withoutProject = data.pinnedProjects.filter((entry) => entry !== normalizedProject);
  const pinnedProjects = pinned ? [normalizedProject, ...withoutProject] : withoutProject;
  const updated = {
    ...DEFAULT_PREFERENCES_DATA,
    pinnedProjects,
  };

  writeProjectPreferences(updated);
  return updated;
}
