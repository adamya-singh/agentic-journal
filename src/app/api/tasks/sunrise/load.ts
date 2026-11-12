import type { HorizonData } from '@/lib/horizon';
import { localDateIso } from '@/lib/done-at';
import { formSpecFor, type FormSpec } from '@/lib/sunrise/form-spec';
import { demoHook } from '@/lib/sunrise/demo-hooks';
import { loadHorizon } from '../horizon/load';
import { loadTaskBriefs } from '../brief/build';
import { readCurrentTaskIds } from '../current/current-store-utils';
import { computeTodayTasksByList } from '../today/staged-sync-utils';
import { readHookWorkRecords } from '../hook-work/store';

export interface SunriseData {
  horizon: HorizonData;
  forms: Record<string, FormSpec>;                        // by task id: every task on the rings, the ground and further out
  today: { id: string; completed: boolean }[];            // Today's list, both lists
  current: Record<string, number>;                        // rank in the Current queues, 0 first
  started: Record<string, string>;                        // tasks he has opened in Sunrise, and when
}

const demoHooks = () => process.env.SUNRISE_DEMO_HOOKS === '1' && process.env.NODE_ENV !== 'production';

/** Everything the Sunrise hero draws, in one read. */
export function loadSunrise(now = new Date()): SunriseData {
  const horizon = loadHorizon();
  const ids = [...new Set([...horizon.holds, ...horizon.items, ...horizon.further, ...horizon.undated].map((item) => item.id))];
  const forms: Record<string, FormSpec> = {};
  for (const [taskId, brief] of loadTaskBriefs(ids, now)) {
    forms[taskId] = formSpecFor(demoHooks() && !brief.hook ? { ...brief, hook: demoHook(brief) } : brief);
  }

  const todayByList = computeTodayTasksByList(localDateIso(now));
  const today = [...todayByList['have-to-do'], ...todayByList['want-to-do']]
    .filter((task) => !task.isDaily)
    .map((task) => ({ id: task.id, completed: task.completed === true }));
  const current: Record<string, number> = {};
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    readCurrentTaskIds(listType).forEach((id, rank) => { current[id] = Math.min(current[id] ?? rank, rank); });
  }
  const started: Record<string, string> = {};
  for (const record of Object.values(readHookWorkRecords())) started[record.taskId] = record.startedAt;
  return { horizon, forms, today, current, started };
}
