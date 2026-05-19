'use client';

import Link from 'next/link';
import React from 'react';
import { AddToPlanModal } from '@/components/AddToPlanModal';
import { TaskTextWithProjectBadges } from '@/components/TaskTextWithProjectBadges';
import { formatDueTimeRangeForDisplay } from '@/lib/due-time';
import type { ListType, RoadmapCheckpointStatus, Task } from '@/lib/types';

interface ProjectTaskView {
  id: string;
  text: string;
  listType: ListType;
  projects?: string[];
  parentTaskId?: string;
  parentTaskText?: string;
  dueDate?: string;
  dueTimeStart?: string;
  dueTimeEnd?: string;
  isDaily?: boolean;
  completed?: boolean;
  completedAt?: string;
  sourceDate?: string;
}

interface RoadmapTaskView extends ProjectTaskView {
  missing?: boolean;
}

interface RoadmapCheckpointView {
  id: string;
  title: string;
  description?: string;
  status: RoadmapCheckpointStatus;
  tasks: RoadmapTaskView[];
  progress: {
    completed: number;
    total: number;
  };
  createdAt: string;
  updatedAt: string;
}

interface ProjectRoadmapView {
  project: string;
  goal: string;
  checkpoints: RoadmapCheckpointView[];
  createdAt: string;
  updatedAt: string;
}

function renderParentTaskBadge(parentTaskText?: string) {
  if (!parentTaskText) {
    return null;
  }

  return (
    <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700/70 dark:text-slate-200">
      {parentTaskText}
    </span>
  );
}

function formatDueLabel(task: ProjectTaskView): string {
  if (!task.dueDate) return 'no due date';
  const dueTime = formatDueTimeRangeForDisplay(task.dueTimeStart, task.dueTimeEnd);
  if (!dueTime) return `due ${task.dueDate}`;
  return `due ${task.dueDate} @ ${dueTime}`;
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
  roadmap: ProjectRoadmapView | null;
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

type ProjectViewMode = 'unified' | 'detailed' | 'roadmap';

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
                  {renderParentTaskBadge(task.parentTaskText)}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatDueLabel(task)}
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
                      {renderParentTaskBadge(task.parentTaskText)}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {formatDueLabel(task)}
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

function statusLabel(status: RoadmapCheckpointStatus): string {
  if (status === 'in-progress') return 'In progress';
  if (status === 'completed') return 'Completed';
  return 'Not started';
}

function toTaskForPlanning(task: ProjectTaskView): Task {
  return {
    id: task.id,
    text: task.text,
    ...(task.projects ? { projects: task.projects } : {}),
    ...(task.parentTaskId ? { parentTaskId: task.parentTaskId } : {}),
    ...(task.dueDate ? { dueDate: task.dueDate } : {}),
    ...(task.dueTimeStart ? { dueTimeStart: task.dueTimeStart } : {}),
    ...(task.dueTimeEnd ? { dueTimeEnd: task.dueTimeEnd } : {}),
    ...(task.isDaily ? { isDaily: true } : {}),
    ...(task.completed ? { completed: true } : {}),
  };
}

function RoadmapPanel({
  group,
  date,
  onChanged,
}: {
  group: ProjectGroup;
  date: string;
  onChanged: () => void;
}) {
  const [goal, setGoal] = React.useState(group.roadmap?.goal ?? '');
  const [savingGoal, setSavingGoal] = React.useState(false);
  const [newCheckpointTitle, setNewCheckpointTitle] = React.useState('');
  const [newCheckpointDescription, setNewCheckpointDescription] = React.useState('');
  const [creatingCheckpoint, setCreatingCheckpoint] = React.useState(false);
  const [taskToPlan, setTaskToPlan] = React.useState<ProjectTaskView | null>(null);
  const [checkpointDrafts, setCheckpointDrafts] = React.useState<
    Record<string, { title: string; description: string; status: RoadmapCheckpointStatus }>
  >({});
  const [linkSelections, setLinkSelections] = React.useState<Record<string, string>>({});
  const [taskDrafts, setTaskDrafts] = React.useState<
    Record<string, { text: string; listType: ListType; dueDate: string; dueTimeStart: string; dueTimeEnd: string }>
  >({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setGoal(group.roadmap?.goal ?? '');
    setCheckpointDrafts({});
    setLinkSelections({});
    setTaskDrafts({});
    setError(null);
  }, [group.roadmap, group.project]);

  const requestRoadmapChange = React.useCallback(
    async (payload: Record<string, unknown>) => {
      setError(null);
      const response = await fetch('/api/projects/roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project: group.project,
          ...payload,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to update roadmap');
      }
      onChanged();
      return data;
    },
    [group.project, onChanged]
  );

  const checkpoints = group.roadmap?.checkpoints ?? [];
  const linkedTaskKeys = new Set(
    checkpoints.flatMap((checkpoint) => checkpoint.tasks.map((task) => `${task.id}:${task.listType}`))
  );
  const linkableTasks = group.unified.filter((task) => !linkedTaskKeys.has(`${task.id}:${task.listType}`));

  const getCheckpointDraft = (checkpoint: RoadmapCheckpointView) =>
    checkpointDrafts[checkpoint.id] ?? {
      title: checkpoint.title,
      description: checkpoint.description ?? '',
      status: checkpoint.status,
    };

  const getTaskDraft = (checkpointId: string) =>
    taskDrafts[checkpointId] ?? {
      text: '',
      listType: 'have-to-do',
      dueDate: '',
      dueTimeStart: '',
      dueTimeEnd: '',
    };

  const saveGoal = async () => {
    setSavingGoal(true);
    try {
      await requestRoadmapChange({ action: 'set-goal', goal });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save goal');
    } finally {
      setSavingGoal(false);
    }
  };

  const addCheckpoint = async () => {
    if (!newCheckpointTitle.trim()) return;
    setCreatingCheckpoint(true);
    try {
      await requestRoadmapChange({
        action: 'add-checkpoint',
        title: newCheckpointTitle,
        description: newCheckpointDescription,
      });
      setNewCheckpointTitle('');
      setNewCheckpointDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add checkpoint');
    } finally {
      setCreatingCheckpoint(false);
    }
  };

  const updateCheckpoint = async (checkpoint: RoadmapCheckpointView) => {
    const draft = getCheckpointDraft(checkpoint);
    try {
      await requestRoadmapChange({
        action: 'update-checkpoint',
        checkpointId: checkpoint.id,
        title: draft.title,
        description: draft.description,
        status: draft.status,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update checkpoint');
    }
  };

  const removeCheckpoint = async (checkpointId: string) => {
    if (!window.confirm('Delete this checkpoint? Linked tasks will stay in your task lists.')) {
      return;
    }

    try {
      await requestRoadmapChange({ action: 'remove-checkpoint', checkpointId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove checkpoint');
    }
  };

  const reorderCheckpoint = async (checkpointId: string, newIndex: number) => {
    try {
      await requestRoadmapChange({ action: 'reorder-checkpoint', checkpointId, newIndex });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder checkpoint');
    }
  };

  const linkTask = async (checkpointId: string) => {
    const selected = linkSelections[checkpointId];
    if (!selected) return;
    const [taskId, listType] = selected.split(':') as [string, ListType];
    try {
      await requestRoadmapChange({ action: 'link-task', checkpointId, taskId, listType });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link task');
    }
  };

  const unlinkTask = async (checkpointId: string, task: RoadmapTaskView) => {
    try {
      await requestRoadmapChange({
        action: 'unlink-task',
        checkpointId,
        taskId: task.id,
        listType: task.listType,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unlink task');
    }
  };

  const createCheckpointTask = async (checkpointId: string) => {
    const draft = getTaskDraft(checkpointId);
    if (!draft.text.trim()) return;
    try {
      await requestRoadmapChange({
        action: 'create-task',
        checkpointId,
        text: draft.text,
        listType: draft.listType,
        dueDate: draft.dueDate || undefined,
        dueTimeStart: draft.dueDate ? draft.dueTimeStart || undefined : undefined,
        dueTimeEnd: draft.dueDate ? draft.dueTimeEnd || undefined : undefined,
      });
      setTaskDrafts((current) => ({
        ...current,
        [checkpointId]: { text: '', listType: draft.listType, dueDate: '', dueTimeStart: '', dueTimeEnd: '' },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    }
  };

  return (
    <div className="p-4 space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-2 md:flex-row md:items-start">
          <div className="flex-1">
            <label className="mb-1 block text-sm font-medium text-gray-600 dark:text-gray-300">Project goal</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="Define the project outcome"
            />
          </div>
          <button
            onClick={saveGoal}
            disabled={savingGoal}
            className="rounded-md bg-teal-500 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"
          >
            {savingGoal ? 'Saving...' : 'Save Goal'}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        <h4 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">Add Checkpoint</h4>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            value={newCheckpointTitle}
            onChange={(e) => setNewCheckpointTitle(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            placeholder="Checkpoint title"
          />
          <input
            value={newCheckpointDescription}
            onChange={(e) => setNewCheckpointDescription(e.target.value)}
            className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-amber-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            placeholder="Description"
          />
          <button
            onClick={addCheckpoint}
            disabled={!newCheckpointTitle.trim() || creatingCheckpoint}
            className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-500"
          >
            Add
          </button>
        </div>
      </div>

      {checkpoints.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
          No roadmap checkpoints yet
        </div>
      ) : (
        <div className="space-y-3">
          {checkpoints.map((checkpoint, index) => {
            const draft = getCheckpointDraft(checkpoint);
            const taskDraft = getTaskDraft(checkpoint.id);

            return (
              <section key={checkpoint.id} className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-semibold text-gray-700 dark:text-gray-200">Checkpoint {index + 1}</span>
                    <span>{statusLabel(checkpoint.status)}</span>
                    <span>
                      {checkpoint.progress.completed}/{checkpoint.progress.total} tasks complete
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => reorderCheckpoint(checkpoint.id, index - 1)}
                      disabled={index === 0}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Up
                    </button>
                    <button
                      onClick={() => reorderCheckpoint(checkpoint.id, index + 1)}
                      disabled={index === checkpoints.length - 1}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Down
                    </button>
                    <button
                      onClick={() => removeCheckpoint(checkpoint.id)}
                      className="rounded-md border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/20"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_180px_auto]">
                  <input
                    value={draft.title}
                    onChange={(e) =>
                      setCheckpointDrafts((current) => ({
                        ...current,
                        [checkpoint.id]: { ...draft, title: e.target.value },
                      }))
                    }
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                  <select
                    value={draft.status}
                    onChange={(e) =>
                      setCheckpointDrafts((current) => ({
                        ...current,
                        [checkpoint.id]: { ...draft, status: e.target.value as RoadmapCheckpointStatus },
                      }))
                    }
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="not-started">Not started</option>
                    <option value="in-progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                  <button
                    onClick={() => updateCheckpoint(checkpoint)}
                    className="rounded-md bg-teal-500 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 dark:bg-teal-600 dark:hover:bg-teal-500"
                  >
                    Save
                  </button>
                  <textarea
                    value={draft.description}
                    onChange={(e) =>
                      setCheckpointDrafts((current) => ({
                        ...current,
                        [checkpoint.id]: { ...draft, description: e.target.value },
                      }))
                    }
                    rows={2}
                    className="md:col-span-3 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    placeholder="Checkpoint notes"
                  />
                </div>

                <div className="mt-3 rounded-md bg-gray-50 p-3 dark:bg-gray-700/40">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <select
                      value={linkSelections[checkpoint.id] ?? ''}
                      onChange={(e) => setLinkSelections((current) => ({ ...current, [checkpoint.id]: e.target.value }))}
                      className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="">Link existing project task</option>
                      {linkableTasks.map((task) => (
                        <option key={`${task.id}:${task.listType}`} value={`${task.id}:${task.listType}`}>
                          {task.text} ({task.listType})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => linkTask(checkpoint.id)}
                      disabled={!linkSelections[checkpoint.id]}
                      className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-white disabled:opacity-40 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
                    >
                      Link
                    </button>
                  </div>

                  <div className="mb-3 grid grid-cols-1 gap-2 md:grid-cols-[1fr_140px_150px_120px_120px_auto]">
                    <input
                      value={taskDraft.text}
                      onChange={(e) =>
                        setTaskDrafts((current) => ({
                          ...current,
                          [checkpoint.id]: { ...taskDraft, text: e.target.value },
                        }))
                      }
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                      placeholder="New checkpoint task"
                    />
                    <select
                      value={taskDraft.listType}
                      onChange={(e) =>
                        setTaskDrafts((current) => ({
                          ...current,
                          [checkpoint.id]: { ...taskDraft, listType: e.target.value as ListType },
                        }))
                      }
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    >
                      <option value="have-to-do">Have to do</option>
                      <option value="want-to-do">Want to do</option>
                    </select>
                    <input
                      type="date"
                      value={taskDraft.dueDate}
                      onChange={(e) =>
                        setTaskDrafts((current) => ({
                          ...current,
                          [checkpoint.id]: { ...taskDraft, dueDate: e.target.value },
                        }))
                      }
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <input
                      type="time"
                      value={taskDraft.dueTimeStart}
                      disabled={!taskDraft.dueDate}
                      onChange={(e) =>
                        setTaskDrafts((current) => ({
                          ...current,
                          [checkpoint.id]: { ...taskDraft, dueTimeStart: e.target.value },
                        }))
                      }
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <input
                      type="time"
                      value={taskDraft.dueTimeEnd}
                      disabled={!taskDraft.dueDate || !taskDraft.dueTimeStart}
                      onChange={(e) =>
                        setTaskDrafts((current) => ({
                          ...current,
                          [checkpoint.id]: { ...taskDraft, dueTimeEnd: e.target.value },
                        }))
                      }
                      className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
                    />
                    <button
                      onClick={() => createCheckpointTask(checkpoint.id)}
                      disabled={!taskDraft.text.trim()}
                      className="rounded-md bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-40 dark:bg-amber-600 dark:hover:bg-amber-500"
                    >
                      Add Task
                    </button>
                  </div>

                  {checkpoint.tasks.length === 0 ? (
                    <p className="text-xs italic text-gray-400 dark:text-gray-500">No tasks linked</p>
                  ) : (
                    <ul className="divide-y divide-gray-200 dark:divide-gray-700">
                      {checkpoint.tasks.map((task) => (
                        <li key={`${task.id}:${task.listType}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                          <div className={task.completed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'}>
                            <TaskTextWithProjectBadges
                              text={task.text}
                              projects={task.projects}
                              textClassName={task.completed ? 'line-through' : undefined}
                            />
                            <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                              {task.missing ? 'missing' : `${formatDueLabel(task)} | ${task.listType}${task.completed ? ' | completed' : ''}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-1">
                            {!task.missing && !task.completed && (
                              <button
                                onClick={() => setTaskToPlan(task)}
                                className="rounded-md border border-indigo-200 px-2 py-1 text-xs text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-900/20"
                              >
                                Schedule
                              </button>
                            )}
                            <button
                              onClick={() => unlinkTask(checkpoint.id, task)}
                              className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-white dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                            >
                              Unlink
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <AddToPlanModal
        isOpen={Boolean(taskToPlan)}
        onClose={() => setTaskToPlan(null)}
        onSuccess={() => undefined}
        task={taskToPlan ? toTaskForPlanning(taskToPlan) : null}
        listType={taskToPlan?.listType ?? 'have-to-do'}
        date={date}
      />
    </div>
  );
}

function ProjectCard({
  group,
  mode,
  onModeChange,
  date,
  onChanged,
}: {
  group: ProjectGroup;
  mode: ProjectViewMode;
  onModeChange: (mode: ProjectViewMode) => void;
  date: string;
  onChanged: () => void;
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
          {group.project !== '__unassigned__' && (
            <button
              onClick={() => onModeChange('roadmap')}
              className={`px-3 py-1.5 text-xs font-medium border-l border-gray-300 dark:border-gray-600 transition-colors ${
                mode === 'roadmap'
                  ? 'bg-indigo-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              Roadmap
            </button>
          )}
        </div>
      </div>
      {mode === 'roadmap' && group.project !== '__unassigned__' ? (
        <RoadmapPanel group={group} date={date} onChanged={onChanged} />
      ) : mode === 'unified' ? (
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
                date={date}
                onChanged={() => fetchData(date)}
              />
            ))}
            <ProjectCard
              group={data.unassigned}
              mode={getModeForProject(data.unassigned.project)}
              onModeChange={(mode) => setModeForProject(data.unassigned.project, mode)}
              date={date}
              onChanged={() => fetchData(date)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
