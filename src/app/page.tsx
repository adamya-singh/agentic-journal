'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { z } from 'zod';
import {
  useRegisterState,
  useRegisterFrontendTool,
  useSubscribeStateToAgentContext,
  useCedarStore,
} from 'cedar-os';

import { Shell } from '@/components/layout/Shell';
import { TodayFocus } from '@/components/features/TodayFocus';
import { SmartInput } from '@/components/features/SmartInput';
import { TaskListsData, Task, ListType } from '@/components/TaskLists';
import { WeekViewData } from '@/components/WeekView';

import { ChatModeSelector } from '@/components/ChatModeSelector';
import { CedarCaptionChat } from '@/cedar/components/chatComponents/CedarCaptionChat';
import { FloatingCedarChat } from '@/cedar/components/chatComponents/FloatingCedarChat';
import { SidePanelCedarChat } from '@/cedar/components/chatComponents/SidePanelCedarChat';
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
 * Get current time in 12-hour format
 */
function getCurrentTime(): string {
  const now = new Date();
  let hours = now.getHours();
  const minutes = now.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  return `${hours}:${minutesStr} ${ampm}`;
}

export default function HomePage() {
  const [chatMode, setChatMode] = useState<ChatMode>('sidepanel');
  const [currentDate, setCurrentDate] = useState(getCurrentDateISO());
  const [currentTime, setCurrentTime] = useState(getCurrentTime());

  // Data states
  const [weekViewData, setWeekViewData] = useState<WeekViewData | null>(null);
  const [taskListsData, setTaskListsData] = useState<TaskListsData | null>(null);

  const { refreshTasks, refreshAll, taskRefreshCounter, journalRefreshCounter } = useRefresh();

  // === DATA FETCHING ===
  const fetchTasks = useCallback(async () => {
    try {
      // Parallel fetch for general lists and today's lists
      const [haveRes, wantRes, haveTodayRes, wantTodayRes] = await Promise.all([
        fetch('/api/tasks/list?listType=have-to-do'),
        fetch('/api/tasks/list?listType=want-to-do'),
        fetch(`/api/tasks/today/list?listType=have-to-do&date=${currentDate}`),
        fetch(`/api/tasks/today/list?listType=want-to-do&date=${currentDate}`)
      ]);

      const [haveData, wantData, haveTodayData, wantTodayData] = await Promise.all([
        haveRes.json(), wantRes.json(), haveTodayRes.json(), wantTodayRes.json()
      ]);

      if (haveData.success && wantData.success && haveTodayData.success && wantTodayData.success) {
        setTaskListsData({
          generalTasks: {
            haveToDo: haveData.tasks,
            wantToDo: wantData.tasks
          },
          todayTasks: {
            haveToDo: haveTodayData.tasks,
            wantToDo: wantTodayData.tasks
          },
          currentDate
        });
      }
    } catch (e) {
      console.error("Failed to fetch tasks", e);
    }
  }, [currentDate]);

  // Fetches week data (journals) - used for passing journal data to TodayFocus
  // Logic adapted from WeekView but lifted up
  const fetchWeekJournals = useCallback(async () => {
    try {
      // Calculate week dates based on currentDate (simplified: just fetch current week of the selected date)
      // Ideally we fetch a range around the date. For now, let's just fetch the *selected date* + neighbours if needed.
      // Or simpler: Just fetch the single date journal for TodayFocus?
      // WeekView expected `WeekViewData` (map of dates). 
      // Let's stick to fetching the single date for `TodayFocus` usage mostly, 
      // but `WeekRail` (inside Shell) might want 7 days.

      // Let's re-use the logic to get Monday-Sunday around the current date.
      // (Simplified: just fetch current date for now to ensure TodayFocus works, WeekRail might just show dates)
      // If WeekRail needs data, we should implement full week fetching.

      // Fetch specific date journal
      const res = await fetch('/api/journal/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: [currentDate], resolve: true }),
      });
      const data = await res.json();

      if (data.success) {
        setWeekViewData({
          weekDates: [], // Populate if needed
          weekData: data.journals
        });
      }
    } catch (e) {
      console.error("Failed to fetch journal", e);
    }
  }, [currentDate]);

  // Sync fetches
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks, taskRefreshCounter]);

  useEffect(() => {
    fetchWeekJournals();
  }, [fetchWeekJournals, journalRefreshCounter]);


  // === SMART INPUT HANDLER ===
  const handleSmartAddTask = async (text: string, listType: ListType, dueDate?: string) => {
    try {
      // 1. Create the task in general list
      const createRes = await fetch('/api/tasks/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          listType,
          dueDate
        }),
      });
      const createData = await createRes.json();

      if (createData.success) {
        const taskId = createData.task.id;

        // 2. If due today (or just added today without specific future date), add to Today's list
        const todayISO = getCurrentDateISO();
        const shouldAddToToday = !dueDate || dueDate === todayISO || dueDate === currentDate;

        if (shouldAddToToday) {
          await fetch('/api/tasks/today/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              taskId,
              taskText: text,
              listType,
              date: currentDate,
              dueDate
            }),
          });
        }

        refreshTasks(); // Refresh UI
      }
    } catch (e) {
      console.error("Smart Add Failed", e);
    }
  };


  // === CEDAR STATE & TOOLS ===

  // Watch for 'addTask' tool calls from the Agent (via Stream)
  const messages = useCedarStore((state) => state.messages);
  const processedToolCallIds = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!messages || messages.length === 0) return;
    for (const message of messages) {
      if (
        message.type === 'tool-result' &&
        message.payload?.toolName === 'addTask' &&
        message.payload?.result?.success &&
        message.payload?.result?.task &&
        message.payload?.toolCallId
      ) {
        const toolCallId = message.payload.toolCallId;
        if (processedToolCallIds.current.has(toolCallId)) continue;
        processedToolCallIds.current.add(toolCallId);

        // Trigger refresh
        refreshTasks();
      }
    }
  }, [messages, refreshTasks]);


  // Register States
  useRegisterState({
    key: 'currentDate',
    description: 'Current date',
    value: currentDate,
    setValue: setCurrentDate
  });

  useRegisterState({
    key: 'currentTime',
    description: 'Current time',
    value: currentTime,
    setValue: setCurrentTime
  });

  useRegisterState({
    key: 'taskLists',
    description: 'Task lists',
    value: taskListsData,
    setValue: setTaskListsData
  });

  useRegisterState({
    key: 'weekJournals',
    description: 'Week journals',
    value: weekViewData,
    setValue: setWeekViewData
  });

  // Subscribe to Agent Context
  useSubscribeStateToAgentContext('taskLists', (val) => ({ taskLists: val }), { showInChat: false });
  useSubscribeStateToAgentContext('weekJournals', (val) => ({ weekJournals: val }), { showInChat: false });


  // Register Frontend Tool: Add Text Line (Legacy/Demo support)
  const [textLines, setTextLines] = useState<string[]>([]); // eslint-disable-line @typescript-eslint/no-unused-vars
  useRegisterFrontendTool({
    name: 'addNewTextLine',
    description: 'Add a new line of text to the screen',
    argsSchema: z.object({
      text: z.string().min(1).describe('The text to add'),
      style: z.enum(['normal', 'bold', 'italic', 'highlight']).optional()
    }),
    execute: async (args) => {
      // no-op for now in new UI, or could display toast
      console.log("Agent added text line:", args.text);
    },
  });


  return (
    <div className="relative min-h-screen w-full bg-white dark:bg-gray-900">

      {/* Main Layout */}
      <Shell
        currentDate={currentDate}
        onDateSelect={setCurrentDate}
        weekData={weekViewData}
        tasks={taskListsData?.generalTasks}
      >
        <TodayFocus
          date={currentDate}
          journalData={weekViewData?.weekData?.[currentDate]}
          todayTasks={taskListsData?.todayTasks}
          onTaskUpdate={refreshAll}
        />
      </Shell>

      {/* Global Input Bar (Fixed at bottom center typically, or handled by SmartInput CSS) */}
      <SmartInput onAddTask={handleSmartAddTask} />

      {/* Chat Overlays */}
      <ChatModeSelector currentMode={chatMode} onModeChange={setChatMode} />

      {chatMode === 'floating' && <FloatingCedarChat />}
      {chatMode === 'sidepanel' && <SidePanelCedarChat />}
      {chatMode === 'caption' && <CedarCaptionChat />}

    </div>
  );
}
