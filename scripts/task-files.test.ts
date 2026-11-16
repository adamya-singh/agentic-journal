// A task's real files in its workspace: the `file` block that names one, the tab it becomes, what a chat is told
// of it, and the route that shows it. A file is only ever read from inside OpenClaw's workspace folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { nextWorkRecord, resolveWork } from '../src/lib/hook-work';
import { fileLimits, isActive, parseBlocks, workLimits, workspacePath, type WorkBlock } from '../src/lib/shapes/work';
import { parseSurfaceRef, surfaceActivity, type ChatThreadSummary } from '../src/lib/task-chat';
import { fileExt, fileFolder, fileKind, fileName, fileSize, fileType, fileUrl, pageWidth } from '../src/lib/task-files';
import { defaultSurfaceId, deriveSurfaces } from '../src/lib/task-surfaces';
import { workspaceBrief, workspaceView } from '../src/lib/task-workspace';

const TASK = 'bbcef1b7-24a2-4440-b00f-553854bc7fc8';
const now = new Date(2026, 10, 15, 12, 0);

test('a file block holds a path inside the OpenClaw workspace folder and nothing else', () => {
  assert.equal(workspacePath('deck/Talk.pdf'), 'deck/Talk.pdf');
  assert.equal(workspacePath('  ./deck//Talk.pdf '), 'deck/Talk.pdf');
  assert.equal(workspacePath('~/.openclaw/workspace/deck/Talk.pdf'), 'deck/Talk.pdf');
  assert.equal(workspacePath('/home/openclaw/.openclaw/workspace/deck/Talk.pdf'), 'deck/Talk.pdf');
  for (const bad of ['', '   ', '/etc/passwd', '~/secrets.txt', '../openclaw.json', 'deck/../../openclaw.json', '~/.openclaw/workspace/../openclaw.json',
    '/home/openclaw/.openclaw/openclaw.json', 'https://example.com/a.pdf', 'file:///etc/passwd', 'deck\\Talk.pdf', '.git/config', 'deck/.env', 'a\nb.pdf', 'x'.repeat(fileLimits.path + 1), 42, null]) {
    assert.equal(workspacePath(bad), null, JSON.stringify(bad));
  }
});

test('file blocks are read carefully: a bad path is dropped, notes are cut and do not count against the work', () => {
  const read = parseBlocks([
    { kind: 'file', id: 'deck', path: '~/.openclaw/workspace/deck/Talk.pdf', label: ' The deck ', notes: ['Open with the question.', 7, 'x'.repeat(fileLimits.note + 50), '', '  '] },
    { kind: 'file', id: 'bad', path: '/etc/passwd' },
    { kind: 'file', id: 'bare' },
  ]);
  assert.deepEqual(read.blocks, [{ kind: 'file', id: 'deck', path: 'deck/Talk.pdf', label: 'The deck', notes: ['Open with the question.', '', 'x'.repeat(fileLimits.note)] }]);
  assert.equal(read.problems.length, 2);
  assert.match(read.problems[0]!, /not a file inside the OpenClaw workspace folder/);

  // Forty pages of notes at full length are far over the work's own size limit, and are all kept.
  const notes = Array.from({ length: fileLimits.pages + 5 }, () => 'n'.repeat(fileLimits.note));
  const big = parseBlocks([{ kind: 'file', id: 'deck', path: 'deck/Talk.pdf', notes }, { kind: 'checklist', id: 'checks', body: '- [x] Exported' }]);
  assert.equal(JSON.stringify(big.blocks).length > workLimits.total, true);
  assert.deepEqual(big.problems, []);
  assert.equal(big.blocks.length, 2);
  assert.equal(big.blocks[0]!.kind === 'file' && big.blocks[0]!.notes?.length, fileLimits.pages);
  // A file is shown, not typed in: "jump in" never points at it.
  assert.equal(isActive(big.blocks[0]!), false);
});

test('what a file is, from its name', () => {
  assert.deepEqual(['deck/Talk.PDF', 'notes.md', 'shot.webp', 'data.csv', 'talk.pptx', 'page.html', 'README', '.hidden'].map(fileKind), ['pdf', 'markdown', 'image', 'text', 'other', 'other', 'other', 'other']);
  assert.deepEqual([fileExt('deck/Talk.PDF'), fileExt('README'), fileName('deck/Talk.pdf'), fileFolder('a/b/Talk.pdf'), fileFolder('Talk.pdf')], ['pdf', '', 'Talk.pdf', 'a/b', '']);
  assert.deepEqual([fileType('a.pdf'), fileType('a.md'), fileType('a.py'), fileType('a.html'), fileType('a.svg')], ['application/pdf', 'text/markdown; charset=utf-8', 'text/plain; charset=utf-8', 'application/octet-stream', 'application/octet-stream']);
  assert.deepEqual([fileSize(900), fileSize(765575), fileSize(3 * 1024 * 1024)], ['900 B', '748 KB', '3.0 MB']);
  assert.deepEqual([pageWidth(1), pageWidth(320), pageWidth(321), pageWidth(1600), pageWidth(5000)], [320, 320, 1600, 1600, 2400]);
  assert.equal(fileUrl('t 1', 'deck'), '/api/tasks/files?id=t%201&block=deck');
  assert.equal(fileUrl('t', 'deck', { page: 2, width: 1600, v: 17.6 }), '/api/tasks/files?id=t&block=deck&page=2&w=1600&v=18');
  assert.equal(fileUrl('t', 'deck', { raw: true, download: true }), '/api/tasks/files?id=t&block=deck&raw=1&dl=1');
});

test('a task with files opens on its first file, and its tabs are the files, then the work, then the pages', () => {
  const links = [{ label: 'Canvas', href: 'https://canvas.example.edu/a/1', kind: 'canvas' }];
  const files = [{ id: 'deck', path: 'deck/Talk.pdf' }, { id: 'script', path: 'deck/NOTES.md', label: 'Speaker script' }];
  const both = deriveSurfaces({ links, next: null, work: { title: 'The deck', href: null, blocks: 1 }, files });
  assert.deepEqual(both.map((s) => [s.id, s.kind, s.label]), [
    ['file:deck', 'file', 'Talk.pdf'], ['file:script', 'file', 'Speaker script'], ['work', 'work', 'The deck'], ['web:https://canvas.example.edu/a/1', 'web', 'Canvas'],
  ]);
  assert.deepEqual(both.flatMap((s) => (s.kind === 'file' ? [[s.block, s.tag, s.path]] : [])), [['deck', 'pdf', 'deck/Talk.pdf'], ['script', 'md', 'deck/NOTES.md']]);
  assert.equal(defaultSurfaceId(both, true), 'file:deck');
  // When the files are all the work there is, there is no empty Work tab beside them.
  const only = deriveSurfaces({ links: [], next: null, work: { title: 'The deck', href: null, blocks: 0 }, files });
  assert.deepEqual(only.map((s) => s.id), ['file:deck', 'file:script']);
  // No files: as it always was.
  const none = deriveSurfaces({ links, next: null, work: { title: 'The deck', href: null, blocks: 2 } });
  assert.deepEqual(none.map((s) => s.id), ['work', 'web:https://canvas.example.edu/a/1']);
  assert.equal(defaultSurfaceId(none, true), 'work');
});

test('a message can be about a file and the page of it he was on', () => {
  assert.deepEqual(parseSurfaceRef({ kind: 'file', label: 'Talk.pdf', block: 'deck', page: 3 }), { kind: 'file', label: 'Talk.pdf', block: 'deck', page: 3 });
  assert.deepEqual(parseSurfaceRef({ kind: 'file', label: '', block: 'deck', page: 0 }), { kind: 'file', label: 'File', block: 'deck' });
  assert.equal(parseSurfaceRef({ kind: 'file', label: 'Talk.pdf' }), null);
  assert.equal(parseSurfaceRef({ kind: 'file', label: 'Talk.pdf', block: 'x'.repeat(61) }), null);
  // What OpenClaw is doing about a file is known from the chat that last asked from it, whatever page that was.
  const thread = { id: 'a', state: 'working', updatedAt: '2026-11-15T17:00:00.000Z', ask: 'Tighten slide 3', askAbout: { kind: 'file', label: 'Talk.pdf', block: 'deck', page: 3 } } as ChatThreadSummary;
  assert.deepEqual(surfaceActivity([thread], [{ kind: 'file', label: '', block: 'deck' }]), { state: 'working', threadId: 'a', ask: 'Tighten slide 3' });
  assert.equal(surfaceActivity([thread], [{ kind: 'file', label: '', block: 'script' }]), null);
  assert.equal(surfaceActivity([thread], [{ kind: 'work', label: '' }]), null);
});

test('a chat is told that a file is the work, where it is and which page he is on', () => {
  const blocks: WorkBlock[] = [{ kind: 'file', id: 'deck', path: 'deck/Talk.pdf', notes: ['Open with the question.'] }, { kind: 'checklist', id: 'checks', body: '- [x] Exported' }];
  const work = resolveWork(null, nextWorkRecord(undefined, { taskId: TASK, blocks }, now), 'Finish the slides');
  const view = workspaceView({ taskId: TASK, title: 'Finish the slides', work, surfaces: deriveSurfaces({ links: [], next: null, work: null }) });
  const on = { kind: 'file' as const, label: 'Talk.pdf', block: 'deck', page: 2 };
  const rules = workspaceBrief(view, 'rules', on);
  assert.match(rules, /the file is the work/);
  assert.match(rules, /Do not copy a file’s content into slides, a doc or any other block/);
  assert.match(rules, /- file \(path: inside ~\/\.openclaw\/workspace/);
  assert.match(rules, /He is on the tab of this file, shown as it is: ~\/\.openclaw\/workspace\/deck\/Talk\.pdf, page 2 \(file block "deck"\)/);
  assert.doesNotMatch(rules, /the Work tab holds what the file is made from/);
  // Nothing changed since the last turn: still told which page he is on now.
  assert.match(workspaceBrief(view, 'where', { ...on, page: 4 }), /Talk\.pdf, page 4/);
  // A reference to a block that is not a file there says nothing.
  assert.equal(workspaceBrief(view, 'where', { kind: 'file', label: 'x', block: 'checks' }), '');
});

test('the files route shows a file of the task from the workspace folder, and nothing from outside it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-files-'));
  const data = path.join(dir, 'data');
  const root = path.join(dir, 'workspace');
  const before = { data: process.env.BACKEND_DATA_DIR, root: process.env.OPENCLAW_WORKSPACE_DIR };
  process.env.BACKEND_DATA_DIR = data;
  process.env.OPENCLAW_WORKSPACE_DIR = root;
  try {
    fs.mkdirSync(path.join(data, 'tasks'), { recursive: true });
    fs.mkdirSync(path.join(root, 'deck'), { recursive: true });
    fs.writeFileSync(path.join(data, 'tasks', 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [{ id: TASK, text: 'Finish the slides' }] }));
    fs.writeFileSync(path.join(root, 'deck', 'NOTES.md'), '# Script\n\nGood afternoon.');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'not for the page');
    fs.symlinkSync(path.join(dir, 'secret.txt'), path.join(root, 'deck', 'link.txt'));

    const workspace = await import('../src/app/api/tasks/workspace/route');
    const files = await import('../src/app/api/tasks/files/route');
    const store = await import('../src/app/api/tasks/files/store');
    const write = (blocks: unknown[]) => workspace.POST(new NextRequest('http://127.0.0.1:3000/api/tasks/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: TASK, action: 'write', blocks }) }));
    const get = (query: string, headers: Record<string, string> = {}) => files.GET(new NextRequest(`http://127.0.0.1:3000/api/tasks/files?${query}`, { headers }));

    const wrote = await (await write([
      { kind: 'file', id: 'script', path: 'deck/NOTES.md' },
      { kind: 'file', id: 'link', path: 'deck/link.txt' },
      { kind: 'file', id: 'gone', path: 'deck/missing.pdf' },
      { kind: 'file', id: 'out', path: '../secret.txt' },
      { kind: 'checklist', id: 'checks', body: '- [x] Exported' },
    ])).json();
    // The block that climbs out of the folder was never kept; the workspace says the files are part of the work.
    assert.deepEqual(wrote.data.work.blocks.map((b: WorkBlock) => b.id), ['script', 'link', 'gone', 'checks']);
    assert.equal(wrote.data.problems.length, 1);

    const meta = await (await get(`id=${TASK}&block=script`)).json();
    assert.deepEqual([meta.data.name, meta.data.folder, meta.data.kind, meta.data.size, meta.data.pages], ['NOTES.md', 'deck', 'markdown', 25, null]);
    const raw = await get(`id=${TASK}&block=script&raw=1`);
    assert.equal(await raw.text(), '# Script\n\nGood afternoon.');
    assert.equal(raw.headers.get('content-type'), 'text/markdown; charset=utf-8');
    assert.match(raw.headers.get('content-disposition') ?? '', /^inline; /);
    assert.match(raw.headers.get('content-security-policy') ?? '', /^sandbox/);
    assert.match((await get(`id=${TASK}&block=script&raw=1&dl=1`)).headers.get('content-disposition') ?? '', /^attachment; /);

    // A link that leads out of the folder, a file that is not there, a block that is not a file, an unknown task.
    assert.equal((await get(`id=${TASK}&block=link&raw=1`)).status, 404);
    assert.equal((await get(`id=${TASK}&block=gone`)).status, 404);
    assert.equal((await get(`id=${TASK}&block=checks`)).status, 404);
    assert.equal((await get(`id=${TASK}&block=out`)).status, 404);
    assert.equal((await get('id=nope&block=script')).status, 404);
    assert.equal((await get(`id=${TASK}`)).status, 400);
    // A page of something that is not a PDF.
    assert.equal((await get(`id=${TASK}&block=script&page=1&w=320`)).status, 415);
    // Another site's page asking through his browser is refused; the Journal's own page is not.
    assert.equal((await get(`id=${TASK}&block=script&raw=1`, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await get(`id=${TASK}&block=script`, { 'sec-fetch-site': 'same-origin' })).status, 200);

    // Straight at the store: nothing outside the folder is found, by path or by link.
    assert.equal(store.findWorkspaceFile('../secret.txt'), null);
    assert.equal(store.findWorkspaceFile('deck/link.txt'), null);
    assert.equal(store.findWorkspaceFile('deck'), null);
    assert.equal(store.findWorkspaceFile('deck/NOTES.md')?.size, 25);

    // A real PDF, when this machine can make and draw one: its pages are counted and drawn, once per version.
    let chrome = false;
    try {
      fs.writeFileSync(path.join(dir, 'deck.html'), '<style>@page{size:1440px 810px;margin:0}body{margin:0}section{height:800px;overflow:hidden}section+section{page-break-before:always}</style><section>One</section><section>Two</section>');
      execFileSync('google-chrome', ['--headless=new', '--no-sandbox', '--disable-gpu', `--print-to-pdf=${path.join(root, 'deck', 'Talk.pdf')}`, '--no-pdf-header-footer', path.join(dir, 'deck.html')], { timeout: 60_000, stdio: 'ignore' });
      execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' });
      chrome = fs.existsSync(path.join(root, 'deck', 'Talk.pdf'));
    } catch { /* no Chrome or no poppler here: the rest is covered above */ }
    if (chrome) {
      await write([{ kind: 'file', id: 'deck', path: 'deck/Talk.pdf', notes: ['Say hello.'] }]);
      const pdf = (await (await get(`id=${TASK}&block=deck`)).json()).data;
      assert.deepEqual([pdf.kind, pdf.pages], ['pdf', 2]);
      assert.equal(Math.abs(pdf.ratio - 16 / 9) < 0.01, true);
      const page = await get(`id=${TASK}&block=deck&page=2&w=300&v=${pdf.mtime}`);
      assert.deepEqual([page.status, page.headers.get('content-type'), page.headers.get('cache-control')], [200, 'image/png', 'private, max-age=31536000, immutable']);
      const png = Buffer.from(await page.arrayBuffer());
      assert.equal(png.subarray(1, 4).toString(), 'PNG');
      assert.equal(png.readUInt32BE(16), 320);   // drawn at the nearest width it keeps, not at any width asked for
      assert.equal((await get(`id=${TASK}&block=deck&page=3&w=320`)).status, 400);
      assert.equal((await get(`id=${TASK}&block=deck&page=0&w=320`)).status, 400);
      const cache = path.join(data, 'tasks', 'file-cache');
      assert.equal(fs.readdirSync(cache).length, 1);
      // The file is written again: its pages are drawn again, and the old ones are thrown away.
      const later = new Date(Date.now() + 5000);
      fs.utimesSync(path.join(root, 'deck', 'Talk.pdf'), later, later);
      const again = (await (await get(`id=${TASK}&block=deck`)).json()).data;
      assert.notEqual(again.mtime, pdf.mtime);
      assert.equal((await get(`id=${TASK}&block=deck&page=1&w=320&v=${again.mtime}`)).status, 200);
      assert.deepEqual(fs.readdirSync(cache).map((name) => name.endsWith(`-${again.mtime}-${again.size}`)), [true]);
    }
  } finally {
    if (before.data === undefined) delete process.env.BACKEND_DATA_DIR; else process.env.BACKEND_DATA_DIR = before.data;
    if (before.root === undefined) delete process.env.OPENCLAW_WORKSPACE_DIR; else process.env.OPENCLAW_WORKSPACE_DIR = before.root;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
