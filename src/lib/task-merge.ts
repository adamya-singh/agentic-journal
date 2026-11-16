// Two tasks made one. He drags a task onto another in Sunrise and says yes: the task dropped on stays, and the one
// he carried is folded into it (its notes, its work, its chats with OpenClaw, its web tabs, what OpenClaw was
// waiting on him for), then leaves his lists. The Journal does that part by rule, at once, so nothing is lost
// whatever happens next. OpenClaw is then asked to make one task of the two (one title, one set of notes, one set
// of blocks) and says what it did in a chat in the merged task.
// Pure: no filesystem. The moving is the route's (app/api/tasks/merge).
import { parseBlocks, workLimits, type WorkBlock } from '@/lib/shapes/work';
import { PROGRESS_HEADING } from '@/lib/task-progress';

export const MERGE_NOTE_MAX = 2000;
export const MERGE_TITLE_MAX = 200;
const NOTES_MAX = 20000;                 // the task update route's own limit
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What a merge reads of a task. */
export interface MergeTask { id: string; text: string; notesMarkdown?: string; dueDate?: string; dueTimeStart?: string; dueTimeEnd?: string }

/** The notes apart from their "## Progress" section, and that section's lines (without its heading). */
export function splitProgress(notes: string | undefined): { body: string; progress: string[] } {
  const lines = (notes ?? '').replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex((line) => line.trim().toLowerCase() === PROGRESS_HEADING.toLowerCase());
  if (start < 0) return { body: lines.join('\n').trim(), progress: [] };
  const after = lines.findIndex((line, index) => index > start && /^#{1,2}\s/.test(line));
  const end = after < 0 ? lines.length : after;
  return {
    body: [...lines.slice(0, start), ...lines.slice(end)].join('\n').replace(/\n{3,}/g, '\n\n').trim(),
    progress: lines.slice(start + 1, end).filter((line) => line.trim() !== ''),
  };
}

const quoted = (text: string) => `“${text.replace(/\s+/g, ' ').trim().replace(/[.…]+$/, '')}”`;
const dueWords = (task: MergeTask) => (task.dueDate ? `${task.dueDate}${task.dueTimeStart ? ` ${task.dueTimeStart}${task.dueTimeEnd ? `–${task.dueTimeEnd}` : ''}` : ''}` : '');

/**
 * The notes of the task that stays with the other's folded in, by rule: its own notes, then the other task's under
 * "## Merged in: …" (with when, and the date it was due), then one "## Progress" section holding both logs, the
 * other's lines marked with where they came from. Nothing is reworded. If the result would pass the notes' limit
 * the folded-in notes are cut (the merge keeps the whole of both apart).
 */
export function mergedNotes(into: MergeTask, from: MergeTask, now: Date): string {
  const mine = splitProgress(into.notesMarkdown), theirs = splitProgress(from.notesMarkdown);
  const due = dueWords(from);
  const head = `## Merged in: ${from.text.replace(/\s+/g, ' ').trim()}\nMerged ${MONTHS[now.getMonth()]} ${now.getDate()}${due ? ` · it was due ${due}` : ''}.`;
  // The other task's Next and Waiting on are not this task's: they are kept as plain log lines.
  const theirLog = theirs.progress.map((line) => {
    const fact = /^- \*\*(Next|Waiting on):\*\*\s*(.*)$/i.exec(line.trim());
    const said = fact ? `- ${fact[1]} was: ${fact[2]}` : line.trim().startsWith('- ') ? line.trim() : `- ${line.trim()}`;
    return `${said} (from ${quoted(from.text)})`;
  });
  const progress = [...mine.progress, ...theirLog];
  const build = (theirBody: string) => [mine.body, [head, theirBody].filter(Boolean).join('\n\n'), progress.length > 0 ? [PROGRESS_HEADING, ...progress].join('\n') : '']
    .filter(Boolean).join('\n\n');
  const whole = build(theirs.body);
  if (whole.length <= NOTES_MAX) return whole;
  const cut = '\n\n… (cut here: the whole of these notes is kept with the merge)';
  const room = Math.max(0, theirs.body.length - (whole.length - NOTES_MAX) - cut.length);
  return build(theirs.body.slice(0, room) + cut).slice(0, NOTES_MAX);
}

/**
 * The work blocks of the task that stays, then the other's, as one workspace. A block of the other task whose id
 * is already taken gets a new one. `left` is what does not fit a workspace (at most six blocks, and its size limit):
 * those are kept with the merge and shown to OpenClaw, which may fold them into the others.
 */
export function mergedBlocks(into: WorkBlock[], from: WorkBlock[]): { blocks: WorkBlock[]; left: WorkBlock[] } {
  const taken = new Set(into.map((block) => block.id));
  const theirs = from.map((block) => {
    let id = block.id;
    for (let n = 2; taken.has(id); n++) id = `${block.id.slice(0, 36)}-${n}`;
    taken.add(id);
    return id === block.id ? block : { ...block, id };
  });
  const all = [...into, ...theirs];
  const kept = parseBlocks(all).blocks;
  const ids = new Set(kept.map((block) => block.id));
  return { blocks: kept, left: all.filter((block) => !ids.has(block.id)) };
}

// ---- What OpenClaw is asked, and what it may answer.

export interface MergePromptInput {
  into: MergeTask;
  from: MergeTask;
  /** The notes of the merged task as the Journal's rule left them. */
  notes: string;
  blocks: WorkBlock[];
  left: WorkBlock[];
  note: string;
  now: Date;
}

/** The one message that asks OpenClaw to make one task of two. It reads only what is in the message. */
export function buildMergePrompt(input: MergePromptInput): string {
  const { into, from } = input;
  const task = (label: string, t: MergeTask) => [
    `${label} (id ${t.id}):`,
    `Title: ${t.text}`,
    `Due: ${dueWords(t) || 'no date'}`,
    'Notes:',
    t.notesMarkdown?.trim() || '(none)',
  ].join('\n');
  return [
    '[Journal: make one task of two. Adamya dragged one task onto another on his home page and said yes to merging them.]',
    `Today is ${input.now.toISOString().slice(0, 10)}.`,
    '',
    task('THE TASK THAT STAYS', into),
    '',
    task('THE TASK FOLDED INTO IT (it has left his lists)', from),
    '',
    'The Journal has already moved everything by rule, so nothing is lost: both tasks’ chats with you, their web tabs and what you were waiting on him for are in the task that stays; its notes are now the two sets one after the other; its workspace holds both tasks’ blocks.',
    'The notes as they stand now:',
    input.notes || '(none)',
    '',
    `The workspace’s blocks as they stand now (${input.blocks.length}):`,
    JSON.stringify(input.blocks),
    ...(input.left.length > 0 ? ['Blocks of the folded-in task that did not fit the workspace (it holds at most six) and are not in it now:', JSON.stringify(input.left)] : []),
    '',
    input.note ? `His note to you about this merge: ${input.note}` : 'He left no note about this merge.',
    '',
    'Your part: make ONE task of the two. Answer with:',
    `- "title": one line that names the combined task, at most ${MERGE_TITLE_MAX} characters. Keep the staying task’s title when it already covers both.`,
    `- "notesMarkdown": one set of notes made from both. Every fact, link, date, name, amount, id and decision from either task stays, said once; what both said is not repeated. Keep one "${PROGRESS_HEADING}" section last, with one "- **Next:**" line and one "- **Waiting on:**" line when there is something to say, then every dated line of both tasks in date order. Do not summarise details away and do not add anything that is in neither. At most 18000 characters.`,
    `- "blocks": at most ${workLimits.blocks} blocks for the merged workspace, made from the blocks above and in the shapes they have there. Combine blocks that are the same thing (two checklists become one, with every item and its tick kept); keep the rest. A "file" block is kept exactly as it is (its id, path and notes). Leave out nothing he wrote. An empty list only when there were no blocks.`,
    '- "summary": two to four plain sentences to him: what you combined, what the two had in common and is now said once, and anything he should look at or decide.',
    'Use no tools and change nothing anywhere: the Journal applies your answer and shows your summary in this chat.',
    'Reply with ONLY one JSON object, no prose, no code fence: {"title":"…","notesMarkdown":"…","blocks":[…],"summary":"…"}',
  ].join('\n');
}

export interface MergeReply {
  title: string | null;
  notesMarkdown: string | null;
  blocks: WorkBlock[] | null;
  summary: string;
  problems: string[];
}

/**
 * OpenClaw's answer, read carefully: each part that cannot be used is left out (the task keeps what the rule
 * made) and named in `problems`. The blocks are read like any blocks, and a file the workspace had is never lost:
 * one OpenClaw left out is put back. Null when the answer is not the object asked for.
 */
export function readMergeReply(raw: unknown, had: WorkBlock[]): MergeReply | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const problems: string[] = [];
  const title = typeof r.title === 'string' && r.title.replace(/\s+/g, ' ').trim() ? r.title.replace(/\s+/g, ' ').trim().slice(0, MERGE_TITLE_MAX) : null;
  if (title === null) problems.push('no title was given');
  let notesMarkdown: string | null = null;
  if (typeof r.notesMarkdown === 'string' && r.notesMarkdown.trim()) {
    if (r.notesMarkdown.length > NOTES_MAX) problems.push('the notes were over the limit');
    else notesMarkdown = r.notesMarkdown.replace(/\r\n/g, '\n').trim();
  } else problems.push('no notes were given');
  let blocks: WorkBlock[] | null = null;
  if (Array.isArray(r.blocks)) {
    const files = had.filter((block) => block.kind === 'file');
    const read = parseBlocks(r.blocks);
    const paths = new Set(read.blocks.flatMap((block) => (block.kind === 'file' ? [block.path] : [])));
    const missing = files.filter((file) => file.kind === 'file' && !paths.has(file.path));
    const whole = parseBlocks([...missing, ...read.blocks]);
    problems.push(...read.problems, ...whole.problems.filter((problem) => !read.problems.includes(problem)));
    if (missing.length > 0) problems.push(`${missing.length} file block${missing.length === 1 ? ' was' : 's were'} put back`);
    // Blocks that came back empty when there were some are not an answer: the workspace keeps what it has.
    if (whole.blocks.length > 0 || had.length === 0) blocks = whole.blocks;
    else problems.push('no blocks could be kept');
  } else problems.push('no blocks were given');
  const summary = typeof r.summary === 'string' ? r.summary.trim().slice(0, 2000) : '';
  return { title, notesMarkdown, blocks, summary, problems };
}

/** What happened to a merge, kept so it can be taken back and so nothing of either task is lost. */
export interface MergeRecord {
  id: string;
  at: string;
  fromId: string;
  intoId: string;
  note: string;
  /** Both tasks as they were. */
  from: MergeTask & { listType: string; projects?: string[]; parentTaskId?: string };
  into: MergeTask & { listType: string; projects?: string[]; parentTaskId?: string; parentTaskText?: string };
  /** The merged task's notes as the rule made them: OpenClaw's are applied only while these still stand. */
  notes: string;
  /** Subtasks of the folded-in task that were moved under the task that stays. */
  reparented: string[];
  /** Chats moved from the folded-in task. */
  movedThreads: string[];
  /** The chat in which OpenClaw is asked to combine them; null when it could not be asked. */
  threadId: string | null;
  addedTabs: string[];
  /** The stores as they were, for taking the merge back: each null when the task had no record. */
  before: {
    hookInto: unknown; workFrom: unknown; workInto: unknown;
    picksInto: { model: string | null; thinking: string | null };
  };
  /** Blocks of the folded-in task that did not fit the merged workspace. */
  leftBlocks: WorkBlock[];
  /** The version of the merged workspace the rule wrote: OpenClaw's blocks are applied only while it still stands. */
  workRev: number | null;
  undoneAt?: string;
  combined?: { at: string; applied: string[]; problems: string[] } | { at: string; error: string };
}
