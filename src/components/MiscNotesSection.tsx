'use client';

import React from 'react';
import { ArrowRight, Trash2 } from 'lucide-react';
import { useRefresh } from '@/lib/RefreshContext';
import type { Task } from '@/lib/types';

// Unclassified quick captures awaiting triage. Rendered only when non-empty.
export function MiscNotesSection() {
  const { taskRefreshCounter, refreshTasks } = useRefresh();
  const [tasks, setTasks] = React.useState<Task[]>([]);
  const [busyTaskId, setBusyTaskId] = React.useState<string | null>(null);

  const fetchMiscTasks = React.useCallback(async () => {
    try {
      const response = await fetch('/api/tasks/misc/list');
      const data = await response.json();
      if (data.success) {
        setTasks(Array.isArray(data.tasks) ? data.tasks : []);
      }
    } catch (error) {
      console.error('Failed to load misc notes:', error);
    }
  }, []);

  React.useEffect(() => {
    fetchMiscTasks();
  }, [fetchMiscTasks, taskRefreshCounter]);

  const promote = async (taskId: string, listType: 'have-to-do' | 'want-to-do') => {
    setBusyTaskId(taskId);
    try {
      await fetch('/api/tasks/misc/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, listType }),
      });
      refreshTasks();
    } catch (error) {
      console.error('Failed to promote misc note:', error);
    } finally {
      setBusyTaskId(null);
    }
  };

  const remove = async (taskId: string) => {
    setBusyTaskId(taskId);
    try {
      await fetch('/api/tasks/misc/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });
      refreshTasks();
    } catch (error) {
      console.error('Failed to remove misc note:', error);
    } finally {
      setBusyTaskId(null);
    }
  };

  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-4 pb-8">
      <div className="rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/10">
        <div className="px-4 py-2.5 text-sm font-semibold text-amber-800 dark:text-amber-300">
          Misc Notes <span className="font-normal text-amber-600 dark:text-amber-400">— unclassified captures ({tasks.length})</span>
        </div>
        <ul className="divide-y divide-amber-100 dark:divide-amber-900/40">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2 px-4 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-gray-200">
                {task.text}
              </span>
              <button
                onClick={() => promote(task.id, 'have-to-do')}
                disabled={busyTaskId === task.id}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 disabled:opacity-50"
                title="Move to Have to Do"
              >
                <ArrowRight className="w-3 h-3" /> Have
              </button>
              <button
                onClick={() => promote(task.id, 'want-to-do')}
                disabled={busyTaskId === task.id}
                className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-teal-700 dark:text-teal-300 hover:text-teal-900 dark:hover:text-teal-100 disabled:opacity-50"
                title="Move to Want to Do"
              >
                <ArrowRight className="w-3 h-3" /> Want
              </button>
              <button
                onClick={() => remove(task.id)}
                disabled={busyTaskId === task.id}
                className="shrink-0 text-gray-400 hover:text-red-500 disabled:opacity-50"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
