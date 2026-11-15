import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { changePastedTabs, readPastedTabs } from './store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The pages he pasted into a task's workspace (see ./store.ts).

const BodySchema = z.object({ taskId: z.string().min(1).max(200), action: z.enum(['add', 'remove']), url: z.string().trim().min(1).max(2000) });

/** GET /api/tasks/workspace-tabs?id=<taskId> → { pasted: string[] } */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('id');
  if (!taskId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  return NextResponse.json({ success: true, data: { pasted: readPastedTabs(taskId) } }, { headers: { 'Cache-Control': 'no-store' } });
}

/** POST /api/tasks/workspace-tabs { taskId, action: 'add' | 'remove', url } → { pasted: string[] } */
export async function POST(request: NextRequest) {
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Send { taskId, action: add | remove, url }.' }, { status: 400 });
  const { taskId, action, url } = parsed.data;
  try {
    const next = changePastedTabs(taskId, action, url);
    if (next === null) return NextResponse.json({ success: false, error: 'That is not a web address' }, { status: 400 });
    return NextResponse.json({ success: true, data: { pasted: next } });
  } catch (error) {
    console.error('workspace tabs: could not save:', error);
    return NextResponse.json({ success: false, error: 'That did not save.' }, { status: 500 });
  }
}
