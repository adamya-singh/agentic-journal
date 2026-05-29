import * as fs from 'fs';
import * as path from 'path';
import { ListType, Task } from '@/lib/types';
import {
  readCompletedTaskSnapshots,
  readGeneralTasks,
  readLegacyDailyTasks,
  readTodayOverrides,
  getDailyTasksFilePath,
} from '../today/today-store-utils';
import { computeTodayTasks } from '../today/today-compute-utils';
import { ensureDailyJournalExists } from '../due-date-utils';

interface CurrentQueueData {
  _comment: string;
  schemaVersion: 1;
  taskIds: string[];
}

interface CurrentMetadata {
  _comment: string;
  schemaVersion: 1;
  initializedDate: string;
  lastMaterializedDate: string;
}

export interface DailyCurrentSnapshot {
  _comment: string;
  schemaVersion: 3;
  date: string;
  listType: ListType;
  selectedTasks: Task[];
  automaticTasks: Task[];
}

const TASKS_DIR = path.join(process.cwd(), 'src/backend/data/tasks');
const CURRENT_DIR = path.join(TASKS_DIR, 'current');
const CURRENT_METADATA_PATH = path.join(CURRENT_DIR, 'metadata.json');
const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const JOURNAL_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function currentDateISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(year, month - 1, day + 1);
  const nextMonth = String(next.getMonth() + 1).padStart(2, '0');
  const nextDay = String(next.getDate()).padStart(2, '0');
  return `${next.getFullYear()}-${nextMonth}-${nextDay}`;
}

function getCurrentQueuePath(listType: ListType): string {
  return path.join(CURRENT_DIR, `${listType}.json`);
}

function cloneTask(task: Task): Task {
  return JSON.parse(JSON.stringify(task)) as Task;
}

function readMetadata(): CurrentMetadata | null {
  if (!fs.existsSync(CURRENT_METADATA_PATH)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(CURRENT_METADATA_PATH, 'utf-8')) as unknown;
    if (
      !isRecord(parsed) ||
      typeof parsed.initializedDate !== 'string' ||
      typeof parsed.lastMaterializedDate !== 'string'
    ) {
      return null;
    }
    return {
      _comment: 'Running Current queues and dated full-snapshot rollover metadata',
      schemaVersion: 1,
      initializedDate: parsed.initializedDate,
      lastMaterializedDate: parsed.lastMaterializedDate,
    };
  } catch {
    return null;
  }
}

function writeMetadata(metadata: CurrentMetadata): void {
  ensureDir(CURRENT_METADATA_PATH);
  fs.writeFileSync(CURRENT_METADATA_PATH, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
}

export function readCurrentTaskIds(listType: ListType): string[] {
  const filePath = getCurrentQueuePath(listType);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!isRecord(parsed) || !Array.isArray(parsed.taskIds)) {
      return [];
    }
    return parsed.taskIds.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

function writeCurrentTaskIds(listType: ListType, taskIds: string[]): void {
  const filePath = getCurrentQueuePath(listType);
  ensureDir(filePath);
  const uniqueIds = Array.from(new Set(taskIds));
  const data: CurrentQueueData = {
    _comment: 'Running Current queue - first task ID is highest ranked priority',
    schemaVersion: 1,
    taskIds: uniqueIds,
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

function toTask(value: unknown): Task | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.text !== 'string') {
    return null;
  }
  return value as unknown as Task;
}

export function readDailyCurrentSnapshot(date: string, listType: ListType): DailyCurrentSnapshot | null {
  const filePath = getDailyTasksFilePath(date, listType);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as unknown;
    if (!isRecord(parsed) || parsed.schemaVersion !== 3) {
      return null;
    }
    const rawSelectedTasks = Array.isArray(parsed.selectedTasks)
      ? parsed.selectedTasks
      : Array.isArray(parsed.rankedTasks)
        ? parsed.rankedTasks
        : [];
    const selectedTasks = rawSelectedTasks
      .map(toTask)
      .filter((task): task is Task => task !== null);
    const automaticTasks = Array.isArray(parsed.automaticTasks)
      ? parsed.automaticTasks.map(toTask).filter((task): task is Task => task !== null)
      : [];
    return {
      _comment: 'Daily Today snapshot - selected Current tasks plus automatic due/daily attention',
      schemaVersion: 3,
      date,
      listType,
      selectedTasks,
      automaticTasks,
    };
  } catch {
    return null;
  }
}

function writeDailyCurrentSnapshot(snapshot: DailyCurrentSnapshot): void {
  const filePath = getDailyTasksFilePath(snapshot.date, snapshot.listType);
  ensureDir(filePath);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

function collectScheduledTaskIds(journal: Record<string, unknown>): Set<string> {
  const scheduled = new Set<string>();
  const addIfTaskEntry = (entry: unknown) => {
    if (isRecord(entry) && typeof entry.taskId === 'string') {
      scheduled.add(entry.taskId);
    }
  };

  for (const hour of JOURNAL_HOURS) {
    const slot = journal[hour];
    if (Array.isArray(slot)) {
      slot.forEach(addIfTaskEntry);
    } else {
      addIfTaskEntry(slot);
    }
  }

  if (Array.isArray(journal.ranges)) {
    journal.ranges.forEach(addIfTaskEntry);
  }

  return scheduled;
}

function syncStagedJournalFromSnapshots(date: string): void {
  const journalPath = path.join(JOURNAL_DIR, `${date}.json`);
  ensureDailyJournalExists(date);
  if (!fs.existsSync(journalPath)) {
    return;
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as Record<string, unknown> & { staged?: { taskId: string; listType: ListType }[] };
  const scheduledTaskIds = collectScheduledTaskIds(journal);
  const existingByKey = new Map<string, { taskId: string; listType: ListType }>();
  for (const entry of Array.isArray(journal.staged) ? journal.staged : []) {
    if (!scheduledTaskIds.has(entry.taskId)) {
      existingByKey.set(`${entry.taskId}:${entry.listType}`, entry);
    }
  }

  const staged: { taskId: string; listType: ListType }[] = [];
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    const snapshot = readDailyCurrentSnapshot(date, listType);
    if (!snapshot) continue;
    for (const task of [...snapshot.selectedTasks, ...snapshot.automaticTasks]) {
      if (!task.completed && !scheduledTaskIds.has(task.id)) {
        const key = `${task.id}:${listType}`;
        staged.push(existingByKey.get(key) ?? { taskId: task.id, listType });
      }
    }
  }
  journal.staged = staged;
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2), 'utf-8');
}

function completionMap(date: string, listType: ListType): Map<string, Task> {
  return new Map(
    readCompletedTaskSnapshots(date, listType).map((snapshot) => [
      snapshot.id,
      { ...snapshot, completed: true },
    ])
  );
}

function withCompletion(task: Task, completions: Map<string, Task>): Task {
  const completed = completions.get(task.id);
  return completed ? cloneTask(completed) : cloneTask(task);
}

function sortSelectedIdsByCurrentOrder(listType: ListType, selectedIds: string[]): string[] {
  const currentIds = readCurrentTaskIds(listType);
  const selected = new Set(selectedIds);
  const ordered = currentIds.filter((id) => selected.has(id));
  for (const id of selectedIds) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

function buildSnapshot(date: string, listType: ListType, selectedIdsOverride?: string[]): DailyCurrentSnapshot {
  const previous = readDailyCurrentSnapshot(date, listType);
  const generalTasks = readGeneralTasks(listType).tasks;
  const byId = new Map(generalTasks.map((task) => [task.id, task]));
  const completions = completionMap(date, listType);
  const currentIds = new Set(readCurrentTaskIds(listType));
  const selectedIds = sortSelectedIdsByCurrentOrder(
    listType,
    selectedIdsOverride ?? previous?.selectedTasks.map((task) => task.id) ?? []
  );
  const selectedTasks: Task[] = [];
  const seen = new Set<string>();

  for (const taskId of selectedIds) {
    const previousSelected = previous?.selectedTasks.find((task) => task.id === taskId);
    const completed = completions.get(taskId) ?? (previousSelected?.completed ? previousSelected : null);
    const liveTask = byId.get(taskId) ?? null;
    if (!currentIds.has(taskId) && !completed && !liveTask) continue;
    const source = liveTask ?? previousSelected ?? completed;
    if (!source) continue;
    selectedTasks.push(withCompletion(source, completions));
    seen.add(taskId);
  }

  const automaticTasks: Task[] = [];
  for (const task of generalTasks) {
    if (seen.has(task.id) || (task.dueDate !== date && task.isDaily !== true)) {
      continue;
    }
    automaticTasks.push(withCompletion(task, completions));
    seen.add(task.id);
  }

  // Completion removes normal tasks from open stores; keep their dated historical copy.
  for (const completed of completions.values()) {
    if (seen.has(completed.id)) continue;
    const oldSelected = previous?.selectedTasks.find((task) => task.id === completed.id);
    if (oldSelected) {
      selectedTasks.push(cloneTask(completed));
    } else {
      automaticTasks.push(cloneTask(completed));
    }
    seen.add(completed.id);
  }

  return {
    _comment: 'Daily Today snapshot - selected Current tasks plus automatic due/daily attention',
    schemaVersion: 3,
    date,
    listType,
    selectedTasks,
    automaticTasks,
  };
}

function seedCurrentQueues(date: string): Record<ListType, string[]> {
  const seededByList: Record<ListType, string[]> = {
    'have-to-do': [],
    'want-to-do': [],
  };
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    const generalTasks = readGeneralTasks(listType).tasks;
    const seeded = computeTodayTasks({
      date,
      generalTasks,
      overrides: readTodayOverrides(date, listType),
      completedSnapshots: readCompletedTaskSnapshots(date, listType),
    })
      .filter((task) => task.completed !== true)
      .map((task) => task.id);
    writeCurrentTaskIds(listType, seeded);
    seededByList[listType] = seeded;
  }
  return seededByList;
}

export function ensureCurrentSystemThroughToday(): CurrentMetadata {
  const today = currentDateISO();
  let metadata = readMetadata();
  let initialSelectedByList: Record<ListType, string[]> | null = null;
  if (!metadata) {
    initialSelectedByList = seedCurrentQueues(today);
    metadata = {
      _comment: 'Running Current queues and dated full-snapshot rollover metadata',
      schemaVersion: 1,
      initializedDate: today,
      lastMaterializedDate: '',
    };
  }

  let date = metadata.lastMaterializedDate ? nextDate(metadata.lastMaterializedDate) : metadata.initializedDate;
  while (date <= today) {
    for (const listType of ['have-to-do', 'want-to-do'] as const) {
      const selectedIds = initialSelectedByList && date === metadata.initializedDate
        ? initialSelectedByList[listType]
        : undefined;
      writeDailyCurrentSnapshot(buildSnapshot(date, listType, selectedIds));
    }
    syncStagedJournalFromSnapshots(date);
    metadata.lastMaterializedDate = date;
    date = nextDate(date);
  }
  writeMetadata(metadata);
  return metadata;
}

export function refreshActiveDailySnapshots(): void {
  ensureCurrentSystemThroughToday();
  const today = currentDateISO();
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    writeDailyCurrentSnapshot(buildSnapshot(today, listType));
  }
}

export function getEffectiveDailySnapshot(date: string, listType: ListType): DailyCurrentSnapshot {
  const today = currentDateISO();
  if (date <= today) {
    ensureCurrentSystemThroughToday();
  } else {
    return buildSnapshot(date, listType);
  }
  const full = readDailyCurrentSnapshot(date, listType);
  if (full) return full;

  const legacyTasks = readLegacyDailyTasks(date, listType);
  return {
    _comment: 'Legacy daily task snapshot',
    schemaVersion: 3,
    date,
    listType,
    selectedTasks: legacyTasks,
    automaticTasks: [],
  };
}

export function findTaskInDailySnapshot(date: string, listType: ListType, taskId: string): Task | null {
  const snapshot = getEffectiveDailySnapshot(date, listType);
  return [...snapshot.selectedTasks, ...snapshot.automaticTasks].find((task) => task.id === taskId) ?? null;
}

export function getCurrentTasks(listType: ListType): Task[] {
  ensureCurrentSystemThroughToday();
  const byId = new Map(readGeneralTasks(listType).tasks.map((task) => [task.id, task]));
  return readCurrentTaskIds(listType)
    .map((taskId) => byId.get(taskId))
    .filter((task): task is Task => task !== undefined)
    .map(cloneTask);
}

export function addCurrentTaskToToday(date: string, listType: ListType, taskId: string): boolean {
  if (date <= currentDateISO()) {
    ensureCurrentSystemThroughToday();
  }
  if (!readCurrentTaskIds(listType).includes(taskId)) {
    return false;
  }
  if (!readGeneralTasks(listType).tasks.some((task) => task.id === taskId)) {
    return false;
  }
  const snapshot = readDailyCurrentSnapshot(date, listType) ?? buildSnapshot(date, listType, []);
  const selectedIds = snapshot.selectedTasks.map((task) => task.id);
  if (!selectedIds.includes(taskId)) {
    selectedIds.push(taskId);
  }
  writeDailyCurrentSnapshot(buildSnapshot(date, listType, selectedIds));
  syncStagedJournalFromSnapshots(date);
  return true;
}

export function removeTaskFromTodaySelection(date: string, listType: ListType, taskId: string): boolean {
  if (date <= currentDateISO()) {
    ensureCurrentSystemThroughToday();
  }
  const snapshot = readDailyCurrentSnapshot(date, listType) ?? buildSnapshot(date, listType, []);
  const selectedIds = snapshot.selectedTasks.map((task) => task.id);
  const nextSelectedIds = selectedIds.filter((id) => id !== taskId);
  if (nextSelectedIds.length === selectedIds.length) {
    return false;
  }
  writeDailyCurrentSnapshot(buildSnapshot(date, listType, nextSelectedIds));
  syncStagedJournalFromSnapshots(date);
  return true;
}

export function addTaskToCurrent(listType: ListType, taskId: string, position?: number): boolean {
  ensureCurrentSystemThroughToday();
  if (!readGeneralTasks(listType).tasks.some((task) => task.id === taskId)) {
    return false;
  }
  const current = readCurrentTaskIds(listType).filter((id) => id !== taskId);
  const insertion = typeof position === 'number' ? Math.max(0, Math.min(position, current.length)) : current.length;
  current.splice(insertion, 0, taskId);
  writeCurrentTaskIds(listType, current);
  refreshActiveDailySnapshots();
  return true;
}

export function removeTaskFromCurrent(listType: ListType, taskId: string): boolean {
  ensureCurrentSystemThroughToday();
  const current = readCurrentTaskIds(listType);
  const next = current.filter((id) => id !== taskId);
  if (next.length === current.length) return false;
  writeCurrentTaskIds(listType, next);
  const today = currentDateISO();
  if (!completionMap(today, listType).has(taskId)) {
    const snapshot = readDailyCurrentSnapshot(today, listType);
    if (snapshot) {
      const selectedIds = snapshot.selectedTasks.map((task) => task.id).filter((id) => id !== taskId);
      writeDailyCurrentSnapshot(buildSnapshot(today, listType, selectedIds));
      syncStagedJournalFromSnapshots(today);
    }
  }
  refreshActiveDailySnapshots();
  return true;
}

export function removeTaskIdsFromCurrent(listType: ListType, taskIds: string[]): boolean {
  ensureCurrentSystemThroughToday();
  const removed = new Set(taskIds);
  const current = readCurrentTaskIds(listType);
  const next = current.filter((id) => !removed.has(id));
  if (next.length === current.length) return false;
  writeCurrentTaskIds(listType, next);
  const today = currentDateISO();
  const completedToday = completionMap(today, listType);
  const snapshot = readDailyCurrentSnapshot(today, listType);
  if (snapshot) {
    const selectedIds = snapshot.selectedTasks
      .map((task) => task.id)
      .filter((id) => !removed.has(id) || completedToday.has(id));
    writeDailyCurrentSnapshot(buildSnapshot(today, listType, selectedIds));
    syncStagedJournalFromSnapshots(today);
  }
  refreshActiveDailySnapshots();
  return true;
}

export function reorderCurrentTask(listType: ListType, taskId: string, position: number): boolean {
  return addTaskToCurrent(listType, taskId, position);
}

export function writeTaskCompletionToDailySnapshot(
  date: string,
  listType: ListType,
  completedTask: Task,
  completed: boolean
): void {
  if (date <= currentDateISO()) {
    ensureCurrentSystemThroughToday();
  }
  const snapshot = readDailyCurrentSnapshot(date, listType) ?? buildSnapshot(date, listType);
  const update = (tasks: Task[]): boolean => {
    const index = tasks.findIndex((task) => task.id === completedTask.id);
    if (index === -1) return false;
    tasks[index] = completed ? cloneTask(completedTask) : { ...cloneTask(completedTask), completed: false };
    if (!completed) delete tasks[index].completedAt;
    return true;
  };
  if (!update(snapshot.selectedTasks) && !update(snapshot.automaticTasks)) {
    snapshot.automaticTasks.push(completed ? cloneTask(completedTask) : { ...cloneTask(completedTask), completed: false });
  }
  writeDailyCurrentSnapshot(snapshot);
}
