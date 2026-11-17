// A stand-in for Codex's app-server daemon, for the code-agents tests: a WebSocket server on a temporary unix
// socket that speaks the same JSON-RPC (no "jsonrpc" field, one message per text frame). Each test scripts it:
// what each method answers, the notifications and server requests it sends, and when it drops the connection.
// Not a test file itself (the runner only picks up *.test.ts).
/* eslint-disable @typescript-eslint/no-explicit-any -- loose JSON-RPC messages, as the wire carries them */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

export type Handler = (params: any, socket: WebSocket) => unknown | Promise<unknown>;

export interface FakeCodex {
  socketPath: string;
  dir: string;
  /** Every message a client sent, in order. */
  received: { method?: string; id?: number | string; params?: any; result?: any; error?: any }[];
  /** What a method answers; a thrown error becomes a JSON-RPC error ({ code } on the error is kept). */
  on(method: string, handler: Handler): void;
  notify(method: string, params: unknown): void;
  /** Sends a request to the client and resolves with its answer (result or error). */
  request(method: string, params: unknown): Promise<{ result?: any; error?: any }>;
  /** Ends every connection without a close handshake. */
  drop(): void;
  connections(): number;
  waitFor(predicate: () => boolean, timeoutMs?: number): Promise<void>;
  close(): Promise<void>;
}

export const DEFAULT_THREAD = (id: string, extra: Record<string, unknown> = {}) => ({
  id, sessionId: id, preview: 'Hello', model: 'gpt-test', modelProvider: 'openai', reasoningEffort: 'medium', createdAt: 1794842292, updatedAt: 1794842295,
  status: { type: 'idle' }, path: `/tmp/${id}.jsonl`, cwd: '/tmp', source: 'vscode', threadSource: null, name: null, ephemeral: false, turns: [], ...extra,
});

/**
 * Messages as the real daemon (codex-cli 0.169.0) sent them in the live check of 2026-11-16, trimmed to what the
 * adapter reads plus the fields that surprised. Every command runs as `/bin/bash -lc '<script>'`; a command approval
 * carries `availableDecisions` (accept, an execpolicy amendment, cancel: neither acceptForSession nor decline is
 * listed, yet both are honoured) and `commandActions`; a file-change approval names no files (they are on the item,
 * which arrives first); agent messages say whether they are `commentary` or the `final_answer`; an interrupted turn's
 * command can complete after turn/completed, since Codex leaves the process running.
 */
export const REAL = {
  commandItem: (id: string, command: string, status = 'inProgress', extra: Record<string, unknown> = {}) => ({
    type: 'commandExecution', id, pluginId: null, scriptPath: null, command: `/bin/bash -lc '${command}'`, cwd: '/spike', processId: null, source: 'agent',
    status, commandActions: [{ type: 'unknown', command }], aggregatedOutput: null, exitCode: null, durationMs: null, startedAtMs: 1794880039430, completedAtMs: null, ...extra,
  }),
  commandApproval: (threadId: string, turnId: string, itemId: string, command: string, reason: string | null = null) => ({
    kind: 'command', threadId, turnId, itemId, startedAtMs: 1794880039430, environmentId: 'local', reason, command: `/bin/bash -lc '${command}'`, cwd: '/spike',
    commandActions: [{ type: 'unknown', command }], proposedExecpolicyAmendment: command.split(' '),
    availableDecisions: ['accept', { acceptWithExecpolicyAmendment: { execpolicy_amendment: command.split(' ') } }, 'cancel'],
  }),
  fileChangeItem: (id: string, status = 'inProgress') => ({
    type: 'fileChange', id, status, startedAtMs: 1794880575771, completedAtMs: null, changes: [
      { path: '/spike/README.md', kind: { type: 'update', move_path: null }, diff: '@@ -3 +3,2 @@\n Throwaway folder.\n+Used by the live check.\n' },
      { path: '/spike/hello.py', kind: { type: 'update', move_path: null }, diff: '@@ -1,4 +1,4 @@\n-def greet(name):\n+def hello(name):\n     return "hi " + name\n' },
    ],
  }),
  fileChangeApproval: (threadId: string, turnId: string, itemId: string, reason: string | null = null) => ({ threadId, turnId, itemId, startedAtMs: 1794880575771, reason, grantRoot: null }),
  agentMessage: (id: string, text: string, phase: 'commentary' | 'final_answer' = 'final_answer') => ({ type: 'agentMessage', moderation: null, id, text, phase, memoryCitation: null, delivery: null, questions: null }),
  /** thread/start and thread/resume answer with what the thread runs on (config.toml's defaults on a new thread). */
  threadAnswer: (thread: Record<string, unknown>, model: string, reasoningEffort: string | null, approvalPolicy: string, sandbox: Record<string, unknown>) => ({
    thread, model, modelProvider: 'openai', serviceTier: null, cwd: thread.cwd, approvalPolicy, approvalsReviewer: 'user', sandbox, reasoningEffort,
  }),
};

export async function startFakeCodex(): Promise<FakeCodex> {
  // A unix socket's path must stay short (about 100 bytes), so a long TMPDIR is not used.
  const dir = fs.mkdtempSync(path.join(os.tmpdir().length > 60 ? '/tmp' : os.tmpdir(), 'fake-codex-'));
  const socketPath = path.join(dir, 'app-server.sock');
  const server = http.createServer();
  const wss = new WebSocketServer({ server });
  const handlers = new Map<string, Handler>();
  const received: FakeCodex['received'] = [];
  const sockets = new Set<WebSocket>();
  const waiting = new Map<string, (answer: { result?: any; error?: any }) => void>();
  let nextId = 1000;

  handlers.set('initialize', () => ({ userAgent: 'Codex Desktop/0.169.0 (fake)', codexHome: dir, platformFamily: 'unix', platformOs: 'linux' }));

  wss.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('message', async (data) => {
      const message = JSON.parse(data.toString());
      received.push(message);
      if (message.method === undefined) {
        const answer = waiting.get(String(message.id));
        if (answer) { waiting.delete(String(message.id)); answer(message); }
        return;
      }
      if (message.id === undefined) return;   // a notification (initialized)
      const handler = handlers.get(message.method);
      if (!handler) { socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: `no handler for ${message.method}` } })); return; }
      try {
        const result = await handler(message.params, socket);
        socket.send(JSON.stringify({ id: message.id, result: result ?? {} }));
      } catch (error) {
        socket.send(JSON.stringify({ id: message.id, error: { code: (error as { code?: number }).code ?? -32000, message: (error as Error).message } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  const broadcast = (message: unknown) => { for (const socket of sockets) socket.send(JSON.stringify(message)); };
  return {
    socketPath,
    dir,
    received,
    on(method, handler) { handlers.set(method, handler); },
    notify(method, params) { broadcast({ method, params }); },
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve) => { waiting.set(String(id), resolve); broadcast({ id, method, params }); });
    },
    drop() { for (const socket of sockets) socket.terminate(); sockets.clear(); },
    connections: () => sockets.size,
    async waitFor(predicate, timeoutMs = 3000) {
      const until = Date.now() + timeoutMs;
      while (!predicate()) {
        if (Date.now() > until) throw new Error('timed out waiting');
        await new Promise((r) => setTimeout(r, 10));
      }
    },
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
