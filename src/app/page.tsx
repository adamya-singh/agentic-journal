'use client';

import React from 'react';
import { z } from 'zod';
import {
  useRegisterState,
  useRegisterFrontendTool,
  useSubscribeStateToAgentContext,
  useCedarStore,
} from 'cedar-os';

import { ChatModeSelector } from '@/components/ChatModeSelector';
import { WeekView, WeekViewData } from '@/components/WeekView';
import { TaskLists, TaskListsData, Task, ListType } from '@/components/TaskLists';
import { CedarCaptionChat } from '@/cedar/components/chatComponents/CedarCaptionChat';
import { FloatingCedarChat } from '@/cedar/components/chatComponents/FloatingCedarChat';
import { SidePanelCedarChat } from '@/cedar/components/chatComponents/SidePanelCedarChat';
import { DebuggerPanel } from '@/cedar/components/debugger';
import { useRefresh } from '@/lib/RefreshContext';

type ChatMode = 'floating' | 'sidepanel' | 'caption';

/**
 * Get current date in ISO format (YYYY-MM-DD)
 */
function getCurrentDateISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get current time in 12-hour format (e.g., 3:45 PM)
 */
function getCurrentTime(): string {
  const now = new Date();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  return `${hours12}:${minutes} ${ampm}`;
}

/**
 * Generate a temporary UUID for optimistic updates
 * The real ID will be generated server-side
 */
function generateTempId(): string {
  return 'temp-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

export default function HomePage() {
  // Cedar-OS chat components with mode selector
  // Choose between caption, floating, or side panel chat modes
  const [chatMode, setChatMode] = React.useState<ChatMode>('sidepanel');

  // Cedar state for the main text that can be changed by the agent
  const [mainText, setMainText] = React.useState('tell Cedar to change me');

  // Cedar state for dynamically added text lines
  const [textLines, setTextLines] = React.useState<string[]>([]);

  // Cedar state for current date in ISO format (YYYY-MM-DD)
  const [currentDate, setCurrentDate] = React.useState(getCurrentDateISO());

  // Cedar state for current time
  const [currentTime, setCurrentTime] = React.useState(getCurrentTime());

  // Cedar state for week view data (journals for the week)
  const [weekViewData, setWeekViewData] = React.useState<WeekViewData | null>(null);

  // Cedar state for task lists data (general and today lists)
  const [taskListsData, setTaskListsData] = React.useState<TaskListsData | null>(null);

  // Get refresh functions from context
  const { refreshTasks, refreshJournal, refreshAll } = useRefresh();

  // State for journal creation button
  const [journalStatus, setJournalStatus] = React.useState<'idle' | 'loading' | 'success' | 'error' | 'exists'>('idle');
  const [journalMessage, setJournalMessage] = React.useState<string>('');

  // Get messages from Cedar store to watch for addTask tool results
  const messages = useCedarStore((state) => state.messages);

  // Track processed tool call IDs to avoid duplicate processing
  const processedToolCallIds = React.useRef<Set<string>>(new Set());

  // Stream processor: Watch for addTask tool results and auto-sync React state
  React.useEffect(() => {
    if (!messages || messages.length === 0) return;

    // Find any new addTask tool results that we haven't processed yet
    for (const message of messages) {
      // Check if this is a tool-result message for addTask
      if (
        message.type === 'tool-result' &&
        message.payload?.toolName === 'addTask' &&
        message.payload?.result?.success &&
        message.payload?.result?.task &&
        message.payload?.toolCallId
      ) {
        const toolCallId = message.payload.toolCallId;
        
        // Skip if we've already processed this tool call
        if (processedToolCallIds.current.has(toolCallId)) {
          continue;
        }

        // Mark as processed
        processedToolCallIds.current.add(toolCallId);

        const task = message.payload.result.task as {
          id: string;
          text: string;
          listType: 'have-to-do' | 'want-to-do';
          position?: number;
          dueDate?: string;
        };

        // Update React state with the new task
        setTaskListsData((currentData) => {
          if (!currentData) return currentData;

          const key = task.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          
          // Check if task already exists (by ID)
          if (currentData.generalTasks[key].some((t) => t.id === task.id)) {
            return currentData; // Already exists, no update needed
          }

          const newTask: Task = {
            id: task.id,
            text: task.text,
            ...(task.dueDate && { dueDate: task.dueDate }),
          };

          const currentTasks = [...currentData.generalTasks[key]];

          // Insert at position or append to end
          if (typeof task.position === 'number' && task.position >= 0 && task.position <= currentTasks.length) {
            currentTasks.splice(task.position, 0, newTask);
          } else {
            currentTasks.push(newTask);
          }

          console.log(`[Stream Processor] Auto-synced addTask result: "${task.text}" to ${task.listType}`);

          return {
            ...currentData,
            generalTasks: {
              ...currentData.generalTasks,
              [key]: currentTasks,
            },
          };
        });
      }
    }
  }, [messages]);

  // System message to pre-fill in chat input when page loads
  const systemMessage = `[System] The user has opened the journal page. Current date: ${currentDate}, Current time: ${currentTime}. Read today's journal using the readJournal tool and ask the user terse, efficient questions to help fill in the journal entries for the day. If any entries already exist for today, don't try to fill in any gaps before the latest entry.`;

  // Register the main text as Cedar state with a state setter
  useRegisterState({
    key: 'mainText',
    description: 'The main text that can be modified by Cedar',
    value: mainText,
    setValue: setMainText,
    stateSetters: {
      changeText: {
        name: 'changeText',
        description: 'Change the main text to a new value',
        argsSchema: z.object({
          newText: z.string().min(1, 'Text cannot be empty').describe('The new text to display'),
        }),
        execute: (
          currentText: string,
          setValue: (newValue: string) => void,
          args: { newText: string },
        ) => {
          setValue(args.newText);
        },
      },
    },
  });

  // Register the current date as Cedar state
  useRegisterState({
    key: 'currentDate',
    description: 'The current date in ISO format (YYYY-MM-DD, e.g., 2025-11-25)',
    value: currentDate,
    setValue: setCurrentDate,
  });

  // Register the current time as Cedar state
  useRegisterState({
    key: 'currentTime',
    description: 'The current time in 12-hour format (e.g., 3:45 PM)',
    value: currentTime,
    setValue: setCurrentTime,
  });

  // Valid hours for journal entries
  const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'] as const;
  type HourOfDay = typeof VALID_HOURS[number];

  // Register week view data as Cedar state with setters for journal management
  useRegisterState({
    key: 'weekJournals',
    description: 'Journal entries for the current week (Monday-Sunday), including planned and logged entry modes by hour.',
    value: weekViewData,
    setValue: setWeekViewData,
    stateSetters: {
      // ==================== JOURNAL SETTERS ====================
      createDayJournal: {
        name: 'createDayJournal',
        description: 'Create a new journal file for a specific date. If a journal already exists, it will not be overwritten.',
        argsSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD, e.g., 2025-11-25)'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string }
        ) => {
          // Call API to create journal
          await fetch('/api/journal/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: args.date }),
          });

          // Trigger WeekView to refresh via context
          refreshJournal();
        },
      },
      appendToJournal: {
        name: 'appendToJournal',
        description: 'Append to a specific hour\'s journal entry. Use text for free-form entries, OR use taskId+listType to link to an existing task.',
        argsSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
          hour: z.enum(VALID_HOURS).describe('The hour to append to (e.g., "8am", "12pm", "5pm")'),
          text: z.string().optional().describe('The text to append (use this OR taskId+listType)'),
          taskId: z.string().optional().describe('The ID of an existing task to reference'),
          listType: z.enum(['have-to-do', 'want-to-do']).optional().describe('Which list the task belongs to'),
          entryMode: z.enum(['planned', 'logged']).describe('Entry mode: "planned" for intentions/schedule, "logged" for actual events'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string; hour: HourOfDay; text?: string; taskId?: string; listType?: ListType; entryMode: 'planned' | 'logged' }
        ) => {
          if (!currentData) return;

          // Persist to JSON via API
          await fetch('/api/journal/append', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: args.date,
              hour: args.hour,
              ...(args.text ? { text: args.text } : {}),
              ...(args.taskId ? { taskId: args.taskId } : {}),
              ...(args.listType ? { listType: args.listType } : {}),
              entryMode: args.entryMode,
            }),
          });

          // Trigger WeekView to refresh via context (handles resolved entry creation)
          refreshJournal();
        },
      },
      deleteJournalEntry: {
        name: 'deleteJournalEntry',
        description: 'Delete/clear the content of a specific hour\'s journal entry.',
        argsSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
          hour: z.enum(VALID_HOURS).describe('The hour to clear'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string; hour: HourOfDay }
        ) => {
          if (!currentData) return;

          // Persist to JSON via API
          const response = await fetch('/api/journal/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: args.date,
              hour: args.hour,
            }),
          });

          if (!response.ok) {
            const error = await response.json();
            console.error('Failed to delete journal entry:', error);
            throw new Error(error.error || 'Failed to delete journal entry');
          }

          // Trigger WeekView to refresh via context (handles state update properly)
          refreshJournal();
        },
      },
      // ==================== JOURNAL RANGE SETTERS ====================
      addJournalRange: {
        name: 'addJournalRange',
        description: 'Add a journal entry that spans multiple hours. Use text for free-form entries, OR use taskId+listType to link to an existing task.',
        argsSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
          start: z.enum(VALID_HOURS).describe('The start hour of the range (e.g., "12pm")'),
          end: z.enum(VALID_HOURS).describe('The end hour of the range (e.g., "2pm"). Must be after start.'),
          text: z.string().optional().describe('The text describing the activity (use this OR taskId+listType)'),
          taskId: z.string().optional().describe('The ID of an existing task to reference'),
          listType: z.enum(['have-to-do', 'want-to-do']).optional().describe('Which list the task belongs to'),
          entryMode: z.enum(['planned', 'logged']).describe('Entry mode: "planned" for intentions/schedule, "logged" for actual events'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string; start: HourOfDay; end: HourOfDay; text?: string; taskId?: string; listType?: ListType; entryMode: 'planned' | 'logged' }
        ) => {
          if (!currentData) return;

          // Persist to JSON via API - build range object with appropriate fields
          const rangePayload: Record<string, unknown> = { start: args.start, end: args.end };
          if (args.text) rangePayload.text = args.text;
          if (args.taskId) rangePayload.taskId = args.taskId;
          if (args.listType) rangePayload.listType = args.listType;
          rangePayload.entryMode = args.entryMode;

          await fetch('/api/journal/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: args.date,
              range: rangePayload,
            }),
          });

          // Trigger WeekView to refresh via context
          refreshJournal();
        },
      },
      removeJournalRange: {
        name: 'removeJournalRange',
        description: 'Remove a journal range entry by specifying its start and end hours.',
        argsSchema: z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('The date in ISO format (YYYY-MM-DD)'),
          start: z.enum(VALID_HOURS).describe('The start hour of the range to remove'),
          end: z.enum(VALID_HOURS).describe('The end hour of the range to remove'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string; start: HourOfDay; end: HourOfDay }
        ) => {
          if (!currentData) return;

          // Persist to JSON via API
          await fetch('/api/journal/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              date: args.date,
              removeRange: { start: args.start, end: args.end },
            }),
          });

          // Trigger WeekView to refresh via context
          refreshJournal();
        },
      },
    },
  });

  // Register task lists data as Cedar state with setters for task management
  useRegisterState({
    key: 'taskLists',
    description: 'Task lists containing general tasks (have-to-do and want-to-do) and today\'s tasks. Tasks are prioritized with the first item being highest priority.',
    value: taskListsData,
    setValue: setTaskListsData,
    stateSetters: {
      // ==================== GENERAL TASK SETTERS ====================
      // Note: addTask is now a custom backend tool that calls API directly and returns taskId.
      // The frontend auto-syncs React state via a stream processor when it sees addTask tool results.
      removeTask: {
        name: 'removeTask',
        description: 'Remove a task from a general task list by its ID.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the task to remove'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to remove from'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType }
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          const filteredTasks = currentData.generalTasks[key].filter(t => t.id !== args.taskId);

          // Optimistically update state
          setValue({
            ...currentData,
            generalTasks: {
              ...currentData.generalTasks,
              [key]: filteredTasks,
            },
          });

          // Persist to JSON via API
          await fetch('/api/tasks/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
            }),
          });

          // Trigger TaskLists to refresh via context
          refreshTasks();
        },
      },
      updateTask: {
        name: 'updateTask',
        description: 'Update an existing task\'s text or due date in a general task list.',
        argsSchema: z.object({
          oldText: z.string().min(1).describe('The current text of the task to update'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task is in'),
          newText: z.string().optional().describe('The new text for the task'),
          dueDate: z.string().optional().describe('The new due date (ISO format), or empty string to remove'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { oldText: string; listType: ListType; newText?: string; dueDate?: string }
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          const updatedTasks = currentData.generalTasks[key].map(task => {
            if (task.text === args.oldText.trim()) {
              const updated: Task = { ...task };
              if (args.newText) updated.text = args.newText.trim();
              if (args.dueDate !== undefined) {
                if (args.dueDate === '') {
                  delete updated.dueDate;
                } else {
                  updated.dueDate = args.dueDate;
                }
              }
              return updated;
            }
            return task;
          });

          // Optimistically update state
          setValue({
            ...currentData,
            generalTasks: {
              ...currentData.generalTasks,
              [key]: updatedTasks,
            },
          });

          // Persist to JSON via API
          await fetch('/api/tasks/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              oldText: args.oldText,
              newText: args.newText,
              dueDate: args.dueDate,
              listType: args.listType,
            }),
          });

          // Trigger TaskLists to refresh via context
          refreshTasks();
        },
      },
      reorderTask: {
        name: 'reorderTask',
        description: 'Move a task to a new position in the priority queue. Position 0 is highest priority.',
        argsSchema: z.object({
          text: z.string().min(1).describe('The text of the task to move'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task is in'),
          newPosition: z.number().int().min(0).describe('The new position index (0 = highest priority)'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { text: string; listType: ListType; newPosition: number }
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          const tasks = [...currentData.generalTasks[key]];
          const currentIndex = tasks.findIndex(t => t.text === args.text.trim());
          
          if (currentIndex === -1) return;

          const clampedPosition = Math.min(args.newPosition, tasks.length - 1);
          const [task] = tasks.splice(currentIndex, 1);
          tasks.splice(clampedPosition, 0, task);

          // Optimistically update state
          setValue({
            ...currentData,
            generalTasks: {
              ...currentData.generalTasks,
              [key]: tasks,
            },
          });

          // Persist to JSON via API
          await fetch('/api/tasks/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: args.text,
              newPosition: args.newPosition,
              listType: args.listType,
            }),
          });

          // Trigger TaskLists to refresh via context
          refreshTasks();
        },
      },
      // ==================== DAILY TASK SETTERS ====================
      addTaskToToday: {
        name: 'addTaskToToday',
        description: 'Add a manual inclusion override so an EXISTING task from a general list appears in today\'s computed task list.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of an existing task from the general list'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType }
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          
          // Find the task in the general list by ID
          const sourceTask = currentData.generalTasks[key].find(t => t.id === args.taskId);
          if (!sourceTask) {
            console.error(`Task with ID ${args.taskId} not found in ${args.listType} list`);
            return;
          }
          
          // Check if already exists in today's list by ID
          if (currentData.todayTasks[key].some(t => t.id === args.taskId)) {
            return; // Already exists, don't duplicate
          }

          // Add the task reference to today's list
          const taskForToday: Task = { 
            id: sourceTask.id,
            text: sourceTask.text,
            ...(sourceTask.dueDate && { dueDate: sourceTask.dueDate }),
          };

          // Optimistically update state
          setValue({
            ...currentData,
            todayTasks: {
              ...currentData.todayTasks,
              [key]: [...currentData.todayTasks[key], taskForToday],
            },
          });

          // Persist to JSON via API
          await fetch('/api/tasks/today/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: sourceTask.id,
              taskText: sourceTask.text,
              listType: args.listType,
              date: currentData.currentDate,
              dueDate: sourceTask.dueDate,
            }),
          });

          // Trigger TaskLists to refresh via context
          refreshTasks();
        },
      },
      removeTaskFromToday: {
        name: 'removeTaskFromToday',
        description: 'Add a manual exclusion override so a task is hidden from today\'s computed task list by ID.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the task to remove from today\'s list'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to remove from'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType }
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          const filteredTasks = currentData.todayTasks[key].filter(t => t.id !== args.taskId);

          // Optimistically update state
          setValue({
            ...currentData,
            todayTasks: {
              ...currentData.todayTasks,
              [key]: filteredTasks,
            },
          });

          // Persist to JSON via API
          await fetch('/api/tasks/today/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
              date: currentData.currentDate,
            }),
          });

          // Trigger TaskLists to refresh via context
          refreshTasks();
        },
      },
      completeTask: {
        name: 'completeTask',
        description: 'Mark a task as completed. This stores date-scoped completion history and removes non-daily tasks from the general task list.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the task to mark as completed'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType }
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          
          // Optimistically update state - mark as completed in today's list
          const updatedTodayTasks = currentData.todayTasks[key].map(task => 
            task.id === args.taskId ? { ...task, completed: true } : task
          );
          
          // Remove from general list
          const updatedGeneralTasks = currentData.generalTasks[key].filter(t => t.id !== args.taskId);

          setValue({
            ...currentData,
            todayTasks: {
              ...currentData.todayTasks,
              [key]: updatedTodayTasks,
            },
            generalTasks: {
              ...currentData.generalTasks,
              [key]: updatedGeneralTasks,
            },
          });

          // Persist to JSON via API
          await fetch('/api/tasks/today/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
              date: currentData.currentDate,
            }),
          });

          // Trigger both TaskLists and WeekView to refresh via context
          refreshAll();
        },
      },
    },
  });

  // Subscribe the main text state to the backend
  useSubscribeStateToAgentContext('mainText', (mainText) => ({ mainText }), {
    showInChat: true,
    color: '#4F46E5',
  });

  // Subscribe the current date to agent context
  useSubscribeStateToAgentContext('currentDate', (currentDate) => ({ currentDate }), {
    showInChat: false,
  });

  // Subscribe the current time to agent context
  useSubscribeStateToAgentContext('currentTime', (currentTime) => ({ currentTime }), {
    showInChat: false,
  });

  // Subscribe week journals to agent context
  useSubscribeStateToAgentContext('weekJournals', (weekJournals) => ({ weekJournals }), {
    showInChat: false,
  });

  // Subscribe task lists to agent context
  useSubscribeStateToAgentContext('taskLists', (taskLists) => ({ taskLists }), {
    showInChat: false,
  });

  // Handler for creating today's journal
  const handleCreateTodayJournal = async () => {
    setJournalStatus('loading');
    setJournalMessage('');
    
    try {
      const response = await fetch('/api/journal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: currentDate }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        if (data.alreadyExists) {
          setJournalStatus('exists');
          setJournalMessage(`Journal for ${currentDate} already exists`);
        } else {
          setJournalStatus('success');
          setJournalMessage(`Created journal for ${currentDate}`);
        }
      } else {
        setJournalStatus('error');
        setJournalMessage(data.error || 'Failed to create journal');
      }
    } catch (error) {
      setJournalStatus('error');
      setJournalMessage('Failed to connect to server');
    }
  };


  // Register frontend tool for adding text lines
  useRegisterFrontendTool({
    name: 'addNewTextLine',
    description: 'Add a new line of text to the screen via frontend tool',
    argsSchema: z.object({
      text: z.string().min(1, 'Text cannot be empty').describe('The text to add to the screen'),
      style: z
        .enum(['normal', 'bold', 'italic', 'highlight'])
        .optional()
        .describe('Text style to apply'),
    }),
    execute: async (args: { text: string; style?: 'normal' | 'bold' | 'italic' | 'highlight' }) => {
      const styledText =
        args.style === 'bold'
          ? `**${args.text}**`
          : args.style === 'italic'
            ? `*${args.text}*`
            : args.style === 'highlight'
              ? `🌟 ${args.text} 🌟`
              : args.text;
      setTextLines((prev) => [...prev, styledText]);
    },
  });

  const renderContent = () => (
    <div className="relative min-h-screen w-full bg-white dark:bg-gray-900">
      <ChatModeSelector currentMode={chatMode} onModeChange={setChatMode} />

      {/* Week View */}
      <div className="pt-16 pb-4">
        <WeekView onDataChange={setWeekViewData} />
      </div>

      {/* Task Lists */}
      <TaskLists onDataChange={setTaskListsData} />

      {/* Main interactive content area */}
      <div className="flex flex-col items-center justify-center p-8 space-y-8">
        {/* Journal creation section */}
        <div className="flex flex-col items-center gap-3">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Today: {currentDate}
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleCreateTodayJournal}
              disabled={journalStatus === 'loading'}
              className={`px-6 py-2 rounded-lg font-medium transition-colors ${
                journalStatus === 'loading'
                  ? 'bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                  : journalStatus === 'success'
                    ? 'bg-green-500 dark:bg-green-600 text-white hover:bg-green-600 dark:hover:bg-green-500'
                    : journalStatus === 'exists'
                      ? 'bg-blue-500 dark:bg-blue-600 text-white hover:bg-blue-600 dark:hover:bg-blue-500'
                      : journalStatus === 'error'
                        ? 'bg-red-500 dark:bg-red-600 text-white hover:bg-red-600 dark:hover:bg-red-500'
                        : 'bg-indigo-500 dark:bg-indigo-600 text-white hover:bg-indigo-600 dark:hover:bg-indigo-500'
              }`}
            >
              {journalStatus === 'loading'
                ? 'Creating...'
                : journalStatus === 'success'
                  ? '✓ Created'
                  : journalStatus === 'exists'
                    ? '✓ Already Exists'
                    : journalStatus === 'error'
                      ? 'Retry'
                      : "Create Today's Journal"}
            </button>
          </div>
          {journalMessage && (
            <p className={`text-sm ${journalStatus === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-400'}`}>
              {journalMessage}
            </p>
          )}
        </div>

        {/* Big text that Cedar can change */}
        <div className="text-center">
          <h1 className="text-6xl font-bold text-gray-800 dark:text-gray-100 mb-4">{mainText}</h1>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
            This text can be changed by Cedar using state setters
          </p>
        </div>

        {/* Instructions for adding new text */}
        <div className="text-center">
          <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2">
            tell cedar to add new lines of text to the screen
          </h2>
          <p className="text-md text-gray-500 dark:text-gray-400 mb-6">
            Cedar can add new text using frontend tools with different styles
          </p>
        </div>

        {/* Display dynamically added text lines */}
        {textLines.length > 0 && (
          <div className="w-full max-w-2xl">
            <h3 className="text-xl font-medium text-gray-700 dark:text-gray-200 mb-4 text-center">Added by Cedar:</h3>
            <div className="space-y-2">
              {textLines.map((line, index) => (
                <div
                  key={index}
                  className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-center"
                >
                  {line.startsWith('**') && line.endsWith('**') ? (
                    <strong className="text-blue-800 dark:text-blue-200">{line.slice(2, -2)}</strong>
                  ) : line.startsWith('*') && line.endsWith('*') ? (
                    <em className="text-blue-700 dark:text-blue-300">{line.slice(1, -1)}</em>
                  ) : line.startsWith('🌟') ? (
                    <span className="text-yellow-600 dark:text-yellow-400 font-semibold">{line}</span>
                  ) : (
                    <span className="text-blue-800 dark:text-blue-200">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {chatMode === 'caption' && <CedarCaptionChat />}

      {chatMode === 'floating' && (
        <FloatingCedarChat side="right" title="Cedarling Chat" collapsedLabel="Chat with Cedar" />
      )}
    </div>
  );

  if (chatMode === 'sidepanel') {
    return (
      <SidePanelCedarChat
        side="right"
        title="Cedarling Chat"
        collapsedLabel="Chat with Cedar"
        showCollapsedButton={true}
        initialMessage={systemMessage}
      >
        <DebuggerPanel />
        {renderContent()}
      </SidePanelCedarChat>
    );
  }

  return renderContent();
}
