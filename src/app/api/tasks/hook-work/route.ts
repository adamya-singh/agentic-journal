import { NextRequest, NextResponse } from 'next/server';
import { mergeWork, nextWorkRecord, readBlocks, resolveWork, WORK_BODY_MAX } from '@/lib/hook-work';
import { parseBlocks } from '@/lib/shapes/work';
import { loadTaskBrief, openTaskRefs } from '../brief/build';
import { mutateHookWorkRecords, readHookWorkRecord } from './store';

function resolved(taskId: string, title: string) {
  return resolveWork(loadTaskBrief(taskId)?.hook?.work ?? null, readHookWorkRecord(taskId), title);
}

/**
 * GET /api/tasks/hook-work?id=<taskId>
 * The started work of a task as the page shows it: Adamya's text when he has edited it, else OpenClaw's,
 * with OpenClaw's newer version beside it when there is one.
 */
export async function GET(request: NextRequest) {
  const taskId = request.nextUrl.searchParams.get('id');
  if (!taskId) return NextResponse.json({ success: false, error: 'Missing id' }, { status: 400 });
  try {
    const ref = openTaskRefs().find((r) => r.task.id === taskId);
    if (!ref) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: resolved(taskId, ref.task.text) });
  } catch (error) {
    console.error('Error reading hook work:', error);
    return NextResponse.json({ success: false, error: 'Failed to read the work' }, { status: 500 });
  }
}

/**
 * POST /api/tasks/hook-work
 * Body: { taskId, action: 'open' }                      he opened the task: it is marked started
 *       { taskId, action: 'save', blocks, baseHash?, seen?, changed? }   his version of the work's blocks
 *       { taskId, action: 'reset' }                     drop his text and take OpenClaw's version
 * `seen` is the version (rev) his blocks started from and `changed` the ids of the blocks he changed since. When
 * the workspace was written after `seen` (by OpenClaw, from a chat), only those blocks are laid over it; the
 * answer is the work as saved, which the page then shows.
 * Everything stays in the journal: nothing is sent or created anywhere else.
 */
export async function POST(request: NextRequest) {
  try {
    const { taskId, action, blocks, baseHash, seen, changed } = await request.json();
    if (!taskId || typeof taskId !== 'string') return NextResponse.json({ success: false, error: 'taskId is required' }, { status: 400 });
    if (action !== 'open' && action !== 'save' && action !== 'reset') {
      return NextResponse.json({ success: false, error: 'action must be "open", "save" or "reset"' }, { status: 400 });
    }
    if (action === 'save' && (!Array.isArray(blocks) || JSON.stringify(blocks).length > WORK_BODY_MAX)) {
      return NextResponse.json({ success: false, error: `blocks must be a list of at most ${WORK_BODY_MAX} characters` }, { status: 400 });
    }
    const ref = openTaskRefs().find((r) => r.task.id === taskId);
    if (!ref) return NextResponse.json({ success: false, error: 'Task not found' }, { status: 404 });

    let merged = false;
    mutateHookWorkRecords((records) => {
      const record = records[taskId];
      let mine = action === 'save' ? parseBlocks(blocks).blocks : undefined;
      let base = typeof baseHash === 'string' ? baseHash : null;
      const theirs = readBlocks(record?.body);
      if (mine && theirs && typeof seen === 'number' && (record?.rev ?? 0) !== seen) {
        // Written since the version he was typing in: his changed blocks go over it, the rest stays.
        mine = parseBlocks(mergeWork(theirs, mine, Array.isArray(changed) ? changed.filter((id): id is string => typeof id === 'string') : [])).blocks;
        base = record?.baseHash ?? base;
        merged = true;
      }
      records[taskId] = nextWorkRecord(record, { taskId, ...(mine ? { blocks: mine, baseHash: base } : {}), reset: action === 'reset' }, new Date());
    });
    return NextResponse.json({ success: true, data: resolved(taskId, ref.task.text), ...(merged ? { merged: true } : {}) });
  } catch (error) {
    console.error('Error saving hook work:', error);
    return NextResponse.json({ success: false, error: 'Failed to save the work' }, { status: 500 });
  }
}
