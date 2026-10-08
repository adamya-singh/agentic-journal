import { NextRequest, NextResponse } from 'next/server';
import type { ListType } from '@/lib/types';
import { handleDueDateSetup } from '../due-date-utils';
import { readGeneralTasks, removeTaskIdsFromTodayOverrides, writeGeneralTasks } from '../today/today-store-utils';
import {
  ensureCurrentSystemThroughToday,
  readCurrentTaskIds,
  refreshActiveDailySnapshots,
  removeTaskIdsFromCurrent,
} from '../current/current-store-utils';
import { readLetGo, takeOut, writeLetGo } from './let-go-store';

const ERRORS = {
  'not-found': [404, 'Task not found in list'],
  daily: [400, 'Daily recurring tasks cannot be let go'],
  completed: [400, 'Completed tasks cannot be let go'],
} as const;

/**
 * GET /api/tasks/let-go
 * Tasks that were let go, newest first.
 */
export async function GET() {
  try {
    const records = readLetGo().records.slice().sort((a, b) => b.letGoAt.localeCompare(a.letGoAt));
    return NextResponse.json({ success: true, records });
  } catch (error) {
    console.error('Error reading let-go tasks:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/let-go
 * Lets a task go: it is no longer worth doing. The task and its subtasks leave General, Current and
 * Today, and are kept in tasks/let-go.json (restorable via /api/tasks/let-go/restore). Not a completion.
 *
 * Body: { taskId: string, listType?: 'have-to-do' | 'want-to-do', reason: string }
 * A reason is required: letting a task go always records why.
 */
export async function POST(request: NextRequest) {
  try {
    const { taskId, listType = 'have-to-do', reason } = await request.json();
    if (listType !== 'have-to-do' && listType !== 'want-to-do') {
      return NextResponse.json({ success: false, error: 'Invalid listType. Must be "have-to-do" or "want-to-do"' }, { status: 400 });
    }
    if (!taskId || typeof taskId !== 'string' || !taskId.trim()) {
      return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 });
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      return NextResponse.json({ success: false, error: 'Say why you are letting it go' }, { status: 400 });
    }

    ensureCurrentSystemThroughToday();
    const data = readGeneralTasks(listType as ListType);
    const result = takeOut(data.tasks, taskId, listType as ListType, readCurrentTaskIds(listType as ListType), new Date(), reason);
    if ('error' in result) {
      const [status, error] = ERRORS[result.error];
      return NextResponse.json({ success: false, error }, { status });
    }

    // Save the record before touching the lists, so a failure part-way never loses the task.
    const store = readLetGo();
    store.records = [...store.records.filter((r) => r.id !== taskId), result.record];
    writeLetGo(store);

    data.tasks = result.tasks;
    writeGeneralTasks(data, listType as ListType);
    // Clear auto-planned journal slots from due times, as deleting does.
    for (const task of [result.record.task, ...result.record.subtasks]) {
      if (task.dueDate) handleDueDateSetup(task.dueDate, listType as ListType, { id: task.id, text: task.text }, task);
    }
    removeTaskIdsFromTodayOverrides(result.removedIds, listType as ListType);
    removeTaskIdsFromCurrent(listType as ListType, result.removedIds);
    refreshActiveDailySnapshots();

    return NextResponse.json({ success: true, record: result.record, removedTaskIds: result.removedIds });
  } catch (error) {
    console.error('Error letting task go:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
