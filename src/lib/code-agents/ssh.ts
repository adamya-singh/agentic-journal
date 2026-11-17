// Coding agents on Adamya's other devices, over ssh. The Journal runs the same two commands there that it reaches on
// this machine, each in its own `ssh <alias>`: Codex's `codex app-server proxy` (a byte pipe to that device's Codex
// daemon, so the Journal speaks the daemon's WebSocket through ssh's stdio; plain `codex app-server`, newline JSON,
// when no daemon runs there), and the Claude bridge's `proxy` mode (a byte pipe to the bridge that runs there).
// Each device uses its own harness, login and transcripts, so a session started from the Journal is native there.
//
// ssh never asks for anything (BatchMode): a device whose key login does not work is unreachable, and says why. One
// master connection per device is kept a while (ControlMaster), so a status read or a reconnect costs no new login.
// The remote commands run in the device's login shell, so they find what his terminal finds (~/.local/bin, Homebrew):
// a plain `ssh host codex` on this laptop finds an older /usr/bin/codex. What a login shell prints before the command
// starts (a profile that echoes) is skipped up to a marker line.
//
// Only read-only commands are run to learn what a device has (probeDevice); nothing is installed or changed there.
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CODEX_PLACES, codexWord, findCodexCommand, tildePath } from '@/lib/codex-bin';
import { hostAlias, machineName, thisHost } from '@/lib/proj-hosts';
import type { DeviceStatus } from './protocol';
import { childPipe, type ChildPipe } from './transport';

/** Printed by every remote command just before the real one starts; everything before it is the login shell's. */
export const PIPE_MARKER = 'AJ-PIPE-1';
const PROBE_START = 'AJ-PROBE-1';
const PROBE_END = 'AJ-PROBE-END';
const CONNECT_TIMEOUT_S = 8;
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_OK_MS = 60_000;
const PROBE_FAIL_MS = 30_000;

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The ssh program. CODE_AGENTS_SSH points elsewhere (the tests' stand-in). */
export const sshBinary = () => process.env.CODE_AGENTS_SSH || 'ssh';

/**
 * Where the master connections' sockets live (owner only). CODE_AGENTS_SSH_CONTROL=none turns reuse off; another
 * value is the folder.
 */
export function sshControlDir(): string | null {
  const set = process.env.CODE_AGENTS_SSH_CONTROL;
  if (set === 'none') return null;
  return set || path.join(os.homedir(), '.local', 'state', 'agentic-journal', 'ssh');
}

/** The ssh arguments for one remote command: no prompts, no tty, no escape character, kept alive, the master reused. */
export function sshArgs(alias: string, remoteCommand: string, options: { connectTimeoutS?: number; control?: string | null } = {}): string[] {
  const wanted = options.control === undefined ? sshControlDir() : options.control;
  // ssh refuses a control socket path longer than a unix socket can be (%C is 40 characters; macOS allows 104 bytes):
  // a folder that deep goes without reuse rather than without ssh.
  const control = wanted && Buffer.byteLength(path.join(wanted, 'x'.repeat(40))) < 100 ? wanted : null;
  return [
    '-T', '-e', 'none',
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${options.connectTimeoutS ?? CONNECT_TIMEOUT_S}`,
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
    ...(control ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(control, '%C')}`, '-o', 'ControlPersist=600'] : []),
    '--', alias, remoteCommand,
  ];
}

/** A POSIX script run in the device's login shell (bash, zsh or sh there). */
export function inLoginShell(script: string): string {
  return `exec "\${SHELL:-/bin/sh}" -lc ${shq(script)}`;
}

/** The environment ssh itself runs with: what it needs (home, path, the ssh agent), never the Journal's own settings. */
export function sshEnv(env: Record<string, string | undefined> = process.env): NodeJS.ProcessEnv {
  const keep = new Set(['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TZ', 'TMPDIR', 'SSH_AUTH_SOCK']);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && (keep.has(key) || key.startsWith('LC_') || key.startsWith('XDG_'))) out[key] = value;
  }
  return out as NodeJS.ProcessEnv;
}

// ---- The remote commands.

/** Where scripts/install-claude-bridge.sh puts the bridge on a device; `run` starts it with the node it was installed for. */
const BRIDGE_DIR = '"${XDG_DATA_HOME:-$HOME/.local/share}/agentic-journal/claude-bridge"';
const BRIDGE_SOCKET = '"${CLAUDE_BRIDGE_SOCKET:-$HOME/.local/state/agentic-journal/claude-bridge.sock}"';
/** A checkout of the Journal on the device whose bridge has its packages, used when the bridge was not installed. */
const BRIDGE_REPO = '"$HOME/projects/agentic-journal/bridge"';

/** Where the look searches for Codex off the PATH. CODE_AGENTS_CODEX_PLACES (one per line) replaces it: the tests'. */
const codexPlaces = () => (process.env.CODE_AGENTS_CODEX_PLACES ? process.env.CODE_AGENTS_CODEX_PLACES.split('\n').filter(Boolean) : CODEX_PLACES);

/** The read-only look at a device (probeDevice). */
export const probeScript = () => [
  `printf '%s\\n' ${PROBE_START}`,
  `printf 'home=%s\\n' "$HOME"`,
  `printf 'os=%s\\n' "$(uname -s 2>/dev/null)"`,
  `{ [ -n "\${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; } && printf 'wsl=1\\n'`,
  // Codex: on the PATH, else a copy the desktop apps, Codex's own installs or the editors carry (codex-bin.ts), found
  // in /bin/sh (zsh stops at a glob that matches nothing). Its daemon, and the daemon's own version, as that copy says.
  `aj_codex=$(${findCodexCommand(codexPlaces())} 2>/dev/null)`,
  `if [ -n "$aj_codex" ]; then printf 'codex=%s\\n' "$("$aj_codex" --version 2>/dev/null | head -n 1)"; [ "$aj_codex" = codex ] || printf 'codex_bin=%s\\n' "$aj_codex"; printf 'codex_home=%s\\n' "\${CODEX_HOME:-$HOME/.codex}"; aj_daemon=$("$aj_codex" app-server daemon version 2>/dev/null); case "$aj_daemon" in *'"status":"running"'*) printf 'codex_daemon=1\\n'; printf 'codex_server=%s\\n' "$(printf '%s' "$aj_daemon" | sed -n 's/.*"appServerVersion":"\\([^"]*\\)".*/\\1/p' | head -n 1)";; esac; fi`,
  `if command -v claude >/dev/null 2>&1; then printf 'claude=%s\\n' "$(claude --version 2>/dev/null | head -n 1)"; fi`,
  `if command -v node >/dev/null 2>&1; then printf 'node=%s\\n' "$(node --version 2>/dev/null)"; fi`,
  `if [ -x ${BRIDGE_DIR}/run ]; then printf 'bridge=installed\\n'; elif [ -f ${BRIDGE_REPO}/claude-bridge.ts ] && [ -d ${BRIDGE_REPO}/node_modules/ws ]; then printf 'bridge=repo\\n'; fi`,
  `[ -S ${BRIDGE_SOCKET} ] && printf 'bridge_socket=1\\n'`,
  `printf '%s\\n' ${PROBE_END}`,
].join('\n');

export const REMOTE = {
  /** Codex's daemon, through its own byte pipe; `bin` is the Codex the look found (`codex` on the PATH, else its path). */
  codexProxy: (bin?: string | null) => `printf '%s\\n' ${PIPE_MARKER}; exec ${codexWord(bin)} app-server proxy`,
  /** Codex without a daemon: its app server on stdio, for as long as the connection lasts. */
  codexStdio: (bin?: string | null) => `printf '%s\\n' ${PIPE_MARKER}; exec ${codexWord(bin)} app-server`,
  /** The Claude bridge's proxy mode: the installed one, else a checkout's. */
  claudeProxy: [
    `if [ -x ${BRIDGE_DIR}/run ]; then printf '%s\\n' ${PIPE_MARKER}; exec ${BRIDGE_DIR}/run proxy; fi`,
    `if [ -f ${BRIDGE_REPO}/claude-bridge.ts ]; then printf '%s\\n' ${PIPE_MARKER}; exec node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON ${BRIDGE_REPO}/claude-bridge.ts proxy; fi`,
    `echo 'The Claude Code bridge is not installed here.' >&2; exit 3`,
  ].join('\n'),
};

// ---- Devices.

/** Whether a host is another device, reached over ssh. */
export const isRemote = (host: string) => host !== thisHost();

/** The ssh alias of a device, or why there is none. */
export function aliasOf(host: string): string {
  const alias = hostAlias(host);
  if (!alias) throw new Error(`${machineName(host)} has no ssh name the Journal can use.`);
  return alias;
}

/** Turns ssh's last words into what he reads. */
function sshFailure(host: string, alias: string, stderr: string, fallback: string): string {
  const line = stderr.split('\n').map((l) => l.trim()).filter((l) => l && !/^warning:/i.test(l)).pop() ?? '';
  const name = machineName(host);
  if (/could not resolve hostname/i.test(line)) return `${name} can’t be reached: ssh does not know the name “${alias}”. Add it to ~/.ssh/config on this machine, or fix its alias in the proj registry.`;
  if (/host key verification failed/i.test(line)) return `${name} can’t be reached: its host key is not known here yet. Run \`ssh ${alias}\` once in a terminal and accept it.`;
  if (/permission denied/i.test(line)) return `${name} can’t be reached: ssh key login to “${alias}” is refused (${line.replace(/^.*?permission denied/i, 'Permission denied')}).`;
  if (/timed out|no route to host|connection refused|network is unreachable/i.test(line)) return `${name} can’t be reached just now (${line.replace(/^ssh: /, '')}).`;
  return `${name} can’t be reached: ${line || fallback}`;
}

const probes = new Map<string, { at: number; status: DeviceStatus } | { pending: Promise<DeviceStatus> }>();

export function parseProbe(host: string, stdout: string): DeviceStatus & { home?: string; node?: string | null } {
  const start = stdout.indexOf(`${PROBE_START}\n`);
  const body = start >= 0 ? stdout.slice(start + PROBE_START.length + 1) : '';
  const end = body.indexOf(PROBE_END);
  const lines = (end >= 0 ? body.slice(0, end) : body).split('\n');
  const kv = new Map<string, string>();
  for (const line of lines) { const at = line.indexOf('='); if (at > 0) kv.set(line.slice(0, at), line.slice(at + 1).trim()); }
  const version = (raw: string | undefined) => (raw ? /\d+\.\d+\.\d+[\w.+-]*/.exec(raw)?.[0] ?? raw.slice(0, 40) : null);
  const bridge = kv.get('bridge_socket') ? 'running' : kv.get('bridge') ? 'installed' : 'missing';
  return {
    host,
    reachable: end >= 0,
    ...(end < 0 ? { reason: `${machineName(host)} answered, but not as expected. Is its login shell bash, zsh or sh?` } : {}),
    ...(kv.get('home') ? { home: kv.get('home') } : {}),
    ...(kv.get('os') ? { os: kv.get('os') } : {}),
    ...(kv.get('wsl') ? { wsl: true } : {}),
    codex: kv.has('codex')
      ? {
        version: version(kv.get('codex')), daemon: kv.get('codex_daemon') === '1',
        ...(kv.get('codex_home') ? { home: kv.get('codex_home') } : {}),
        ...(kv.get('codex_bin') ? { bin: kv.get('codex_bin') } : {}),
        ...(kv.get('codex_server') ? { server: version(kv.get('codex_server')) ?? undefined } : {}),
      }
      : null,
    claude: kv.has('claude') ? { version: version(kv.get('claude')), bridge } : null,
    node: kv.get('node') ?? null,
  };
}

/**
 * What a device has, from one read-only look over ssh (its home, OS, Codex and whether its daemon runs, Claude Code
 * and whether the bridge is there and running). Kept a minute (half that when it could not be reached); looks asked
 * for at once share one ssh. This machine is not looked at.
 */
export async function probeDevice(host: string, options: { fresh?: boolean } = {}): Promise<DeviceStatus & { home?: string; node?: string | null }> {
  if (!isRemote(host)) return { host, reachable: true, home: os.homedir() };
  const have = probes.get(host);
  if (have && 'pending' in have) return have.pending;
  if (have && !options.fresh && Date.now() - have.at < (have.status.reachable ? PROBE_OK_MS : PROBE_FAIL_MS)) return have.status;
  const pending = (async (): Promise<DeviceStatus> => {
    let alias: string;
    try { alias = aliasOf(host); } catch (error) { return { host, reachable: false, reason: (error as Error).message }; }
    ensureControlDir();
    return new Promise<DeviceStatus>((resolve) => {
      execFile(sshBinary(), sshArgs(alias, inLoginShell(probeScript())), { env: sshEnv(), timeout: PROBE_TIMEOUT_MS, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
        const parsed = parseProbe(host, String(stdout));
        if (parsed.reachable) { resolve(parsed); return; }
        const timedOut = !!error && (error as NodeJS.ErrnoException & { killed?: boolean }).killed;
        resolve({ host, reachable: false, reason: timedOut ? `${machineName(host)} did not answer in time.` : sshFailure(host, alias, String(stderr), error?.message ?? 'no answer') });
      });
    });
  })().then((status) => {
    const checked = { ...status, checkedAt: Date.now() };
    probes.set(host, { at: Date.now(), status: checked });
    return checked;
  });
  probes.set(host, { pending });
  return pending;
}

/** For the tests: forget what was found. */
export function forgetProbes(): void {
  probes.clear();
}

/** What a device reports in the pane: the look, without its home folder (a Codex found under it reads `~/…`). */
export function publicStatus(status: DeviceStatus & { home?: string; node?: string | null }): DeviceStatus {
  const rest: DeviceStatus & { home?: string; node?: string | null } = { ...status };
  if (rest.codex?.bin) rest.codex = { ...rest.codex, bin: tildePath(rest.codex.bin, rest.home) };
  delete rest.home;
  delete rest.node;
  return rest;
}

/** `~` and `~/…` on a device, as its home there. */
export function expandHome(cwd: string, home: string | undefined): string {
  if (!home) return cwd;
  if (cwd === '~') return home;
  if (cwd.startsWith('~/')) return path.posix.join(home, cwd.slice(2));
  return cwd;
}

function ensureControlDir(): void {
  const dir = sshControlDir();
  if (!dir) return;
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); fs.chmodSync(dir, 0o700); } catch { /* ssh says so when it cannot use it */ }
}

/** One remote command as a byte pipe (its stdin and stdout), from the marker on. */
export function sshPipe(host: string, script: string): ChildPipe {
  const alias = aliasOf(host);
  ensureControlDir();
  const child: ChildProcess = spawn(sshBinary(), sshArgs(alias, inLoginShell(script)), { env: sshEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
  return childPipe(child, { marker: PIPE_MARKER, describe: (stderr, code) => sshFailure(host, alias, stderr, `ssh ended (${code})`) });
}

/** One remote command as a child process speaking newline JSON on its stdio (Codex with no daemon there). */
export function sshCommand(host: string, script: string): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const alias = aliasOf(host);
  ensureControlDir();
  return { command: sshBinary(), args: sshArgs(alias, inLoginShell(script)), env: sshEnv() };
}
