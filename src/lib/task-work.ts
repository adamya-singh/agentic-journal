// What OpenClaw's task worker knows about each task, and the rules it runs by (docs/task-worker-design.md).
// The Journal decides which task is next and keeps one record per task in a sidecar; OpenClaw claims one task,
// takes one step, and closes the run with one update. Outward acts (an email, a form) happen only on items
// Adamya approved, with the text he approved, and a run that dies mid-act is asked about, never repeated.
// Pure: no filesystem, so the store, the routes and the tests share it.
import { randomUUID } from 'crypto';
import type { ListType } from '@/lib/types';

export type TaskWorkStatus = 'queued' | 'working' | 'waiting' | 'needs-you' | 'resting' | 'off';
export type TaskWorkReason = 'handed' | 'reply-check' | 'answered' | 'sweep' | 'retry';
export type TaskWorkGrant = 'prepare' | 'act-with-approval';
/** Who caused a change. Only Adamya turns a task off or back on. */
export type TaskWorkActor = 'adamya' | 'worker' | 'journal';

export interface NeedsYouDetail { to?: string; subject?: string; body?: string; channel?: string }

export interface NeedsYouItem {
  id: string;
  // question: anything to ask. approval: an outward act with its exact recipient and text.
  // done: "Looks done: …" (his yes completes the task). sent-check: "Did this go out?" after an interrupted act.
  kind: 'question' | 'approval' | 'done' | 'sent-check';
  text: string;
  detail?: NeedsYouDetail;
  createdAt: string;
  status: 'pending' | 'answered' | 'approved' | 'declined';
  answer?: string;
  editedDetail?: NeedsYouDetail;    // his edit of an approval; the act uses it instead of `detail`
  answeredAt?: string;
  consumedAt?: string;              // an approved act was tried: it is never tried again
}

export interface TaskWorkLease { token: string; claimedAt: string; expiresAt: string }

export interface TaskWorkHistoryEntry { at: string; from: TaskWorkStatus | 'none'; to: TaskWorkStatus; why: string }

export interface TaskWork {
  status: TaskWorkStatus;
  reason: TaskWorkReason;
  grant: TaskWorkGrant;
  lease?: TaskWorkLease;
  attempted?: { what: string; at: string; itemId?: string };   // set before an outward act, cleared after
  waiting?: { on: string; since: string; checkAfter: string; checks: number };
  items: NeedsYouItem[];
  failures: number;                 // runs in a row that ended without an outcome
  lastError?: string;
  nextRetryAt?: string;
  lookedAt?: string;
  lookAgainAfter?: string;
  fingerprint?: string;             // the brief agent's task fingerprint at the last look
  handedAt?: string;
  updatedAt: string;
  history: TaskWorkHistoryEntry[];
}

export interface TaskWorkMeta {
  sweepEnabled: boolean;
  sweepCap: number;
  sweepClaims: { date: string; count: number };    // sweep claims on that local day
  sweepFirstDay?: string;                          // the day the sweep was turned on: a smaller cap
  lastNotifiedAt?: string;
}

export const TASK_WORK_LEASE_MS = 30 * 60_000;
export const TASK_WORK_RETRY_DELAYS_MS = [30 * 60_000, 2 * 3600_000, 864e5] as const;
export const TASK_WORK_FAILURE_LIMIT = 3;
export const TASK_WORK_REST_MS = 30 * 864e5;
export const TASK_WORK_SILENCE_LIMIT_MS = 21 * 864e5;
export const SWEEP_CAP_DEFAULT = 8;
export const SWEEP_FIRST_DAY_CAP = 2;
export const SWEEP_DUE_DAYS = 14;
const QUIET_FROM_HOUR = 23;
const QUIET_UNTIL_HOUR = 8;
const HISTORY_LIMIT = 30;
const RESOLVED_ITEMS_KEPT = 20;
const DAY = 864e5;

/** Thrown for a request the record refuses; `status` is the HTTP status the routes answer with. */
export class TaskWorkError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export function emptyTaskWorkMeta(): TaskWorkMeta {
  return { sweepEnabled: false, sweepCap: SWEEP_CAP_DEFAULT, sweepClaims: { date: '', count: 0 } };
}

// ───────────── transitions ─────────────

// The design's table, plus four moves it left out: a chat's progress with waitingOn starts waiting from any
// idle state, a chat that clears waitingOn rests it, three weeks of silence asks Adamya, and every item
// declined rests the task.
const ALLOWED: Record<TaskWorkStatus | 'none', readonly TaskWorkStatus[]> = {
  none: ['queued', 'waiting', 'off'],
  queued: ['working', 'waiting', 'off'],
  working: ['waiting', 'needs-you', 'resting', 'queued', 'off'],
  waiting: ['queued', 'needs-you', 'resting', 'off'],
  'needs-you': ['queued', 'resting', 'waiting', 'off'],
  resting: ['queued', 'waiting', 'off'],
  off: ['queued'],
};

export function canTransition(from: TaskWorkStatus | 'none', to: TaskWorkStatus): boolean {
  return ALLOWED[from].includes(to);
}

function checkTransition(from: TaskWorkStatus | 'none', to: TaskWorkStatus, by: TaskWorkActor): void {
  if (!canTransition(from, to)) throw new TaskWorkError(`A task cannot go from ${from} to ${to}`);
  // Hands off is Adamya's word, and only he takes it back.
  if ((to === 'off' || from === 'off') && by !== 'adamya') throw new TaskWorkError('Only Adamya turns the task worker off or on for a task');
}

/** The one writer of `status`: refuses moves not in the table and keeps a short history. */
export function setTaskWorkStatus(record: TaskWork, to: TaskWorkStatus, why: string, now: Date, by: TaskWorkActor = 'journal'): TaskWork {
  checkTransition(record.status, to, by);
  const at = now.toISOString();
  record.history = [...record.history, { at, from: record.status, to, why }].slice(-HISTORY_LIMIT);
  record.status = to;
  record.updatedAt = at;
  return record;
}

/** A new record, entered from "no record" through the same table. */
export function createTaskWork(
  to: TaskWorkStatus,
  opts: { reason: TaskWorkReason; grant: TaskWorkGrant; why: string; now: Date; by?: TaskWorkActor }
): TaskWork {
  checkTransition('none', to, opts.by ?? 'journal');
  const at = opts.now.toISOString();
  return {
    status: to, reason: opts.reason, grant: opts.grant, items: [], failures: 0, updatedAt: at,
    history: [{ at, from: 'none', to, why: opts.why }],
  };
}

// ───────────── items ─────────────

export function pendingItems(record: TaskWork | undefined): NeedsYouItem[] {
  return record ? record.items.filter((i) => i.status === 'pending') : [];
}

export function addItem(record: TaskWork, kind: NeedsYouItem['kind'], text: string, now: Date, detail?: NeedsYouDetail): NeedsYouItem {
  const item: NeedsYouItem = { id: randomUUID(), kind, text, ...(detail ? { detail } : {}), createdAt: now.toISOString(), status: 'pending' };
  record.items.push(item);
  // Every pending item stays; of the settled ones only the latest are kept.
  const settled = record.items.filter((i) => i.status !== 'pending');
  const drop = new Set(settled.slice(0, Math.max(0, settled.length - RESOLVED_ITEMS_KEPT)).map((i) => i.id));
  if (drop.size) record.items = record.items.filter((i) => !drop.has(i.id));
  return item;
}

/** The approved, not yet tried approval item with this id, or a refusal. */
export function approvedItem(record: TaskWork, itemId: string | undefined): NeedsYouItem {
  const item = itemId ? record.items.find((i) => i.id === itemId) : undefined;
  if (!item || item.kind !== 'approval') throw new TaskWorkError('An outward act needs an approval item Adamya approved; propose one first');
  if (item.status !== 'approved') throw new TaskWorkError('That approval item is not approved');
  if (item.consumedAt) throw new TaskWorkError('That approved item was already acted on; it is never acted on twice');
  return item;
}

// ───────────── leases, failures, interrupted acts ─────────────

export function leaseLive(record: TaskWork | undefined, now: Date): boolean {
  return !!record?.lease && Date.parse(record.lease.expiresAt) > now.getTime();
}

/** Only the run that holds the live lease may write. */
export function requireTaskWorkLease(record: TaskWork | undefined, token: string, now: Date): TaskWork {
  if (!record) throw new TaskWorkError('No task work record for that task', 404);
  if (record.status !== 'working' || !record.lease || record.lease.token !== token) throw new TaskWorkError('The task work lease is missing or no longer valid');
  if (Date.parse(record.lease.expiresAt) <= now.getTime()) throw new TaskWorkError('The task work lease has expired');
  return record;
}

const shortDay = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * An outward act was started and the run did not say how it ended: ask whether it went out. The approved
 * item counts as tried, so nothing sends it again on its own (the job worker's submit guard).
 */
export function askWhetherSent(record: TaskWork, now: Date, opts: { keepStatus?: boolean } = {}): void {
  const attempted = record.attempted!;
  const item = attempted.itemId ? record.items.find((i) => i.id === attempted.itemId) : undefined;
  if (item && !item.consumedAt) item.consumedAt = now.toISOString();
  addItem(record, 'sent-check', `Did this go out? ${attempted.what} (started ${shortDay(attempted.at)}, the run stopped before saying)`, now, item?.editedDetail ?? item?.detail);
  delete record.attempted;
  delete record.lease;
  if (!opts.keepStatus) setTaskWorkStatus(record, 'needs-you', 'an outward act was interrupted', now);
}

/** A run that ended without an outcome: retry after 30 min, 2 h, 1 day; the third in a row asks Adamya. */
export function recordTaskWorkFailure(record: TaskWork, why: string, now: Date, by: TaskWorkActor = 'journal'): void {
  record.failures += 1;
  record.lastError = why;
  delete record.lease;
  if (record.failures >= TASK_WORK_FAILURE_LIMIT) {
    delete record.nextRetryAt;
    addItem(record, 'question', `OpenClaw could not finish this three times: ${why}`, now);
    setTaskWorkStatus(record, 'needs-you', `failed ${record.failures} times in a row`, now, by);
    return;
  }
  record.reason = 'retry';
  record.nextRetryAt = new Date(now.getTime() + TASK_WORK_RETRY_DELAYS_MS[record.failures - 1]).toISOString();
  setTaskWorkStatus(record, 'queued', `failed: ${why}`, now, by);
}

/** Recovers a run whose lease ran out. True when the record changed. */
export function recoverExpiredLease(record: TaskWork, now: Date): boolean {
  if (record.status !== 'working' || !record.lease || leaseLive(record, now)) return false;
  if (record.attempted) askWhetherSent(record, now);
  else recordTaskWorkFailure(record, `the run claimed ${shortDay(record.lease.claimedAt)} at ${record.lease.claimedAt.slice(11, 16)} UTC ended without reporting back`, now);
  return true;
}

// ───────────── waiting on a reply ─────────────

/** When to look for a reply: a day after sending, then every two days for a week, then weekly. */
export function replyCheckAfter(since: string, checks: number): string {
  const days = checks <= 3 ? [1, 3, 5, 7][checks] : 7 * (checks - 2);
  return new Date(Date.parse(since) + days * DAY).toISOString();
}

/** Waiting that has a check due. */
export function replyCheckDue(record: TaskWork, now: Date): boolean {
  return record.status === 'waiting' && !!record.waiting && Date.parse(record.waiting.checkAfter) <= now.getTime();
}

/** Three weeks of silence: the next check asks Adamya instead. True when the record changed. */
export function askAfterSilence(record: TaskWork, now: Date): boolean {
  if (!replyCheckDue(record, now)) return false;
  const w = record.waiting!;
  if (now.getTime() - Date.parse(w.since) < TASK_WORK_SILENCE_LIMIT_MS) return false;
  addItem(record, 'question', `No reply from ${w.on} since ${shortDay(w.since)}. Follow up, or stop waiting?`, now);
  setTaskWorkStatus(record, 'needs-you', `no reply from ${w.on} in three weeks`, now);
  return true;
}

/** The waiting state for `on`: the same party keeps its clock and check count, a new one starts both. */
export function nextWaiting(record: TaskWork, on: string, now: Date, checkAfter?: string): NonNullable<TaskWork['waiting']> {
  const same = record.waiting && record.waiting.on.trim().toLowerCase() === on.trim().toLowerCase();
  const since = same ? record.waiting!.since : now.toISOString();
  const checks = same ? record.waiting!.checks : 0;
  const at = Math.max(Date.parse(checkAfter ?? replyCheckAfter(since, checks)), now.getTime() + 3600_000);
  return { on, since, checks, checkAfter: new Date(at).toISOString() };
}

// ───────────── which task is next ─────────────

export interface TaskWorkRef {
  taskId: string;
  listType: ListType;
  listIndex: number;               // order on its list (have-to-do first, then want-to-do)
  currentRank: number | null;      // place in the Current queue, if it is there
  dueDate?: string;
  isDaily?: boolean;
  parentTaskId?: string;
  fingerprint: string;
}

export interface TaskWorkPick { taskId: string; reason: TaskWorkReason; sweep: boolean }

export function localDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function quietHours(now: Date): boolean {
  const h = now.getHours();
  return h >= QUIET_FROM_HOUR || h < QUIET_UNTIL_HOUR;
}

/** Sweep claims left today (local day), after the cap. */
export function sweepRoom(meta: TaskWorkMeta, now: Date): number {
  const today = localDay(now);
  const cap = meta.sweepFirstDay === today ? Math.min(meta.sweepCap, SWEEP_FIRST_DAY_CAP) : meta.sweepCap;
  return cap - (meta.sweepClaims.date === today ? meta.sweepClaims.count : 0);
}

/**
 * The next task to work on, without changing anything. In order: handed or answered; a reply check that is due;
 * a retry that is due; then the sweep over the rest (Current queue first, then due within two weeks, then list
 * order), which has a daily cap and keeps quiet at night. Null while any run holds a lease.
 */
export function pickNextTaskWork(
  records: Record<string, TaskWork>,
  refs: TaskWorkRef[],
  now: Date,
  meta: TaskWorkMeta
): TaskWorkPick | null {
  if (Object.values(records).some((r) => leaseLive(r, now))) return null;
  const open = new Map(refs.map((r) => [r.taskId, r]));
  const t = now.getTime();
  const at = (iso: string | undefined) => (iso ? Date.parse(iso) : 0);
  const mine = Object.entries(records).filter(([id]) => open.has(id));

  const first = mine
    .filter(([, r]) => r.status === 'queued' && (r.reason === 'handed' || r.reason === 'answered'))
    .sort(([, a], [, b]) => at(a.updatedAt) - at(b.updatedAt))[0];
  if (first) return { taskId: first[0], reason: first[1].reason, sweep: false };

  // Waiting past three weeks is turned into a question by the claim, not worked on.
  const reply = mine
    .filter(([, r]) => replyCheckDue(r, now) && t - Date.parse(r.waiting!.since) < TASK_WORK_SILENCE_LIMIT_MS)
    .sort(([, a], [, b]) => at(a.waiting!.checkAfter) - at(b.waiting!.checkAfter))[0];
  if (reply) return { taskId: reply[0], reason: 'reply-check', sweep: false };

  const retry = mine
    .filter(([, r]) => r.status === 'queued' && at(r.nextRetryAt) <= t)
    .sort(([, a], [, b]) => at(a.nextRetryAt) - at(b.nextRetryAt))[0];
  if (retry) return { taskId: retry[0], reason: retry[1].reason, sweep: false };

  if (!meta.sweepEnabled || quietHours(now) || sweepRoom(meta, now) <= 0) return null;
  const horizon = localDay(new Date(t + SWEEP_DUE_DAYS * DAY));
  const tier = (r: TaskWorkRef) => (r.currentRank !== null ? 0 : r.dueDate && r.dueDate <= horizon ? 1 : 2);
  const listOrder = (r: TaskWorkRef) => (r.listType === 'have-to-do' ? 0 : 1e6) + r.listIndex;
  const sweep = refs
    .filter((ref) => {
      if (ref.isDaily) return false;
      if (ref.parentTaskId && records[ref.parentTaskId]?.status === 'off') return false;
      const r = records[ref.taskId];
      if (!r) return true;
      return r.status === 'resting' && (r.fingerprint !== ref.fingerprint || (!!r.lookAgainAfter && at(r.lookAgainAfter) <= t));
    })
    .sort((a, b) => tier(a) - tier(b)
      || (tier(a) === 0 ? a.currentRank! - b.currentRank! : 0)
      || (tier(a) === 1 ? a.dueDate!.localeCompare(b.dueDate!) : 0)
      || listOrder(a) - listOrder(b))[0];
  return sweep ? { taskId: sweep.taskId, reason: 'sweep', sweep: true } : null;
}

// ───────────── what a run may do ─────────────

/** Handed to the run verbatim with every claim. */
export const TASK_WORK_RULES: readonly string[] = [
  'Look: read the task, its notes, the brief, email, Canvas, the web and earlier sessions. Always allowed.',
  'Prepare: make things only Adamya sees (a draft in the task\'s notes, what is due, the form found and its fields, a comparison). Allowed on any task that is not off.',
  'Act outward (send an email, submit a form, book, post, message a person) only on approval items Adamya approved, and only with the approved text (his edited text when he edited it). Otherwise propose an approval item with the exact recipient and text, and stop. Post `attempted` with the item id before the act and `progress` with the item id after it.',
  'Never, whatever the grant: spend money or enter payment details; sign or accept terms; submit or write graded coursework, an online assessment or a job application; delete anything; change account or security settings; complete, reword, re-date or remove the task itself.',
  'Coursework: prepare only (what is due, where, the materials gathered), never the work itself.',
  'Found it finished? Do not complete it: close with `looks-done`.',
  'Claim once per run, take one step, and always close with exactly one of waiting, rest, continue, ask, propose, looks-done, retry or release.',
];

// ───────────── in plain words ─────────────

/** One line on where the task stands, for the brief strip. */
export function taskWorkSummary(record: TaskWork | undefined, now: Date): string {
  if (!record) return 'Not handed to OpenClaw';
  if (record.status === 'off') return 'Hands off';
  if (record.status === 'working') return 'OpenClaw is working on this';
  const pending = pendingItems(record).length;
  if (pending > 0) return `Needs you: ${pending} item${pending === 1 ? '' : 's'}`;
  if (record.status === 'waiting' && record.waiting) {
    return `Waiting on ${record.waiting.on} since ${shortDay(record.waiting.since)}, looks again ${shortDay(record.waiting.checkAfter)}`;
  }
  if (record.status === 'queued') {
    if (record.reason === 'answered') return 'Answered, OpenClaw picks it up next';
    if (record.reason === 'retry') {
      return record.nextRetryAt && Date.parse(record.nextRetryAt) > now.getTime()
        ? `OpenClaw tries again ${shortDay(record.nextRetryAt)} at ${new Date(record.nextRetryAt).toTimeString().slice(0, 5)}`
        : 'OpenClaw takes the next step soon';
    }
    return record.lookedAt ? 'Handed to OpenClaw, next step soon' : 'Handed to OpenClaw, not started';
  }
  if (record.status === 'resting') {
    const looked = record.lookedAt ? `OpenClaw looked ${shortDay(record.lookedAt)}` : 'OpenClaw looked';
    return record.lookAgainAfter ? `${looked}, nothing it can do now; looks again ${shortDay(record.lookAgainAfter)}` : `${looked}, nothing it can do now`;
  }
  return 'Needs you';
}
