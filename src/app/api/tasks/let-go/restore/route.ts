import { NextRequest, NextResponse } from 'next/server';
import { handleDueDateSetup } from '../../due-date-utils';
import { readGeneralTasks, writeGeneralTasks } from '../../today/today-store-utils';
import {
  addTaskToCurrent,
  ensureCurrentSystemThroughToday,
  readCurrentTaskIds,
  refreshActiveDailySnapshots,
} from '../../current/current-store-utils';
import { putBack, readLetGo, writeLetGo } from '../let-go-store';

/**
 * POST /api/tasks/let-go/restore
 * Brings a let-go task (and its subtasks) back to its General list, and back to its old rank in
 * Current if it was queued there.
 *
 * Body: { taskId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { taskId } = await request.json();
    if (!taskId || typeof taskId !== 'string') {
      return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 });
    }
    ensureCurrentSystemThroughToday();
    const store = readLetGo();
    const record = store.records.find((r) => r.id === taskId);
    if (!record) {
      return NextResponse.json({ success: false, error: 'No let-go task with that id' }, { status: 404 });
    }

    const data = readGeneralTasks(record.listType);
    data.tasks = putBack(data.tasks, record);
    writeGeneralTasks(data, record.listType);
    for (const task of [record.task, ...record.subtasks]) {
      if (task.dueDate) handleDueDateSetup(task.dueDate, record.listType, task);
    }
    if (record.currentRank !== null && !readCurrentTaskIds(record.listType).includes(record.id)) {
      addTaskToCurrent(record.listType, record.id, record.currentRank);
    }
    refreshActiveDailySnapshots();

    store.records = store.records.filter((r) => r.id !== taskId);
    writeLetGo(store);
    return NextResponse.json({ success: true, restored: record.task, listType: record.listType });
  } catch (error) {
    console.error('Error restoring let-go task:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
