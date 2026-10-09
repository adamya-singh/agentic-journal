// The background worker that asks OpenClaw to fill in Horizon briefs. One fill at a time (OpenClaw's
// browser is shared), holds first, then tasks due in the next two weeks, then undated ones. A task is
// filled again when it changes, after a few days, or when Adamya presses Refresh.
import {
  buildBriefAgentPrompt,
  needsFill,
  taskFingerprint,
  validateAgentReply,
  RUNNING_TIMEOUT_MS,
} from '@/lib/brief-agent';
import { extractJsonObject, localDateIso } from '@/lib/done-at';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import { readJobApplicationsStore } from '../../jobs/application-store-utils';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import { loadHorizon } from '../horizon/load';
import { loadRuleBrief, openTaskRefs } from '../brief/build';
import { mutateAgentRecords, type StoredAgentRecord } from './store';

const HORIZON_DAYS = 14;
const SCHEDULE_THROTTLE_MS = 5 * 60_000;
const BROWSER_BUSY_RETRY_MS = 3 * 60_000;

const STATE = Symbol.for('agentic-journal.brief-agent-worker');
type WorkerState = { running: boolean; lastScheduleAt: number; wake: ReturnType<typeof setTimeout> | null };
function state(): WorkerState {
  const g = globalThis as { [STATE]?: WorkerState };
  g[STATE] ??= { running: false, lastScheduleAt: 0, wake: null };
  return g[STATE];
}

export function briefAgentDisabled(): boolean {
  return process.env.BRIEF_AGENT_DISABLED === '1';
}

/** Task ids worth filling, in the order to fill them. */
export function candidateTaskIds(): string[] {
  const data = loadHorizon();
  const soon = data.items.filter((i) => i.hours <= HORIZON_DAYS * 24).sort((a, b) => a.hours - b.hours);
  return [...new Set([...data.holds.map((h) => h.id), ...soon.map((i) => i.id), ...data.undated.map((u) => u.id)])];
}

/**
 * Queues every candidate that needs a (new) fill, forgets tasks that are no longer open, and starts the
 * worker. Cheap enough to call on every Horizon load; throttled unless `force` names a task to refresh.
 */
export function scheduleBriefFills(opts: { force?: string } = {}): void {
  if (briefAgentDisabled()) return;
  const s = state();
  const now = new Date();
  if (!opts.force && now.getTime() - s.lastScheduleAt < SCHEDULE_THROTTLE_MS) return;
  s.lastScheduleAt = now.getTime();

  try {
    const open = new Map(openTaskRefs().map((r) => [r.task.id, r.task]));
    const ids = candidateTaskIds();
    mutateAgentRecords((records) => {
      for (const id of Object.keys(records)) if (!open.has(id)) delete records[id];
      ids.forEach((id, rank) => {
        const task = open.get(id);
        if (!task) return;
        const fingerprint = taskFingerprint(task);
        const record = records[id];
        const forced = opts.force === id;
        if (!forced && !needsFill(record, fingerprint, now)) {
          if (record) record.rank = rank;
          return;
        }
        if (forced && record?.status === 'running') return;
        records[id] = {
          taskId: id,
          fingerprint,
          status: 'queued',
          queuedAt: now.toISOString(),
          startedAt: null,
          finishedAt: record?.finishedAt ?? null,
          error: null,
          failures: record && record.fingerprint === fingerprint && !forced ? record.failures : 0,
          layer: record?.layer ?? null,
          doneActions: record?.doneActions ?? [],
          rank: forced ? -1 : rank,
        };
      });
    });
  } catch (error) {
    console.error('Brief fill scheduling failed:', error);
    return;
  }
  void runWorker();
}

function nextQueued(records: Record<string, StoredAgentRecord>, now: Date): StoredAgentRecord | null {
  // A fill that was running when the server restarted never finishes; let it run again.
  for (const r of Object.values(records)) {
    if (r.status === 'running' && now.getTime() - Date.parse(r.startedAt ?? r.queuedAt) > RUNNING_TIMEOUT_MS) r.status = 'queued';
  }
  return Object.values(records).filter((r) => r.status === 'queued').sort((a, b) => a.rank - b.rank)[0] ?? null;
}

/**
 * The job-application worker drives the same browser. Its cron wakes every minute just to check its queue,
 * so "running" says little; a live lease on an application (or its Simplify sync) means the browser is in use.
 */
function browserBusy(now = Date.now()): boolean {
  try {
    const live = (lease?: { expiresAt: string } | null) => !!lease && Date.parse(lease.expiresAt) > now;
    return Object.values(readJobApplicationsStore().applications).some((a) => live(a.lease) || live(a.simplifySync?.lease));
  } catch {
    return false;
  }
}

async function runWorker(): Promise<void> {
  const s = state();
  if (s.running) return;
  if (!isOpenClawCliAvailable()) return;
  s.running = true;
  try {
    for (;;) {
      const now = new Date();
      const record = mutateAgentRecords((records) => nextQueued(records, now));
      if (!record) return;
      if (browserBusy()) {
        if (s.wake) clearTimeout(s.wake);
        s.wake = setTimeout(() => { s.wake = null; void runWorker(); }, BROWSER_BUSY_RETRY_MS);
        s.wake.unref?.();
        return;
      }
      await fillOne(record.taskId);
    }
  } finally {
    s.running = false;
  }
}

async function fillOne(taskId: string): Promise<void> {
  const now = new Date();
  const refs = openTaskRefs();
  const ref = refs.find((r) => r.task.id === taskId);
  const brief = ref ? loadRuleBrief(taskId, now, refs) : null;
  if (!ref || !brief) {
    mutateAgentRecords((records) => { delete records[taskId]; });
    return;
  }
  mutateAgentRecords((records) => {
    const r = records[taskId];
    if (r) Object.assign(r, { status: 'running', startedAt: now.toISOString(), error: null });
  });

  const others = refs
    .filter((r) => r.task.id !== taskId)
    .map((r) => ({ id: r.task.id, text: r.task.text, due: r.task.dueDate ?? null }));
  const message = buildBriefAgentPrompt({ brief, task: ref.task, otherTasks: others, now });

  let outcome: { layer: NonNullable<StoredAgentRecord['layer']> } | { error: string };
  try {
    const reply = await runOpenClawAgentTurn({
      message,
      sessionKey: `agent:main:journal-brief-${taskId}-${now.getTime()}`,
      timeoutMs: 12 * 60_000,
    });
    const checked = validateAgentReply(extractJsonObject(reply), {
      taskId,
      openTaskIds: new Set(refs.map((r) => r.task.id)),
      today: localDateIso(new Date()),
    });
    if (checked.ok) outcome = { layer: checked.layer };
    else {
      console.warn(`brief fill ${taskId}: unusable reply (${checked.error}):`, reply.slice(0, 500));
      outcome = { error: 'OpenClaw’s answer couldn’t be read.' };
    }
  } catch (error) {
    console.error(`brief fill ${taskId}: OpenClaw turn failed:`, error);
    outcome = { error: 'OpenClaw couldn’t be reached.' };
  }

  const finishedAt = new Date().toISOString();
  mutateAgentRecords((records) => {
    const r = records[taskId];
    if (!r || r.status !== 'running') return;   // forgotten or re-queued meanwhile
    if ('layer' in outcome) {
      // Actions are numbered per fill; a new fill starts with none done.
      Object.assign(r, { status: 'done', finishedAt, error: null, failures: 0, layer: outcome.layer, doneActions: [] });
    } else {
      Object.assign(r, { status: 'failed', finishedAt, error: outcome.error, failures: r.failures + 1 });
    }
  });
}
