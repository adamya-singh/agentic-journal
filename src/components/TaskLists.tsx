'use client';

import React, { useEffect, useState } from 'react';

interface Task {
  text: string;
  dueDate?: string;
}

interface TaskListProps {
  title: string;
  tasks: Task[];
  loading: boolean;
  error: string | null;
  accentColor: string;
  bgColor: string;
}

function TaskList({ title, tasks, loading, error, accentColor, bgColor }: TaskListProps) {
  // Reverse tasks since they're stored as a stack (last = highest priority)
  const orderedTasks = [...tasks].reverse();

  if (loading) {
    return (
      <div className="flex-1 rounded-lg border border-gray-200 bg-white overflow-hidden">
        <div className={`px-4 py-3 ${bgColor} border-b border-gray-200`}>
          <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
        </div>
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
        <div className={`px-4 py-3 ${bgColor} border-b border-gray-200`}>
          <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
        </div>
        <div className="p-4 text-center text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 rounded-lg border border-gray-200 bg-white overflow-hidden">
      <div className={`px-4 py-3 ${bgColor} border-b border-gray-200`}>
        <h3 className={`font-semibold ${accentColor}`}>{title}</h3>
      </div>
      <div className="p-4 min-h-[120px] max-h-[300px] overflow-y-auto">
        {orderedTasks.length > 0 ? (
          <ol className="space-y-2 list-decimal list-inside">
            {orderedTasks.map((task, index) => (
              <li key={index} className="text-sm text-gray-700">
                <span>{task.text}</span>
                {task.dueDate && (
                  <span className="ml-2 text-xs text-gray-400">
                    (due: {task.dueDate})
                  </span>
                )}
              </li>
            ))}
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

export function TaskLists() {
  const [haveToDo, setHaveToDo] = useState<Task[]>([]);
  const [wantToDo, setWantToDo] = useState<Task[]>([]);
  const [loadingHave, setLoadingHave] = useState(true);
  const [loadingWant, setLoadingWant] = useState(true);
  const [errorHave, setErrorHave] = useState<string | null>(null);
  const [errorWant, setErrorWant] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTasks() {
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
    }

    fetchTasks();
  }, []);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 pb-4">
      <h2 className="text-2xl font-semibold text-gray-700 mb-4 text-center">Tasks</h2>
      <div className="flex gap-4">
        <TaskList
          title="Have to Do"
          tasks={haveToDo}
          loading={loadingHave}
          error={errorHave}
          accentColor="text-amber-600"
          bgColor="bg-amber-50"
        />
        <TaskList
          title="Want to Do"
          tasks={wantToDo}
          loading={loadingWant}
          error={errorWant}
          accentColor="text-teal-600"
          bgColor="bg-teal-50"
        />
      </div>
    </div>
  );
}

