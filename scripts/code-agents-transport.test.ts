// The JSON-RPC client the coding-agent adapters talk through: over a WebSocket on a unix socket (Codex's daemon)
// and over newline-delimited JSON on a child process (`codex app-server` without the daemon).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { connectRpc, RpcError, RPC_OVERLOADED, stdioJsonlTransport, unixSocketTransport } from '../src/lib/code-agents/transport';
import { startFakeCodex } from './code-agents-fake-codex';

test('requests, notifications and the server’s own requests over a unix-socket WebSocket', async () => {
  const fake = await startFakeCodex();
  try {
    fake.on('echo', (params) => ({ back: params }));
    fake.on('broken', () => { throw Object.assign(new Error('no such thread'), { code: -32602 }); });
    const rpc = await connectRpc(unixSocketTransport(fake.socketPath, 'fake'));
    const notes: [string, unknown][] = [];
    const asked: [string | number, string, unknown][] = [];
    rpc.onNotification((method, params) => notes.push([method, params]));
    rpc.onRequest((id, method, params) => asked.push([id, method, params]));

    // Answers are matched to requests by id, even when they come back in another order.
    fake.on('slow', async () => { await new Promise((r) => setTimeout(r, 50)); return { slow: true }; });
    const [slow, echo] = await Promise.all([rpc.request('slow'), rpc.request('echo', { a: 1 })]);
    assert.deepEqual([slow, echo], [{ slow: true }, { back: { a: 1 } }]);
    // No "jsonrpc" field, and a request without params says none.
    assert.deepEqual(fake.received.find((m) => m.method === 'slow'), { id: 1, method: 'slow' });

    await assert.rejects(rpc.request('broken'), (error: unknown) => error instanceof RpcError && error.code === -32602 && error.message === 'no such thread');

    fake.notify('thread/status/changed', { threadId: 't', status: { type: 'idle' } });
    const answer = fake.request('item/commandExecution/requestApproval', { threadId: 't', itemId: 'i' });
    await fake.waitFor(() => notes.length === 1 && asked.length === 1);
    assert.deepEqual(notes[0], ['thread/status/changed', { threadId: 't', status: { type: 'idle' } }]);
    assert.equal(asked[0]![1], 'item/commandExecution/requestApproval');
    // The client answers when it is ready, by the server's id.
    rpc.respond(asked[0]![0], { decision: 'accept' });
    assert.deepEqual((await answer).result, { decision: 'accept' });

    rpc.notify('initialized', {});
    await fake.waitFor(() => fake.received.some((m) => m.method === 'initialized' && m.id === undefined));

    // The connection drops: what is out fails, and the client says it is closed.
    fake.on('never', () => new Promise(() => {}));
    const out = rpc.request('never');
    let closedWith = '';
    rpc.onClose((reason) => { closedWith = reason; });
    await fake.waitFor(() => fake.received.some((m) => m.method === 'never'));
    fake.drop();
    await assert.rejects(out, /connection closed/);
    await fake.waitFor(() => rpc.closed);
    assert.match(closedWith, /connection closed/);
    assert.throws(() => rpc.notify('x'), /not connected/);
  } finally {
    await fake.close();
  }
});

test('a request times out, and an overloaded server is asked again after a pause', async () => {
  const fake = await startFakeCodex();
  try {
    let tries = 0;
    fake.on('busy', () => { tries++; if (tries < 3) throw Object.assign(new Error('overloaded'), { code: RPC_OVERLOADED }); return { ok: true }; });
    fake.on('never', () => new Promise(() => {}));
    const rpc = await connectRpc(unixSocketTransport(fake.socketPath));
    assert.deepEqual(await rpc.request('busy'), { ok: true });
    assert.equal(tries, 3);
    tries = -10;
    await assert.rejects(rpc.request('busy', undefined, { retries: 1 }), (error: unknown) => error instanceof RpcError && error.code === RPC_OVERLOADED);
    await assert.rejects(rpc.request('never', {}, { timeoutMs: 50 }), /never timed out after 50 ms/);
    rpc.close();
    assert.equal(rpc.closed, true);
  } finally {
    await fake.close();
  }
});

test('a socket with nobody listening cannot be connected to', async () => {
  await assert.rejects(connectRpc(unixSocketTransport(path.join(os.tmpdir(), `no-such-${Date.now()}.sock`))));
});

test('newline-delimited JSON over a child process', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-child-'));
  const child = path.join(dir, 'server.js');
  // A tiny app server: answers "ping", says hello first, asks the client one question, and ends on "quit".
  fs.writeFileSync(child, `
    const rl = require('readline').createInterface({ input: process.stdin });
    const say = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
    say({ method: 'hello', params: { n: 1 } });
    rl.on('line', (line) => {
      const m = JSON.parse(line);
      if (m.method === 'ping') say({ id: m.id, result: { pong: m.params } });
      else if (m.method === 'ask') { say({ id: 'q1', method: 'question', params: {} }); say({ id: m.id, result: {} }); }
      else if (m.method === 'quit') process.exit(3);
      else if (m.id === 'q1') say({ method: 'answered', params: m.result });
    });
  `);
  let close = () => {};
  try {
    const transport = stdioJsonlTransport({ label: 'child', command: process.execPath, args: [child] });
    const rpc = await connectRpc(transport);
    close = () => rpc.close();
    const notes: unknown[] = [];
    rpc.onNotification((method, params) => notes.push([method, params]));
    rpc.onRequest((id, method) => { if (method === 'question') rpc.respond(id, { yes: true }); });
    assert.deepEqual(await rpc.request('ping', 'x'), { pong: 'x' });
    await rpc.request('ask');
    const answered = () => notes.find((n) => (n as unknown[])[0] === 'answered');
    for (let i = 0; i < 100 && !answered(); i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(answered(), ['answered', { yes: true }]);
    let closedWith = '';
    rpc.onClose((reason) => { closedWith = reason; });
    await assert.rejects(rpc.request('quit'), /process ended \(3\)/);
    assert.match(closedWith, /process ended \(3\)/);
  } finally {
    close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
