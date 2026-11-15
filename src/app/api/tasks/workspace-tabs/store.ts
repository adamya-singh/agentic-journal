// The pages added to a task's workspace, in tasks/workspace-tabs.json, so they are tabs again the next time he
// opens the task. He adds one by pasting an address; OpenClaw adds one from a chat in the workspace
// (POST /api/tasks/workspace). Only addresses: nothing is opened in OpenClaw's browser from here. Only the Next
// server writes the file, and each read-modify-write below is synchronous.
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { readPastedPages, withoutPastedPage, withPastedPage } from '@/lib/task-surfaces';

const COMMENT = 'Web pages Adamya pasted into a task’s workspace, keyed by task id. The task’s own links are not listed here.';
const filePath = () => path.join(tasksDataDir(), 'workspace-tabs.json');

function readAll(): Record<string, string[]> {
  try {
    const stored = (JSON.parse(fs.readFileSync(filePath(), 'utf-8')) as { tabs?: unknown }).tabs;
    if (!stored || typeof stored !== 'object') return {};
    return Object.fromEntries(Object.entries(stored).map(([taskId, list]) => [taskId, readPastedPages(list)]).filter(([, list]) => list.length > 0));
  } catch {
    return {};
  }
}

/** The pages added to a task's workspace. */
export function readPastedTabs(taskId: string): string[] {
  return readAll()[taskId] ?? [];
}

/** The task's added pages with this one put on or taken off. Null when it is not a web address. */
export function changePastedTabs(taskId: string, action: 'add' | 'remove', url: string): string[] | null {
  const all = readAll();
  const have = all[taskId] ?? [];
  const next = action === 'add' ? withPastedPage(have, url) : withoutPastedPage(have, url);
  if (next === null) return null;
  if (next !== have) {
    if (next.length > 0) all[taskId] = next;
    else delete all[taskId];
    writeJsonFileAtomic(filePath(), { _comment: COMMENT, schemaVersion: 1, tabs: all });
  }
  return next;
}
