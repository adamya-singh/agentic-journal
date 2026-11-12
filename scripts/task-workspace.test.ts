import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { chatSummary, latestChat, migrateChatThreads, newChatThread, surfaceActivity, type ChatSurfaceRef, type TaskChatThread } from '../src/lib/task-chat';
import { deriveSurfaces, readPastedPages, withoutPastedPage, withPastedPage, MAX_PASTED_PAGES } from '../src/lib/task-surfaces';
import { fromThisApp } from '../src/lib/same-origin';
import { nextFrameDelay } from '../src/components/openclaw-browser/stream';

const now = new Date(2026, 9, 8, 12, 0);
const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
const TASK = '16dec41f-2a34-4d36-9ab4-47c902bbc1fd';

function said(thread: TaskChatThread, role: 'you' | 'openclaw', text: string, when: Date, about?: ChatSurfaceRef) {
  thread.messages.push({ role, text, at: when.toISOString(), ...(about ? { about } : {}) });
  thread.updatedAt = when.toISOString();
  if (role === 'you') { thread.seenAt = when.toISOString(); thread.touchedAt = when.toISOString(); }
}

/** Points the stores at an empty data dir for one test. */
async function withDataDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-workspace-'));
  const before = process.env.BACKEND_DATA_DIR;
  process.env.BACKEND_DATA_DIR = dir;
  try {
    return await run(dir);
  } finally {
    if (before === undefined) delete process.env.BACKEND_DATA_DIR; else process.env.BACKEND_DATA_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
const postJson = (url: string, body: unknown) => new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// ---- What OpenClaw is doing about a surface.

test('a surface shows OpenClaw working while a chat sent from it has a turn out, then answered until he looks', () => {
  const rubric: ChatSurfaceRef = { kind: 'web', label: 'Rubric', url: 'https://www.example.com/rubric/' };
  const here: ChatSurfaceRef[] = [{ kind: 'web', label: '', url: 'https://example.com/rubric#part-2' }];
  const work: ChatSurfaceRef[] = [{ kind: 'work', label: '' }];
  const thread = newChatThread(TASK, at(0), rubric);
  assert.equal(surfaceActivity([chatSummary(thread)], here), null);            // nothing asked yet
  said(thread, 'you', 'Fill in   the second part of this form for me, then stop before submitting so I can check it over first', at(1), rubric);
  thread.pendingSince = at(1).toISOString();
  const working = surfaceActivity([chatSummary(thread)], here);
  assert.equal(working?.state, 'working');
  assert.equal(working?.threadId, thread.id);
  assert.match(working?.ask ?? '', /^Fill in the second part of this form for me/);
  assert.ok((working?.ask ?? '').length <= 90);
  assert.equal(surfaceActivity([chatSummary(thread)], work), null);            // the work tab is another surface
  assert.equal(surfaceActivity([chatSummary(thread)], [{ kind: 'web', label: '', url: 'https://example.com/other' }]), null);
  // The reply lands: answered until he has the chat open.
  thread.pendingSince = null;
  said(thread, 'openclaw', 'Done, it is ready to check.', at(3));
  assert.equal(surfaceActivity([chatSummary(thread)], here)?.state, 'answered');
  thread.seenAt = at(4).toISOString();
  assert.equal(surfaceActivity([chatSummary(thread)], here), null);
  // A turn that failed says nothing.
  said(thread, 'you', 'Again', at(5), rubric);
  thread.error = 'OpenClaw couldn’t answer.';
  assert.equal(surfaceActivity([chatSummary(thread)], here), null);
});

test('the request that counts is the last one, and a chat that is working wins over one that answered', () => {
  const page: ChatSurfaceRef = { kind: 'web', label: 'Posting', url: 'https://jobs.example.com/p/1' };
  const onWork: ChatSurfaceRef = { kind: 'work', label: 'Outline' };
  const moved = newChatThread(TASK, at(0), page);
  said(moved, 'you', 'Read this posting', at(0), page);
  said(moved, 'openclaw', 'Read.', at(1));
  moved.seenAt = at(1).toISOString();
  said(moved, 'you', 'Now tighten the outline', at(2), onWork);
  moved.pendingSince = at(2).toISOString();
  // It started on the page, but what is out now was asked from the work.
  assert.equal(surfaceActivity([chatSummary(moved)], [page]), null);
  assert.equal(surfaceActivity([chatSummary(moved)], [onWork])?.state, 'working');
  const answered = newChatThread(TASK, at(3), onWork);
  said(answered, 'you', 'Is the outline too long?', at(3), onWork);
  said(answered, 'openclaw', 'A little.', at(9));
  assert.equal(surfaceActivity([chatSummary(answered), chatSummary(moved)], [onWork])?.threadId, moved.id);
  // A message sent with nothing showing (no work started) is about no surface.
  const bare = newChatThread(TASK, at(10));
  said(bare, 'you', 'Hello', at(10));
  bare.pendingSince = at(10).toISOString();
  assert.equal(surfaceActivity([chatSummary(bare)], [onWork, page]), null);
  // A tab counts under the address it has since gone to, too.
  assert.equal(surfaceActivity([chatSummary(answered)], [{ kind: 'web', label: '', url: 'https://x.example' }, onWork])?.state, 'answered');
});

// ---- The most recent chat is the one he touched last.

test('a reply that lands late in an older chat does not make it the most recent again', () => {
  const older = newChatThread(TASK, at(0));
  said(older, 'you', 'Look this up', at(0));
  older.pendingSince = at(0).toISOString();
  const fresh = newChatThread(TASK, at(2));                 // he pressed New while the first was still out
  assert.equal(latestChat([older, fresh])?.id, fresh.id);
  older.pendingSince = null;
  said(older, 'openclaw', 'Found it.', at(5));             // the late reply
  assert.equal(latestChat([older, fresh])?.id, fresh.id);
  said(older, 'you', 'Thanks', at(6));                      // writing in the older one makes it the latest again
  assert.equal(latestChat([older, fresh])?.id, older.id);
  // A thread stored before this was recorded: the last thing he wrote stands in.
  const stored = migrateChatThreads({ schemaVersion: 2, threads: { [TASK]: [
    { id: 'a', sessionKey: 'agent:main:journal-chat-x-1792879728712', createdAt: at(0).toISOString(), updatedAt: at(9).toISOString(), seenAt: null, pendingSince: null, error: null,
      messages: [{ role: 'you', text: 'Hi', at: at(0).toISOString() }, { role: 'openclaw', text: 'Late.', at: at(9).toISOString() }] },
    { id: 'b', sessionKey: 'agent:main:journal-chat-x-1792879728999', createdAt: at(3).toISOString(), updatedAt: at(3).toISOString(), seenAt: null, pendingSince: null, error: null, messages: [] },
  ] } });
  assert.equal(latestChat(stored.threads[TASK])?.id, 'b');
});

test('Dawn’s chat stays on the new chat when the old one answers after New', async () => {
  await withDataDir(async (dir) => {
    const stub = path.join(dir, 'openclaw-stub.js');
    fs.writeFileSync(stub, `setTimeout(() => process.stdout.write(JSON.stringify({ status: 'ok', result: { payloads: [{ text: 'A late answer.' }] } })), 250);\n`);
    const beforeCli = process.env.OPENCLAW_CLI_PATH;
    process.env.OPENCLAW_CLI_PATH = stub;
    try {
      const route = await import('../src/app/api/tasks/brief-chat/route');
      const url = 'http://127.0.0.1:3000/api/tasks/brief-chat';
      const latest = async () => (await (await route.GET(new NextRequest(`${url}?id=${TASK}`))).json()).data;
      const sent = (await (await route.POST(postJson(url, { action: 'send', taskId: TASK, text: 'Look this up' }))).json()).data;
      assert.equal(sent.pending, true);
      const fresh = (await (await route.POST(postJson(url, { action: 'new', taskId: TASK }))).json()).data;
      assert.notEqual(fresh.id, sent.id);
      assert.equal((await latest()).id, fresh.id);
      // Wait for the first chat's answer to land.
      let listed;
      for (let i = 0; i < 80; i++) {
        listed = (await (await route.GET(new NextRequest(`${url}?id=${TASK}&list=1&thread=${sent.id}`))).json()).data;
        if (listed.thread && !listed.thread.pending) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.deepEqual(listed.thread.messages.map((m: { text: string }) => m.text), ['Look this up', 'A late answer.']);
      assert.equal(listed.threads[0].state, 'waiting');
      const shown = await latest();
      assert.equal(shown.id, fresh.id);                       // still the new, empty chat
      assert.deepEqual(shown.messages, []);
      // A bare send goes to the new chat, not back into the old one.
      const next = (await (await route.POST(postJson(url, { action: 'send', taskId: TASK, text: 'Something else' }))).json()).data;
      assert.equal(next.id, fresh.id);
      for (let i = 0; i < 80; i++) {
        if (!(await latest()).pending) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      if (beforeCli === undefined) delete process.env.OPENCLAW_CLI_PATH; else process.env.OPENCLAW_CLI_PATH = beforeCli;
    }
  });
});

// ---- The pages he pasted.

test('pasted pages are kept once each, web addresses only, and can be taken off again', () => {
  let pasted: string[] = [];
  pasted = withPastedPage(pasted, 'example.com/a')!;
  assert.deepEqual(pasted, ['https://example.com/a']);
  assert.equal(withPastedPage(pasted, 'https://www.example.com/a/#top'), pasted);        // the same page: nothing changes
  assert.equal(withPastedPage(pasted, 'javascript:alert(1)'), null);
  assert.equal(withPastedPage(pasted, 'file:///etc/passwd'), null);
  pasted = withPastedPage(pasted, 'https://example.org/b?x=1')!;
  assert.deepEqual(withoutPastedPage(pasted, 'http://nope.example'), pasted);
  assert.deepEqual(withoutPastedPage(pasted, 'https://www.example.com/a/'), ['https://example.org/b?x=1']);
  assert.deepEqual(readPastedPages(['https://example.com/a', 'about:blank', 42, 'https://example.com/a#x', 'example.org']), ['https://example.com/a', 'https://example.org/']);
  assert.deepEqual(readPastedPages('nope'), []);
  let many: string[] = [];
  for (let i = 0; i < MAX_PASTED_PAGES + 5; i++) many = withPastedPage(many, `https://example.com/${i}`)!;
  assert.equal(many.length, MAX_PASTED_PAGES);
  assert.equal(many[many.length - 1], `https://example.com/${MAX_PASTED_PAGES + 4}`);
  // A pasted page that is also one of the task's links is one tab, and the link's.
  const tabs = deriveSurfaces({ links: [{ label: 'Rubric', href: 'https://example.com/a', kind: 'canvas' }], next: null, work: null, pasted });
  assert.deepEqual(tabs.map((t) => [t.label, t.kind === 'web' ? t.pasted === true : null]), [['Work', null], ['Rubric', false], ['example.org', true]]);
});

test('the pasted pages of a task are stored per task and survive a reload', async () => {
  await withDataDir(async (dir) => {
    const route = await import('../src/app/api/tasks/workspace-tabs/route');
    const url = 'http://127.0.0.1:3000/api/tasks/workspace-tabs';
    const read = async (id: string) => (await (await route.GET(new NextRequest(`${url}?id=${id}`))).json()).data.pasted;
    assert.deepEqual(await read(TASK), []);                                            // no file yet
    assert.equal(fs.existsSync(path.join(dir, 'tasks', 'workspace-tabs.json')), false);   // and reading made none
    assert.deepEqual((await (await route.POST(postJson(url, { taskId: TASK, action: 'add', url: 'example.com' }))).json()).data.pasted, ['https://example.com/']);
    await route.POST(postJson(url, { taskId: TASK, action: 'add', url: 'https://example.org/b' }));
    await route.POST(postJson(url, { taskId: 'other', action: 'add', url: 'https://example.net/' }));
    assert.equal((await route.POST(postJson(url, { taskId: TASK, action: 'add', url: 'javascript:alert(1)' }))).status, 400);
    assert.equal((await route.POST(postJson(url, { taskId: TASK, action: 'open', url: 'https://example.org' }))).status, 400);
    assert.deepEqual(await read(TASK), ['https://example.com/', 'https://example.org/b']);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'tasks', 'workspace-tabs.json'), 'utf-8'));
    assert.equal(onDisk.schemaVersion, 1);
    assert.deepEqual(Object.keys(onDisk.tabs).sort(), [TASK, 'other'].sort());
    await route.POST(postJson(url, { taskId: TASK, action: 'remove', url: 'https://www.example.com' }));
    assert.deepEqual(await read(TASK), ['https://example.org/b']);
    await route.POST(postJson(url, { taskId: TASK, action: 'remove', url: 'https://example.org/b' }));
    assert.deepEqual(await read(TASK), []);
    assert.deepEqual(await read('other'), ['https://example.net/']);
    // A file someone broke reads as empty and is not an error.
    fs.writeFileSync(path.join(dir, 'tasks', 'workspace-tabs.json'), '{ not json');
    assert.deepEqual(await read(TASK), []);
  });
});

// ---- The live picture.

test('a page OpenClaw is working on is watched at the calm pace, and the job viewer retries at its own pace', () => {
  const adaptive = { kind: 'adaptive' } as const, watching = { kind: 'adaptive', watching: true } as const;
  assert.ok(nextFrameDelay(adaptive, 10 * 60_000, 0) >= 1000);                               // nothing moved for ten minutes: idle
  assert.equal(nextFrameDelay(watching, 10 * 60_000, 0), nextFrameDelay(adaptive, 5000, 0));   // a turn is out: still the watching pace
  assert.equal(nextFrameDelay(watching, 100, 0), nextFrameDelay(adaptive, 100, 0));          // and quick when he acts
  assert.ok(nextFrameDelay(watching, 0, 3) >= 4000);                                         // a browser that is down is not hammered
  const steady = { kind: 'steady', everyMs: 700 } as const;
  for (const failures of [0, 1, 2, 9]) assert.equal(nextFrameDelay(steady, 60_000, failures), 700);
});

// ---- Only this app's own pages reach OpenClaw's browser.

test('the same-origin guard passes this app’s pages behind a proxy and refuses other sites', () => {
  const ask = (headers: Record<string, string>) => fromThisApp(new Headers(headers));
  // Production: tailscale serve terminates https and proxies to 127.0.0.1:3000, keeping the public Host.
  assert.equal(ask({ host: 'box.tail1234.ts.net', 'sec-fetch-site': 'same-origin', origin: 'https://box.tail1234.ts.net', 'x-forwarded-host': 'box.tail1234.ts.net', 'x-forwarded-proto': 'https' }), true);
  // A frame fetch is a GET: the browser sends Sec-Fetch-Site and no Origin.
  assert.equal(ask({ host: 'box.tail1234.ts.net', 'sec-fetch-site': 'same-origin' }), true);
  assert.equal(ask({ host: 'box.tail1234.ts.net', 'sec-fetch-site': 'none' }), true);        // an address he typed
  // Another site's page, however it asks.
  assert.equal(ask({ host: 'box.tail1234.ts.net', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }), false);
  assert.equal(ask({ host: 'box.tail1234.ts.net', 'sec-fetch-site': 'same-site', origin: 'https://other.tail1234.ts.net' }), false);
  assert.equal(ask({ host: 'box.tail1234.ts.net', 'sec-fetch-site': 'cross-site' }), false);                       // an <img> on another page
  // Sec-Fetch-Site wins: a matching Origin does not rescue a cross-site request.
  assert.equal(ask({ host: 'box.tail1234.ts.net', 'sec-fetch-site': 'cross-site', origin: 'https://box.tail1234.ts.net' }), false);
  // Plain http on a tailnet or LAN address: no Sec-Fetch-Site, so Origin must name the host asked.
  assert.equal(ask({ host: '100.64.0.7:3000', origin: 'http://100.64.0.7:3000' }), true);
  assert.equal(ask({ host: '100.64.0.7:3000', origin: 'http://evil.example' }), false);
  assert.equal(ask({ host: '100.64.0.7:3000', origin: 'http://100.64.0.7:8080' }), false);                         // another port is another origin
  assert.equal(ask({ host: 'Box.Tail1234.ts.net', origin: 'http://box.tail1234.ts.net' }), true);                  // names compare without case
  // A proxy that rewrites Host to the upstream and passes the public name in X-Forwarded-Host.
  assert.equal(ask({ host: '127.0.0.1:3000', 'x-forwarded-host': 'journal.example.net', origin: 'https://journal.example.net' }), true);
  assert.equal(ask({ host: '127.0.0.1:3000', 'x-forwarded-host': 'journal.example.net', origin: 'https://evil.example' }), false);
  assert.equal(ask({ host: '127.0.0.1:3000', origin: 'https://journal.example.net' }), false);                     // Host rewritten and nothing forwarded
  // Origin that is not an origin: a sandboxed frame, a file, junk.
  assert.equal(ask({ host: '100.64.0.7:3000', origin: 'null' }), false);
  assert.equal(ask({ host: '100.64.0.7:3000', origin: 'not a url' }), false);
  // No Sec-Fetch-Site and no Origin: not a page (curl, the CLI on the machine), or a plain-http GET from this app.
  assert.equal(ask({ host: '127.0.0.1:3000' }), true);
  assert.equal(ask({}), true);
});

test('the browser route refuses another site before touching the browser, and never closes a tab it did not make', async () => {
  const route = await import('../src/app/api/openclaw/browser/route');
  const url = 'http://127.0.0.1:3000/api/openclaw/browser';
  const cross = new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'text/plain', 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' }, body: JSON.stringify({ action: 'open', url: 'https://example.com' }) });
  assert.equal((await route.POST(cross)).status, 403);
  assert.equal((await route.GET(new NextRequest(`${url}?targetId=x`, { headers: { origin: 'http://evil.example', host: '100.64.0.7:3000' } }))).status, 403);
  // A tab the Journal did not open is left alone: reported as kept, and nothing is sent to the browser.
  const kept = await (await route.POST(postJson(url, { action: 'close', targetIds: ['SOMEONE-ELSES-TAB'] }))).json();
  assert.deepEqual([kept.success, kept.closed, kept.kept], [true, [], ['SOMEONE-ELSES-TAB']]);
  assert.equal((await route.POST(postJson(url, { action: 'close', targetIds: [] }))).status, 400);
});

// ---- The session index on a server that has none.

test('a server with no session index says nothing is indexed, and reading does not make one', async () => {
  await withDataDir(async (dir) => {
    const { GET: card } = await import('../src/app/api/session-index/card/route');
    const { GET: search } = await import('../src/app/api/session-index/search/route');
    const { POST: feedback } = await import('../src/app/api/session-index/feedback/route');
    const { closeIndex } = await import('../src/lib/session-index/store');
    closeIndex();
    const base = 'http://127.0.0.1:3000/api/session-index';
    const got = await card(new NextRequest(`${base}/card?target=task:${TASK}`));
    assert.equal(got.status, 200);
    assert.deepEqual(await got.json(), { success: true, data: { rows: [], indexed: 0, hosts: [] } });
    const found = await search(new NextRequest(`${base}/search?q=gripper`));
    assert.equal(found.status, 200);
    assert.deepEqual((await found.json()).data, []);
    const linked = await feedback(postJson(`${base}/feedback`, { target: `task:${TASK}`, uid: 'claude-code:abc', verdict: 'link' }));
    assert.equal(linked.status, 400);
    assert.equal((await feedback(postJson(`${base}/feedback`, { target: `task:${TASK}`, uid: 'claude-code:abc', verdict: 'clear' }))).status, 200);
    assert.equal(fs.existsSync(path.join(dir, 'session-index')), false);
    // An inbox with nothing folded in yet is still "nothing indexed".
    fs.mkdirSync(path.join(dir, 'session-index', 'inbox', 'laptop'), { recursive: true });
    assert.equal((await (await card(new NextRequest(`${base}/card?target=task:${TASK}`))).json()).data.indexed, 0);
    assert.equal(fs.existsSync(path.join(dir, 'session-index', 'index.db')), false);
  });
});
