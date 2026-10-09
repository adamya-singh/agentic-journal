import { buildHorizon, type HorizonData } from '@/lib/horizon';
import { getCurrentTasks } from '../current/current-store-utils';
import { readCompletedTaskIndex, readGeneralTasks } from '../today/today-store-utils';
import { letGoSince, readLetGo } from '../let-go/let-go-store';

/** The Horizon as the home page sees it. Shared by GET /api/tasks/horizon and the brief worker. */
export function loadHorizon(): HorizonData {
  const currentHaveToDoIds = getCurrentTasks('have-to-do').map((task) => task.id);
  const completed = Object.values(readCompletedTaskIndex().tasks).map((task) => ({
    id: task.id,
    text: task.text,
    completedAt: task.completedAt,
  }));
  return buildHorizon({
    haveToDo: readGeneralTasks('have-to-do').tasks,
    wantToDo: readGeneralTasks('want-to-do').tasks,
    currentHaveToDoIds,
    completed,
    letGoThisWeek: letGoSince(readLetGo(), new Date(Date.now() - 7 * 864e5)).length,
  });
}
