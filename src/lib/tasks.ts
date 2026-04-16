import { Task } from './types';

export interface TaskHierarchy {
  topLevelTasks: Task[];
  taskMap: Map<string, Task>;
  childrenByParentId: Map<string, Task[]>;
}

export function isSubtask(task: Pick<Task, 'parentTaskId'>): boolean {
  return typeof task.parentTaskId === 'string' && task.parentTaskId.trim().length > 0;
}

export function buildTaskMap(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((task) => [task.id, task]));
}

export function buildChildrenByParentId(tasks: Task[]): Map<string, Task[]> {
  const taskMap = buildTaskMap(tasks);
  const childrenByParentId = new Map<string, Task[]>();

  for (const task of tasks) {
    if (!isSubtask(task)) {
      continue;
    }

    const parentId = task.parentTaskId!.trim();
    if (!taskMap.has(parentId)) {
      continue;
    }

    const children = childrenByParentId.get(parentId) ?? [];
    children.push(task);
    childrenByParentId.set(parentId, children);
  }

  return childrenByParentId;
}

export function getDescendantTaskIds(
  taskId: string,
  childrenByParentId: Map<string, Task[]>
): string[] {
  const descendants: string[] = [];
  const stack = [...(childrenByParentId.get(taskId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    descendants.push(current.id);

    const children = childrenByParentId.get(current.id);
    if (children && children.length > 0) {
      stack.push(...children);
    }
  }

  return descendants;
}

export function getAncestorTaskIds(taskId: string, taskMap: Map<string, Task>): string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = taskMap.get(taskId);

  while (current?.parentTaskId) {
    const parentId = current.parentTaskId.trim();
    if (parentId.length === 0 || visited.has(parentId)) {
      break;
    }

    visited.add(parentId);
    ancestors.push(parentId);
    current = taskMap.get(parentId);
  }

  return ancestors;
}

export function isDescendantTask(
  candidateTaskId: string,
  possibleAncestorId: string,
  taskMap: Map<string, Task>
): boolean {
  return getAncestorTaskIds(candidateTaskId, taskMap).includes(possibleAncestorId);
}

export function validateParentTaskAssignment(
  tasks: Task[],
  taskId: string,
  parentTaskId?: string
): { valid: true } | { valid: false; error: string } {
  if (parentTaskId === undefined) {
    return { valid: true };
  }

  const normalizedParentId = parentTaskId.trim();
  if (normalizedParentId.length === 0) {
    return { valid: true };
  }

  if (normalizedParentId === taskId) {
    return { valid: false, error: 'A task cannot be its own parent' };
  }

  const taskMap = buildTaskMap(tasks);
  const parentTask = taskMap.get(normalizedParentId);
  if (!parentTask) {
    return { valid: false, error: 'Parent task not found in this list' };
  }

  if (isDescendantTask(normalizedParentId, taskId, taskMap)) {
    return { valid: false, error: 'A task cannot be moved under one of its descendants' };
  }

  return { valid: true };
}

function cloneTaskForHierarchy(task: Task, childrenByParentId: Map<string, Task[]>): Task {
  const children = childrenByParentId.get(task.id) ?? [];
  if (children.length === 0) {
    if (!task.childTasks) {
      return { ...task };
    }

    const clonedTask = { ...task };
    delete clonedTask.childTasks;
    return clonedTask;
  }

  return {
    ...task,
    childTasks: children.map((child) => cloneTaskForHierarchy(child, childrenByParentId)),
  };
}

export function buildTaskHierarchy(tasks: Task[]): TaskHierarchy {
  const taskMap = buildTaskMap(tasks);
  const childrenByParentId = buildChildrenByParentId(tasks);
  const topLevelTasks: Task[] = [];

  for (const task of tasks) {
    if (isSubtask(task) && taskMap.has(task.parentTaskId!.trim())) {
      continue;
    }

    topLevelTasks.push(cloneTaskForHierarchy(task, childrenByParentId));
  }

  return {
    topLevelTasks,
    taskMap,
    childrenByParentId,
  };
}

export function findParentTask(task: Task, taskMap: Map<string, Task>): Task | null {
  if (!isSubtask(task)) {
    return null;
  }

  return taskMap.get(task.parentTaskId!.trim()) ?? null;
}

export function findRootTask(task: Task, taskMap: Map<string, Task>): Task {
  let current: Task = task;
  let nextParent = findParentTask(current, taskMap);

  while (nextParent) {
    current = nextParent;
    nextParent = findParentTask(current, taskMap);
  }

  return current;
}
