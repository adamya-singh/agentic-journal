import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskBrief, type BriefTaskRef } from '../src/lib/task-brief';
import {
  buildChatTurnMessage, chatSessionKey, chatsGlance, chatState, chatSummary, chatTitle, latestChat, listChats, markChatSeen, migrateChatThreads,
  newChatThread, parseSurfaceRef, settleStalePending, CHAT_SCHEMA_VERSION, CHAT_TURN_TIMEOUT_MS, type TaskChatThread,
} from '../src/lib/task-chat';
import { defaultSurfaceId, deriveSurfaces, pageKey, safeWebUrl } from '../src/lib/task-surfaces';
import { nextFrameDelay, keyToInput } from '../src/components/openclaw-browser/stream';
import { chatsLine } from '../src/components/sunrise/glance';
import { glanceFor } from '../src/lib/sunrise/form-spec';

const now = new Date(2026, 9, 8, 12, 0);

test('the first turn carries the brief, later turns go as typed', () => {
  const refs: BriefTaskRef[] = [{ task: { id: 'ff', text: '[Data Context] Fair Face', dueDate: '2026-10-09', notesMarkdown: 'Read the two articles.' }, listType: 'have-to-do' }];
  const brief = buildTaskBrief({ taskId: 'ff', tasks: refs, completed: [], journal: [], now });
  assert.ok(brief);
  const first = buildChatTurnMessage({ brief, text: 'What does the rubric want?', first: true });
  assert.match(first, /Task: \[Data Context\] Fair Face/);
  assert.match(first, /Read the two articles\./);
  assert.match(first, /Journal task id: ff \(have-to-do\)/);
  assert.ok(first.trimEnd().endsWith('What does the rubric want?'));
  assert.equal(buildChatTurnMessage({ brief, text: 'Thanks', first: false }), 'Thanks');
});

test('session keys are per thread and safe', () => {
  const key = chatSessionKey('Task ID/42', now);
  assert.equal(key, `agent:main:journal-chat-task-id-42-${now.getTime()}`);
});

test('a turn lost to a restart settles as failed', () => {
  const thread: TaskChatThread = { ...newChatThread('ff', now), pendingSince: now.toISOString() };
  assert.equal(settleStalePending(thread, new Date(now.getTime() + 60_000)), false);
  assert.ok(thread.pendingSince);
  assert.equal(settleStalePending(thread, new Date(now.getTime() + CHAT_TURN_TIMEOUT_MS + 120_000)), true);
  assert.equal(thread.pendingSince, null);
  assert.ok(thread.error);
});

// ---- Several chats per task.

const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
function said(thread: TaskChatThread, role: 'you' | 'openclaw', text: string, when: Date) {
  thread.messages.push({ role, text, at: when.toISOString() });
  thread.updatedAt = when.toISOString();
  if (role === 'you') thread.seenAt = when.toISOString();
}

test('a version-1 file becomes a list per task with nothing dropped', () => {
  const key = `agent:main:journal-chat-ff-${now.getTime()}`;
  const v1 = {
    _comment: 'old', schemaVersion: 1,
    threads: {
      ff: { taskId: 'ff', sessionKey: key, pendingSince: null, error: null, messages: [
        { role: 'you', text: 'What   does the rubric want, exactly, for the second part of the Fair Face write-up?', at: at(0).toISOString() },
        { role: 'openclaw', text: 'Three things.', at: at(1).toISOString() },
      ] },
      failed: { taskId: 'failed', sessionKey: 'agent:main:journal-chat-failed-1792879728712', pendingSince: null, error: 'OpenClaw couldn’t answer.', messages: [{ role: 'you', text: 'Hi', at: at(2).toISOString() }] },
      broken: { nothing: true },
    },
  };
  const { threads, migrated } = migrateChatThreads(v1);
  assert.equal(migrated, true);
  assert.deepEqual(Object.keys(threads).sort(), ['failed', 'ff']);
  const [ff] = threads.ff;
  assert.equal(threads.ff.length, 1);
  assert.equal(ff.sessionKey, key);                       // the same OpenClaw session
  assert.deepEqual(ff.messages, v1.threads.ff.messages);   // every message, untouched
  assert.equal(ff.title, 'What does the rubric want, exactly, for the second part of…');
  assert.equal(ff.createdAt, at(0).toISOString());
  assert.equal(ff.updatedAt, at(1).toISOString());
  assert.equal(ff.about, null);
  // What was already there before chats became a list is not suddenly "waiting on him".
  assert.equal(chatState(ff), 'idle');
  assert.equal(threads.failed[0].error, 'OpenClaw couldn’t answer.');
  assert.equal(threads.failed[0].createdAt, at(2).toISOString());

  // Read again as version 2, it is unchanged and not migrated twice.
  const again = migrateChatThreads({ schemaVersion: CHAT_SCHEMA_VERSION, threads: JSON.parse(JSON.stringify(threads)) });
  assert.equal(again.migrated, false);
  assert.deepEqual(again.threads, threads);
  // Nothing at all, or rubbish, is an empty store rather than a crash.
  assert.deepEqual(migrateChatThreads(null).threads, {});
  assert.deepEqual(migrateChatThreads({ schemaVersion: 2, threads: 'no' }).threads, {});
});

test('a task keeps several chats, most recent first, each its own session', () => {
  const first = newChatThread('ff', at(0), { kind: 'work', label: 'Outline' });
  said(first, 'you', 'Outline it', at(0));
  said(first, 'openclaw', 'Done.', at(1));
  const second = newChatThread('ff', at(5), { kind: 'web', label: 'Rubric', url: 'https://example.com/rubric' });
  said(second, 'you', 'Read this page', at(5));
  const empty = newChatThread('ff', at(9));
  const all = [first, second, empty];
  assert.notEqual(first.sessionKey, second.sessionKey);
  assert.notEqual(first.id, second.id);
  assert.deepEqual(listChats(all).map((t) => t.id), [second.id, first.id]);   // the empty one is not listed
  assert.equal(latestChat(all)?.id, empty.id);                                // but a bare send goes to it
  assert.equal(latestChat([]), undefined);
  const summary = chatSummary(first);
  assert.deepEqual([summary.title, summary.last, summary.lastRole, summary.count, summary.about?.kind], ['New chat', 'Done.', 'openclaw', 2, 'work']);
  assert.equal(chatTitle('  Go through\nthe posting with me  '), 'Go through the posting with me');
});

test('a chat is working, waiting on him, or idle', () => {
  const thread = newChatThread('ff', at(0));
  assert.equal(chatState(thread), 'idle');
  said(thread, 'you', 'Hello', at(0));
  thread.pendingSince = at(0).toISOString();
  assert.equal(chatState(thread), 'working');
  thread.pendingSince = null;
  said(thread, 'openclaw', 'Hi.', at(2));
  assert.equal(chatState(thread), 'waiting');             // he has not looked since OpenClaw answered
  assert.deepEqual(chatsGlance([thread]), { count: 1, waiting: 1, working: 0 });
  assert.equal(markChatSeen(thread, at(3)), true);
  assert.equal(chatState(thread), 'idle');
  assert.equal(markChatSeen(thread, at(4)), false);       // nothing new to see
  said(thread, 'you', 'Thanks', at(5));
  assert.equal(chatState(thread), 'idle');                // his own last word owes him nothing
  thread.seenAt = null;
  said(thread, 'openclaw', 'Any time.', at(6));
  thread.seenAt = null;
  assert.equal(chatState(thread), 'waiting');
  assert.deepEqual(chatsGlance(undefined), { count: 0, waiting: 0, working: 0 });
});

test('a message sent from a web page tells OpenClaw which page', () => {
  const about = parseSurfaceRef({ kind: 'web', label: 'Example Domain', url: 'https://example.com/' });
  assert.ok(about);
  const later = buildChatTurnMessage({ brief: null, text: 'Click the link on this page', first: false, about });
  assert.match(later, /"Example Domain" https:\/\/example\.com\//);
  assert.ok(later.endsWith('Click the link on this page'));
  const first = buildChatTurnMessage({ brief: null, text: 'Summarise it', first: true, about });
  assert.match(first, /https:\/\/example\.com\//);
  assert.ok(first.endsWith('Summarise it'));
  // From the work, or from nowhere, the message goes as typed.
  assert.equal(buildChatTurnMessage({ brief: null, text: 'Thanks', first: false, about: { kind: 'work', label: 'Outline' } }), 'Thanks');
  // A surface that is not a real page is not a surface.
  assert.equal(parseSurfaceRef({ kind: 'web', label: 'x', url: 'javascript:alert(1)' }), null);
  assert.equal(parseSurfaceRef({ kind: 'web', label: 'x' }), null);
  assert.equal(parseSurfaceRef({ kind: 'canvas', label: 'x' }), null);
  assert.deepEqual(parseSurfaceRef({ kind: 'work', label: '' }), { kind: 'work', label: 'Work' });
});

// ---- The workspace's surfaces, and what OpenClaw's browser may be sent to.

test('only http and https addresses reach OpenClaw’s browser', () => {
  assert.equal(safeWebUrl('https://example.com/a?b=1#c'), 'https://example.com/a?b=1#c');
  assert.equal(safeWebUrl('  http://example.com  '), 'http://example.com/');
  assert.equal(safeWebUrl('example.com/page'), 'https://example.com/page');
  assert.equal(safeWebUrl('localhost:3000/x'), 'https://localhost:3000/x');
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<p>', 'file:///etc/passwd', 'about:blank', 'chrome://settings', 'view-source:https://example.com',
    'ftp://example.com', 'mailto:a@example.com', 'https://user:pass@example.com', 'just words', 'word', '', '   ', '/jobs?tab=1', 'https://', 42, null, undefined, `https://example.com/${'a'.repeat(2100)}`]) {
    assert.equal(safeWebUrl(bad), null, String(bad));
  }
  assert.equal(pageKey('https://www.example.com/a/?q=1#top'), pageKey('https://example.com/a?q=1'));
  assert.notEqual(pageKey('https://example.com/a?q=1'), pageKey('https://example.com/a?q=2'));
  assert.notEqual(pageKey('https://example.com/a'), pageKey('https://example.com/b'));
});

test('a task’s tabs are its work and one page per real link', () => {
  const links = [
    { label: 'Assignment', href: 'https://canvas.example.edu/courses/1/assignments/2', kind: 'canvas' },
    { label: 'Same, again', href: 'https://canvas.example.edu/courses/1/assignments/2/', kind: 'link' },
    { label: 'Application', href: '/jobs?listing=abc', kind: 'app' },
    { label: 'Bad', href: 'javascript:alert(1)', kind: 'link' },
  ];
  const rich = deriveSurfaces({ links, next: { label: 'Open the assignment', href: 'https://canvas.example.edu/courses/1/assignments/2#top' }, work: { title: 'Fair Face outline', href: 'https://docs.example.com/d/1', blocks: 2 } });
  assert.deepEqual(rich.map((s) => [s.kind, s.label]), [['work', 'Fair Face outline'], ['web', 'Open the assignment'], ['web', 'docs.example.com']]);
  assert.equal(defaultSurfaceId(rich, true), 'work');
  // No work yet: it opens on its first page. No links either: the empty work tab.
  const linksOnly = deriveSurfaces({ links, next: null, work: null });
  assert.deepEqual(linksOnly.map((s) => s.label), ['Work', 'Assignment']);
  assert.equal(defaultSurfaceId(linksOnly, false), linksOnly[1].id);
  const bare = deriveSurfaces({ links: [], next: { label: 'Just do it' }, work: null });
  assert.deepEqual(bare.map((s) => s.id), ['work']);
  assert.equal(defaultSurfaceId(bare, false), 'work');
  // A page he pastes is a tab too, once, and never a non-web address.
  const pasted = deriveSurfaces({ links: [], next: null, work: null, pasted: ['https://example.com/', 'example.com', 'file:///etc/passwd'] });
  assert.deepEqual(pasted.map((s) => (s.kind === 'web' ? [s.url, s.pasted] : s.id)), ['work', ['https://example.com/', true]]);
});

test('the live picture is asked for quickly while he acts and slowly when nothing moves', () => {
  const adaptive = { kind: 'adaptive' } as const;
  const quick = nextFrameDelay(adaptive, 100, 0), watching = nextFrameDelay(adaptive, 5000, 0), idle = nextFrameDelay(adaptive, 60_000, 0);
  assert.ok(quick < watching && watching < idle);
  assert.ok(quick <= 200 && idle >= 1000);
  assert.equal(nextFrameDelay({ kind: 'steady', everyMs: 700 }, 60_000, 0), 700);
  // A browser that is not answering is asked less and less often, not hammered.
  assert.ok(nextFrameDelay(adaptive, 0, 1) >= 1000);
  assert.ok(nextFrameDelay(adaptive, 0, 9) <= 8000 && nextFrameDelay(adaptive, 0, 9) > nextFrameDelay(adaptive, 0, 1));
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => keyToInput({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
  assert.deepEqual(key('a'), { type: 'text', text: 'a' });
  assert.deepEqual(key('Enter'), { type: 'key', key: 'Enter', shift: false });
  assert.deepEqual(key('A', { ctrlKey: true }), { type: 'key', key: 'a', ctrl: true, shift: false });
  assert.equal(key('v', { metaKey: true }), null);   // paste comes as a paste event
  assert.equal(key('F5'), null);
});

// ---- The hover brief.

test('the hover brief says when, the top flag, three facts and the chats', () => {
  const refs: BriefTaskRef[] = [{ task: { id: 'ff', text: '[Data Context] Fair Face', dueDate: '2026-10-09' }, listType: 'have-to-do' }, { task: { id: 'lease', text: 'Renew the lease' }, listType: 'have-to-do' }];
  const brief = buildTaskBrief({ taskId: 'ff', tasks: refs, completed: [], journal: [], now })!;
  const plain = glanceFor(brief);
  assert.equal(plain.when.startsWith(brief.when.day), true);
  assert.equal(plain.left, `in ${brief.when.left}`);
  const rich = glanceFor({
    ...brief,
    flags: [{ level: 'info', text: 'Bring a laptop', src: 'rule' }, { level: 'warn', text: 'Overlaps your lecture', src: 'rule' }],
    facts: ['a', 'b', 'c', 'd'].map((k) => ({ k, v: `${k}!`, src: 'rule' as const })),
  });
  assert.deepEqual(rich.flag, { text: 'Overlaps your lecture', warn: true });   // a warning before a note
  assert.deepEqual(rich.facts.map((f) => f.key), ['a', 'b', 'c']);
  const undated = glanceFor(buildTaskBrief({ taskId: 'lease', tasks: refs, completed: [], journal: [], now })!);
  assert.deepEqual([undated.when, undated.left, undated.flag === null || typeof undated.flag.text === 'string'], ['', '', true]);
  const over = glanceFor({ ...brief, when: { ...brief.when, left: '2d over', zone: 'hold' } });
  assert.deepEqual([over.left, over.zone], ['2d over', 'hold']);

  assert.equal(chatsLine(undefined), null);
  assert.equal(chatsLine({ count: 0, waiting: 0, working: 0 }), null);
  assert.deepEqual(chatsLine({ count: 3, waiting: 1, working: 0 }), { count: '3 chats', state: '1 waiting on you', waiting: true });
  assert.deepEqual(chatsLine({ count: 1, waiting: 1, working: 0 }), { count: '1 chat', state: 'waiting on you', waiting: true });
  assert.deepEqual(chatsLine({ count: 2, waiting: 0, working: 1 }), { count: '2 chats', state: 'OpenClaw is answering', waiting: false });
  assert.deepEqual(chatsLine({ count: 2, waiting: 0, working: 0 }), { count: '2 chats', state: '', waiting: false });
});

test('the store rewrites a version-1 file as version 2 and sets the old file aside first', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-chats-'));
  const before = process.env.BACKEND_DATA_DIR;
  process.env.BACKEND_DATA_DIR = dir;
  try {
    const store = await import('../src/app/api/tasks/brief-chat/store');
    const file = store.briefChatFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const v1 = { _comment: 'old', schemaVersion: 1, threads: { ff: { taskId: 'ff', sessionKey: `agent:main:journal-chat-ff-${now.getTime()}`, pendingSince: null, error: null,
      messages: [{ role: 'you', text: 'Hello', at: now.toISOString() }, { role: 'openclaw', text: 'Hi.', at: now.toISOString() }] } } };
    fs.writeFileSync(file, JSON.stringify(v1, null, 2));
    // Reading changes nothing on disk.
    assert.equal(store.readChatThreads('ff').length, 1);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf-8')).schemaVersion, 1);
    // The first change adds a second chat beside the first, and keeps the old file as it was.
    store.mutateChatThreads((all) => { all.ff.push(newChatThread('ff', at(5))); });
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(onDisk.schemaVersion, CHAT_SCHEMA_VERSION);
    assert.equal(onDisk.threads.ff.length, 2);
    assert.deepEqual(onDisk.threads.ff[0].messages, v1.threads.ff.messages);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'brief-chats.v1.json'), 'utf-8')), v1);
    assert.deepEqual(Object.keys(store.readAllChatThreads()), ['ff']);
  } finally {
    if (before === undefined) delete process.env.BACKEND_DATA_DIR; else process.env.BACKEND_DATA_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
