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

