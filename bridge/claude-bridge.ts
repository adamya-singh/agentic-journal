// The Claude bridge: runs Claude Code sessions for the Agentic Journal through the Claude Agent SDK, on the installed
// `claude` binary and its subscription login, and serves them on a unix socket (bridge protocol v1, see
// docs/code-sessions-design.md). It runs on its own (systemd/agentic-journal-claude-bridge.service), so a Journal
// deploy or restart does not end a turn that is running.
//
//   node bridge/claude-bridge.ts serve [--socket <path>]    run the bridge
//   node bridge/claude-bridge.ts proxy [--socket <path>]    pipe stdin/stdout to a running bridge (for `ssh <host> …`)
//
// Settings (environment):
//   CLAUDE_BRIDGE_SOCKET       the socket (default ~/.local/state/agentic-journal/claude-bridge.sock)
//   CLAUDE_CLI_PATH            the claude binary (default: `claude` on PATH, else ~/.local/bin/claude)
//   CLAUDE_BRIDGE_IDLE_MS      how long a quiet session keeps its Claude Code process (default 600000)
//   CLAUDE_BRIDGE_OAUTH_TOKEN  a long-lived token from `claude setup-token`, given to Claude Code as
//                              CLAUDE_CODE_OAUTH_TOKEN. Only this deliberate setting is passed on: every CLAUDE_*,
//                              CLAUDECODE and ANTHROPIC_* variable the bridge itself inherited is dropped.
// Plain `node` runs it (Node 24 strips the types); it needs `npm install` in bridge/ once.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { listenBridge, proxyToSocket } from './server.ts';
import { createBridge, type AuthInfo } from './sessions.ts';
import type { ClaudeSdk } from './sdk-types.ts';

/** What Claude Code is told it was started by. Sessions labelled sdk-ts/sdk-cli/sdk-py are hidden from `claude --resume`. */
export const ENTRYPOINT = 'agentic-journal';
const SDK_PACKAGE = '@anthropic-ai/claude-agent-sdk';

type Env = Record<string, string | undefined>;

export function defaultSocketPath(env: Env = process.env): string {
  return env.CLAUDE_BRIDGE_SOCKET || path.join(os.homedir(), '.local', 'state', 'agentic-journal', 'claude-bridge.sock');
}

/**
 * The environment Claude Code runs in: the bridge's own, without anything that would point it elsewhere than this
 * device's subscription login (API keys, base URLs, a parent Claude Code's session and auth), labelled as started by
 * the Journal. Only CLAUDE_BRIDGE_OAUTH_TOKEN, set on purpose for the bridge, is passed on as a login.
 */
export function cleanChildEnv(env: Env = process.env): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('CLAUDE_') || key === 'CLAUDECODE' || key.startsWith('ANTHROPIC_')) continue;
    out[key] = value;
  }
  out.CLAUDE_CODE_ENTRYPOINT = ENTRYPOINT;
  if (env.CLAUDE_BRIDGE_OAUTH_TOKEN) out.CLAUDE_CODE_OAUTH_TOKEN = env.CLAUDE_BRIDGE_OAUTH_TOKEN;
  return out;
}

/** The installed claude binary: CLAUDE_CLI_PATH, else the first `claude` on PATH, else ~/.local/bin/claude. */
export function findClaude(env: Env = process.env): string {
  if (env.CLAUDE_CLI_PATH) return env.CLAUDE_CLI_PATH;
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, 'claude');
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* next */ }
  }
  return path.join(os.homedir(), '.local', 'bin', 'claude');
}

function run(file: string, args: string[], env: Record<string, string | undefined>): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: env as NodeJS.ProcessEnv, timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') { reject(error); return; }
      resolve({ stdout: String(stdout ?? ''), code: error ? Number((error as { code?: unknown }).code) || 1 : 0 });
    });
  });
}

/** `claude auth status` (JSON). Read for whether someone is signed in and how; nothing secret is kept. */
export async function claudeAuthStatus(claudePath: string, env: Record<string, string | undefined>): Promise<AuthInfo> {
  const { stdout } = await run(claudePath, ['auth', 'status'], env);
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(stdout); } catch { throw new Error('`claude auth status` did not answer in JSON.'); }
  const text = (key: string) => (typeof parsed[key] === 'string' ? parsed[key] as string : undefined);
  return {
    loggedIn: parsed.loggedIn === true,
    ...(text('authMethod') ? { authMethod: text('authMethod') } : {}),
    ...(text('subscriptionType') ? { subscriptionType: text('subscriptionType') } : {}),
    ...(text('apiKeySource') ? { apiKeySource: text('apiKeySource') } : {}),
  };
}

export async function claudeVersion(claudePath: string, env: Record<string, string | undefined>): Promise<string | null> {
  try {
    const { stdout } = await run(claudePath, ['--version'], env);
    return /(\d+\.\d+\.\d+)/.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * The folder a session ran in, from the first transcript line that names one. Only for a session the SDK's info
 * gives no folder for; the SDK still reads everything else.
 */
export async function transcriptCwd(sessionId: string, configDir = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
  const root = path.join(configDir, 'projects');
  let dirs: string[];
  try { dirs = fs.readdirSync(root); } catch { return null; }
  for (const dir of dirs) {
    const file = path.join(root, dir, `${sessionId}.jsonl`);
    if (!fs.existsSync(file)) continue;
    const lines = createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line.includes('"cwd"')) continue;
        try {
          const cwd = (JSON.parse(line) as { cwd?: unknown }).cwd;
          if (typeof cwd === 'string' && cwd.startsWith('/')) return cwd;
        } catch { /* a broken line */ }
      }
    } finally {
      lines.close();
    }
  }
  return null;
}

function argValue(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

async function serve(socketPath: string): Promise<void> {
  const sdk = (await import(SDK_PACKAGE)) as unknown as ClaudeSdk;
  const env = cleanChildEnv();
  const claudePath = findClaude();
  let version: string | null = await claudeVersion(claudePath, env);
  const bridge = createBridge({
    sdk, claudePath, env,
    authStatus: () => claudeAuthStatus(claudePath, env),
    version: async () => (version ??= await claudeVersion(claudePath, env)),
    findCwd: (sessionId) => transcriptCwd(sessionId),
    idleMs: Number(process.env.CLAUDE_BRIDGE_IDLE_MS) || undefined,
  });
  const server = await listenBridge(bridge, socketPath, { claudeVersion: () => version });
  console.error(`claude-bridge: listening on ${socketPath} (Claude Code ${version ?? 'not found'} at ${claudePath})`);
  let stopping = false;
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.error(`claude-bridge: ${signal}, stopping`);
    await bridge.close();
    await server.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop('SIGTERM'));
  process.on('SIGINT', () => void stop('SIGINT'));
}

async function main(): Promise<void> {
  const [command = 'serve', ...rest] = process.argv.slice(2);
  const socketPath = argValue(rest, '--socket') ?? defaultSocketPath();
  if (command === 'serve') return serve(socketPath);
  if (command === 'proxy') { process.exitCode = await proxyToSocket(socketPath); return; }
  console.error('usage: node bridge/claude-bridge.ts serve|proxy [--socket <path>]');
  process.exitCode = 2;
}

// Run only as the program, not when the tests import its helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`claude-bridge: ${error instanceof Error ? error.message : String(error)}`); process.exit(1); });
}
