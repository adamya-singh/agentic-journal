'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ResolvedPlanEntry, ListType } from '@/lib/types';

// Journal entry type - exported for cedar state
export type DayJournal = Record<string, string>;

// Resolved plan data - entries resolved to display format
export type ResolvedDayPlan = Record<string, ResolvedPlanEntry | null>;

// Week data type - exported for cedar state
export type WeekData = Record<string, DayJournal | null>;

// Week plan data type - now uses resolved entries
export type WeekPlanData = Record<string, ResolvedDayPlan | null>;

// Entry with type indicator for rendering
export interface TypedEntry {
  hour: string;
  text: string;
  type: 'journal' | 'plan';
  taskId?: string;
  listType?: ListType;
  completed?: boolean;
}

export interface DayInfo {
  date: string; // MMDDYY format
  dayName: string; // e.g., "Mon"
  displayDate: string; // e.g., "11/25"
}

export interface WeekViewData {
  weekDates: DayInfo[];
  weekData: WeekData;
  weekPlanData: WeekPlanData;
}

interface WeekViewProps {
  onDataChange?: (data: WeekViewData) => void;
  refreshTrigger?: number;
}

/**
 * Get the Monday-Sunday dates for the current week
 */
function getCurrentWeekDates(): DayInfo[] {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // Calculate Monday of the current week
  // If today is Sunday (0), go back 6 days to get Monday
  // Otherwise, go back (dayOfWeek - 1) days
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(now);
  monday.setDate(now.getDate() - daysToMonday);
  
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const weekDates: DayInfo[] = [];
  
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    
    weekDates.push({
      date: `${month}${day}${year}`,
      dayName: dayNames[i],
      displayDate: `${month}/${day}`,
    });
  }
  
  return weekDates;
}

/**
 * Get combined entries from both journal and resolved plan, with type indicators
 */
function getCombinedEntries(journal: DayJournal | null, plan: ResolvedDayPlan | null): TypedEntry[] {
  const entries: TypedEntry[] = [];
  const allHours = new Set<string>();
  
  // Collect all hours that have entries
  if (journal) {
    Object.keys(journal).forEach(hour => allHours.add(hour));
  }
  if (plan) {
    Object.keys(plan).forEach(hour => allHours.add(hour));
  }
  
  // Sort hours in chronological order
  const hourOrder = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];
  const sortedHours = Array.from(allHours).sort((a, b) => hourOrder.indexOf(a) - hourOrder.indexOf(b));
  
  for (const hour of sortedHours) {
    const planEntry = plan?.[hour];
    const journalText = journal?.[hour];
    
    // Add plan entry first (if exists and has text)
    if (planEntry && planEntry.text && planEntry.text.trim() !== '') {
      entries.push({ 
        hour, 
        text: planEntry.text, 
        type: 'plan',
        taskId: planEntry.taskId,
        listType: planEntry.listType,
        completed: planEntry.completed,
      });
    }
    
    // Add journal entry (if exists)
    if (journalText && journalText.trim() !== '') {
      entries.push({ hour, text: journalText, type: 'journal' });
    }
  }
  
  return entries;
}

export function WeekView({ onDataChange, refreshTrigger }: WeekViewProps) {
  const [weekDates] = useState<DayInfo[]>(getCurrentWeekDates);
  const [weekData, setWeekData] = useState<WeekData>({});
  const [weekPlanData, setWeekPlanData] = useState<WeekPlanData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch week data function
  const fetchWeekData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const dates = weekDates.map(d => d.date);
      
      // Fetch both journals and plans in parallel
      // Use resolve=true to get task details
      const [journalResponse, planResponse] = await Promise.all([
        fetch('/api/journal/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dates }),
        }),
        fetch('/api/plans/read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dates, resolve: true }),
        }),
      ]);
      
      const journalData = await journalResponse.json();
      const planData = await planResponse.json();
      
      if (journalData.success) {
        setWeekData(journalData.journals);
      } else {
        setError(journalData.error || 'Failed to fetch journals');
      }
      
      if (planData.success) {
        setWeekPlanData(planData.plans);
      }
      // Don't error if plans fail - they're optional
    } catch {
      setError('Failed to connect to server');
    } finally {
      setLoading(false);
    }
  }, [weekDates]);

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

  // Notify parent when data changes
  useEffect(() => {
    if (onDataChange && !loading) {
      onDataChange({ weekDates, weekData, weekPlanData });
    }
  }, [weekData, weekPlanData, weekDates, loading, onDataChange]);

  if (loading) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">This Week</h2>
        <div className="grid grid-cols-7 gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-64 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-7xl mx-auto p-4">
        <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">This Week</h2>
        <div className="text-center text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-7xl mx-auto p-4">
      <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">This Week</h2>
      {/* Legend */}
      <div className="flex justify-center gap-6 mb-4 text-sm">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-teal-500"></span>
          <span className="text-gray-600">Planned</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500"></span>
          <span className="text-gray-600">Completed</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-gray-500"></span>
          <span className="text-gray-600">Journal</span>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-3">
        {weekDates.map((dayInfo) => {
          const entries = getCombinedEntries(weekData[dayInfo.date], weekPlanData[dayInfo.date]);
          const isToday = dayInfo.date === weekDates.find(d => {
            const today = new Date();
            const month = String(today.getMonth() + 1).padStart(2, '0');
            const day = String(today.getDate()).padStart(2, '0');
            const year = String(today.getFullYear()).slice(-2);
            return d.date === `${month}${day}${year}`;
          })?.date;

          return (
            <div
              key={dayInfo.date}
              className={`flex flex-col rounded-lg border overflow-hidden ${
                isToday
                  ? 'border-indigo-400 bg-indigo-50 shadow-md'
                  : 'border-gray-200 bg-white'
              }`}
            >
              {/* Date header */}
              <div
                className={`px-3 py-2 text-center border-b ${
                  isToday
                    ? 'bg-indigo-500 text-white border-indigo-400'
                    : 'bg-gray-50 text-gray-700 border-gray-200'
                }`}
              >
                <div className="font-semibold">{dayInfo.dayName}</div>
                <div className="text-sm opacity-80">{dayInfo.displayDate}</div>
              </div>

              {/* Journal and plan entries */}
              <div className="flex-1 p-2 min-h-[200px] max-h-[300px] overflow-y-auto">
                {entries.length > 0 ? (
                  <div className="space-y-2">
                    {entries.map(({ hour, text, type, taskId, completed }, index) => {
                      const isTask = type === 'plan' && taskId;
                      const isCompleted = isTask && completed;
                      
                      return (
                        <div key={`${hour}-${type}-${index}`} className="text-sm">
                          <span className={`font-medium ${
                            isCompleted
                              ? 'text-green-600'
                              : type === 'plan' 
                                ? 'text-teal-600' 
                                : isToday 
                                  ? 'text-indigo-600' 
                                  : 'text-gray-500'
                          }`}>
                            {hour}:
                          </span>{' '}
                          <span className={`${
                            isCompleted 
                              ? 'text-green-600 line-through' 
                              : type === 'plan' 
                                ? 'text-teal-700' 
                                : 'text-gray-700'
                          }`}>
                            {text}
                          </span>
                          {type === 'plan' && (
                            <span className={`ml-1 text-xs italic ${
                              isCompleted ? 'text-green-500' : 'text-teal-500'
                            }`}>
                              {isCompleted ? '(done)' : isTask ? '(task)' : '(plan)'}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-400 text-sm italic">
                    No entries
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
