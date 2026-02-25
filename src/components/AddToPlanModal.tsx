'use client';

import React, { useState, useEffect } from 'react';
import type { Task, ListType } from './TaskLists';
import { formatTaskTextWithProjects } from '@/lib/projects';
import { formatDueTimeRangeForDisplay } from '@/lib/due-time';

// Valid hours matching the API
const VALID_HOURS = [
  '7am', '8am', '9am', '10am', '11am', '12pm',
  '1pm', '2pm', '3pm', '4pm', '5pm', '6pm',
  '7pm', '8pm', '9pm', '10pm', '11pm', '12am',
  '1am', '2am', '3am', '4am', '5am', '6am'
];

type ModalPhase = 'selecting' | 'submitting' | 'complete' | 'error';
type TimeMode = 'single' | 'range';

interface AddToPlanModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void; // Called when scheduling succeeds (before modal closes)
  task: Task | null;
  listType: ListType;
  date: string; // ISO format (YYYY-MM-DD)
}

export function AddToPlanModal({ isOpen, onClose, onSuccess, task, listType, date }: AddToPlanModalProps) {
  const [phase, setPhase] = useState<ModalPhase>('selecting');
  const [timeMode, setTimeMode] = useState<TimeMode>('single');
  const [selectedHour, setSelectedHour] = useState('9am');
  const [startHour, setStartHour] = useState('9am');
  const [endHour, setEndHour] = useState('10am');
  const [errorMessage, setErrorMessage] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setPhase('selecting');
      setTimeMode('single');
      setSelectedHour('9am');
      setStartHour('9am');
      setEndHour('10am');
      setErrorMessage('');
    }
  }, [isOpen]);

  // Validate that end hour comes after start hour
  const isValidRange = () => {
    const startIdx = VALID_HOURS.indexOf(startHour);
    const endIdx = VALID_HOURS.indexOf(endHour);
    return startIdx < endIdx;
  };

  const handleSubmit = async () => {
    if (!task) return;
    if (timeMode === 'range' && !isValidRange()) {
      setErrorMessage('End time must be after start time');
      setPhase('error');
      return;
    }

    setPhase('submitting');

    try {
      // First, ensure the journal exists for the date
      const createResponse = await fetch('/api/journal/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date }),
      });
      
      const createData = await createResponse.json();
      if (!createData.success) {
        throw new Error(createData.error || 'Failed to create journal');
      }

      // Add planned entry (single hour uses append-by-default; ranges use /update range API)
      let endpoint: '/api/journal/append' | '/api/journal/update';
      let requestBody;
      if (timeMode === 'single') {
        endpoint = '/api/journal/append';
        requestBody = {
          date,
          hour: selectedHour,
          taskId: task.id,
          listType,
          entryMode: 'planned',
        };
      } else {
        endpoint = '/api/journal/update';
        requestBody = {
          date,
          range: {
            start: startHour,
            end: endHour,
            taskId: task.id,
            listType,
            entryMode: 'planned',
          },
        };
      }

      const updateResponse = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      const updateData = await updateResponse.json();
      if (!updateData.success) {
        throw new Error(updateData.error || 'Failed to add to plan');
      }

      setPhase('complete');
      // Notify parent of success (triggers refresh)
      onSuccess?.();
      setTimeout(() => {
        onClose();
      }, 800);
    } catch (error) {
      setPhase('error');
      setErrorMessage(error instanceof Error ? error.message : 'Failed to add to plan');
    }
  };

  if (!isOpen || !task) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 w-full max-w-md shadow-2xl transform transition-all">
        
        {/* Phase: Selecting Time */}
        {phase === 'selecting' && (
          <>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
              Add to Daily Plan
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-4">Schedule this task for today</p>
            
            {/* Task Preview */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4 mb-6 border border-gray-200 dark:border-gray-600">
              <p className="text-gray-700 dark:text-gray-200 font-medium">{formatTaskTextWithProjects(task)}</p>
              {task.dueDate && (
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  Due: {formatDueTimeRangeForDisplay(task.dueTimeStart, task.dueTimeEnd)
                    ? `${task.dueDate} @ ${formatDueTimeRangeForDisplay(task.dueTimeStart, task.dueTimeEnd)}`
                    : task.dueDate}
                </p>
              )}
            </div>

            {/* Time Mode Toggle */}
            <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 mb-6">
              <button
                onClick={() => setTimeMode('single')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                  timeMode === 'single'
                    ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                Single Hour
              </button>
              <button
                onClick={() => setTimeMode('range')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                  timeMode === 'range'
                    ? 'bg-white dark:bg-gray-600 text-gray-800 dark:text-gray-100 shadow-sm'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                Time Range
              </button>
            </div>

            {/* Time Selection */}
            {timeMode === 'single' ? (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                  Select Time
                </label>
                <select
                  value={selectedHour}
                  onChange={(e) => setSelectedHour(e.target.value)}
                  className="w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                >
                  {VALID_HOURS.map((hour) => (
                    <option key={hour} value={hour}>
                      {hour}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="mb-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                    Start Time
                  </label>
                  <select
                    value={startHour}
                    onChange={(e) => setStartHour(e.target.value)}
                    className="w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  >
                    {VALID_HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {hour}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                    End Time
                  </label>
                  <select
                    value={endHour}
                    onChange={(e) => setEndHour(e.target.value)}
                    className="w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  >
                    {VALID_HOURS.map((hour) => (
                      <option key={hour} value={hour}>
                        {hour}
                      </option>
                    ))}
                  </select>
                </div>
                {!isValidRange() && (
                  <p className="text-red-500 dark:text-red-400 text-sm">End time must be after start time</p>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={timeMode === 'range' && !isValidRange()}
                className={`px-5 py-2.5 rounded-xl font-semibold transition-all ${
                  timeMode === 'single' || isValidRange()
                    ? 'bg-blue-500 dark:bg-blue-600 text-white hover:bg-blue-600 dark:hover:bg-blue-500 shadow-lg shadow-blue-500/25'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }`}
              >
                Add to Plan
              </button>
            </div>
          </>
        )}

        {/* Phase: Submitting */}
        {phase === 'submitting' && (
          <div className="text-center py-8">
            <div className="inline-block w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-300 text-lg">Adding to plan...</p>
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
            <p className="text-gray-800 dark:text-gray-100 text-xl font-semibold">Added to plan!</p>
            <p className="text-gray-500 dark:text-gray-400 mt-1">
              {timeMode === 'single' ? selectedHour : `${startHour} - ${endHour}`}
            </p>
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
              onClick={() => setPhase('selecting')}
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
