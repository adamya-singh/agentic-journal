// What the task-worker routes do: claim, the run's updates, Adamya's switch and answers, the views, the progress
// hook and the periodic reconcile. The rules themselves live in src/lib/task-work.ts; this file reads the tasks
// and the other stores they need and writes through mutateTaskWork.
import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { ListType, Task } from '@/lib/types';
import { taskFingerprint } from '@/lib/brief-agent';
import { isManualBrowserSessionActive } from '@/lib/openclaw-browser';
import { readShortTermCompass } from '@/lib/compass/read';
import { PROGRESS_LINE_MAX } from '@/lib/task-progress';
import {
  addItem,
  approvedItem,
  askAfterSilence,
  askWhetherSent,
  createTaskWork,
  leaseLive,
  nextWaiting,
  pendingItems,
  pickNextTaskWork,
  recordTaskWorkFailure,
  recoverExpiredLease,
  replyCheckAfter,
  requireTaskWorkLease,
  setTaskWorkStatus,
  taskWorkSummary,
  localDay,
  TaskWorkError,
  TASK_WORK_LEASE_MS,
  TASK_WORK_REST_MS,
  TASK_WORK_RULES,
  type NeedsYouItem,
  type TaskWork,
  type TaskWorkReason,
  type TaskWorkRef,
  type TaskWorkStatus,
} from '@/lib/task-work';
import { loadTaskBrief, openTaskRefs } from '../brief/build';
import { readCurrentTaskIds } from '../current/current-store-utils';
import { jobBrowserBusy } from '../../jobs/application-store-utils';
import { recordTaskProgress } from '../progress/record';
import { mutateTaskWork, readTaskWorkFile, type TaskWorkFile } from './store';

const RELEASE_RETRY_MS = 30 * 60_000;

export const taskWorkDisabled = () => process.env.TASK_WORKER_DISABLED === '1';
const sweepDisabled = () => process.env.TASK_WORKER_SWEEP_DISABLED === '1';

interface OpenTask { task: Task; listType: ListType }

/** Open tasks as the claim order sees them, plus a lookup by id. */
function openTasks(): { refs: TaskWorkRef[]; byId: Map<string, OpenTask> } {
  const list = openTaskRefs();
  const current = new Map<string, number>();
  for (const listType of ['have-to-do', 'want-to-do'] as const) {
    for (const id of readCurrentTaskIds(listType)) if (!current.has(id)) current.set(id, current.size);
  }
  const index = { 'have-to-do': 0, 'want-to-do': 0 };
  const refs = list.map(({ task, listType }) => ({
    taskId: task.id, listType, listIndex: index[listType]++, currentRank: current.get(task.id) ?? null,
    dueDate: task.dueDate, isDaily: task.isDaily, parentTaskId: task.parentTaskId, fingerprint: taskFingerprint(task),
  }));
  return { refs, byId: new Map(list.map((r) => [r.task.id, r])) };
}

/** Expired leases recovered and three-week silences turned into questions. True when anything changed. */
function settle(records: Record<string, TaskWork>, now: Date): boolean {
  let changed = false;
  for (const record of Object.values(records)) {
    if (recoverExpiredLease(record, now)) changed = true;
    if (askAfterSilence(record, now)) changed = true;
  }
  return changed;
}

function effectiveMeta(data: TaskWorkFile): TaskWorkFile['meta'] {
  return { ...data.meta, sweepEnabled: data.meta.sweepEnabled && !sweepDisabled() };
}

/** OpenClaw's browser is in use by Adamya or by a job-application run. */
function browserTaken(now: Date): boolean {
  return isManualBrowserSessionActive(now.getTime()) || jobBrowserBusy(now.getTime());
}

/** Whether a claim now would return a task. For the next stage's cron wake; changes nothing. */
export function taskWorkClaimable(now = new Date()): boolean {
  if (taskWorkDisabled() || browserTaken(now)) return false;
  const data = readTaskWorkFile();
  const records = structuredClone(data.records);
  settle(records, now);
  return pickNextTaskWork(records, openTasks().refs, now, effectiveMeta(data)) !== null;
}

// ───────────── claim ─────────────

const TASK_MARK = (taskId: string) => `[aj:task:${taskId}]`;

const API_HELP = {
  update: 'POST /api/tasks/work/update { taskId, token, action, ... }; every action needs the lease token',
  actions: [
    'attempted { what, itemId }: before an outward act; itemId must be an approval item Adamya approved',
    'progress { did, next?, waitingOn?, itemId? }: records what was done in the task notes; itemId marks that approved act done',
    'waiting { on, checkAfter? }: closes; waits on someone outside, the Journal schedules the reply checks',
    'rest { why, lookAgainAfter? }: closes; nothing to do now (looks again in 30 days unless said)',
    'continue { why? }: closes; another step is worth taking soon',
    'ask { questions }: closes; questions for Adamya',
    'propose { approvals: [{ text, detail: { to?, subject?, body?, channel? } }] }: closes; outward acts for Adamya to approve',
    'looks-done { text }: closes; the task seems finished (never complete it yourself)',
    'retry { why }: closes; this run failed, try again later',
    'release { why? }: closes without an outcome',
  ],
  note: 'Closing actions are refused while an `attempted` act has no `progress` yet, except retry and release, which then ask Adamya whether it went out.',
};

function taskView(open: OpenTask, byId: Map<string, OpenTask>) {
  const { task } = open;
  const parent = task.parentTaskId ? byId.get(task.parentTaskId)?.task : undefined;
  return {
    id: task.id, text: task.text, notesMarkdown: task.notesMarkdown ?? '',
    dueDate: task.dueDate ?? null, dueTimeStart: task.dueTimeStart ?? null, dueTimeEnd: task.dueTimeEnd ?? null,
    projects: task.projects ?? [],
    parent: parent ? { id: parent.id, text: parent.text, notesMarkdown: parent.notesMarkdown ?? '' }
      : task.parentTaskId ? { id: task.parentTaskId, text: task.parentTaskText ?? '', notesMarkdown: '' } : null,
    subtasks: (task.childTasks ?? []).map((c) => ({ id: c.id, text: c.text, completed: !!c.completed, dueDate: c.dueDate ?? null })),
  };
}

function compassForAgents(): string {
  try {
    return readShortTermCompass().forAgents;
  } catch {
    return '';
  }
}

export function claimTaskWork(now = new Date()) {
  if (taskWorkDisabled() || browserTaken(now)) return null;
  const { refs, byId } = openTasks();
  const claimed = mutateTaskWork((data) => {
    settle(data.records, now);
    const pick = pickNextTaskWork(data.records, refs, now, effectiveMeta(data));
    if (!pick) return null;
    const ref = refs.find((r) => r.taskId === pick.taskId)!;
    let record = data.records[pick.taskId];
    if (!record) {
      // Nobody handed it over, so the sweep may only look and prepare.
      record = data.records[pick.taskId] = createTaskWork('queued', { reason: 'sweep', grant: 'prepare', why: 'the sweep picked it', now });
    } else if (record.status === 'resting') {
      record.reason = 'sweep';
      setTaskWorkStatus(record, 'queued', record.fingerprint !== ref.fingerprint ? 'the task changed' : 'time to look again', now);
    } else if (record.status === 'waiting') {
      record.reason = 'reply-check';
      record.waiting!.checks += 1;
      setTaskWorkStatus(record, 'queued', `time to look for a reply from ${record.waiting!.on}`, now);
    }
    setTaskWorkStatus(record, 'working', `claimed (${pick.reason})`, now);
    record.lease = { token: randomUUID(), claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TASK_WORK_LEASE_MS).toISOString() };
    delete record.nextRetryAt;
    if (pick.sweep) {
      const today = localDay(now);
      data.meta.sweepClaims = { date: today, count: (data.meta.sweepClaims.date === today ? data.meta.sweepClaims.count : 0) + 1 };
    }
    return { taskId: pick.taskId, reason: pick.reason, record: structuredClone(record) };
  });
  if (!claimed) return null;

  const open = byId.get(claimed.taskId)!;
  let brief = null;
  try {
    brief = loadTaskBrief(claimed.taskId, now);
  } catch (error) {
    console.error('Task work claim: brief failed:', error);
  }
  const r = claimed.record;
  return {
    taskId: claimed.taskId,
    listType: open.listType,
    lease: { token: r.lease!.token, expiresAt: r.lease!.expiresAt },
    reason: claimed.reason,
    grant: r.grant,
    task: taskView(open, byId),
    brief,
    items: r.items,
    waiting: r.waiting ?? null,
    failures: r.failures,
    lastError: r.lastError ?? null,
    rules: TASK_WORK_RULES,
    compassForAgents: compassForAgents(),
    mark: TASK_MARK(claimed.taskId),
    api: API_HELP,
  };
}

// ───────────── the run's updates ─────────────

const line = z.string().trim().min(1).max(PROGRESS_LINE_MAX);
const iso = z.string().datetime({ offset: true });
const detail = z.object({
  to: z.string().max(400).optional(), subject: z.string().max(400).optional(),
  body: z.string().max(20000).optional(), channel: z.string().max(100).optional(),
}).strict();
const base = { taskId: z.string().min(1).max(200), token: z.string().min(1) };

export const UpdateSchema = z.discriminatedUnion('action', [
  z.object({ ...base, action: z.literal('attempted'), what: line, itemId: z.string().min(1).optional() }),
  z.object({
    ...base, action: z.literal('progress'), did: line,
    next: z.string().trim().max(PROGRESS_LINE_MAX).optional(), waitingOn: z.string().trim().max(PROGRESS_LINE_MAX).optional(),
    itemId: z.string().min(1).optional(),
  }),
  z.object({ ...base, action: z.literal('waiting'), on: line, checkAfter: iso.optional() }),
  z.object({ ...base, action: z.literal('rest'), why: line, lookAgainAfter: iso.optional() }),
  z.object({ ...base, action: z.literal('continue'), why: line.optional() }),
  z.object({ ...base, action: z.literal('ask'), questions: z.array(line).min(1).max(6) }),
  z.object({ ...base, action: z.literal('propose'), approvals: z.array(z.object({ text: line, detail })).min(1).max(6) }),
  z.object({ ...base, action: z.literal('looks-done'), text: line }),
  z.object({ ...base, action: z.literal('retry'), why: line }),
  z.object({ ...base, action: z.literal('release'), why: line.optional() }),
]);
export type TaskWorkUpdate = z.infer<typeof UpdateSchema>;

/** The run is done with the lease: what it looked at is remembered so an unchanged task is not swept again. */
function close(record: TaskWork, now: Date, task: Task | undefined, outcome: boolean): void {
  delete record.lease;
  record.lookedAt = now.toISOString();
  if (task) record.fingerprint = taskFingerprint(task);
  if (outcome) {
    record.failures = 0;
    delete record.lastError;
  }
}

export function updateTaskWork(body: TaskWorkUpdate, now = new Date()) {
  const task = openTaskRefs().find((r) => r.task.id === body.taskId)?.task;
  return mutateTaskWork((data) => {
    const record = requireTaskWorkLease(data.records[body.taskId], body.token, now);
    const closing = body.action !== 'attempted' && body.action !== 'progress';
    if (closing && record.attempted && body.action !== 'retry' && body.action !== 'release') {
      throw new TaskWorkError('An outward act was attempted and not reported: post progress first (or retry / release)');
    }
    record.updatedAt = now.toISOString();

    switch (body.action) {
      case 'attempted': {
        if (record.attempted) throw new TaskWorkError('Another outward act is still unreported: post its progress first');
        const item = approvedItem(record, body.itemId);
        record.attempted = { what: body.what, at: now.toISOString(), itemId: item.id };
        break;
      }
      case 'progress': {
        const ids = [...new Set([body.itemId, record.attempted?.itemId].filter((id): id is string => !!id))];
        const items = ids.map((id) => record.items.find((i) => i.id === id));
        if (body.itemId && (!items[0] || items[0].kind !== 'approval' || items[0].status !== 'approved')) {
          throw new TaskWorkError('itemId must name an approval item Adamya approved');
        }
        const written = recordTaskProgress(body.taskId, { did: body.did, next: body.next, waitingOn: body.waitingOn });
        if (!written) throw new TaskWorkError(`No open task has the id ${body.taskId}`, 404);
        let sent = false;
        for (const item of items) {
          if (item && !item.consumedAt) { item.consumedAt = now.toISOString(); sent = true; }
        }
        // Something just went out: any wait starts over from now.
        if (sent || record.attempted) delete record.waiting;
        delete record.attempted;
        return { record: structuredClone(record), notesMarkdown: written.notesMarkdown };
      }
      case 'waiting':
        record.waiting = nextWaiting(record, body.on, now, body.checkAfter);
        close(record, now, task, true);
        setTaskWorkStatus(record, 'waiting', `waiting on ${body.on}`, now, 'worker');
        break;
      case 'rest':
        delete record.waiting;
        record.lookAgainAfter = body.lookAgainAfter ?? new Date(now.getTime() + TASK_WORK_REST_MS).toISOString();
        close(record, now, task, true);
        setTaskWorkStatus(record, 'resting', body.why, now, 'worker');
        break;
      case 'continue':
        // Back in line behind what Adamya handed over, ready at once.
        record.reason = 'retry';
        record.nextRetryAt = now.toISOString();
        close(record, now, task, true);
        setTaskWorkStatus(record, 'queued', body.why ?? 'another step to take', now, 'worker');
        break;
      case 'ask':
        body.questions.forEach((q) => addItem(record, 'question', q, now));
        close(record, now, task, true);
        setTaskWorkStatus(record, 'needs-you', `asked ${body.questions.length}`, now, 'worker');
        break;
      case 'propose':
        body.approvals.forEach((a) => addItem(record, 'approval', a.text, now, a.detail));
        close(record, now, task, true);
        setTaskWorkStatus(record, 'needs-you', `proposed ${body.approvals.length} to approve`, now, 'worker');
        break;
      case 'looks-done':
        addItem(record, 'done', /^looks done/i.test(body.text) ? body.text : `Looks done: ${body.text}`, now);
        close(record, now, task, true);
        setTaskWorkStatus(record, 'needs-you', 'looks done', now, 'worker');
        break;
      case 'retry':
        close(record, now, task, false);
        if (record.attempted) askWhetherSent(record, now);
        else recordTaskWorkFailure(record, body.why, now, 'worker');
        break;
      case 'release':
        close(record, now, task, false);
        if (record.attempted) askWhetherSent(record, now);
        else {
          // No outcome and no failure: back in line, not straight back into the next claim.
          record.reason = 'retry';
          record.nextRetryAt = new Date(now.getTime() + RELEASE_RETRY_MS).toISOString();
          setTaskWorkStatus(record, 'queued', body.why ?? 'released', now, 'worker');
        }
        break;
    }
    return { record: structuredClone(record) };
  });
}

// ───────────── Adamya's switch and answers ─────────────

export function handTaskWork(taskId: string, on: boolean, now = new Date()) {
  const task = openTaskRefs().find((r) => r.task.id === taskId)?.task;
  if (!task) throw new TaskWorkError(`No open task has the id ${taskId}`, 404);
  return mutateTaskWork((data) => {
    let record = data.records[taskId];
    if (!on) {
      if (!record) record = data.records[taskId] = createTaskWork('off', { reason: 'handed', grant: 'prepare', why: 'Adamya: hands off', now, by: 'adamya' });
      else if (record.status !== 'off') {
        // A run that had started an outward act still gets asked about; it just will not continue.
        if (record.attempted) askWhetherSent(record, now, { keepStatus: true });
        delete record.lease;
        delete record.nextRetryAt;
        setTaskWorkStatus(record, 'off', 'Adamya: hands off', now, 'adamya');
      }
      return structuredClone(record);
    }
    const at = now.toISOString();
    if (!record) {
      record = data.records[taskId] = createTaskWork('queued', { reason: 'handed', grant: 'act-with-approval', why: 'Adamya handed it over', now, by: 'adamya' });
    } else {
      record.grant = 'act-with-approval';
      record.failures = 0;
      delete record.lastError;
      // A run in progress keeps going, and open items still wait for his answers.
      if (record.status === 'off' || record.status === 'resting' || record.status === 'waiting' || record.status === 'queued') {
        record.reason = 'handed';
        delete record.nextRetryAt;
        if (record.status !== 'queued') setTaskWorkStatus(record, 'queued', 'Adamya handed it over', now, 'adamya');
      }
    }
    record.handedAt = at;
    record.updatedAt = at;
    return structuredClone(record);
  });
}

export const AnswerSchema = z.object({
  taskId: z.string().min(1).max(200),
  itemId: z.string().min(1),
  decision: z.enum(['approve', 'decline', 'answer']),
  answer: z.string().trim().max(4000).optional(),
  editedDetail: detail.optional(),
});
export type TaskWorkAnswer = z.infer<typeof AnswerSchema>;

const DECIDED: Record<TaskWorkAnswer['decision'], NeedsYouItem['status']> = { approve: 'approved', decline: 'declined', answer: 'answered' };

export function answerTaskWork(body: TaskWorkAnswer, now = new Date()) {
  return mutateTaskWork((data) => {
    const record = data.records[body.taskId];
    const item = record?.items.find((i) => i.id === body.itemId);
    if (!record || !item) throw new TaskWorkError('No such item on that task', 404);
    if (item.status !== 'pending') throw new TaskWorkError('That item was already answered');
    if (body.decision === 'answer' && !body.answer) throw new TaskWorkError('An answer needs its text', 400);
    if (body.editedDetail && (item.kind !== 'approval' || body.decision !== 'approve')) {
      throw new TaskWorkError('Only an approval being approved can carry edited text', 400);
    }
    const at = now.toISOString();
    Object.assign(item, {
      status: DECIDED[body.decision], answeredAt: at,
      ...(body.answer ? { answer: body.answer } : {}), ...(body.editedDetail ? { editedDetail: body.editedDetail } : {}),
    });
    record.updatedAt = at;
    // His yes to "Looks done" goes through the existing complete flow (the UI stage); here it is only recorded.
    const completeRequested = item.kind === 'done' && body.decision === 'approve';

    if (pendingItems(record).length === 0 && (['needs-you', 'waiting', 'resting'] as TaskWorkStatus[]).includes(record.status)) {
      // The round: items raised since the task last went to needs-you.
      const since = [...record.history].reverse().find((h) => h.to === 'needs-you')?.at ?? '';
      const round = record.items.filter((i) => i.createdAt >= since);
      // A confirmed "looks done" leaves nothing for the worker: the task is about to be completed.
      const actionable = round.some((i) => i.status === 'answered' || (i.status === 'approved' && i.kind !== 'done'));
      if (actionable) {
        record.reason = 'answered';
        setTaskWorkStatus(record, 'queued', 'Adamya answered', now, 'adamya');
      } else if (record.status === 'needs-you') {
        record.lookAgainAfter = new Date(now.getTime() + TASK_WORK_REST_MS).toISOString();
        setTaskWorkStatus(record, 'resting', completeRequested ? 'Adamya confirmed it is done' : 'Adamya declined everything', now, 'adamya');
      }
    }
    return { record: structuredClone(record), item: structuredClone(item), completeRequested };
  });
}

// ───────────── views ─────────────

export function taskWorkView(taskId: string, now = new Date()) {
  const record = readTaskWorkFile().records[taskId] ?? null;
  return { taskId, record, summary: taskWorkSummary(record ?? undefined, now) };
}

export function taskWorkOverview(now = new Date()) {
  const { records } = readTaskWorkFile();
  const byId = new Map(openTaskRefs().map((r) => [r.task.id, r]));
  const counts: Record<TaskWorkStatus, number> & { pendingItems: number } = {
    queued: 0, working: 0, waiting: 0, 'needs-you': 0, resting: 0, off: 0, pendingItems: 0,
  };
  const needsYou: { taskId: string; taskText: string; listType: ListType; items: NeedsYouItem[] }[] = [];
  let working: { taskId: string; taskText: string; reason: TaskWorkReason; claimedAt: string; expiresAt: string } | null = null;
  for (const [taskId, record] of Object.entries(records)) {
    const open = byId.get(taskId);
    if (!open) continue;
    counts[record.status] += 1;
    const items = pendingItems(record);
    counts.pendingItems += items.length;
    if (items.length) needsYou.push({ taskId, taskText: open.task.text, listType: open.listType, items });
    if (leaseLive(record, now)) {
      working = { taskId, taskText: open.task.text, reason: record.reason, claimedAt: record.lease!.claimedAt, expiresAt: record.lease!.expiresAt };
    }
  }
  needsYou.sort((a, b) => a.items[0].createdAt.localeCompare(b.items[0].createdAt));
  return { needsYou, working, counts };
}

// ───────────── chats, and the five-minute reconcile ─────────────

/**
 * A chat recorded progress with "Waiting on": the task is watched for the reply like the worker's own sends. An
 * empty waitingOn stops the wait. Left alone while a run is working on it (the run reports through its update)
 * and when Adamya said hands off.
 */
export function noteChatProgress(taskId: string, waitingOn: string | undefined, now = new Date()): void {
  if (waitingOn === undefined) return;
  const task = openTaskRefs().find((r) => r.task.id === taskId)?.task;
  if (!task) return;
  const on = waitingOn.trim();
  const at = now.toISOString();
  const existing = readTaskWorkFile().records[taskId];
  if (existing?.status === 'off' || existing?.status === 'working' || (!on && existing?.status !== 'waiting')) return;
  mutateTaskWork((data) => {
    let record = data.records[taskId];
    if (record?.status === 'off' || record?.status === 'working') return;
    if (!on) {
      if (record?.status !== 'waiting') return;
      delete record.waiting;
      record.lookAgainAfter = new Date(now.getTime() + TASK_WORK_REST_MS).toISOString();
      record.fingerprint = taskFingerprint(task);
      setTaskWorkStatus(record, 'resting', 'a chat said it no longer waits', now);
      return;
    }
    if (!record) {
      record = data.records[taskId] = createTaskWork('waiting', { reason: 'handed', grant: 'act-with-approval', why: `a chat said it waits on ${on}`, now });
      record.handedAt = at;
    } else if (record.status !== 'waiting') {
      setTaskWorkStatus(record, 'waiting', `a chat said it waits on ${on}`, now);
    }
    // A chat records this right after sending: the clock starts now.
    record.waiting = { on, since: at, checks: 0, checkAfter: replyCheckAfter(at, 0) };
    record.fingerprint = taskFingerprint(task);
    record.updatedAt = at;
  });
}

/** Recovers runs whose lease ran out, asks after long silences, and forgets tasks that are no longer open. */
export function reconcileTaskWork(now = new Date()): { changed: boolean; pruned: string[] } {
  const open = new Set(openTaskRefs().map((r) => r.task.id));
  // A record with a live lease stays until its run reports, so the browser stays marked as taken.
  const gone = (records: Record<string, TaskWork>) => Object.keys(records).filter((id) => !open.has(id) && !leaseLive(records[id], now));
  const probe = structuredClone(readTaskWorkFile().records);
  if (!settle(probe, now) && gone(probe).length === 0) return { changed: false, pruned: [] };
  return mutateTaskWork((data) => {
    settle(data.records, now);
    const pruned = gone(data.records);
    for (const id of pruned) delete data.records[id];
    return { changed: true, pruned };
  });
}
