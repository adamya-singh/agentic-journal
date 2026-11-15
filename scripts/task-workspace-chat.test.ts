// The workspace as a chat in it knows and changes it: what a turn is told, what OpenClaw may write, and that
// neither side's writing replaces the other's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { mergeWork, nextWorkRecord, resolveWork, workHash } from '../src/lib/hook-work';
import type { WorkBlock } from '../src/lib/shapes/work';
import { buildChatTurnMessage, migrateChatThreads, newChatThread, typedTextOf } from '../src/lib/task-chat';
import { deriveSurfaces } from '../src/lib/task-surfaces';
import { applyWorkspaceOp, workspaceBrief, workspaceSignature, workspaceView } from '../src/lib/task-workspace';

const now = new Date(2026, 10, 15, 12, 0);
const TASK = 'bbcef1b7-24a2-4440-b00f-553854bc7fc8';
const deck = (first: string): WorkBlock[] => [
  { kind: 'slides', id: 'deck', items: [{ title: 'Slide 1: Problem', body: first }, { title: 'Slide 2: Lenses', body: '- Lens 1:' }], at: 0 },
  { kind: 'checklist', id: 'checks', label: 'Checks', body: '- [ ] Exported to PDF' },
];
const viewOf = (blocks: WorkBlock[] | null, record = blocks ? nextWorkRecord(undefined, { taskId: TASK, blocks }, now) : undefined) => {
  const work = resolveWork(null, record, 'Finish the slides');
  const surfaces = deriveSurfaces({ links: [{ label: 'Canvas', href: 'https://canvas.example.edu/a/1', kind: 'canvas' }], next: null, work: work ? { title: work.title, href: work.href, blocks: work.blocks.length } : null, pasted: [] });
  return workspaceView({ taskId: TASK, title: 'Finish the slides', work, surfaces });
};

test('a chat is told how the workspace works once, how it stands when it changed, and nothing when it did not', () => {
  const view = viewOf(deck('- Contemporary Problem:'));
  const rules = workspaceBrief(view, 'rules', { kind: 'work', label: 'Deck' });
  assert.match(rules, /^\[Workspace of this task, in the Journal\./);
  assert.match(rules, new RegExp(`curl -s 'http://127\\.0\\.0\\.1:3000/api/tasks/workspace\\?id=${TASK}'`));
  assert.match(rules, /"action":"block"/);
  assert.match(rules, /Never leave the work only in this chat, and never only in a file of your own/);
  assert.match(rules, /He is on the Work tab/);
  assert.match(rules, /- Canvas: https:\/\/canvas\.example\.edu\/a\/1/);
  assert.ok(rules.includes(JSON.stringify(view.work!.blocks)), 'the blocks as they stand are in it');
  assert.match(rules, /version 1, last written by him/);

  const state = workspaceBrief(view, 'state', { kind: 'work', label: 'Deck' });
  assert.match(state, /it changed since your last turn/);
  assert.doesNotMatch(state, /curl/);
  assert.ok(state.includes(JSON.stringify(view.work!.blocks)));

  // Nothing changed and he is on the work: the message goes as typed. On a web page, the page is still said.
  assert.equal(workspaceBrief(view, 'where', { kind: 'work', label: 'Deck' }), '');
  assert.match(workspaceBrief(view, 'where', { kind: 'web', label: 'Canvas', url: 'https://canvas.example.edu/a/1' }), /"Canvas" https:\/\/canvas\.example\.edu\/a\/1/);
  // Nothing started yet: it is told a write starts it.
  assert.match(workspaceBrief(viewOf(null), 'rules', null), /nothing has been started in it yet/);
});

test('the turn carries the workspace, and what he typed is still read back out of it', () => {
  const view = viewOf(deck('- Contemporary Problem:'));
  const first = buildChatTurnMessage({ brief: null, text: 'fill in slide 1', first: true, workspace: workspaceBrief(view, 'rules', null) });
  assert.match(first, /The two exceptions are below/);
  assert.match(first, /\[Workspace of this task/);
  assert.ok(first.endsWith('fill in slide 1'));
  assert.equal(typedTextOf(first.replace('The task could not be loaded.', 'x')), 'fill in slide 1');
  const later = buildChatTurnMessage({ brief: null, text: 'now slide 2', first: false, workspace: workspaceBrief(view, 'state', null) });
  assert.ok(later.startsWith('[Workspace of this task'));
  assert.equal(typedTextOf(later), 'now slide 2');
  // With nothing to say about the workspace the message goes as typed, as before.
  assert.equal(buildChatTurnMessage({ brief: null, text: 'Thanks', first: false, workspace: '' }), 'Thanks');
});

test('the signature changes with the blocks and the tabs, and a chat remembers the one it knew', () => {
  const a = viewOf(deck('- Contemporary Problem:'));
  const b = viewOf(deck('- Contemporary Problem: web scraping'));
  assert.notEqual(workspaceSignature(a), workspaceSignature(b));
  assert.equal(workspaceSignature(a), workspaceSignature(viewOf(deck('- Contemporary Problem:'))));
  assert.notEqual(workspaceSignature(a), workspaceSignature({ ...a, tabs: [] }));
  const thread = { ...newChatThread(TASK, now), workSeen: workspaceSignature(a) };
  const back = migrateChatThreads({ schemaVersion: 2, threads: { [TASK]: [thread] } }).threads[TASK][0];
  assert.equal(back.workSeen, workspaceSignature(a));
});

test('OpenClaw changes one block, all of them, or takes one away, and is told what could not be kept', () => {
  const blocks = deck('- Contemporary Problem:');
  const one = applyWorkspaceOp(blocks, { action: 'block', block: { kind: 'slides', id: 'deck', items: [{ title: 'Slide 1: Problem', body: 'Mass web scraping' }], at: 0 } });
  assert.ok('blocks' in one);
  assert.deepEqual(one.blocks.map((b) => b.id), ['deck', 'checks']);
  assert.equal(one.blocks[0].kind === 'slides' && one.blocks[0].items[0].body, 'Mass web scraping');
  assert.deepEqual(one.blocks[1], blocks[1], 'the other block is untouched');
  // A block with a new id is added at the end.
  const added = applyWorkspaceOp(blocks, { action: 'block', block: { kind: 'doc', id: 'script', label: 'Speaker notes', body: 'Open with the lawsuit.' } });
  assert.ok('blocks' in added);
  assert.deepEqual(added.blocks.map((b) => b.id), ['deck', 'checks', 'script']);
  // The whole list, read as carefully as any blocks.
  const all = applyWorkspaceOp(blocks, { action: 'write', blocks: [{ kind: 'doc', id: 'a', body: 'One' }, { kind: 'nonsense', id: 'b' }] });
  assert.ok('blocks' in all);
  assert.deepEqual([all.blocks.map((b) => b.id), all.problems.length], [['a'], 1]);
  const gone = applyWorkspaceOp(blocks, { action: 'remove-block', id: 'checks' });
  assert.ok('blocks' in gone);
  assert.deepEqual(gone.blocks.map((b) => b.id), ['deck']);
  // What cannot be done says why and changes nothing.
  for (const bad of [
    applyWorkspaceOp(blocks, { action: 'remove-block', id: 'nope' }),
    applyWorkspaceOp(blocks, { action: 'write', blocks: [{ kind: 'slides', id: 'x', items: [] }] }),
    applyWorkspaceOp(blocks, { action: 'block', block: { kind: 'letter', id: 'l' } }),
    applyWorkspaceOp(blocks, { action: 'write', blocks: 'slides' }),
  ]) assert.ok('error' in bad && bad.error.length > 0);
});

test('what OpenClaw writes is the workspace’s version, and his typing over it keeps both', () => {
  const brief = { title: 'Deck', blocks: deck('- Contemporary Problem:') };
  const opened = nextWorkRecord(undefined, { taskId: TASK }, now);
  assert.equal(resolveWork(brief, opened, 'T')!.rev, 0);
  // OpenClaw fills slide 1 from the chat.
  const filled = deck('Mass web scraping');
  const theirs = nextWorkRecord(opened, { taskId: TASK, blocks: filled, baseHash: workHash(brief.blocks), by: 'openclaw' }, now);
  const shown = resolveWork(brief, theirs, 'T')!;
  assert.deepEqual([shown.blocks, shown.rev, shown.by, shown.edited, shown.newer], [filled, 1, 'openclaw', true, null]);
  // He was ticking the checklist in the version before that: only his block goes over what OpenClaw wrote.
  const his = deck('- Contemporary Problem:').map((b) => (b.id === 'checks' ? { ...b, body: '- [x] Exported to PDF' } : b)) as WorkBlock[];
  const merged = mergeWork(filled, his, ['checks']);
  assert.equal(merged[0], filled[0]);
  assert.equal(merged[1].kind === 'checklist' && merged[1].body, '- [x] Exported to PDF');
  // A block he changed that OpenClaw took away is kept.
  assert.deepEqual(mergeWork([filled[0]], his, ['checks']).map((b) => b.id), ['deck', 'checks']);
  const saved = nextWorkRecord(theirs, { taskId: TASK, blocks: merged }, now);
  assert.deepEqual([saved.rev, saved.by], [2, 'you']);
  // Taking the brief's version back counts as a write too, so the open page notices.
  const reset = nextWorkRecord(saved, { taskId: TASK, reset: true }, now);
  assert.deepEqual([reset.rev, reset.by, reset.body], [3, undefined, null]);
});

test('the workspace route reads and writes the same copy the page saves, and a late save from the page merges', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-chat-'));
  const before = process.env.BACKEND_DATA_DIR;
  process.env.BACKEND_DATA_DIR = dir;
  try {
    fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks', 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [{ id: TASK, text: 'Finish the slides', notesMarkdown: '- **Canvas:** [Part 1](https://canvas.example.edu/a/1)' }] }));
    const workspace = await import('../src/app/api/tasks/workspace/route');
    const hookWork = await import('../src/app/api/tasks/hook-work/route');
    const url = 'http://127.0.0.1:3000/api/tasks/workspace';
    const post = (body: unknown) => new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const read = async () => (await (await workspace.GET(new NextRequest(`${url}?id=${TASK}`))).json()).data;
    const peek = async () => (await (await workspace.GET(new NextRequest(`${url}?id=${TASK}&peek=1`))).json()).data;
    const save = async (body: Record<string, unknown>) => (await hookWork.POST(new NextRequest('http://127.0.0.1:3000/api/tasks/hook-work', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: TASK, action: 'save', ...body }) }))).json();

    assert.equal((await read()).work, null);
    assert.deepEqual(await peek(), { rev: 0, tabs: '' });
    assert.equal((await workspace.GET(new NextRequest(`${url}?id=nope`))).status, 404);

    // OpenClaw starts the work from the chat.
    const started = await (await workspace.POST(post({ taskId: TASK, action: 'write', blocks: deck('- Contemporary Problem:') }))).json();
    assert.equal(started.success, true);
    assert.deepEqual([started.data.work.rev, started.data.work.by, started.data.problems], [1, 'openclaw', []]);
    assert.equal((await peek()).rev, 1);

    // He ticks the checklist (the page saves, saying the version it started from).
    const ticked = deck('- Contemporary Problem:').map((b) => (b.id === 'checks' ? { ...b, body: '- [x] Exported to PDF' } : b));
    const mine = await save({ blocks: ticked, seen: 1, changed: ['checks'] });
    assert.deepEqual([mine.data.rev, mine.data.by, mine.merged], [2, 'you', undefined]);

    // OpenClaw fills the deck; a save from the page that still counts from version 2 keeps the deck and his tick.
    const filled = await (await workspace.POST(post({ taskId: TASK, action: 'block', block: { kind: 'slides', id: 'deck', items: [{ title: 'Slide 1: Problem', body: 'Mass web scraping' }], at: 0 } }))).json();
    assert.equal(filled.data.work.rev, 3);
    const late = await save({ blocks: ticked.map((b) => (b.id === 'checks' ? { ...b, body: '- [x] Exported to PDF\n- [ ] Uploaded' } : b)), seen: 2, changed: ['checks'] });
    assert.equal(late.merged, true);
    const after = (await read()).work;
    assert.equal(after.blocks[0].items[0].body, 'Mass web scraping');
    assert.equal(after.blocks[1].body, '- [x] Exported to PDF\n- [ ] Uploaded');

    // Tabs: a page is added and taken off; anything but a web address is refused, and so is an unknown change.
    const opened = await (await workspace.POST(post({ taskId: TASK, action: 'open-tab', url: 'https://example.org/rubric' }))).json();
    assert.deepEqual(opened.data.tabs.map((t: { url: string; pasted: boolean }) => [t.url, t.pasted]), [['https://canvas.example.edu/a/1', false], ['https://example.org/rubric', true]]);
    assert.equal((await peek()).tabs, 'https://example.org/rubric');
    assert.equal((await workspace.POST(post({ taskId: TASK, action: 'open-tab', url: 'file:///etc/passwd' }))).status, 400);
    assert.equal((await (await workspace.POST(post({ taskId: TASK, action: 'close-tab', url: 'https://example.org/rubric' }))).json()).data.tabs.length, 1);
    assert.equal((await workspace.POST(post({ taskId: TASK, action: 'delete-everything' }))).status, 400);
    assert.equal((await workspace.POST(post({ taskId: 'nope', action: 'write', blocks: deck('x') }))).status, 404);
    const refused = await workspace.POST(post({ taskId: TASK, action: 'write', blocks: [{ kind: 'nonsense' }] }));
    assert.equal(refused.status, 400);
    assert.equal((await refused.json()).problems.length, 1);
  } finally {
    if (before === undefined) delete process.env.BACKEND_DATA_DIR; else process.env.BACKEND_DATA_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
