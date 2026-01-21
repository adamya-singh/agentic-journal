'use client';

import React, { useState, useEffect } from 'react';
import { Task, ListType } from '@/lib/types';

type ModalPhase = 'editing' | 'saving' | 'complete' | 'error';

interface EditTaskModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskUpdated: () => void;
  task: Task | null;
  listType: ListType;
}

export function EditTaskModal({ isOpen, onClose, onTaskUpdated, task, listType }: EditTaskModalProps) {
  const [phase, setPhase] = useState<ModalPhase>('editing');
  const [taskText, setTaskText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isDaily, setIsDaily] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Reset and populate state when modal opens or task changes
  useEffect(() => {
    if (isOpen && task) {
      setPhase('editing');
      setTaskText(task.text || '');
      setDueDate(task.dueDate || '');
      setIsDaily(task.isDaily || false);
      setErrorMessage('');
    }
  }, [isOpen, task]);

  const handleSave = async () => {
    if (!task || !taskText.trim()) return;

    setPhase('saving');

    try {
      const response = await fetch('/api/tasks/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: task.id,
          newText: taskText.trim(),
          dueDate: dueDate || '',
          isDaily: isDaily,
          listType,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setPhase('complete');
        setTimeout(() => {
          onTaskUpdated();
          onClose();
        }, 800);
      } else {
        setPhase('error');
        setErrorMessage(data.error || 'Failed to update task');
      }
    } catch {
      setPhase('error');
      setErrorMessage('Failed to connect to server');
    }
  };

  const handleClearDueDate = () => {
    setDueDate('');
  };

  if (!isOpen) return null;

  const accentColor = listType === 'want-to-do' ? 'teal' : 'amber';

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 w-full max-w-lg shadow-2xl transform transition-all">
        
        {/* Phase: Editing */}
        {phase === 'editing' && (
          <>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
              Edit Task
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              Modify the task details below
            </p>
            
            {/* Task text input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                Task description
              </label>
              <input
                type="text"
                value={taskText}
                onChange={(e) => setTaskText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && taskText.trim() && handleSave()}
                placeholder="What do you need to do?"
                className={`w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-${accentColor}-500 focus:border-transparent transition-all placeholder-gray-400 dark:placeholder-gray-500`}
                autoFocus
              />
            </div>
            
            {/* Due date input */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                Due date (optional)
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={`flex-1 px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-${accentColor}-500 focus:border-transparent transition-all`}
                />
                {dueDate && (
                  <button
                    onClick={handleClearDueDate}
                    className="px-4 py-3 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-xl transition-colors"
                    title="Clear due date"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            
            {/* Daily recurring checkbox */}
            <div className="mb-6">
              <label className="flex items-center gap-3 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isDaily}
                  onChange={(e) => setIsDaily(e.target.checked)}
                  className={`w-5 h-5 rounded border-2 border-gray-300 dark:border-gray-600 text-${accentColor}-500 focus:ring-${accentColor}-500 focus:ring-2 cursor-pointer`}
                />
                <div className="flex items-center gap-2">
                  <svg className={`w-5 h-5 text-gray-500 dark:text-gray-400 group-hover:text-${accentColor}-500 transition-colors`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
            
            {/* Action buttons */}
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={!taskText.trim()}
                className={`px-5 py-2.5 rounded-xl font-semibold transition-all ${
                  taskText.trim()
                    ? listType === 'want-to-do'
                      ? 'bg-teal-500 dark:bg-teal-600 text-white hover:bg-teal-600 dark:hover:bg-teal-500 shadow-lg shadow-teal-500/25'
                      : 'bg-amber-500 dark:bg-amber-600 text-white hover:bg-amber-600 dark:hover:bg-amber-500 shadow-lg shadow-amber-500/25'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }`}
              >
                Save Changes
              </button>
            </div>
          </>
        )}

        {/* Phase: Saving */}
        {phase === 'saving' && (
          <div className="text-center py-8">
            <div className={`inline-block w-12 h-12 border-4 border-${accentColor}-500 border-t-transparent rounded-full animate-spin mb-4`} />
            <p className="text-gray-600 dark:text-gray-300 text-lg">Saving changes...</p>
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
            <p className="text-gray-800 dark:text-gray-100 text-xl font-semibold">Task updated!</p>
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
              onClick={() => setPhase('editing')}
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
