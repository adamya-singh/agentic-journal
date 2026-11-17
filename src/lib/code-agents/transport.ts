// JSON-RPC to a coding agent's local server, over a message transport. Codex's app server speaks JSON-RPC 2.0
// without the "jsonrpc" field; the Claude bridge will speak the same. Two transports so far:
//   - WebSocket (one JSON message per text frame). Codex's always-running daemon listens this way on a unix socket,
//     and `codex app-server proxy` only pipes bytes to that socket, so the same WebSocket client works over any byte
//     pipe: a later stage passes `createConnection` returning an `ssh <host> codex app-server proxy` child's stdio.
//   - Newline-delimited JSON on a child's stdin/stdout (`codex app-server` with no daemon running).
// The client matches answers to requests by id, times requests out, retries when the server says it is overloaded,
// and hands the server's own requests (approvals) to whoever answers them later.
import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { Duplex } from 'node:stream';
import WebSocket from 'ws';

export interface TransportHandlers {
  message(message: unknown): void;
  close(reason: string): void;
}

/** Carries whole JSON messages both ways. `connect` resolves once messages can be sent. */
export interface MessageTransport {
  readonly label: string;
  connect(handlers: TransportHandlers): Promise<void>;
  send(message: object): void;
  close(): void;
}

// ---- WebSocket.

export interface WebSocketTransportOptions {
  label: string;
  url: string;                               // ws://..., or ws+unix:///path/to.sock:/
  createConnection?: () => Duplex;           // a byte pipe to speak WebSocket over (an ssh child's stdio)
  openTimeoutMs?: number;
}

export function webSocketTransport(options: WebSocketTransportOptions): MessageTransport {
  let socket: WebSocket | null = null;
  let closedByUs = false;
  return {
    label: options.label,
    connect(handlers) {
      return new Promise<void>((resolve, reject) => {
        closedByUs = false;
        const ws = new WebSocket(options.url, {
          perMessageDeflate: false,
          handshakeTimeout: options.openTimeoutMs ?? 5000,
          ...(options.createConnection ? { createConnection: options.createConnection as never } : {}),
        });
        socket = ws;
        let opened = false;
        ws.on('open', () => { opened = true; resolve(); });
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          let parsed: unknown;
          try { parsed = JSON.parse(data.toString()); } catch { return; }
          handlers.message(parsed);
        });
        ws.on('error', (error) => { if (!opened) reject(error); });
        ws.on('close', (code, reason) => {
          if (socket === ws) socket = null;
          if (!opened) { reject(new Error(`closed before it opened (${code})`)); return; }
          handlers.close(closedByUs ? 'closed' : `the connection closed (${code}${reason.length ? ` ${reason.toString()}` : ''})`);
        });
      });
    },
    send(message) {
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('not connected');
      socket.send(JSON.stringify(message));
    },
    close() {
      closedByUs = true;
      const ws = socket;
      socket = null;
      if (ws) { try { ws.close(); } catch { ws.terminate(); } }
    },
  };
}

// ---- A child's stdio as a byte pipe, to speak WebSocket over (ssh running `codex app-server proxy` on a device).

/** A child's stdin and stdout as one stream, with the few socket methods `ws` and `http` call on what they are given. */
export interface ChildPipe extends Duplex {
  setTimeout(ms: number, callback?: () => void): this;
  setNoDelay(noDelay?: boolean): this;
  setKeepAlive(enable?: boolean, delay?: number): this;
  ref(): this;
  unref(): this;
  /** The child's last words on stderr (kept to 4000 characters). */
  readonly stderr: string;
}

export interface ChildPipeOptions {
  /** A line the child prints when the pipe begins: everything before it (a login shell's chatter) is dropped. */
  marker?: string;
  /** What the failure was, from the child's stderr and exit code, when it ends before the marker. */
  describe?: (stderr: string, code: number | string | null) => string;
}

export function childPipe(child: ChildProcess, options: ChildPipeOptions = {}): ChildPipe {
  const stdin = child.stdin!;
  const stdout = child.stdout!;
  let stderr = '';
  let begun = !options.marker;
  let head = Buffer.alloc(0);
  let idleMs = 0;
  let idle: ReturnType<typeof setTimeout> | null = null;
  const marker = Buffer.from(`${options.marker ?? ''}\n`);

  const pipe = new Duplex({
    allowHalfOpen: false,
    read() { stdout.resume(); },
    write(chunk: Buffer, _encoding, callback) {
      if (!stdin.writable) { callback(new Error('the pipe is closed')); return; }
      touch();
      // A child that ends before its pipe began (ssh could not connect) says why when it exits: not "EPIPE" here.
      stdin.write(chunk, (error) => callback(error && begun ? error : null));
    },
    final(callback) { stdin.end(); callback(); },
    destroy(error, callback) {
      if (idle) clearTimeout(idle);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      callback(error);
    },
  }) as ChildPipe;

  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = idleMs > 0 ? setTimeout(() => pipe.emit('timeout'), idleMs) : null;
  };
  const deliver = (chunk: Buffer) => { touch(); if (!pipe.push(chunk)) stdout.pause(); };

  child.stderr?.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-4000); });
  stdout.on('data', (chunk: Buffer) => {
    if (begun) { deliver(chunk); return; }
    head = Buffer.concat([head, chunk]);
    const at = head.indexOf(marker);
    if (at < 0) { if (head.length > 1 << 20) head = head.subarray(head.length - marker.length); return; }
    begun = true;
    const rest = head.subarray(at + marker.length);
    head = Buffer.alloc(0);
    if (rest.length) deliver(rest);
  });
  // Before the pipe began, its end is the child failing: the exit says why.
  stdout.once('end', () => { if (begun) pipe.push(null); });
  stdin.on('error', () => { /* the exit that follows ends the pipe */ });
  child.once('error', (error) => pipe.destroy(error));
  child.once('exit', (code, signal) => {
    // Ended before it began: that is why the connection failed.
    if (!begun) { pipe.destroy(new Error(options.describe?.(stderr, signal ?? code) ?? (stderr.trim().split('\n').pop() || `the command ended (${signal ?? code})`))); return; }
    setImmediate(() => { if (!pipe.destroyed) pipe.destroy(); });
  });

  Object.assign(pipe, {
    setTimeout(ms: number, callback?: () => void) { idleMs = ms; if (callback) pipe.once('timeout', callback); touch(); return pipe; },
    setNoDelay() { return pipe; },
    setKeepAlive() { return pipe; },
    ref() { return pipe; },
    unref() { return pipe; },
  });
  Object.defineProperty(pipe, 'stderr', { get: () => stderr });
  return pipe;
}

/** A WebSocket server listening on a unix socket, as Codex's daemon does. */
export function unixSocketTransport(socketPath: string, label = `unix:${socketPath}`): MessageTransport {
  return webSocketTransport({ label, url: `ws+unix://${socketPath}:/` });
}

// ---- Newline-delimited JSON on a child process.

export interface StdioTransportOptions {
  label: string;
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

export function stdioJsonlTransport(options: StdioTransportOptions): MessageTransport {
  let child: ChildProcessWithoutNullStreams | null = null;
  let closedByUs = false;
  return {
    label: options.label,
    connect(handlers) {
      return new Promise<void>((resolve, reject) => {
        closedByUs = false;
        const proc = spawn(options.command, options.args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
        child = proc;
        let started = false;
        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-2000); });
        proc.once('spawn', () => { started = true; resolve(); });
        proc.once('error', (error) => { if (!started) reject(error); });
        createInterface({ input: proc.stdout }).on('line', (line) => {
          if (!line.trim()) return;
          let parsed: unknown;
          try { parsed = JSON.parse(line); } catch { return; }
          handlers.message(parsed);
        });
        proc.once('exit', (code, signal) => {
          if (child === proc) child = null;
          if (!started) return;
          const last = stderr.trim().split('\n').pop();
          handlers.close(closedByUs ? 'closed' : `the process ended (${signal ?? code})${last ? `: ${last}` : ''}`);
        });
      });
    },
    send(message) {
      if (!child || !child.stdin.writable) throw new Error('not connected');
      child.stdin.write(`${JSON.stringify(message)}\n`);
    },
    close() {
      closedByUs = true;
      const proc = child;
      child = null;
      if (proc) { proc.stdin.end(); proc.kill('SIGTERM'); }
    },
  };
}

// ---- JSON-RPC.

export type RpcId = string | number;

export class RpcError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

/** The server is too busy for the request just now; it may be sent again after a pause. */
export const RPC_OVERLOADED = -32001;
export const RPC_METHOD_NOT_FOUND = -32601;

export interface RpcRequestOptions {
  timeoutMs?: number;
  retries?: number;           // times to retry on RPC_OVERLOADED (default 3)
}

export interface RpcClient {
  readonly label: string;
  request<T = unknown>(method: string, params?: unknown, options?: RpcRequestOptions): Promise<T>;
  notify(method: string, params?: unknown): void;
  /** Answers a request the server sent. */
  respond(id: RpcId, result: unknown): void;
  respondError(id: RpcId, code: number, message: string): void;
  onNotification(handler: (method: string, params: unknown) => void): void;
  /** A request from the server: answer it with respond(), now or later. */
  onRequest(handler: (id: RpcId, method: string, params: unknown) => void): void;
  onClose(handler: (reason: string) => void): void;
  readonly closed: boolean;
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Connects the transport and returns a client on it. Rejects when the transport cannot connect. */
export async function connectRpc(transport: MessageTransport): Promise<RpcClient> {
  let nextId = 1;
  let closed = false;
  const pending = new Map<RpcId, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const notificationHandlers: ((method: string, params: unknown) => void)[] = [];
  const requestHandlers: ((id: RpcId, method: string, params: unknown) => void)[] = [];
  const closeHandlers: ((reason: string) => void)[] = [];

  const fail = (reason: string) => {
    if (closed) return;
    closed = true;
    for (const [, waiting] of pending) { clearTimeout(waiting.timer); waiting.reject(new Error(`${transport.label}: ${reason}`)); }
    pending.clear();
    for (const handler of closeHandlers) { try { handler(reason); } catch (error) { console.error('code agents: a close handler failed:', error); } }
  };

  const onMessage = (raw: unknown) => {
    if (!raw || typeof raw !== 'object') return;
    const message = raw as { id?: RpcId; method?: unknown; params?: unknown; result?: unknown; error?: { code?: unknown; message?: unknown; data?: unknown } };
    const hasId = typeof message.id === 'string' || typeof message.id === 'number';
    if (typeof message.method === 'string') {
      if (hasId) { for (const handler of requestHandlers) handler(message.id!, message.method, message.params); }
      else for (const handler of notificationHandlers) handler(message.method, message.params);
      return;
    }
    if (!hasId) return;
    const waiting = pending.get(message.id!);
    if (!waiting) return;
    pending.delete(message.id!);
    clearTimeout(waiting.timer);
    if (message.error) {
      const code = typeof message.error.code === 'number' ? message.error.code : -32000;
      waiting.reject(new RpcError(code, typeof message.error.message === 'string' ? message.error.message : 'request failed', message.error.data));
    } else waiting.resolve(message.result);
  };

  await transport.connect({ message: onMessage, close: fail });

  const send = (message: object) => {
    if (closed) throw new Error(`${transport.label}: not connected`);
    transport.send(message);
  };

  const once = <T>(method: string, params: unknown, timeoutMs: number) => new Promise<T>((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${transport.label}: ${method} timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    try {
      send(params === undefined ? { id, method } : { id, method, params });
    } catch (error) {
      clearTimeout(timer);
      pending.delete(id);
      reject(error as Error);
    }
  });

  return {
    label: transport.label,
    async request<T>(method: string, params?: unknown, options: RpcRequestOptions = {}) {
      const retries = options.retries ?? 3;
      for (let attempt = 0; ; attempt++) {
        try {
          return await once<T>(method, params, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        } catch (error) {
          if (!(error instanceof RpcError) || error.code !== RPC_OVERLOADED || attempt >= retries || closed) throw error;
          await sleep(250 * 2 ** attempt + Math.random() * 100);
        }
      }
    },
    notify(method, params) { send(params === undefined ? { method } : { method, params }); },
    respond(id, result) { send({ id, result }); },
    respondError(id, code, message) { send({ id, error: { code, message } }); },
    onNotification(handler) { notificationHandlers.push(handler); },
    onRequest(handler) { requestHandlers.push(handler); },
    onClose(handler) { closeHandlers.push(handler); },
    get closed() { return closed; },
    close() {
      if (closed) return;
      transport.close();
      fail('closed');
    },
  };
}
