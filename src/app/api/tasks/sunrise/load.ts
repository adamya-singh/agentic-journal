import type { SunriseData } from '@/lib/sunrise/data';
import { localDateIso } from '@/lib/done-at';
import { shortenTask } from '@/lib/horizon';
import { formSpecFor, type FormSpec } from '@/lib/sunrise/form-spec';
import { loadHorizon } from '../horizon/load';
import { loadTaskBriefs } from '../brief/build';
import { readCurrentTaskIds } from '../current/current-store-utils';
import { computeTodayTasksByList } from '../today/staged-sync-utils';
import { readHookWorkRecords } from '../hook-work/store';
import { readAllChatThreads } from '../brief-chat/store';
import { chatsGlance } from '@/lib/task-chat';

export type { SunriseData };

/** Everything the Sunrise hero draws, in one read. */
export function loadSunrise(now = new Date()): SunriseData {
  const horizon = loadHorizon();
  const ids = [...new Set([...horizon.holds, ...horizon.items, ...horizon.further, ...horizon.undated].map((item) => item.id))];
  const forms: Record<string, FormSpec> = {};
  // A task's form also says how many chats it has, and whether OpenClaw is waiting on him in one.
  const chats = readAllChatThreads();
  for (const [taskId, brief] of loadTaskBriefs(ids, now)) {
    const glance = chatsGlance(chats[taskId]);
    forms[taskId] = { ...formSpecFor(brief), ...(glance.count > 0 ? { chats: glance } : {}) };
  }

  const todayByList = computeTodayTasksByList(localDateIso(now));
  const today = [...todayByList['have-to-do'], ...todayByList['want-to-do']]
    .filter((task) => !task.isDaily)
    .map((task) => ({ id: task.id, short: shortenTask(task.text).short, completed: task.completed === true }));
  const current: Record<string, number> = {};
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    readCurrentTaskIds(listType).forEach((id, rank) => { current[id] = Math.min(current[id] ?? rank, rank); });
  }
  const started: Record<string, string> = {};
  for (const record of Object.values(readHookWorkRecords())) started[record.taskId] = record.startedAt;
  return { horizon, forms, today, current, started };
}
