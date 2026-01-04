'use client';

import React, { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, Play, Clock } from 'lucide-react';
import { ListType } from '@/lib/types';

// Staged entry type (matching WeekView)
export interface StagedEntry {
  text: string;
  taskId: string;
  listType: ListType;
  completed?: boolean;
}

interface UnscheduledTasksPopoverProps {
  entries: StagedEntry[];
  isExpanded: boolean;
  onToggle: () => void;
  isToday?: boolean;
  /** Position hint: 'left' means popover appears to the left of badge, 'right' means to the right */
  positionHint?: 'left' | 'right';
  /** Callback when task is marked complete */
  onComplete?: (entry: StagedEntry) => void;
  /** Callback when "Starting now" is clicked */
  onStartTask?: (entry: StagedEntry) => void;
  /** Callback when "Schedule" is clicked */
  onSchedule?: (entry: StagedEntry) => void;
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

export function UnscheduledTasksPopover({ 
  entries, 
  isExpanded, 
  onToggle,
  isToday = false,
  positionHint = 'right',
  onComplete,
  onStartTask,
  onSchedule,
}: UnscheduledTasksPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const [mounted, setMounted] = useState(false);

  // Ensure we only render portal on client
  useEffect(() => {
    setMounted(true);
  }, []);

  // Calculate popover position when expanded
  useEffect(() => {
    if (!isExpanded || !badgeRef.current) return;

    const updatePosition = () => {
      const badge = badgeRef.current;
      if (!badge) return;

      const rect = badge.getBoundingClientRect();
      const popoverWidth = 288; // w-72 = 18rem = 288px (increased for buttons)
      const gap = 150; // Gap between badge and popover

      let left: number;
      if (positionHint === 'left') {
        // Position to the left of the badge
        left = rect.left - popoverWidth - gap;
        // If it would go off-screen left, flip to right
        if (left < 8) {
          left = rect.right + gap;
        }
      } else {
        // Position to the right of the badge
        left = rect.right + gap;
        // If it would go off-screen right, flip to left
        if (left + popoverWidth > window.innerWidth - 8) {
          left = rect.left - popoverWidth - gap;
        }
      }

      // Ensure it doesn't go off-screen left
      left = Math.max(8, left);

      setPopoverPosition({
        top: rect.top,
        left,
      });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isExpanded, positionHint]);

  // Handle click outside to close popover
  useEffect(() => {
    if (!isExpanded) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        popoverRef.current && 
        !popoverRef.current.contains(target) &&
        badgeRef.current &&
        !badgeRef.current.contains(target)
      ) {
        onToggle();
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isExpanded, onToggle]);

  // Don't render if no entries
  if (entries.length === 0) {
    return null;
  }

  // Popover content (rendered via portal to escape parent overflow)
  const popoverContent = (
    <div
      ref={popoverRef}
      className="fixed w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-[9999]"
      style={{
        top: popoverPosition.top,
        left: popoverPosition.left,
      }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/30 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-amber-700 dark:text-amber-400">
            Unscheduled
          </h4>
          <span className="text-xs text-amber-600 dark:text-amber-400/80">
            {entries.length} task{entries.length > 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Task list */}
      <div className="p-2 max-h-60 overflow-y-auto">
        <ul className="space-y-0">
          {entries.map((entry, index) => {
            const isLast = index === entries.length - 1;
            const priorityColor = getPriorityTierColor(index, entries.length);
            const isCompleted = entry.completed;

            return (
              <li
                key={`${entry.taskId}-${index}`}
                className={`text-sm py-2 pl-2 flex items-center justify-between group ${!isLast ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}
                style={{ 
                  borderLeft: `4px solid ${priorityColor}`,
                  marginLeft: '-4px',
                  paddingLeft: '8px',
                }}
              >
                <div className="flex items-center flex-1 min-w-0">
                  {/* Complete button - always visible */}
                  {onComplete && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onComplete(entry);
                      }}
                      className={`mr-2 p-1 rounded transition-colors flex-shrink-0 ${
                        isCompleted 
                          ? 'text-green-500 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300 bg-green-50 dark:bg-green-900/30' 
                          : 'text-gray-300 dark:text-gray-600 hover:text-green-500 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30'
                      }`}
                      title={isCompleted ? 'Mark as incomplete' : 'Mark as done'}
                    >
                      <CheckCircle className="h-4 w-4" />
                    </button>
                  )}
                  <span className={`truncate ${isCompleted ? 'text-green-600 dark:text-green-400 line-through' : 'text-gray-700 dark:text-gray-200'}`}>
                    {entry.text}
                  </span>
                </div>
                
                {/* Action buttons - show on hover for non-completed tasks */}
                {!isCompleted && (
                  <div className="flex items-center gap-0.5 ml-2 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                    {/* Starting now button */}
                    {onStartTask && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onStartTask(entry);
                        }}
                        className="p-1 text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded transition-colors"
                        title="Starting now - log to journal"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {/* Schedule button */}
                    {onSchedule && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSchedule(entry);
                        }}
                        className="p-1 text-indigo-400 hover:text-indigo-600 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-900/30 rounded transition-colors"
                        title="Schedule for specific time"
                      >
                        <Clock className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );

  return (
    <div className="relative inline-flex items-center">
      {/* Badge button */}
      <button
        ref={badgeRef}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`
          inline-flex items-center justify-center
          min-w-[20px] h-5 px-1.5
          text-xs font-medium
          rounded-full
          transition-all duration-150
          ${isExpanded 
            ? 'bg-amber-500 text-white shadow-md' 
            : 'bg-amber-400/80 text-amber-900 hover:bg-amber-500 hover:text-white'
          }
          ${isToday ? 'ring-1 ring-white/50' : ''}
        `}
        title={`${entries.length} unscheduled task${entries.length > 1 ? 's' : ''}`}
        aria-label={`${entries.length} unscheduled tasks - click to ${isExpanded ? 'collapse' : 'expand'}`}
      >
        {entries.length}
      </button>

      {/* Popover rendered via portal to escape parent overflow */}
      {isExpanded && mounted && createPortal(popoverContent, document.body)}
    </div>
  );
}
