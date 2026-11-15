// The started work of a task's hook, as Adamya sees and changes it. OpenClaw composes the first version into the
// brief (hook.work, see shapes/hook.ts and shapes/work.ts). The workspace's own version of the blocks is kept
// apart from it, one record per task, so a later fill of the brief never overwrites what was written there. He
// writes it by working in the blocks; OpenClaw writes it from a chat in the task's workspace (lib/task-workspace.ts).
// Pure: the store, the routes, the page and the tests share it.
import { createHash } from 'crypto';
import type { HookWork } from '@/lib/shapes/hook';
import { parseBlocks, workLimits, type WorkBlock } from '@/lib/shapes/work';

export const WORK_BODY_MAX = workLimits.total + 2000;

export interface HookWorkRecord {
  taskId: string;
  body: string | null;       // the workspace's blocks, as JSON; null when he has opened the task but nothing was changed
  baseHash: string | null;   // workHash of the brief's blocks this version started from
  rev?: number;              // goes up by one each time the body is written, by him or by OpenClaw
  by?: WorkWriter;           // who wrote the body last
  startedAt: string;         // when he first opened the task: the "started" mark
  updatedAt: string;
}

export type WorkWriter = 'you' | 'openclaw';

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
  blocks: WorkBlock[];           // what the page shows: the workspace's version when there is one, else the brief's
  edited: boolean;               // the blocks are the workspace's own, not the brief's
  baseHash: string | null;       // what to send back with a save
  newer: WorkBlock[] | null;     // the brief's blocks, when they have changed since the workspace's version started from them
  rev: number;                   // the workspace version's count of writes; a save says which one it started from
  by: WorkWriter | null;         // who wrote the workspace's version last
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
    rev: record?.rev ?? 0,
    by: mine !== null ? record?.by ?? 'you' : null,
  };
}

/**
 * His blocks laid over the workspace's, when the workspace was written (by OpenClaw, in a chat) after the version
 * he was working in: every block stays as the workspace has it, except the ones he changed since, which stay his.
 * A block he changed that is no longer there is kept at the end: nothing he wrote is lost.
 */
export function mergeWork(current: WorkBlock[], mine: WorkBlock[], changed: string[]): WorkBlock[] {
  const his = new Map(mine.filter((block) => changed.includes(block.id)).map((block) => [block.id, block]));
  const merged = current.map((block) => his.get(block.id) ?? block);
  const have = new Set(current.map((block) => block.id));
  return [...merged, ...[...his.values()].filter((block) => !have.has(block.id))];
}

/**
 * The record after he opens the task (no blocks) or the workspace's version is written, by him or (`by`) by
 * OpenClaw. `reset` takes the brief's version back.
 */
export function nextWorkRecord(
  record: HookWorkRecord | undefined,
  change: { taskId: string; blocks?: WorkBlock[]; baseHash?: string | null; reset?: boolean; by?: WorkWriter },
  now: Date
): HookWorkRecord {
  const at = now.toISOString();
  const base: HookWorkRecord = record ?? { taskId: change.taskId, body: null, baseHash: null, startedAt: at, updatedAt: at };
  const rev = (base.rev ?? 0) + 1;
  if (change.reset) {
    const rest = { ...base, body: null, baseHash: null, updatedAt: at, rev };
    delete rest.by;
    return rest;
  }
  if (change.blocks === undefined) return base;
  return { ...base, body: JSON.stringify(change.blocks), baseHash: change.baseHash ?? base.baseHash, updatedAt: at, rev, by: change.by ?? 'you' };
}
