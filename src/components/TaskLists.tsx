'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Play, CheckCircle, Clock, Pencil, GripVertical } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PriorityComparisonModal } from './PriorityComparisonModal';
import { AddToPlanModal } from './AddToPlanModal';
import { EditTaskModal } from './EditTaskModal';
import { TaskResortModal } from './TaskResortModal';
import { TaskNotesPreview } from './TaskNotesPreview';
import { TaskTextWithProjectBadges } from './TaskTextWithProjectBadges';
import { Task, ListType } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import { useRefresh } from '@/lib/RefreshContext';
import { compareDueTimes, formatDueTimeRangeForDisplay } from '@/lib/due-time';

// Re-export for backward compatibility
export type { Task, ListType };

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
  onEdit?: (task: Task) => void;
  sortMode?: DueSortMode;
  onToggleSort?: () => void;
  onReorder?: (params: { taskId: string; newIndex: number; isDaily: boolean }) => Promise<void> | void;
  dragEnabled?: boolean;
  dragDisabledReason?: string;
  reorderError?: string | null;
  expandedNotesTaskIds: Set<string>;
  onToggleNotes: (taskId: string) => void;
}

type DueSortMode = 'off' | 'asc' | 'desc';

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

// Valid hours for checking task logs
const VALID_HOURS = ['7am', '8am', '9am', '10am', '11am', '12pm', '1pm', '2pm', '3pm', '4pm', '5pm', '6pm', '7pm', '8pm', '9pm', '10pm', '11pm', '12am', '1am', '2am', '3am', '4am', '5am', '6am'];

/**
 * Check whether a task already has a logged actual in the journal.
 */
function checkIfTaskLogged(journal: Record<string, unknown> | null | undefined, taskId: string): boolean {
  if (!journal) return false;
  
  // Check hourly slots
  for (const hour of VALID_HOURS) {
    const slot = journal[hour];
    if (!slot) continue;
    
    if (Array.isArray(slot)) {
      if (
        slot.some(
          (e) => e?.taskId === taskId && (e?.entryMode === 'logged' || e?.entryMode === undefined)
        )
      ) return true;
    } else if (
      typeof slot === 'object' &&
      slot !== null &&
      'taskId' in slot &&
      (slot as { taskId: string }).taskId === taskId &&
      (
        !('entryMode' in slot) ||
        (slot as { entryMode?: string }).entryMode === 'logged'
      )
    ) {
      return true;
    }
  }
  
  // Check ranges
  const ranges = journal.ranges;
  if (ranges && Array.isArray(ranges)) {
    if (
      ranges.some(
        (r: { taskId?: string; entryMode?: string }) =>
          r.taskId === taskId && (r.entryMode === 'logged' || r.entryMode === undefined)
      )
    ) return true;
  }
  
  return false;
}

/**
 * Get priority tier color based on task position in the list.
 * Top 1/3 = Red (high priority), Middle 1/3 = Amber (medium), Bottom 1/3 = Green (low)
 */
function getPriorityTierColor(index: number, totalCount: number): string {
  if (totalCount === 0) return 'transparent';
  const position = index / totalCount;
  if (position < 1/3) return '#EF4444';      // Red - high priority
  if (position < 2/3) return '#F59E0B';      // Amber - medium priority
  return '#10B981';                           // Green - low priority
}

function isIsoDate(value: string | undefined): value is string {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function formatTaskDueLabel(task: Task): string | null {
  if (!task.dueDate) return null;
  const dueTimeLabel = formatDueTimeRangeForDisplay(task.dueTimeStart, task.dueTimeEnd);
  if (!dueTimeLabel) return `due: ${task.dueDate}`;
  return `due: ${task.dueDate} @ ${dueTimeLabel}`;
}

function getDueSortLabel(mode: DueSortMode): string {
  if (mode === 'asc') return 'Due: ↑';
  if (mode === 'desc') return 'Due: ↓';
  return 'Due: Off';
}

function cycleDueSortMode(mode: DueSortMode): DueSortMode {
  if (mode === 'off') return 'asc';
  if (mode === 'asc') return 'desc';
  return 'off';
}

/**
 * Sorts only dated tasks by due date while preserving undated task positions.
 * Sorting is view-only and does not mutate persisted priority order.
 */
function getDisplayedTasks(tasks: Task[], mode: DueSortMode): Task[] {
  if (mode === 'off') return tasks;

  const dated = tasks
    .map((task, index) => ({ task, index }))
    .filter((entry) => isIsoDate(entry.task.dueDate))
    .sort((a, b) => {
      const aDate = a.task.dueDate as string;
      const bDate = b.task.dueDate as string;
      const dateCmp = mode === 'asc' ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
      if (dateCmp !== 0) return dateCmp;
      if (a.task.dueTimeStart && b.task.dueTimeStart) {
        const rawTimeCmp = compareDueTimes(a.task.dueTimeStart, b.task.dueTimeStart);
        const timeCmp = mode === 'asc' ? rawTimeCmp : -rawTimeCmp;
        if (timeCmp !== 0) return timeCmp;
      }
      return a.index - b.index;
    });

  if (dated.length <= 1) return tasks;

  let datedCursor = 0;
  return tasks.map((task) => {
    if (!isIsoDate(task.dueDate)) return task;
    const nextDated = dated[datedCursor];
    datedCursor += 1;
    return nextDated.task;
  });
}

function reorderTasksWithinType(tasks: Task[], taskId: string, newIndex: number, isDaily: boolean): Task[] {
  const matches = tasks.filter((task) => (task.isDaily === true) === isDaily);
  const currentTypeIndex = matches.findIndex((task) => task.id === taskId);
  if (currentTypeIndex === -1) return tasks;

  const clampedNewIndex = Math.max(0, Math.min(newIndex, matches.length - 1));
  if (currentTypeIndex === clampedNewIndex) return tasks;

  const reorderedMatches = arrayMove(matches, currentTypeIndex, clampedNewIndex);
  let reorderedCursor = 0;

  return tasks.map((task) => {
    if ((task.isDaily === true) !== isDaily) return task;
    const nextTask = reorderedMatches[reorderedCursor];
    reorderedCursor += 1;
    return nextTask;
  });
}

interface SortableTaskItemProps {
  id: string;
  disabled: boolean;
  className: string;
  style: React.CSSProperties;
  children: (handle: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners | undefined }) => React.ReactNode;
}

function SortableTaskItem({ id, disabled, className, style, children }: SortableTaskItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      className={`${className} ${isDragging ? 'z-10 shadow-md' : ''}`}
      style={{
        ...style,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.88 : 1,
      }}
    >
      {children({ attributes, listeners })}
    </li>
  );
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
  onDelete,
  onEdit,
  sortMode = 'off',
  onToggleSort,
  onReorder,
  dragEnabled = false,
  dragDisabledReason,
  reorderError,
  expandedNotesTaskIds,
  onToggleNotes,
}: TaskListProps) {
  // Separate daily tasks from regular tasks
  const dailyTasks = tasks.filter(task => task.isDaily === true);
  const regularTasks = tasks.filter(task => !task.isDaily);
  const allTasks = [...dailyTasks, ...regularTasks];

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const headerContent = (
    <div className={`px-4 py-3 ${bgColor} border-b border-gray-200 dark:border-gray-700 flex items-center justify-between`}>
      <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
      <div className="flex items-center gap-2">
        {onToggleSort && (
          <button
            onClick={onToggleSort}
            className="px-2.5 py-1 rounded-md text-xs font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Cycle due-date sort: Off, earliest first, latest first"
            aria-label={`Cycle due-date sort. Current mode: ${sortMode}`}
          >
            {getDueSortLabel(sortMode)}
          </button>
        )}
        {onAddClick && (
          <button
            onClick={onAddClick}
            className={`px-3 py-1 rounded-md text-sm font-medium text-white ${buttonColor} transition-colors`}
          >
            +
          </button>
        )}
      </div>
    </div>
  );

  const handleDragEnd = useCallback(
    async (event: DragEndEvent, isDaily: boolean, sectionTasks: Task[]) => {
      if (!onReorder || !dragEnabled) return;

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const ids = sectionTasks.map((task) => task.id);
      const oldIndex = ids.indexOf(String(active.id));
      const newIndex = ids.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

      await onReorder({
        taskId: String(active.id),
        newIndex,
        isDaily,
      });
    },
    [dragEnabled, onReorder]
  );

  const renderTaskItem = (task: Task, index: number, isLast: boolean, totalCount: number, sortable: boolean) => {
    const isInToday = clickedTasks?.has(task.id);
    const priorityColor = getPriorityTierColor(index, totalCount);
    const hasNotes = Boolean(task.notesMarkdown && task.notesMarkdown.trim().length > 0);
    const isNotesExpanded = expandedNotesTaskIds.has(task.id);
    const rowClassName = `text-sm text-gray-700 dark:text-gray-200 flex items-center justify-between group py-2 ${!isLast ? 'border-b border-gray-200 dark:border-gray-700' : ''} ${onTaskClick ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded px-2 -mx-2 transition-colors' : ''} ${isInToday ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : ''} ${onReorder && dragEnabled ? 'select-none' : ''}`;
    const rowStyle = { borderLeft: `4px solid ${priorityColor}`, paddingLeft: '8px', marginLeft: '-4px' };

    const content = (handle: { attributes: DraggableAttributes; listeners: DraggableSyntheticListeners | undefined } | null) => (
      <>
        <div className="flex items-start flex-1 min-w-0">
          {onReorder && (
            <button
              type="button"
              className={`mr-1 mt-0.5 p-1 rounded text-gray-400 dark:text-gray-500 ${dragEnabled ? 'hover:bg-gray-200 dark:hover:bg-gray-700 cursor-grab active:cursor-grabbing' : 'cursor-not-allowed opacity-40'}`}
              title={dragEnabled ? 'Drag to reorder task priority' : dragDisabledReason || 'Reordering is currently disabled'}
              aria-label={dragEnabled ? 'Drag to reorder task priority' : 'Task reordering disabled'}
              disabled={!dragEnabled}
              onPointerDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              {...(handle ? handle.attributes : {})}
              {...(handle ? handle.listeners : {})}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex-1" onClick={() => onTaskClick?.(task)}>
              <span className="text-gray-400 dark:text-gray-500 mr-2">{index + 1}.</span>
              <TaskTextWithProjectBadges text={task.text} projects={task.projects} />
              {task.isDaily && (
                <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300" title="Daily recurring task">
                  <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Daily
                </span>
              )}
              {formatTaskDueLabel(task) && (
                <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                  ({formatTaskDueLabel(task)})
                </span>
              )}
              {isInToday && (
                <span className="ml-2 text-xs text-green-600 dark:text-green-400">✓ in today</span>
              )}
            </div>
            {hasNotes && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleNotes(task.id);
                  }}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                >
                  {isNotesExpanded ? 'Hide notes' : 'Show notes'}
                </button>
                {isNotesExpanded && (
                  <div className="mt-2 rounded-md bg-gray-50 dark:bg-gray-700/40 p-2 text-xs">
                    <TaskNotesPreview markdown={task.notesMarkdown || ''} />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        <div className="flex items-center">
          {/* Edit button */}
          {onEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEdit(task);
              }}
              className="p-1 text-blue-400 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors opacity-0 group-hover:opacity-100"
              title="Edit task"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          
          {/* Delete button */}
          {onDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(task);
              }}
              className="ml-1 p-1 text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 rounded transition-colors opacity-0 group-hover:opacity-100"
              title="Delete task"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </>
    );

    if (sortable) {
      return (
        <SortableTaskItem
          key={task.id}
          id={task.id}
          disabled={!dragEnabled}
          className={rowClassName}
          style={rowStyle}
        >
          {(handle) => content(handle)}
        </SortableTaskItem>
      );
    }

    return (
      <li key={task.id} className={rowClassName} style={rowStyle}>
        {content(null)}
      </li>
    );
  };

  if (loading) {
    return (
      <div className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {headerContent}
        <div className="p-4 space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
        {headerContent}
        <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  const hasTasks = dailyTasks.length > 0 || regularTasks.length > 0;
  const dragControlsEnabled = Boolean(onReorder);

  return (
    <div className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {headerContent}
      <div className="p-4 min-h-[120px] max-h-[300px] overflow-y-auto">
        {reorderError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {reorderError}
          </div>
        )}
        {hasTasks ? (
          <div className="space-y-0">
            {/* Daily Tasks */}
            {dailyTasks.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEnd(event, true, dailyTasks)}
              >
                <SortableContext items={dailyTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-0">
                    {dailyTasks.map((task, index) => renderTaskItem(task, index, index === dailyTasks.length - 1 && regularTasks.length === 0, allTasks.length, dragControlsEnabled))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            
            {/* Separator if both sections have tasks */}
            {dailyTasks.length > 0 && regularTasks.length > 0 && (
              <div className="border-t-2 border-gray-300 dark:border-gray-600 my-3" />
            )}
            
            {/* Regular Tasks */}
            {regularTasks.length > 0 && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleDragEnd(event, false, regularTasks)}
              >
                <SortableContext items={regularTasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
                  <ul className="space-y-0">
                    {regularTasks.map((task, index) => renderTaskItem(task, dailyTasks.length + index, index === regularTasks.length - 1, allTasks.length, dragControlsEnabled))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
            {dragControlsEnabled && !dragEnabled && dragDisabledReason && (
              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{dragDisabledReason}</p>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm italic">
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
  onStartTask?: (task: Task) => void;
  currentDate?: string;
  expandedNotesTaskIds: Set<string>;
  onToggleNotes: (taskId: string) => void;
}

function TodayTaskList({ title, tasks, loading, error, accentColor, bgColor, onRemove, onComplete, onAddToPlan, onStartTask, currentDate, expandedNotesTaskIds, onToggleNotes }: TodayTaskListProps) {
  const orderedTasks = tasks;

  if (loading) {
    return (
      <div className="flex-1 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden">
        <div className={`px-4 py-3 ${bgColor} border-b border-gray-200 dark:border-gray-700`}>
          <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
        </div>
        <div className="p-4 space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden">
        <div className={`px-4 py-3 ${bgColor} border-b border-gray-200 dark:border-gray-700`}>
          <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
        </div>
        <div className="p-4 text-center text-red-500 dark:text-red-400 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 overflow-hidden">
      <div className={`px-4 py-3 ${bgColor} border-b border-gray-200 dark:border-gray-700`}>
        <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
      </div>
      <div className="p-4 min-h-[80px] max-h-[200px] overflow-y-auto">
        {orderedTasks.length > 0 ? (
          <ol className="space-y-0">
            {orderedTasks.map((task, index) => {
              const isLast = index === orderedTasks.length - 1;
              const hasNotes = Boolean(task.notesMarkdown && task.notesMarkdown.trim().length > 0);
              const isNotesExpanded = expandedNotesTaskIds.has(task.id);
              return (
                <li 
                  key={task.id} 
                  className={`text-sm flex items-center justify-between group py-2 ${!isLast ? 'border-b border-gray-200 dark:border-gray-700' : ''} ${
                    task.completed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'
                  }`}
                >
                  <div className="flex-1">
                    <span className="flex items-center">
                      {/* Always visible complete button */}
                      {onComplete && (
                        <button
                          onClick={() => onComplete(task)}
                          className={`mr-2 p-1.5 rounded transition-colors ${
                            task.completed 
                              ? 'text-green-500 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 bg-green-50 dark:bg-green-900/30' 
                              : 'text-gray-300 dark:text-gray-600 hover:text-green-500 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30'
                          }`}
                          title={task.completed ? 'Mark as incomplete' : 'Mark as done'}
                        >
                          <CheckCircle className="h-5 w-5" />
                        </button>
                      )}
                      <TaskTextWithProjectBadges
                        text={task.text}
                        projects={task.projects}
                        textClassName={task.completed ? 'line-through' : undefined}
                      />
                      {task.isDaily && (
                        <span className={`ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${task.completed ? 'bg-purple-50 dark:bg-purple-900/30 text-purple-400 dark:text-purple-500' : 'bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300'}`} title="Daily recurring task">
                          <svg className="w-3 h-3 mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Daily
                        </span>
                      )}
                      {formatTaskDueLabel(task) && (
                        <span className={`ml-2 text-xs ${task.completed ? 'text-gray-300 dark:text-gray-600' : 'text-gray-400 dark:text-gray-500'}`}>
                          ({formatTaskDueLabel(task)})
                        </span>
                      )}
                    </span>
                    {hasNotes && (
                      <div className="mt-1 ml-9">
                        <button
                          type="button"
                          onClick={() => onToggleNotes(task.id)}
                          className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300"
                        >
                          {isNotesExpanded ? 'Hide notes' : 'Show notes'}
                        </button>
                        {isNotesExpanded && (
                          <div className="mt-2 rounded-md bg-gray-50 dark:bg-gray-700/40 p-2 text-xs">
                            <TaskNotesPreview markdown={task.notesMarkdown || ''} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Starting now button - only show if task is not completed */}
                    {onStartTask && !task.completed && (
                      <button
                        onClick={() => onStartTask(task)}
                        className="p-1.5 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                        title="Starting now - log to journal"
                      >
                        <Play className="h-4 w-4" />
                      </button>
                    )}
                    {onAddToPlan && (
                      <button
                        onClick={() => onAddToPlan(task)}
                        className="p-1.5 text-indigo-400 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors"
                        title="Schedule for specific time"
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                    )}
                    {onRemove && !task.completed && (
                      (() => {
                        const isDueToday = task.dueDate === currentDate;
                        const isAutoAdded = isDueToday || task.isDaily;
                        return (
                          <button
                            onClick={isAutoAdded ? undefined : () => onRemove(task)}
                            disabled={isAutoAdded}
                            className={`p-1 rounded transition-colors ${
                              isAutoAdded
                                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed opacity-30'
                                : 'text-red-400 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/30 opacity-60 hover:opacity-100'
                            }`}
                            title={task.isDaily ? 'Daily task will be auto-added back' : isDueToday ? 'Task is due today and will be auto-added back' : 'Remove from today'}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        );
                      })()
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm italic">
            Click tasks above to add to today
          </div>
        )}
      </div>
    </div>
  );
}

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

export function TaskLists({ onDataChange, refreshTrigger }: TaskListsProps) {
  const [currentDate] = useState(getCurrentDateISO());
  const { taskRefreshCounter, refreshJournal } = useRefresh();
  
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
  
  // Edit task modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [taskToEdit, setTaskToEdit] = useState<{ task: Task; listType: ListType } | null>(null);
  const [showResortModal, setShowResortModal] = useState(false);
  const [taskToResort, setTaskToResort] = useState<{ task: Task; listType: ListType } | null>(null);
  
  // General task lists
  const [haveToDo, setHaveToDo] = useState<Task[]>([]);
  const [wantToDo, setWantToDo] = useState<Task[]>([]);
  const [haveSortMode, setHaveSortMode] = useState<DueSortMode>('off');
  const [wantSortMode, setWantSortMode] = useState<DueSortMode>('off');
  const [haveReorderError, setHaveReorderError] = useState<string | null>(null);
  const [wantReorderError, setWantReorderError] = useState<string | null>(null);
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
  const [expandedNotesTaskIds, setExpandedNotesTaskIds] = useState<Set<string>>(new Set());

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
        setHaveReorderError(null);
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
        setWantReorderError(null);
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

  // Re-fetch when taskRefreshCounter changes (triggered by RefreshContext)
  useEffect(() => {
    if (taskRefreshCounter > 0) {
      fetchGeneralTasks();
      fetchTodayTasks();
    }
  }, [taskRefreshCounter, fetchGeneralTasks, fetchTodayTasks]);

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

  // Handler to toggle task completion status (also logs to journal)
  const handleCompleteTask = async (task: Task, listType: ListType) => {
    try {
      // Check if task already has a logged entry in the journal
      const journalRes = await fetch('/api/journal/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dates: [currentDate], resolve: false }),
      });
      const journalData = await journalRes.json();
      const journal = journalData.journals?.[currentDate];
      
      // Check if taskId has already been logged for this day
      const isAlreadyLogged = checkIfTaskLogged(journal, task.id);
      
      // Only append to journal if no logged actual exists yet for this task/day.
      if (!isAlreadyLogged) {
        await fetch('/api/journal/append', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            date: currentDate,
            hour: getCurrentHour(),
            taskId: task.id,
            listType,
            entryMode: 'logged',
          }),
        });
      }

      // Mark task as complete (always)
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
        // Notify WeekView to refresh (journal was modified)
        refreshJournal();
      }
    } catch (error) {
      console.error('Failed to toggle task completion:', error);
    }
  };

  // Handler for "Starting now" - logs to journal that task is starting
  const handleStartTask = async (task: Task, listType: ListType) => {
    try {
      // First ensure task is in today's list
      await fetch('/api/tasks/today/add', {
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

      // Then log to journal
      await fetch('/api/journal/append', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: currentDate,
          hour: getCurrentHour(),
          taskId: task.id,
          listType,
          entryMode: 'logged',
        }),
      });

      fetchTodayTasks();
      // Notify WeekView to refresh (journal was modified)
      refreshJournal();
    } catch (error) {
      console.error('Failed to start task:', error);
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

  // Handler to open edit task modal
  const handleEditTask = (task: Task, listType: ListType) => {
    setTaskToEdit({ task, listType });
    setShowEditModal(true);
  };

  // Handler to actually delete the task after confirmation
  const handleDeleteTask = async () => {
    if (!taskToDelete) return;
    
    try {
      const response = await fetch('/api/tasks/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: taskToDelete.task.id,
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

  const handleReorderTask = useCallback(async (
    listType: ListType,
    params: { taskId: string; newIndex: number; isDaily: boolean }
  ) => {
    const setList = listType === 'have-to-do' ? setHaveToDo : setWantToDo;
    const setReorderError = listType === 'have-to-do' ? setHaveReorderError : setWantReorderError;

    setReorderError(null);

    setList((prev) => reorderTasksWithinType(prev, params.taskId, params.newIndex, params.isDaily));

    try {
      const response = await fetch('/api/tasks/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: params.taskId,
          newPosition: params.newIndex,
          listType,
          positionMode: 'type-relative',
        }),
      });

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || 'Failed to reorder task');
      }
    } catch (error) {
      console.error('Failed to reorder task:', error);
      setReorderError('Could not save task order. Restoring latest server state.');
      fetchGeneralTasks();
    }
  }, [fetchGeneralTasks]);

  const displayedHaveToDo = getDisplayedTasks(haveToDo, haveSortMode);
  const displayedWantToDo = getDisplayedTasks(wantToDo, wantSortMode);
  const toggleTaskNotes = (taskId: string) => {
    setExpandedNotesTaskIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };
  const projectSuggestions = useMemo(() => {
    const values = [...haveToDo, ...wantToDo].flatMap((task) => normalizeProjectList(task.projects));
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
  }, [haveToDo, wantToDo]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 pb-4">
      <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-4 text-center">Tasks</h2>
      
      {/* Today's Task Lists */}
      <h3 className="text-lg font-medium text-gray-600 dark:text-gray-300 mb-3 text-center">Today ({currentDate})</h3>
      <div className="flex gap-4 mb-4">
        <TodayTaskList
          title="Have to Do Today"
          tasks={haveToDoToday}
          loading={loadingHaveToday}
          error={errorHaveToday}
          accentColor="text-amber-700 dark:text-amber-400"
          bgColor="bg-amber-100 dark:bg-amber-900/30"
          onRemove={(task) => handleRemoveFromToday(task, 'have-to-do')}
          onComplete={(task) => handleCompleteTask(task, 'have-to-do')}
          onAddToPlan={(task) => handleAddToPlan(task, 'have-to-do')}
          onStartTask={(task) => handleStartTask(task, 'have-to-do')}
          currentDate={currentDate}
          expandedNotesTaskIds={expandedNotesTaskIds}
          onToggleNotes={toggleTaskNotes}
        />
        <TodayTaskList
          title="Want to Do Today"
          tasks={wantToDoToday}
          loading={loadingWantToday}
          error={errorWantToday}
          accentColor="text-teal-700 dark:text-teal-400"
          bgColor="bg-teal-100 dark:bg-teal-900/30"
          onRemove={(task) => handleRemoveFromToday(task, 'want-to-do')}
          onComplete={(task) => handleCompleteTask(task, 'want-to-do')}
          onAddToPlan={(task) => handleAddToPlan(task, 'want-to-do')}
          onStartTask={(task) => handleStartTask(task, 'want-to-do')}
          currentDate={currentDate}
          expandedNotesTaskIds={expandedNotesTaskIds}
          onToggleNotes={toggleTaskNotes}
        />
      </div>

      {/* General Task Lists */}
      <div className="flex gap-4">
        <TaskList
          title="Have to Do"
          tasks={displayedHaveToDo}
          loading={loadingHave}
          error={errorHave}
          accentColor="text-amber-600 dark:text-amber-400"
          bgColor="bg-amber-50 dark:bg-amber-900/20"
          buttonColor="bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500"
          onTaskClick={(task) => handleAddToToday(task, 'have-to-do')}
          clickedTasks={todayHaveTasks}
          onAddClick={() => {
            setActiveListType('have-to-do');
            setShowTaskModal(true);
          }}
          onDelete={(task) => confirmDeleteTask(task, 'have-to-do')}
          onEdit={(task) => handleEditTask(task, 'have-to-do')}
          sortMode={haveSortMode}
          onToggleSort={() => setHaveSortMode((prev) => cycleDueSortMode(prev))}
          onReorder={(params) => handleReorderTask('have-to-do', params)}
          dragEnabled={haveSortMode === 'off'}
          dragDisabledReason="Turn due sort Off to reorder tasks."
          reorderError={haveReorderError}
          expandedNotesTaskIds={expandedNotesTaskIds}
          onToggleNotes={toggleTaskNotes}
        />
        <TaskList
          title="Want to Do"
          tasks={displayedWantToDo}
          loading={loadingWant}
          error={errorWant}
          accentColor="text-teal-600 dark:text-teal-400"
          bgColor="bg-teal-50 dark:bg-teal-900/20"
          buttonColor="bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500"
          onTaskClick={(task) => handleAddToToday(task, 'want-to-do')}
          clickedTasks={todayWantTasks}
          onAddClick={() => {
            setActiveListType('want-to-do');
            setShowTaskModal(true);
          }}
          onDelete={(task) => confirmDeleteTask(task, 'want-to-do')}
          onEdit={(task) => handleEditTask(task, 'want-to-do')}
          sortMode={wantSortMode}
          onToggleSort={() => setWantSortMode((prev) => cycleDueSortMode(prev))}
          onReorder={(params) => handleReorderTask('want-to-do', params)}
          dragEnabled={wantSortMode === 'off'}
          dragDisabledReason="Turn due sort Off to reorder tasks."
          reorderError={wantReorderError}
          expandedNotesTaskIds={expandedNotesTaskIds}
          onToggleNotes={toggleTaskNotes}
        />
      </div>

      {/* Add Task Modal */}
      <PriorityComparisonModal
        isOpen={showTaskModal}
        onClose={() => setShowTaskModal(false)}
        onTaskAdded={fetchGeneralTasks}
        listType={activeListType}
        existingProjectSuggestions={projectSuggestions}
      />

      {/* Add to Plan Modal */}
      <AddToPlanModal
        isOpen={showPlanModal}
        onClose={() => setShowPlanModal(false)}
        onSuccess={() => refreshJournal()}
        task={planTask}
        listType={planListType}
        date={currentDate}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && taskToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100 mb-2">Delete Task?</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
              Are you sure you want to permanently delete this task?
            </p>
            <div className="bg-gray-50 dark:bg-gray-700 rounded p-3 mb-4">
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">
                <TaskTextWithProjectBadges text={taskToDelete.task.text} projects={taskToDelete.task.projects} />
              </p>
              {taskToDelete.task.dueDate && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Due: {formatDueTimeRangeForDisplay(taskToDelete.task.dueTimeStart, taskToDelete.task.dueTimeEnd)
                    ? `${taskToDelete.task.dueDate} @ ${formatDueTimeRangeForDisplay(taskToDelete.task.dueTimeStart, taskToDelete.task.dueTimeEnd)}`
                    : taskToDelete.task.dueDate}
                </p>
              )}
            </div>
            <p className="text-xs text-red-500 dark:text-red-400 mb-4">
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setTaskToDelete(null);
                }}
                className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 hover:text-gray-800 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteTask()}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 dark:bg-red-600 dark:hover:bg-red-500 rounded-md transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Task Modal */}
      <EditTaskModal
        isOpen={showEditModal}
        onClose={() => {
          setShowEditModal(false);
          setTaskToEdit(null);
        }}
        onTaskUpdated={() => {
          fetchGeneralTasks();
          fetchTodayTasks();
        }}
        onResortRequested={(updatedTask, resortListType) => {
          setTaskToResort({ task: updatedTask, listType: resortListType });
          setShowResortModal(true);
        }}
        task={taskToEdit?.task ?? null}
        listType={taskToEdit?.listType ?? 'have-to-do'}
        existingProjectSuggestions={projectSuggestions}
      />

      <TaskResortModal
        isOpen={showResortModal}
        onClose={() => {
          setShowResortModal(false);
          setTaskToResort(null);
        }}
        onTaskResorted={() => {
          fetchGeneralTasks();
          fetchTodayTasks();
        }}
        task={taskToResort?.task ?? null}
        listType={taskToResort?.listType ?? 'have-to-do'}
      />
    </div>
  );
}
