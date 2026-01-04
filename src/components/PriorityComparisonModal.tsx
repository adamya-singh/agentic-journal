'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Task, ListType } from '@/lib/types';

type ModalPhase = 'entering-task' | 'loading' | 'comparing' | 'inserting' | 'complete' | 'error';

interface PriorityComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskAdded: () => void;
  listType?: ListType;
}

export function PriorityComparisonModal({ isOpen, onClose, onTaskAdded, listType = 'have-to-do' }: PriorityComparisonModalProps) {
  const [phase, setPhase] = useState<ModalPhase>('entering-task');
  const [taskInput, setTaskInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isDaily, setIsDaily] = useState(false);
  const [existingTasks, setExistingTasks] = useState<Task[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  
  // Binary search state
  const [low, setLow] = useState(0);
  const [high, setHigh] = useState(0);
  const [comparisonCount, setComparisonCount] = useState(0);
  const [maxComparisons, setMaxComparisons] = useState(0);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPhase('entering-task');
      setTaskInput('');
      setDueDate('');
      setIsDaily(false);
      setExistingTasks([]);
      setErrorMessage('');
      setLow(0);
      setHigh(0);
      setComparisonCount(0);
      setMaxComparisons(0);
    }
  }, [isOpen]);

  // Fetch existing tasks when entering comparison phase
  // Daily tasks only compare against other daily tasks, regular tasks only against regular tasks
  const startComparison = useCallback(async () => {
    if (!taskInput.trim()) return;
    
    setPhase('loading');
    
    try {
      // Filter by isDaily to only compare against tasks of the same type
      const isDailyParam = isDaily ? 'true' : 'false';
      const response = await fetch(`/api/tasks/list?listType=${listType}&isDaily=${isDailyParam}`);
      const data = await response.json();
      
      if (!data.success) {
        setPhase('error');
        setErrorMessage('Failed to load tasks');
        return;
      }
      
      const tasks = data.tasks as Task[];
      setExistingTasks(tasks);
      
      if (tasks.length === 0) {
        // No existing tasks of this type, insert at position 0
        await insertTask(0);
      } else {
        // Start binary search
        setLow(0);
        setHigh(tasks.length);
        setMaxComparisons(Math.ceil(Math.log2(tasks.length + 1)));
        setComparisonCount(0);
        setPhase('comparing');
      }
    } catch (error) {
      setPhase('error');
      setErrorMessage('Failed to connect to server');
    }
  }, [taskInput, listType, isDaily]);

  // Insert task at the determined position
  const insertTask = useCallback(async (position: number) => {
    setPhase('inserting');
    
    try {
      const response = await fetch('/api/tasks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          task: taskInput.trim(), 
          position, 
          listType,
          dueDate: dueDate || undefined,
          isDaily: isDaily || undefined,
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setPhase('complete');
        setTimeout(() => {
          onTaskAdded();
          onClose();
        }, 800);
      } else {
        setPhase('error');
        setErrorMessage(data.error || 'Failed to add task');
      }
    } catch (error) {
      setPhase('error');
      setErrorMessage('Failed to connect to server');
    }
  }, [taskInput, onTaskAdded, onClose, listType, dueDate, isDaily]);

  // Handle user's comparison choice
  const handleComparisonChoice = useCallback((newTaskIsMoreImportant: boolean) => {
    const mid = Math.floor((low + high) / 2);
    
    let newLow = low;
    let newHigh = high;
    
    if (newTaskIsMoreImportant) {
      // New task is more important, search in higher-priority half (lower indices)
      newHigh = mid;
    } else {
      // New task is less important, search in lower-priority half (higher indices)
      newLow = mid + 1;
    }
    
    setLow(newLow);
    setHigh(newHigh);
    setComparisonCount(prev => prev + 1);
    
    // Check if search is complete
    if (newLow >= newHigh) {
      insertTask(newLow);
    }
  }, [low, high, insertTask]);

  // Get the current task to compare against
  const getCurrentComparisonTask = useCallback((): Task | undefined => {
    const mid = Math.floor((low + high) / 2);
    return existingTasks[mid];
  }, [low, high, existingTasks]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl transform transition-all">
        
        {/* Phase: Entering Task */}
        {phase === 'entering-task' && (
          <>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
              Add {listType === 'want-to-do' ? 'Want-to-Do' : 'Have-to-Do'} Task
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">Enter your task, then we&apos;ll find its priority</p>
            
            <input
              type="text"
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && taskInput.trim() && startComparison()}
              placeholder="What do you need to do?"
              className="w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent mb-4 transition-all placeholder-gray-400 dark:placeholder-gray-500"
              autoFocus
            />
            
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                Due date (optional)
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>
            
            <div className="mb-6">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isDaily}
                  onChange={(e) => setIsDaily(e.target.checked)}
                  className="w-5 h-5 rounded border-2 border-gray-300 dark:border-gray-600 text-amber-500 focus:ring-amber-500 focus:ring-2 cursor-pointer"
                />
                <div className="flex items-center gap-2">
                  <svg className="w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:text-amber-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <span className="text-sm font-medium text-gray-600 dark:text-gray-300 group-hover:text-gray-800 dark:group-hover:text-gray-100 transition-colors">
                    Daily recurring task
                  </span>
                </div>
              </label>
              <p className="mt-1 ml-8 text-xs text-gray-400 dark:text-gray-500">
                Automatically shows up every day
              </p>
            </div>
            
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={startComparison}
                disabled={!taskInput.trim()}
                className={`px-5 py-2.5 rounded-xl font-semibold transition-all ${
                  taskInput.trim()
                    ? 'bg-amber-500 dark:bg-amber-600 text-white hover:bg-amber-600 dark:hover:bg-amber-500 shadow-lg shadow-amber-500/25'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }`}
              >
                Next →
              </button>
            </div>
          </>
        )}

        {/* Phase: Loading */}
        {phase === 'loading' && (
          <div className="text-center py-8">
            <div className="inline-block w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-300 text-lg">Loading tasks...</p>
          </div>
        )}

        {/* Phase: Comparing */}
        {phase === 'comparing' && (
          <>
            <div className="text-center mb-6">
              <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-1">Which is more important?</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Comparison {comparisonCount + 1} of ~{maxComparisons}
              </p>
            </div>
            
            {/* Progress bar */}
            <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full mb-8 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-amber-400 to-amber-500 transition-all duration-300"
                style={{ width: `${((comparisonCount + 1) / maxComparisons) * 100}%` }}
              />
            </div>
            
            {/* Comparison buttons */}
            <div className="space-y-4">
              <button
                onClick={() => handleComparisonChoice(true)}
                className="w-full p-5 text-left rounded-xl border-2 border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 hover:border-amber-400 dark:hover:border-amber-600 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-amber-500 text-white flex items-center justify-center font-bold text-sm">
                    NEW
                  </span>
                  <div className="flex flex-col">
                    <span className="text-gray-800 dark:text-gray-100 font-medium text-lg">
                      {taskInput}
                      {isDaily && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300">
                          Daily
                        </span>
                      )}
                    </span>
                    {dueDate && (
                      <span className="text-amber-600 dark:text-amber-400 text-sm">Due: {dueDate}</span>
                    )}
                  </div>
                </div>
              </button>
              
              <div className="text-center text-gray-400 dark:text-gray-500 font-medium">or</div>
              
              <button
                onClick={() => handleComparisonChoice(false)}
                className="w-full p-5 text-left rounded-xl border-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 hover:border-gray-400 dark:hover:border-gray-500 transition-all group"
              >
                <div className="flex items-center gap-3">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-400 dark:bg-gray-500 text-white flex items-center justify-center font-bold text-sm">
                    #{Math.floor((low + high) / 2) + 1}
                  </span>
                  <div className="flex flex-col">
                    <span className="text-gray-800 dark:text-gray-100 font-medium text-lg">{getCurrentComparisonTask()?.text}</span>
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

        {/* Phase: Inserting */}
        {phase === 'inserting' && (
          <div className="text-center py-8">
            <div className="inline-block w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-300 text-lg">Adding task...</p>
          </div>
        )}

        {/* Phase: Complete */}
        {phase === 'complete' && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
              <svg className="w-8 h-8 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-800 dark:text-gray-100 text-xl font-semibold">Task added!</p>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Priority position: #{low + 1}</p>
          </div>
        )}

        {/* Phase: Error */}
        {phase === 'error' && (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 mb-4">
              <svg className="w-8 h-8 text-red-500 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-gray-800 dark:text-gray-100 text-xl font-semibold">Something went wrong</p>
            <p className="text-gray-500 dark:text-gray-400 mt-1">{errorMessage}</p>
            <button
              onClick={() => setPhase('entering-task')}
              className="mt-4 px-5 py-2.5 rounded-xl font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
