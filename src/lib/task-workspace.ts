// A task's workspace as OpenClaw reads and changes it from a chat in that workspace: the Work tab's blocks as they
// stand (his edits included), the web tabs, and the tab he is on. The chat is told all of it (workspaceBrief) and
// writes through POST /api/tasks/workspace (applyWorkspaceOp), so work done in a chat lands where he is working
// and not only in the chat or in a file of OpenClaw's own.
// Pure: no filesystem. Server only (it hashes), so the page never imports it.
import { workHash, type ResolvedWork, type WorkWriter } from '@/lib/hook-work';
import { parseBlocks, workLimits, type WorkBlock } from '@/lib/shapes/work';
import type { Surface } from '@/lib/task-surfaces';
import type { ChatSurfaceRef } from '@/lib/task-chat';

export interface WorkspaceTab { label: string; url: string; tag: string; pasted: boolean }

export interface WorkspaceView {
  taskId: string;
  title: string;                       // the task's own title
  work: {
    title: string;
    href: string | null;               // where the work gets finished or submitted
    blocks: WorkBlock[];               // what the Work tab shows now
    rev: number;
    by: WorkWriter | null;             // who wrote the workspace's version last; null while it is still the brief's start
    briefBlocks: WorkBlock[] | null;   // the brief's own newer blocks, when they differ from what the tab shows
  } | null;                            // null: nothing has been started in the Work tab
  tabs: WorkspaceTab[];                // the web pages of the workspace
}

export function workspaceView(input: { taskId: string; title: string; work: ResolvedWork | null; surfaces: Surface[] }): WorkspaceView {
  const { work } = input;
  return {
    taskId: input.taskId,
    title: input.title,
    work: work && work.blocks.length > 0
      ? { title: work.title, href: work.href, blocks: work.blocks, rev: work.rev, by: work.by, briefBlocks: work.newer }
      : null,
    tabs: input.surfaces.flatMap((s) => (s.kind === 'web' ? [{ label: s.label, url: s.url, tag: s.tag, pasted: s.pasted === true }] : [])),
  };
}

/** One value that changes whenever what the workspace holds changes: the blocks on show and the tabs. */
export function workspaceSignature(view: WorkspaceView): string {
  return workHash(JSON.stringify([view.work?.blocks ?? null, view.tabs.map((tab) => tab.url)]));
}

/** What the page checks every few seconds to know the workspace was written elsewhere: small on purpose. */
export interface WorkspacePeek { rev: number; tabs: string }

// ---- What a chat is told.

export const WORKSPACE_MARK = '[Workspace of this task';

const api = 'http://127.0.0.1:3000/api/tasks/workspace';

/** How the workspace works and how to read and change it. Said once per chat. */
function workspaceRules(taskId: string): string[] {
  const { blocks, body, text } = workLimits;
  const file = `/tmp/workspace-${taskId.slice(0, 8)}.json`;
  return [
    'You are in the chat of this task’s workspace in the Journal. He sees the workspace beside this chat: a Work tab (blocks he works in: a doc, a checklist, a letter, slides and so on) and one tab per web page of the task, shown in your browser.',
    'The Work tab is where the work for this task lives, and you and he work in the same copy. When he asks you to write, draft, fill in, fix or continue something that is in the Work tab or belongs there (the slides, the outline, the letter, the answers), put it INTO the Work tab, then say in a line or two what you changed. Never leave the work only in this chat, and never only in a file of your own. He sees your change within a few seconds, without reloading. This needs no asking: it is what he asks for when he asks for the work.',
    'A draft to react to may be shown in the chat first when he asks for options or a proposal; once he says go ahead, it goes into the Work tab.',
    'Read the workspace as it stands (his latest edits included) before you change it:',
    `curl -s '${api}?id=${taskId}'`,
    'Change it by writing the JSON body to a file and posting the file, so quotes survive the shell:',
    `curl -s -X POST ${api} -H 'Content-Type: application/json' --data-binary @${file}`,
    `{"taskId":"${taskId}","action":"block","block":{...}}          replace the block that has this id, or add it when none has`,
    `{"taskId":"${taskId}","action":"write","blocks":[...]}          replace all the blocks, in this order`,
    `{"taskId":"${taskId}","action":"remove-block","id":"<block id>"}`,
    `{"taskId":"${taskId}","action":"open-tab","url":"https://..."}  add a web page as a tab of the workspace`,
    `{"taskId":"${taskId}","action":"close-tab","url":"https://..."} take off a tab that was added (the task’s own links stay)`,
    'The answer is the workspace after the change; "problems" names anything that was dropped or cut, so read it. Keep what he wrote unless he asks you to change it: change the block you are working on ("block") rather than rewriting all of them, and keep a block’s id when you change it.',
    `Blocks, each {"kind":"...","id":"<short stable name>",...}, at most ${blocks}: doc (label?, body: markdown, at most ${body} characters) · checklist (label?, body: "- [ ]" / "- [x]" lines) · letter (to, subject, body) · problem (label?, prompt, given?, work) · fields (label?, items: [{label, value, needs?, hint?}]) · choices (prompt, options: [{title, detail?, points?}], picked?) · slides (items: [{title, body?, notes?}], at: the slide to show) · timer (label, seconds, steps?) · reading (title, by?, href?, excerpt?). A slide’s body and notes, a problem’s prompt and a field’s value hold at most ${text} characters each. No bracketed fill-in slots like [Insert quote]: write the real thing or leave the line open.`,
    'When the task also needs a file (a PDF to upload, a document), the Work tab holds what the file is made from and is changed first; then make the file from it, and give its full path in your answer and in the task’s Progress.',
  ];
}

const who = (by: WorkWriter | null) => (by === 'openclaw' ? 'last written by you, from a chat' : by === 'you' ? 'last written by him' : 'still as the brief started it');

/** The workspace as it stands, in words and JSON. */
function workspaceState(view: WorkspaceView, on: ChatSurfaceRef | null): string[] {
  const lines: string[] = [];
  if (on?.kind === 'web' && on.url) lines.push(`He is on the tab of this page, open in your browser: ${on.label && on.label !== on.url ? `"${on.label}" ` : ''}${on.url} . When he says "this page", he means that tab: use your browser tool on it.`);
  else if (view.work) lines.push(`He is on the Work tab ("${view.work.title}"). When he says "this", "the slides", "the doc" or "the draft", he means what is in it.`);
  else lines.push('He is on the Work tab, and nothing has been started in it yet. A "write" starts it.');
  if (view.tabs.length > 0) lines.push('Web tabs:', ...view.tabs.map((tab) => `- ${tab.label}: ${tab.url}${tab.pasted ? ' (added)' : ''}`));
  if (view.work) {
    lines.push(`Work tab blocks now (version ${view.work.rev}, ${who(view.work.by)}):`, JSON.stringify(view.work.blocks));
    if (view.work.briefBlocks) lines.push('The task’s brief was filled again since and holds a different version of these blocks; he has not taken it. The Work tab above is the one that counts.');
  }
  return lines;
}

/**
 * What goes in front of a chat turn about the workspace. `tell` is how much: 'rules' the first time a chat hears
 * of the workspace (how it works, then how it stands), 'state' when it has changed since the chat's last turn,
 * 'where' when nothing changed (only the tab he is on, when that is a web page).
 */
export function workspaceBrief(view: WorkspaceView, tell: 'rules' | 'state' | 'where', on: ChatSurfaceRef | null): string {
  if (tell === 'where') {
    if (on?.kind !== 'web' || !on.url) return '';
    return `${WORKSPACE_MARK}: nothing in it changed since your last turn. ${workspaceState({ ...view, work: null, tabs: [] }, on)[0]}]`;
  }
  const head = tell === 'rules' ? `${WORKSPACE_MARK}, in the Journal.` : `${WORKSPACE_MARK}: it changed since your last turn (he worked in it, or its tabs changed). As it stands now:`;
  return [head, ...(tell === 'rules' ? workspaceRules(view.taskId) : []), ...workspaceState(view, on)].join('\n') + ']';
}

// ---- What a chat may change.

export type WorkspaceOp =
  | { action: 'write'; blocks: unknown }
  | { action: 'block'; block: unknown }
  | { action: 'remove-block'; id: string };

/**
 * The Work tab's blocks after OpenClaw's change, read as carefully as any blocks (parseBlocks): what could not be
 * kept is named in `problems`. An error when the change would leave nothing it asked for.
 */
export function applyWorkspaceOp(current: WorkBlock[], op: WorkspaceOp): { blocks: WorkBlock[]; problems: string[] } | { error: string; problems: string[] } {
  if (op.action === 'remove-block') {
    if (!current.some((block) => block.id === op.id)) return { error: `No block has the id ${JSON.stringify(op.id)}. The blocks are: ${current.map((b) => b.id).join(', ') || 'none'}.`, problems: [] };
    return { blocks: current.filter((block) => block.id !== op.id), problems: [] };
  }
  if (op.action === 'write') {
    if (!Array.isArray(op.blocks)) return { error: '"blocks" must be a list of blocks.', problems: [] };
    const read = parseBlocks(op.blocks);
    if (read.blocks.length === 0) return { error: 'None of the blocks could be kept.', problems: read.problems };
    return read;
  }
  const one = parseBlocks([op.block]);
  const block = one.blocks[0];
  if (!block) return { error: 'The block could not be kept.', problems: one.problems };
  const at = current.findIndex((have) => have.id === block.id);
  const next = at >= 0 ? current.map((have, index) => (index === at ? block : have)) : [...current, block];
  // The whole list is read again: the limits on how many blocks and how much text hold for the result.
  const all = parseBlocks(next);
  if (!all.blocks.some((have) => have.id === block.id)) return { error: 'The block does not fit: the Work tab is full.', problems: [...one.problems, ...all.problems] };
  return { blocks: all.blocks, problems: [...one.problems, ...all.problems.filter((p) => !one.problems.includes(p))] };
}
