// Shared types for task and plan systems

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

// ============ Plan Entry Types ============

/**
 * A plan entry that references a task by ID
 */
export interface TaskPlanEntry {
  taskId: string;
  listType: ListType;
}

/**
 * A plan entry with free-form text (not linked to a task)
 */
export interface TextPlanEntry {
  text: string;
}

/**
 * A plan entry can be:
 * - TaskPlanEntry: references a task by ID
 * - TextPlanEntry: free-form text
 * - string: legacy plain text (backward compatibility)
 */
export type PlanEntry = TaskPlanEntry | TextPlanEntry | string;

/**
 * A day's plan mapping hours to entries
 */
export type DayPlan = Record<string, PlanEntry>;

// ============ Resolved Plan Entry (for display) ============

/**
 * A resolved plan entry with all display information
 */
export interface ResolvedPlanEntry {
  hour: string;
  text: string;
  type: 'task' | 'text';
  taskId?: string;
  listType?: ListType;
  completed?: boolean;
}

// ============ Journal Entry Types ============

/**
 * A journal entry that references a task by ID
 */
export interface TaskJournalEntry {
  taskId: string;
  listType: ListType;
}

/**
 * A journal entry with free-form text (not linked to a task)
 */
export interface TextJournalEntry {
  text: string;
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
}

// ============ Range Entry Types ============

/**
 * A text-based journal range entry spanning multiple hours
 */
export interface TextJournalRangeEntry {
  start: string;  // e.g., "12pm"
  end: string;    // e.g., "2pm"
  text: string;
}

/**
 * A task-based journal range entry spanning multiple hours
 */
export interface TaskJournalRangeEntry {
  start: string;
  end: string;
  taskId: string;
  listType: ListType;
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
}

/**
 * A plan range entry with free-form text
 */
export interface TextPlanRangeEntry {
  start: string;
  end: string;
  text: string;
}

/**
 * A plan range entry that references a task
 */
export interface TaskPlanRangeEntry {
  start: string;
  end: string;
  taskId: string;
  listType: ListType;
}

/**
 * A plan range entry can be text-based or task-based
 */
export type PlanRangeEntry = TextPlanRangeEntry | TaskPlanRangeEntry;

/**
 * A resolved range entry with all display information
 */
export interface ResolvedRangeEntry {
  start: string;
  end: string;
  text: string;
  type: 'task' | 'text';
  taskId?: string;
  listType?: ListType;
  completed?: boolean;
}

// ============ Type Guards ============

export function isTaskPlanEntry(entry: PlanEntry): entry is TaskPlanEntry {
  return typeof entry === 'object' && entry !== null && 'taskId' in entry && 'listType' in entry;
}

export function isTextPlanEntry(entry: PlanEntry): entry is TextPlanEntry {
  return typeof entry === 'object' && entry !== null && 'text' in entry && !('taskId' in entry);
}

export function isLegacyStringEntry(entry: PlanEntry): entry is string {
  return typeof entry === 'string';
}

export function isTaskPlanRangeEntry(entry: PlanRangeEntry): entry is TaskPlanRangeEntry {
  return 'taskId' in entry && 'listType' in entry;
}

export function isTextPlanRangeEntry(entry: PlanRangeEntry): entry is TextPlanRangeEntry {
  return 'text' in entry && !('taskId' in entry);
}

// ============ Journal Type Guards ============

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

