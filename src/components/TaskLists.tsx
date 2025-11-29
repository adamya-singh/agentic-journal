'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { PriorityComparisonModal } from './PriorityComparisonModal';

// Exported for cedar state
export interface Task {
  text: string;
  dueDate?: string;
}

export type ListType = 'have-to-do' | 'want-to-do';

// Data structure for cedar context
export interface TaskListsData {
  generalTasks: {
    haveToDo: Task[];
    wantToDo: Task[];
  };
  todayTasks: {
    haveToDo: Task[];
    wantToDo: Task[];
  };
  currentDate: string;
}

interface TaskListsProps {
  onDataChange?: (data: TaskListsData) => void;
  refreshTrigger?: number;
}

interface TaskListProps {
  title: string;
  tasks: Task[];
  loading: boolean;
  error: string | null;
  accentColor: string;
  bgColor: string;
  buttonColor: string;
  onTaskClick?: (task: Task) => void;
  clickedTasks?: Set<string>;
  onAddClick?: () => void;
}

function TaskList({ 
  title, 
  tasks, 
  loading, 
  error, 
  accentColor, 
  bgColor,
  buttonColor,
  onTaskClick,
  clickedTasks,
  onAddClick
}: TaskListProps) {
  const orderedTasks = tasks;

  const headerContent = (
    <div className={`px-4 py-3 ${bgColor} border-b border-gray-200 flex items-center justify-between`}>
      <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
      {onAddClick && (
        <button
          onClick={onAddClick}
          className={`px-3 py-1 rounded-md text-sm font-medium text-white ${buttonColor} transition-colors`}
        >
          +
        </button>
      )}
    </div>
  );

  if (loading) {
    return (
      <div className="flex-1 rounded-lg border border-gray-200 bg-white overflow-hidden">
        {headerContent}
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 rounded-lg border border-gray-200 bg-white overflow-hidden">
        {headerContent}
        <div className="p-4 text-center text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-lg border border-gray-200 bg-white overflow-hidden">
      {headerContent}
      <div className="p-4 min-h-[120px] max-h-[300px] overflow-y-auto">
        {orderedTasks.length > 0 ? (
          <ol className="space-y-2 list-decimal list-inside">
            {orderedTasks.map((task, index) => {
              const isInToday = clickedTasks?.has(task.text);
              return (
                <li 
                  key={index} 
                  className={`text-sm text-gray-700 ${onTaskClick ? 'cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 transition-colors' : ''} ${isInToday ? 'bg-green-50 text-green-700' : ''}`}
                  onClick={() => onTaskClick?.(task)}
                >
                  <span>{task.text}</span>
                  {task.dueDate && (
                    <span className="ml-2 text-xs text-gray-400">
                      (due: {task.dueDate})
                    </span>
                  )}
                  {isInToday && (
                    <span className="ml-2 text-xs text-green-600">✓ in today</span>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm italic">
            No tasks
          </div>
        )}
      </div>
    </div>
  );
}

interface TodayTaskListProps {
  title: string;
  tasks: Task[];
  loading: boolean;
  error: string | null;
  accentColor: string;
  bgColor: string;
  onRemove?: (task: Task) => void;
}

function TodayTaskList({ title, tasks, loading, error, accentColor, bgColor, onRemove }: TodayTaskListProps) {
  const orderedTasks = tasks;

  if (loading) {
    return (
      <div className="flex-1 rounded-lg border-2 border-dashed border-gray-300 bg-white overflow-hidden">
        <div className={`px-4 py-3 ${bgColor} border-b border-gray-200`}>
          <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
        </div>
        <div className="p-4 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 rounded-lg border-2 border-dashed border-gray-300 bg-white overflow-hidden">
        <div className={`px-4 py-3 ${bgColor} border-b border-gray-200`}>
          <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
        </div>
        <div className="p-4 text-center text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-lg border-2 border-dashed border-gray-300 bg-white overflow-hidden">
      <div className={`px-4 py-3 ${bgColor} border-b border-gray-200`}>
        <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
      </div>
      <div className="p-4 min-h-[80px] max-h-[200px] overflow-y-auto">
        {orderedTasks.length > 0 ? (
          <ol className="space-y-2 list-decimal list-inside">
            {orderedTasks.map((task, index) => (
              <li key={index} className="text-sm text-gray-700 flex items-center justify-between group">
                <span className="flex-1">
                  <span>{task.text}</span>
                  {task.dueDate && (
                    <span className="ml-2 text-xs text-gray-400">
                      (due: {task.dueDate})
                    </span>
                  )}
                </span>
                {onRemove && (
                  <button
                    onClick={() => onRemove(task)}
                    className="ml-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-60 hover:opacity-100"
                    title="Remove from today"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm italic">
            Click tasks above to add to today
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Get current date in MMDDYY format
 */
function getCurrentDateMMDDYY(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  return `${month}${day}${year}`;
}

export function TaskLists({ onDataChange, refreshTrigger }: TaskListsProps) {
  const [currentDate] = useState(getCurrentDateMMDDYY());
  
  // Modal state
  const [showTaskModal, setShowTaskModal] = useState(false);
  const [activeListType, setActiveListType] = useState<ListType>('have-to-do');
  
  // General task lists
  const [haveToDo, setHaveToDo] = useState<Task[]>([]);
  const [wantToDo, setWantToDo] = useState<Task[]>([]);
  const [loadingHave, setLoadingHave] = useState(true);
  const [loadingWant, setLoadingWant] = useState(true);
  const [errorHave, setErrorHave] = useState<string | null>(null);
  const [errorWant, setErrorWant] = useState<string | null>(null);

  // Today's task lists
  const [haveToDoToday, setHaveToDoToday] = useState<Task[]>([]);
  const [wantToDoToday, setWantToDoToday] = useState<Task[]>([]);
  const [loadingHaveToday, setLoadingHaveToday] = useState(true);
  const [loadingWantToday, setLoadingWantToday] = useState(true);
  const [errorHaveToday, setErrorHaveToday] = useState<string | null>(null);
  const [errorWantToday, setErrorWantToday] = useState<string | null>(null);

  // Track which tasks are in today's lists
  const [todayHaveTasks, setTodayHaveTasks] = useState<Set<string>>(new Set());
  const [todayWantTasks, setTodayWantTasks] = useState<Set<string>>(new Set());

  // Notify parent when task data changes
  useEffect(() => {
    const isLoading = loadingHave || loadingWant || loadingHaveToday || loadingWantToday;
    if (onDataChange && !isLoading) {
      onDataChange({
        generalTasks: {
          haveToDo,
          wantToDo,
        },
        todayTasks: {
          haveToDo: haveToDoToday,
          wantToDo: wantToDoToday,
        },
        currentDate,
      });
    }
  }, [
    haveToDo,
    wantToDo,
    haveToDoToday,
    wantToDoToday,
    loadingHave,
    loadingWant,
    loadingHaveToday,
    loadingWantToday,
    currentDate,
    onDataChange,
  ]);

  // Fetch general tasks
  const fetchGeneralTasks = useCallback(async () => {
    // Fetch have-to-do
    try {
      const haveRes = await fetch('/api/tasks/list?listType=have-to-do');
      const haveData = await haveRes.json();
      if (haveData.success) {
        setHaveToDo(haveData.tasks);
      } else {
        setErrorHave(haveData.error || 'Failed to fetch');
      }
    } catch {
      setErrorHave('Failed to connect');
    } finally {
      setLoadingHave(false);
    }

    // Fetch want-to-do
    try {
      const wantRes = await fetch('/api/tasks/list?listType=want-to-do');
      const wantData = await wantRes.json();
      if (wantData.success) {
        setWantToDo(wantData.tasks);
      } else {
        setErrorWant(wantData.error || 'Failed to fetch');
      }
    } catch {
      setErrorWant('Failed to connect');
    } finally {
      setLoadingWant(false);
    }
  }, []);

  useEffect(() => {
    fetchGeneralTasks();
  }, [fetchGeneralTasks]);

  // Fetch today's tasks
  const fetchTodayTasks = useCallback(async () => {
    // Fetch have-to-do today
    try {
      const haveRes = await fetch(`/api/tasks/today/list?listType=have-to-do&date=${currentDate}`);
      const haveData = await haveRes.json();
      if (haveData.success) {
        setHaveToDoToday(haveData.tasks);
        setTodayHaveTasks(new Set(haveData.tasks.map((t: Task) => t.text)));
      } else {
        setErrorHaveToday(haveData.error || 'Failed to fetch');
      }
    } catch {
      setErrorHaveToday('Failed to connect');
    } finally {
      setLoadingHaveToday(false);
    }

    // Fetch want-to-do today
    try {
      const wantRes = await fetch(`/api/tasks/today/list?listType=want-to-do&date=${currentDate}`);
      const wantData = await wantRes.json();
      if (wantData.success) {
        setWantToDoToday(wantData.tasks);
        setTodayWantTasks(new Set(wantData.tasks.map((t: Task) => t.text)));
      } else {
        setErrorWantToday(wantData.error || 'Failed to fetch');
      }
    } catch {
      setErrorWantToday('Failed to connect');
    } finally {
      setLoadingWantToday(false);
    }
  }, [currentDate]);

  useEffect(() => {
    fetchTodayTasks();
  }, [fetchTodayTasks]);

  // Re-fetch when refreshTrigger changes (triggered by Cedar state setters)
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      fetchGeneralTasks();
      fetchTodayTasks();
    }
  }, [refreshTrigger, fetchGeneralTasks, fetchTodayTasks]);

  // Handler to add task to today's list
  const handleAddToToday = async (task: Task, listType: ListType) => {
    try {
      const response = await fetch('/api/tasks/today/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskText: task.text,
          listType,
          date: currentDate,
          dueDate: task.dueDate,
        }),
      });
      
      const data = await response.json();
      if (data.success && !data.alreadyExists) {
        // Refresh today's tasks
        fetchTodayTasks();
      }
    } catch (error) {
      console.error('Failed to add task to today:', error);
    }
  };

  // Handler to remove task from today's list
  const handleRemoveFromToday = async (task: Task, listType: ListType) => {
    try {
      const response = await fetch('/api/tasks/today/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskText: task.text,
          listType,
          date: currentDate,
        }),
      });
      
      const data = await response.json();
      if (data.success && data.removed) {
        // Refresh today's tasks
        fetchTodayTasks();
      }
    } catch (error) {
      console.error('Failed to remove task from today:', error);
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 pb-4">
      <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">Tasks</h2>
      
      {/* Today's Task Lists */}
      <h3 className="text-lg font-medium text-gray-600 mb-3 text-center">Today ({currentDate})</h3>
      <div className="flex gap-4 mb-4">
        <TodayTaskList
          title="Have to Do Today"
          tasks={haveToDoToday}
          loading={loadingHaveToday}
          error={errorHaveToday}
          accentColor="text-amber-700"
          bgColor="bg-amber-100"
          onRemove={(task) => handleRemoveFromToday(task, 'have-to-do')}
        />
        <TodayTaskList
          title="Want to Do Today"
          tasks={wantToDoToday}
          loading={loadingWantToday}
          error={errorWantToday}
          accentColor="text-teal-700"
          bgColor="bg-teal-100"
          onRemove={(task) => handleRemoveFromToday(task, 'want-to-do')}
        />
      </div>

      {/* General Task Lists */}
      <div className="flex gap-4">
        <TaskList
          title="Have to Do"
          tasks={haveToDo}
          loading={loadingHave}
          error={errorHave}
          accentColor="text-amber-600"
          bgColor="bg-amber-50"
          buttonColor="bg-amber-500 hover:bg-amber-600"
          onTaskClick={(task) => handleAddToToday(task, 'have-to-do')}
          clickedTasks={todayHaveTasks}
          onAddClick={() => {
            setActiveListType('have-to-do');
            setShowTaskModal(true);
          }}
        />
        <TaskList
          title="Want to Do"
          tasks={wantToDo}
          loading={loadingWant}
          error={errorWant}
          accentColor="text-teal-600"
          bgColor="bg-teal-50"
          buttonColor="bg-teal-500 hover:bg-teal-600"
          onTaskClick={(task) => handleAddToToday(task, 'want-to-do')}
          clickedTasks={todayWantTasks}
          onAddClick={() => {
            setActiveListType('want-to-do');
            setShowTaskModal(true);
          }}
        />
      </div>

      {/* Add Task Modal */}
      <PriorityComparisonModal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        onTaskAdded={fetchGeneralTasks}
        listType={activeListType}
      />
    </div>
  );
}
