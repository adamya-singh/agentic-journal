// The Claude bridge's socket: a WebSocket server on a unix socket, one JSON-RPC message per text frame (no
// "jsonrpc" field), as Codex's daemon speaks, so the Journal reaches both with the same client (transport.ts).
// The socket is made readable only by its owner. A stale socket left by a bridge that died is cleared; a socket
// another bridge still answers on is left alone, and this one does not start.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { BRIDGE_PROTOCOL, BRIDGE_VERSION, BridgeError, type Bridge, type BridgeClient } from './sessions.ts';

export interface BridgeServer {
  socketPath: string;
  clients(): number;
  /** Ends every connection and stops listening. The bridge itself is closed by its owner. */
  close(): Promise<void>;
}

/** Someone answers on the socket. */
function answers(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createConnection(socketPath);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}

export async function listenBridge(bridge: Bridge, socketPath: string, info: { claudeVersion?: () => string | null } = {}): Promise<BridgeServer> {
  fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  if (fs.existsSync(socketPath)) {
    if (await answers(socketPath)) throw new Error(`another Claude bridge is already running on ${socketPath}`);
    fs.rmSync(socketPath, { force: true });
  }
  const server = http.createServer((_req, res) => { res.writeHead(426, { 'Content-Type': 'text/plain' }); res.end('The Claude bridge speaks WebSocket.\n'); });
  const wss = new WebSocketServer({ server, perMessageDeflate: false, maxPayload: 64 * 1024 * 1024 });
  const sockets = new Set<WebSocket>();
  let nextClient = 1;

  wss.on('connection', (socket) => {
    sockets.add(socket);
    const client: BridgeClient = {
      id: nextClient++,
      notify(method, params) { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify({ method, params })); },
    };
    const reply = (message: object) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message)); };
    socket.on('message', async (data, isBinary) => {
      if (isBinary) return;
      let msg: { id?: string | number; method?: unknown; params?: unknown };
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (typeof msg.method !== 'string') return;          // answers to requests: the bridge sends none
      const hasId = typeof msg.id === 'string' || typeof msg.id === 'number';
      if (!hasId) return;                                   // notifications (initialized): nothing to do
      try {
        const result = msg.method === 'initialize'
          ? { version: BRIDGE_VERSION, protocol: BRIDGE_PROTOCOL, claudeVersion: info.claudeVersion?.() ?? null, pid: process.pid }
          : await bridge.handle(client, msg.method, msg.params);
        reply({ id: msg.id, result: result ?? {} });
      } catch (error) {
        const code = error instanceof BridgeError ? error.code : -32000;
        reply({ id: msg.id, error: { code, message: error instanceof Error ? error.message : String(error) } });
      }
    });
    socket.on('close', () => { sockets.delete(socket); bridge.detach(client); });
    socket.on('error', () => { /* the close that follows cleans up */ });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => { server.off('error', reject); resolve(); });
  });
  fs.chmodSync(socketPath, 0o600);

  return {
    socketPath,
    clients: () => sockets.size,
    async close() {
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      fs.rmSync(socketPath, { force: true });
    },
  };
}

/** `proxy`: pipes stdin/stdout to the socket byte for byte, so a client elsewhere reaches it through `ssh <host> …`. */
export function proxyToSocket(socketPath: string, stdin: NodeJS.ReadableStream = process.stdin, stdout: NodeJS.WritableStream = process.stdout): Promise<number> {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let done = false;
    const end = (code: number, why?: string) => {
      if (done) return;
      done = true;
      if (why) process.stderr.write(`claude-bridge proxy: ${why}\n`);
      socket.destroy();
      resolve(code);
    };
    socket.once('connect', () => {
      stdin.pipe(socket);
      socket.pipe(stdout as NodeJS.WritableStream, { end: false });
    });
    socket.once('error', (error) => end(1, `the bridge can’t be reached on ${socketPath}: ${error.message}`));
    socket.once('close', () => end(0));
    stdin.once('end', () => { socket.end(); });
  });
}
