'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { PriorityComparisonModal } from './PriorityComparisonModal';
import { AddToPlanModal } from './AddToPlanModal';

// Exported for cedar state
export interface Task {
  id: string;
  text: string;
  dueDate?: string;
  completed?: boolean;
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
  onDelete?: (task: Task) => void;
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
  onAddClick,
  onDelete
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
            {orderedTasks.map((task) => {
              const isInToday = clickedTasks?.has(task.id);
              return (
                <li 
                  key={task.id} 
                  className={`text-sm text-gray-700 flex items-center justify-between group ${onTaskClick ? 'cursor-pointer hover:bg-gray-50 rounded px-2 py-1 -mx-2 transition-colors' : ''} ${isInToday ? 'bg-green-50 text-green-700' : ''}`}
                >
                  <span 
                    className="flex-1"
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
                  </span>
                  {onDelete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(task);
                      }}
                      className="ml-2 p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete task"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
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
  onComplete?: (task: Task) => void;
  onAddToPlan?: (task: Task) => void;
}

function TodayTaskList({ title, tasks, loading, error, accentColor, bgColor, onRemove, onComplete, onAddToPlan }: TodayTaskListProps) {
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
            {orderedTasks.map((task) => (
              <li 
                key={task.id} 
                className={`text-sm flex items-center justify-between group ${
                  task.completed ? 'text-gray-400' : 'text-gray-700'
                }`}
              >
                <span className="flex items-center flex-1">
                  {onComplete && (
                    <button
                      onClick={() => onComplete(task)}
                      className={`mr-2 p-1 rounded transition-colors ${
                        task.completed 
                          ? 'text-green-500 hover:text-green-700 hover:bg-green-50' 
                          : 'text-gray-300 hover:text-green-500 hover:bg-green-50'
                      }`}
                      title={task.completed ? 'Mark as incomplete' : 'Mark as done'}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )}
                  <span className={task.completed ? 'line-through' : ''}>{task.text}</span>
                  {task.dueDate && (
                    <span className={`ml-2 text-xs ${task.completed ? 'text-gray-300' : 'text-gray-400'}`}>
                      (due: {task.dueDate})
                    </span>
                  )}
                </span>
                {onAddToPlan && (
                  <button
                    onClick={() => onAddToPlan(task)}
                    className="ml-2 p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors opacity-60 hover:opacity-100"
                    title="Add to daily plan"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
                {onRemove && !task.completed && (
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
  
  // Add to plan modal state
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planTask, setPlanTask] = useState<Task | null>(null);
  const [planListType, setPlanListType] = useState<ListType>('have-to-do');
  
  // Delete confirmation modal state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [taskToDelete, setTaskToDelete] = useState<{ task: Task; listType: ListType } | null>(null);
  
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
        setTodayHaveTasks(new Set(haveData.tasks.map((t: Task) => t.id)));
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
        setTodayWantTasks(new Set(wantData.tasks.map((t: Task) => t.id)));
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
          taskId: task.id,
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
          taskId: task.id,
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

  // Handler to toggle task completion status
  const handleCompleteTask = async (task: Task, listType: ListType) => {
    try {
      const response = await fetch('/api/tasks/today/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          listType,
          date: currentDate,
        }),
      });
      
      const data = await response.json();
      if (data.success) {
        // Refresh both today's tasks and general tasks (since completion affects both)
        fetchTodayTasks();
        fetchGeneralTasks();
      }
    } catch (error) {
      console.error('Failed to toggle task completion:', error);
    }
  };

  // Handler to open add to plan modal
  const handleAddToPlan = (task: Task, listType: ListType) => {
    setPlanTask(task);
    setPlanListType(listType);
    setShowPlanModal(true);
  };

  // Handler to show delete confirmation
  const confirmDeleteTask = (task: Task, listType: ListType) => {
    setTaskToDelete({ task, listType });
    setShowDeleteConfirm(true);
  };

  // Handler to actually delete the task after confirmation
  const handleDeleteTask = async () => {
    if (!taskToDelete) return;
    
    try {
      const response = await fetch('/api/tasks/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: taskToDelete.task.text,
          listType: taskToDelete.listType,
        }),
      });
      
      const data = await response.json();
      if (data.success && data.removed) {
        // Refresh both general and today's tasks
        fetchGeneralTasks();
        fetchTodayTasks();
      }
    } catch (error) {
      console.error('Failed to delete task:', error);
    } finally {
      setShowDeleteConfirm(false);
      setTaskToDelete(null);
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
          onComplete={(task) => handleCompleteTask(task, 'have-to-do')}
          onAddToPlan={(task) => handleAddToPlan(task, 'have-to-do')}
        />
        <TodayTaskList
          title="Want to Do Today"
          tasks={wantToDoToday}
          loading={loadingWantToday}
          error={errorWantToday}
          accentColor="text-teal-700"
          bgColor="bg-teal-100"
          onRemove={(task) => handleRemoveFromToday(task, 'want-to-do')}
          onComplete={(task) => handleCompleteTask(task, 'want-to-do')}
          onAddToPlan={(task) => handleAddToPlan(task, 'want-to-do')}
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
          onDelete={(task) => confirmDeleteTask(task, 'have-to-do')}
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
          onDelete={(task) => confirmDeleteTask(task, 'want-to-do')}
        />
      </div>

      {/* Add Task Modal */}
      <PriorityComparisonModal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        onTaskAdded={fetchGeneralTasks}
        listType={activeListType}
      />

      {/* Add to Plan Modal */}
      <AddToPlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        task={planTask}
        listType={planListType}
        date={currentDate}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && taskToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Delete Task?</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to permanently delete this task?
            </p>
            <div className="bg-gray-50 rounded p-3 mb-4">
              <p className="text-sm text-gray-700 font-medium">{taskToDelete.task.text}</p>
              {taskToDelete.task.dueDate && (
                <p className="text-xs text-gray-500 mt-1">Due: {taskToDelete.task.dueDate}</p>
              )}
            </div>
            <p className="text-xs text-red-500 mb-4">
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setTaskToDelete(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteTask()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-md transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
