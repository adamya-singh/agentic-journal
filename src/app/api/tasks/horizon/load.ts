import { buildHorizon, type HorizonData } from '@/lib/horizon';
import { getCurrentTasks } from '../current/current-store-utils';
import { readCompletedTaskIndex, readCompletedTaskSnapshots, readGeneralTasks } from '../today/today-store-utils';
import { localDateIso } from '@/lib/done-at';
import { letGoSince, readLetGo } from '../let-go/let-go-store';

/** The Horizon as the home page sees it. Shared by GET /api/tasks/horizon and the brief worker. */
export function loadHorizon(): HorizonData {
  const currentHaveToDoIds = getCurrentTasks('have-to-do').map((task) => task.id);
  const completed = Object.values(readCompletedTaskIndex().tasks).map((task) => ({
    id: task.id,
    text: task.text,
    completedAt: task.completedAt,
  }));
  // Daily completions live in each day's list files, under the same local date the completion route writes.
  const now = new Date();
  const dailyDoneByDay = Array.from({ length: 7 }, (_, i) => {
    const date = localDateIso(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6 + i));
    return (['have-to-do', 'want-to-do'] as const)
      .flatMap((listType) => readCompletedTaskSnapshots(date, listType))
      .filter((snapshot) => snapshot.isDaily)
      .map((snapshot) => snapshot.id);
  });
  return buildHorizon({
    haveToDo: readGeneralTasks('have-to-do').tasks,
    wantToDo: readGeneralTasks('want-to-do').tasks,
    currentHaveToDoIds,
    completed,
    letGoThisWeek: letGoSince(readLetGo(), new Date(now.getTime() - 7 * 864e5)).length,
    dailyDoneByDay,
    now,
  });
}
