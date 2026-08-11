'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { Task, ListType } from '@/lib/types';
import { normalizeProjectList } from '@/lib/projects';
import { TaskNotesEditor } from './TaskNotesEditor';
import { ModalShell } from './ModalShell';

type ModalPhase = 'entering-task' | 'inserting' | 'complete' | 'error';

interface PriorityComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTaskAdded: () => void;
  listType?: ListType;
  existingProjectSuggestions?: string[];
  parentTask?: Task | null;
}

function parseProjectsFromInput(value: string): string[] {
  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalizeProjectList(parts);
}

export function PriorityComparisonModal({
  isOpen,
  onClose,
  onTaskAdded,
  listType = 'have-to-do',
  existingProjectSuggestions = [],
  parentTask = null,
}: PriorityComparisonModalProps) {
  const [phase, setPhase] = useState<ModalPhase>('entering-task');
  const [taskInput, setTaskInput] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTimeStart, setDueTimeStart] = useState('');
  const [dueTimeEnd, setDueTimeEnd] = useState('');
  const [useDueTimeRange, setUseDueTimeRange] = useState(false);
  const [isDaily, setIsDaily] = useState(false);
  const [projectsInput, setProjectsInput] = useState('');
  const [notesMarkdown, setNotesMarkdown] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setPhase('entering-task');
      setTaskInput('');
      setDueDate('');
      setDueTimeStart('');
      setDueTimeEnd('');
      setUseDueTimeRange(false);
      setIsDaily(false);
      setProjectsInput('');
      setNotesMarkdown('');
      setErrorMessage('');
    }
  }, [isOpen]);

  const submitTask = useCallback(async () => {
    if (!taskInput.trim()) return;
    setPhase('inserting');

    try {
      const response = await fetch('/api/tasks/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task: taskInput.trim(),
          listType,
          parentTaskId: parentTask?.id,
          dueDate: dueDate || undefined,
          dueTimeStart: dueDate && dueTimeStart ? dueTimeStart : undefined,
          dueTimeEnd: dueDate && useDueTimeRange && dueTimeEnd ? dueTimeEnd : undefined,
          isDaily: isDaily || undefined,
          projects: parseProjectsFromInput(projectsInput),
          notesMarkdown: notesMarkdown.trim() || undefined,
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
    } catch {
      setPhase('error');
      setErrorMessage('Failed to connect to server');
    }
  }, [taskInput, onTaskAdded, onClose, listType, parentTask?.id, dueDate, dueTimeStart, dueTimeEnd, useDueTimeRange, isDaily, projectsInput, notesMarkdown]);

  return (
    <ModalShell isOpen={isOpen} onClose={onClose} maxWidth="lg">
        {/* Phase: Entering Task */}
        {phase === 'entering-task' && (
          <>
            <ModalShell.Header>
              <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">
                {parentTask
                  ? `Add Subtask to "${parentTask.text}"`
                  : `Add ${listType === 'want-to-do' ? 'Want-to-Do' : 'Have-to-Do'} Task`}
              </h2>
              <p className="text-gray-500 dark:text-gray-400">
                {parentTask
                  ? 'Enter the subtask details below'
                  : 'Enter your task to add it to the General backlog'}
              </p>
            </ModalShell.Header>

            <ModalShell.Body>
            <input
              type="text"
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && taskInput.trim() && submitTask()}
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
                onChange={(e) => {
                  const nextDueDate = e.target.value;
                  setDueDate(nextDueDate);
                  if (!nextDueDate) {
                    setDueTimeStart('');
                    setDueTimeEnd('');
                    setUseDueTimeRange(false);
                  }
                }}
                className="w-full px-4 py-3 text-lg border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all"
              />
            </div>

            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-600 dark:text-gray-300">
                  Due time (optional)
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <input
                    type="checkbox"
                    checked={useDueTimeRange}
                    disabled={!dueDate}
                    onChange={(e) => {
                      setUseDueTimeRange(e.target.checked);
                      if (!e.target.checked) {
                        setDueTimeEnd('');
                      }
                    }}
                  />
                  Range
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="time"
                  value={dueTimeStart}
                  disabled={!dueDate}
                  onChange={(e) => setDueTimeStart(e.target.value)}
                  className="w-full px-4 py-3 text-base border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all disabled:opacity-50"
                />
                <input
                  type="time"
                  value={dueTimeEnd}
                  disabled={!dueDate || !useDueTimeRange}
                  onChange={(e) => setDueTimeEnd(e.target.value)}
                  className="w-full px-4 py-3 text-base border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all disabled:opacity-50"
                />
              </div>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Set a single time or enable range for start-end.
              </p>
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

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                Projects (optional)
              </label>
              <input
                type="text"
                value={projectsInput}
                onChange={(e) => setProjectsInput(e.target.value)}
                placeholder="agentic-journal, openclaw"
                list="project-suggestions"
                className="w-full px-4 py-3 text-base border-2 border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all placeholder-gray-400 dark:placeholder-gray-500"
              />
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Comma-separated. Will be normalized to kebab-case.
              </p>
              {existingProjectSuggestions.length > 0 && (
                <datalist id="project-suggestions">
                  {existingProjectSuggestions.map((project) => (
                    <option key={project} value={project} />
                  ))}
                </datalist>
              )}
            </div>

            <div className="mb-2">
              <label className="block text-sm font-medium text-gray-600 dark:text-gray-300 mb-2">
                Task notes (optional)
              </label>
              <TaskNotesEditor
                value={notesMarkdown}
                onChange={setNotesMarkdown}
                placeholder="Add links, subtasks, context, and reference data"
              />
            </div>
            </ModalShell.Body>

            <ModalShell.Footer>
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitTask}
                disabled={!taskInput.trim()}
                className={`px-5 py-2.5 rounded-xl font-semibold transition-all ${
                  taskInput.trim()
                    ? 'bg-amber-500 dark:bg-amber-600 text-white hover:bg-amber-600 dark:hover:bg-amber-500 shadow-lg shadow-amber-500/25'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed'
                }`}
              >
                Add Task
              </button>
            </ModalShell.Footer>
          </>
        )}

        {/* Phase: Inserting */}
        {phase === 'inserting' && (
          <ModalShell.Body className="text-center py-8">
            <div className="inline-block w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-gray-600 dark:text-gray-300 text-lg">Adding task...</p>
          </ModalShell.Body>
        )}

        {/* Phase: Complete */}
        {phase === 'complete' && (
          <ModalShell.Body className="text-center py-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
              <svg className="w-8 h-8 text-green-500 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-800 dark:text-gray-100 text-xl font-semibold">Task added!</p>
            <p className="text-gray-500 dark:text-gray-400 mt-1">Added to the General backlog</p>
          </ModalShell.Body>
        )}

        {/* Phase: Error */}
        {phase === 'error' && (
          <ModalShell.Body className="text-center py-8">
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
          </ModalShell.Body>
        )}
    </ModalShell>
  );
}
