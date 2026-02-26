import * as fs from 'fs';
import * as path from 'path';
import { Task, ListType, JournalRangeEntry, StagedTaskEntry, JournalHourSlot } from '@/lib/types';

interface DayJournalFile {
  [key: string]: JournalHourSlot | JournalRangeEntry[] | StagedTaskEntry[] | undefined;
  ranges?: JournalRangeEntry[];
  staged?: StagedTaskEntry[];
}

const JOURNAL_DIR = path.join(process.cwd(), 'src/backend/data/journal');
const VALID_HOURS = [
  '7am',
  '8am',
  '9am',
  '10am',
  '11am',
  '12pm',
  '1pm',
  '2pm',
  '3pm',
  '4pm',
  '5pm',
  '6pm',
  '7pm',
  '8pm',
  '9pm',
  '10pm',
  '11pm',
  '12am',
  '1am',
  '2am',
  '3am',
  '4am',
  '5am',
  '6am',
] as const;

type HourLiteral = (typeof VALID_HOURS)[number];

type AutoPlannedTaskEntry = {
  taskId: string;
  listType: ListType;
  entryMode: 'planned';
  autoPlannedFromDueTime: true;
};

type AutoPlannedTaskRangeEntry = {
  start: HourLiteral;
  end: HourLiteral;
  taskId: string;
  listType: ListType;
  entryMode: 'planned';
  autoPlannedFromDueTime: true;
};

function getJournalFilePath(dateIso: string): string {
  return path.join(JOURNAL_DIR, `${dateIso}.json`);
}

function getEmptyJournalTemplate(): DayJournalFile {
  return {
    '7am': '',
    '8am': '',
    '9am': '',
    '10am': '',
    '11am': '',
    '12pm': '',
    '1pm': '',
    '2pm': '',
    '3pm': '',
    '4pm': '',
    '5pm': '',
    '6pm': '',
    '7pm': '',
    '8pm': '',
    '9pm': '',
    '10pm': '',
    '11pm': '',
    '12am': '',
    '1am': '',
    '2am': '',
    '3am': '',
    '4am': '',
    '5am': '',
    '6am': '',
    ranges: [],
    staged: [],
  };
}

function readJournal(dateIso: string): DayJournalFile | null {
  const journalFilePath = getJournalFilePath(dateIso);
  if (!fs.existsSync(journalFilePath)) {
    return null;
  }
  const content = fs.readFileSync(journalFilePath, 'utf-8');
  return JSON.parse(content) as DayJournalFile;
}

function writeJournal(dateIso: string, journal: DayJournalFile): void {
  const journalFilePath = getJournalFilePath(dateIso);
  fs.writeFileSync(journalFilePath, JSON.stringify(journal, null, 2), 'utf-8');
}

function ensureStructuredJournalShape(journal: DayJournalFile): void {
  if (!Array.isArray(journal.ranges)) {
    journal.ranges = [];
  }
  if (!Array.isArray(journal.staged)) {
    journal.staged = [];
  }
}

function hourLabelFrom24Hour(hour24: number): HourLiteral {
  if (hour24 === 0) return '12am';
  if (hour24 < 12) return `${hour24}am` as HourLiteral;
  if (hour24 === 12) return '12pm';
  return `${hour24 - 12}pm` as HourLiteral;
}

function floorHourLabelFromDueTime(value: string): HourLiteral {
  const hour24 = Number.parseInt(value.slice(0, 2), 10);
  return hourLabelFrom24Hour(hour24);
}

function ceilHourLabelFromDueTime(value: string): HourLiteral {
  const hour24 = Number.parseInt(value.slice(0, 2), 10);
  const minute = Number.parseInt(value.slice(3, 5), 10);
  const ceiledHour = minute > 0 ? (hour24 + 1) % 24 : hour24;
  return hourLabelFrom24Hour(ceiledHour);
}

function isTaskEntryLike(value: unknown): value is { taskId: string; listType: ListType; entryMode?: string; autoPlannedFromDueTime?: true } {
  return typeof value === 'object' && value !== null && 'taskId' in value && 'listType' in value;
}

function isAutoPlannedEntryForTask(value: unknown, taskId: string, listType: ListType): value is { taskId: string; listType: ListType } {
  return (
    isTaskEntryLike(value) &&
    value.taskId === taskId &&
    value.listType === listType &&
    value.entryMode === 'planned' &&
    value.autoPlannedFromDueTime === true
  );
}

function removeAutoPlannedEntriesForTask(journal: DayJournalFile, taskId: string, listType: ListType): boolean {
  let changed = false;
  ensureStructuredJournalShape(journal);

  for (const hour of VALID_HOURS) {
    const slot = journal[hour];
    if (!slot || (typeof slot === 'string' && slot.trim() === '')) {
      continue;
    }

    if (Array.isArray(slot)) {
      const filtered = slot.filter((entry) => !isAutoPlannedEntryForTask(entry, taskId, listType));
      if (filtered.length !== slot.length) {
        changed = true;
        if (filtered.length === 0) {
          journal[hour] = '';
        } else if (filtered.length === 1) {
          journal[hour] = filtered[0] as JournalHourSlot;
        } else {
          journal[hour] = filtered as JournalHourSlot;
        }
      }
      continue;
    }

    if (isAutoPlannedEntryForTask(slot, taskId, listType)) {
      journal[hour] = '';
      changed = true;
    }
  }

  const nextRanges = journal.ranges!.filter((range) => !isAutoPlannedEntryForTask(range, taskId, listType));
  if (nextRanges.length !== journal.ranges!.length) {
    journal.ranges = nextRanges;
    changed = true;
  }

  const nextStaged = journal.staged!.filter((entry) => !(entry.taskId === taskId && entry.listType === listType));
  if (nextStaged.length !== journal.staged!.length) {
    journal.staged = nextStaged;
    changed = true;
  }

  return changed;
}

function removeFromStaged(journal: DayJournalFile, taskId: string, listType: ListType): boolean {
  ensureStructuredJournalShape(journal);
  const next = journal.staged!.filter((entry) => !(entry.taskId === taskId && entry.listType === listType));
  if (next.length === journal.staged!.length) {
    return false;
  }
  journal.staged = next;
  return true;
}

function appendAutoPlannedHourEntry(journal: DayJournalFile, hour: HourLiteral, taskId: string, listType: ListType): boolean {
  ensureStructuredJournalShape(journal);

  const newEntry: AutoPlannedTaskEntry = {
    taskId,
    listType,
    entryMode: 'planned',
    autoPlannedFromDueTime: true,
  };

  const currentSlot = journal[hour];
  const entries: unknown[] = !currentSlot || (typeof currentSlot === 'string' && currentSlot.trim() === '')
    ? []
    : Array.isArray(currentSlot)
      ? [...currentSlot]
      : [currentSlot];

  const exists = entries.some((entry) => isAutoPlannedEntryForTask(entry, taskId, listType));
  if (exists) {
    return false;
  }

  if (entries.length === 0) {
    journal[hour] = newEntry;
  } else if (entries.length === 1) {
    journal[hour] = [entries[0] as JournalHourSlot, newEntry] as JournalHourSlot;
  } else {
    journal[hour] = [...entries, newEntry] as JournalHourSlot;
  }

  return true;
}

function appendAutoPlannedRangeEntry(
  journal: DayJournalFile,
  start: HourLiteral,
  end: HourLiteral,
  taskId: string,
  listType: ListType
): boolean {
  ensureStructuredJournalShape(journal);

  const duplicate = journal.ranges!.some((range) =>
    isAutoPlannedEntryForTask(range, taskId, listType) &&
    'start' in range &&
    'end' in range &&
    range.start === start &&
    range.end === end
  );
  if (duplicate) {
    return false;
  }

  const newRange: AutoPlannedTaskRangeEntry = {
    start,
    end,
    taskId,
    listType,
    entryMode: 'planned',
    autoPlannedFromDueTime: true,
  };
  journal.ranges!.push(newRange as JournalRangeEntry);
  return true;
}

function upsertAutoPlanForTask(journal: DayJournalFile, listType: ListType, task: Task): boolean {
  if (!task.dueTimeStart) {
    return false;
  }

  const start = floorHourLabelFromDueTime(task.dueTimeStart);
  const end = task.dueTimeEnd ? ceilHourLabelFromDueTime(task.dueTimeEnd) : undefined;
  const startIndex = VALID_HOURS.indexOf(start);
  const endIndex = end ? VALID_HOURS.indexOf(end) : -1;

  if (end && startIndex >= 0 && endIndex > startIndex) {
    return appendAutoPlannedRangeEntry(journal, start, end, task.id, listType);
  }

  return appendAutoPlannedHourEntry(journal, start, task.id, listType);
}

export function ensureDailyJournalExists(dateIso: string): void {
  const journalFilePath = getJournalFilePath(dateIso);

  if (!fs.existsSync(journalFilePath)) {
    if (!fs.existsSync(JOURNAL_DIR)) {
      fs.mkdirSync(JOURNAL_DIR, { recursive: true });
    }

    const template = getEmptyJournalTemplate();
    fs.writeFileSync(journalFilePath, JSON.stringify(template, null, 2), 'utf-8');
  }
}

export function addTaskToStaged(dateIso: string, taskId: string, listType: ListType): void {
  const journalFilePath = getJournalFilePath(dateIso);

  if (!fs.existsSync(journalFilePath)) {
    return;
  }

  const content = fs.readFileSync(journalFilePath, 'utf-8');
  const journal: DayJournalFile = JSON.parse(content);

  ensureStructuredJournalShape(journal);

  const taskAlreadyExists = journal.staged!.some((entry) => entry.taskId === taskId && entry.listType === listType);

  if (!taskAlreadyExists) {
    journal.staged!.push({
      taskId,
      listType,
    });
    fs.writeFileSync(journalFilePath, JSON.stringify(journal, null, 2), 'utf-8');
  }
}

/**
 * Handle due-date setup and due-time auto-planning behavior.
 * - dueDate + dueTimeStart => auto-plan in journal and keep out of staged
 * - dueDate without dueTimeStart => stage task for the day
 * - update path uses previousTask to best-effort remove/move auto-planned entries
 */
export function handleDueDateSetup(
  dateIso: string,
  listType: ListType,
  task: Task,
  previousTask?: Task
): void {
  const previousDueDate = previousTask?.dueDate;
  const previousHadDueTime = Boolean(previousTask?.dueDate && previousTask?.dueTimeStart);

  if (previousDueDate && previousDueDate !== dateIso) {
    const previousJournal = readJournal(previousDueDate);
    if (previousJournal && removeAutoPlannedEntriesForTask(previousJournal, task.id, listType)) {
      writeJournal(previousDueDate, previousJournal);
    }
  }

  if (previousHadDueTime && previousDueDate === dateIso) {
    ensureDailyJournalExists(dateIso);
    const currentJournal = readJournal(dateIso);
    if (currentJournal && removeAutoPlannedEntriesForTask(currentJournal, task.id, listType)) {
      writeJournal(dateIso, currentJournal);
    }
  }

  if (!task.dueDate) {
    if (previousDueDate) {
      const previousJournal = readJournal(previousDueDate);
      if (previousJournal && removeAutoPlannedEntriesForTask(previousJournal, task.id, listType)) {
        writeJournal(previousDueDate, previousJournal);
      }
    }
    return;
  }

  ensureDailyJournalExists(task.dueDate);
  const journal = readJournal(task.dueDate);
  if (!journal) {
    return;
  }

  let changed = false;
  if (task.dueTimeStart) {
    if (upsertAutoPlanForTask(journal, listType, task)) {
      changed = true;
    }
    if (removeFromStaged(journal, task.id, listType)) {
      changed = true;
    }
  } else {
    ensureStructuredJournalShape(journal);
    const alreadyStaged = journal.staged!.some((entry) => entry.taskId === task.id && entry.listType === listType);
    if (!alreadyStaged) {
      journal.staged!.push({ taskId: task.id, listType });
      changed = true;
    }
  }

  if (changed) {
    writeJournal(task.dueDate, journal);
  }
}
