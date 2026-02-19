'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { EntryMode, PlanStatus, ResolvedJournalEntry, ResolvedJournalRangeEntry, ResolvedStagedEntry, ListType, Task } from '@/lib/types';
import { UnscheduledTasksPopover, StagedEntry } from './UnscheduledTasksPopover';
import { AddToPlanModal } from './AddToPlanModal';
import { useRefresh } from '@/lib/RefreshContext';

// Resolved hour slot can be single entry, array of entries, or null
type ResolvedHourSlot = ResolvedJournalEntry | ResolvedJournalEntry[] | null;

// Resolved journal data with ranges and staged - entries resolved to display format
export type ResolvedDayJournalWithRanges = {
  [hour: string]: ResolvedHourSlot;
} & {
  ranges?: ResolvedJournalRangeEntry[];
  staged?: ResolvedStagedEntry[];
  indicators?: number; // 0-10 indicators per day
};

// Week data type - exported for cedar state (uses resolved entries)
export type WeekData = Record<string, ResolvedDayJournalWithRanges | null>;

// Entry with type indicator for rendering
export interface TypedEntry {
  hour: string;       // For single-hour entries, this is the hour. For ranges, this is "start-end" format
  text: string;
  entryMode: EntryMode;
  entryKind: 'task' | 'text'; // Task/text identity from resolved journal data
  planId?: string;
  taskId?: string;
  listType?: ListType;
  planStatus?: PlanStatus;
  completed?: boolean;
  isRange?: boolean;  // True if this is a range entry
  startHour?: string; // For sorting range entries by their start time
  endHour?: string;
}

type DayViewMode = 'planned' | 'logged';
type PlanActionType = 'in-progress' | 'complete';

// Re-export StagedEntry from popover component for backward compatibility
export type { StagedEntry } from './UnscheduledTasksPopover';

export interface DayInfo {
  date: string; // ISO format (YYYY-MM-DD)
  dayName: string; // e.g., "Mon"
  displayDate: string; // e.g., "11/25"
}

export interface WeekViewData {
  weekDates: DayInfo[];
  weekData: WeekData;
}

interface WeekViewProps {
  onDataChange?: (data: WeekViewData) => void;
  refreshTrigger?: number;
}

/**
 * Get the Monday-Sunday dates for a week relative to the current week
 * @param offset - Number of weeks to offset (0 = current week, -1 = last week, 1 = next week)
 */
function getWeekDates(offset: number = 0): DayInfo[] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Calculate Monday of the current week
  // If today is Sunday (0), go back 6 days to get Monday
  // Otherwise, go back (dayOfWeek - 1) days
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday + (offset * 7)); // Add offset weeks
  
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekDates: DayInfo[] = [];
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    weekDates.push({
      date: `${year}-${month}-${day}`,
      dayName: dayNames[i],
      displayDate: `${month}/${day}`,
    });
  }
  
  return weekDates;
}

// Canonical hour order used for general day traversal and API hour shape
const HOUR_ORDER = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];
const CARRY_BACK_HOURS = ['12am', '1am', '2am'];
// Week view display order shows early morning (3am-6am) before daytime hours.
const DISPLAY_HOUR_ORDER = ['3am', '4am', '5am', '6am', '7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am'];
const DISPLAY_PRIMARY_HOURS = DISPLAY_HOUR_ORDER.filter(hour => !CARRY_BACK_HOURS.includes(hour));

function addDaysISO(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  const nextYear = d.getFullYear();
  const nextMonth = String(d.getMonth() + 1).padStart(2, '0');
  const nextDay = String(d.getDate()).padStart(2, '0');
  return `${nextYear}-${nextMonth}-${nextDay}`;
}

/**
 * Compose a display journal for a day:
 * - Keep 3am-11pm from the current day
 * - Pull 12am-2am from the next day so late-night appears at bottom of prior day
 */
function composeDisplayJournal(
  currentDayJournal: ResolvedDayJournalWithRanges | null | undefined,
  nextDayJournal: ResolvedDayJournalWithRanges | null | undefined
): ResolvedDayJournalWithRanges | null {
  if (!currentDayJournal && !nextDayJournal) {
    return null;
  }

  const composed: ResolvedDayJournalWithRanges = {};

  for (const hour of DISPLAY_PRIMARY_HOURS) {
    composed[hour] = currentDayJournal?.[hour] ?? null;
  }
  for (const hour of CARRY_BACK_HOURS) {
    composed[hour] = nextDayJournal?.[hour] ?? null;
  }

  const currentRanges = currentDayJournal?.ranges ?? [];
  const nextRanges = nextDayJournal?.ranges ?? [];
  composed.ranges = [
    ...currentRanges.filter(range => !CARRY_BACK_HOURS.includes(range.start)),
    ...nextRanges.filter(range => CARRY_BACK_HOURS.includes(range.start)),
  ];

  composed.staged = currentDayJournal?.staged ?? [];

  if (typeof currentDayJournal?.indicators === 'number' && currentDayJournal.indicators > 0) {
    composed.indicators = currentDayJournal.indicators;
  }

  return composed;
}

/**
 * Get current hour in API format (e.g., "3pm", "10am")
 */
function getCurrentHour(): string {
  const now = new Date();
  const hours = now.getHours();
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hours12 = hours % 12 || 12;
  return `${hours12}${ampm}`;
}

/**
 * Check whether a task already has a logged actual in the journal.
 */
function checkIfTaskLogged(journal: ResolvedDayJournalWithRanges | null | undefined, taskId: string): boolean {
  if (!journal) return false;
  
  // Check hourly slots
  for (const hour of HOUR_ORDER) {
    const slot = journal[hour];
    if (!slot) continue;
    
    if (Array.isArray(slot)) {
      if (slot.some((e) => e?.taskId === taskId && e?.entryMode === 'logged')) return true;
    } else if (slot?.taskId === taskId && slot.entryMode === 'logged') {
      return true;
    }
  }
  
  // Check ranges
  if (journal.ranges && Array.isArray(journal.ranges)) {
    if (journal.ranges.some((r) => r.taskId === taskId && r.entryMode === 'logged')) return true;
  }
  
  return false;
}

/**
 * Helper to process a single resolved entry into a TypedEntry
 */
function processResolvedEntry(hour: string, entry: ResolvedJournalEntry): TypedEntry | null {
  if (!entry || typeof entry !== 'object' || !('text' in entry) || !entry.text || entry.text.trim() === '') {
    return null;
  }
  return {
    hour,
    text: entry.text,
    entryMode: entry.entryMode,
    entryKind: entry.type,
    planId: entry.planId,
    taskId: entry.taskId,
    listType: entry.listType,
    planStatus: entry.planStatus,
    completed: entry.completed,
    startHour: hour,
  };
}

/**
 * Get entries from a unified journal source.
 */
function getEntriesFromJournal(journal: ResolvedDayJournalWithRanges | null): TypedEntry[] {
  const entries: TypedEntry[] = [];
  
  if (!journal) {
    return entries;
  }
  
  // Process hourly entries (supports both single entries and arrays)
  for (const hour of DISPLAY_HOUR_ORDER) {
    const slot = journal[hour];
    
    if (!slot) continue;
    
    if (Array.isArray(slot)) {
      // Multiple entries for this hour
      for (const entry of slot) {
        const typedEntry = processResolvedEntry(hour, entry);
        if (typedEntry) {
          entries.push(typedEntry);
        }
      }
    } else {
      // Single entry
      const typedEntry = processResolvedEntry(hour, slot as ResolvedJournalEntry);
      if (typedEntry) {
        entries.push(typedEntry);
      }
    }
  }
  
  // Process range entries
  if (journal.ranges && Array.isArray(journal.ranges)) {
    for (const range of journal.ranges) {
      if (range.text && range.text.trim() !== '') {
        entries.push({
          hour: `${range.start}-${range.end}`,
          text: range.text,
          entryMode: range.entryMode,
          entryKind: range.type,
          planId: range.planId,
          taskId: range.taskId,
          listType: range.listType,
          planStatus: range.planStatus,
          completed: range.completed,
          isRange: true,
          startHour: range.start,
          endHour: range.end,
        });
      }
    }
  }
  
  // Sort all entries by start hour, then by entry mode (planned before logged at same hour)
  entries.sort((a, b) => {
    const aIdx = DISPLAY_HOUR_ORDER.indexOf(a.startHour || a.hour);
    const bIdx = DISPLAY_HOUR_ORDER.indexOf(b.startHour || b.hour);
    if (aIdx !== bIdx) return aIdx - bIdx;
    // If same start hour, show planned before logged
    if (a.entryMode === 'planned' && b.entryMode === 'logged') return -1;
    if (a.entryMode === 'logged' && b.entryMode === 'planned') return 1;
    return 0;
  });
  
  return entries;
}

/**
 * Get staged (unscheduled) entries from a journal
 */
function getStagedFromJournal(journal: ResolvedDayJournalWithRanges | null): StagedEntry[] {
  if (!journal || !journal.staged || !Array.isArray(journal.staged)) {
    return [];
  }
  
  return journal.staged
    .filter(entry => entry.text && entry.text.trim() !== '')
    .map(entry => ({
      text: entry.text,
      taskId: entry.taskId,
      listType: entry.listType,
      completed: entry.completed,
    }));
}

function getDefaultDayViewMode(entries: TypedEntry[]): DayViewMode {
  return entries.some((entry) => entry.entryMode === 'logged') ? 'logged' : 'planned';
}

export function WeekView({ onDataChange, refreshTrigger }: WeekViewProps) {
  const { journalRefreshCounter, refreshTasks } = useRefresh();
  
  // Week offset: 0 = current week, -1 = last week, 1 = next week
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekDates, setWeekDates] = useState<DayInfo[]>(() => getWeekDates(0));
  const [weekData, setWeekData] = useState<WeekData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indicators, setIndicators] = useState<Record<string, number>>({});
  const [dayViewMode, setDayViewMode] = useState<Record<string, DayViewMode>>({});
  
  // Update weekDates when offset changes
  useEffect(() => {
    setWeekDates(getWeekDates(weekOffset));
  }, [weekOffset]);
  
  // Track which days have their unscheduled popover expanded (default: only today)
  const [expandedPopovers, setExpandedPopovers] = useState<Record<string, boolean>>({});
  
  // Schedule modal state for unscheduled tasks
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [scheduleTask, setScheduleTask] = useState<{ task: Task; date: string } | null>(null);
  const [planActionModal, setPlanActionModal] = useState<{
    date: string;
    planId: string;
    text: string;
    entryKind: 'task' | 'text';
    taskId?: string;
    listType?: ListType;
    source: { kind: 'hour'; hour: string } | { kind: 'range'; start: string; end: string };
    x: number;
    y: number;
  } | null>(null);
  const [planActionInFlight, setPlanActionInFlight] = useState<PlanActionType | null>(null);
  const closePlanActionModalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Toggle popover expansion for a specific date
  const togglePopover = useCallback((date: string) => {
    // Calculate if this date is today for default value
    const today = new Date();
    const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const isToday = date === todayDate;
    setExpandedPopovers(prev => ({
      ...prev,
      [date]: !(prev[date] ?? isToday), // Default to expanded only for today
    }));
  }, []);

  // Fetch week data function
  const fetchWeekData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const visibleDates = weekDates.map(d => d.date);
      const spilloverDate = visibleDates.length > 0
        ? addDaysISO(visibleDates[visibleDates.length - 1], 1)
        : null;
      const datesToFetch = spilloverDate ? [...visibleDates, spilloverDate] : visibleDates;
      
      // Fetch journals with resolved entry metadata (including entryMode)
      const journalResponse = await fetch('/api/journal/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: datesToFetch, resolve: true }),
      });
      
      const journalData = await journalResponse.json();
      
      if (journalData.success) {
        setWeekData(journalData.journals);
        // Extract indicators from journal data
        const newIndicators: Record<string, number> = {};
        for (const date of visibleDates) {
          const journal = journalData.journals[date];
          if (journal?.indicators && typeof journal.indicators === 'number') {
            newIndicators[date] = journal.indicators;
          }
        }
        setIndicators(newIndicators);
      } else {
        setError(journalData.error || 'Failed to fetch journals');
      }
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [weekDates]);

  // Add or remove an indicator for a specific date
  const updateIndicator = useCallback(async (date: string, action: 'add' | 'remove') => {
    const currentCount = indicators[date] ?? 0;
    const newCount = action === 'add' 
      ? Math.min(currentCount + 1, 10) 
      : Math.max(currentCount - 1, 0);
    
    // Optimistic update
    setIndicators(prev => ({
      ...prev,
      [date]: newCount,
    }));
    
    try {
      const response = await fetch('/api/journal/indicator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, action }),
      });
      
      const result = await response.json();
      
      if (!result.success) {
        // Revert on failure
        setIndicators(prev => ({
          ...prev,
          [date]: currentCount,
        }));
      }
    } catch {
      // Revert on error
      setIndicators(prev => ({
        ...prev,
        [date]: currentCount,
      }));
    }
  }, [indicators]);

  // Handler for completing a task from the popover
  const handleCompleteTask = useCallback(async (entry: StagedEntry, date: string) => {
    try {
      // Check if task already has a logged entry (use weekData from state)
      const journal = weekData[date];
      const isAlreadyLogged = checkIfTaskLogged(journal, entry.taskId);
      
      // Only append if there is no logged actual yet for this task/day.
      if (!isAlreadyLogged) {
        await fetch('/api/journal/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date,
            hour: getCurrentHour(),
            taskId: entry.taskId,
            listType: entry.listType,
            entryMode: 'logged',
          }),
        });
      }

      // Mark task as complete (always)
      await fetch('/api/tasks/today/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: entry.taskId,
          listType: entry.listType,
          date,
        }),
      });
      
      // Refresh data
      fetchWeekData();
      // Notify TaskLists to refresh (task was modified)
      refreshTasks();
    } catch (error) {
      console.error('Failed to complete task:', error);
    }
  }, [fetchWeekData, weekData, refreshTasks]);

  // Handler for "Starting now" - logs to journal that task is starting
  const handleStartTask = useCallback(async (entry: StagedEntry, date: string) => {
    try {
      // First ensure task is in today's list
      await fetch('/api/tasks/today/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: entry.taskId,
          taskText: entry.text,
          listType: entry.listType,
          date,
        }),
      });

      // Then log to journal
      await fetch('/api/journal/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          hour: getCurrentHour(),
          taskId: entry.taskId,
          listType: entry.listType,
          entryMode: 'logged',
        }),
      });

      // Refresh data
      fetchWeekData();
      // Notify TaskLists to refresh (task was modified)
      refreshTasks();
    } catch (error) {
      console.error('Failed to start task:', error);
    }
  }, [fetchWeekData, refreshTasks]);

  // Handler for opening schedule modal
  const handleScheduleTask = useCallback((entry: StagedEntry, date: string) => {
    // Convert StagedEntry to Task format for the modal
    const task: Task = {
      id: entry.taskId,
      text: entry.text,
      completed: entry.completed,
    };
    setScheduleTask({ task, date });
    setShowScheduleModal(true);
  }, []);

  const clearPlanActionModalCloseTimer = useCallback(() => {
    if (closePlanActionModalTimerRef.current) {
      clearTimeout(closePlanActionModalTimerRef.current);
      closePlanActionModalTimerRef.current = null;
    }
  }, []);

  const closePlanActionModal = useCallback(() => {
    clearPlanActionModalCloseTimer();
    setPlanActionModal(null);
  }, [clearPlanActionModalCloseTimer]);

  const scheduleClosePlanActionModal = useCallback((delayMs: number = 140) => {
    clearPlanActionModalCloseTimer();
    closePlanActionModalTimerRef.current = setTimeout(() => {
      setPlanActionModal(null);
      closePlanActionModalTimerRef.current = null;
    }, delayMs);
  }, [clearPlanActionModalCloseTimer]);

  const openPlanActionModal = useCallback((
    eventTarget: HTMLElement,
    payload: {
      date: string;
      planId: string;
      text: string;
      entryKind: 'task' | 'text';
      taskId?: string;
      listType?: ListType;
      source: { kind: 'hour'; hour: string } | { kind: 'range'; start: string; end: string };
    }
  ) => {
    clearPlanActionModalCloseTimer();
    const rect = eventTarget.getBoundingClientRect();
    setPlanActionModal({
      ...payload,
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  }, [clearPlanActionModalCloseTimer]);

  const handlePlanAction = useCallback(async (action: PlanActionType) => {
    if (!planActionModal || planActionInFlight) {
      return;
    }

    try {
      setPlanActionInFlight(action);
      const response = await fetch('/api/journal/plan-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: planActionModal.date,
          planId: planActionModal.planId,
          source: planActionModal.source,
          action,
        }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        return;
      }
      closePlanActionModal();
      fetchWeekData();
      refreshTasks();
    } catch (error) {
      console.error('Failed to apply plan action:', error);
    } finally {
      setPlanActionInFlight(null);
    }
  }, [planActionModal, planActionInFlight, closePlanActionModal, fetchWeekData, refreshTasks]);

  // Initial fetch on mount
  useEffect(() => {
    fetchWeekData();
  }, [fetchWeekData]);

  // Re-fetch when refreshTrigger changes (triggered by Cedar state setters)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      fetchWeekData();
    }
  }, [refreshTrigger, fetchWeekData]);

  // Re-fetch when journalRefreshCounter changes (triggered by RefreshContext)
  useEffect(() => {
    if (journalRefreshCounter > 0) {
      fetchWeekData();
    }
  }, [journalRefreshCounter, fetchWeekData]);

  useEffect(() => {
    return () => {
      if (closePlanActionModalTimerRef.current) {
        clearTimeout(closePlanActionModalTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!planActionModal) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest('[data-plan-action-modal="true"]') || target.closest('[data-plan-action-trigger="true"]')) {
        return;
      }
      closePlanActionModal();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closePlanActionModal();
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('touchstart', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('touchstart', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [planActionModal, closePlanActionModal]);

  // Notify parent when data changes
  useEffect(() => {
    if (onDataChange && !loading) {
      onDataChange({ weekDates, weekData });
    }
  }, [weekData, weekDates, loading, onDataChange]);

  // Generate dynamic title based on offset (for loading/error states)
  const getWeekTitleStatic = () => {
    if (weekOffset === 0) return 'This Week';
    if (weekOffset === -1) return 'Last Week';
    if (weekOffset === 1) return 'Next Week';
    return `Week of ${weekDates[0]?.displayDate ?? ''}`;
  };

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <div className="flex items-center justify-center gap-4 mb-4">
          <button
            onClick={() => setWeekOffset(prev => prev - 1)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Previous week"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200">{getWeekTitleStatic()}</h2>
          <button
            onClick={() => setWeekOffset(prev => prev + 1)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Next week"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="ml-2 px-3 py-1 text-sm rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
            >
              Today
            </button>
          )}
        </div>
        <div className="grid grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-64 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <div className="flex items-center justify-center gap-4 mb-4">
          <button
            onClick={() => setWeekOffset(prev => prev - 1)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Previous week"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200">{getWeekTitleStatic()}</h2>
          <button
            onClick={() => setWeekOffset(prev => prev + 1)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            aria-label="Next week"
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="ml-2 px-3 py-1 text-sm rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
            >
              Today
            </button>
          )}
        </div>
        <div className="text-center text-red-500 dark:text-red-400">{error}</div>
      </div>
    );
  }

  // Calculate today's date once for comparison and grid template
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  // Create dynamic grid template: today's column gets 1.5fr, others get 1fr
  const gridTemplateColumns = weekDates
    .map(dayInfo => dayInfo.date === todayDate ? '1.5fr' : '1fr')
    .join(' ');

  // Generate dynamic title based on offset
  const getWeekTitle = () => {
    if (weekOffset === 0) return 'This Week';
    if (weekOffset === -1) return 'Last Week';
    if (weekOffset === 1) return 'Next Week';
    return `Week of ${weekDates[0]?.displayDate ?? ''}`;
  };

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      {/* Week navigation header */}
      <div className="flex items-center justify-center gap-4 mb-4">
        <button
          onClick={() => setWeekOffset(prev => prev - 1)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Previous week"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200">
          {getWeekTitle()}
        </h2>
        
        <button
          onClick={() => setWeekOffset(prev => prev + 1)}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          aria-label="Next week"
        >
          <svg className="w-5 h-5 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        
        {/* Today button - only shown when not on current week */}
        {weekOffset !== 0 && (
          <button
            onClick={() => setWeekOffset(0)}
            className="ml-2 px-3 py-1 text-sm rounded-lg bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-200 dark:hover:bg-indigo-800 transition-colors"
          >
            Today
          </button>
        )}
      </div>
      {/* Legend */}
      <div className="flex justify-center gap-6 mb-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500"></span>
          <span className="text-gray-600 dark:text-gray-400">Unscheduled</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-teal-500"></span>
          <span className="text-gray-600 dark:text-gray-400">Planned</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500"></span>
          <span className="text-gray-600 dark:text-gray-400">Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-gray-500"></span>
          <span className="text-gray-600 dark:text-gray-400">Logged</span>
        </div>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns }}>
        {weekDates.map((dayInfo, dayIndex) => {
          const currentDayJournal = weekData[dayInfo.date];
          const nextDayJournal = weekData[addDaysISO(dayInfo.date, 1)];
          const displayJournal = composeDisplayJournal(currentDayJournal, nextDayJournal);
          const entries = getEntriesFromJournal(displayJournal);
          const plannedEntries = entries.filter((entry) => entry.entryMode === 'planned');
          const loggedEntries = entries.filter((entry) => entry.entryMode === 'logged');
          const activeMode = dayViewMode[dayInfo.date] ?? getDefaultDayViewMode(entries);
          const visibleEntries = activeMode === 'planned' ? plannedEntries : loggedEntries;
          const nextMode: DayViewMode = activeMode === 'planned' ? 'logged' : 'planned';
          const activeLabel = activeMode === 'planned' ? 'Plans' : 'Logs';
          const nextLabel = nextMode === 'planned' ? 'Plans' : 'Logs';
          const activeCount = activeMode === 'planned' ? plannedEntries.length : loggedEntries.length;
          const activePlanCount = plannedEntries.filter((entry) => (entry.planStatus ?? 'active') === 'active').length;
          const missedPlanCount = plannedEntries.filter((entry) => entry.planStatus === 'missed').length;
          const replannedPlanCount = plannedEntries.filter((entry) => entry.planStatus === 'rescheduled').length;
          const completedPlanCount = plannedEntries.filter((entry) => entry.planStatus === 'completed').length;
          const stagedEntries = getStagedFromJournal(currentDayJournal);
          const isToday = dayInfo.date === todayDate;
          // Days on the right side of the week (Thu-Sun, index 3-6) should have popover on left
          const popoverPosition = dayIndex >= 3 ? 'left' : 'right';

          return (
            <div
              key={dayInfo.date}
              className={`flex flex-col rounded-lg border overflow-hidden ${
                isToday
                  ? 'border-indigo-400 dark:border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 shadow-md'
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              {/* Date header */}
              <div
                className={`px-3 py-2 text-center border-b ${
                  isToday
                    ? 'bg-indigo-500 dark:bg-indigo-600 text-white border-indigo-400 dark:border-indigo-500'
                    : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{dayInfo.dayName}</span>
                  <span className="text-sm opacity-80">{dayInfo.displayDate}</span>
                </div>
                <div className="mt-1 flex items-center justify-center gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDayViewMode((prev) => ({ ...prev, [dayInfo.date]: nextMode }));
                    }}
                    aria-label={`Showing ${activeLabel.toLowerCase()} entries for ${dayInfo.dayName} ${dayInfo.displayDate}. Click to show ${nextLabel.toLowerCase()} entries.`}
                    title={`Showing ${activeLabel}. Click to switch to ${nextLabel}.`}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-1 ${
                      isToday
                        ? 'border-indigo-200/70 bg-white text-indigo-700 hover:bg-indigo-50'
                        : 'border-gray-300 dark:border-gray-500 bg-white/90 dark:bg-gray-800/80 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    <span>{activeLabel}</span>
                    {activeCount > 0 && <span className="opacity-75">{activeCount}</span>}
                    <svg className="h-3.5 w-3.5 opacity-60" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M3 10a1 1 0 011-1h9.586L11.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414-1.414L13.586 11H4a1 1 0 01-1-1z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {activeMode === 'planned' && plannedEntries.length > 0 && (
                    <div className="ml-1 flex items-center gap-1 text-[10px]">
                      {activePlanCount > 0 && <span className="rounded bg-teal-100 px-1.5 py-0.5 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">A {activePlanCount}</span>}
                      {missedPlanCount > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">M {missedPlanCount}</span>}
                      {replannedPlanCount > 0 && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-slate-700 dark:bg-slate-700 dark:text-slate-200">R {replannedPlanCount}</span>}
                      {completedPlanCount > 0 && <span className="rounded bg-green-100 px-1.5 py-0.5 text-green-700 dark:bg-green-900/40 dark:text-green-300">C {completedPlanCount}</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 ml-1">
                    {/* Render existing indicators */}
                    {Array.from({ length: indicators[dayInfo.date] || 0 }).map((_, idx) => (
                      <button
                        key={`indicator-${dayInfo.date}-${idx}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          updateIndicator(dayInfo.date, 'remove');
                        }}
                        className="w-2 h-2 transition-all duration-150 hover:opacity-70"
                        style={{ 
                          backgroundColor: '#091e9f',
                          border: '1px solid black',
                        }}
                        title="Remove indicator"
                        aria-label="Remove indicator"
                      />
                    ))}
                    {/* Add button (only show if less than 10 indicators) */}
                    {(indicators[dayInfo.date] || 0) < 10 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updateIndicator(dayInfo.date, 'add');
                        }}
                        className="w-2 h-2 transition-all duration-150 opacity-20 hover:opacity-60"
                        style={{ 
                          backgroundColor: '#091e9f',
                          border: '1px solid black',
                        }}
                        title="Add indicator"
                        aria-label="Add indicator"
                      />
                    )}
                  </div>
                  {/* Unscheduled tasks popover badge */}
                  {stagedEntries.length > 0 && (
                    <div className="ml-2">
                      <UnscheduledTasksPopover
                        entries={stagedEntries}
                        isExpanded={expandedPopovers[dayInfo.date] ?? isToday}
                        onToggle={() => togglePopover(dayInfo.date)}
                        isToday={isToday}
                        positionHint={popoverPosition}
                        onComplete={(entry) => handleCompleteTask(entry, dayInfo.date)}
                        onStartTask={(entry) => handleStartTask(entry, dayInfo.date)}
                        onSchedule={(entry) => handleScheduleTask(entry, dayInfo.date)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Journal and plan entries */}
              <div className="flex-1 p-2 min-h-[200px] max-h-[300px] overflow-y-auto">
                {visibleEntries.length > 0 ? (
                  <div
                    key={`${dayInfo.date}-${activeMode}`}
                    className="space-y-2 animate-[weekviewFadeSlide_150ms_ease-out] motion-reduce:animate-none"
                  >
                    {/* Scheduled entries */}
                    {visibleEntries.map(({ hour, text, entryMode, entryKind, planId, taskId, listType, planStatus, completed, isRange, startHour, endHour }, index) => {
                      const isTask = entryKind === 'task' && Boolean(taskId);
                      const isCompleted = isTask
                        ? (completed === true || planStatus === 'completed')
                        : entryMode === 'planned' && planStatus === 'completed';
                      const isMissedPlan = entryMode === 'planned' && planStatus === 'missed';
                      const isRescheduledPlan = entryMode === 'planned' && planStatus === 'rescheduled';
                      const isActionablePlanEntry =
                        activeMode === 'planned' &&
                        entryMode === 'planned' &&
                        Boolean(planId);
                      const textPlanSource = isRange && startHour && endHour
                        ? { kind: 'range' as const, start: startHour, end: endHour }
                        : { kind: 'hour' as const, hour };
                      const suffixLabel = isCompleted
                        ? '(done)'
                        : isMissedPlan
                          ? '(missed)'
                          : isRescheduledPlan
                            ? '(replanned)'
                        : activeMode === 'planned' && isTask
                          ? '(task)'
                          : null;
                      
                      return (
                        <div key={`${hour}-${entryMode}-${index}`} className="text-sm">
                          <span className={`font-medium ${
                            isCompleted
                              ? 'text-green-600 dark:text-green-400'
                              : isMissedPlan
                                ? 'text-amber-600 dark:text-amber-400'
                                : isRescheduledPlan
                                  ? 'text-slate-500 dark:text-slate-400'
                              : entryMode === 'planned' 
                                ? 'text-teal-600 dark:text-teal-400' 
                                : isToday 
                                  ? 'text-indigo-600 dark:text-indigo-400' 
                                  : 'text-gray-500 dark:text-gray-400'
                          }`}>
                            {hour}:
                          </span>{' '}
                          <span
                            data-plan-action-trigger={isActionablePlanEntry ? 'true' : undefined}
                            role={isActionablePlanEntry ? 'button' : undefined}
                            tabIndex={isActionablePlanEntry ? 0 : undefined}
                            onMouseEnter={isActionablePlanEntry && planId ? (event) => {
                              openPlanActionModal(event.currentTarget, {
                                date: dayInfo.date,
                                planId,
                                text,
                                entryKind,
                                taskId,
                                listType,
                                source: textPlanSource,
                              });
                            } : undefined}
                            onMouseLeave={isActionablePlanEntry ? () => scheduleClosePlanActionModal() : undefined}
                            onFocus={isActionablePlanEntry && planId ? (event) => {
                              openPlanActionModal(event.currentTarget, {
                                date: dayInfo.date,
                                planId,
                                text,
                                entryKind,
                                taskId,
                                listType,
                                source: textPlanSource,
                              });
                            } : undefined}
                            onBlur={isActionablePlanEntry ? () => scheduleClosePlanActionModal() : undefined}
                            onClick={isActionablePlanEntry && planId ? (event) => {
                              event.stopPropagation();
                              openPlanActionModal(event.currentTarget, {
                                date: dayInfo.date,
                                planId,
                                text,
                                entryKind,
                                taskId,
                                listType,
                                source: textPlanSource,
                              });
                            } : undefined}
                            onKeyDown={isActionablePlanEntry && planId ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openPlanActionModal(event.currentTarget, {
                                  date: dayInfo.date,
                                  planId,
                                  text,
                                  entryKind,
                                  taskId,
                                  listType,
                                  source: textPlanSource,
                                });
                              }
                            } : undefined}
                            className={`${
                            isCompleted 
                              ? 'text-green-600 dark:text-green-400 line-through' 
                              : isMissedPlan
                                ? 'text-amber-700 dark:text-amber-300'
                                : isRescheduledPlan
                                  ? 'text-slate-600 dark:text-slate-300'
                              : entryMode === 'planned' 
                                ? 'text-teal-700 dark:text-teal-300' 
                                : 'text-gray-700 dark:text-gray-300'
                          } ${isActionablePlanEntry ? 'cursor-pointer hover:underline underline-offset-2 focus:outline-none focus:ring-1 focus:ring-teal-400 rounded-sm' : ''}`}>
                            {text}
                          </span>
                          {suffixLabel && (
                            <span className={`ml-1 text-xs italic ${
                              isCompleted
                                ? 'text-green-500 dark:text-green-400'
                                : isMissedPlan
                                  ? 'text-amber-500 dark:text-amber-400'
                                  : isRescheduledPlan
                                    ? 'text-slate-500 dark:text-slate-400'
                                    : 'text-teal-500 dark:text-teal-400'
                            }`}>
                              {suffixLabel}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm italic">
                    {activeMode === 'planned' ? 'No planned entries' : 'No logged entries'}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {planActionModal && (
        <div
          data-plan-action-modal="true"
          className="fixed z-50 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 shadow-lg"
          style={{
            left: `${planActionModal.x}px`,
            top: `${planActionModal.y}px`,
            transform: 'translate(-50%, -100%)',
          }}
          onMouseEnter={clearPlanActionModalCloseTimer}
          onMouseLeave={() => scheduleClosePlanActionModal()}
        >
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {planActionModal.source.kind === 'hour'
              ? `${planActionModal.source.hour} plan`
              : `${planActionModal.source.start}-${planActionModal.source.end} plan`}
          </p>
          <p className="mt-1 text-sm text-gray-700 dark:text-gray-200 line-clamp-2">
            {planActionModal.text}
          </p>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closePlanActionModal}
              className="px-2 py-1 text-xs rounded text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => handlePlanAction('in-progress')}
              disabled={planActionInFlight !== null}
              className="px-2.5 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {planActionInFlight === 'in-progress' ? 'Saving...' : 'In Progress'}
            </button>
            <button
              type="button"
              onClick={() => handlePlanAction('complete')}
              disabled={planActionInFlight !== null}
              className="px-2.5 py-1 text-xs rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              {planActionInFlight === 'complete' ? 'Saving...' : 'Mark Complete'}
            </button>
          </div>
        </div>
      )}

      {/* Schedule task modal */}
      <AddToPlanModal
        isOpen={showScheduleModal}
        onClose={() => {
          setShowScheduleModal(false);
          setScheduleTask(null);
          fetchWeekData(); // Refresh after modal closes
        }}
        onSuccess={() => {
          // Notify TaskLists that journal was modified
          refreshTasks();
        }}
        task={scheduleTask?.task ?? null}
        listType={scheduleTask?.task ? 
          (weekData[scheduleTask.date]?.staged?.find(s => s.taskId === scheduleTask.task.id)?.listType ?? 'have-to-do') 
          : 'have-to-do'}
        date={scheduleTask?.date ?? ''}
      />
      <style jsx>{`
        @keyframes weekviewFadeSlide {
          from {
            opacity: 0;
            transform: translateY(2px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
