import {
  DayJournal,
  JournalEntry,
  JournalRangeEntry,
  PlanLogRef,
  PlanStatus,
  TaskJournalEntry,
  TaskJournalRangeEntry,
  TextJournalEntry,
  TextJournalRangeEntry,
  isJournalEntryArray,
  isTaskJournalEntry,
  isTaskJournalRangeEntry,
  isTextJournalEntry,
  isTextJournalRangeEntry,
} from '@/lib/types';

const VALID_HOURS = [
  '7am', '8am', '9am', '10am', '11am', '12pm',
  '1pm', '2pm', '3pm', '4pm', '5pm', '6pm',
  '7pm', '8pm', '9pm', '10pm', '11pm', '12am',
  '1am', '2am', '3am', '4am', '5am', '6am',
] as const;

export type DayJournalWithRanges = DayJournal & {
  ranges?: JournalRangeEntry[];
};

type TaskHourRef = {
  kind: 'hour';
  hour: string;
  hourIndex: number;
  entry: TaskJournalEntry;
};

type TaskRangeRef = {
  kind: 'range';
  rangeIndex: number;
  startIndex: number;
  entry: TaskJournalRangeEntry;
};

type TaskRef = TaskHourRef | TaskRangeRef;

type PlannableHourEntry = TaskJournalEntry | TextJournalEntry;
type PlannableRangeEntry = TaskJournalRangeEntry | TextJournalRangeEntry;
type PlannableEntry = PlannableHourEntry | PlannableRangeEntry;

type PlanHourRef = {
  kind: 'hour';
  hour: string;
  hourIndex: number;
  entryIndex: number | null;
  entryType: 'task' | 'text';
  entry: PlannableHourEntry;
};

type PlanRangeRef = {
  kind: 'range';
  rangeIndex: number;
  startIndex: number;
  entryType: 'task' | 'text';
  entry: PlannableRangeEntry;
};

type PlanRef = PlanHourRef | PlanRangeRef;

export type TextPlanSource =
  | { kind: 'hour'; hour: string }
  | { kind: 'range'; start: string; end: string };

export type PlanAction = 'in-progress' | 'complete';

export type PlanActionResult =
  | {
      status: 'applied';
      loggedCreated: boolean;
      entryType: 'task' | 'text';
      planStatus: 'completed';
      task?: {
        taskId: string;
        listType: TaskJournalEntry['listType'];
      };
    }
  | {
      status: 'not-found';
      loggedCreated: false;
    };

export type CompleteTextPlanResult =
  | { status: 'completed'; loggedCreated: boolean }
  | { status: 'not-found' | 'already-completed' | 'not-completable'; loggedCreated: false };

function getPlanStatus(entry: { entryMode: string; planStatus?: PlanStatus }): PlanStatus | null {
  if (entry.entryMode !== 'planned') {
    return null;
  }
  return entry.planStatus ?? 'active';
}

function isActivePlannedEntry(entry: PlannableEntry): boolean {
  return getPlanStatus(entry) === 'active';
}

function hourTo24(hour: string): number {
  const match = hour.match(/^(\d+)(am|pm)$/);
  if (!match) return -1;
  const raw = Number.parseInt(match[1], 10);
  const ampm = match[2];
  if (raw < 1 || raw > 12) return -1;
  if (ampm === 'am') {
    return raw % 12;
  }
  return raw % 12 + 12;
}

function toDateAtHour(dateIso: string, hour: string): Date {
  const [year, month, day] = dateIso.split('-').map((value) => Number.parseInt(value, 10));
  const hours24 = hourTo24(hour);
  return new Date(year, month - 1, day, Math.max(0, hours24), 0, 0, 0);
}

function getHourIndex(hour: string): number {
  return VALID_HOURS.indexOf(hour as (typeof VALID_HOURS)[number]);
}

function ensurePlannedEntryDefaults<T extends PlannableEntry>(
  entry: T,
  nowIso: string = new Date().toISOString()
): T {
  if (entry.entryMode !== 'planned') {
    return entry;
  }

  const needsDefaults =
    !entry.planId ||
    !entry.planStatus ||
    !entry.planCreatedAt ||
    !entry.planUpdatedAt;

  if (!needsDefaults) {
    return entry;
  }

  return {
    ...entry,
    planId: entry.planId ?? crypto.randomUUID(),
    planStatus: entry.planStatus ?? 'active',
    planCreatedAt: entry.planCreatedAt ?? nowIso,
    planUpdatedAt: entry.planUpdatedAt ?? nowIso,
  };
}

function getAllTaskRefs(journal: DayJournalWithRanges): TaskRef[] {
  const refs: TaskRef[] = [];

  for (const hour of VALID_HOURS) {
    const hourIndex = getHourIndex(hour);
    const slot = journal[hour];
    if (!slot) continue;

    const entries = isJournalEntryArray(slot) ? slot : [slot];
    for (const entry of entries) {
      if (isTaskJournalEntry(entry)) {
        refs.push({ kind: 'hour', hour, hourIndex, entry });
      }
    }
  }

  const ranges = journal.ranges ?? [];
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex];
    if (!isTaskJournalRangeEntry(range)) {
      continue;
    }
    refs.push({
      kind: 'range',
      rangeIndex,
      startIndex: getHourIndex(range.start),
      entry: range,
    });
  }

  return refs;
}

function getAllPlannedRefs(journal: DayJournalWithRanges): PlanRef[] {
  const refs: PlanRef[] = [];

  for (const hour of VALID_HOURS) {
    const hourIndex = getHourIndex(hour);
    const slot = journal[hour];
    if (!slot) continue;

    if (isJournalEntryArray(slot)) {
      for (let entryIndex = 0; entryIndex < slot.length; entryIndex += 1) {
        const entry = slot[entryIndex];
        if (!entry || typeof entry !== 'object' || !('entryMode' in entry) || entry.entryMode !== 'planned') {
          continue;
        }
        if (isTaskJournalEntry(entry)) {
          refs.push({ kind: 'hour', hour, hourIndex, entryIndex, entryType: 'task', entry });
        } else if (isTextJournalEntry(entry)) {
          refs.push({ kind: 'hour', hour, hourIndex, entryIndex, entryType: 'text', entry });
        }
      }
      continue;
    }

    if (!slot || typeof slot !== 'object' || !('entryMode' in slot) || slot.entryMode !== 'planned') {
      continue;
    }
    if (isTaskJournalEntry(slot)) {
      refs.push({ kind: 'hour', hour, hourIndex, entryIndex: null, entryType: 'task', entry: slot });
    } else if (isTextJournalEntry(slot)) {
      refs.push({ kind: 'hour', hour, hourIndex, entryIndex: null, entryType: 'text', entry: slot });
    }
  }

  const ranges = journal.ranges ?? [];
  for (let rangeIndex = 0; rangeIndex < ranges.length; rangeIndex += 1) {
    const range = ranges[rangeIndex];
    if (!range || range.entryMode !== 'planned') {
      continue;
    }
    if (isTaskJournalRangeEntry(range)) {
      refs.push({
        kind: 'range',
        rangeIndex,
        startIndex: getHourIndex(range.start),
        entryType: 'task',
        entry: range,
      });
    } else if (isTextJournalRangeEntry(range)) {
      refs.push({
        kind: 'range',
        rangeIndex,
        startIndex: getHourIndex(range.start),
        entryType: 'text',
        entry: range,
      });
    }
  }

  return refs;
}

function hasAnyLoggedTaskForDate(journal: DayJournalWithRanges, taskId: string): boolean {
  for (const ref of getAllTaskRefs(journal)) {
    if (ref.entry.taskId === taskId && ref.entry.entryMode === 'logged') {
      return true;
    }
  }
  return false;
}

function computeDeadline(dateIso: string, ref: PlanRef): Date | null {
  if (ref.kind === 'hour') {
    const base = toDateAtHour(dateIso, ref.hour);
    base.setHours(base.getHours() + 1); // grace window
    return base;
  }

  const end = ref.entry.end;
  if (!end) {
    return null;
  }
  const base = toDateAtHour(dateIso, end);
  base.setHours(base.getHours() + 1); // grace window
  return base;
}

function updateHourEntry(
  journal: DayJournalWithRanges,
  hour: string,
  predicate: (entry: JournalEntry) => boolean,
  updater: (entry: JournalEntry) => JournalEntry
): boolean {
  const slot = journal[hour];
  if (!slot) return false;

  let changed = false;
  if (isJournalEntryArray(slot)) {
    const nextEntries: JournalEntry[] = slot.map((entry) => {
      if (!predicate(entry)) {
        return entry;
      }
      changed = true;
      return updater(entry);
    });
    if (changed) {
      journal[hour] = nextEntries.length === 1 ? nextEntries[0] : nextEntries;
    }
    return changed;
  }

  if (predicate(slot)) {
    journal[hour] = updater(slot);
    return true;
  }

  return false;
}

function setPlanRefEntry(journal: DayJournalWithRanges, ref: PlanRef, next: PlannableEntry): boolean {
  if (ref.kind === 'hour') {
    if (ref.entryIndex === null) {
      journal[ref.hour] = next;
      return true;
    }

    const slot = journal[ref.hour];
    if (!isJournalEntryArray(slot) || ref.entryIndex < 0 || ref.entryIndex >= slot.length) {
      return false;
    }

    const nextEntries = [...slot];
    nextEntries[ref.entryIndex] = next;
    journal[ref.hour] = nextEntries.length === 1 ? nextEntries[0] : nextEntries;
    return true;
  }

  const ranges = journal.ranges ?? [];
  const current = ranges[ref.rangeIndex];
  if (!current || (!isTaskJournalRangeEntry(current) && !isTextJournalRangeEntry(current))) {
    return false;
  }

  ranges[ref.rangeIndex] = next as PlannableRangeEntry;
  journal.ranges = ranges;
  return true;
}

function appendEntryToHour(journal: DayJournalWithRanges, hour: string, entry: JournalEntry): void {
  const slot = journal[hour];
  if (!slot || (typeof slot === 'string' && slot.trim() === '')) {
    journal[hour] = entry;
    return;
  }

  if (isJournalEntryArray(slot)) {
    journal[hour] = [...slot, entry];
    return;
  }

  journal[hour] = [slot, entry];
}

function samePlanLogRef(a: PlanLogRef | undefined, b: PlanLogRef): boolean {
  if (!a || a.date !== b.date) return false;
  if (a.hour || b.hour) {
    return a.hour === b.hour;
  }

  const aRange = a.range;
  const bRange = b.range;
  if (!aRange || !bRange) return false;
  return aRange.start === bRange.start && aRange.end === bRange.end;
}

export function normalizePlannedEntry<T extends PlannableEntry>(
  entry: T,
  nowIso: string = new Date().toISOString()
): T {
  return ensurePlannedEntryDefaults(entry, nowIso);
}

export function normalizePlannedTaskEntry<T extends TaskJournalEntry | TaskJournalRangeEntry>(
  entry: T,
  nowIso: string = new Date().toISOString()
): T {
  return ensurePlannedEntryDefaults(entry, nowIso);
}

export function markMissedPlansForDate(
  journal: DayJournalWithRanges,
  dateIso: string,
  now: Date = new Date()
): boolean {
  let changed = false;
  const nowIso = now.toISOString();
  const refs = getAllPlannedRefs(journal);

  for (const ref of refs) {
    let currentEntry = normalizePlannedEntry(ref.entry, nowIso);
    if (currentEntry !== ref.entry) {
      changed = setPlanRefEntry(journal, ref, currentEntry) || changed;
    }

    if (!isActivePlannedEntry(currentEntry)) {
      continue;
    }
    if (ref.entryType === 'task' && isTaskJournalEntry(currentEntry) && hasAnyLoggedTaskForDate(journal, currentEntry.taskId)) {
      continue;
    }

    const deadline = computeDeadline(dateIso, ref);
    if (!deadline || now <= deadline) {
      continue;
    }

    currentEntry = {
      ...currentEntry,
      planStatus: 'missed',
      missedAt: nowIso,
      planUpdatedAt: nowIso,
    };

    changed = setPlanRefEntry(journal, ref, currentEntry) || changed;
  }

  return changed;
}

export function linkLoggedEntryToEarliestActivePlan(
  journal: DayJournalWithRanges,
  dateIso: string,
  taskId: string,
  logRef: PlanLogRef,
  nowIso: string = new Date().toISOString()
): boolean {
  const activeRefs = getAllTaskRefs(journal)
    .filter((ref) => ref.entry.taskId === taskId && isActivePlannedEntry(ref.entry));

  if (activeRefs.length === 0) {
    return false;
  }

  activeRefs.sort((a, b) => {
    const aStart = a.kind === 'hour' ? a.hourIndex : a.startIndex;
    const bStart = b.kind === 'hour' ? b.hourIndex : b.startIndex;
    if (aStart !== bStart) return aStart - bStart;
    const aCreated = a.entry.planCreatedAt ? Date.parse(a.entry.planCreatedAt) : 0;
    const bCreated = b.entry.planCreatedAt ? Date.parse(b.entry.planCreatedAt) : 0;
    return aCreated - bCreated;
  });

  const target = activeRefs[0];
  if (target.kind === 'hour') {
    const next = normalizePlannedTaskEntry(target.entry, nowIso);
    next.planStatus = 'completed';
    next.completedByLogRef = { ...logRef, date: dateIso };
    next.planUpdatedAt = nowIso;
    return updateHourEntry(
      journal,
      target.hour,
      (entry) => isTaskJournalEntry(entry) && entry.taskId === target.entry.taskId && (entry.planId ?? '') === (target.entry.planId ?? ''),
      () => next
    );
  }

  const ranges = journal.ranges ?? [];
  const current = ranges[target.rangeIndex];
  if (!current || !isTaskJournalRangeEntry(current)) {
    return false;
  }
  const next = normalizePlannedTaskEntry(target.entry, nowIso);
  next.planStatus = 'completed';
  next.completedByLogRef = { ...logRef, date: dateIso };
  next.planUpdatedAt = nowIso;
  ranges[target.rangeIndex] = next;
  journal.ranges = ranges;
  return true;
}

export function completeTextPlanInJournal(
  journal: DayJournalWithRanges,
  dateIso: string,
  planId: string,
  source: TextPlanSource,
  nowIso: string = new Date().toISOString()
): CompleteTextPlanResult {
  const target = getAllPlannedRefs(journal).find((ref) => {
    if (ref.entryType !== 'text' || ref.entry.planId !== planId) {
      return false;
    }

    if (source.kind === 'hour') {
      return ref.kind === 'hour' && ref.hour === source.hour;
    }

    return ref.kind === 'range' && ref.entry.start === source.start && ref.entry.end === source.end;
  });

  if (!target) {
    return { status: 'not-found', loggedCreated: false };
  }

  const targetEntry = target.entry;
  const normalized = normalizePlannedEntry(targetEntry, nowIso);
  let normalizedHour: TextJournalEntry | null = null;
  let normalizedRange: TextJournalRangeEntry | null = null;
  if (target.kind === 'hour') {
    if (!isTextJournalEntry(normalized)) {
      return { status: 'not-found', loggedCreated: false };
    }
    normalizedHour = normalized;
  } else {
    if (!('start' in normalized) || !('end' in normalized) || !isTextJournalRangeEntry(normalized as JournalRangeEntry)) {
      return { status: 'not-found', loggedCreated: false };
    }
    normalizedRange = normalized as TextJournalRangeEntry;
  }

  const status = normalized.planStatus ?? 'active';
  if (status === 'completed') {
    return { status: 'already-completed', loggedCreated: false };
  }
  if (status !== 'active' && status !== 'missed') {
    return { status: 'not-completable', loggedCreated: false };
  }

  const logRef: PlanLogRef = source.kind === 'hour'
    ? { date: dateIso, hour: source.hour }
    : { date: dateIso, range: { start: source.start, end: source.end } };

  const nextPlanned: TextJournalEntry | TextJournalRangeEntry = target.kind === 'hour'
    ? {
      ...(normalizedHour as TextJournalEntry),
      planStatus: 'completed',
      planUpdatedAt: nowIso,
      completedByLogRef: logRef,
    }
    : {
      ...(normalizedRange as TextJournalRangeEntry),
      planStatus: 'completed',
      planUpdatedAt: nowIso,
      completedByLogRef: logRef,
    };

  setPlanRefEntry(journal, target, nextPlanned);

  let loggedCreated = false;

  if (target.kind === 'hour') {
    const normalizedHourEntry = normalizedHour as TextJournalEntry;
    const slot = journal[target.hour];
    const entries = isJournalEntryArray(slot) ? slot : slot ? [slot] : [];
    const exists = entries.some((entry) =>
      isTextJournalEntry(entry) &&
      entry.entryMode === 'logged' &&
      entry.text === normalizedHourEntry.text &&
      samePlanLogRef(entry.completedByLogRef, logRef)
    );

    if (!exists) {
      appendEntryToHour(journal, target.hour, {
        text: normalizedHourEntry.text,
        entryMode: 'logged',
        completedByLogRef: logRef,
      });
      loggedCreated = true;
    }
  } else {
    const normalizedRangeEntry = normalizedRange as TextJournalRangeEntry;
    const ranges = journal.ranges ?? [];
    const exists = ranges.some((entry) =>
      isTextJournalRangeEntry(entry) &&
      entry.entryMode === 'logged' &&
      entry.start === target.entry.start &&
      entry.end === target.entry.end &&
      entry.text === normalizedRangeEntry.text &&
      samePlanLogRef(entry.completedByLogRef, logRef)
    );

    if (!exists) {
      ranges.push({
        start: target.entry.start,
        end: target.entry.end,
        text: normalizedRangeEntry.text,
        entryMode: 'logged',
        completedByLogRef: logRef,
      });
      journal.ranges = ranges;
      loggedCreated = true;
    }
  }

  return { status: 'completed', loggedCreated };
}

export function applyPlanActionInJournal(
  journal: DayJournalWithRanges,
  dateIso: string,
  planId: string,
  source: TextPlanSource,
  _action: PlanAction,
  nowIso: string = new Date().toISOString()
): PlanActionResult {
  const target = getAllPlannedRefs(journal).find((ref) => {
    if (ref.entry.planId !== planId) {
      return false;
    }

    if (source.kind === 'hour') {
      return ref.kind === 'hour' && ref.hour === source.hour;
    }

    return ref.kind === 'range' && ref.entry.start === source.start && ref.entry.end === source.end;
  });

  if (!target) {
    return { status: 'not-found', loggedCreated: false };
  }

  const logRef: PlanLogRef = source.kind === 'hour'
    ? { date: dateIso, hour: source.hour }
    : { date: dateIso, range: { start: source.start, end: source.end } };

  let loggedCreated = false;

  if (target.entryType === 'text') {
    const normalized = normalizePlannedEntry(target.entry, nowIso);

    const nextPlanned: TextJournalEntry | TextJournalRangeEntry = target.kind === 'hour'
      ? {
          ...(normalized as TextJournalEntry),
          planStatus: 'completed',
          planUpdatedAt: nowIso,
          completedByLogRef: logRef,
        }
      : {
          ...(normalized as TextJournalRangeEntry),
          planStatus: 'completed',
          planUpdatedAt: nowIso,
          completedByLogRef: logRef,
        };

    setPlanRefEntry(journal, target, nextPlanned);

    if (target.kind === 'hour') {
      const slot = journal[target.hour];
      const entries = isJournalEntryArray(slot) ? slot : slot ? [slot] : [];
      const exists = entries.some((entry) =>
        isTextJournalEntry(entry) &&
        entry.entryMode === 'logged' &&
        entry.text === (normalized as TextJournalEntry).text &&
        samePlanLogRef(entry.completedByLogRef, logRef)
      );

      if (!exists) {
        appendEntryToHour(journal, target.hour, {
          text: (normalized as TextJournalEntry).text,
          entryMode: 'logged',
          completedByLogRef: logRef,
        });
        loggedCreated = true;
      }
    } else {
      const ranges = journal.ranges ?? [];
      const exists = ranges.some((entry) =>
        isTextJournalRangeEntry(entry) &&
        entry.entryMode === 'logged' &&
        entry.start === target.entry.start &&
        entry.end === target.entry.end &&
        entry.text === (normalized as TextJournalRangeEntry).text &&
        samePlanLogRef(entry.completedByLogRef, logRef)
      );

      if (!exists) {
        ranges.push({
          start: target.entry.start,
          end: target.entry.end,
          text: (normalized as TextJournalRangeEntry).text,
          entryMode: 'logged',
          completedByLogRef: logRef,
        });
        journal.ranges = ranges;
        loggedCreated = true;
      }
    }

    return {
      status: 'applied',
      loggedCreated,
      entryType: 'text',
      planStatus: 'completed',
    };
  }

  const normalizedTask = normalizePlannedTaskEntry(target.entry, nowIso);
  const nextTaskPlanned: TaskJournalEntry | TaskJournalRangeEntry = target.kind === 'hour'
    ? {
        ...(normalizedTask as TaskJournalEntry),
        planStatus: 'completed',
        planUpdatedAt: nowIso,
        completedByLogRef: logRef,
      }
    : {
        ...(normalizedTask as TaskJournalRangeEntry),
        planStatus: 'completed',
        planUpdatedAt: nowIso,
        completedByLogRef: logRef,
      };

  setPlanRefEntry(journal, target, nextTaskPlanned);

  if (target.kind === 'hour') {
    const slot = journal[target.hour];
    const entries = isJournalEntryArray(slot) ? slot : slot ? [slot] : [];
    const exists = entries.some((entry) =>
      isTaskJournalEntry(entry) &&
      entry.entryMode === 'logged' &&
      entry.taskId === normalizedTask.taskId &&
      samePlanLogRef(entry.completedByLogRef, logRef)
    );

    if (!exists) {
      appendEntryToHour(journal, target.hour, {
        taskId: normalizedTask.taskId,
        listType: normalizedTask.listType,
        entryMode: 'logged',
        completedByLogRef: logRef,
      });
      loggedCreated = true;
    }
  } else {
    const ranges = journal.ranges ?? [];
    const exists = ranges.some((entry) =>
      isTaskJournalRangeEntry(entry) &&
      entry.entryMode === 'logged' &&
      entry.start === target.entry.start &&
      entry.end === target.entry.end &&
      entry.taskId === normalizedTask.taskId &&
      samePlanLogRef(entry.completedByLogRef, logRef)
    );

    if (!exists) {
      ranges.push({
        start: target.entry.start,
        end: target.entry.end,
        taskId: normalizedTask.taskId,
        listType: normalizedTask.listType,
        entryMode: 'logged',
        completedByLogRef: logRef,
      });
      journal.ranges = ranges;
      loggedCreated = true;
    }
  }

  return {
    status: 'applied',
    loggedCreated,
    entryType: 'task',
    planStatus: 'completed',
    task: {
      taskId: normalizedTask.taskId,
      listType: normalizedTask.listType,
    },
  };
}

function appendTaskEntryToHour(journal: DayJournalWithRanges, hour: string, entry: TaskJournalEntry): void {
  appendEntryToHour(journal, hour, entry);
}

export function replanTaskEntryInJournal(
  journal: DayJournalWithRanges,
  fromPlanId: string,
  to: { hour: string } | { start: string; end: string },
  nowIso: string = new Date().toISOString()
): { oldPlanId: string; newPlanId: string } | null {
  const refs = getAllTaskRefs(journal).filter((ref) => ref.entry.entryMode === 'planned');
  const match = refs.find((ref) => ref.entry.planId === fromPlanId);
  if (!match) {
    return null;
  }

  const newPlanId = crypto.randomUUID();

  const nextPlannedBase = {
    taskId: match.entry.taskId,
    listType: match.entry.listType,
    entryMode: 'planned' as const,
    planId: newPlanId,
    planStatus: 'active' as const,
    planCreatedAt: nowIso,
    planUpdatedAt: nowIso,
    replannedFromPlanId: fromPlanId,
  };

  if (match.kind === 'hour') {
    const current = normalizePlannedTaskEntry(match.entry, nowIso);
    current.planStatus = 'rescheduled';
    current.replannedToPlanId = newPlanId;
    current.planUpdatedAt = nowIso;
    updateHourEntry(
      journal,
      match.hour,
      (entry) => isTaskJournalEntry(entry) && entry.planId === fromPlanId,
      () => current
    );
  } else {
    const current = normalizePlannedTaskEntry(match.entry, nowIso);
    current.planStatus = 'rescheduled';
    current.replannedToPlanId = newPlanId;
    current.planUpdatedAt = nowIso;
    const ranges = journal.ranges ?? [];
    const existing = ranges[match.rangeIndex];
    if (existing && isTaskJournalRangeEntry(existing)) {
      ranges[match.rangeIndex] = current;
      journal.ranges = ranges;
    }
  }

  if ('hour' in to) {
    appendTaskEntryToHour(journal, to.hour, nextPlannedBase);
  } else {
    const ranges = journal.ranges ?? [];
    ranges.push({
      ...nextPlannedBase,
      start: to.start,
      end: to.end,
    });
    journal.ranges = ranges;
  }

  return { oldPlanId: fromPlanId, newPlanId };
}
