import {
  createMastraToolForFrontendTool,
  createMastraToolForStateSetter,
  createRequestAdditionalContextTool,
} from '@cedar-os/backend';
import { streamJSONEvent } from '../../utils/streamUtils';
import { z } from 'zod';

// Valid hours of the day (7am to 6am) - matches frontend
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;

// Define the schemas for our tools based on what we registered in page.tsx

// Schema for the addNewTextLine frontend tool
export const AddNewTextLineSchema = z.object({
  text: z.string().min(1, 'Text cannot be empty').describe('The text to add to the screen'),
  style: z
    .enum(['normal', 'bold', 'italic', 'highlight'])
    .optional()
    .describe('Text style to apply'),
});

// Schema for the changeText state setter
export const ChangeTextSchema = z.object({
  newText: z.string().min(1, 'Text cannot be empty').describe('The new text to display'),
});

// Error response schema
export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.string().optional(),
});

// ==================== TASK STATE SETTER SCHEMAS ====================

// Schema for addTask state setter
export const AddTaskSchema = z.object({
  text: z.string().min(1).describe('The task text/description'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to add to'),
  position: z.number().int().min(0).optional().describe('Optional position (0 = highest priority)'),
  dueDate: z.string().optional().describe('Optional due date in ISO format (YYYY-MM-DD)'),
});

// Schema for removeTask state setter
export const RemoveTaskSchema = z.object({
  text: z.string().min(1).describe('The exact text of the task to remove'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to remove from'),
});

// Schema for updateTask state setter
export const UpdateTaskSchema = z.object({
  oldText: z.string().min(1).describe('The current text of the task to update'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task is in'),
  newText: z.string().optional().describe('The new text for the task'),
  dueDate: z.string().optional().describe('The new due date (ISO format), or empty string to remove'),
});

// Schema for reorderTask state setter
export const ReorderTaskSchema = z.object({
  text: z.string().min(1).describe('The text of the task to move'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task is in'),
  newPosition: z.number().int().min(0).describe('The new position index (0 = highest priority)'),
});

// Schema for addTaskToToday state setter
export const AddTaskToTodaySchema = z.object({
  text: z.string().min(1).describe('The task text to add'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to add to'),
  dueDate: z.string().optional().describe('Optional due date in ISO format'),
});

// Schema for removeTaskFromToday state setter
export const RemoveTaskFromTodaySchema = z.object({
  text: z.string().min(1).describe('The exact text of the task to remove'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to remove from'),
});

// ==================== JOURNAL STATE SETTER SCHEMAS ====================

// Schema for createDayJournal state setter
export const CreateDayJournalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD, e.g., 2025-11-25)'),
});

// Schema for appendToJournal state setter
export const AppendToJournalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to append to (e.g., "8am", "12pm", "5pm")'),
  text: z.string().min(1).describe('The text to append to the journal entry'),
});

// Schema for updateJournalEntry state setter
export const UpdateJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to update'),
  text: z.string().describe('The new text to replace the existing entry'),
});

// Schema for deleteJournalEntry state setter
export const DeleteJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to clear'),
});

// Schema for addJournalRange state setter
export const AddJournalRangeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  start: z.enum(VALID_HOURS).describe('The start hour of the range (e.g., "12pm")'),
  end: z.enum(VALID_HOURS).describe('The end hour of the range (e.g., "2pm"). Must be after start.'),
  text: z.string().min(1).describe('The text describing what happened during this time range'),
});

// Schema for removeJournalRange state setter
export const RemoveJournalRangeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  start: z.enum(VALID_HOURS).describe('The start hour of the range to remove'),
  end: z.enum(VALID_HOURS).describe('The end hour of the range to remove'),
});

// ==================== PLAN STATE SETTER SCHEMAS ====================

// Schema for createDayPlan state setter
export const CreateDayPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD, e.g., 2025-11-25)'),
});

// Schema for appendToPlan state setter
export const AppendToPlanSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to append to (e.g., "8am", "12pm", "5pm")'),
  text: z.string().min(1).describe('The text to append to the plan entry'),
});

// Schema for updatePlanEntry state setter
export const UpdatePlanEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to update'),
  text: z.string().describe('The new text to replace the existing entry'),
});

// Schema for deletePlanEntry state setter
export const DeletePlanEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to clear'),
});

// Schema for addPlanRange state setter
export const AddPlanRangeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  start: z.enum(VALID_HOURS).describe('The start hour of the range (e.g., "2pm")'),
  end: z.enum(VALID_HOURS).describe('The end hour of the range (e.g., "4pm"). Must be after start.'),
  text: z.string().min(1).describe('The text describing what is planned during this time range'),
});

// Schema for removePlanRange state setter
export const RemovePlanRangeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  start: z.enum(VALID_HOURS).describe('The start hour of the range to remove'),
  end: z.enum(VALID_HOURS).describe('The end hour of the range to remove'),
});

// ==================== TOOL CREATION ====================

// Create backend tools for the frontend tool
export const addNewTextLineTool = createMastraToolForFrontendTool(
  'addNewTextLine',
  AddNewTextLineSchema,
  {
    description:
      'Add a new line of text to the screen with optional styling. This tool allows the agent to dynamically add text content that will be displayed on the user interface with different visual styles.',
    toolId: 'addNewTextLine',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

// Create backend tools for the state setter
export const changeTextTool = createMastraToolForStateSetter(
  'mainText', // The state key
  'changeText', // The state setter name
  ChangeTextSchema,
  {
    description:
      'Change the main text displayed on the screen. This tool allows the agent to modify the primary text content that users see, replacing the current text with new content.',
    toolId: 'changeText',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

// ==================== TASK STATE SETTER TOOLS ====================

// General task tools
export const addTaskTool = createMastraToolForStateSetter(
  'taskLists',
  'addTask',
  AddTaskSchema,
  {
    description: 'Add a new task to a general task list (have-to-do or want-to-do). Tasks are added to the end (lowest priority) by default. Use position parameter to insert at a specific index (0 = highest priority).',
    toolId: 'addTask',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const removeTaskTool = createMastraToolForStateSetter(
  'taskLists',
  'removeTask',
  RemoveTaskSchema,
  {
    description: 'Remove a task from a general task list by its exact text.',
    toolId: 'removeTask',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const updateTaskTool = createMastraToolForStateSetter(
  'taskLists',
  'updateTask',
  UpdateTaskSchema,
  {
    description: 'Update an existing task\'s text or due date in a general task list.',
    toolId: 'updateTask',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const reorderTaskTool = createMastraToolForStateSetter(
  'taskLists',
  'reorderTask',
  ReorderTaskSchema,
  {
    description: 'Move a task to a new position in the priority queue. Position 0 is highest priority.',
    toolId: 'reorderTask',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

// Daily task tools
export const addTaskToTodayTool = createMastraToolForStateSetter(
  'taskLists',
  'addTaskToToday',
  AddTaskToTodaySchema,
  {
    description: 'Add a task to today\'s task list. If the task already exists, it will not be duplicated.',
    toolId: 'addTaskToToday',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const removeTaskFromTodayTool = createMastraToolForStateSetter(
  'taskLists',
  'removeTaskFromToday',
  RemoveTaskFromTodaySchema,
  {
    description: 'Remove a task from today\'s task list.',
    toolId: 'removeTaskFromToday',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

// ==================== JOURNAL STATE SETTER TOOLS ====================

export const createDayJournalTool = createMastraToolForStateSetter(
  'weekJournals',
  'createDayJournal',
  CreateDayJournalSchema,
  {
    description: 'Create a new journal file for a specific date. If a journal already exists, it will not be overwritten.',
    toolId: 'createDayJournal',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const appendToJournalTool = createMastraToolForStateSetter(
  'weekJournals',
  'appendToJournal',
  AppendToJournalSchema,
  {
    description: 'Append text to a specific hour\'s journal entry. The text will be added to existing content with proper separation.',
    toolId: 'appendToJournal',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const updateJournalEntryTool = createMastraToolForStateSetter(
  'weekJournals',
  'updateJournalEntry',
  UpdateJournalEntrySchema,
  {
    description: 'Update/replace the content of a specific hour\'s journal entry. This will overwrite any existing content.',
    toolId: 'updateJournalEntry',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const deleteJournalEntryTool = createMastraToolForStateSetter(
  'weekJournals',
  'deleteJournalEntry',
  DeleteJournalEntrySchema,
  {
    description: 'Delete/clear the content of a specific hour\'s journal entry.',
    toolId: 'deleteJournalEntry',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const addJournalRangeTool = createMastraToolForStateSetter(
  'weekJournals',
  'addJournalRange',
  AddJournalRangeSchema,
  {
    description: 'Add a journal entry that spans multiple hours. Use this when an activity lasted for a range of time (e.g., "worked on project from 12pm to 2pm"). This creates a single entry displayed as "12pm-2pm: worked on project".',
    toolId: 'addJournalRange',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const removeJournalRangeTool = createMastraToolForStateSetter(
  'weekJournals',
  'removeJournalRange',
  RemoveJournalRangeSchema,
  {
    description: 'Remove a journal range entry by specifying its start and end hours.',
    toolId: 'removeJournalRange',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

// ==================== PLAN STATE SETTER TOOLS ====================

export const createDayPlanTool = createMastraToolForStateSetter(
  'weekJournals',
  'createDayPlan',
  CreateDayPlanSchema,
  {
    description: 'Create a new plan file for a specific date. If a plan already exists, it will not be overwritten.',
    toolId: 'createDayPlan',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const appendToPlanTool = createMastraToolForStateSetter(
  'weekJournals',
  'appendToPlan',
  AppendToPlanSchema,
  {
    description: 'Append text to a specific hour\'s plan entry. The text will be added to existing content with proper separation.',
    toolId: 'appendToPlan',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const updatePlanEntryTool = createMastraToolForStateSetter(
  'weekJournals',
  'updatePlanEntry',
  UpdatePlanEntrySchema,
  {
    description: 'Update/replace the content of a specific hour\'s plan entry. This will overwrite any existing content.',
    toolId: 'updatePlanEntry',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const deletePlanEntryTool = createMastraToolForStateSetter(
  'weekJournals',
  'deletePlanEntry',
  DeletePlanEntrySchema,
  {
    description: 'Delete/clear the content of a specific hour\'s plan entry.',
    toolId: 'deletePlanEntry',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const addPlanRangeTool = createMastraToolForStateSetter(
  'weekJournals',
  'addPlanRange',
  AddPlanRangeSchema,
  {
    description: 'Add a plan entry that spans multiple hours. Use this when scheduling an activity for a range of time (e.g., "meeting from 2pm to 4pm"). This creates a single entry displayed as "2pm-4pm: meeting".',
    toolId: 'addPlanRange',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const removePlanRangeTool = createMastraToolForStateSetter(
  'weekJournals',
  'removePlanRange',
  RemovePlanRangeSchema,
  {
    description: 'Remove a plan range entry by specifying its start and end hours.',
    toolId: 'removePlanRange',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const requestAdditionalContextTool = createRequestAdditionalContextTool();

/**
 * Registry of all available tools organized by category
 * This structure makes it easy to see tool organization and generate categorized descriptions
 */
export const TOOL_REGISTRY = {
  textManipulation: {
    changeTextTool,
    addNewTextLineTool,
  },
  journalManagement: {
    createDayJournalTool,
    appendToJournalTool,
    updateJournalEntryTool,
    deleteJournalEntryTool,
    addJournalRangeTool,
    removeJournalRangeTool,
  },
  planManagement: {
    createDayPlanTool,
    appendToPlanTool,
    updatePlanEntryTool,
    deletePlanEntryTool,
    addPlanRangeTool,
    removePlanRangeTool,
  },
  taskManagement: {
    addTaskTool,
    removeTaskTool,
    updateTaskTool,
    reorderTaskTool,
    addTaskToTodayTool,
    removeTaskFromTodayTool,
  },
};

// Export all tools as an array for easy registration
export const ALL_TOOLS = [
  changeTextTool, 
  addNewTextLineTool,
  createDayJournalTool,
  appendToJournalTool,
  updateJournalEntryTool,
  deleteJournalEntryTool,
  addJournalRangeTool,
  removeJournalRangeTool,
  createDayPlanTool,
  appendToPlanTool,
  updatePlanEntryTool,
  deletePlanEntryTool,
  addPlanRangeTool,
  removePlanRangeTool,
  addTaskTool,
  removeTaskTool,
  updateTaskTool,
  reorderTaskTool,
  addTaskToTodayTool,
  removeTaskFromTodayTool,
];
