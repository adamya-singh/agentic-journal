// A task's workspace read from the stores, and the one write OpenClaw makes to its Work tab. Shared by the
// workspace route and the chat route, so a chat is told exactly what a read of the route would say.
import { nextWorkRecord, resolveWork, workHash, type ResolvedWork } from '@/lib/hook-work';
import type { WorkBlock } from '@/lib/shapes/work';
import { deriveSurfaces } from '@/lib/task-surfaces';
import { workspaceView, type WorkspacePeek, type WorkspaceView } from '@/lib/task-workspace';
import { loadTaskBrief, openTaskRefs } from '../brief/build';
import { mutateHookWorkRecords, readHookWorkRecord } from '../hook-work/store';
import { readPastedTabs } from '../workspace-tabs/store';

/** The workspace of an open task as it stands, or null when no open task has the id. */
export function loadWorkspace(taskId: string): { view: WorkspaceView; work: ResolvedWork | null } | null {
  const ref = openTaskRefs().find((r) => r.task.id === taskId);
  if (!ref) return null;
  const brief = loadTaskBrief(taskId);
  const work = resolveWork(brief?.hook?.work ?? null, readHookWorkRecord(taskId), ref.task.text);
  const surfaces = deriveSurfaces({
    links: brief?.links ?? [],
    next: brief?.next ? { label: brief.next.label, ...(brief.next.href ? { href: brief.next.href } : {}) } : null,
    work: work ? { title: work.title, href: work.href, blocks: work.blocks.filter((block) => block.kind !== 'file').length } : null,
    pasted: readPastedTabs(taskId),
    files: (work?.blocks ?? []).flatMap((block) => (block.kind === 'file' ? [{ id: block.id, path: block.path, ...(block.label ? { label: block.label } : {}) }] : [])),
  });
  return { view: workspaceView({ taskId, title: ref.task.text, work, surfaces }), work };
}

/** What the open page asks every few seconds: two small files, no brief. */
export function peekWorkspace(taskId: string): WorkspacePeek {
  return { rev: readHookWorkRecord(taskId)?.rev ?? 0, tabs: readPastedTabs(taskId).join('\n') };
}

/**
 * OpenClaw's blocks become the Work tab's version. It starts from the brief as it is now, so the brief's own
 * blocks are offered again only if a later fill changes them.
 */
export function writeWorkspaceBlocks(taskId: string, blocks: WorkBlock[]): void {
  const briefWork = loadTaskBrief(taskId)?.hook?.work ?? null;
  mutateHookWorkRecords((records) => {
    records[taskId] = nextWorkRecord(records[taskId], { taskId, blocks, baseHash: briefWork ? workHash(briefWork.blocks) : null, by: 'openclaw' }, new Date());
  });
}
