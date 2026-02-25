import * as fs from 'fs';
import * as path from 'path';
import { ListType, Task, TasksData } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';

export interface TaskCompletionSnapshot {
  id: string;
  text: string;
  notesMarkdown?: string;
  projects?: string[];
  dueDate?: string;
  dueTimeStart?: string;
  dueTimeEnd?: string;
  isDaily?: boolean;
  completed: true;
  completedAt: string;
  listType: ListType;
}

export interface IndexedTaskCompletionSnapshot extends TaskCompletionSnapshot {
  sourceDate: string;
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

interface CompletedTaskIndexData {
  _comment: string;
  schemaVersion: number;
  tasks: Record<string, IndexedTaskCompletionSnapshot>;
  updatedAt: string;
}

const TASKS_DIR = path.join(process.cwd(), 'src/backend/data/tasks');
const DAILY_LISTS_DIR = path.join(TASKS_DIR, 'daily-lists');
const TODAY_OVERRIDES_DIR = path.join(TASKS_DIR, 'today-overrides');
const COMPLETED_INDEX_PATH = path.join(TASKS_DIR, 'completed-index.json');

const DEFAULT_COMPLETED_INDEX: CompletedTaskIndexData = {
  _comment: 'Global index for completed task snapshots by taskId',
  schemaVersion: 1,
  tasks: {},
  updatedAt: new Date(0).toISOString(),
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

function snapshotTimestamp(snapshot: { completedAt?: string; sourceDate?: string }): number {
  const completedAt = typeof snapshot.completedAt === 'string' ? Date.parse(snapshot.completedAt) : NaN;
  if (!Number.isNaN(completedAt)) {
    return completedAt;
  }

  const sourceDate = typeof snapshot.sourceDate === 'string' ? Date.parse(`${snapshot.sourceDate}T00:00:00.000Z`) : NaN;
  if (!Number.isNaN(sourceDate)) {
    return sourceDate;
  }

  return 0;
}

function isNewerSnapshot(candidate: IndexedTaskCompletionSnapshot, current: IndexedTaskCompletionSnapshot): boolean {
  const candidateTs = snapshotTimestamp(candidate);
  const currentTs = snapshotTimestamp(current);

  if (candidateTs !== currentTs) {
    return candidateTs > currentTs;
  }

  return candidate.sourceDate > current.sourceDate;
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

  if (typeof value.dueTimeStart === 'string' && value.dueTimeStart.length > 0) {
    snapshot.dueTimeStart = value.dueTimeStart;
  }
  if (typeof value.dueTimeEnd === 'string' && value.dueTimeEnd.length > 0) {
    snapshot.dueTimeEnd = value.dueTimeEnd;
  }

  if (typeof value.notesMarkdown === 'string' && value.notesMarkdown.trim().length > 0) {
    snapshot.notesMarkdown = value.notesMarkdown.trim();
  }

  if (Array.isArray(value.projects)) {
    const projects = normalizeProjectList(
      value.projects.filter((project): project is string => typeof project === 'string')
    );
    if (projects.length > 0) {
      snapshot.projects = projects;
    }
  }

  if (value.isDaily === true) {
    snapshot.isDaily = true;
  }

  return snapshot;
}

function toIndexedSnapshot(snapshot: TaskCompletionSnapshot, sourceDate: string): IndexedTaskCompletionSnapshot {
  return {
    ...snapshot,
    sourceDate,
  };
}

function toIndexData(value: unknown): CompletedTaskIndexData {
  if (!isRecord(value)) {
    return { ...DEFAULT_COMPLETED_INDEX, tasks: {} };
  }

  const tasksRecord = isRecord(value.tasks) ? value.tasks : {};
  const tasks: Record<string, IndexedTaskCompletionSnapshot> = {};

  for (const [taskId, rawSnapshot] of Object.entries(tasksRecord)) {
    if (!isRecord(rawSnapshot)) {
      continue;
    }

    const listType = rawSnapshot.listType === 'want-to-do' ? 'want-to-do' : 'have-to-do';
    const sourceDate = typeof rawSnapshot.sourceDate === 'string' ? rawSnapshot.sourceDate : '';
    const completion = toCompletionSnapshot(rawSnapshot, listType, '1970-01-01T00:00:00.000Z');

    if (!completion || sourceDate.length === 0) {
      continue;
    }

    tasks[taskId] = {
      ...completion,
      sourceDate,
    };
  }

  return {
    _comment: typeof value._comment === 'string' ? value._comment : DEFAULT_COMPLETED_INDEX._comment,
    schemaVersion: typeof value.schemaVersion === 'number' ? value.schemaVersion : DEFAULT_COMPLETED_INDEX.schemaVersion,
    tasks,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  };
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

  if (Array.isArray(parsed.completedTasks)) {
    return parsed.completedTasks
      .map((entry) => toCompletionSnapshot(entry, listType, fallbackCompletedAt))
      .filter((entry): entry is TaskCompletionSnapshot => entry !== null);
  }

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

export function readCompletedTaskIndex(): CompletedTaskIndexData {
  if (!fs.existsSync(COMPLETED_INDEX_PATH)) {
    return { ...DEFAULT_COMPLETED_INDEX, tasks: {} };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(COMPLETED_INDEX_PATH, 'utf-8')) as unknown;
    return toIndexData(raw);
  } catch {
    return { ...DEFAULT_COMPLETED_INDEX, tasks: {} };
  }
}

export function writeCompletedTaskIndex(index: CompletedTaskIndexData): void {
  ensureDirExists(COMPLETED_INDEX_PATH);
  const payload: CompletedTaskIndexData = {
    _comment: DEFAULT_COMPLETED_INDEX._comment,
    schemaVersion: 1,
    tasks: index.tasks,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(COMPLETED_INDEX_PATH, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

export function upsertCompletedTaskIndexSnapshot(taskId: string, snapshot: TaskCompletionSnapshot, sourceDate: string): void {
  const index = readCompletedTaskIndex();
  const candidate = toIndexedSnapshot(snapshot, sourceDate);
  const existing = index.tasks[taskId];

  if (!existing || isNewerSnapshot(candidate, existing)) {
    index.tasks[taskId] = candidate;
    writeCompletedTaskIndex(index);
  }
}

export function removeCompletedTaskIndexSnapshot(taskId: string): void {
  const index = readCompletedTaskIndex();
  if (!(taskId in index.tasks)) {
    return;
  }

  delete index.tasks[taskId];
  writeCompletedTaskIndex(index);
}

function parseDailyListFilename(fileName: string): { date: string; listType: ListType } | null {
  const match = fileName.match(/^(\d{4}-\d{2}-\d{2})-(have-to-do|want-to-do)\.json$/);
  if (!match) {
    return null;
  }

  return {
    date: match[1],
    listType: match[2] as ListType,
  };
}

function findLatestCompletedSnapshotForTaskFromDailyLists(taskId: string): IndexedTaskCompletionSnapshot | null {
  if (!fs.existsSync(DAILY_LISTS_DIR)) {
    return null;
  }

  const files = fs.readdirSync(DAILY_LISTS_DIR).sort();
  let best: IndexedTaskCompletionSnapshot | null = null;

  for (const fileName of files) {
    const parsed = parseDailyListFilename(fileName);
    if (!parsed) {
      continue;
    }

    const snapshots = readCompletedTaskSnapshots(parsed.date, parsed.listType);
    const match = snapshots.find((snapshot) => snapshot.id === taskId);
    if (!match) {
      continue;
    }

    const candidate = toIndexedSnapshot(match, parsed.date);
    if (!best || isNewerSnapshot(candidate, best)) {
      best = candidate;
    }
  }

  return best;
}

export function rebuildCompletedTaskIndexFromDailyLists(): CompletedTaskIndexData {
  const index: CompletedTaskIndexData = {
    ...DEFAULT_COMPLETED_INDEX,
    tasks: {},
    updatedAt: new Date().toISOString(),
  };

  if (!fs.existsSync(DAILY_LISTS_DIR)) {
    writeCompletedTaskIndex(index);
    return index;
  }

  const files = fs.readdirSync(DAILY_LISTS_DIR).sort();

  for (const fileName of files) {
    const parsed = parseDailyListFilename(fileName);
    if (!parsed) {
      continue;
    }

    const snapshots = readCompletedTaskSnapshots(parsed.date, parsed.listType);
    for (const snapshot of snapshots) {
      const candidate = toIndexedSnapshot(snapshot, parsed.date);
      const existing = index.tasks[snapshot.id];
      if (!existing || isNewerSnapshot(candidate, existing)) {
        index.tasks[snapshot.id] = candidate;
      }
    }
  }

  writeCompletedTaskIndex(index);
  return index;
}

export function refreshCompletedTaskIndexForTask(taskId: string): Task | null {
  const latest = findLatestCompletedSnapshotForTaskFromDailyLists(taskId);

  if (latest) {
    const index = readCompletedTaskIndex();
    index.tasks[taskId] = latest;
    writeCompletedTaskIndex(index);
    return taskFromCompletionSnapshot(latest);
  }

  removeCompletedTaskIndexSnapshot(taskId);
  return null;
}

export function getCompletedTaskFromIndex(taskId: string): Task | null {
  const index = readCompletedTaskIndex();
  const snapshot = index.tasks[taskId];
  if (!snapshot) {
    return null;
  }
  return taskFromCompletionSnapshot(snapshot);
}

export function ensureCompletedIndexForTask(taskId: string): Task | null {
  const fromIndex = getCompletedTaskFromIndex(taskId);
  if (fromIndex) {
    return fromIndex;
  }

  const rebuilt = rebuildCompletedTaskIndexFromDailyLists();
  const snapshot = rebuilt.tasks[taskId];
  if (!snapshot) {
    return null;
  }

  return taskFromCompletionSnapshot(snapshot);
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

  if (snapshot.projects && snapshot.projects.length > 0) {
    task.projects = normalizeProjectList(snapshot.projects);
  }

  if (snapshot.notesMarkdown && snapshot.notesMarkdown.length > 0) {
    task.notesMarkdown = snapshot.notesMarkdown;
  }

  if (snapshot.dueDate) {
    task.dueDate = snapshot.dueDate;
  }
  if (snapshot.dueTimeStart) {
    task.dueTimeStart = snapshot.dueTimeStart;
  }
  if (snapshot.dueTimeEnd) {
    task.dueTimeEnd = snapshot.dueTimeEnd;
  }

  if (snapshot.isDaily) {
    task.isDaily = true;
  }

  return task;
}
