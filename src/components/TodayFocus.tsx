'use client';

import React from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  GripVertical,
  Pencil,
  Play,
  Plus,
  X,
} from 'lucide-react';
import { AddToPlanModal } from '@/components/AddToPlanModal';
import { EditTaskModal } from '@/components/EditTaskModal';
import { TaskNotesPreview } from '@/components/TaskNotesPreview';
import { TaskTextWithProjectBadges } from '@/components/TaskTextWithProjectBadges';
import { useRefresh } from '@/lib/RefreshContext';
import { completeTaskWithLogging, getCurrentHourLabel } from '@/lib/task-actions';
import { formatDueTimeRangeForDisplay } from '@/lib/due-time';
import type { TaskListsData } from '@/components/TaskLists';
import type { ListType, Task } from '@/lib/types';

interface TodayFocusProps {
  data: TaskListsData | null;
}

type Slice = 'today' | 'current';

interface ColumnConfig {
  listType: ListType;
  title: string;
  accent: string;
}

const COLUMNS: ColumnConfig[] = [
  { listType: 'have-to-do', title: 'Have to Do', accent: 'text-amber-700 dark:text-amber-400' },
  { listType: 'want-to-do', title: 'Want to Do', accent: 'text-teal-700 dark:text-teal-400' },
];

export function TodayFocus({ data }: TodayFocusProps) {
  const { refreshTasks, refreshJournal } = useRefresh();
  const [expandedNotes, setExpandedNotes] = React.useState<Set<string>>(new Set());
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null);
  const [planTask, setPlanTask] = React.useState<{ task: Task; listType: ListType } | null>(null);
  const [editTask, setEditTask] = React.useState<{ task: Task; listType: ListType } | null>(null);
  const [dragTaskId, setDragTaskId] = React.useState<string | null>(null);

  const currentDate = data?.currentDate ?? '';

  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return response.json();
  };

  const handleComplete = async (task: Task, listType: ListType) => {
    setBusyTaskId(task.id);
    try {
      const result = await completeTaskWithLogging({
        taskId: task.id,
        listType,
        date: currentDate,
        wasCompleted: task.completed === true,
      });
      if (!result.success) {
        if (result.blockedByOpenSubtasks) {
          window.alert('This task has open subtasks — complete those first (they are in the classic view or Library).');
          return;
        }
        throw new Error(result.error || 'Failed to toggle completion');
      }
      refreshJournal();
      refreshTasks();
      if (result.promptToCompleteParent && result.parentTask) {
        const confirmed = window.confirm(
          `That finished the last open subtask for "${result.parentTask.text}". Complete the parent task too?`,
        );
        if (confirmed) {
          await completeTaskWithLogging({
            taskId: result.parentTask.id,
            listType: result.parentTask.listType,
            date: currentDate,
            wasCompleted: false,
          });
          refreshTasks();
        }
      }
    } catch (error) {
      console.error('Failed to toggle completion:', error);
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleStart = async (task: Task, listType: ListType) => {
    setBusyTaskId(task.id);
    try {
      await post('/api/journal/append', {
        date: currentDate,
        hour: getCurrentHourLabel(),
        taskId: task.id,
        listType,
        entryMode: 'logged',
      });
      refreshJournal();
      refreshTasks();
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleAddToToday = async (task: Task, listType: ListType) => {
    setBusyTaskId(task.id);
    try {
      await post('/api/tasks/today/add', { taskId: task.id, listType, date: currentDate });
      refreshTasks();
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleRemove = async (task: Task, listType: ListType, slice: Slice) => {
    setBusyTaskId(task.id);
    try {
      if (slice === 'today') {
        await post('/api/tasks/today/remove', { taskId: task.id, listType, date: currentDate });
      } else {
        await post('/api/tasks/current/remove', { taskId: task.id, listType });
      }
      refreshTasks();
    } finally {
      setBusyTaskId(null);
    }
  };

  const handleDrop = async (targetTask: Task, listType: ListType) => {
    if (!dragTaskId || dragTaskId === targetTask.id || !data) return;
    const queue = listType === 'have-to-do' ? data.currentTasks.haveToDo : data.currentTasks.wantToDo;
    const newPosition = queue.findIndex((task) => task.id === targetTask.id);
    if (newPosition < 0) return;
    await post('/api/tasks/current/reorder', { taskId: dragTaskId, listType, newPosition });
    setDragTaskId(null);
    refreshTasks();
  };

  const toggleNotes = (taskId: string) => {
    setExpandedNotes((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const renderRow = (task: Task, listType: ListType, slice: Slice, options: { draggable?: boolean; inToday?: boolean } = {}) => {
    const completed = task.completed === true;
    const busy = busyTaskId === task.id;
    return (
      <li
        key={`${slice}-${task.id}`}
        className={`group flex items-start gap-2 px-2.5 py-1.5 rounded-md hover:bg-gray-50 dark:hover:bg-gray-800/60 ${
          dragTaskId === task.id ? 'opacity-40' : ''
        }`}
        draggable={options.draggable === true}
        onDragStart={options.draggable ? () => setDragTaskId(task.id) : undefined}
        onDragOver={options.draggable ? (event) => event.preventDefault() : undefined}
        onDrop={options.draggable ? () => handleDrop(task, listType) : undefined}
        onDragEnd={() => setDragTaskId(null)}
      >
        {options.draggable && (
          <span className="mt-1 shrink-0 cursor-grab text-gray-300 dark:text-gray-600 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
            <GripVertical className="w-3.5 h-3.5" />
          </span>
        )}
        <button
          onClick={() => handleComplete(task, listType)}
          disabled={busy}
          className="mt-0.5 shrink-0 text-gray-300 hover:text-green-500 dark:text-gray-600 dark:hover:text-green-400 disabled:opacity-40"
          title={completed ? 'Uncomplete' : 'Complete'}
        >
          {completed ? (
            <CheckCircle2 className="w-[18px] h-[18px] text-green-500 dark:text-green-400" />
          ) : (
            <Circle className="w-[18px] h-[18px]" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-1.5">
            <TaskTextWithProjectBadges
              text={task.text}
              projects={task.projects}
              textClassName={
                completed
                  ? 'text-sm text-gray-400 dark:text-gray-500 line-through'
                  : 'text-sm text-gray-800 dark:text-gray-100'
              }
            />
            {task.isDaily && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300">
                Daily
              </span>
            )}
            {slice === 'today' && options.inToday !== false && task.parentTaskText && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700/70 dark:text-slate-200">
                ↳ {task.parentTaskText}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 text-[11px] text-gray-400 dark:text-gray-500">
            {task.dueDate && (
              <span>
                due {task.dueDate}
                {task.dueTimeStart && ` @ ${formatDueTimeRangeForDisplay(task.dueTimeStart, task.dueTimeEnd)}`}
              </span>
            )}
            {task.notesMarkdown && (
              <button
                onClick={() => toggleNotes(task.id)}
                className="inline-flex items-center gap-0.5 text-blue-500 hover:text-blue-700 dark:hover:text-blue-300"
              >
                {expandedNotes.has(task.id) ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                notes
              </button>
            )}
          </div>
          {expandedNotes.has(task.id) && task.notesMarkdown && (
            <div className="mt-1 rounded bg-gray-50 dark:bg-gray-800/60 px-2 py-1.5">
              <TaskNotesPreview markdown={task.notesMarkdown} />
            </div>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
          {!completed && (
            <button
              onClick={() => handleStart(task, listType)}
              disabled={busy}
              className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-40"
              title="Starting now — log to journal"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setPlanTask({ task, listType })}
            className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:text-indigo-400 dark:hover:bg-indigo-900/30"
            title="Schedule for a specific time"
          >
            <Clock className="w-3.5 h-3.5" />
          </button>
          {slice === 'current' && options.inToday === false && !completed && (
            <button
              onClick={() => handleAddToToday(task, listType)}
              disabled={busy}
              className="p-1 rounded text-gray-400 hover:text-green-600 hover:bg-green-50 dark:hover:text-green-400 dark:hover:bg-green-900/30 disabled:opacity-40"
              title="Add to Today"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => setEditTask({ task, listType })}
            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700"
            title="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => handleRemove(task, listType, slice)}
            disabled={busy}
            className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-40"
            title={slice === 'today' ? 'Remove from Today' : 'Remove from Current'}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </li>
    );
  };

  const renderColumn = (column: ColumnConfig) => {
    if (!data) return null;
    const key = column.listType === 'have-to-do' ? 'haveToDo' : 'wantToDo';
    const today = data.todayTasks[key];
    const current = data.currentTasks[key];
    const todayIds = new Set([
      ...today.selectedTasks.map((task) => task.id),
      ...today.automaticTasks.map((task) => task.id),
    ]);
    const currentOnly = current.filter((task) => !todayIds.has(task.id));
    const isEmpty =
      today.selectedTasks.length === 0 && today.automaticTasks.length === 0 && currentOnly.length === 0;

    return (
      <div
        key={column.listType}
        className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"
      >
        <div className={`px-3 py-2 text-sm font-semibold ${column.accent}`}>{column.title}</div>
        {isEmpty ? (
          <p className="px-3 pb-3 text-sm text-gray-400 dark:text-gray-500">
            Nothing here today — ⌘K to capture a thought.
          </p>
        ) : (
          <div className="pb-1.5">
            <ul>
              {today.selectedTasks.map((task) => renderRow(task, column.listType, 'today'))}
            </ul>
            {today.automaticTasks.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5">
                  <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                    due today
                  </span>
                  <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                </div>
                <ul>
                  {today.automaticTasks.map((task) => renderRow(task, column.listType, 'today'))}
                </ul>
              </>
            )}
            {currentOnly.length > 0 && (
              <>
                <div className="flex items-center gap-2 px-3 py-1.5 mt-2">
                  <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                  <span className="text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                    current
                  </span>
                  <span className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                </div>
                <ul>
                  {currentOnly.map((task) =>
                    renderRow(task, column.listType, 'current', { draggable: true, inToday: false }),
                  )}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="max-w-5xl mx-auto px-3 sm:px-4 pb-8">
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Today</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">{currentDate}</span>
      </div>
      {!data ? (
        <div className="grid sm:grid-cols-2 gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-32 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3 items-start">{COLUMNS.map(renderColumn)}</div>
      )}

      <AddToPlanModal
        isOpen={planTask !== null}
        onClose={() => setPlanTask(null)}
        onSuccess={() => refreshJournal()}
        task={planTask?.task ?? null}
        listType={planTask?.listType ?? 'have-to-do'}
        date={currentDate}
      />
      <EditTaskModal
        isOpen={editTask !== null}
        onClose={() => setEditTask(null)}
        onTaskUpdated={() => {
          setEditTask(null);
          refreshTasks();
        }}
        onResortRequested={() => {
          setEditTask(null);
          refreshTasks();
        }}
        task={editTask?.task ?? null}
        listType={editTask?.listType ?? 'have-to-do'}
      />
    </section>
  );
}
