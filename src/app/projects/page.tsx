'use client';

import React from 'react';
import { AddToPlanModal } from '@/components/AddToPlanModal';
import { AppHeader } from '@/components/AppHeader';
import { TaskTextWithProjectBadges } from '@/components/TaskTextWithProjectBadges';
import { formatDueTimeRangeForDisplay } from '@/lib/due-time';
import type { ListType, ProjectPreferencesData, RoadmapCheckpointStatus, Task } from '@/lib/types';

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

interface ProjectPreferencesResponse {
  success: boolean;
  preferences?: ProjectPreferencesData;
  error?: string;
}

type ProjectViewMode = 'unified' | 'detailed' | 'roadmap';

function getCurrentDateISO(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDueLabel(task: ProjectTaskView): string {
  if (!task.dueDate) return 'no due date';
  const dueTime = formatDueTimeRangeForDisplay(task.dueTimeStart, task.dueTimeEnd);
  if (!dueTime) return `due ${task.dueDate}`;
  return `due ${task.dueDate} @ ${dueTime}`;
}

function getPriorityTierColor(index: number, totalCount: number): string {
  if (totalCount === 0) return 'transparent';
  const position = index / totalCount;
  if (position < 1 / 3) return '#EF4444';
  if (position < 2 / 3) return '#F59E0B';
  return '#10B981';
}

function statusLabel(status: RoadmapCheckpointStatus): string {
  if (status === 'in-progress') return 'In progress';
  if (status === 'completed') return 'Completed';
  return 'Not started';
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

function filterProjectsExcept(
  projects: string[] | undefined,
  ownProject: string | undefined
): string[] | undefined {
  if (!projects || !ownProject) return projects;
  const filtered = projects.filter((project) => project !== ownProject);
  return filtered.length > 0 ? filtered : undefined;
}

function getActiveTaskCount(group: ProjectGroup): number {
  return group.unified.filter((task) => !task.completed).length;
}

function togglePinnedProject(pinnedProjects: string[], project: string, pinned: boolean): string[] {
  const withoutProject = pinnedProjects.filter((entry) => entry !== project);
  return pinned ? [project, ...withoutProject] : withoutProject;
}

interface TaskNode<T extends ProjectTaskView = ProjectTaskView> {
  task: T;
  children: TaskNode<T>[];
}

function buildTaskTree<T extends ProjectTaskView>(tasks: T[]): TaskNode<T>[] {
  const nodes = new Map<string, TaskNode<T>>();
  const ordered: TaskNode<T>[] = [];

  for (const task of tasks) {
    const node: TaskNode<T> = { task, children: [] };
    nodes.set(task.id, node);
    ordered.push(node);
  }

  const roots: TaskNode<T>[] = [];
  for (const node of ordered) {
    const parentId = node.task.parentTaskId;
    if (parentId && parentId !== node.task.id && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

interface FlatTaskRow<T extends ProjectTaskView = ProjectTaskView> {
  node: TaskNode<T>;
  depth: number;
  indexAtLevel: number;
  totalAtLevel: number;
  isOrphanedChild: boolean;
}

function flattenTaskTree<T extends ProjectTaskView>(
  roots: TaskNode<T>[]
): FlatTaskRow<T>[] {
  const result: FlatTaskRow<T>[] = [];
  const visit = (
    node: TaskNode<T>,
    depth: number,
    indexAtLevel: number,
    totalAtLevel: number
  ) => {
    const isOrphanedChild = depth === 0 && Boolean(node.task.parentTaskId);
    result.push({ node, depth, indexAtLevel, totalAtLevel, isOrphanedChild });
    node.children.forEach((child, childIdx) =>
      visit(child, depth + 1, childIdx, node.children.length)
    );
  };
  roots.forEach((root, rootIdx) => visit(root, 0, rootIdx, roots.length));
  return result;
}

function getIndentClass(depth: number): string {
  if (depth <= 0) return '';
  if (depth === 1) return 'ml-6';
  if (depth === 2) return 'ml-10';
  return 'ml-14';
}

function SubtaskBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-700/70 dark:text-slate-200">
      Subtask
    </span>
  );
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

function CheckmarkIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function PencilIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L4 13.172V16h2.828l7.379-7.379-2.828-2.828z" />
    </svg>
  );
}

function DetailedTaskList({
  tasks,
  tone,
  hideOwnProjectBadge,
}: {
  tasks: ProjectTaskView[];
  tone: 'amber' | 'teal' | 'indigo';
  hideOwnProjectBadge?: string;
}) {
  const borderClass =
    tone === 'amber'
      ? 'border-l-4 border-amber-500/70'
      : tone === 'teal'
        ? 'border-l-4 border-teal-500/70'
        : 'border-l-4 border-indigo-500/60';

  const rows = flattenTaskTree(buildTaskTree(tasks));

  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 ${borderClass} overflow-hidden`}
    >
      <div className="p-3 max-h-56 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No tasks</p>
        ) : (
          <ul className="space-y-0">
            {rows.map((row, idx) => {
              const task = row.node.task;
              const visibleProjects = filterProjectsExcept(task.projects, hideOwnProjectBadge);
              return (
                <li
                  key={task.id}
                  className={`text-sm text-gray-700 dark:text-gray-200 py-1.5 ${
                    idx !== rows.length - 1
                      ? 'border-b border-gray-100 dark:border-gray-700/50'
                      : ''
                  } ${getIndentClass(row.depth)}`}
                >
                  <div>
                    <TaskTextWithProjectBadges
                      text={task.text}
                      projects={visibleProjects}
                      textClassName={task.completed ? 'line-through' : undefined}
                    />
                    {row.depth > 0 && <SubtaskBadge />}
                    {row.isOrphanedChild && renderParentTaskBadge(task.parentTaskText)}
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5">
                    {formatDueLabel(task)}
                    {task.isDaily ? ' · daily' : ''}
                    {task.completed ? ' · completed' : ''}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function CondensedDetailedView({
  group,
  hideOwnProjectBadge,
}: {
  group: ProjectGroup;
  hideOwnProjectBadge?: string;
}) {
  const rows = [
    {
      label: 'General',
      have: group.general.haveToDo,
      want: group.general.wantToDo,
      completedRow: false,
    },
    {
      label: 'Today',
      have: group.today.haveToDo,
      want: group.today.wantToDo,
      completedRow: false,
    },
    {
      label: 'Completed',
      have: group.completed.haveToDo,
      want: group.completed.wantToDo,
      completedRow: true,
    },
  ].filter((row) => row.have.length > 0 || row.want.length > 0);

  if (rows.length === 0) {
    return (
      <p className="text-xs italic text-gray-500 dark:text-gray-400">No tasks in any list</p>
    );
  }

  const anyHave = rows.some((row) => row.have.length > 0);
  const anyWant = rows.some((row) => row.want.length > 0);
  const cols = (anyHave ? 1 : 0) + (anyWant ? 1 : 0);

  return (
    <div className="space-y-5">
      {rows.map((row) => (
        <div key={row.label}>
          <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
            {row.label}
          </h4>
          <div className={`grid gap-3 ${cols === 2 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
            {anyHave &&
              (row.have.length > 0 ? (
                <DetailedTaskList
                  tasks={row.have}
                  tone={row.completedRow ? 'indigo' : 'amber'}
                  hideOwnProjectBadge={hideOwnProjectBadge}
                />
              ) : (
                <div aria-hidden className="hidden md:block" />
              ))}
            {anyWant &&
              (row.want.length > 0 ? (
                <DetailedTaskList
                  tasks={row.want}
                  tone={row.completedRow ? 'indigo' : 'teal'}
                  hideOwnProjectBadge={hideOwnProjectBadge}
                />
              ) : (
                <div aria-hidden className="hidden md:block" />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function UnifiedTaskList({
  tasks,
  hideOwnProjectBadge,
}: {
  tasks: ProjectTaskView[];
  hideOwnProjectBadge?: string;
}) {
  const roots = buildTaskTree(tasks);
  const rows = flattenTaskTree(roots);
  const activeRootCount = roots.reduce(
    (count, root) => count + (root.task.completed ? 0 : 1),
    0
  );

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div className="p-3 max-h-[28rem] overflow-y-auto">
        {rows.length === 0 ? (
          <p className="text-xs text-gray-400 dark:text-gray-500 italic">No tasks</p>
        ) : (
          <ol className="space-y-0">
            {rows.map((row, idx) => {
              const task = row.node.task;
              const visibleProjects = filterProjectsExcept(task.projects, hideOwnProjectBadge);
              const priorityColor =
                row.depth === 0
                  ? task.completed
                    ? '#9CA3AF'
                    : getPriorityTierColor(row.indexAtLevel, Math.max(activeRootCount, 1))
                  : '#CBD5E1';

              return (
                <li
                  key={task.id}
                  className={`text-sm py-2 ${idx !== rows.length - 1 ? 'border-b border-gray-200 dark:border-gray-700' : ''} ${
                    task.completed ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-200'
                  } ${getIndentClass(row.depth)}`}
                  style={{
                    borderLeft: `4px solid ${priorityColor}`,
                    paddingLeft: '8px',
                    marginLeft: row.depth === 0 ? '-4px' : undefined,
                  }}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-gray-400 dark:text-gray-500 mt-0.5">
                      {row.indexAtLevel + 1}.
                    </span>
                    <div className="min-w-0 flex-1">
                      <p>
                        <TaskTextWithProjectBadges
                          text={task.text}
                          projects={visibleProjects}
                          textClassName={task.completed ? 'line-through' : undefined}
                        />
                        {row.depth > 0 && <SubtaskBadge />}
                        {row.isOrphanedChild && renderParentTaskBadge(task.parentTaskText)}
                      </p>
                      <p className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 mt-0.5">
                        {formatDueLabel(task)}
                        {task.isDaily ? ' · daily' : ''}
                        {task.completed ? ' · completed' : ' · active'}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

function StepperNode({
  index,
  checkpoint,
  selected,
  onClick,
}: {
  index: number;
  checkpoint: RoadmapCheckpointView;
  selected: boolean;
  onClick: () => void;
}) {
  const completed = checkpoint.status === 'completed';
  const inProgress = checkpoint.status === 'in-progress';

  const circleClass = completed
    ? 'bg-green-500 text-white'
    : inProgress
      ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-2 ring-amber-500 dark:ring-amber-400'
      : 'bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400';

  const selectionRing = selected
    ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-teal-500 dark:ring-teal-400'
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 w-[120px] flex flex-col items-center gap-2 transition-opacity ${
        selected ? 'opacity-100' : 'opacity-70 hover:opacity-100'
      }`}
    >
      <div
        className={`relative w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold ${circleClass} ${selectionRing}`}
      >
        {completed ? <CheckmarkIcon className="w-5 h-5" /> : index}
      </div>
      <div className="text-center min-w-0 w-full">
        <div className="text-xs font-medium text-gray-800 dark:text-gray-100 leading-tight line-clamp-2 px-1">
          {checkpoint.title}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">
          {checkpoint.progress.completed}/{checkpoint.progress.total}
        </div>
      </div>
    </button>
  );
}

function StepperConnector({ dashed = false }: { dashed?: boolean }) {
  return (
    <div className="flex-shrink-0 self-start mt-5 w-8">
      <div
        className={
          dashed
            ? 'h-0 border-t border-dashed border-gray-300 dark:border-gray-600'
            : 'h-0.5 bg-gray-300 dark:bg-gray-600'
        }
      />
    </div>
  );
}

function AddCheckpointNode({
  onClick,
  isOpen,
}: {
  onClick: () => void;
  isOpen: boolean;
}) {
  return (
    <div className="flex-shrink-0 w-[120px] flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        className={`w-10 h-10 rounded-full border-2 border-dashed flex items-center justify-center text-xl leading-none transition-colors ${
          isOpen
            ? 'border-teal-500 text-teal-500'
            : 'border-gray-300 dark:border-gray-600 text-gray-400 hover:border-teal-400 hover:text-teal-400'
        }`}
        aria-label="Add checkpoint"
      >
        +
      </button>
      <div className="text-[10px] uppercase tracking-wide text-gray-500">Add</div>
    </div>
  );
}

function RoadmapStepper({
  group,
  date,
  onChanged,
}: {
  group: ProjectGroup;
  date: string;
  onChanged: () => void;
}) {
  const checkpoints = React.useMemo(() => group.roadmap?.checkpoints ?? [], [group.roadmap]);
  const currentGoal = group.roadmap?.goal ?? '';

  const [goalDraft, setGoalDraft] = React.useState(currentGoal);
  const [editingGoal, setEditingGoal] = React.useState(false);
  const [savingGoal, setSavingGoal] = React.useState(false);

  const [showAddCheckpointForm, setShowAddCheckpointForm] = React.useState(false);
  const [newCheckpointTitle, setNewCheckpointTitle] = React.useState('');
  const [newCheckpointDescription, setNewCheckpointDescription] = React.useState('');
  const [creatingCheckpoint, setCreatingCheckpoint] = React.useState(false);

  const [selectedCheckpointId, setSelectedCheckpointId] = React.useState<string | null>(null);

  const [taskToPlan, setTaskToPlan] = React.useState<ProjectTaskView | null>(null);
  const [checkpointDrafts, setCheckpointDrafts] = React.useState<
    Record<string, { title: string; description: string; status: RoadmapCheckpointStatus }>
  >({});
  const [linkSelections, setLinkSelections] = React.useState<Record<string, string>>({});
  const [taskDrafts, setTaskDrafts] = React.useState<
    Record<
      string,
      { text: string; listType: ListType; dueDate: string; dueTimeStart: string; dueTimeEnd: string }
    >
  >({});
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setGoalDraft(group.roadmap?.goal ?? '');
    setEditingGoal(false);
    setShowAddCheckpointForm(false);
    setNewCheckpointTitle('');
    setNewCheckpointDescription('');
    setCheckpointDrafts({});
    setLinkSelections({});
    setTaskDrafts({});
    setError(null);
    setSelectedCheckpointId(null);
  }, [group.project, group.roadmap]);

  React.useEffect(() => {
    if (checkpoints.length === 0) {
      if (selectedCheckpointId !== null) {
        setSelectedCheckpointId(null);
      }
      return;
    }
    if (selectedCheckpointId && checkpoints.some((cp) => cp.id === selectedCheckpointId)) {
      return;
    }
    const firstInProgress = checkpoints.find((cp) => cp.status === 'in-progress');
    setSelectedCheckpointId((firstInProgress ?? checkpoints[0]).id);
  }, [checkpoints, selectedCheckpointId]);

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

  const linkedTaskKeys = new Set(
    checkpoints.flatMap((checkpoint) => checkpoint.tasks.map((task) => `${task.id}:${task.listType}`))
  );
  const linkableTasks = group.unified.filter(
    (task) => !linkedTaskKeys.has(`${task.id}:${task.listType}`)
  );

  const getCheckpointDraft = (checkpoint: RoadmapCheckpointView) =>
    checkpointDrafts[checkpoint.id] ?? {
      title: checkpoint.title,
      description: checkpoint.description ?? '',
      status: checkpoint.status,
    };

  const getTaskDraft = (checkpointId: string) =>
    taskDrafts[checkpointId] ?? {
      text: '',
      listType: 'have-to-do' as ListType,
      dueDate: '',
      dueTimeStart: '',
      dueTimeEnd: '',
    };

  const saveGoal = async () => {
    setSavingGoal(true);
    try {
      await requestRoadmapChange({ action: 'set-goal', goal: goalDraft });
      setEditingGoal(false);
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
      setShowAddCheckpointForm(false);
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

  const selectedCheckpoint =
    checkpoints.find((cp) => cp.id === selectedCheckpointId) ?? null;
  const selectedIndex = selectedCheckpoint
    ? checkpoints.findIndex((cp) => cp.id === selectedCheckpoint.id)
    : -1;

  return (
    <div className="p-4 space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-800">
        {!editingGoal ? (
          currentGoal ? (
            <div className="flex items-start gap-3">
              <div className="flex-1">
                <div className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400 mb-1">
                  Goal
                </div>
                <p className="text-sm text-gray-700 dark:text-gray-200">{currentGoal}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGoalDraft(currentGoal);
                  setEditingGoal(true);
                }}
                className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-500 dark:text-teal-400 dark:hover:text-teal-300"
              >
                <PencilIcon />
                Edit
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setGoalDraft('');
                setEditingGoal(true);
              }}
              className="inline-flex items-center gap-1 text-xs text-teal-600 hover:text-teal-500 dark:text-teal-400 dark:hover:text-teal-300"
            >
              <PencilIcon />
              Set a goal for this project
            </button>
          )
        ) : (
          <div>
            <label className="mb-1 block text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
              Goal
            </label>
            <textarea
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="Define the project outcome"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setGoalDraft(currentGoal);
                  setEditingGoal(false);
                }}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveGoal}
                disabled={savingGoal}
                className="rounded-md bg-teal-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-600 disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"
              >
                {savingGoal ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        {checkpoints.length === 0 && !showAddCheckpointForm ? (
          <div className="flex items-center justify-center gap-3 py-2">
            <AddCheckpointNode
              onClick={() => setShowAddCheckpointForm(true)}
              isOpen={showAddCheckpointForm}
            />
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No roadmap checkpoints yet — click + to add the first one
            </p>
          </div>
        ) : (
          <div className="flex items-start overflow-x-auto pb-1">
            {checkpoints.map((checkpoint, index) => (
              <React.Fragment key={checkpoint.id}>
                <StepperNode
                  index={index + 1}
                  checkpoint={checkpoint}
                  selected={selectedCheckpointId === checkpoint.id}
                  onClick={() => setSelectedCheckpointId(checkpoint.id)}
                />
                {index < checkpoints.length - 1 && <StepperConnector />}
              </React.Fragment>
            ))}
            {checkpoints.length > 0 && <StepperConnector dashed />}
            <AddCheckpointNode
              onClick={() => setShowAddCheckpointForm((current) => !current)}
              isOpen={showAddCheckpointForm}
            />
          </div>
        )}

        {showAddCheckpointForm && (
          <div className="mt-4 rounded-md border border-dashed border-teal-400/60 bg-teal-50/40 p-3 dark:border-teal-500/40 dark:bg-teal-900/10">
            <h4 className="mb-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
              New Checkpoint
            </h4>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto_auto]">
              <input
                value={newCheckpointTitle}
                onChange={(e) => setNewCheckpointTitle(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                placeholder="Checkpoint title"
                autoFocus
              />
              <input
                value={newCheckpointDescription}
                onChange={(e) => setNewCheckpointDescription(e.target.value)}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                placeholder="Description (optional)"
              />
              <button
                type="button"
                onClick={() => {
                  setShowAddCheckpointForm(false);
                  setNewCheckpointTitle('');
                  setNewCheckpointDescription('');
                }}
                className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={addCheckpoint}
                disabled={!newCheckpointTitle.trim() || creatingCheckpoint}
                className="rounded-md bg-teal-500 px-3 py-2 text-xs font-medium text-white hover:bg-teal-600 disabled:opacity-50 dark:bg-teal-600 dark:hover:bg-teal-500"
              >
                {creatingCheckpoint ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedCheckpoint && (
        <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          {(() => {
            const checkpoint = selectedCheckpoint;
            const draft = getCheckpointDraft(checkpoint);
            const taskDraft = getTaskDraft(checkpoint.id);

            return (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-semibold text-gray-700 dark:text-gray-200">
                      Checkpoint {selectedIndex + 1}
                    </span>
                    <span>·</span>
                    <span>{statusLabel(checkpoint.status)}</span>
                    <span>·</span>
                    <span>
                      {checkpoint.progress.completed}/{checkpoint.progress.total} tasks complete
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => reorderCheckpoint(checkpoint.id, selectedIndex - 1)}
                      disabled={selectedIndex <= 0}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      onClick={() => reorderCheckpoint(checkpoint.id, selectedIndex + 1)}
                      disabled={selectedIndex >= checkpoints.length - 1}
                      className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
                    >
                      Down
                    </button>
                    <button
                      type="button"
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
                        [checkpoint.id]: {
                          ...draft,
                          status: e.target.value as RoadmapCheckpointStatus,
                        },
                      }))
                    }
                    className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-teal-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="not-started">Not started</option>
                    <option value="in-progress">In progress</option>
                    <option value="completed">Completed</option>
                  </select>
                  <button
                    type="button"
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

                <div className="mt-4 rounded-md bg-gray-50 p-3 dark:bg-gray-700/40">
                  <h5 className="mb-2 text-[11px] uppercase tracking-wider font-semibold text-gray-500 dark:text-gray-400">
                    Tasks
                  </h5>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <select
                      value={linkSelections[checkpoint.id] ?? ''}
                      onChange={(e) =>
                        setLinkSelections((current) => ({
                          ...current,
                          [checkpoint.id]: e.target.value,
                        }))
                      }
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
                      type="button"
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
                      type="button"
                      onClick={() => createCheckpointTask(checkpoint.id)}
                      disabled={!taskDraft.text.trim()}
                      className="rounded-md bg-teal-500 px-3 py-2 text-sm font-medium text-white hover:bg-teal-600 disabled:opacity-40 dark:bg-teal-600 dark:hover:bg-teal-500"
                    >
                      Add Task
                    </button>
                  </div>

                  {(() => {
                    if (checkpoint.tasks.length === 0) {
                      return (
                        <p className="text-xs italic text-gray-400 dark:text-gray-500">
                          No tasks linked
                        </p>
                      );
                    }
                    const roadmapRows = flattenTaskTree(buildTaskTree(checkpoint.tasks));
                    return (
                      <ul className="space-y-0">
                        {roadmapRows.map((row, idx) => {
                          const task = row.node.task;
                          return (
                            <li
                              key={`${task.id}:${task.listType}`}
                              className={`flex flex-wrap items-center justify-between gap-2 py-2 text-sm ${
                                idx !== roadmapRows.length - 1
                                  ? 'border-b border-gray-200 dark:border-gray-700'
                                  : ''
                              } ${getIndentClass(row.depth)}`}
                            >
                              <div
                                className={
                                  task.completed
                                    ? 'text-gray-400 dark:text-gray-500'
                                    : 'text-gray-700 dark:text-gray-200'
                                }
                              >
                                <TaskTextWithProjectBadges
                                  text={task.text}
                                  projects={filterProjectsExcept(task.projects, group.project)}
                                  textClassName={task.completed ? 'line-through' : undefined}
                                />
                                {row.depth > 0 && <SubtaskBadge />}
                                {row.isOrphanedChild && renderParentTaskBadge(task.parentTaskText)}
                                <span className="ml-2 text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
                                  {task.missing
                                    ? 'missing'
                                    : `${formatDueLabel(task)} · ${task.listType}${task.completed ? ' · completed' : ''}`}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                {!task.missing && !task.completed && (
                                  <button
                                    type="button"
                                    onClick={() => setTaskToPlan(task)}
                                    className="rounded-md border border-teal-200 px-2 py-1 text-xs text-teal-600 hover:bg-teal-50 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-900/20"
                                  >
                                    Schedule
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => unlinkTask(checkpoint.id, task)}
                                  className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-white dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
                                >
                                  Unlink
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </>
            );
          })()}
        </section>
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
  isPinned = false,
  onPinnedChange,
  isPinning = false,
}: {
  group: ProjectGroup;
  mode: ProjectViewMode;
  onModeChange: (mode: ProjectViewMode) => void;
  date: string;
  onChanged: () => void;
  isPinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  isPinning?: boolean;
}) {
  const isUnassigned = group.project === '__unassigned__';
  const activeCount = getActiveTaskCount(group);
  const completedCount = group.unified.filter((task) => task.completed).length;
  const total = group.totals.all;
  const completedPct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
  const quietCard = activeCount === 0 && !isUnassigned;
  const hideOwnProjectBadge = isUnassigned ? undefined : group.project;

  return (
    <section
      className={`rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm overflow-hidden transition-opacity ${
        quietCard ? 'opacity-60 hover:opacity-100' : ''
      }`}
    >
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0 flex-1">
            {isUnassigned ? (
              <h3 className="text-base font-semibold text-gray-700 dark:text-gray-100">
                Unassigned
              </h3>
            ) : (
              <h3>
                <span className="inline-flex items-center px-2.5 py-1 rounded bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300 font-mono text-sm font-semibold">
                  {group.project}
                </span>
              </h3>
            )}
          </div>
          {!isUnassigned && onPinnedChange && (
            <button
              type="button"
              aria-pressed={isPinned}
              disabled={isPinning}
              onClick={() => onPinnedChange(!isPinned)}
              className={`shrink-0 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                isPinned
                  ? 'border-teal-500 bg-teal-500 text-white hover:bg-teal-600'
                  : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-gray-100'
              }`}
              title={isPinned ? 'Unpin project' : 'Pin project to top'}
            >
              {isPinned ? 'Pinned' : 'Pin'}
            </button>
          )}
          <div className="inline-flex rounded-md border border-gray-300 dark:border-gray-600 overflow-hidden shrink-0">
            <button
              type="button"
              onClick={() => onModeChange('unified')}
              className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                mode === 'unified'
                  ? 'bg-teal-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              God View
            </button>
            <button
              type="button"
              onClick={() => onModeChange('detailed')}
              className={`px-2.5 py-1 text-[11px] font-medium border-l border-gray-300 dark:border-gray-600 transition-colors ${
                mode === 'detailed'
                  ? 'bg-amber-500 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              Detailed
            </button>
            {!isUnassigned && (
              <button
                type="button"
                onClick={() => onModeChange('roadmap')}
                className={`px-2.5 py-1 text-[11px] font-medium border-l border-gray-300 dark:border-gray-600 transition-colors ${
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
        <div className="flex items-center gap-3">
          <div
            className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden"
            role="progressbar"
            aria-valuenow={completedPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full bg-teal-500 transition-all"
              style={{ width: `${completedPct}%` }}
            />
          </div>
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400 whitespace-nowrap">
            {activeCount} active · {completedCount} completed
          </div>
        </div>
      </div>
      {mode === 'roadmap' && !isUnassigned ? (
        <RoadmapStepper group={group} date={date} onChanged={onChanged} />
      ) : mode === 'unified' ? (
        <div className="p-4">
          <UnifiedTaskList tasks={group.unified} hideOwnProjectBadge={hideOwnProjectBadge} />
        </div>
      ) : (
        <div className="p-4">
          <CondensedDetailedView group={group} hideOwnProjectBadge={hideOwnProjectBadge} />
        </div>
      )}
    </section>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden animate-pulse">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
        <div className="flex items-center justify-between mb-3">
          <div className="h-6 w-32 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-6 w-44 rounded bg-gray-200 dark:bg-gray-700" />
        </div>
        <div className="h-1.5 rounded-full bg-gray-200 dark:bg-gray-700" />
      </div>
      <div className="p-4 space-y-2">
        <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="h-4 w-2/3 rounded bg-gray-200 dark:bg-gray-700" />
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const [date, setDate] = React.useState(getCurrentDateISO());
  const [data, setData] = React.useState<ProjectsViewResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [preferencesError, setPreferencesError] = React.useState<string | null>(null);
  const [viewModes, setViewModes] = React.useState<Record<string, ProjectViewMode>>({});
  const [pinnedProjects, setPinnedProjects] = React.useState<string[]>([]);
  const [pinningProjects, setPinningProjects] = React.useState<Record<string, boolean>>({});
  const [inactiveProjectsExpanded, setInactiveProjectsExpanded] = React.useState(false);

  const fetchData = React.useCallback(async (forDate: string) => {
    setLoading(true);
    setError(null);
    setPreferencesError(null);
    try {
      const [projectsResult, preferencesResult] = await Promise.allSettled([
        fetch(`/api/projects/view?date=${forDate}`).then(async (response) => {
          const payload = (await response.json()) as ProjectsViewResponse;
          if (!response.ok || !payload.success) {
            throw new Error(payload.error || 'Failed to fetch projects view');
          }
          return payload;
        }),
        fetch('/api/projects/preferences').then(async (response) => {
          const payload = (await response.json()) as ProjectPreferencesResponse;
          if (!response.ok || !payload.success || !payload.preferences) {
            throw new Error(payload.error || 'Failed to fetch project preferences');
          }
          return payload.preferences;
        }),
      ]);

      if (projectsResult.status === 'rejected') {
        setError(projectsResult.reason instanceof Error ? projectsResult.reason.message : 'Failed to fetch projects view');
        setData(null);
        return;
      }

      setData(projectsResult.value);

      if (preferencesResult.status === 'fulfilled') {
        setPinnedProjects(preferencesResult.value.pinnedProjects);
      } else {
        setPreferencesError('Failed to load project pin preferences');
      }
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

  const handlePinnedChange = React.useCallback(
    async (project: string, pinned: boolean) => {
      const previousPinnedProjects = pinnedProjects;
      setPinnedProjects(togglePinnedProject(previousPinnedProjects, project, pinned));
      setPinningProjects((current) => ({ ...current, [project]: true }));
      setPreferencesError(null);

      try {
        const response = await fetch('/api/projects/preferences', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action: 'set-pinned',
            project,
            pinned,
          }),
        });
        const payload = (await response.json()) as ProjectPreferencesResponse;
        if (!response.ok || !payload.success || !payload.preferences) {
          throw new Error(payload.error || 'Failed to save project pin');
        }
        setPinnedProjects(payload.preferences.pinnedProjects);
      } catch (pinError) {
        setPinnedProjects(previousPinnedProjects);
        setPreferencesError(pinError instanceof Error ? pinError.message : 'Failed to save project pin');
      } finally {
        setPinningProjects((current) => {
          const next = { ...current };
          delete next[project];
          return next;
        });
      }
    },
    [pinnedProjects]
  );

  const pinnedProjectSet = React.useMemo(() => new Set(pinnedProjects), [pinnedProjects]);
  const pinnedProjectOrder = React.useMemo(
    () => new Map(pinnedProjects.map((project, index) => [project, index])),
    [pinnedProjects]
  );

  const sortedProjects = React.useMemo(() => {
    if (!data) {
      return [];
    }

    return [...data.projects].sort((a, b) => {
      const aPinnedIndex = pinnedProjectOrder.get(a.project);
      const bPinnedIndex = pinnedProjectOrder.get(b.project);

      if (aPinnedIndex === undefined && bPinnedIndex === undefined) {
        return 0;
      }
      if (aPinnedIndex === undefined) {
        return 1;
      }
      if (bPinnedIndex === undefined) {
        return -1;
      }
      return aPinnedIndex - bPinnedIndex;
    });
  }, [data, pinnedProjectOrder]);

  const visibleProjects = React.useMemo(
    () => sortedProjects.filter((group) => pinnedProjectSet.has(group.project) || getActiveTaskCount(group) > 0),
    [pinnedProjectSet, sortedProjects]
  );

  const hiddenProjects = React.useMemo(
    () => sortedProjects.filter((group) => !pinnedProjectSet.has(group.project) && getActiveTaskCount(group) === 0),
    [pinnedProjectSet, sortedProjects]
  );

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <AppHeader
        title="Projects"
        subtitle="Project-specific overview built for high-level context, not daily accounting"
        actions={
          <div className="flex items-center gap-2">
            <label
              htmlFor="projects-date"
              className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400"
            >
              Context Date
            </label>
            <input
              id="projects-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="px-3 py-1.5 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-800 dark:text-gray-100"
            />
          </div>
        }
      />
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-6">

        {loading && (
          <div className="space-y-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
        )}
        {!loading && !error && data && (
          <div className="space-y-4">
            {preferencesError && (
              <p className="text-sm text-amber-600 dark:text-amber-300">{preferencesError}</p>
            )}

            {visibleProjects.map((group) => (
              <ProjectCard
                key={group.project}
                group={group}
                mode={getModeForProject(group.project)}
                onModeChange={(mode) => setModeForProject(group.project, mode)}
                date={date}
                onChanged={() => fetchData(date)}
                isPinned={pinnedProjectSet.has(group.project)}
                isPinning={Boolean(pinningProjects[group.project])}
                onPinnedChange={(pinned) => handlePinnedChange(group.project, pinned)}
              />
            ))}

            {hiddenProjects.length > 0 && (
              <details
                open={inactiveProjectsExpanded}
                onToggle={(event) => setInactiveProjectsExpanded(event.currentTarget.open)}
                className="rounded-xl border border-dashed border-gray-300 bg-gray-50/70 p-4 dark:border-gray-700 dark:bg-gray-800/40"
              >
                <summary className="cursor-pointer select-none text-sm font-semibold text-gray-700 dark:text-gray-200">
                  Hidden projects
                  <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    {hiddenProjects.length}
                  </span>
                </summary>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Projects with zero active tasks are tucked away here.
                </p>
                {inactiveProjectsExpanded && (
                  <div className="mt-4 space-y-4">
                    {hiddenProjects.map((group) => (
                      <ProjectCard
                        key={group.project}
                        group={group}
                        mode={getModeForProject(group.project)}
                        onModeChange={(mode) => setModeForProject(group.project, mode)}
                        date={date}
                        onChanged={() => fetchData(date)}
                        isPinned={pinnedProjectSet.has(group.project)}
                        isPinning={Boolean(pinningProjects[group.project])}
                        onPinnedChange={(pinned) => handlePinnedChange(group.project, pinned)}
                      />
                    ))}
                  </div>
                )}
              </details>
            )}

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
