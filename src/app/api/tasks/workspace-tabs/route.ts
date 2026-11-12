import * as fs from 'fs';
import * as path from 'path';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import { readPastedPages, withoutPastedPage, withPastedPage } from '@/lib/task-surfaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The pages he pasted into a task's workspace, in tasks/workspace-tabs.json, so they are tabs again the next time
// he opens the task. Only addresses: nothing is opened in OpenClaw's browser from here. Only the Next server
// writes the file, and each read-modify-write below is synchronous.

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

const BodySchema = z.object({ taskId: z.string().min(1).max(200), action: z.enum(['add', 'remove']), url: z.string().trim().min(1).max(2000) });

/** GET /api/tasks/workspace-tabs?id=<taskId> → { pasted: string[] } */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('id');
  if (!taskId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  return NextResponse.json({ success: true, data: { pasted: readAll()[taskId] ?? [] } }, { headers: { 'Cache-Control': 'no-store' } });
}

/** POST /api/tasks/workspace-tabs { taskId, action: 'add' | 'remove', url } → { pasted: string[] } */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { taskId, action: add | remove, url }.' }, { status: 400 });
  const { taskId, action, url } = parsed.data;
  try {
    const all = readAll();
    const have = all[taskId] ?? [];
    const next = action === 'add' ? withPastedPage(have, url) : withoutPastedPage(have, url);
    if (next === null) return NextResponse.json({ success: false, error: 'That is not a web address' }, { status: 400 });
    if (next !== have) {
      if (next.length > 0) all[taskId] = next;
      else delete all[taskId];
      writeJsonFileAtomic(filePath(), { _comment: COMMENT, schemaVersion: 1, tabs: all });
    }
    return NextResponse.json({ success: true, data: { pasted: next } });
  } catch (error) {
    console.error('workspace tabs: could not save:', error);
    return NextResponse.json({ success: false, error: 'That did not save.' }, { status: 500 });
  }
}
