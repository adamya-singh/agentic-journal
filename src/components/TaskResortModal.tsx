'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Task, ListType } from '@/lib/types';

type ModalPhase = 'loading' | 'comparing' | 'reordering' | 'complete' | 'error';

interface TaskResortModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskResorted: () => void;
  task: Task | null;
  listType: ListType;
}

export function TaskResortModal({ isOpen, onClose, onTaskResorted, task, listType }: TaskResortModalProps) {
  const [phase, setPhase] = useState<ModalPhase>('loading');
  const [existingTasks, setExistingTasks] = useState<Task[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  // Binary search state
  const [low, setLow] = useState(0);
  const [high, setHigh] = useState(0);
  const [comparisonCount, setComparisonCount] = useState(0);
  const [maxComparisons, setMaxComparisons] = useState(0);

  const accentClass = listType === 'want-to-do' ? 'teal' : 'amber';
  const spinnerBorderClass = accentClass === 'teal' ? 'border-teal-500' : 'border-amber-500';

  const reorderTask = useCallback(async (position: number) => {
    if (!task) return;

    setPhase('reordering');

    try {
      const response = await fetch('/api/tasks/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          newPosition: position,
          listType,
          positionMode: 'type-relative',
        }),
      });

      const data = await response.json();
      if (data.success) {
        setPhase('complete');
        setTimeout(() => {
          onTaskResorted();
          onClose();
        }, 800);
      } else {
        setPhase('error');
        setErrorMessage(data.error || 'Failed to re-sort task');
      }
    } catch {
      setPhase('error');
      setErrorMessage('Failed to connect to server');
    }
  }, [task, listType, onTaskResorted, onClose]);

  const startComparison = useCallback(async () => {
    if (!task) return;

    setPhase('loading');
    setErrorMessage('');

    try {
      const isDailyParam = task.isDaily === true ? 'true' : 'false';
      const response = await fetch(`/api/tasks/list?listType=${listType}&isDaily=${isDailyParam}`);
      const data = await response.json();

      if (!data.success) {
        setPhase('error');
        setErrorMessage(data.error || 'Failed to load tasks');
        return;
      }

      const comparableTasks = (data.tasks as Task[]).filter((t) => t.id !== task.id);
      setExistingTasks(comparableTasks);

      if (comparableTasks.length === 0) {
        await reorderTask(0);
        return;
      }

      setLow(0);
      setHigh(comparableTasks.length);
      setComparisonCount(0);
      setMaxComparisons(Math.ceil(Math.log2(comparableTasks.length + 1)));
      setPhase('comparing');
    } catch {
      setPhase('error');
      setErrorMessage('Failed to connect to server');
    }
  }, [task, listType, reorderTask]);

  useEffect(() => {
    if (!isOpen) return;
    setExistingTasks([]);
    setLow(0);
    setHigh(0);
    setComparisonCount(0);
    setMaxComparisons(0);
    setErrorMessage('');
    setPhase('loading');
    startComparison();
  }, [isOpen, startComparison]);

  const handleComparisonChoice = useCallback((taskIsMoreImportant: boolean) => {
    const mid = Math.floor((low + high) / 2);
    let newLow = low;
    let newHigh = high;

    if (taskIsMoreImportant) {
      newHigh = mid;
    } else {
      newLow = mid + 1;
    }

    setLow(newLow);
    setHigh(newHigh);
    setComparisonCount((prev) => prev + 1);

    if (newLow >= newHigh) {
      reorderTask(newLow);
    }
  }, [low, high, reorderTask]);

  const getCurrentComparisonTask = useCallback((): Task | undefined => {
    const mid = Math.floor((low + high) / 2);
    return existingTasks[mid];
  }, [low, high, existingTasks]);

  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl transform transition-all">
        {phase === 'loading' && (
          <div className="text-center py-8">
            <div className={`inline-block w-12 h-12 border-4 ${spinnerBorderClass} border-t-transparent rounded-full animate-spin mb-4`} />
            <p className="text-gray-600 dark:text-gray-300 text-lg">Preparing re-sort...</p>
          </div>
        )}

        {phase === 'comparing' && (
          <>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1">Re-sort task priority</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Comparison {comparisonCount + 1} of ~{maxComparisons}
              </p>
            </div>

            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full mb-8 overflow-hidden">
              <div
                className={`h-full bg-gradient-to-r ${accentClass === 'teal' ? 'from-teal-400 to-teal-500' : 'from-amber-400 to-amber-500'} transition-all duration-300`}
                style={{ width: `${((comparisonCount + 1) / maxComparisons) * 100}%` }}
              />
            </div>

            <div className="space-y-4">
              <button
                onClick={() => handleComparisonChoice(true)}
                className={`w-full p-5 text-left rounded-xl border-2 ${
                  accentClass === 'teal'
                    ? 'border-teal-200 dark:border-teal-700 bg-teal-50 dark:bg-teal-900/30 hover:bg-teal-100 dark:hover:bg-teal-900/50 hover:border-teal-400 dark:hover:border-teal-600'
                    : 'border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 hover:border-amber-400 dark:hover:border-amber-600'
                } transition-all`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex-shrink-0 w-8 h-8 rounded-full text-white flex items-center justify-center font-bold text-sm ${accentClass === 'teal' ? 'bg-teal-500' : 'bg-amber-500'}`}>
                    EDIT
                  </span>
                  <div className="flex flex-col">
                    <span className="text-gray-800 dark:text-gray-100 font-medium text-lg">
                      {task.text}
                      {task.isDaily && (
                        <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${accentClass === 'teal' ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300'}`}>
                          Daily
                        </span>
                      )}
                    </span>
                    {task.dueDate && (
                      <span className={`text-sm ${accentClass === 'teal' ? 'text-teal-600 dark:text-teal-400' : 'text-amber-600 dark:text-amber-400'}`}>Due: {task.dueDate}</span>
                    )}
                  </div>
                </div>
              </button>

              <div className="text-center text-gray-400 dark:text-gray-500 font-medium">or</div>

              <button
                onClick={() => handleComparisonChoice(false)}
                className="w-full p-5 text-left rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-all"
              >
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-400 dark:bg-gray-500 text-white flex items-center justify-center font-bold text-sm">
                    #{Math.floor((low + high) / 2) + 1}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-gray-800 dark:text-gray-100 font-medium text-lg">
                      {getCurrentComparisonTask()?.text}
                    </span>
                    {getCurrentComparisonTask()?.dueDate && (
                      <span className="text-gray-500 dark:text-gray-400 text-sm">Due: {getCurrentComparisonTask()?.dueDate}</span>
                    )}
                  </div>
                </div>
              </button>
            </div>

            <div className="mt-6 text-center">
              <button
                onClick={onClose}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-sm"
              >
                Cancel
              </button>
            </div>
          </>
        )}

        {phase === 'reordering' && (
          <div className="text-center py-8">
            <div className={`inline-block w-12 h-12 border-4 ${spinnerBorderClass} border-t-transparent rounded-full animate-spin mb-4`} />
            <p className="text-gray-600 dark:text-gray-300 text-lg">Re-sorting task...</p>
          </div>
        )}

        {phase === 'complete' && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
              <svg className="w-8 h-8 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-800 dark:text-gray-100 text-xl font-semibold">Task re-sorted!</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
              <svg className="w-8 h-8 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-gray-800 dark:text-gray-100 text-xl font-semibold">Couldn&apos;t re-sort task</p>
            <p className="text-gray-500 dark:text-gray-400 mt-1">{errorMessage}</p>
            <div className="mt-4 flex justify-center gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                Close
              </button>
              <button
                onClick={startComparison}
                className={`px-5 py-2.5 rounded-xl font-medium text-white transition-colors ${accentClass === 'teal' ? 'bg-teal-500 hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500' : 'bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500'}`}
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
