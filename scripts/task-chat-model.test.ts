// The OpenClaw model picked for a task's chats in its workspace: the list to pick from, the pick kept per task,
// and that every turn from the workspace runs on it, on the turn itself and on the chat's OpenClaw session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { canThinkAt, hasModel, isModelKey, isThinkingLevel, modelInUse, modelName, readModelList, thinkingName } from '../src/lib/openclaw-models';
import { migrateChatThreads } from '../src/lib/task-chat';

const TASK = 'bbcef1b7-24a2-4440-b00f-553854bc7fc8';
const LISTED = {
  count: 4,
  models: [
    { key: 'google-vertex/gemini-3.8-flash', name: 'Gemini 3.8 Flash', available: true, tags: ['default'] },
    { key: 'google-vertex/gemini-4-argon', name: 'Gemini 4 Argon', available: true, tags: [] },
    { key: 'google-vertex/gemini-3.1-pro-preview', name: '', available: true, tags: ['configured'] },
    { key: 'google-vertex/gone', name: 'Gone', available: false, tags: [] },
    { key: 'google-vertex/gemini-4-argon', name: 'Twice', available: true },
    { key: 'not a key', name: 'Bad' },
    null,
  ],
};

// What the gateway's models.list answers: provider and id apart, and the efforts each model can think at.
const levels = (...ids: string[]) => ids.map((id) => ({ id, label: id }));
const GATEWAY = {
  models: [
    { provider: 'google-vertex', id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', tags: ['default'], available: true, thinkingLevels: levels('off', 'low', 'medium', 'high'), thinkingDefault: 'high' },
    { provider: 'google-vertex', id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview', tags: [], available: true, thinkingLevels: [{ id: 'off', label: 'off' }, { id: 'low', label: 'on' }, { id: 'low', label: 'again' }, { id: 'Not A Level' }, 7], thinkingDefault: 'medium' },
    { provider: 'google-vertex', id: 'gemini-4-argon', name: 'Gemini 4 Argon', tags: [], available: true, thinkingLevels: levels('off', 'low', 'medium', 'high', 'ultra'), thinkingDefault: 'high' },
  ],
};

test('the models OpenClaw lists become a list to pick from', () => {
  const list = readModelList(LISTED)!;
  assert.deepEqual(list.models.map(({ key, name, isDefault }) => ({ key, name, isDefault })), [
    { key: 'google-vertex/gemini-3.8-flash', name: 'Gemini 3.8 Flash', isDefault: true },
    { key: 'google-vertex/gemini-4-argon', name: 'Gemini 4 Argon', isDefault: false },
    { key: 'google-vertex/gemini-3.1-pro-preview', name: 'gemini-3.1-pro-preview', isDefault: false },
  ]);
  // `openclaw models list` says nothing of thinking: no efforts to pick from.
  assert.deepEqual(list.models.map((m) => [m.thinking, m.thinkingDefault]), [[[], null], [[], null], [[], null]]);
  assert.equal(list.defaultKey, 'google-vertex/gemini-3.8-flash');
  assert.deepEqual([hasModel(list, 'google-vertex/gemini-4-argon'), hasModel(list, 'google-vertex/gone')], [true, false]);
  assert.deepEqual([modelName(list, 'google-vertex/gemini-4-argon'), modelName(list, 'x/unlisted-model'), modelName(null, 'solo')], ['Gemini 4 Argon', 'unlisted-model', 'solo']);
  assert.deepEqual([readModelList(null), readModelList({ models: [] }), readModelList({ models: 'no' }), readModelList({ models: [{ key: 'a/b', available: false }] })], [null, null, null, null]);
  assert.deepEqual(['google-vertex/gemini-4-argon', 'gpt-5', '', 'has space', '--model', 'a'.repeat(121), 7].map(isModelKey), [true, true, false, false, false, false, false]);
});

test('the gateway’s list says how hard each model can think', () => {
  const list = readModelList(GATEWAY)!;
  const [flash, pro] = list.models;
  assert.deepEqual([flash!.key, flash!.isDefault, flash!.thinkingDefault, flash!.thinking.map((l) => l.id)], ['google-vertex/gemini-3.8-flash', true, 'high', ['off', 'low', 'medium', 'high']]);
  // A level that is not one, or listed twice, is left out; a default that is not among the levels is not kept.
  assert.deepEqual([pro!.thinking, pro!.thinkingDefault], [[{ id: 'off', label: 'off' }, { id: 'low', label: 'on' }], null]);
  assert.equal(list.defaultKey, 'google-vertex/gemini-3.8-flash');
  assert.deepEqual([modelInUse(list, null)?.key, modelInUse(list, pro!.key)?.key, modelInUse(list, 'x/none'), modelInUse(null, null)], [flash!.key, pro!.key, undefined, undefined]);
  assert.deepEqual([canThinkAt(flash, 'medium'), canThinkAt(pro, 'medium'), canThinkAt(undefined, 'low')], [true, false, false]);
  assert.deepEqual([thinkingName(flash, 'high'), thinkingName(pro, 'low'), thinkingName(undefined, 'ultra')], ['High', 'On', 'Ultra']);
  assert.deepEqual(['high', 'off', 'xhigh', 'High', 'a', '', 'two words', '--thinking', 7].map(isThinkingLevel), [true, true, true, false, false, false, false, false, false]);
});

test('a stored chat keeps the model the Journal picked on its session, and drops anything that is not one', () => {
  const stored = { threads: { [TASK]: [
    { id: 'a', sessionKey: 'agent:main:a', messages: [], modelSet: 'google-vertex/gemini-4-argon', thinkingSet: 'low' },
    { id: 'b', sessionKey: 'agent:main:b', messages: [], modelSet: 'not a key', thinkingSet: 'Not A Level' },
  ] } };
  const [a, b] = migrateChatThreads(stored).threads[TASK]!;
  assert.deepEqual([a!.modelSet, a!.thinkingSet, b!.modelSet, b!.thinkingSet], ['google-vertex/gemini-4-argon', 'low', undefined, undefined]);
});

test('a pick holds for the task: every turn runs on it and the chat’s OpenClaw session is given it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-model-'));
  const beforeDir = process.env.BACKEND_DATA_DIR, beforeCli = process.env.OPENCLAW_CLI_PATH;
  process.env.BACKEND_DATA_DIR = dir;
  const log = path.join(dir, 'calls.jsonl');
  // A stand-in CLI: it lists the models, takes a session's model (unless told to refuse), and answers a turn.
  const stub = path.join(dir, 'openclaw-stub.js');
  fs.writeFileSync(stub, `
    const fs = require('fs'), path = require('path');
    const args = process.argv.slice(2);
    const note = (entry) => fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(entry) + '\\n');
    if (args[0] === 'gateway' && args[2] === 'models.list') process.stdout.write(JSON.stringify(${JSON.stringify(GATEWAY)}));
    else if (args[0] === 'models' && args[1] === 'list') process.stdout.write(JSON.stringify(${JSON.stringify(LISTED)}));
    else if (args[0] === 'gateway' && args[2] === 'sessions.patch') {
      const params = JSON.parse(args[args.indexOf('--params') + 1]);
      if (fs.existsSync(path.join(${JSON.stringify(dir)}, 'refuse-patch'))) { note({ patch: params, refused: true }); process.exit(1); }
      note({ patch: params });
      process.stdout.write(JSON.stringify({ ok: true, key: params.key }));
    } else if (args[0] === 'agent') {
      const at = args.indexOf('--model'), th = args.indexOf('--thinking');
      note({ turn: args[args.indexOf('--session-key') + 1], model: at >= 0 ? args[at + 1] : null, ...(th >= 0 ? { thinking: args[th + 1] } : {}) });
      process.stdout.write(JSON.stringify({ status: 'ok', result: { payloads: [{ text: 'Answer.' }] } }));
    } else process.exit(1);
  `);
  process.env.OPENCLAW_CLI_PATH = stub;
  try {
    fs.mkdirSync(path.join(dir, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'tasks', 'have-to-do.json'), JSON.stringify({ _comment: '', tasks: [{ id: TASK, text: 'Finish the slides' }] }));
    const route = await import('../src/app/api/tasks/brief-chat/route');
    const modelsRoute = await import('../src/app/api/openclaw/models/route');
    const { readChatThreads } = await import('../src/app/api/tasks/brief-chat/store');
    const { readTaskPicks } = await import('../src/app/api/tasks/brief-chat/models');
    const readTaskModel = (taskId: string) => readTaskPicks(taskId).model;
    const url = 'http://127.0.0.1:3000/api/tasks/brief-chat';
    const post = (body: unknown) => route.POST(new NextRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
    const list = async () => (await (await route.GET(new NextRequest(`${url}?id=${TASK}&list=1`))).json()).data;
    const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);
    const settle = async (id: string) => { for (let i = 0; i < 200; i++) { const t = readChatThreads(TASK).find((x) => x.id === id)!; if (!t.pendingSince) return t; await new Promise((r) => setTimeout(r, 50)); } throw new Error('the turn never settled'); };
    const until = async (ok: () => boolean) => { for (let i = 0; i < 200 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); assert.equal(ok(), true); };
    const ARGON = 'google-vertex/gemini-4-argon', PRO = 'google-vertex/gemini-3.1-pro-preview';

    // The list for the selector.
    const listed = await (await modelsRoute.GET()).json();
    assert.deepEqual([listed.success, listed.data.models.length, listed.data.defaultKey, listed.data.models[0].thinkingDefault], [true, 3, 'google-vertex/gemini-3.8-flash', 'high']);

    // Nothing picked: OpenClaw's default, and nothing is said to OpenClaw about models.
    assert.equal((await list()).model, null);
    const first = (await (await post({ action: 'send', taskId: TASK, text: 'Hello' })).json()).data;
    const key = (await settle(first.id)).sessionKey;
    assert.deepEqual(calls(), [{ turn: key, model: null }]);

    // Only a model OpenClaw is set up with can be picked.
    assert.equal((await post({ action: 'model', taskId: TASK, model: 'google-vertex/gone' })).status, 400);
    assert.equal((await post({ action: 'model', taskId: TASK, model: 'not a key' })).status, 400);
    assert.equal((await post({ action: 'model', taskId: TASK })).status, 400);
    assert.equal(readTaskModel(TASK), null);

    // A pick, with the chat he has open: its session is given the pick straight away.
    const picked = await (await post({ action: 'model', taskId: TASK, model: ARGON, threadId: first.id })).json();
    assert.deepEqual(picked.data, { model: ARGON, thinking: null });
    assert.equal((await list()).model, ARGON);
    await until(() => readChatThreads(TASK)[0]!.modelSet === ARGON);
    assert.deepEqual(calls().slice(1), [{ patch: { key, model: ARGON } }]);

    // The next turn runs on it; the session already has it, so it is not told again.
    await post({ action: 'send', taskId: TASK, text: 'Again', threadId: first.id });
    await settle(first.id);
    assert.deepEqual(calls().slice(2), [{ turn: key, model: ARGON }]);

    // A new chat of the same task runs on it too: its session is given the pick before its first turn.
    const second = (await (await post({ action: 'send', taskId: TASK, text: 'A new chat', fresh: true })).json()).data;
    const key2 = (await settle(second.id)).sessionKey;
    assert.notEqual(key2, key);
    assert.deepEqual(calls().slice(3), [{ patch: { key: key2, model: ARGON } }, { turn: key2, model: ARGON }]);
    assert.equal(readChatThreads(TASK).find((t) => t.id === second.id)!.modelSet, ARGON);

    // OpenClaw refuses to take a session's model: the turn still runs on the pick, and the session is tried again next time.
    fs.writeFileSync(path.join(dir, 'refuse-patch'), '');
    await post({ action: 'model', taskId: TASK, model: PRO });
    await post({ action: 'send', taskId: TASK, text: 'On Pro', threadId: second.id });
    await settle(second.id);
    assert.deepEqual(calls().slice(5), [{ patch: { key: key2, model: PRO }, refused: true }, { turn: key2, model: PRO }]);
    assert.equal(readChatThreads(TASK).find((t) => t.id === second.id)!.modelSet, ARGON);
    fs.rmSync(path.join(dir, 'refuse-patch'));

    // Back to OpenClaw's default: the pick is taken off the open chat's session, and turns name no model.
    await post({ action: 'model', taskId: TASK, model: null, threadId: second.id });
    assert.equal((await list()).model, null);
    await until(() => readChatThreads(TASK).find((t) => t.id === second.id)!.modelSet === undefined);
    await post({ action: 'send', taskId: TASK, text: 'Default again', threadId: second.id });
    await settle(second.id);
    assert.deepEqual(calls().slice(7), [{ patch: { key: key2, model: null } }, { turn: key2, model: null }]);
    // The other chat still carries the old pick on its session until its own next turn takes it off.
    await post({ action: 'send', taskId: TASK, text: 'And here', threadId: first.id });
    await settle(first.id);
    assert.deepEqual(calls().slice(9), [{ patch: { key, model: null } }, { turn: key, model: null }]);
    assert.equal(fs.existsSync(path.join(dir, 'tasks', 'chat-models.json')), true);

    // ---- How hard it thinks. Only an effort the model in use can think at can be picked.
    const from = calls().length;
    assert.equal((await list()).thinking, null);
    assert.equal((await post({ action: 'thinking', taskId: TASK, thinking: 'ultra' })).status, 400);        // the default model has no "ultra"
    assert.equal((await post({ action: 'thinking', taskId: TASK, thinking: 'Not A Level' })).status, 400);
    assert.equal((await post({ action: 'thinking', taskId: TASK })).status, 400);
    assert.deepEqual((await (await post({ action: 'thinking', taskId: TASK, thinking: 'low', threadId: first.id })).json()).data, { model: null, thinking: 'low' });
    assert.equal((await list()).thinking, 'low');
    await until(() => readChatThreads(TASK).find((t) => t.id === first.id)!.thinkingSet === 'low');
    // Only what changed is put on the session; the turn names the effort and no model.
    await post({ action: 'send', taskId: TASK, text: 'Think less', threadId: first.id });
    await settle(first.id);
    assert.deepEqual(calls().slice(from), [{ patch: { key, thinkingLevel: 'low' } }, { turn: key, model: null, thinking: 'low' }]);

    // With Argon picked, "ultra" can be; both go on the other chat's session in one step before its turn.
    await post({ action: 'model', taskId: TASK, model: ARGON });
    assert.deepEqual((await (await post({ action: 'thinking', taskId: TASK, thinking: 'ultra' })).json()).data, { model: ARGON, thinking: 'ultra' });
    await post({ action: 'send', taskId: TASK, text: 'Think hard', threadId: second.id });
    await settle(second.id);
    assert.deepEqual(calls().slice(from + 2), [{ patch: { key: key2, model: ARGON, thinkingLevel: 'ultra' } }, { turn: key2, model: ARGON, thinking: 'ultra' }]);

    // A model that cannot think at the picked effort takes the pick off; one that can keeps it.
    assert.deepEqual((await (await post({ action: 'model', taskId: TASK, model: PRO })).json()).data, { model: PRO, thinking: null });
    await post({ action: 'thinking', taskId: TASK, thinking: 'low' });
    assert.deepEqual((await (await post({ action: 'model', taskId: TASK, model: ARGON })).json()).data, { model: ARGON, thinking: 'low' });
    // Back to the model's own effort.
    assert.deepEqual((await (await post({ action: 'thinking', taskId: TASK, thinking: null, threadId: second.id })).json()).data, { model: ARGON, thinking: null });
    await until(() => readChatThreads(TASK).find((t) => t.id === second.id)!.thinkingSet === undefined);
    assert.deepEqual(calls().at(-1), { patch: { key: key2, thinkingLevel: null } });
  } finally {
    if (beforeDir === undefined) delete process.env.BACKEND_DATA_DIR; else process.env.BACKEND_DATA_DIR = beforeDir;
    if (beforeCli === undefined) delete process.env.OPENCLAW_CLI_PATH; else process.env.OPENCLAW_CLI_PATH = beforeCli;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
