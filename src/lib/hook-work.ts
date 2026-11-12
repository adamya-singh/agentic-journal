// The started work of a task's hook, as Adamya sees and edits it. OpenClaw writes the first version into the
// brief (hook.work, see shapes/hook.ts). His edits are kept apart from it, one record per task, so a later fill by
// OpenClaw never overwrites what he wrote. Pure: the store, the route, the page and the tests share it.
import { createHash } from 'crypto';
import type { HookWork } from '@/lib/shapes/hook';

export const WORK_BODY_MAX = 12_000;

export interface HookWorkRecord {
  taskId: string;
  body: string | null;       // his text; null when he has opened the task but not edited the work
  baseHash: string | null;   // workHash of OpenClaw's body his text started from
  startedAt: string;         // when he first opened the task: the "started" mark
  updatedAt: string;
}

export function workHash(body: string): string {
  return createHash('sha1').update(body).digest('hex').slice(0, 16);
}

export interface ResolvedWork {
  title: string;
  format: HookWork['format'];
  body: string;              // what the page shows: his text when he has edited, else OpenClaw's
  href: string | null;
  edited: boolean;           // the body is his
  baseHash: string | null;   // what to send back with a save
  newer: string | null;      // OpenClaw's body, when it has changed since his text started from it
  startedAt: string | null;
}

/** What the page shows for a task's work: his text wins; OpenClaw's newer version is offered beside it. */
export function resolveWork(work: HookWork | null, record: HookWorkRecord | undefined, fallbackTitle: string): ResolvedWork | null {
  const mine = record?.body ?? null;
  if (!work && mine === null) return null;
  const agentHash = work ? workHash(work.body) : null;
  return {
    title: work?.title ?? fallbackTitle,
    format: work?.format ?? 'text',
    body: mine ?? work?.body ?? '',
    href: work?.href ?? null,
    edited: mine !== null,
    baseHash: mine !== null ? record?.baseHash ?? null : agentHash,
    newer: mine !== null && work && agentHash !== record?.baseHash && work.body !== mine ? work.body : null,
    startedAt: record?.startedAt ?? null,
  };
}

/** The record after he opens the task (no body) or saves his text. Null body with `reset` takes OpenClaw's version back. */
export function nextWorkRecord(
  record: HookWorkRecord | undefined,
  change: { taskId: string; body?: string; baseHash?: string | null; reset?: boolean },
  now: Date
): HookWorkRecord {
  const at = now.toISOString();
  const base: HookWorkRecord = record ?? { taskId: change.taskId, body: null, baseHash: null, startedAt: at, updatedAt: at };
  if (change.reset) return { ...base, body: null, baseHash: null, updatedAt: at };
  if (change.body === undefined) return base;
  return { ...base, body: change.body.slice(0, WORK_BODY_MAX), baseHash: change.baseHash ?? base.baseHash, updatedAt: at };
}
