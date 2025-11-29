import {
  createMastraToolForFrontendTool,
  createMastraToolForStateSetter,
  createRequestAdditionalContextTool,
} from '@cedar-os/backend';
import { streamJSONEvent } from '../../utils/streamUtils';
import { z } from 'zod';
import { 
  readJournalTool, 
  appendToJournalTool, 
  createDayJournalTool,
  updateJournalEntryTool,
  deleteJournalEntryTool,
} from './journalTools';
import {
  readPlanTool,
  appendToPlanTool,
  createDayPlanTool,
  updatePlanEntryTool,
  deletePlanEntryTool,
} from './planTools';

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
    readJournalTool,
    appendToJournalTool,
    createDayJournalTool,
    updateJournalEntryTool,
    deleteJournalEntryTool,
  },
  planManagement: {
    readPlanTool,
    appendToPlanTool,
    createDayPlanTool,
    updatePlanEntryTool,
    deletePlanEntryTool,
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
  readJournalTool,
  appendToJournalTool,
  createDayJournalTool,
  updateJournalEntryTool,
  deleteJournalEntryTool,
  readPlanTool,
  appendToPlanTool,
  createDayPlanTool,
  updatePlanEntryTool,
  deletePlanEntryTool,
  addTaskTool,
  removeTaskTool,
  updateTaskTool,
  reorderTaskTool,
  addTaskToTodayTool,
  removeTaskFromTodayTool,
];
