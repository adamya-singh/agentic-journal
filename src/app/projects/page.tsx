'use client';

import Link from 'next/link';
import React from 'react';
import { TaskTextWithProjectBadges } from '@/components/TaskTextWithProjectBadges';

interface ProjectTaskView {
  id: string;
  text: string;
  projects?: string[];
  dueDate?: string;
  isDaily?: boolean;
  completed?: boolean;
  completedAt?: string;
  sourceDate?: string;
}

interface ProjectBucket {
  haveToDo: ProjectTaskView[];
  wantToDo: ProjectTaskView[];
}

interface ProjectGroup {
  project: string;
  tagged: string;
  unified: ProjectTaskView[];
  general: ProjectBucket;
  today: ProjectBucket;
  completed: ProjectBucket;
  totals: {
    general: number;
    today: number;
    completed: number;
    all: number;
  };
}

interface ProjectsViewResponse {
  success: boolean;
  date: string;
  projects: ProjectGroup[];
  unassigned: ProjectGroup;
  error?: string;
}

function getCurrentDateISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

type ProjectViewMode = 'unified' | 'detailed';

function getPriorityTierColor(index: number, totalCount: number): string {
  if (totalCount === 0) return 'transparent';
  const position = index / totalCount;
  if (position < 1 / 3) return '#EF4444';
  if (position < 2 / 3) return '#F59E0B';
  return '#10B981';
}

function DetailedTaskList({
  title,
  tasks,
  tone = 'neutral',
}: {
  title: string;
  tasks: ProjectTaskView[];
  tone?: 'amber' | 'teal' | 'indigo' | 'neutral';
}) {
  const toneClasses =
    tone === 'amber'
      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300'
      : tone === 'teal'
        ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300'
        : tone === 'indigo'
          ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
          : 'bg-gray-50 dark:bg-gray-900/50 text-gray-700 dark:text-gray-200';

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className={`px-3 py-2 border-b border-gray-200 dark:border-gray-700 ${toneClasses}`}>
        <h4 className="text-sm font-semibold">{title}</h4>
      </div>
      <div className="p-3 max-h-56 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No tasks</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((task) => (
              <li key={task.id} className="text-sm text-gray-700 dark:text-gray-200">
                <div>
                  <TaskTextWithProjectBadges text={task.text} projects={task.projects} />
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {task.dueDate ? `due ${task.dueDate}` : 'no due date'}
                  {task.isDaily ? ' | daily' : ''}
                  {task.completed ? ' | completed' : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function UnifiedTaskList({ tasks }: { tasks: ProjectTaskView[] }) {
  const activeTasks = tasks.filter((task) => !task.completed);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700 bg-gradient-to-r from-amber-50 via-white to-teal-50 dark:from-amber-900/20 dark:via-gray-800 dark:to-teal-900/20">
        <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-100">All Project Tasks</h4>
      </div>
      <div className="p-3 max-h-80 overflow-y-auto">
        {tasks.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No tasks</p>
        ) : (
          <ol className="space-y-0">
            {tasks.map((task, index) => (
              <li
                key={task.id}
                className={`text-sm py-2 ${index !== tasks.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''} ${
                  task.completed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'
                }`}
                style={{
                  borderLeft: `4px solid ${
                    task.completed
                      ? '#9CA3AF'
                      : getPriorityTierColor(index, Math.max(activeTasks.length, 1))
                  }`,
                  paddingLeft: '8px',
                  marginLeft: '-4px',
                }}
              >
                <div className="flex items-start gap-2">
                  <span className="text-gray-400 dark:text-gray-500 mt-0.5">{index + 1}.</span>
                  <div className="min-w-0 flex-1">
                    <p>
                      <TaskTextWithProjectBadges
                        text={task.text}
                        projects={task.projects}
                        textClassName={task.completed ? 'line-through' : undefined}
                      />
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {task.dueDate ? `due ${task.dueDate}` : 'no due date'}
                      {task.isDaily ? ' | daily' : ''}
                      {task.completed ? ' | completed' : ' | active'}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ProjectCard({
  group,
  mode,
  onModeChange,
}: {
  group: ProjectGroup;
  mode: ProjectViewMode;
  onModeChange: (mode: ProjectViewMode) => void;
}) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-amber-50 via-white to-teal-50 dark:from-amber-900/20 dark:via-gray-800 dark:to-teal-900/20">
        <div>
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
            {group.project === '__unassigned__' ? (
              'Unassigned'
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded bg-teal-100/90 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 text-sm font-semibold">
                {group.tagged}
              </span>
            )}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">Total {group.totals.all}</span>
            <span className="px-2 py-0.5 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300">
              Active {group.unified.filter((task) => !task.completed).length}
            </span>
            <span className="px-2 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
              Completed {group.unified.filter((task) => task.completed).length}
            </span>
          </div>
        </div>
        <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden">
          <button
            onClick={() => onModeChange('unified')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              mode === 'unified'
                ? 'bg-teal-500 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            God View
          </button>
          <button
            onClick={() => onModeChange('detailed')}
            className={`px-3 py-1.5 text-xs font-medium border-l border-gray-300 dark:border-gray-600 transition-colors ${
              mode === 'detailed'
                ? 'bg-amber-500 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            Detailed
          </button>
        </div>
      </div>
      {mode === 'unified' ? (
        <div className="p-4">
          <UnifiedTaskList tasks={group.unified} />
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          <DetailedTaskList title="General · Have to do" tasks={group.general.haveToDo} tone="amber" />
          <DetailedTaskList title="General · Want to do" tasks={group.general.wantToDo} tone="teal" />
          <DetailedTaskList title="Today · Have to do" tasks={group.today.haveToDo} tone="amber" />
          <DetailedTaskList title="Today · Want to do" tasks={group.today.wantToDo} tone="teal" />
          <DetailedTaskList title="Completed · Have to do" tasks={group.completed.haveToDo} tone="indigo" />
          <DetailedTaskList title="Completed · Want to do" tasks={group.completed.wantToDo} tone="indigo" />
        </div>
      )}
    </section>
  );
}

export default function ProjectsPage() {
  const [date, setDate] = React.useState(getCurrentDateISO());
  const [data, setData] = React.useState<ProjectsViewResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [viewModes, setViewModes] = React.useState<Record<string, ProjectViewMode>>({});

  const fetchData = React.useCallback(async (forDate: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/view?date=${forDate}`);
      const payload = (await response.json()) as ProjectsViewResponse;
      if (!payload.success) {
        setError(payload.error || 'Failed to fetch projects view');
        setData(null);
        return;
      }
      setData(payload);
    } catch {
      setError('Failed to connect');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchData(date);
  }, [date, fetchData]);

  const getModeForProject = React.useCallback(
    (project: string): ProjectViewMode => viewModes[project] ?? 'unified',
    [viewModes]
  );

  const setModeForProject = React.useCallback((project: string, mode: ProjectViewMode) => {
    setViewModes((current) => ({
      ...current,
      [project]: mode,
    }));
  }, []);

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200 mb-2 text-center">Projects</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center mb-5">
              Project-specific overview built for high-level context, not daily accounting
        </p>

        <div className="mb-6 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 flex flex-wrap items-center justify-center gap-3 shadow-sm">
          <div className="flex items-center gap-2">
            <label htmlFor="projects-date" className="text-sm text-gray-600 dark:text-gray-300">
              Context Date
            </label>
            <input
              id="projects-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100"
            />
          </div>
          <Link
            href="/"
            className="px-3 py-1.5 rounded-md text-sm font-medium bg-indigo-500 hover:bg-indigo-600 text-white transition-colors"
          >
            Back to Journal
          </Link>
        </div>

        {loading && <p className="text-sm text-gray-500 dark:text-gray-400">Loading projects view...</p>}
        {!loading && error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>}
        {!loading && !error && data && (
          <div className="space-y-4">
            {data.projects.map((group) => (
              <ProjectCard
                key={group.project}
                group={group}
                mode={getModeForProject(group.project)}
                onModeChange={(mode) => setModeForProject(group.project, mode)}
              />
            ))}
            <ProjectCard
              group={data.unassigned}
              mode={getModeForProject(data.unassigned.project)}
              onModeChange={(mode) => setModeForProject(data.unassigned.project, mode)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
