// Shared types for task and journal systems

// ============ Task Types ============

export type ListType = 'have-to-do' | 'want-to-do';

export interface Task {
  id: string;
  text: string;
  dueDate?: string;
  completed?: boolean;
}

export interface TasksData {
  _comment: string;
  tasks: Task[];
}

// ============ Journal Entry Types ============

/**
 * A journal entry that references a task by ID
 * @param isPlan - If true, this is a planned entry; if false/undefined, it's an actual entry
 */
export interface TaskJournalEntry {
  taskId: string;
  listType: ListType;
  isPlan?: boolean;
}

/**
 * A journal entry with free-form text (not linked to a task)
 * @param isPlan - If true, this is a planned entry; if false/undefined, it's an actual entry
 */
export interface TextJournalEntry {
  text: string;
  isPlan?: boolean;
}

/**
 * A journal entry can be:
 * - TaskJournalEntry: references a task by ID
 * - TextJournalEntry: free-form text
 * - string: legacy plain text (backward compatibility)
 */
export type JournalEntry = TaskJournalEntry | TextJournalEntry | string;

/**
 * A day's journal mapping hours to entries
 */
export type DayJournal = Record<string, JournalEntry>;

// ============ Resolved Journal Entry (for display) ============

/**
 * A resolved journal entry with all display information
 */
export interface ResolvedJournalEntry {
  hour: string;
  text: string;
  type: 'task' | 'text';
  taskId?: string;
  listType?: ListType;
  completed?: boolean;
  isPlan?: boolean;
}

// ============ Range Entry Types ============

/**
 * A text-based journal range entry spanning multiple hours
 * @param isPlan - If true, this is a planned entry; if false/undefined, it's an actual entry
 */
export interface TextJournalRangeEntry {
  start: string;  // e.g., "12pm"
  end: string;    // e.g., "2pm"
  text: string;
  isPlan?: boolean;
}

/**
 * A task-based journal range entry spanning multiple hours
 * @param isPlan - If true, this is a planned entry; if false/undefined, it's an actual entry
 */
export interface TaskJournalRangeEntry {
  start: string;
  end: string;
  taskId: string;
  listType: ListType;
  isPlan?: boolean;
}

/**
 * A journal range entry can be text-based or task-based
 */
export type JournalRangeEntry = TextJournalRangeEntry | TaskJournalRangeEntry;

/**
 * A resolved journal range entry with all display information
 */
export interface ResolvedJournalRangeEntry {
  start: string;
  end: string;
  text: string;
  type: 'task' | 'text';
  taskId?: string;
  listType?: ListType;
  completed?: boolean;
  isPlan?: boolean;
}

// ============ Staged Entry Types ============

/**
 * A staged task entry - a task that is due on this day but not yet scheduled to a specific time.
 * These appear in the "staging area" / "unscheduled" section of the day.
 */
export interface StagedTaskEntry {
  taskId: string;
  listType: ListType;
  isPlan?: boolean;
}

/**
 * A resolved staged entry with all display information
 */
export interface ResolvedStagedEntry {
  text: string;
  taskId: string;
  listType: ListType;
  completed?: boolean;
  isPlan?: boolean;
}

// ============ Deprecated Plan Types (aliases for backward compatibility) ============

/** @deprecated Use TaskJournalEntry instead */
export type TaskPlanEntry = TaskJournalEntry;

/** @deprecated Use TextJournalEntry instead */
export type TextPlanEntry = TextJournalEntry;

/** @deprecated Use JournalEntry instead */
export type PlanEntry = JournalEntry;

/** @deprecated Use DayJournal instead */
export type DayPlan = DayJournal;

/** @deprecated Use ResolvedJournalEntry instead */
export type ResolvedPlanEntry = ResolvedJournalEntry;

/** @deprecated Use TextJournalRangeEntry instead */
export type TextPlanRangeEntry = TextJournalRangeEntry;

/** @deprecated Use TaskJournalRangeEntry instead */
export type TaskPlanRangeEntry = TaskJournalRangeEntry;

/** @deprecated Use JournalRangeEntry instead */
export type PlanRangeEntry = JournalRangeEntry;

/** @deprecated Use ResolvedJournalRangeEntry instead */
export type ResolvedRangeEntry = ResolvedJournalRangeEntry;

// ============ Type Guards ============

export function isTaskJournalEntry(entry: JournalEntry): entry is TaskJournalEntry {
  return typeof entry === 'object' && entry !== null && 'taskId' in entry && 'listType' in entry;
}

export function isTextJournalEntry(entry: JournalEntry): entry is TextJournalEntry {
  return typeof entry === 'object' && entry !== null && 'text' in entry && !('taskId' in entry);
}

export function isLegacyJournalStringEntry(entry: JournalEntry): entry is string {
  return typeof entry === 'string';
}

export function isTaskJournalRangeEntry(entry: JournalRangeEntry): entry is TaskJournalRangeEntry {
  return 'taskId' in entry && 'listType' in entry;
}

export function isTextJournalRangeEntry(entry: JournalRangeEntry): entry is TextJournalRangeEntry {
  return 'text' in entry && !('taskId' in entry);
}

export function isStagedTaskEntry(entry: StagedTaskEntry): entry is StagedTaskEntry {
  return typeof entry === 'object' && entry !== null && 'taskId' in entry && 'listType' in entry && !('start' in entry);
}

// ============ Deprecated Type Guards (aliases for backward compatibility) ============

/** @deprecated Use isTaskJournalEntry instead */
export const isTaskPlanEntry = isTaskJournalEntry;

/** @deprecated Use isTextJournalEntry instead */
export const isTextPlanEntry = isTextJournalEntry;

/** @deprecated Use isLegacyJournalStringEntry instead */
export const isLegacyStringEntry = isLegacyJournalStringEntry;

/** @deprecated Use isTaskJournalRangeEntry instead */
export const isTaskPlanRangeEntry = isTaskJournalRangeEntry;

/** @deprecated Use isTextJournalRangeEntry instead */
export const isTextPlanRangeEntry = isTextJournalRangeEntry;
