import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  bugsFeaturesDir,
  createItem,
  deleteItem,
  listItems,
  readImage,
  setStatus,
  toView,
  updateItem,
} from '../src/lib/bugs-features/store.ts';
import { claudeCodePrompt } from '../src/lib/bugs-features/prompt.ts';
import { POST } from '../src/app/api/bugs-features/route.ts';
import { GET as getImage } from '../src/app/api/bugs-features/[id]/images/[name]/route.ts';

let dir: string, previous: string | undefined;
const png = (byte = 1) => ({ data: Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]), type: 'image/png' });
const input = (description = 'Library filters ignore project chips') => ({
  kind: 'bug' as const,
  description,
  prompt: 'Make the filters combine with AND.',
  page: '/library',
});

beforeEach(() => {
  previous = process.env.BACKEND_DATA_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugs-features-test-'));
  process.env.BACKEND_DATA_DIR = dir;
});
afterEach(() => {
  if (previous === undefined) delete process.env.BACKEND_DATA_DIR;
  else process.env.BACKEND_DATA_DIR = previous;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('create stores the item and its screenshots, newest first', () => {
  const first = createItem(input('first'), [png(1)], new Date('2026-10-13T10:00:00Z'));
  const second = createItem(input('second'), [], new Date('2026-10-13T11:00:00Z'));
  assert.deepEqual(
    listItems().map((item) => item.id),
    [second.id, first.id],
  );
  assert.equal(first.status, 'open');
  assert.equal(first.images.length, 1);
  assert.deepEqual(readImage(first.id, first.images[0])?.data, png(1).data);
  const view = toView(first);
  assert.equal(view.imagePaths[0], path.join(bugsFeaturesDir(), 'images', first.id, first.images[0]));
  assert.equal(view.imageUrls[0], `/api/bugs-features/${first.id}/images/${first.images[0]}`);
});

test('an empty save and non-image uploads are rejected', () => {
  assert.throws(() => createItem({ ...input(''), prompt: ' ' }, []), /Add a screenshot/);
  assert.throws(() => createItem(input(), [{ data: Buffer.from('x'), type: 'text/html' }]), /PNG, JPEG/);
  assert.deepEqual(listItems(), []);
});

test('update keeps the listed screenshots in order, appends new ones, and deletes the rest', () => {
  const item = createItem(input(), [png(1), png(2), png(3)]);
  const [a, b, c] = item.images;
  const updated = updateItem(item.id, { ...input('edited'), kind: 'feature' }, [c, a], [png(4)]);
  assert.equal(updated.kind, 'feature');
  assert.equal(updated.description, 'edited');
  assert.deepEqual(updated.images.slice(0, 2), [c, a]);
  assert.equal(updated.images.length, 3);
  assert.equal(readImage(item.id, b), null);
  assert.deepEqual(readImage(item.id, updated.images[2])?.data, png(4).data);
  // A new screenshot never reuses a removed one's name, so cached URLs stay correct.
  assert.ok(!updated.images.includes(b));
});

test('status and delete', () => {
  const item = createItem(input(), [png()]);
  const shipped = setStatus(item.id, 'shipped');
  assert.equal(shipped.status, 'shipped');
  assert.ok(shipped.shippedAt);
  assert.equal(setStatus(item.id, 'open').shippedAt, null);
  deleteItem(item.id);
  assert.deepEqual(listItems(), []);
  assert.equal(fs.existsSync(path.join(bugsFeaturesDir(), 'images', item.id)), false);
  assert.throws(() => deleteItem(item.id), /no longer exists/);
});

test('image reads refuse names outside the item folder', () => {
  const item = createItem(input(), [png()]);
  assert.equal(readImage(item.id, '../../items.json'), null);
  assert.equal(readImage('../x', item.images[0]), null);
});

test('the Claude Code prompt leads with the draft and lists screenshot paths', () => {
  const view = toView(createItem(input(), [png()]));
  const text = claudeCodePrompt(view);
  assert.ok(text.startsWith('Make the filters combine with AND.\n\n## Context\n- Kind: Bug\n- Page: /library'));
  assert.match(text, /## What I saw\nLibrary filters ignore project chips/);
  assert.ok(text.endsWith(`## Screenshots (read these first)\n- ${view.imagePaths[0]}`));
  const noPrompt = claudeCodePrompt({ ...view, prompt: '', page: null, imagePaths: [] });
  assert.match(noPrompt, /^No prompt was drafted/);
  assert.doesNotMatch(noPrompt, /Page:|Screenshots/);
});

test('POST saves a multipart body from the same origin and refuses other origins', async () => {
  const form = () => {
    const body = new FormData();
    body.set('kind', 'feature');
    body.set('description', 'Ask for the tier right after logging a title');
    body.set('prompt', '');
    body.set('page', '/media');
    body.append('images', new File([png().data], 'shot.png', { type: 'image/png' }));
    return body;
  };
  const request = (origin: string) =>
    new NextRequest('http://127.0.0.1:3000/api/bugs-features', {
      method: 'POST',
      headers: { origin },
      body: form(),
    });
  assert.equal((await POST(request('https://evil.example'))).status, 403);
  const response = await POST(request('http://127.0.0.1:3000'));
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.equal(data.kind, 'feature');
  assert.equal(data.page, '/media');
  assert.equal(data.imagePaths.length, 1);
  const image = await getImage(new NextRequest(`http://127.0.0.1:3000${data.imageUrls[0]}`), {
    params: Promise.resolve({ id: data.id, name: data.images[0] }),
  });
  assert.equal(image.headers.get('content-type'), 'image/png');
});
