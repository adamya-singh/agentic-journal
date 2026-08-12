'use client';

import React from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { useRegisterState, useRegisterFrontendTool, useCedarStore } from 'cedar-os';

import { SettingsPopover } from '@/components/SettingsPopover';
import { WeekView, WeekViewData } from '@/components/WeekView';
import { TaskLists, TaskListsData, Task, ListType } from '@/components/TaskLists';
import { CedarCaptionChat } from '@/cedar/components/chatComponents/CedarCaptionChat';
import { FloatingCedarChat } from '@/cedar/components/chatComponents/FloatingCedarChat';
import { SidePanelCedarChat } from '@/cedar/components/chatComponents/SidePanelCedarChat';
import { DebuggerPanel } from '@/cedar/components/debugger';
import { useRefresh } from '@/lib/RefreshContext';
import { useIsMobile } from '@/lib/useIsMobile';
import { useJobBoardState } from '@/lib/useJobBoardState';
import { getCurrentDateISO, scheduleMidnightRollover } from '@/lib/current-date';
import type { JobListingsData, JobListing } from '@/lib/types';

type ChatMode = 'floating' | 'sidepanel' | 'caption';
type JobListingInput = Omit<
  JobListing,
  'id' | 'createdAt' | 'updatedAt' | 'savedAt' | 'statusHistory' | 'notes' | 'status'
> & {
  notes?: string;
  status?: JobListing['status'];
};

const JobListingSourceSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'The source where this job was discovered, such as Jobright, SpeedyApply, or a GitHub list name',
    ),
  link: z
    .string()
    .url()
    .describe('A link to the source posting or source page where the listing was found'),
});

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

function usePublishCedarContext(
  key: string,
  value: unknown,
  options?: { color?: string; showInChat?: boolean },
) {
  const putAdditionalContext = useCedarStore((state) => state.putAdditionalContext);
  const color = options?.color;
  const showInChat = options?.showInChat;

  React.useEffect(() => {
    putAdditionalContext(key, value, { color, showInChat });
  }, [key, value, color, showInChat, putAdditionalContext]);
}

export default function HomePage() {
  const isMobile = useIsMobile();

  // Cedar-OS chat components with mode selector
  // Choose between caption, floating, or side panel chat modes
  const [chatMode, setChatMode] = React.useState<ChatMode>('sidepanel');

  // Restore the persisted chat mode after mount (localStorage is unavailable during SSR).
  React.useEffect(() => {
    const stored = window.localStorage.getItem('chatMode');
    if (stored === 'caption' || stored === 'floating' || stored === 'sidepanel') {
      setChatMode(stored);
    }
  }, []);

  const handleChatModeChange = React.useCallback((mode: ChatMode) => {
    setChatMode(mode);
    try {
      window.localStorage.setItem('chatMode', mode);
    } catch {
      // Persistence is best-effort; mode switching still works for the session.
    }
  }, []);

  // On mobile, only the sidepanel layout makes sense (it already goes full-width).
  // The selector is hidden, so guarantee the selected mode is sidepanel there.
  const effectiveChatMode: ChatMode = isMobile ? 'sidepanel' : chatMode;

  // Cedar state for the main text that can be changed by the agent
  const [mainText, setMainText] = React.useState('');

  // Cedar state for dynamically added text lines
  const [textLines, setTextLines] = React.useState<string[]>([]);

  // Cedar state for current date in ISO format (YYYY-MM-DD)
  const [currentDate, setCurrentDate] = React.useState(getCurrentDateISO());

  // Cedar state for current time
  const [currentTime, setCurrentTime] = React.useState(getCurrentTime());

  // Roll the active date (and clock) forward at local midnight so a tab left
  // open overnight stops writing completions to yesterday.
  React.useEffect(
    () =>
      scheduleMidnightRollover(() => {
        setCurrentDate(getCurrentDateISO());
        setCurrentTime(getCurrentTime());
      }),
    [],
  );

  // Cedar state for week view data (journals for the week)
  const [weekViewData, setWeekViewData] = React.useState<WeekViewData | null>(null);

  // Cedar state for Today selections, ordered Current queues, and unordered General backlogs.
  const [taskListsData, setTaskListsData] = React.useState<TaskListsData | null>(null);

  // OpenClaw-maintained job board state; the board renders on /jobs, but the
  // state stays mounted here so the Cedar jobListings registration below keeps
  // the agent's job tools working (the chat only mounts on this page).
  const {
    jobListingsData,
    setJobListingsData,
    jobApplicationsData,
    refreshJobListings,
    refreshJobApplications,
  } = useJobBoardState();
  const [projectRoadmapsData, setProjectRoadmapsData] = React.useState<unknown>(null);

  // Get refresh functions from context
  const { refreshTasks, refreshJournal, refreshAll } = useRefresh();

  // Get messages from Cedar store to watch for addTask tool results
  const messages = useCedarStore((state) => state.messages);

  // Track processed tool call IDs to avoid duplicate processing
  const processedToolCallIds = React.useRef<Set<string>>(new Set());
  const processedRoadmapToolCallIds = React.useRef<Set<string>>(new Set());

  // Stream processor: Watch for addTask tool results and auto-sync React state
  React.useEffect(() => {
    if (!messages || messages.length === 0) return;

    // Find any new addTask tool results that we haven't processed yet
    for (const message of messages) {
      const toolMessage = message as typeof message & {
        payload?: {
          toolName?: string;
          toolCallId?: string;
          result?: {
            success?: boolean;
            task?: unknown;
          };
        };
      };

      // Check if this is a tool-result message for addTask
      if (
        toolMessage.type === 'tool-result' &&
        toolMessage.payload?.toolName === 'addTask' &&
        toolMessage.payload?.result?.success &&
        toolMessage.payload?.result?.task &&
        toolMessage.payload?.toolCallId
      ) {
        const toolCallId = toolMessage.payload.toolCallId;

        // Skip if we've already processed this tool call
        if (processedToolCallIds.current.has(toolCallId)) {
          continue;
        }

        // Mark as processed
        processedToolCallIds.current.add(toolCallId);

        const task = toolMessage.payload.result.task as {
          id: string;
          text: string;
          listType: 'have-to-do' | 'want-to-do';
          position?: number;
          parentTaskId?: string;
          dueDate?: string;
          dueTimeStart?: string;
          dueTimeEnd?: string;
          isDaily?: boolean;
          projects?: string[];
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
            ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
            ...(task.dueDate && { dueDate: task.dueDate }),
            ...(task.dueTimeStart && { dueTimeStart: task.dueTimeStart }),
            ...(task.dueTimeEnd && { dueTimeEnd: task.dueTimeEnd }),
            ...(task.isDaily ? { isDaily: true } : {}),
            ...(task.projects && task.projects.length > 0 ? { projects: task.projects } : {}),
          };

          const currentTasks = [...currentData.generalTasks[key]];

          // Insert at position or append to end
          if (
            typeof task.position === 'number' &&
            task.position >= 0 &&
            task.position <= currentTasks.length
          ) {
            currentTasks.splice(task.position, 0, newTask);
          } else {
            currentTasks.push(newTask);
          }

          console.log(
            `[Stream Processor] Auto-synced addTask result: "${task.text}" to ${task.listType}`,
          );

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


  const refreshProjectRoadmaps = React.useCallback(async () => {
    try {
      const response = await fetch(`/api/projects/view?date=${currentDate}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        return;
      }

      setProjectRoadmapsData({
        date: data.date,
        projects: Array.isArray(data.projects)
          ? data.projects
              .filter((group: { roadmap?: unknown }) => Boolean(group.roadmap))
              .map((group: { project: string; roadmap: unknown }) => ({
                project: group.project,
                roadmap: group.roadmap,
              }))
          : [],
      });
    } catch {
      setProjectRoadmapsData(null);
    }
  }, [currentDate]);

  React.useEffect(() => {
    refreshProjectRoadmaps();
  }, [refreshProjectRoadmaps, taskListsData]);

  React.useEffect(() => {
    if (!messages || messages.length === 0) return;

    const roadmapToolNames = new Set([
      'setProjectGoal',
      'addRoadmapCheckpoint',
      'updateRoadmapCheckpoint',
      'reorderRoadmapCheckpoint',
      'removeRoadmapCheckpoint',
      'linkRoadmapTask',
      'unlinkRoadmapTask',
      'createRoadmapTask',
    ]);

    for (const message of messages) {
      const toolMessage = message as typeof message & {
        payload?: {
          toolName?: string;
          toolCallId?: string;
          result?: {
            success?: boolean;
          };
        };
      };

      const toolName = toolMessage.payload?.toolName;
      const toolCallId = toolMessage.payload?.toolCallId;
      if (
        toolMessage.type !== 'tool-result' ||
        !toolName ||
        !roadmapToolNames.has(toolName) ||
        !toolMessage.payload?.result?.success ||
        !toolCallId ||
        processedRoadmapToolCallIds.current.has(toolCallId)
      ) {
        continue;
      }

      processedRoadmapToolCallIds.current.add(toolCallId);
      refreshTasks();
      refreshProjectRoadmaps();
    }
  }, [messages, refreshProjectRoadmaps, refreshTasks]);

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
  type HourOfDay = (typeof VALID_HOURS)[number];

  // Register week view data as Cedar state with setters for journal management
  useRegisterState({
    key: 'weekJournals',
    description:
      'Journal entries for the current week (Monday-Sunday), including planned and logged entry modes by hour.',
    value: weekViewData,
    setValue: setWeekViewData,
    stateSetters: {
      // ==================== JOURNAL SETTERS ====================
      createDayJournal: {
        name: 'createDayJournal',
        description:
          'Create a new journal file for a specific date. If a journal already exists, it will not be overwritten.',
        argsSchema: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('The date in ISO format (YYYY-MM-DD, e.g., 2025-11-25)'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string },
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
        description:
          "Append to a specific hour's journal entry. Use text for free-form entries, OR use taskId+listType to link to an existing task.",
        argsSchema: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('The date in ISO format (YYYY-MM-DD)'),
          hour: z.enum(VALID_HOURS).describe('The hour to append to (e.g., "8am", "12pm", "5pm")'),
          text: z.string().optional().describe('The text to append (use this OR taskId+listType)'),
          taskId: z.string().optional().describe('The ID of an existing task to reference'),
          listType: z
            .enum(['have-to-do', 'want-to-do'])
            .optional()
            .describe('Which list the task belongs to'),
          entryMode: z
            .enum(['planned', 'logged'])
            .describe('Entry mode: "planned" for intentions/schedule, "logged" for actual events'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: {
            date: string;
            hour: HourOfDay;
            text?: string;
            taskId?: string;
            listType?: ListType;
            entryMode: 'planned' | 'logged';
          },
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
        description: "Delete/clear the content of a specific hour's journal entry.",
        argsSchema: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('The date in ISO format (YYYY-MM-DD)'),
          hour: z.enum(VALID_HOURS).describe('The hour to clear'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string; hour: HourOfDay },
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
        description:
          'Add a journal entry that spans multiple hours. Use text for free-form entries, OR use taskId+listType to link to an existing task.',
        argsSchema: z.object({
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('The date in ISO format (YYYY-MM-DD)'),
          start: z.enum(VALID_HOURS).describe('The start hour of the range (e.g., "12pm")'),
          end: z
            .enum(VALID_HOURS)
            .describe('The end hour of the range (e.g., "2pm"). Must be after start.'),
          text: z
            .string()
            .optional()
            .describe('The text describing the activity (use this OR taskId+listType)'),
          taskId: z.string().optional().describe('The ID of an existing task to reference'),
          listType: z
            .enum(['have-to-do', 'want-to-do'])
            .optional()
            .describe('Which list the task belongs to'),
          entryMode: z
            .enum(['planned', 'logged'])
            .describe('Entry mode: "planned" for intentions/schedule, "logged" for actual events'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: {
            date: string;
            start: HourOfDay;
            end: HourOfDay;
            text?: string;
            taskId?: string;
            listType?: ListType;
            entryMode: 'planned' | 'logged';
          },
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
          date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .describe('The date in ISO format (YYYY-MM-DD)'),
          start: z.enum(VALID_HOURS).describe('The start hour of the range to remove'),
          end: z.enum(VALID_HOURS).describe('The end hour of the range to remove'),
        }),
        execute: async (
          currentData: WeekViewData | null,
          setValue: (newValue: WeekViewData | null) => void,
          args: { date: string; start: HourOfDay; end: HourOfDay },
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
    description:
      'Task lists containing dated Today selections, ordered running Current queues, and unordered General backlogs. Today contains selected Current tasks plus automatic due-date tasks for the active date.',
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
          args: { taskId: string; listType: ListType },
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          const filteredTasks = currentData.generalTasks[key].filter((t) => t.id !== args.taskId);

          // Optimistically update state
          setValue({
            ...currentData,
            generalTasks: {
              ...currentData.generalTasks,
              [key]: filteredTasks,
            },
          });

          // Persist to JSON via API
          const response = await fetch('/api/tasks/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to remove task');
          }

          // Trigger TaskLists to refresh via context
          refreshTasks();
        },
      },
      updateTask: {
        name: 'updateTask',
        description:
          "Update an existing task's text, due date/time, or projects in a general task list.",
        argsSchema: z.object({
          taskId: z.string().optional().describe('The ID of the task to update when available'),
          oldText: z.string().min(1).describe('The current text of the task to update'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task is in'),
          newText: z.string().optional().describe('The new text for the task'),
          dueDate: z
            .string()
            .optional()
            .describe('The new due date (ISO format), or empty string to remove'),
          dueTimeStart: z
            .string()
            .optional()
            .describe('Optional due time start (HH:mm), or empty string to remove due time'),
          dueTimeEnd: z
            .string()
            .optional()
            .describe('Optional due time end (HH:mm) for ranges, or empty string for single-time'),
          projects: z
            .array(z.string())
            .optional()
            .describe('Optional replacement list of projects for this task'),
          parentTaskId: z
            .string()
            .optional()
            .describe('Optional parent task ID, or empty string to clear'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: {
            taskId?: string;
            oldText: string;
            listType: ListType;
            newText?: string;
            dueDate?: string;
            dueTimeStart?: string;
            dueTimeEnd?: string;
            projects?: string[];
            parentTaskId?: string;
          },
        ) => {
          if (!currentData) return;

          const key = args.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
          const updatedTasks = currentData.generalTasks[key].map((task) => {
            const matchesTask = args.taskId
              ? task.id === args.taskId
              : task.text === args.oldText.trim();
            if (matchesTask) {
              const updated: Task = { ...task };
              if (args.newText) updated.text = args.newText.trim();
              if (args.dueDate !== undefined) {
                if (args.dueDate === '') {
                  delete updated.dueDate;
                  delete updated.dueTimeStart;
                  delete updated.dueTimeEnd;
                } else {
                  updated.dueDate = args.dueDate;
                }
              }
              if (args.dueTimeStart !== undefined || args.dueTimeEnd !== undefined) {
                if (args.dueTimeStart === '') {
                  delete updated.dueTimeStart;
                  delete updated.dueTimeEnd;
                } else {
                  if (args.dueTimeStart) {
                    updated.dueTimeStart = args.dueTimeStart;
                  }
                  if (args.dueTimeEnd === '') {
                    delete updated.dueTimeEnd;
                  } else if (args.dueTimeEnd) {
                    updated.dueTimeEnd = args.dueTimeEnd;
                  }
                }
              }
              if (args.projects !== undefined) {
                if (args.projects.length === 0) {
                  delete updated.projects;
                } else {
                  updated.projects = args.projects;
                }
              }
              if (args.parentTaskId !== undefined) {
                if (args.parentTaskId.trim().length === 0) {
                  delete updated.parentTaskId;
                } else {
                  updated.parentTaskId = args.parentTaskId.trim();
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
          const response = await fetch('/api/tasks/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              oldText: args.oldText,
              taskId: args.taskId,
              newText: args.newText,
              dueDate: args.dueDate,
              dueTimeStart: args.dueTimeStart,
              dueTimeEnd: args.dueTimeEnd,
              projects: args.projects,
              parentTaskId: args.parentTaskId,
              listType: args.listType,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to update task');
          }

          // Trigger TaskLists to refresh via context
          refreshTasks();
        },
      },
      reorderCurrentTask: {
        name: 'reorderCurrentTask',
        description:
          'Move a ranked Current task to a new priority position. Position 0 is highest priority.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the Current task to move'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task is in'),
          newPosition: z
            .number()
            .int()
            .min(0)
            .describe('The new position index (0 = highest priority)'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType; newPosition: number },
        ) => {
          if (!currentData) return;
          const response = await fetch('/api/tasks/current/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              newPosition: args.newPosition,
              listType: args.listType,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to reorder Current task');
          }
          refreshTasks();
        },
      },
      // ==================== CURRENT TASK SETTERS ====================
      addTaskToCurrent: {
        name: 'addTaskToCurrent',
        description: 'Admit an existing General task to the ranked running Current queue.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of an existing task from the general list'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
          position: z
            .number()
            .int()
            .min(0)
            .optional()
            .describe('Priority position; omit to append'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType; position?: number },
        ) => {
          if (!currentData) return;
          const response = await fetch('/api/tasks/current/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
              position: args.position,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to add task to Current');
          }
          refreshTasks();
        },
      },
      removeTaskFromCurrent: {
        name: 'removeTaskFromCurrent',
        description:
          'Remove a ranked task from Current while leaving it in General. This also removes any uncompleted selected copy from active Today.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the task to remove from Current'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list to remove from'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType },
        ) => {
          if (!currentData) return;
          const response = await fetch('/api/tasks/current/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to remove task from Current');
          }
          refreshTasks();
        },
      },
      addCurrentTaskToToday: {
        name: 'addCurrentTaskToToday',
        description:
          "Select a Current task into the active date's Today list without changing Current priority. The task must already be in Current — admit it with addTaskToCurrent first.",
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the Current task to select for Today'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType },
        ) => {
          if (!currentData) return;
          const response = await fetch('/api/tasks/today/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
              date: currentData.currentDate,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to select task for Today — it must be in Current first');
          }
          refreshAll();
        },
      },
      removeTaskFromToday: {
        name: 'removeTaskFromToday',
        description:
          "Remove a selected task from the active date's Today list without changing Current or General.",
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the selected Today task to remove'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType },
        ) => {
          if (!currentData) return;
          const response = await fetch('/api/tasks/today/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
              date: currentData.currentDate,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to remove task from Today');
          }
          refreshAll();
        },
      },
      completeTask: {
        name: 'completeTask',
        description:
          'Toggle task completion for the active date: completing removes non-daily tasks from General and Current; calling it on an already-completed task uncompletes it.',
        argsSchema: z.object({
          taskId: z.string().min(1).describe('The ID of the task to mark as completed'),
          listType: z.enum(['have-to-do', 'want-to-do']).describe('Which list the task belongs to'),
        }),
        execute: async (
          currentData: TaskListsData | null,
          setValue: (newValue: TaskListsData | null) => void,
          args: { taskId: string; listType: ListType },
        ) => {
          if (!currentData) return;

          const response = await fetch('/api/tasks/today/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId: args.taskId,
              listType: args.listType,
              date: currentData.currentDate,
            }),
          });
          const data = await response.json();
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to toggle task completion');
          }

          // Trigger both TaskLists and WeekView to refresh via context
          refreshAll();
        },
      },
    },
  });

  // Register job listings as Cedar state with setters for OpenClaw.
  useRegisterState({
    key: 'jobListings',
    description:
      'OpenClaw-maintained job listings with company, simple company summary, position title, location, application categories, status, salary, direct application link, structured source metadata, free-form notes, posted date, raw posted-date text, saved timestamp, and status history.',
    value: jobListingsData,
    setValue: setJobListingsData,
    stateSetters: {
      addJobListing: {
        name: 'addJobListing',
        description: 'Add a job listing to the OpenClaw-maintained job board.',
        argsSchema: z.object({
          company: z.string().min(1).describe('The company name'),
          companySummary: z
            .string()
            .min(1)
            .describe(
              'A simple-English 1-2 sentence description of what the company does at a high level',
            ),
          positionTitle: z.string().min(1).describe('The job title or role name'),
          location: z.string().min(1).describe('The job location or remote/hybrid location text'),
          applicationCategories: z
            .array(
              z.enum(['fall-internship', 'spring-internship', 'summer-internship', 'new-grad']),
            )
            .min(1)
            .describe('Every application category explicitly supported by the listing'),
          status: z
            .enum(['saved', 'starred', 'applied', 'archived'])
            .optional()
            .describe(
              'The listing status. Defaults to saved. Use archived to hide without losing dedupe memory.',
            ),
          salary: z
            .string()
            .min(1)
            .describe('Salary or pay range text. Use "not listed" if unavailable.'),
          link: z.string().url().describe('The application or job posting URL'),
          source: JobListingSourceSchema.describe(
            'Where this listing was discovered and the page URL for that source',
          ),
          postedDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe(
              'The exact date the job was posted in YYYY-MM-DD format, if visible or confidently derivable from the posting',
            ),
          postedDateText: z
            .string()
            .min(1)
            .optional()
            .describe(
              'The raw posted-date wording shown on the job posting, such as "posted today", "posted 30+ days ago", or "posted Apr 12"',
            ),
          notes: z
            .string()
            .min(1)
            .refine((value) => /pros:/i.test(value) && /cons:/i.test(value), {
              message:
                'Notes must include brief Pros: and Cons: sections from the perspective of life goals',
            })
            .describe(
              'Free-form notes from OpenClaw with brief Pros: and Cons: sections from the perspective of life goals. Do not include source metadata here.',
            ),
        }),
        execute: async (
          currentData: JobListingsData | null,
          setValue: (newValue: JobListingsData | null) => void,
          args: JobListingInput,
        ) => {
          const response = await fetch('/api/jobs/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to add job listing');
          }

          setValue({
            schemaVersion: 2,
            listings: data.listings,
          });
        },
      },
      updateJobListing: {
        name: 'updateJobListing',
        description: 'Update one or more fields on an existing job listing by ID.',
        argsSchema: z.object({
          id: z.string().min(1).describe('The job listing ID'),
          company: z.string().min(1).optional().describe('Updated company name'),
          companySummary: z
            .string()
            .min(1)
            .optional()
            .describe(
              'Updated simple-English 1-2 sentence description of what the company does at a high level',
            ),
          positionTitle: z.string().min(1).optional().describe('Updated job title or role name'),
          location: z.string().min(1).optional().describe('Updated job location'),
          applicationCategories: z
            .array(
              z.enum(['fall-internship', 'spring-internship', 'summer-internship', 'new-grad']),
            )
            .min(1)
            .optional()
            .describe('Updated application categories'),
          status: z
            .enum(['saved', 'starred', 'applied', 'archived'])
            .optional()
            .describe('Updated listing status'),
          salary: z.string().min(1).optional().describe('Updated salary or pay range text'),
          link: z.string().url().optional().describe('Updated application or job posting URL'),
          source: JobListingSourceSchema.optional().describe(
            'Updated source name and source page URL',
          ),
          postedDate: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional()
            .describe(
              'Updated exact date the job was posted in YYYY-MM-DD format, if visible or confidently derivable from the posting',
            ),
          postedDateText: z
            .string()
            .min(1)
            .optional()
            .describe('Updated raw posted-date wording shown on the job posting'),
          notes: z
            .string()
            .refine((value) => /pros:/i.test(value) && /cons:/i.test(value), {
              message:
                'Notes must include brief Pros: and Cons: sections from the perspective of life goals',
            })
            .optional()
            .describe(
              'Updated notes with brief Pros: and Cons: sections from the perspective of life goals. Do not include source metadata here.',
            ),
        }),
        execute: async (
          currentData: JobListingsData | null,
          setValue: (newValue: JobListingsData | null) => void,
          args: { id: string } & Partial<JobListingInput>,
        ) => {
          const response = await fetch('/api/jobs/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to update job listing');
          }

          setValue({
            schemaVersion: 2,
            listings: data.listings,
          });
        },
      },
      removeJobListing: {
        name: 'removeJobListing',
        description: 'Remove a job listing from the OpenClaw-maintained job board by ID.',
        argsSchema: z.object({
          id: z.string().min(1).describe('The job listing ID to remove'),
        }),
        execute: async (
          currentData: JobListingsData | null,
          setValue: (newValue: JobListingsData | null) => void,
          args: { id: string },
        ) => {
          const response = await fetch('/api/jobs/remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(args),
          });
          const data = await response.json();

          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Failed to remove job listing');
          }

          setValue({
            schemaVersion: 2,
            listings: data.listings,
          });
        },
      },
      refreshJobListings: {
        name: 'refreshJobListings',
        description: 'Reload job listings from the JSON file on disk.',
        argsSchema: z.object({}),
        execute: async () => {
          await refreshJobListings();
        },
      },
    },
  });

  // Publish React state to Cedar context after render to avoid first-render registration races.
  usePublishCedarContext('mainText', mainText, {
    showInChat: true,
    color: '#4F46E5',
  });

  usePublishCedarContext('currentDate', currentDate, {
    showInChat: false,
  });

  usePublishCedarContext('currentTime', currentTime, {
    showInChat: false,
  });

  usePublishCedarContext('weekJournals', weekViewData, {
    showInChat: false,
  });

  usePublishCedarContext('taskLists', taskListsData, {
    showInChat: false,
  });

  usePublishCedarContext('jobListings', jobListingsData, {
    showInChat: false,
  });

  usePublishCedarContext('jobApplications', jobApplicationsData, {
    showInChat: false,
  });

  usePublishCedarContext('projectRoadmaps', projectRoadmapsData, {
    showInChat: false,
  });

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
    <div className="relative min-h-screen w-full bg-white pb-40 dark:bg-gray-900">
      {/* Desktop-only utility links (top-right, absolute) */}
      <div className="hidden sm:flex absolute top-4 right-4 z-10 items-center gap-2">
        <Link
          href="/omi-transcripts"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Transcripts
        </Link>
        <Link
          href="/projects"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Projects View
        </Link>
        <Link
          href="/jobs"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Jobs
        </Link>
        <SettingsPopover currentMode={chatMode} onModeChange={handleChatModeChange} />
      </div>

      {/* Mobile-only top chrome row: flows above WeekView so the absolute desktop
          chrome can keep its current position without touching mobile layout. */}
      <div className="sm:hidden flex items-center justify-end gap-2 px-3 pt-3">
        <Link
          href="/omi-transcripts"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Transcripts
        </Link>
        <Link
          href="/projects"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Projects
        </Link>
        <Link
          href="/jobs"
          className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white shadow-sm transition-colors"
        >
          Jobs
        </Link>
        <SettingsPopover currentMode={chatMode} onModeChange={handleChatModeChange} />
      </div>

      {/* Week View */}
      <div className="pt-2 sm:pt-16 pb-4">
        <WeekView onDataChange={setWeekViewData} />
      </div>

      {/* Task Lists */}
      <TaskLists onDataChange={setTaskListsData} />

      {/* Text lines added by the agent's changeText/addNewTextLine tools */}
      {textLines.length > 0 && (
        <div className="flex flex-col items-center justify-center p-8 space-y-8">
          <div className="w-full max-w-2xl">
            <h3 className="text-xl font-medium text-gray-700 dark:text-gray-200 mb-4 text-center">
              Added by Cedar:
            </h3>
            <div className="space-y-2">
              {textLines.map((line, index) => (
                <div
                  key={index}
                  className="p-3 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg text-center"
                >
                  {line.startsWith('**') && line.endsWith('**') ? (
                    <strong className="text-blue-800 dark:text-blue-200">
                      {line.slice(2, -2)}
                    </strong>
                  ) : line.startsWith('*') && line.endsWith('*') ? (
                    <em className="text-blue-700 dark:text-blue-300">{line.slice(1, -1)}</em>
                  ) : line.startsWith('🌟') ? (
                    <span className="text-yellow-600 dark:text-yellow-400 font-semibold">
                      {line}
                    </span>
                  ) : (
                    <span className="text-blue-800 dark:text-blue-200">{line}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {effectiveChatMode === 'caption' && <CedarCaptionChat />}

      {effectiveChatMode === 'floating' && (
        <FloatingCedarChat side="right" title="Cedarling Chat" collapsedLabel="Chat with Cedar" />
      )}
    </div>
  );

  if (effectiveChatMode === 'sidepanel') {
    return (
      <SidePanelCedarChat
        side="right"
        title="Cedarling Chat"
        collapsedLabel="Chat with Cedar"
        showCollapsedButton={true}
        initialMessage={systemMessage}
      >
        {process.env.NODE_ENV === 'development' && <DebuggerPanel />}
        {renderContent()}
      </SidePanelCedarChat>
    );
  }

  return renderContent();
}
