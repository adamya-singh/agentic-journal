// The session index's collector: reads every device's Claude Code and Codex transcripts (and this machine's OpenClaw
// sessions) and leaves one digest per session in data/session-index/inbox/<host>/, which `ingest` folds into index.db.
// It runs on the Journal's machine (scripts/session-index.ts sync, every 15 minutes): this machine's files are read
// from disk; another device's over ssh, by its proj alias, with read-only commands only (find, stat, tail, cat, gzip):
// nothing is installed, started or written there.
//
// What it read is kept in data/session-index/collect/<host>.json (each file's size and time, and its digest so far),
// so a run reads only what changed, and a transcript that grew only from where it was left. A run stops starting new
// reads when its time is up; the next run goes on. A device that cannot be reached keeps the digests it sent before.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { PassThrough, Transform, type Readable } from 'node:stream';
import zlib from 'node:zlib';
import { backendDataDir } from '../backend-data.ts';
import { findCodexCommand, tildePath } from '../codex-bin.ts';
import { hostAlias, hostProjects, knownHosts, thisHost } from '../proj-hosts.ts';
import { feedClaudeLine, feedCodexLine, finishDigest, mergeAccs, newAcc, type DigestAcc } from './digest.ts';
import { journalChatTitles, journalNames, openclawDigests } from './openclaw.ts';
import { noteDeviceCodex } from './devices.ts';
import { inboxDir, sessionIndexDir } from './store.ts';
import type { AppRecord, SessionDigest } from './types.ts';
import { journalIds } from './view.ts';

export type EntryKind = 'claude' | 'codex' | 'codex-index' | 'app';
export interface Entry { kind: EntryKind; path: string; size: number; mtime: number }
/** codex: the Codex there when `codex` is not on its PATH (an app's own copy, codex-bin.ts), for its resume commands. */
export interface Listing { home: string | null; entries: Entry[]; codex?: string }

/**
 * Lists a device's transcripts, read-only, in POSIX sh (GNU find on Linux and WSL, BSD find and stat on macOS):
 * Claude Code's (~/.claude/projects, and on WSL the Windows user's too), Codex's (CODEX_HOME, ~/.codex, and on WSL the
 * Windows Codex home), Codex's thread names, and the Claude desktop app's session records. Each folder once. Also
 * which Codex runs there when `codex` is not on its PATH (the Mac's ChatGPT.app copy; only `--version` is run).
 */
export const LIST_SCRIPT = `P=
find / -maxdepth 0 -printf '' >/dev/null 2>&1 && P=1
L() { if [ -n "$P" ]; then find "$@" -printf '%s %T@ %p\\n' 2>/dev/null; else find "$@" -exec stat -f '%z %m %N' {} + 2>/dev/null; fi; }
seen=:
once() { r=$(cd "$1" 2>/dev/null && pwd -P) || return 1; case "$seen" in *":$r:"*) return 1;; esac; seen="$seen$r:"; return 0; }
printf 'AJ-HOME %s\\n' "$HOME"
c=$(${findCodexCommand()} 2>/dev/null); [ -n "$c" ] && [ "$c" != codex ] && printf 'AJ-CODEX %s\\n' "$c"
for d in "$HOME/.claude/projects" /mnt/c/Users/*/.claude/projects; do
  [ -d "$d" ] && once "$d" || continue
  printf 'AJ-ROOT claude %s\\n' "$d"; L "$d" -mindepth 2 -maxdepth 2 -type f -name '*.jsonl'
done
for h in "\${CODEX_HOME:-}" "$HOME/.codex" /mnt/c/Users/*/.codex; do
  [ -n "$h" ] && [ -d "$h" ] && once "$h" || continue
  printf 'AJ-ROOT codex %s\\n' "$h"
  for s in sessions archived_sessions; do [ -d "$h/$s" ] && L "$h/$s" -type f \\( -name '*.jsonl' -o -name '*.jsonl.zst' \\); done
  [ -f "$h/session_index.jsonl" ] && { printf 'AJ-ROOT codex-index %s\\n' "$h"; L "$h/session_index.jsonl"; }
done
for a in "$HOME/Library/Application Support/Claude" /mnt/c/Users/*/AppData/Roaming/Claude /mnt/c/Users/*/AppData/Local/Packages/Claude_*/LocalCache/Roaming/Claude; do
  [ -d "$a/claude-code-sessions" ] && once "$a/claude-code-sessions" || continue
  printf 'AJ-ROOT app %s\\n' "$a"; L "$a/claude-code-sessions" -type f -name '*.json'
done
printf 'AJ-END\\n'`;

export function parseListing(stdout: string): Listing {
  let home: string | null = null;
  let kind: EntryKind | null = null;
  let ended = false;
  let codex: string | null = null;
  const entries: Entry[] = [];
  for (const line of stdout.split('\n')) {
    if (line.startsWith('AJ-HOME ')) { home = line.slice(8).trim() || null; continue; }
    if (line.startsWith('AJ-CODEX /')) { codex = line.slice(9).trim(); continue; }
    if (line.startsWith('AJ-ROOT ')) { const k = line.slice(8).split(' ')[0]; kind = (['claude', 'codex', 'codex-index', 'app'] as const).find((x) => x === k) ?? null; continue; }
    if (line === 'AJ-END') { ended = true; continue; }
    const m = /^(\d+) (\d+(?:\.\d+)?) (\/.+)$/.exec(line);
    if (m && kind) entries.push({ kind, size: Number(m[1]), mtime: Math.round(Number(m[2]) * 1000), path: m[3]! });
  }
  if (!ended) throw new Error('the listing of its sessions did not finish');
  return { home, entries, ...(codex ? { codex: tildePath(codex, home) } : {}) };
}

// ---- Where the bytes come from: this machine's disk, or another device through ssh.

export interface Source {
  host: string;
  remote: boolean;
  list(): Promise<Listing>;
  /** The file's bytes from `start` on, as they are on disk (a .zst still compressed). */
  read(file: string, start: number): Readable;
  text(file: string): Promise<string>;
}

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function run(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('it took too long to answer')); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d: Buffer) => { if (err.length < 4000) err += d.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').filter((l) => !/post-quantum|\*\*/.test(l)).pop() || `exit ${code}`));
    });
  });
}

/** `listTimeoutMs`: how long the listing may take (a refresh from the Journal waits less than the timer). */
export function localSource(host = thisHost(), listTimeoutMs = 120_000): Source {
  return {
    host, remote: false,
    list: async () => parseListing(await run('/bin/sh', ['-c', LIST_SCRIPT], process.env, listTimeoutMs)),
    read: (file, start) => fs.createReadStream(file, { start }),
    text: async (file) => fs.readFileSync(file, 'utf8'),
  };
}

/** The environment ssh runs with: what it needs, never the Journal's own settings (as code-agents/ssh.ts). */
function sshEnv(): NodeJS.ProcessEnv {
  const keep = new Set(['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'TZ', 'TMPDIR', 'SSH_AUTH_SOCK']);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && (keep.has(key) || key.startsWith('LC_') || key.startsWith('XDG_'))) out[key] = value;
  return out as NodeJS.ProcessEnv;
}

/** ssh as the coding sessions use it (code-agents/ssh.ts): no prompts, no tty, and the same shared master connection. */
export function sshArgs(alias: string, command: string): string[] {
  const set = process.env.CODE_AGENTS_SSH_CONTROL;
  const control = set === 'none' ? null : set || path.join(os.homedir(), '.local', 'state', 'agentic-journal', 'ssh');
  const reuse = control && Buffer.byteLength(path.join(control, 'x'.repeat(40))) < 100;
  if (reuse) { try { fs.mkdirSync(control, { recursive: true, mode: 0o700 }); } catch { /* ssh says */ } }
  return [
    '-T', '-e', 'none', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
    ...(reuse ? ['-o', 'ControlMaster=auto', '-o', `ControlPath=${path.join(control!, '%C')}`, '-o', 'ControlPersist=600'] : []),
    '--', alias, command,
  ];
}

const MARKER = 'AJ-PIPE-1\n';

/** Drops whatever comes before the marker line (a profile that prints), then passes the bytes on. */
function afterMarker(): Transform {
  let head: Buffer | null = Buffer.alloc(0);
  return new Transform({
    transform(chunk: Buffer, _enc, done) {
      if (head === null) { done(null, chunk); return; }
      head = Buffer.concat([head, chunk]);
      const at = head.indexOf(MARKER);
      if (at < 0) { if (head.length > 1 << 20) { done(new Error('the device did not start sending')); return; } done(); return; }
      const rest = head.subarray(at + MARKER.length);
      head = null;
      done(null, rest);
    },
  });
}

export function sshSource(host: string, alias: string, listTimeoutMs = 120_000): Source {
  const ssh = process.env.CODE_AGENTS_SSH || 'ssh';
  const env = sshEnv();
  // The listing gets his login shell's environment (CODEX_HOME as his terminal has it) but runs in sh: zsh, the Mac's
  // shell, stops at a pattern that matches nothing (the WSL folders). Reads name whole paths.
  const listCommand = `exec "\${SHELL:-/bin/sh}" -lc ${shq(`exec /bin/sh -c ${shq(LIST_SCRIPT)}`)}`;
  return {
    host, remote: true,
    list: async () => parseListing(await run(ssh, sshArgs(alias, listCommand), env, listTimeoutMs)),
    read(file, start) {
      // A compressed rollout comes as it is; a transcript comes gzipped (a third of its size or less).
      const zst = file.endsWith('.zst');
      const body = zst ? `cat -- ${shq(file)}` : `tail -c +${start + 1} -- ${shq(file)} | gzip -1 -c`;
      const child = spawn(ssh, sshArgs(alias, `printf 'AJ-PIPE-1\\n'; ${body}`), { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const out = new PassThrough();
      let err = '';
      child.stderr.on('data', (d: Buffer) => { if (err.length < 2000) err += d.toString('utf8'); });
      const bytes = child.stdout.pipe(afterMarker());
      (zst ? bytes : bytes.pipe(zlib.createGunzip())).on('error', (e) => out.destroy(e)).pipe(out);
      child.on('close', (code) => { if (code !== 0) out.destroy(new Error(err.trim().split('\n').pop() || `exit ${code}`)); });
      child.on('error', (e) => out.destroy(e));
      out.on('close', () => { if (child.exitCode === null) child.kill('SIGTERM'); });
      return out;
    },
    text: async (file) => {
      const out = await run(ssh, sshArgs(alias, `printf 'AJ-PIPE-1\\n'; cat -- ${shq(file)}`), env, 60_000);
      const at = out.indexOf(MARKER);
      return at < 0 ? out : out.slice(at + MARKER.length);
    },
  };
}

// ---- Reading one transcript into its digest so far.

/**
 * Feeds a file's lines from `start` (the size it had when last read) to the accumulator. Reading on from where it was
 * left needs the byte before `start` to end a line; when it does not (the file was rewritten), it reads it all anew.
 */
async function feedFile(source: Source, entry: Entry, prev: { size: number; acc: DigestAcc } | null, known: ReadonlySet<string>): Promise<DigestAcc> {
  const app = entry.kind === 'claude' ? 'claude-code' : 'codex';
  const feed = entry.kind === 'claude' ? feedClaudeLine : feedCodexLine;
  const resume = !!prev && !entry.path.endsWith('.zst') && prev.size > 0 && entry.size > prev.size;
  const acc: DigestAcc = resume ? structuredClone(prev!.acc) : newAcc(app);
  let stream = source.read(entry.path, resume ? prev!.size - 1 : 0);
  if (entry.path.endsWith('.zst')) stream = stream.pipe(zlib.createZstdDecompress());
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let firstLine = true;
  try {
    for await (const line of lines) {
      if (firstLine && resume) {
        firstLine = false;
        if (line !== '') { lines.close(); stream.destroy(); return feedFile(source, entry, null, known); }
        continue;
      }
      firstLine = false;
      if (line) feed(acc, line, known);
    }
  } finally {
    lines.close();
  }
  return acc;
}

// ---- The Claude desktop app's records (macOS; Windows when it has them): titles, Remote Control ids, SSH hosts.

export function appRecordOf(raw: unknown): AppRecord | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cli = typeof r.cliSessionId === 'string' ? r.cliSessionId : null;
  if (!cli) return null;
  const bridge: string[] = [];
  for (const [k, v] of Object.entries(r)) {
    if (!/bridge|remote/i.test(k)) continue;
    for (const s of Array.isArray(v) ? v : [v]) if (typeof s === 'string' && /^session_[A-Za-z0-9]+$/.test(s) && !bridge.includes(s)) bridge.push(s);
  }
  const ssh = r.sshConfig && typeof r.sshConfig === 'object' ? (r.sshConfig as Record<string, unknown>) : null;
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : undefined);
  return {
    cli, title: typeof r.title === 'string' ? r.title : '', bridge,
    // The app writes {sshHost, sshPort?, sshIdentityFile?} (seen on the Mac, 2026-11-17); the other names are kept.
    ssh: ssh ? String(ssh.sshHost ?? ssh.host ?? ssh.hostname ?? ssh.alias ?? '') || null : null,
    ...(typeof (r.cwd ?? r.originCwd) === 'string' ? { cwd: String(r.cwd ?? r.originCwd) } : {}),
    ...(r.isArchived === true || r.archived === true ? { archived: true } : {}),
    created: num(r.createdAt), active: num(r.lastActivityAt ?? r.updatedAt),
  };
}

// ---- One device.

interface FileState { size: number; mtime: number; acc?: DigestAcc; titles?: [string, string][]; record?: AppRecord | null }
interface HostState { v: 1; files: Record<string, FileState>; syncedAt: string | null }

const stateFile = (host: string) => path.join(sessionIndexDir(), 'collect', `${host}.json`);

function readState(host: string): HostState {
  try {
    const raw = JSON.parse(fs.readFileSync(stateFile(host), 'utf8')) as HostState;
    if (raw?.v === 1 && raw.files) return raw;
  } catch { /* first run */ }
  return { v: 1, files: {}, syncedAt: null };
}

function writeAtomic(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** The proj project a folder is in (its longest matching path), from that host's proj file. */
function projectFinder(host: string, home: string | null): (cwd: string) => string | null {
  const projects = hostProjects(host).map((p) => ({ name: p.name, path: home && p.path.startsWith('~/') ? `${home}/${p.path.slice(2)}` : p.path }))
    .sort((a, b) => b.path.length - a.path.length);
  return (cwd) => projects.find((p) => cwd === p.path || cwd.startsWith(`${p.path}/`))?.name ?? null;
}

/** skipped: the run's time was up before this device's turn came; it was not asked at all. */
export interface HostResult { host: string; remote: boolean; reachable: boolean; skipped?: boolean; error?: string; files: number; read: number; pending: number; sessions: number; written: number; removed: number }

export async function collectHost(source: Source, options: { deadline: number; known: ReadonlySet<string>; openclaw?: boolean; log?: (line: string) => void }): Promise<HostResult> {
  const host = source.host;
  const result: HostResult = { host, remote: source.remote, reachable: false, files: 0, read: 0, pending: 0, sessions: 0, written: 0, removed: 0 };
  let listing: Listing;
  try {
    listing = await source.list();
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    return result;
  }
  result.reachable = true;
  result.files = listing.entries.length;
  const state = readState(host);
  const next: HostState = { v: 1, files: {}, syncedAt: new Date().toISOString() };
  // What changed, newest first, so a run that runs out of time has read what is being worked on now.
  const entries = [...listing.entries].sort((a, b) => b.mtime - a.mtime);
  for (const entry of entries) {
    const prev = state.files[entry.path];
    if (prev && prev.size === entry.size && prev.mtime === entry.mtime) { next.files[entry.path] = prev; continue; }
    if (Date.now() > options.deadline) { if (prev) next.files[entry.path] = prev; result.pending++; continue; }
    try {
      if (entry.kind === 'claude' || entry.kind === 'codex') {
        const acc = await feedFile(source, entry, prev?.acc ? { size: prev.size, acc: prev.acc } : null, options.known);
        if (!acc.id && entry.kind === 'claude') acc.id = path.basename(entry.path, '.jsonl');
        next.files[entry.path] = { size: entry.size, mtime: entry.mtime, acc };
      } else if (entry.kind === 'codex-index') {
        const titles = new Map<string, string>();
        for (const line of (await source.text(entry.path)).split('\n')) {
          try { const j = JSON.parse(line) as { id?: unknown; thread_name?: unknown }; if (typeof j.id === 'string' && typeof j.thread_name === 'string' && j.thread_name) titles.set(j.id, j.thread_name); } catch { /* a broken line */ }
        }
        next.files[entry.path] = { size: entry.size, mtime: entry.mtime, titles: [...titles] };
      } else {
        let record: AppRecord | null = null;
        try { record = appRecordOf(JSON.parse(await source.text(entry.path))); } catch { /* not a record */ }
        next.files[entry.path] = { size: entry.size, mtime: entry.mtime, record };
      }
      result.read++;
    } catch (e) {
      options.log?.(`${host}: could not read ${entry.path}: ${e instanceof Error ? e.message : String(e)}`);
      if (prev) next.files[entry.path] = prev;
      result.pending++;
    }
  }

  // One digest per session: Codex writes a thread in several rollout files; the Windows and WSL stores can share one.
  const codexTitles = new Map<string, string>();
  const parts = new Map<string, { accs: DigestAcc[]; path: string }>();
  const records: AppRecord[] = [];
  for (const entry of listing.entries) {
    const s = next.files[entry.path];
    if (!s) continue;
    if (s.titles) for (const [id, title] of s.titles) codexTitles.set(id, title);
    if (s.record) records.push(s.record);
    if (!s.acc?.id) continue;
    const uid = `${s.acc.app}:${s.acc.id}`;
    const have = parts.get(uid);
    if (have) have.accs.push(s.acc); else parts.set(uid, { accs: [s.acc], path: entry.path });
  }
  const projectOf = projectFinder(host, listing.home);
  const digests: SessionDigest[] = [];
  for (const { accs, path: file } of parts.values()) {
    const acc = accs.length > 1 ? mergeAccs(accs) : accs[0]!;
    if (!acc.turns && !acc.total) continue;   // nothing was said in it
    digests.push(finishDigest(acc, { host, path: file, projectOf }, acc.app === 'codex' ? { title: codexTitles.get(acc.id) } : {}));
  }
  if (options.openclaw) {
    const dataDir = backendDataDir();
    digests.push(...openclawDigests({ known: options.known, titles: journalChatTitles(dataDir), names: journalNames(dataDir), host }));
  }

  // The inbox for this host is the collector's: what it no longer finds goes.
  const inbox = path.join(inboxDir(), host);
  fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
  const keep = new Set<string>();
  for (const d of digests) {
    const name = `${d.app}-${d.id.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
    keep.add(name);
    const text = JSON.stringify(d);
    const file = path.join(inbox, name);
    let same = false;
    try { same = fs.readFileSync(file, 'utf8') === text; } catch { /* new */ }
    if (!same) { writeAtomic(file, text); result.written++; }
  }
  const appsName = `apps-${host}.json`;
  keep.add(appsName);
  // Written every run: its time is when this device last sent its sessions.
  writeAtomic(path.join(inbox, appsName), JSON.stringify({ v: 1, host, records }));
  for (const f of fs.readdirSync(inbox)) {
    if (f.endsWith('.json') && !keep.has(f)) { fs.rmSync(path.join(inbox, f), { force: true }); result.removed++; }
  }
  writeAtomic(stateFile(host), JSON.stringify(next));
  noteDeviceCodex(host, listing.codex ?? null);
  result.sessions = digests.length;
  return result;
}

/**
 * Every device of the proj registry (this one first), or the ones named. Each device has `budgetMs` to start new reads
 * in, so a first run that has gigabytes to read on one device does not starve the others. `listTimeoutMs` bounds how
 * long a device's listing may take (a device that does not answer is given up on then), and a device whose turn
 * comes after `stopAfterMs` from the start is not asked this run (a refresh from the Journal is kept short).
 */
export async function collect(options: { hosts?: string[]; budgetMs?: number; listTimeoutMs?: number; stopAfterMs?: number; log?: (line: string) => void } = {}): Promise<HostResult[]> {
  const here = thisHost();
  const hosts = options.hosts?.length ? options.hosts : [here, ...knownHosts().filter((h) => h !== here)];
  const { ids } = journalIds();
  const out: HostResult[] = [];
  const stopAt = options.stopAfterMs ? Date.now() + options.stopAfterMs : Infinity;
  const none = { files: 0, read: 0, pending: 0, sessions: 0, written: 0, removed: 0 };
  for (const host of hosts) {
    if (Date.now() > stopAt) { out.push({ host, remote: host !== here, reachable: false, skipped: true, error: 'its turn did not come before the time was up', ...none }); continue; }
    const deadline = Math.min(Date.now() + (options.budgetMs ?? 80_000), stopAt);
    if (host === here) { out.push(await collectHost(localSource(host, options.listTimeoutMs), { deadline, known: ids, openclaw: true, log: options.log })); continue; }
    const alias = hostAlias(host);
    if (!alias) { out.push({ host, remote: true, reachable: false, error: 'it has no ssh name in the proj registry', ...none }); continue; }
    out.push(await collectHost(sshSource(host, alias, options.listTimeoutMs), { deadline, known: ids, log: options.log }));
  }
  return out;
}
