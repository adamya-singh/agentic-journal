import {
  createMastraToolForFrontendTool,
  createMastraToolForStateSetter,
  createRequestAdditionalContextTool,
} from '@cedar-os/backend';
import { createTool } from '@mastra/core/tools';
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
  taskId: z.string().min(1).describe('The ID of an existing task from the general list to add to today'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
});

// Schema for removeTaskFromToday state setter
export const RemoveTaskFromTodaySchema = z.object({
  taskId: z.string().min(1).describe('The ID of the task to remove from today\'s list'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to remove from'),
});

// Schema for completeTask state setter
export const CompleteTaskSchema = z.object({
  taskId: z.string().min(1).describe('The ID of the task to mark as completed'),
  listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
});

// ==================== JOURNAL STATE SETTER SCHEMAS ====================

// Schema for createDayJournal state setter
export const CreateDayJournalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD, e.g., 2025-11-25)'),
});

// Schema for appendToJournal state setter
// Supports either text-based entries OR task-referenced entries (taskId + listType)
export const AppendToJournalSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to append to (e.g., "8am", "12pm", "5pm")'),
  text: z.string().optional().describe('The text to append (use this for free-form entries, OR use taskId+listType for task references)'),
  taskId: z.string().optional().describe('The ID of an existing task to reference (use with listType instead of text for task planning)'),
  listType: z.enum(['have-to-do', 'want-to-do']).optional().describe('Which list the task belongs to (required when using taskId)'),
  isPlan: z.boolean().optional().describe('If true, this is a planned entry; if false/undefined, it is an actual entry'),
}).refine(
  data => {
    const hasText = data.text !== undefined && data.text.length > 0;
    const hasTaskRef = data.taskId !== undefined && data.listType !== undefined;
    return hasText !== hasTaskRef; // XOR: exactly one must be true
  },
  { message: 'Provide either text OR (taskId + listType), not both or neither' }
);

// Schema for updateJournalEntry state setter
// Supports either text-based entries OR task-referenced entries (taskId + listType)
export const UpdateJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to update'),
  text: z.string().optional().describe('The new text (use this for free-form entries, OR use taskId+listType for task references)'),
  taskId: z.string().optional().describe('The ID of an existing task to reference (use with listType instead of text for task planning)'),
  listType: z.enum(['have-to-do', 'want-to-do']).optional().describe('Which list the task belongs to (required when using taskId)'),
  isPlan: z.boolean().optional().describe('If true, this is a planned entry; if false/undefined, it is an actual entry'),
}).refine(
  data => {
    const hasText = data.text !== undefined;
    const hasTaskRef = data.taskId !== undefined && data.listType !== undefined;
    // Allow clearing (neither) or exactly one
    if (!hasText && !hasTaskRef) return true; // clearing entry
    return hasText !== hasTaskRef; // XOR: exactly one must be true
  },
  { message: 'Provide either text OR (taskId + listType), not both' }
);

// Schema for deleteJournalEntry state setter
export const DeleteJournalEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  hour: z.enum(VALID_HOURS).describe('The hour to clear'),
});

// Schema for addJournalRange state setter
// Supports either text-based entries OR task-referenced entries (taskId + listType)
export const AddJournalRangeSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
  start: z.enum(VALID_HOURS).describe('The start hour of the range (e.g., "12pm")'),
  end: z.enum(VALID_HOURS).describe('The end hour of the range (e.g., "2pm"). Must be after start.'),
  text: z.string().optional().describe('The text describing the activity (use this for free-form entries, OR use taskId+listType for task references)'),
  taskId: z.string().optional().describe('The ID of an existing task to reference (use with listType instead of text for task planning)'),
  listType: z.enum(['have-to-do', 'want-to-do']).optional().describe('Which list the task belongs to (required when using taskId)'),
  isPlan: z.boolean().optional().describe('If true, this is a planned entry; if false/undefined, it is an actual entry'),
}).refine(
  data => {
    const hasText = data.text !== undefined && data.text.length > 0;
    const hasTaskRef = data.taskId !== undefined && data.listType !== undefined;
    return hasText !== hasTaskRef; // XOR: exactly one must be true
  },
  { message: 'Provide either text OR (taskId + listType), not both or neither' }
);

// Schema for removeJournalRange state setter
export const RemoveJournalRangeSchema = z.object({
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

// ==================== TASK TOOLS ====================

/**
 * Unified addTask tool that:
 * 1. Calls API directly to add task (gets real ID)
 * 2. Returns full task data including taskId to the agent
 * 3. Frontend stream processor auto-syncs React state when it sees this tool's result
 */
export const addTaskTool = createTool({
  id: 'addTask',
  description: 'Add a new task to a general list (have-to-do or want-to-do). Returns the taskId which can be used with addTaskToToday. Tasks are added to the end (lowest priority) by default.',
  inputSchema: AddTaskSchema,
  outputSchema: z.object({
    success: z.boolean(),
    taskId: z.string().optional(),
    task: z.object({
      id: z.string(),
      text: z.string(),
      listType: z.enum(['have-to-do', 'want-to-do']),
      position: z.number().optional(),
      dueDate: z.string().optional(),
    }).optional(),
    message: z.string(),
  }),
  execute: async ({ context }) => {
    const { text, listType, position, dueDate } = context as {
      text: string;
      listType: 'have-to-do' | 'want-to-do';
      position?: number;
      dueDate?: string;
    };
    
    try {
      // Call the API directly to add the task
      const response = await fetch('http://localhost:3000/api/tasks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: text, listType, position, dueDate }),
      });
      
      const result = await response.json();
      
      if (result.success && result.taskId) {
        // Return full task data - frontend stream processor will sync React state
        return {
          success: true,
          taskId: result.taskId,
          task: {
            id: result.taskId,
            text: text.trim(),
            listType,
            position,
            dueDate,
          },
          message: `Task "${text}" added to ${listType} with ID: ${result.taskId}`,
        };
      }
      
      return { 
        success: false, 
        message: result.error || 'Failed to add task' 
      };
    } catch (error) {
      return { 
        success: false, 
        message: `Error adding task: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  },
});

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
    description: 'Add an EXISTING task from a general list to today\'s task list by its ID. Use this ONLY when the user explicitly asks to schedule an existing task for today. Do NOT call this automatically after addTask.',
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
    description: 'Remove a task from today\'s task list by its ID.',
    toolId: 'removeTaskFromToday',
    streamEventFn: streamJSONEvent,
    errorSchema: ErrorResponseSchema,
  },
);

export const completeTaskTool = createMastraToolForStateSetter(
  'taskLists',
  'completeTask',
  CompleteTaskSchema,
  {
    description: 'Mark a task as completed. This removes it from the general task list and marks it done in today\'s list.',
    toolId: 'completeTask',
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
    description: 'Create a new journal file for a specific date. If a journal already exists, it will not be overwritten. Use this for both actual journal entries and planned entries.',
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
    description: 'Append to a specific hour\'s journal entry. Use text for free-form entries, OR use taskId+listType to link to an existing task (preferred for planning tasks). Set isPlan: true for planned entries.',
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
    description: 'Update/replace a specific hour\'s journal entry. Use text for free-form entries, OR use taskId+listType to link to an existing task (preferred for planning tasks). This overwrites existing content. Set isPlan: true for planned entries.',
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
    description: 'Add a journal entry spanning multiple hours. Use text for free-form entries, OR use taskId+listType to link to an existing task (preferred for planning tasks). Creates an entry like "12pm-2pm: activity". Set isPlan: true for planned entries.',
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
  taskManagement: {
    addTaskTool,
    removeTaskTool,
    updateTaskTool,
    reorderTaskTool,
    addTaskToTodayTool,
    removeTaskFromTodayTool,
    completeTaskTool,
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
  addTaskTool,
  removeTaskTool,
  updateTaskTool,
  reorderTaskTool,
  addTaskToTodayTool,
  removeTaskFromTodayTool,
  completeTaskTool,
];
