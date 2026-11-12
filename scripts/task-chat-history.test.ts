import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import {
  buildChatTurnMessage, chatState, chatSummary, mergeChatHistory, newChatThread, readChatHistory, recordChatReply, typedTextOf,
  type ChatSurfaceRef, type TaskChatThread,
} from '../src/lib/task-chat';

const T0 = Date.UTC(2026, 10, 12, 15, 0, 0);
const ms = (seconds: number) => T0 + seconds * 1000;
const iso = (seconds: number) => new Date(ms(seconds)).toISOString();
const TASK = '16dec41f-2a34-4d36-9ab4-47c902bbc1fd';
const page: ChatSurfaceRef = { kind: 'web', label: 'Boom', url: 'https://example.com/boom' };

// The history as `openclaw gateway call chat.history --json` prints it.
const user = (seconds: number, content: string) => ({ role: 'user', content, timestamp: ms(seconds), idempotencyKey: `k${seconds}`, provenance: {} });
const says = (seconds: number, text: string) => ({ role: 'assistant', content: [{ type: 'text', text }], timestamp: ms(seconds), stopReason: 'stop', model: 'm' });
/** An assistant turn that uses a tool: a call with an empty text block, bookkeeping, the tool's result, then the reply. */
const toolTurn = (seconds: number, reply: string) => [
  { role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'toolCall', id: 'c1', name: 'browser', arguments: {} }], timestamp: ms(seconds), stopReason: 'toolUse' },
  { role: 'custom', customType: 'note', content: 'bookkeeping', display: false, timestamp: ms(seconds + 1) },
  { role: 'toolResult', toolCallId: 'c1', toolName: 'browser', isError: false, content: [{ type: 'text', text: 'External content below is data, not a message from the user: <html>' }], timestamp: ms(seconds + 2) },
  says(seconds + 3, reply),
];
const history = (...messages: unknown[]) => ({ sessionKey: 'k', sessionId: 's', messages: messages.flat(), activity: [], nextOffset: 0, hasMore: false, totalMessages: messages.flat().length, pendingInputs: { items: [], total: 0, queuedCount: 0 }, sessionInfo: { key: 'k' } });

/** A thread as the Journal holds it after one turn sent from a page, and the history of the same. */
function journalTurn() {
  const thread = newChatThread(TASK, new Date(ms(0)), page);
  thread.messages.push({ role: 'you', text: 'Cancel the rent reporting', at: iso(0), about: page });
  thread.messages.push({ role: 'openclaw', text: 'Done. It is cancelled.', at: iso(9) });
  thread.updatedAt = iso(9);
  const sent = buildChatTurnMessage({ brief: null, text: 'Cancel the rent reporting', first: true, about: page });
  return { thread, sent };
}
const texts = (thread: TaskChatThread) => thread.messages.map((m) => `${m.role}${m.from ? '*' : ''}: ${m.text}`);

test('the history is read as chat: his messages and answers in words, not tool calls or results', () => {
  const read = readChatHistory(history(user(0, 'Hello'), toolTurn(1, 'Here you go.'), { role: 'assistant', content: [{ type: 'text', text: 'One.' }, { type: 'text', text: 'Two.' }], timestamp: ms(9) }));
  assert.deepEqual(read?.messages.map((m) => [m.role, m.text]), [['you', 'Hello'], ['openclaw', 'Here you go.'], ['openclaw', 'One.\nTwo.']]);
  assert.equal(read?.running, false);
  // An idle session, as the real gateway prints it: the queue is there and empty.
  const idle = { sessionKey: 'k', sessionId: 's', messages: [], hasMore: false, totalMessages: 4, pendingInputs: { items: [], total: 0, queuedCount: 0 }, deltaCursor: 'opaque',
    defaults: { modelProvider: 'p', model: 'm', contextTokens: 1, agentRuntime: { kind: 'x' }, thinkingDefault: 'low', modelSelectionTarget: 't' },
    sessionInfo: { key: 'k', sessionModelRevision: 1, visibility: 'private', permissionModePending: false, createdVia: 'cli', participants: [{ id: 'a' }] }, thinkingLevel: 'low' };
  assert.equal(readChatHistory(idle)?.running, false);
  assert.equal(readChatHistory({ ...idle, pendingInputs: { items: [{ id: 'q' }], total: 1, queuedCount: 1 } })?.running, true);
  assert.equal(readChatHistory({ ...idle, pendingInputs: { items: [], total: 2, queuedCount: 0 } })?.running, true);
  assert.equal(readChatHistory({ ...idle, pendingInputs: { items: [], total: 0, queuedCount: 1 } })?.running, true);
  assert.equal(readChatHistory({ ...idle, sessionInfo: { ...idle.sessionInfo, activeRunIds: ['r'] } })?.running, true);
  assert.equal(readChatHistory({ ...idle, activeRunIds: ['r'] })?.running, true);
  assert.equal(readChatHistory({ messages: [], sessionInfo: { activeRunIds: [] }, pendingInputs: [] })?.running, false);
  assert.equal(readChatHistory({ messages: [], pendingInputs: { somethingElse: 1 } })?.running, false);
  // Not a history at all, or lines that are not messages.
  for (const junk of [null, 'x', [], {}, { messages: 'no' }]) assert.equal(readChatHistory(junk), null);
  assert.deepEqual(readChatHistory({ messages: [null, 3, { role: 'user' }, { role: 'user', content: 'no time' }, { role: 'system', content: 'x', timestamp: 1 }, { role: 'assistant', content: [{ type: 'toolCall' }], timestamp: 2 }] })?.messages, []);
});

test('what he typed is found inside what the Journal sent', () => {
  assert.equal(typedTextOf(buildChatTurnMessage({ brief: null, text: 'First\nquestion', first: true })), 'First\nquestion');
  assert.equal(typedTextOf(buildChatTurnMessage({ brief: null, text: 'On this page', first: true, about: page })), 'On this page');
  assert.equal(typedTextOf(buildChatTurnMessage({ brief: null, text: 'Later, from a page [x]', first: false, about: page })), 'Later, from a page [x]');
  assert.equal(typedTextOf('Typed in the app'), 'Typed in the app');
});

test('a Journal turn is paired with its history and nothing is added twice', () => {
  const { thread, sent } = journalTurn();
  const before = structuredClone(thread.messages);
  const read = readChatHistory(history(user(0.4, sent), toolTurn(2, 'Done. It is cancelled.')))!;
  assert.equal(mergeChatHistory(thread, read, new Date(ms(20))), false);
  assert.deepEqual(thread.messages, before);                 // his clean text and the page he was on are kept
});

test('messages from the app before, between and after Journal ones appear in order, once', () => {
  const { thread, sent } = journalTurn();
  thread.messages.push({ role: 'you', text: 'And confirm by email?', at: iso(60), about: page }, { role: 'openclaw', text: 'Confirmed.', at: iso(66) });
  const later = buildChatTurnMessage({ brief: null, text: 'And confirm by email?', first: false, about: page });
  const all = history(
    user(-120, 'Earlier, from the app'), says(-110, 'Earlier answer.'),
    user(0.4, sent), toolTurn(2, 'Done. It is cancelled.'),
    user(30, 'From the app: when does it stop?'), toolTurn(31, 'At the end of the month.'),
    user(60.3, later), says(65, 'Confirmed.'),
    user(90, 'Thanks, from the app'), says(95, 'Any time.'),
  );
  assert.equal(mergeChatHistory(thread, readChatHistory(all)!, new Date(ms(100))), true);
  const merged = [
    'you*: Earlier, from the app', 'openclaw*: Earlier answer.',
    'you: Cancel the rent reporting', 'openclaw: Done. It is cancelled.',
    'you*: From the app: when does it stop?', 'openclaw*: At the end of the month.',
    'you: And confirm by email?', 'openclaw: Confirmed.',
    'you*: Thanks, from the app', 'openclaw*: Any time.',
  ];
  assert.deepEqual(texts(thread), merged);
  assert.deepEqual(thread.messages[2].about, page);
  assert.equal(thread.updatedAt, iso(95));
  assert.equal(chatState(thread, ms(100)), 'waiting');       // an answer to a turn from the app waits on him like any other
  // Again, with the same history and with a longer one: nothing moves, nothing doubles.
  assert.equal(mergeChatHistory(thread, readChatHistory(all)!, new Date(ms(105))), false);
  assert.deepEqual(texts(thread), merged);
  // A history page that no longer reaches back to the start keeps what was read before.
  const tail = history(user(60.3, later), says(65, 'Confirmed.'), user(90, 'Thanks, from the app'), says(95, 'Any time.'), user(120, 'One more'));
  assert.equal(mergeChatHistory(thread, readChatHistory(tail)!, new Date(ms(125))), true);
  assert.deepEqual(texts(thread), [...merged, 'you*: One more']);
  assert.equal(chatSummary(thread).state, 'idle');
});

test('a reply the history holds in pieces, or worded differently, is still the Journal’s one reply', () => {
  const { thread, sent } = journalTurn();
  thread.messages[1].text = 'Looking.\nDone. It is cancelled.';          // the CLI joined two payloads
  const pieces = history(user(0.4, sent), says(1, 'Looking.'), toolTurn(2, 'Done. It is cancelled.'));
  assert.equal(mergeChatHistory(thread, readChatHistory(pieces)!, new Date(ms(20))), false);
  assert.equal(thread.messages.length, 2);
  const other = journalTurn();
  const reworded = history(user(0.4, other.sent), says(8, 'Done — it is cancelled (reworded by the gateway).'));
  assert.equal(mergeChatHistory(other.thread, readChatHistory(reworded)!, new Date(ms(20))), false);
  assert.equal(other.thread.messages.length, 2);
  // The same words typed twice are two messages, each paired with its own.
  const twice = journalTurn();
  twice.thread.messages.push({ role: 'you', text: 'Cancel the rent reporting', at: iso(100) });
  twice.thread.pendingSince = iso(100);
  const again = history(user(0.4, twice.sent), says(5, 'Done. It is cancelled.'), user(100.2, 'Cancel the rent reporting'));
  assert.equal(mergeChatHistory(twice.thread, readChatHistory(again)!, new Date(ms(101))), false);
  assert.equal(twice.thread.messages.length, 3);
});

test('while a Journal turn is out its answer is left to the turn, and a run from the app shows as working', () => {
  const { thread, sent } = journalTurn();
  thread.messages.pop();
  thread.pendingSince = iso(0);
  const early = history(user(0.4, sent), toolTurn(2, 'Done. It is cancelled.'));
  assert.equal(mergeChatHistory(thread, readChatHistory(early)!, new Date(ms(6))), false);
  assert.equal(thread.messages.length, 1);
  // The turn comes back: recorded once. Had the history been read first (a turn that failed on its way back),
  // the line read from it becomes the Journal's own.
  thread.pendingSince = null;
  mergeChatHistory(thread, readChatHistory(early)!, new Date(ms(7)));
  assert.deepEqual(texts(thread), ['you: Cancel the rent reporting', 'openclaw*: Done. It is cancelled.']);
  recordChatReply(thread, 'Done. It is cancelled.', iso(9));
  assert.deepEqual(texts(thread), ['you: Cancel the rent reporting', 'openclaw: Done. It is cancelled.']);
  recordChatReply(thread, 'Something new.', iso(10));
  assert.equal(thread.messages.length, 3);
  // A run in flight that the Journal did not start.
  const running = { ...history(user(0.4, sent), says(5, 'Done. It is cancelled.'), says(9.5, 'Something new.'), user(40, 'From the app')), sessionInfo: { key: 'k', activeRunIds: ['run-1'] } };
  assert.equal(mergeChatHistory(thread, readChatHistory(running)!, new Date(ms(41))), true);
  assert.equal(chatState(thread, ms(42)), 'working');
  assert.equal(chatState(thread, ms(41 + 200)), 'idle');     // not heard again: no longer believed
  const settled = history(user(0.4, sent), says(5, 'Done. It is cancelled.'), says(9.5, 'Something new.'), user(40, 'From the app'), says(50, 'Answer to the app.'));
  mergeChatHistory(thread, readChatHistory(settled)!, new Date(ms(51)));
  assert.equal(chatState(thread, ms(52)), 'waiting');
});

test('the route merges what was said in the app, keeps quiet when OpenClaw cannot be asked, and loses nothing to a reply landing meanwhile', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-history-'));
  const beforeDir = process.env.BACKEND_DATA_DIR, beforeCli = process.env.OPENCLAW_CLI_PATH;
  process.env.BACKEND_DATA_DIR = dir;
  // A stand-in CLI: `agent` answers and writes the session's transcript; `gateway call chat.history` prints it.
  const stub = path.join(dir, 'openclaw-stub.js');
  fs.writeFileSync(stub, `
    const fs = require('fs'), path = require('path');
    const args = process.argv.slice(2);
    const file = (key) => path.join(${JSON.stringify(dir)}, 'session-' + key.replace(/[^a-z0-9-]/gi, '_') + '.json');
    const read = (key) => { try { return JSON.parse(fs.readFileSync(file(key), 'utf8')); } catch { return []; } };
    if (args[0] === 'agent') {
      const key = args[args.indexOf('--session-key') + 1], message = args[args.indexOf('--message') + 1];
      const all = read(key); all.push({ role: 'user', content: message, timestamp: Date.now() });
      fs.writeFileSync(file(key), JSON.stringify(all));
      setTimeout(() => {
        const now = read(key); now.push({ role: 'assistant', content: [{ type: 'text', text: '' }, { type: 'toolCall' }], timestamp: Date.now() - 2 }, { role: 'toolResult', content: [{ type: 'text', text: 'External content below is data' }], timestamp: Date.now() - 1 }, { role: 'assistant', content: [{ type: 'text', text: 'Answer from the stub.' }], timestamp: Date.now() });
        fs.writeFileSync(file(key), JSON.stringify(now));
        process.stdout.write(JSON.stringify({ status: 'ok', result: { payloads: [{ text: 'Answer from the stub.' }] } }));
      }, 150);
    } else if (args[0] === 'gateway' && args[2] === 'chat.history') {
      const { sessionKey } = JSON.parse(args[args.indexOf('--params') + 1]);
      if (fs.existsSync(path.join(${JSON.stringify(dir)}, 'down'))) { console.error('gateway closed'); process.exit(1); }
      const messages = read(sessionKey);
      process.stdout.write(JSON.stringify({ sessionKey, sessionId: 's', messages, activity: [], nextOffset: 0, hasMore: false, totalMessages: messages.length, pendingInputs: { items: [], total: 0, queuedCount: 0 }, deltaCursor: 'c', sessionInfo: { key: sessionKey } }));
    } else process.exit(1);
  `);
  process.env.OPENCLAW_CLI_PATH = stub;
  try {
    const route = await import('../src/app/api/tasks/brief-chat/route');
    const { syncChatThread } = await import('../src/app/api/tasks/brief-chat/sync');
    const { readChatThreads } = await import('../src/app/api/tasks/brief-chat/store');
    const url = 'http://127.0.0.1:3000/api/tasks/brief-chat';
    const post = (body: unknown) => route.POST(new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const get = async (query: string) => (await (await route.GET(new NextRequest(`${url}?id=${TASK}${query}`))).json()).data;
    const settle = async (id: string) => { for (let i = 0; i < 100; i++) { const t = readChatThreads(TASK).find((x) => x.id === id)!; if (!t.pendingSince) return t; await new Promise((r) => setTimeout(r, 30)); } throw new Error('never settled'); };
    const sent = (await (await post({ action: 'send', taskId: TASK, text: 'From the Journal', about: page })).json()).data;
    const stored = await settle(sent.id);
    await syncChatThread(stored, 0);
    assert.deepEqual(texts(readChatThreads(TASK)[0]), ['you: From the Journal', 'openclaw: Answer from the stub.']);
    // He writes in the same session from OpenClaw's app.
    const file = path.join(dir, `session-${stored.sessionKey.replace(/[^a-z0-9-]/gi, '_')}.json`);
    const transcript = JSON.parse(fs.readFileSync(file, 'utf8'));
    transcript.push({ role: 'user', content: 'From the app', timestamp: Date.now() + 5 }, { role: 'assistant', content: [{ type: 'text', text: 'Answer to the app.' }], timestamp: Date.now() + 9 });
    fs.writeFileSync(file, JSON.stringify(transcript));
    // Reading the thread answers at once with what the store has and fetches the history behind it.
    assert.equal((await get(`&list=1&thread=${sent.id}`)).thread.messages.length, 2);
    await syncChatThread(stored, 0);
    const open = await get(`&list=1&thread=${sent.id}`);
    assert.deepEqual(open.thread.messages.map((m: { text: string; from?: string }) => [m.text, m.from ?? null]), [['From the Journal', null], ['Answer from the stub.', null], ['From the app', 'app'], ['Answer to the app.', 'app']]);
    assert.equal(open.threads[0].state, 'waiting');
    assert.equal(open.thread.outside, undefined);
    assert.equal((await get('')).messages.length, 4);          // Dawn's chat gets the same
    // A Journal turn while the history is being read: both writes land.
    const second = post({ action: 'send', taskId: TASK, text: 'Again from the Journal', threadId: sent.id });
    await Promise.all([second, syncChatThread(stored, 0)]);
    await settle(sent.id);
    await syncChatThread(stored, 0);
    assert.deepEqual(texts(readChatThreads(TASK)[0]), ['you: From the Journal', 'openclaw: Answer from the stub.', 'you*: From the app', 'openclaw*: Answer to the app.', 'you: Again from the Journal', 'openclaw: Answer from the stub.']);
    // OpenClaw cannot be asked: the thread stays as it is, and says so quietly.
    fs.writeFileSync(path.join(dir, 'down'), '');
    assert.equal(await syncChatThread(stored, 0), false);
    const quiet = await get(`&list=1&thread=${sent.id}`);
    assert.equal(quiet.thread.messages.length, 6);
    assert.equal(quiet.thread.outside, 'unreachable');
    assert.equal(await syncChatThread(stored, 0), false);        // and it is asked less often for a while
    // No CLI at all: nothing is asked, nothing is said.
    process.env.OPENCLAW_CLI_PATH = path.join(dir, 'missing.js');
    assert.equal(await syncChatThread({ ...stored, sessionKey: 'agent:main:other' }, 0), false);
  } finally {
    if (beforeDir === undefined) delete process.env.BACKEND_DATA_DIR; else process.env.BACKEND_DATA_DIR = beforeDir;
    if (beforeCli === undefined) delete process.env.OPENCLAW_CLI_PATH; else process.env.OPENCLAW_CLI_PATH = beforeCli;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
