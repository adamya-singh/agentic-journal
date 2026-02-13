import * as fs from 'fs';
import * as path from 'path';
import { ListType, Task, TasksData } from '@/lib/types';

export interface TaskCompletionSnapshot {
  id: string;
  text: string;
  dueDate?: string;
  isDaily?: boolean;
  completed: true;
  completedAt: string;
  listType: ListType;
}

interface CompletedDailyTasksData {
  _comment: string;
  schemaVersion: number;
  completedTasks: TaskCompletionSnapshot[];
}

interface TodayOverridesDataFile {
  _comment: string;
  schemaVersion: number;
  includedTaskIds: string[];
  excludedTaskIds: string[];
}

interface LegacyDailyTasksData {
  tasks?: Task[];
}

const TASKS_DIR = path.join(process.cwd(), 'src/backend/data/tasks');
const DAILY_LISTS_DIR = path.join(TASKS_DIR, 'daily-lists');
const TODAY_OVERRIDES_DIR = path.join(TASKS_DIR, 'today-overrides');

function ensureDirExists(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function getDailyTasksFilePath(date: string, listType: ListType): string {
  return path.join(DAILY_LISTS_DIR, `${date}-${listType}.json`);
}

export function getTodayOverridesFilePath(date: string, listType: ListType): string {
  return path.join(TODAY_OVERRIDES_DIR, `${date}-${listType}.json`);
}

export function getGeneralTasksFilePath(listType: ListType): string {
  return path.join(TASKS_DIR, `${listType}.json`);
}

export function readGeneralTasks(listType: ListType): TasksData {
  const tasksFile = getGeneralTasksFilePath(listType);
  if (!fs.existsSync(tasksFile)) {
    return {
      _comment: 'Queue structure - first element is highest priority',
      tasks: [],
    };
  }

  const content = fs.readFileSync(tasksFile, 'utf-8');
  return JSON.parse(content) as TasksData;
}

export function writeGeneralTasks(data: TasksData, listType: ListType): void {
  const tasksFile = getGeneralTasksFilePath(listType);
  ensureDirExists(tasksFile);
  fs.writeFileSync(tasksFile, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toCompletionSnapshot(value: unknown, listType: ListType, fallbackCompletedAt: string): TaskCompletionSnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = typeof value.id === 'string' ? value.id : null;
  const text = typeof value.text === 'string' ? value.text : null;
  if (!id || !text) {
    return null;
  }

  const snapshot: TaskCompletionSnapshot = {
    id,
    text,
    completed: true,
    completedAt: typeof value.completedAt === 'string' ? value.completedAt : fallbackCompletedAt,
    listType,
  };

  if (typeof value.dueDate === 'string' && value.dueDate.length > 0) {
    snapshot.dueDate = value.dueDate;
  }

  if (value.isDaily === true) {
    snapshot.isDaily = true;
  }

  return snapshot;
}

function readRawDailyFile(date: string, listType: ListType): unknown {
  const filePath = getDailyTasksFilePath(date, listType);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as unknown;
  } catch {
    return null;
  }
}

export function readLegacyDailyTasks(date: string, listType: ListType): Task[] {
  const parsed = readRawDailyFile(date, listType);
  if (!isRecord(parsed) || !Array.isArray((parsed as LegacyDailyTasksData).tasks)) {
    return [];
  }

  const tasks = (parsed as LegacyDailyTasksData).tasks ?? [];
  return tasks.filter((task): task is Task => isRecord(task) && typeof task.id === 'string' && typeof task.text === 'string');
}

export function findLegacyDailyTaskById(date: string, listType: ListType, taskId: string): Task | null {
  const tasks = readLegacyDailyTasks(date, listType);
  return tasks.find((task) => task.id === taskId) ?? null;
}

export function readCompletedTaskSnapshots(date: string, listType: ListType): TaskCompletionSnapshot[] {
  const parsed = readRawDailyFile(date, listType);
  if (!isRecord(parsed)) {
    return [];
  }

  const fallbackCompletedAt = `${date}T00:00:00.000Z`;

  // New schema
  if (Array.isArray(parsed.completedTasks)) {
    return parsed.completedTasks
      .map((entry) => toCompletionSnapshot(entry, listType, fallbackCompletedAt))
      .filter((entry): entry is TaskCompletionSnapshot => entry !== null);
  }

  // Legacy schema: derive completion snapshots only from completed tasks
  if (Array.isArray((parsed as LegacyDailyTasksData).tasks)) {
    const legacyTasks = (parsed as LegacyDailyTasksData).tasks ?? [];
    return legacyTasks
      .filter((task) => isRecord(task) && task.completed === true)
      .map((task) => toCompletionSnapshot(task, listType, fallbackCompletedAt))
      .filter((entry): entry is TaskCompletionSnapshot => entry !== null);
  }

  return [];
}

export function writeCompletedTaskSnapshots(date: string, listType: ListType, completedTasks: TaskCompletionSnapshot[]): void {
  const filePath = getDailyTasksFilePath(date, listType);
  ensureDirExists(filePath);

  const data: CompletedDailyTasksData = {
    _comment: 'Computed today list history - only completed tasks are persisted',
    schemaVersion: 2,
    completedTasks,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function upsertCompletedTaskSnapshot(
  date: string,
  listType: ListType,
  snapshot: TaskCompletionSnapshot
): { snapshots: TaskCompletionSnapshot[]; alreadyCompleted: boolean } {
  const current = readCompletedTaskSnapshots(date, listType);
  const existingIdx = current.findIndex((item) => item.id === snapshot.id);

  if (existingIdx !== -1) {
    current[existingIdx] = snapshot;
    writeCompletedTaskSnapshots(date, listType, current);
    return { snapshots: current, alreadyCompleted: true };
  }

  current.push(snapshot);
  writeCompletedTaskSnapshots(date, listType, current);
  return { snapshots: current, alreadyCompleted: false };
}

export function removeCompletedTaskSnapshot(
  date: string,
  listType: ListType,
  taskId: string
): { snapshots: TaskCompletionSnapshot[]; removed: boolean; removedSnapshot: TaskCompletionSnapshot | null } {
  const current = readCompletedTaskSnapshots(date, listType);
  const idx = current.findIndex((item) => item.id === taskId);

  if (idx === -1) {
    return { snapshots: current, removed: false, removedSnapshot: null };
  }

  const [removedSnapshot] = current.splice(idx, 1);
  writeCompletedTaskSnapshots(date, listType, current);
  return { snapshots: current, removed: true, removedSnapshot };
}

export function getCompletedTaskIdSet(date: string, listType: ListType): Set<string> {
  return new Set(readCompletedTaskSnapshots(date, listType).map((task) => task.id));
}

export interface TodayOverridesData {
  includedTaskIds: string[];
  excludedTaskIds: string[];
}

const DEFAULT_OVERRIDES: TodayOverridesData = {
  includedTaskIds: [],
  excludedTaskIds: [],
};

export function readTodayOverrides(date: string, listType: ListType): TodayOverridesData {
  const filePath = getTodayOverridesFilePath(date, listType);
  if (!fs.existsSync(filePath)) {
    return { ...DEFAULT_OVERRIDES };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!isRecord(parsed)) {
      return { ...DEFAULT_OVERRIDES };
    }

    const includedTaskIds = Array.isArray(parsed.includedTaskIds)
      ? parsed.includedTaskIds.filter((id): id is string => typeof id === 'string')
      : [];

    const excludedTaskIds = Array.isArray(parsed.excludedTaskIds)
      ? parsed.excludedTaskIds.filter((id): id is string => typeof id === 'string')
      : [];

    return { includedTaskIds, excludedTaskIds };
  } catch {
    return { ...DEFAULT_OVERRIDES };
  }
}

export function writeTodayOverrides(date: string, listType: ListType, overrides: TodayOverridesData): void {
  const filePath = getTodayOverridesFilePath(date, listType);
  ensureDirExists(filePath);

  const data: TodayOverridesDataFile = {
    _comment: 'Manual today-list overrides for computed today tasks',
    schemaVersion: 1,
    includedTaskIds: overrides.includedTaskIds,
    excludedTaskIds: overrides.excludedTaskIds,
  };

  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

export function includeTaskInTodayOverrides(
  date: string,
  listType: ListType,
  taskId: string
): { overrides: TodayOverridesData; changed: boolean } {
  const overrides = readTodayOverrides(date, listType);

  const prevIncluded = overrides.includedTaskIds.length;
  const prevExcluded = overrides.excludedTaskIds.length;

  overrides.excludedTaskIds = overrides.excludedTaskIds.filter((id) => id !== taskId);
  if (!overrides.includedTaskIds.includes(taskId)) {
    overrides.includedTaskIds.push(taskId);
  }

  const changed = prevIncluded !== overrides.includedTaskIds.length || prevExcluded !== overrides.excludedTaskIds.length;
  if (changed) {
    writeTodayOverrides(date, listType, overrides);
  }

  return { overrides, changed };
}

export function excludeTaskInTodayOverrides(
  date: string,
  listType: ListType,
  taskId: string
): { overrides: TodayOverridesData; changed: boolean } {
  const overrides = readTodayOverrides(date, listType);

  const prevIncluded = overrides.includedTaskIds.length;
  const prevExcluded = overrides.excludedTaskIds.length;

  overrides.includedTaskIds = overrides.includedTaskIds.filter((id) => id !== taskId);
  if (!overrides.excludedTaskIds.includes(taskId)) {
    overrides.excludedTaskIds.push(taskId);
  }

  const changed = prevIncluded !== overrides.includedTaskIds.length || prevExcluded !== overrides.excludedTaskIds.length;
  if (changed) {
    writeTodayOverrides(date, listType, overrides);
  }

  return { overrides, changed };
}

export function taskFromCompletionSnapshot(snapshot: TaskCompletionSnapshot): Task {
  const task: Task = {
    id: snapshot.id,
    text: snapshot.text,
    completed: true,
  };

  if (snapshot.dueDate) {
    task.dueDate = snapshot.dueDate;
  }

  if (snapshot.isDaily) {
    task.isDaily = true;
  }

  return task;
}
