// Shared types for task and journal systems

// ============ Task Types ============

export type ListType = 'have-to-do' | 'want-to-do';

export interface Task {
  id: string;
  text: string;
  notesMarkdown?: string;
  projects?: string[];
  dueDate?: string;
  dueTimeStart?: string;
  dueTimeEnd?: string;
  completed?: boolean;
  isDaily?: boolean;
}

export interface TasksData {
  _comment: string;
  tasks: Task[];
}

// ============ Journal Entry Types ============

/**
 * planned = intention/schedule
 * logged = what actually happened
 */
export type EntryMode = 'planned' | 'logged';
export type PlanStatus = 'active' | 'missed' | 'rescheduled' | 'completed' | 'canceled';

export interface PlanLogRef {
  date: string;
  hour?: string;
  range?: {
    start: string;
    end: string;
  };
}

/**
 * A journal entry that references a task by ID.
 */
export interface TaskJournalEntry {
  taskId: string;
  listType: ListType;
  entryMode: EntryMode;
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A journal entry with free-form text (not linked to a task).
 */
export interface TextJournalEntry {
  text: string;
  entryMode: EntryMode;
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A journal entry can be:
 * - TaskJournalEntry: references a task by ID
 * - TextJournalEntry: free-form text
 * - string: legacy plain text (backward compatibility)
 */
export type JournalEntry = TaskJournalEntry | TextJournalEntry | string;

/**
 * A day's journal hour slot can be:
 * - A single JournalEntry (backward compatible)
 * - An array of JournalEntry (for multiple tasks per hour)
 */
export type JournalHourSlot = JournalEntry | JournalEntry[];

/**
 * A day's journal mapping hours to entries (single or multiple per hour)
 */
export type DayJournal = Record<string, JournalHourSlot>;

// ============ Resolved Journal Entry (for display) ============

/**
 * A resolved journal entry with all display information.
 */
export interface ResolvedJournalEntry {
  hour: string;
  text: string;
  type: 'task' | 'text';
  entryMode: EntryMode;
  planId?: string;
  planStatus?: PlanStatus;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  missedAt?: string;
  taskId?: string;
  listType?: ListType;
  completed?: boolean;
}

// ============ Range Entry Types ============

/**
 * A text-based journal range entry spanning multiple hours.
 */
export interface TextJournalRangeEntry {
  start: string; // e.g., "12pm"
  end: string; // e.g., "2pm"
  text: string;
  entryMode: EntryMode;
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A task-based journal range entry spanning multiple hours.
 */
export interface TaskJournalRangeEntry {
  start: string;
  end: string;
  taskId: string;
  listType: ListType;
  entryMode: EntryMode;
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A journal range entry can be text-based or task-based.
 */
export type JournalRangeEntry = TextJournalRangeEntry | TaskJournalRangeEntry;

/**
 * A resolved journal range entry with all display information.
 */
export interface ResolvedJournalRangeEntry {
  start: string;
  end: string;
  text: string;
  type: 'task' | 'text';
  entryMode: EntryMode;
  planId?: string;
  planStatus?: PlanStatus;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  missedAt?: string;
  taskId?: string;
  listType?: ListType;
  completed?: boolean;
}

// ============ Staged Entry Types ============

/**
 * A staged task entry - a task that is due on this day but not yet scheduled to a specific time.
 * These appear in the "staging area" / "unscheduled" section of the day.
 */
export interface StagedTaskEntry {
  taskId: string;
  listType: ListType;
}

/**
 * A resolved staged entry with all display information.
 */
export interface ResolvedStagedEntry {
  text: string;
  taskId: string;
  listType: ListType;
  completed?: boolean;
}

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

/**
 * Check if an hour slot contains multiple entries (is an array).
 */
export function isJournalEntryArray(slot: JournalHourSlot | null | undefined): slot is JournalEntry[] {
  return Array.isArray(slot);
}
