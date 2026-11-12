// The started work of a task's hook, as Adamya sees and changes it. OpenClaw composes the first version into the
// brief (hook.work, see shapes/hook.ts and shapes/work.ts). His version of the blocks is kept apart from it, one
// record per task, so a later fill by OpenClaw never overwrites what he wrote. Pure: the store, the route, the
// page and the tests share it.
import { createHash } from 'crypto';
import type { HookWork } from '@/lib/shapes/hook';
import { parseBlocks, workLimits, type WorkBlock } from '@/lib/shapes/work';

export const WORK_BODY_MAX = workLimits.total + 2000;

export interface HookWorkRecord {
  taskId: string;
  body: string | null;       // his blocks, as JSON; null when he has opened the task but changed nothing
  baseHash: string | null;   // workHash of OpenClaw's blocks his version started from
  startedAt: string;         // when he first opened the task: the "started" mark
  updatedAt: string;
}

export function workHash(blocks: WorkBlock[] | string): string {
  return createHash('sha1').update(typeof blocks === 'string' ? blocks : JSON.stringify(blocks)).digest('hex').slice(0, 16);
}

/** His saved blocks, read back as carefully as OpenClaw's. Null when there are none. */
export function readBlocks(body: string | null | undefined): WorkBlock[] | null {
  if (body === null || body === undefined) return null;
  try { return parseBlocks(JSON.parse(body)).blocks; } catch { return null; }
}

export interface ResolvedWork {
  title: string;
  href: string | null;
  blocks: WorkBlock[];           // what the page shows: his version when he has changed something, else OpenClaw's
  edited: boolean;               // the blocks are his
  baseHash: string | null;       // what to send back with a save
  newer: WorkBlock[] | null;     // OpenClaw's blocks, when they have changed since his version started from them
  startedAt: string | null;
}

/** What the page shows for a task's work: his version wins; OpenClaw's newer one is offered beside it. */
export function resolveWork(work: HookWork | null, record: HookWorkRecord | undefined, fallbackTitle: string): ResolvedWork | null {
  const mine = readBlocks(record?.body);
  if (!work && mine === null) return null;
  const agentHash = work ? workHash(work.blocks) : null;
  return {
    title: work?.title ?? fallbackTitle,
    href: work?.href ?? null,
    blocks: mine ?? work?.blocks ?? [],
    edited: mine !== null,
    baseHash: mine !== null ? record?.baseHash ?? null : agentHash,
    newer: mine !== null && work && agentHash !== record?.baseHash && JSON.stringify(work.blocks) !== JSON.stringify(mine) ? work.blocks : null,
    startedAt: record?.startedAt ?? null,
  };
}

/** The record after he opens the task (no blocks) or saves his version. `reset` takes OpenClaw's version back. */
export function nextWorkRecord(
  record: HookWorkRecord | undefined,
  change: { taskId: string; blocks?: WorkBlock[]; baseHash?: string | null; reset?: boolean },
  now: Date
): HookWorkRecord {
  const at = now.toISOString();
  const base: HookWorkRecord = record ?? { taskId: change.taskId, body: null, baseHash: null, startedAt: at, updatedAt: at };
  if (change.reset) return { ...base, body: null, baseHash: null, updatedAt: at };
  if (change.blocks === undefined) return base;
  return { ...base, body: JSON.stringify(change.blocks), baseHash: change.baseHash ?? base.baseHash, updatedAt: at };
}
