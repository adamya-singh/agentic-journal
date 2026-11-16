// Folding one task into another across every store that holds something of a task, taking that back, and asking
// OpenClaw to make one task of the two (lib/task-merge.ts has the rules). The task's own record is changed through
// the routes that already change tasks (update, let go, restore), so every list that follows a task stays right.
import { NextRequest } from 'next/server';
import { extractJsonObject } from '@/lib/done-at';
import { nextWorkRecord, readBlocks, resolveWork, workHash, type HookWorkRecord } from '@/lib/hook-work';
import { runOpenClawAgentTurn } from '@/lib/openclaw-agent';
import { isOpenClawCliAvailable } from '@/lib/openclaw-cron';
import type { WorkBlock } from '@/lib/shapes/work';
import { CHAT_TURN_TIMEOUT_MS, newChatThread, recordChatReply, type TaskChatThread } from '@/lib/task-chat';
import { buildMergePrompt, mergedBlocks, mergedNotes, readMergeReply, type MergeRecord, type MergeTask } from '@/lib/task-merge';
import { canTransition, leaseLive, setTaskWorkStatus, type TaskWork } from '@/lib/task-work';
import type { ListType, Task } from '@/lib/types';
import { scheduleBriefFills } from '../brief-agent/worker';
import { loadTaskBrief, openTaskRefs } from '../brief/build';
import { readTaskPicks, setTaskPicks } from '../brief-chat/models';
import { mutateChatThreads, readChatThreads, settleStaleChatTurns } from '../brief-chat/store';
import { mutateHookWorkRecords, readHookWorkRecord } from '../hook-work/store';
import { POST as letGoRoute } from '../let-go/route';
import { POST as restoreRoute } from '../let-go/restore/route';
import { POST as updateRoute } from '../update/route';
import { mutateTaskWork, readTaskWorkFile } from '../work/store';
import { changePastedTabs, readPastedTabs } from '../workspace-tabs/store';
import { writeWorkspaceBlocks } from '../workspace/load';
import { mutateMerges, readMerge } from './store';

export class MergeError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const MERGE_TURN_TIMEOUT_MS = Math.min(8 * 60_000, CHAT_TURN_TIMEOUT_MS);
const UNDO_WITHIN_MS = 30 * 60_000;
const short = (text: string) => `“${text.replace(/\s+/g, ' ').trim().replace(/[.…]+$/, '')}”`;

/** One of the routes that change a task, called as the page would call it. Its error is this merge's error. */
async function call(route: (request: NextRequest) => Promise<Response>, body: Record<string, unknown>, what: string): Promise<Record<string, unknown>> {
  const response = await route(new NextRequest('http://127.0.0.1/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || !json?.success) throw new MergeError(`${what}: ${typeof json?.error === 'string' ? json.error : 'it could not be saved'}`, response.ok ? 500 : response.status);
  return json;
}

const asMergeTask = (task: Task): MergeTask => ({
  id: task.id, text: task.text,
  ...(task.notesMarkdown ? { notesMarkdown: task.notesMarkdown } : {}),
  ...(task.dueDate ? { dueDate: task.dueDate } : {}),
  ...(task.dueTimeStart ? { dueTimeStart: task.dueTimeStart } : {}),
  ...(task.dueTimeEnd ? { dueTimeEnd: task.dueTimeEnd } : {}),
});

/** A task's work blocks as its workspace shows them: its own version, else the brief's. */
function blocksOf(taskId: string, text: string): WorkBlock[] {
  let briefWork = null;
  try { briefWork = loadTaskBrief(taskId)?.hook?.work ?? null; } catch { /* the workspace's own version still counts */ }
  return resolveWork(briefWork, readHookWorkRecord(taskId), text)?.blocks ?? [];
}

/**
 * Folds the task `fromId` into the task `intoId`, by rule, and starts OpenClaw on making one task of the two.
 * Throws a MergeError when the two cannot be merged now (one is not open, or OpenClaw is in the middle of the
 * task being folded in).
 */
export async function mergeTasks(fromId: string, intoId: string, note: string, now = new Date()): Promise<{ record: MergeRecord; combining: boolean }> {
  if (fromId === intoId) throw new MergeError('A task cannot be merged into itself.');
  const refs = openTaskRefs();
  const from = refs.find((ref) => ref.task.id === fromId), into = refs.find((ref) => ref.task.id === intoId);
  if (!from || !into) throw new MergeError('One of these tasks is not open any more.', 404);

  // OpenClaw is in the middle of the task being folded in: its answer or its run would have nowhere to land.
  settleStaleChatTurns(now, fromId);
  if (readChatThreads(fromId).some((thread) => thread.pendingSince)) {
    throw new MergeError(`OpenClaw is still answering in a chat of ${short(from.task.text)}. Merge them when it has answered.`, 409);
  }
  const work = readTaskWorkFile();
  const workFrom = work.records[fromId], workInto = work.records[intoId];
  if (workFrom && (workFrom.status === 'working' || leaseLive(workFrom, now))) {
    throw new MergeError(`OpenClaw is working on ${short(from.task.text)} right now. Merge them when its run is over.`, 409);
  }

  // Everything is read before anything is changed.
  const fromTask = asMergeTask(from.task), intoTask = asMergeTask(into.task);
  const blocksFrom = blocksOf(fromId, from.task.text), blocksInto = blocksOf(intoId, into.task.text);
  const hookInto = readHookWorkRecord(intoId);
  const picksFrom = readTaskPicks(fromId), picksInto = readTaskPicks(intoId);
  const tabsFrom = readPastedTabs(fromId), tabsInto = readPastedTabs(intoId);
  const notes = mergedNotes(intoTask, fromTask, now);
  const projects = [...new Set([...(into.task.projects ?? []), ...(from.task.projects ?? [])])];
  const takesDate = !into.task.dueDate && !!from.task.dueDate;
  // The folded-in task's own subtasks become subtasks of the task that stays (when both are on the same list).
  const children = from.listType === into.listType ? refs.filter((ref) => ref.task.parentTaskId === fromId && ref.task.id !== intoId).map((ref) => ref.task.id) : [];

  // 1. The task that stays: both sets of notes, both sets of projects, the other's date when it had none. If it was
  //    a subtask of the one being folded in, it takes that one's place.
  await call(updateRoute, {
    taskId: intoId, listType: into.listType, notesMarkdown: notes,
    ...(projects.length > 0 ? { projects } : {}),
    ...(takesDate ? { dueDate: from.task.dueDate, ...(from.task.dueTimeStart ? { dueTimeStart: from.task.dueTimeStart } : {}), ...(from.task.dueTimeEnd ? { dueTimeEnd: from.task.dueTimeEnd } : {}) } : {}),
    ...(into.task.parentTaskId === fromId ? { parentTaskId: from.task.parentTaskId ?? '' } : {}),
  }, 'The task that stays');
  for (const child of children) await call(updateRoute, { taskId: child, listType: from.listType, parentTaskId: intoId }, 'A subtask');

  // 2. The record of the merge, before the other task leaves the lists: from here on nothing of either can be lost.
  const record: MergeRecord = {
    id: `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    at: now.toISOString(), fromId, intoId, note,
    from: { ...fromTask, listType: from.listType, ...(from.task.projects ? { projects: from.task.projects } : {}), ...(from.task.parentTaskId ? { parentTaskId: from.task.parentTaskId } : {}) },
    into: {
      ...intoTask, listType: into.listType, ...(into.task.projects ? { projects: into.task.projects } : {}),
      ...(into.task.parentTaskId ? { parentTaskId: into.task.parentTaskId } : {}), ...(into.task.parentTaskText ? { parentTaskText: into.task.parentTaskText } : {}),
    },
    notes, reparented: children, movedThreads: [], threadId: null, addedTabs: [],
    before: { hookInto: hookInto ?? null, workFrom: workFrom ?? null, workInto: workInto ?? null, picksInto },
    leftBlocks: [], workRev: null,
  };
  mutateMerges((file) => { file.records.push(record); });

  // 3. The folded-in task leaves the lists the way a task that is let go does, so it can be brought back.
  await call(letGoRoute, { taskId: fromId, listType: from.listType, reason: `Merged into ${short(into.task.text)}` }, 'The task being folded in');

  // 4. Its work: the blocks of both, in the workspace of the task that stays.
  if (blocksFrom.length > 0) {
    const { blocks, left } = mergedBlocks(blocksInto, blocksFrom);
    record.leftBlocks = left;
    let briefWork = null;
    try { briefWork = loadTaskBrief(intoId)?.hook?.work ?? null; } catch { /* the base is then unknown */ }
    record.workRev = mutateHookWorkRecords((records) => {
      records[intoId] = nextWorkRecord(records[intoId], { taskId: intoId, blocks, baseHash: briefWork ? workHash(briefWork.blocks) : null, by: 'you' }, now);
      return records[intoId]!.rev ?? null;
    });
  } else record.workRev = hookInto?.rev ?? null;

  // 5. Its chats with OpenClaw. Each keeps its own OpenClaw session; it is told the workspace again on its next
  //    turn, since the one it knew is no longer the one it is in.
  record.movedThreads = mutateChatThreads((all) => {
    const mine = (all[intoId] ??= []);
    const ids = new Set(mine.map((thread) => thread.id));
    const moved: string[] = [];
    for (const thread of all[fromId] ?? []) {
      if (thread.messages.length === 0) continue;   // a chat he opened and never wrote in
      while (ids.has(thread.id)) thread.id = `${thread.id}m`;
      ids.add(thread.id);
      thread.taskId = intoId;
      thread.mergedFrom = from.task.text;
      delete thread.workSeen;
      mine.push(thread);
      moved.push(thread.id);
    }
    delete all[fromId];
    return moved;
  });

  // 6. Its web tabs, and what was picked for its chats when the task that stays has nothing picked.
  for (const url of tabsFrom) {
    if (!tabsInto.includes(url) && changePastedTabs(intoId, 'add', url) !== null) record.addedTabs.push(url);
  }
  if ((picksInto.model === null && picksFrom.model) || (picksInto.thinking === null && picksFrom.thinking)) {
    setTaskPicks(intoId, { ...(picksInto.model === null && picksFrom.model ? { model: picksFrom.model } : {}), ...(picksInto.thinking === null && picksFrom.thinking ? { thinking: picksFrom.thinking } : {}) });
  }

  // 7. What OpenClaw was doing on it, and waiting on him for.
  if (workFrom) {
    mutateTaskWork((file) => {
      const theirs = file.records[fromId];
      if (!theirs) return;
      const mine = file.records[intoId];
      if (!mine) file.records[intoId] = theirs;
      else {
        const ids = new Set(mine.items.map((item) => item.id));
        const waiting = theirs.items.filter((item) => item.status === 'pending').map((item) => (ids.has(item.id) ? { ...item, id: `${item.id}m` } : item));
        mine.items = [...mine.items, ...waiting];
        if (waiting.length > 0 && mine.status !== 'needs-you' && mine.status !== 'working' && mine.status !== 'off' && canTransition(mine.status, 'needs-you')) {
          setTaskWorkStatus(mine, 'needs-you', `merged in what waited on him in ${short(from.task.text)}`, now);
        }
      }
      delete file.records[fromId];
      delete file.sort[fromId];
      delete file.sortFailures[fromId];
    });
  }

  // 8. OpenClaw makes one task of the two, in a chat of the merged task where it says what it did.
  let combining = false;
  if (isOpenClawCliAvailable()) {
    const thread = newChatThread(intoId, now);
    thread.title = `Merge ${short(from.task.text)} into this task`.slice(0, 120);
    thread.messages.push({ role: 'you', text: `Merge ${short(from.task.text)} into this task.${note ? `\n\n${note}` : ''}`, at: now.toISOString() });
    thread.pendingSince = now.toISOString();
    mutateChatThreads((all) => { (all[intoId] ??= []).push(thread); });
    record.threadId = thread.id;
    combining = true;
    const blocks = readBlocks(readHookWorkRecord(intoId)?.body) ?? blocksInto;
    void combine(record, thread, buildMergePrompt({ into: intoTask, from: fromTask, notes, blocks, left: record.leftBlocks, note, now }), blocks);
  }
  mutateMerges((file) => {
    const at = file.records.findIndex((kept) => kept.id === record.id);
    if (at >= 0) file.records[at] = record;
    // A chat OpenClaw began in the folded-in task still writes under that task's id: it leads here now.
    file.aliases[fromId] = intoId;
  });
  // The brief is the Journal's picture of the task: it is written again from the merged one.
  try { scheduleBriefFills({ force: intoId }); } catch { /* it is filled on the next look */ }
  return { record, combining };
}

/** The open task with this id as it is now. */
function openTask(taskId: string): { task: Task; listType: ListType } | undefined {
  return openTaskRefs().find((ref) => ref.task.id === taskId);
}

/**
 * OpenClaw's turn, after the merge has been answered: its title, notes and blocks are applied to the merged task
 * where what the rule made still stands (he may have worked in the task meanwhile, or taken the merge back), and
 * its summary is its reply in the chat. A failure leaves the task as the rule merged it.
 */
async function combine(record: MergeRecord, thread: TaskChatThread, message: string, had: WorkBlock[]): Promise<void> {
  let reply = '';
  let error: string | null = null;
  const applied: string[] = [], problems: string[] = [];
  try {
    const picks = readTaskPicks(record.intoId);
    const answer = await runOpenClawAgentTurn({ message, sessionKey: thread.sessionKey, timeoutMs: MERGE_TURN_TIMEOUT_MS, ...(picks.model ? { model: picks.model } : {}), ...(picks.thinking ? { thinking: picks.thinking } : {}) });
    const read = readMergeReply(extractJsonObject(answer), had);
    if (!read) throw new Error('the answer was not the JSON asked for');
    problems.push(...read.problems);
    const now = openTask(record.intoId);
    if (readMerge(record.id)?.undoneAt || !now) {
      reply = 'The merge was taken back before I finished, so I changed nothing.';
    } else {
      const change: Record<string, unknown> = {};
      if (read.title && read.title !== now.task.text) { change.newText = read.title; applied.push('title'); }
      if (read.notesMarkdown) {
        // Only while the notes are still the ones the merge left: what he or a run wrote since is not written over.
        if ((now.task.notesMarkdown ?? '') === record.notes) { change.notesMarkdown = read.notesMarkdown; applied.push('notes'); }
        else problems.push('the notes changed while OpenClaw was working, so they were left as they are');
      }
      if (Object.keys(change).length > 0) await call(updateRoute, { taskId: record.intoId, listType: now.listType, ...change }, 'The merged task');
      if (read.blocks) {
        if ((readHookWorkRecord(record.intoId)?.rev ?? null) === record.workRev) { if (read.blocks.length > 0 || had.length > 0) { writeWorkspaceBlocks(record.intoId, read.blocks); applied.push('work'); } }
        else problems.push('the work changed while OpenClaw was working, so it was left as it is');
      }
      const left = problems.filter((problem) => problem.includes('left as'));
      reply = [read.summary || 'I combined the two tasks.', ...(left.length > 0 ? [`Not applied: ${left.join('; ')}.`] : [])].join('\n\n');
    }
  } catch (err) {
    console.error(`task merge ${record.id}: OpenClaw could not combine the tasks:`, err);
    error = 'OpenClaw couldn’t combine them. The two are merged as they were: both sets of notes and work are in this task. Ask again here if you want them tidied.';
  }
  mutateChatThreads((all) => {
    const t = (all[record.intoId] ?? []).find((candidate) => candidate.id === thread.id);
    if (!t) return;
    const at = new Date().toISOString();
    if (t.pendingSince === thread.pendingSince) { t.pendingSince = null; t.error = error; }
    t.updatedAt = at;
    if (reply) recordChatReply(t, reply, at);
  });
  mutateMerges((file) => {
    const kept = file.records.find((candidate) => candidate.id === record.id);
    if (kept) kept.combined = error ? { at: new Date().toISOString(), error } : { at: new Date().toISOString(), applied, problems };
  });
  if (applied.length > 0) { try { scheduleBriefFills({ force: record.intoId }); } catch { /* filled on the next look */ } }
}

/**
 * Takes a merge back, soon after it was made: the folded-in task returns to its list with its chats, work and
 * what OpenClaw waited on, and the task that stayed is as it was. What was done in the merged task since
 * (anything he typed, OpenClaw's rewrite) is undone with it.
 */
export async function undoMerge(mergeId: string, now = new Date()): Promise<MergeRecord> {
  const record = readMerge(mergeId);
  if (!record) throw new MergeError('That merge is not on file.', 404);
  if (record.undoneAt) throw new MergeError('That merge was already taken back.', 409);
  if (now.getTime() - Date.parse(record.at) > UNDO_WITHIN_MS) throw new MergeError('That merge is too old to take back here. The folded-in task can still be restored from what was let go.', 409);
  mutateMerges((file) => {
    const kept = file.records.find((candidate) => candidate.id === record.id);
    if (kept) kept.undoneAt = now.toISOString();
    if (file.aliases[record.fromId] === record.intoId) delete file.aliases[record.fromId];
  });

  // The folded-in task comes back, and its subtasks return to it.
  await call(restoreRoute, { taskId: record.fromId }, 'The folded-in task');
  for (const child of record.reparented) await call(updateRoute, { taskId: child, listType: record.from.listType, parentTaskId: record.fromId }, 'A subtask');
  // The task that stayed is as it was.
  const into = openTask(record.intoId);
  if (into) {
    await call(updateRoute, {
      taskId: record.intoId, listType: into.listType,
      ...(into.task.text !== record.into.text ? { newText: record.into.text } : {}),
      notesMarkdown: record.into.notesMarkdown ?? '',
      projects: record.into.projects ?? [],
      dueDate: record.into.dueDate ?? '',
      ...(record.into.dueDate && record.into.dueTimeStart ? { dueTimeStart: record.into.dueTimeStart } : {}),
      ...(record.into.dueDate && record.into.dueTimeEnd ? { dueTimeEnd: record.into.dueTimeEnd } : {}),
      ...((into.task.parentTaskId ?? '') !== (record.into.parentTaskId ?? '') ? { parentTaskId: record.into.parentTaskId ?? '' } : {}),
    }, 'The task that stayed');
  }
  // The chats go back; the chat that asked OpenClaw to combine them goes.
  mutateChatThreads((all) => {
    const mine = all[record.intoId] ?? [];
    const back = mine.filter((thread) => record.movedThreads.includes(thread.id));
    for (const thread of back) { thread.taskId = record.fromId; delete thread.mergedFrom; delete thread.workSeen; }
    all[record.intoId] = mine.filter((thread) => !record.movedThreads.includes(thread.id) && thread.id !== record.threadId);
    if (back.length > 0) all[record.fromId] = [...(all[record.fromId] ?? []), ...back];
  });
  mutateHookWorkRecords((records) => {
    const before = record.before.hookInto as HookWorkRecord | null;
    // The version still goes up: the open page then shows the work as it was.
    if (before) records[record.intoId] = { ...before, rev: (records[record.intoId]?.rev ?? before.rev ?? 0) + 1, updatedAt: now.toISOString() };
    else delete records[record.intoId];
  });
  for (const url of record.addedTabs) changePastedTabs(record.intoId, 'remove', url);
  setTaskPicks(record.intoId, record.before.picksInto);
  mutateTaskWork((file) => {
    const theirs = record.before.workFrom as TaskWork | null, mine = record.before.workInto as TaskWork | null;
    if (theirs) file.records[record.fromId] = theirs;
    if (mine) file.records[record.intoId] = mine;
    else if (theirs) delete file.records[record.intoId];
  });
  try { scheduleBriefFills({ force: record.intoId }); } catch { /* filled on the next look */ }
  return { ...record, undoneAt: now.toISOString() };
}
