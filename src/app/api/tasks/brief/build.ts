import * as fs from 'fs';
import * as path from 'path';
import type { Task } from '@/lib/types';
import { journalDataDir } from '@/lib/backend-data';
import { buildTaskBrief, type BriefTaskRef, type JournalTaskEntry, type TaskBrief } from '@/lib/task-brief';
import { mergeAgentLayer } from '@/lib/brief-agent';
import { readCompletedTaskIndex, readGeneralTasks } from '../today/today-store-utils';
import { readJobListings } from '../../jobs/job-store-utils';
import { readJobApplicationsStore } from '../../jobs/application-store-utils';
import { readAgentRecord } from '../brief-agent/store';

const JOURNAL_WINDOW_DAYS = 45;

function flatten(tasks: Task[]): Task[] {
  const out: Task[] = [];
  const walk = (list: Task[]) => list.forEach((t) => { out.push(t); if (t.childTasks?.length) walk(t.childTasks); });
  walk(tasks);
  return out;
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Every planned or logged journal slot that points at the task, a few weeks either side of today.
function journalEntriesFor(taskId: string, now: Date): JournalTaskEntry[] {
  const dir = journalDataDir();
  if (!fs.existsSync(dir)) return [];
  const lo = ymd(new Date(now.getTime() - JOURNAL_WINDOW_DAYS * 864e5));
  const hi = ymd(new Date(now.getTime() + JOURNAL_WINDOW_DAYS * 864e5));
  const out: JournalTaskEntry[] = [];
  for (const file of fs.readdirSync(dir)) {
    const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
    if (!m || m[1] < lo || m[1] > hi) continue;
    let day: Record<string, unknown>;
    try { day = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8')); } catch { continue; }
    const push = (hour: string, e: Record<string, unknown>) => {
      if (e && e.taskId === taskId) {
        out.push({
          date: m[1], hour,
          entryMode: String(e.entryMode || 'logged'),
          planStatus: typeof e.planStatus === 'string' ? e.planStatus : undefined,
          autoPlanned: e.autoPlannedFromDueTime === true,
        });
      }
    };
    for (const [hour, e] of Object.entries(day)) {
      if (hour === 'ranges' && Array.isArray(e)) e.forEach((r) => push(`${r.start}–${r.end}`, r));
      else if (e && typeof e === 'object' && !Array.isArray(e)) push(hour, e as Record<string, unknown>);
    }
  }
  return out;
}

/** Every open (not completed, not daily) task on both lists, subtasks included. */
export function openTaskRefs(): BriefTaskRef[] {
  const pending = (t: Task) => !t.completed && !t.isDaily;
  return [
    ...flatten(readGeneralTasks('have-to-do').tasks).filter(pending).map((task) => ({ task, listType: 'have-to-do' as const })),
    ...flatten(readGeneralTasks('want-to-do').tasks).filter(pending).map((task) => ({ task, listType: 'want-to-do' as const })),
  ];
}

/**
 * The rule-built brief for one task, before OpenClaw's layer. Null when the task isn't open.
 */
export function loadRuleBrief(taskId: string, now = new Date(), tasks = openTaskRefs()): TaskBrief | null {
  const ref = tasks.find((r) => r.task.id === taskId);
  if (!ref) return null;

  // Online assessments link their application; the listing is keyed by the same id.
  let job = null;
  const appId = /\/jobs\?application=([0-9a-f-]{36})/.exec(ref.task.notesMarkdown || '')?.[1];
  if (appId) {
    const listing = readJobListings().listings.find((l) => l.id === appId) ?? null;
    const application = readJobApplicationsStore().applications[appId];
    job = { listing, submittedAt: application?.submittedAt ?? null };
  }

  const completed = Object.values(readCompletedTaskIndex().tasks).map((t) => ({ id: t.id, text: t.text, completedAt: t.completedAt }));
  return buildTaskBrief({ taskId, tasks, completed, journal: journalEntriesFor(taskId, now), job, now });
}

/** The brief as the Horizon shows it: the rules' brief with OpenClaw's layer merged in. */
export function loadTaskBrief(taskId: string, now = new Date()): TaskBrief | null {
  const tasks = openTaskRefs();
  const brief = loadRuleBrief(taskId, now, tasks);
  if (!brief) return null;
  return mergeAgentLayer(brief, readAgentRecord(taskId), { tasks: new Map(tasks.map((r) => [r.task.id, r])), now });
}
