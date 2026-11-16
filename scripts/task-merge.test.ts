// Two tasks made one: the rules that fold one task's notes and work into another's, what OpenClaw is asked and
// how its answer is read, and the route that moves everything a task holds, has OpenClaw combine them, and takes
// a merge back.
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import type { WorkBlock } from '../src/lib/shapes/work';
import { buildMergePrompt, mergedBlocks, mergedNotes, readMergeReply, splitProgress } from '../src/lib/task-merge';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-journal-merge-'));
const backend = path.join(root, 'backend');
const tasksDir = path.join(backend, 'tasks');
const log = path.join(root, 'calls.jsonl');
process.env.BACKEND_DATA_DIR = backend;
process.env.BRIEF_AGENT_DISABLED = '1';
process.env.TASK_WORKER_DISABLED = '1';
// A stand-in for OpenClaw: asked to make one task of two, it answers with the JSON in answer.json.
const stub = path.join(root, 'openclaw-stub.js');
fs.writeFileSync(stub, `
  const fs = require('fs'), path = require('path');
  const args = process.argv.slice(2);
  if (args[0] !== 'agent') process.exit(1);
  const message = args[args.indexOf('--message') + 1];
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ key: args[args.indexOf('--session-key') + 1], message }) + '\\n');
  const answer = fs.readFileSync(path.join(${JSON.stringify(root)}, 'answer.json'), 'utf8');
  process.stdout.write(JSON.stringify({ status: 'ok', result: { payloads: [{ text: answer }] } }));
`);
process.env.OPENCLAW_CLI_PATH = stub;

const now = new Date(2026, 10, 15, 12, 0);
const UPLOAD = { id: 'a', text: 'Upload slides PDF to Canvas.', dueDate: '2026-11-14', notesMarkdown: 'Part 1 is the PDF.\n- **Canvas:** [Part 1](https://canvas.example.edu/a/1)\n\n## Progress\n- **Next:** Upload the PDF\n- Nov 14: built the deck\n\n## Rubric\n4 slides.' };
const PRESENT = { id: 'b', text: 'Give the Three Lenses presentation', notesMarkdown: 'Slot 6, MU-204.\n\n## Progress\n- **Waiting on:** the room\n- Nov 13: signed up for slot 6' };

test('the notes of the task that stays get the other’s under their own heading, and one Progress log', () => {
  assert.deepEqual(splitProgress(UPLOAD.notesMarkdown), {
    body: 'Part 1 is the PDF.\n- **Canvas:** [Part 1](https://canvas.example.edu/a/1)\n\n## Rubric\n4 slides.',
    progress: ['- **Next:** Upload the PDF', '- Nov 14: built the deck'],
  });
  assert.deepEqual(splitProgress(undefined), { body: '', progress: [] });
  const merged = mergedNotes(PRESENT, UPLOAD, now);
  assert.equal(merged, [
    'Slot 6, MU-204.',
    '## Merged in: Upload slides PDF to Canvas.\nMerged Nov 15 · it was due 2026-11-14.',
    'Part 1 is the PDF.\n- **Canvas:** [Part 1](https://canvas.example.edu/a/1)\n\n## Rubric\n4 slides.',
    '## Progress\n- **Waiting on:** the room\n- Nov 13: signed up for slot 6\n- Next was: Upload the PDF (from “Upload slides PDF to Canvas”)\n- Nov 14: built the deck (from “Upload slides PDF to Canvas”)',
  ].join('\n\n'));
  // The merged notes still read as one Progress section, last.
  assert.equal(splitProgress(merged).progress.length, 4);
  // Neither has notes: only the heading that says what was merged in.
  assert.equal(mergedNotes({ id: 'b', text: 'B' }, { id: 'a', text: 'A' }, now), '## Merged in: A\nMerged Nov 15.');
  // Too long for a task's notes: the folded-in notes are cut, the staying task's are not.
  const long = mergedNotes({ id: 'b', text: 'B', notesMarkdown: 'mine' }, { id: 'a', text: 'A', notesMarkdown: 'x'.repeat(30000) }, now);
  assert.equal(long.length <= 20000 && long.startsWith('mine\n\n## Merged in: A') && long.includes('cut here'), true);
});

test('both tasks’ blocks become one workspace; what does not fit is kept apart', () => {
  const mine: WorkBlock[] = [{ kind: 'doc', id: 'notes', body: 'Mine' }, { kind: 'checklist', id: 'checks', body: '- [x] Signed up' }];
  const theirs: WorkBlock[] = [{ kind: 'checklist', id: 'checks', body: '- [ ] Upload' }, { kind: 'file', id: 'deck', path: 'deck/Talk.pdf', notes: ['Hello'] }];
  const both = mergedBlocks(mine, theirs);
  assert.deepEqual(both.blocks.map((b) => [b.kind, b.id]), [['doc', 'notes'], ['checklist', 'checks'], ['checklist', 'checks-2'], ['file', 'deck']]);
  assert.deepEqual(both.left, []);
  const many = mergedBlocks(Array.from({ length: 5 }, (_, i): WorkBlock => ({ kind: 'doc', id: `d${i}`, body: 'x' })), theirs);
  assert.deepEqual([many.blocks.length, many.left.map((b) => b.id)], [6, ['deck']]);
  assert.deepEqual(mergedBlocks([], []), { blocks: [], left: [] });
});

test('OpenClaw is told both tasks and his note, and its answer is read part by part', () => {
  const blocks: WorkBlock[] = [{ kind: 'checklist', id: 'checks', body: '- [x] Signed up' }, { kind: 'file', id: 'deck', path: 'deck/Talk.pdf', notes: ['Hello'] }];
  const prompt = buildMergePrompt({ into: PRESENT, from: UPLOAD, notes: mergedNotes(PRESENT, UPLOAD, now), blocks, left: [], note: 'Keep the upload’s date.', now });
  for (const part of ['THE TASK THAT STAYS (id b)', 'THE TASK FOLDED INTO IT', 'Due: 2026-11-14', 'His note to you about this merge: Keep the upload’s date.', '"path":"deck/Talk.pdf"', 'Use no tools', 'Reply with ONLY one JSON object']) {
    assert.equal(prompt.includes(part), true, part);
  }
  assert.match(buildMergePrompt({ into: PRESENT, from: UPLOAD, notes: '', blocks: [], left: blocks, note: '', now }), /did not fit the workspace[\s\S]*He left no note/);

  const good = readMergeReply({ title: '  Present Three Lenses\nand upload the deck ', notesMarkdown: 'One.\r\n\r\n## Progress\n- Nov 13: x', blocks: [{ kind: 'checklist', id: 'checks', body: '- [x] Signed up\n- [ ] Upload' }], summary: ' Combined. ' }, blocks)!;
  assert.equal(good.title, 'Present Three Lenses and upload the deck');
  assert.equal(good.notesMarkdown, 'One.\n\n## Progress\n- Nov 13: x');
  // The file OpenClaw left out is put back, in front.
  assert.deepEqual(good.blocks!.map((b) => b.id), ['deck', 'checks']);
  assert.equal(good.summary, 'Combined.');
  assert.match(good.problems.join(' | '), /1 file block was put back/);
  // Parts that cannot be used are left out one by one; nothing usable is not an answer.
  const poor = readMergeReply({ title: '', notesMarkdown: 'x'.repeat(20001), blocks: [{ kind: 'nonsense' }], summary: 7 }, [{ kind: 'doc', id: 'n', body: 'Mine' }])!;
  assert.deepEqual([poor.title, poor.notesMarkdown, poor.blocks, poor.summary], [null, null, null, '']);
  assert.equal(poor.problems.length >= 4, true);
  assert.deepEqual(readMergeReply({ title: 'T', notesMarkdown: 'N', blocks: [], summary: 'S' }, [])!.blocks, []);
  assert.deepEqual([readMergeReply(null, []), readMergeReply('text', []), readMergeReply([], [])], [null, null, null]);
});

// ---- The route, on a data folder of its own.

type Routes = { merge: typeof import('../src/app/api/tasks/merge/route'); workspace: typeof import('../src/app/api/tasks/workspace/route'); progress: typeof import('../src/app/api/tasks/progress/route') };
let routes: Routes;
let chats: typeof import('../src/app/api/tasks/brief-chat/store');
before(async () => {
  routes = {
    merge: await import('../src/app/api/tasks/merge/route'),
    workspace: await import('../src/app/api/tasks/workspace/route'),
    progress: await import('../src/app/api/tasks/progress/route'),
  };
  chats = await import('../src/app/api/tasks/brief-chat/store');
});
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(tasksDir, name), 'utf8'));
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(tasksDir, name), JSON.stringify(value));
const tasks = (): Record<string, { id: string; text: string; notesMarkdown?: string; dueDate?: string; parentTaskId?: string; projects?: string[] }> =>
  Object.fromEntries(read('have-to-do.json').tasks.map((t: { id: string }) => [t.id, t]));
const post = (route: { POST: (request: NextRequest) => Promise<Response> }, body: unknown) =>
  route.POST(new NextRequest('http://127.0.0.1/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
const thread = (id: string, taskId: string, extra: Record<string, unknown> = {}) => ({
  id, taskId, title: `Chat ${id}`, sessionKey: `agent:main:journal-chat-${taskId}-${id}`, pendingSince: null, error: null,
  messages: [{ role: 'you', text: 'Build the deck', at: '2026-11-14T15:00:00.000Z' }, { role: 'openclaw', text: 'Built.', at: '2026-11-14T15:01:00.000Z' }],
  createdAt: '2026-11-14T15:00:00.000Z', updatedAt: '2026-11-14T15:01:00.000Z', seenAt: '2026-11-14T15:02:00.000Z', touchedAt: '2026-11-14T15:00:00.000Z', about: null, workSeen: 'abc', ...extra,
});
const hook = (taskId: string, blocks: WorkBlock[]) => ({ taskId, body: JSON.stringify(blocks), baseHash: null, rev: 1, by: 'you', startedAt: '2026-11-14T15:00:00.000Z', updatedAt: '2026-11-14T15:00:00.000Z' });

function seed(): void {
  fs.rmSync(backend, { recursive: true, force: true });
  fs.rmSync(log, { force: true });
  fs.mkdirSync(tasksDir, { recursive: true });
  write('have-to-do.json', { _comment: '', tasks: [
    { ...UPLOAD, projects: ['data-context'] },
    { ...PRESENT, projects: ['rutgers'] },
    { id: 'a1', text: 'Export the deck to PDF', parentTaskId: 'a' },
    { id: 'lift', text: 'Lift', isDaily: true },
  ] });
  write('want-to-do.json', { _comment: '', tasks: [{ id: 'gym', text: 'Find a climbing gym' }] });
  write('brief-chats.json', { _comment: '', schemaVersion: 2, threads: { a: [thread('t1', 'a'), thread('empty', 'a', { messages: [] })], b: [thread('t1', 'b', { title: 'About the room' })] } });
  write('hook-work.json', { _comment: '', schemaVersion: 1, records: {
    a: hook('a', [{ kind: 'checklist', id: 'checks', body: '- [x] Exported\n- [ ] Uploaded' }, { kind: 'file', id: 'deck', path: 'deck/Talk.pdf', notes: ['Open with the question.'] }]),
    b: hook('b', [{ kind: 'checklist', id: 'checks', body: '- [x] Signed up' }]),
  } });
  write('workspace-tabs.json', { _comment: '', schemaVersion: 1, tabs: { a: ['https://canvas.example.edu/a/1'], b: ['https://example.org/rubric'] } });
  write('chat-models.json', { _comment: '', schemaVersion: 2, models: { a: 'google-vertex/gemini-4-argon' }, thinking: { a: 'low' } });
  write('task-work.json', { _comment: '', version: 1, meta: {}, sort: { a: { verdict: 'x' } }, sortFailures: {}, records: {
    a: { status: 'needs-you', reason: 'handed', grant: 'act-with-approval', failures: 0, updatedAt: '2026-11-14T15:00:00.000Z', history: [],
      items: [{ id: 'q1', kind: 'question', text: 'Upload it for you?', status: 'pending', createdAt: '2026-11-14T15:00:00.000Z' }, { id: 'q0', kind: 'question', text: 'Old', status: 'answered', answer: 'yes', createdAt: '2026-11-13T15:00:00.000Z' }] },
    b: { status: 'waiting', reason: 'handed', grant: 'act-with-approval', failures: 0, updatedAt: '2026-11-14T15:00:00.000Z', history: [], waiting: { on: 'the room', since: '2026-11-13T15:00:00.000Z', checkAfter: '2026-11-17T15:00:00.000Z', checks: 0 },
      items: [{ id: 'q1', kind: 'question', text: 'Which slot?', status: 'answered', answer: '6', createdAt: '2026-11-13T15:00:00.000Z' }] },
  } });
  fs.writeFileSync(path.join(root, 'answer.json'), JSON.stringify({
    title: 'Present Three Lenses and upload the deck',
    notesMarkdown: 'Slot 6, MU-204. Part 1 is the PDF: [Part 1](https://canvas.example.edu/a/1). Rubric: 4 slides.\n\n## Progress\n- **Next:** Upload the PDF\n- **Waiting on:** the room\n- Nov 13: signed up for slot 6\n- Nov 14: built the deck',
    blocks: [{ kind: 'checklist', id: 'checks', label: 'To do', body: '- [x] Signed up\n- [x] Exported\n- [ ] Uploaded' }],
    summary: 'I made one task of the two: one checklist, one set of notes. The upload was due Nov 14.',
  }));
}
const settled = async (taskId: string, threadId: string) => {
  for (let i = 0; i < 200; i++) {
    const t = chats.readChatThreads(taskId).find((x) => x.id === threadId);
    if (t && !t.pendingSince) return t;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('OpenClaw’s turn never settled');
};

test('merging folds everything one task holds into the other, OpenClaw combines them, and it can all be taken back', async () => {
  seed();
  const beforeTasks = tasks();
  // What cannot be merged.
  assert.equal((await post(routes.merge, { fromId: 'a', intoId: 'a' })).status, 400);
  assert.equal((await post(routes.merge, { fromId: 'a', intoId: 'nope' })).status, 404);
  assert.equal((await post(routes.merge, { fromId: 'lift', intoId: 'b' })).status, 404);     // a daily is not a task to merge
  assert.equal((await post(routes.merge, { fromId: 'a' })).status, 400);
  assert.deepEqual(tasks(), beforeTasks);

  const made = await (await post(routes.merge, { fromId: 'a', intoId: 'b', note: '  Keep the upload’s date in the notes.  ' })).json();
  assert.equal(made.success, true, JSON.stringify(made));
  assert.deepEqual([made.data.intoId, made.data.combining], ['b', true]);

  // The task that stays, by rule; the other has left the list and is kept with what was let go; its subtask moved.
  let now = tasks();
  assert.equal(now.a, undefined);
  assert.match(now.b!.notesMarkdown!, /^Slot 6, MU-204\.\n\n## Merged in: Upload slides PDF to Canvas\.\nMerged \w+ \d+ · it was due 2026-11-14\./);
  assert.deepEqual([now.b!.dueDate, now.b!.projects, now.a1!.parentTaskId], ['2026-11-14', ['data-context', 'rutgers'], 'b']);
  const gone = read('let-go.json').records.find((r: { id: string }) => r.id === 'a');
  assert.deepEqual([gone.task.text, gone.reason, gone.subtasks.length], [UPLOAD.text, 'Merged into “Give the Three Lenses presentation”', 0]);

  // Its chats moved, each still its own OpenClaw session, and told the workspace again next time; the empty one is dropped.
  const threads = read('brief-chats.json').threads;
  assert.equal(threads.a, undefined);
  assert.deepEqual(threads.b.slice(0, 2).map((t: { id: string; taskId: string; title: string; sessionKey: string; mergedFrom?: string; workSeen?: string }) => [t.id, t.taskId, t.title, t.sessionKey, t.mergedFrom, t.workSeen]), [
    ['t1', 'b', 'About the room', 'agent:main:journal-chat-b-t1', undefined, 'abc'],
    ['t1m', 'b', 'Chat t1', 'agent:main:journal-chat-a-t1', UPLOAD.text, undefined],
  ]);
  const asked = threads.b[2];
  assert.deepEqual([asked.title, asked.messages[0].text], ['Merge “Upload slides PDF to Canvas” into this task', 'Merge “Upload slides PDF to Canvas” into this task.\n\nKeep the upload’s date in the notes.']);

  // Its tabs, what was picked for its chats, and what OpenClaw waited on him for.
  assert.deepEqual(read('workspace-tabs.json').tabs.b, ['https://example.org/rubric', 'https://canvas.example.edu/a/1']);
  assert.deepEqual([read('chat-models.json').models.b, read('chat-models.json').thinking.b], ['google-vertex/gemini-4-argon', 'low']);
  const work = read('task-work.json');
  assert.equal(work.records.a, undefined);
  assert.equal(work.sort.a, undefined);
  assert.deepEqual([work.records.b.status, work.records.b.items.map((i: { id: string; text: string }) => [i.id, i.text])], ['needs-you', [['q1', 'Which slot?'], ['q1m', 'Upload it for you?']]]);

  // OpenClaw's turn: it was told both tasks and his note, in the new chat's own session, and its answer is applied.
  const done = await settled('b', asked.id);
  const call = JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n')[0]!);
  assert.equal(call.key, asked.sessionKey);
  assert.match(call.message, /His note to you about this merge: Keep the upload’s date in the notes\./);
  assert.match(call.message, /"id":"checks-2"/);
  assert.deepEqual([done.error, done.messages.at(-1)!.role, done.messages.at(-1)!.text], [null, 'openclaw', 'I made one task of the two: one checklist, one set of notes. The upload was due Nov 14.']);
  now = tasks();
  assert.equal(now.b!.text, 'Present Three Lenses and upload the deck');
  assert.match(now.b!.notesMarkdown!, /^Slot 6, MU-204\. Part 1 is the PDF/);
  // The blocks are OpenClaw's, with the file it left out put back; the workspace is written by OpenClaw.
  const blocks = JSON.parse(read('hook-work.json').records.b.body);
  assert.deepEqual(blocks.map((b: WorkBlock) => [b.kind, b.id]), [['file', 'deck'], ['checklist', 'checks']]);
  assert.equal(blocks[1].body, '- [x] Signed up\n- [x] Exported\n- [ ] Uploaded');
  assert.equal(read('hook-work.json').records.b.by, 'openclaw');
  const merge = read('merges.json').records[0];
  assert.deepEqual([merge.combined.applied, merge.from.text, merge.into.text], [['title', 'notes', 'work'], UPLOAD.text, PRESENT.text]);

  // A chat OpenClaw began in the folded-in task still names that task: it reaches the merged one.
  const seen = await (await routes.workspace.GET(new NextRequest('http://127.0.0.1/api/tasks/workspace?id=a'))).json();
  assert.deepEqual([seen.success, seen.data.taskId, seen.data.title], [true, 'b', 'Present Three Lenses and upload the deck']);
  const wrote = await (await post(routes.progress, { taskId: 'a', did: 'Uploaded the PDF to Canvas' })).json();
  assert.equal(wrote.success, true);
  assert.match(tasks().b!.notesMarkdown!, /Uploaded the PDF to Canvas$/);

  // Taken back: both tasks as they were, with their own chats, work and what OpenClaw waited on.
  assert.equal((await post(routes.merge, { action: 'undo', mergeId: 'nope' })).status, 404);
  const undone = await (await post(routes.merge, { action: 'undo', mergeId: made.data.mergeId })).json();
  assert.deepEqual(undone, { success: true, data: { fromId: 'a', intoId: 'b' } });
  now = tasks();
  assert.deepEqual([now.a!.text, now.a!.notesMarkdown, now.a!.dueDate, now.a1!.parentTaskId], [UPLOAD.text, UPLOAD.notesMarkdown, '2026-11-14', 'a']);
  assert.deepEqual([now.b!.text, now.b!.notesMarkdown, now.b!.dueDate, now.b!.projects], [PRESENT.text, PRESENT.notesMarkdown, undefined, ['rutgers']]);
  assert.equal(read('let-go.json').records.some((r: { id: string }) => r.id === 'a'), false);
  const back = read('brief-chats.json').threads;
  assert.deepEqual([back.a.map((t: { id: string; taskId: string; mergedFrom?: string }) => [t.id, t.taskId, t.mergedFrom]), back.b.map((t: { id: string }) => t.id)], [[['t1m', 'a', undefined]], ['t1']]);
  assert.deepEqual(JSON.parse(read('hook-work.json').records.b.body), [{ kind: 'checklist', id: 'checks', body: '- [x] Signed up' }]);
  assert.deepEqual(read('workspace-tabs.json').tabs.b, ['https://example.org/rubric']);
  assert.deepEqual([read('chat-models.json').models.b, read('chat-models.json').thinking.b], [undefined, undefined]);
  const workBack = read('task-work.json').records;
  assert.deepEqual([workBack.a.items.length, workBack.b.status, workBack.b.items.length], [2, 'waiting', 1]);
  assert.equal((await (await routes.workspace.GET(new NextRequest('http://127.0.0.1/api/tasks/workspace?id=a'))).json()).data.taskId, 'a');
  assert.equal((await post(routes.merge, { action: 'undo', mergeId: made.data.mergeId })).status, 409);
});

test('a merge waits while OpenClaw is in the middle of the task being folded in, and stands when OpenClaw cannot combine', async () => {
  seed();
  // A chat of the folded-in task has a turn out.
  const file = read('brief-chats.json');
  file.threads.a[0].pendingSince = new Date().toISOString();
  write('brief-chats.json', file);
  const busy = await post(routes.merge, { fromId: 'a', intoId: 'b' });
  assert.equal(busy.status, 409);
  assert.match((await busy.json()).error, /still answering/);
  file.threads.a[0].pendingSince = null;
  write('brief-chats.json', file);
  // A run holds the task.
  const work = read('task-work.json');
  work.records.a.status = 'working';
  write('task-work.json', work);
  assert.equal((await post(routes.merge, { fromId: 'a', intoId: 'b' })).status, 409);
  work.records.a.status = 'needs-you';
  write('task-work.json', work);
  assert.equal(tasks().a!.text, UPLOAD.text);

  // OpenClaw answers something that is not the JSON: the merge by rule stands, and the chat says so.
  fs.writeFileSync(path.join(root, 'answer.json'), 'Sorry, I cannot do that.');
  const made = await (await post(routes.merge, { fromId: 'b', intoId: 'a' })).json();
  assert.equal(made.success, true, JSON.stringify(made));
  const asked = read('brief-chats.json').threads.a.at(-1);
  const done = await settled('a', asked.id);
  assert.match(done.error ?? '', /couldn’t combine them/);
  const now = tasks();
  assert.deepEqual([now.b, now.a!.text, now.a!.dueDate], [undefined, UPLOAD.text, '2026-11-14']);
  assert.match(now.a!.notesMarkdown!, /## Merged in: Give the Three Lenses presentation/);
  assert.deepEqual(JSON.parse(read('hook-work.json').records.a.body).map((b: WorkBlock) => b.id), ['checks', 'deck', 'checks-2']);
  assert.match(read('merges.json').records.at(-1).combined.error, /couldn’t combine/);
});
