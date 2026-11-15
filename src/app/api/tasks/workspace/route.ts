import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { WORK_BODY_MAX } from '@/lib/hook-work';
import { applyWorkspaceOp } from '@/lib/task-workspace';
import { changePastedTabs } from '../workspace-tabs/store';
import { loadWorkspace, peekWorkspace, writeWorkspaceBlocks } from './load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A task's workspace for OpenClaw, working from a chat in that workspace: what the Work tab holds and which web
// tabs there are, and the changes it may make to them (lib/task-workspace.ts). What it writes is the same copy he
// works in, and the open page shows it within a few seconds. Nothing leaves the Journal from here.

const taskId = z.string().min(1).max(200);
const BodySchema = z.discriminatedUnion('action', [
  z.object({ taskId, action: z.literal('write'), blocks: z.array(z.unknown()) }),
  z.object({ taskId, action: z.literal('block'), block: z.record(z.string(), z.unknown()) }),
  z.object({ taskId, action: z.literal('remove-block'), id: z.string().min(1).max(60) }),
  z.object({ taskId, action: z.literal('open-tab'), url: z.string().trim().min(1).max(2000) }),
  z.object({ taskId, action: z.literal('close-tab'), url: z.string().trim().min(1).max(2000) }),
]);
const HOW = 'Send { taskId, action: "write", blocks } | { taskId, action: "block", block } | { taskId, action: "remove-block", id } | { taskId, action: "open-tab" | "close-tab", url }.';

/**
 * GET /api/tasks/workspace?id=<taskId>          the workspace as it stands: { taskId, title, work, tabs }
 * GET /api/tasks/workspace?id=<taskId>&peek=1   { rev, tabs }: enough for the open page to know it was changed
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  try {
    if (request.nextUrl.searchParams.has('peek')) return NextResponse.json({ success: true, data: peekWorkspace(id) }, { headers: { 'Cache-Control': 'no-store' } });
    const loaded = loadWorkspace(id);
    if (!loaded) return NextResponse.json({ success: false, error: `No open task has the id ${id}.` }, { status: 404 });
    return NextResponse.json({ success: true, data: loaded.view }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('workspace: could not read:', error);
    return NextResponse.json({ success: false, error: 'The workspace could not be read.' }, { status: 500 });
  }
}

/** POST /api/tasks/workspace: one change to the workspace → { ...the workspace after it, problems } */
export async function POST(request: NextRequest) {
  const raw = await request.text().catch(() => '');
  if (raw.length > WORK_BODY_MAX * 2) return NextResponse.json({ success: false, error: `The body is over ${WORK_BODY_MAX * 2} characters.` }, { status: 400 });
  let json: unknown = null;
  try { json = JSON.parse(raw); } catch { return NextResponse.json({ success: false, error: `The body is not JSON. ${HOW}` }, { status: 400 }); }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ success: false, error: HOW }, { status: 400 });
  const body = parsed.data;
  try {
    const loaded = loadWorkspace(body.taskId);
    if (!loaded) return NextResponse.json({ success: false, error: `No open task has the id ${body.taskId}.` }, { status: 404 });
    let problems: string[] = [];
    if (body.action === 'open-tab' || body.action === 'close-tab') {
      if (changePastedTabs(body.taskId, body.action === 'open-tab' ? 'add' : 'remove', body.url) === null) {
        return NextResponse.json({ success: false, error: 'That is not a web address (http or https).' }, { status: 400 });
      }
    } else {
      const changed = applyWorkspaceOp(loaded.view.work?.blocks ?? [], body);
      if ('error' in changed) return NextResponse.json({ success: false, error: changed.error, problems: changed.problems }, { status: 400 });
      writeWorkspaceBlocks(body.taskId, changed.blocks);
      problems = changed.problems;
    }
    return NextResponse.json({ success: true, data: { ...loadWorkspace(body.taskId)?.view, problems } });
  } catch (error) {
    console.error('workspace: could not change:', error);
    return NextResponse.json({ success: false, error: 'The workspace could not be changed.' }, { status: 500 });
  }
}
