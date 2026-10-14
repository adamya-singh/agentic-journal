// Read-only git access to the compass repo: the commit log is the compass's running history. Every
// call is a short synchronous `git -C <dir> …` with a 5 s timeout; failures degrade to empty results
// with git's first stderr line, never to a thrown error. Server-only (child_process).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import type {
  CommitAuthorKind,
  CommitDetail,
  CommitKind,
  CompassCommit,
  CompassHistory,
  HistoryScope,
  RepoInfo,
} from './types';

export const SHA_RE = /^[0-9a-f]{7,40}$/;
/** Diffs longer than this are cut and flagged `truncated`. */
export const DIFF_CAP_CHARS = 200 * 1024;
export const HISTORY_MAX_LIMIT = 200;
const TIMEOUT_MS = 5000;
const MAX_BUFFER = 8 * 1024 * 1024;
const FIELD = '\x1f';
const RECORD = '\x1e';
const LOG_FORMAT = `%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%s${RECORD}`;
const SHOW_FORMAT = `%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%s${FIELD}%b${RECORD}`;

/** The git binary; OPENCLAW_COMPASS_GIT is a test seam for "git is missing". */
export function gitBin(): string {
  return process.env.OPENCLAW_COMPASS_GIT || 'git';
}

/** The server's env minus every GIT_* key (a request must never inherit an index or work-tree override). */
function gitEnv(): NodeJS.ProcessEnv {
  const env: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('GIT_')) env[key] = value;
  }
  env.GIT_TERMINAL_PROMPT = '0';
  env.LC_ALL = 'C';
  return env as NodeJS.ProcessEnv;
}

export type GitResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string; code: string | number | null; stdout: string };

type ExecError = NodeJS.ErrnoException & {
  stderr?: string | Buffer;
  stdout?: string | Buffer;
  status?: number | null;
  signal?: string | null;
};

function firstStderrLine(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim());
  const first = lines[0] ?? '';
  // The safe.directory hint sits a few lines below "dubious ownership"; it is the line that helps.
  const hint = lines.find((l, i) => i > 0 && l.includes('safe.directory'));
  return hint ? `${first.trim()} ${hint.trim()}` : first.trim();
}

export function runGit(dir: string, args: string[]): GitResult {
  try {
    const stdout = execFileSync(
      gitBin(),
      ['-C', dir, '-c', 'color.ui=never', '-c', 'core.quotePath=false', ...args],
      {
        encoding: 'utf8',
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_BUFFER,
        env: gitEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { ok: true, stdout };
  } catch (e) {
    const err = e as ExecError;
    const stderr = String(err.stderr ?? '');
    let error: string;
    if (err.code === 'ENOENT') error = `git is not available (${gitBin()} was not found).`;
    else if (err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM')
      error = `git did not answer within ${TIMEOUT_MS / 1000} s.`;
    else if (err.code === 'ENOBUFS') error = 'git output exceeded 8 MB.';
    else error = firstStderrLine(stderr) || err.message || 'git failed.';
    return { ok: false, error, code: err.code ?? err.status ?? null, stdout: String(err.stdout ?? '') };
  }
}

let availableCache: { bin: string; ok: boolean } | null = null;

/** Whether the git binary runs at all; memoised per binary path. */
export function gitAvailable(): boolean {
  const bin = gitBin();
  if (availableCache && availableCache.bin === bin) return availableCache.ok;
  let ok = false;
  try {
    execFileSync(bin, ['--version'], {
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      env: gitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    ok = true;
  } catch {
    ok = false;
  }
  availableCache = { bin, ok };
  return ok;
}

export function resetGitCacheForTests(): void {
  availableCache = null;
}

export interface RepoCheck {
  isRepo: boolean;
  toplevel: string | null;
  error: string | null;
}

/**
 * True only when `dir` is the top level of its own repository. A compass/ folder that was never
 * `git init`ed would otherwise show the parent ~/.openclaw repo's history.
 */
export function isCompassRepo(dir: string): RepoCheck {
  let real: string;
  try {
    real = fs.realpathSync(dir);
  } catch {
    return { isRepo: false, toplevel: null, error: `${dir} does not exist.` };
  }
  const r = runGit(dir, ['rev-parse', '--show-toplevel']);
  if (!r.ok) return { isRepo: false, toplevel: null, error: r.error };
  const toplevel = r.stdout.trim();
  let realTop = toplevel;
  try {
    realTop = fs.realpathSync(toplevel);
  } catch {
    /* compare as reported */
  }
  if (realTop !== real) {
    return {
      isRepo: false,
      toplevel,
      error: `${dir} is not its own git repository (git sees ${toplevel}).`,
    };
  }
  return { isRepo: true, toplevel, error: null };
}

export function authorKind(name: string, email = ''): CommitAuthorKind {
  const s = `${name} ${email}`.toLowerCase();
  if (s.includes('compass-sync')) return 'compass-sync';
  if (s.includes('adamya')) return 'adamya';
  if (s.includes('openclaw')) return 'openclaw';
  return 'other';
}

export function commitKind(subject: string): CommitKind {
  const m = /^compass\((short|long|pulse|period|draft|repo)\):/i.exec(subject.trim());
  return m ? (m[1].toLowerCase() as CommitKind) : 'other';
}

function toCommit(fields: string[]): CompassCommit {
  const [sha = '', author = '', email = '', date = '', subject = ''] = fields;
  return {
    sha,
    shortSha: sha.slice(0, 7),
    author,
    authorKind: authorKind(author, email),
    date,
    subject,
    kind: commitKind(subject),
  };
}

function parseLog(stdout: string): CompassCommit[] {
  return stdout
    .split(RECORD)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim())
    .map((record) => toCommit(record.split(FIELD)));
}

function emptyRepoError(error: string): boolean {
  return /does not have any commits yet|bad default revision|unknown revision/i.test(error);
}

export interface ListCommitsOptions {
  scope?: HistoryScope;
  limit?: number;
}

export function clampLimit(limit: number | undefined, fallback = 30): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.min(HISTORY_MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

/** Newest first. `short` and `long` restrict to that folder; `all` is the whole repo. */
export function listCommits(
  dir: string,
  options: ListCommitsOptions = {},
): { commits: CompassCommit[]; error: string | null } {
  const limit = clampLimit(options.limit);
  const scope = options.scope ?? 'all';
  const args = ['log', `-n${limit}`, `--format=${LOG_FORMAT}`];
  if (scope === 'short') args.push('--', 'short-term');
  else if (scope === 'long') args.push('--', 'long-term');
  const r = runGit(dir, args);
  if (!r.ok) return { commits: [], error: emptyRepoError(r.error) ? null : r.error };
  return { commits: parseLog(r.stdout), error: null };
}

/** One commit with its unified diff (capped at 200 KB); null for a bad or unknown sha. */
export function showCommit(dir: string, sha: string): CommitDetail | null {
  if (!SHA_RE.test(sha)) return null;
  const r = runGit(dir, [
    'show',
    `--format=${SHOW_FORMAT}`,
    '--unified=3',
    '--no-color',
    '--no-ext-diff',
    sha,
    '--',
  ]);
  let stdout: string;
  let truncated = false;
  if (r.ok) stdout = r.stdout;
  else if (r.code === 'ENOBUFS' && r.stdout) {
    stdout = r.stdout;
    truncated = true;
  } else return null;
  const sep = stdout.indexOf(RECORD);
  if (sep < 0) return null;
  const header = stdout.slice(0, sep).split(FIELD);
  const body = (header[5] ?? '').trim();
  let diff = stdout.slice(sep + 1).replace(/^(\r?\n)+/, '');
  if (diff.length > DIFF_CAP_CHARS) {
    diff = diff.slice(0, DIFF_CAP_CHARS);
    truncated = true;
  }
  let additions = 0,
    deletions = 0;
  const files: string[] = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.+)$/.exec(line);
      if (m) files.push(m[1]);
    } else if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { ...toCommit(header), body, files, diff, truncated, additions, deletions };
}

/** Removes `user@` / `user:pass@` from a remote URL (ssh://, https:// or scp-like host:path). */
export function stripUserinfo(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*:\/\/)(?:[^@/]+@)?(.*)$/i.exec(url);
  if (scheme) return scheme[1] + scheme[2];
  const scp = /^(?:[^@/:]+@)?([^:/]+:.*)$/.exec(url);
  return scp ? scp[1] : url;
}

export function headInfo(dir: string): Pick<RepoInfo, 'branch' | 'head' | 'remote'> {
  const symbolic = runGit(dir, ['symbolic-ref', '--short', '-q', 'HEAD']);
  let branch: string | null = symbolic.ok ? symbolic.stdout.trim() || null : null;
  if (!branch) {
    const detached = runGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    branch = detached.ok ? detached.stdout.trim() || null : null;
  }
  const head = listCommits(dir, { limit: 1 }).commits[0] ?? null;
  const remote = runGit(dir, ['remote', 'get-url', 'origin']);
  return {
    branch,
    head,
    remote: remote.ok && remote.stdout.trim() ? stripUserinfo(remote.stdout.trim()) : null,
  };
}

/** Author date of the last commit touching `rel` (a file or folder), or null. */
export function fileLastCommitAt(dir: string, rel: string): string | null {
  const r = runGit(dir, ['log', '-1', '--format=%aI', '--', rel]);
  if (!r.ok) return null;
  return r.stdout.trim() || null;
}

export function repoInfo(dir: string): RepoInfo {
  const base: RepoInfo = {
    dir,
    gitAvailable: false,
    isRepo: false,
    branch: null,
    head: null,
    remote: null,
    error: null,
  };
  if (!gitAvailable()) return { ...base, error: `git is not installed (looked for ${gitBin()}).` };
  const check = isCompassRepo(dir);
  if (!check.isRepo) return { ...base, gitAvailable: true, error: check.error };
  return { ...base, gitAvailable: true, isRepo: true, ...headInfo(dir) };
}

/** The history payload: commits, or an empty list with the reason. */
export function listHistory(dir: string, scope: HistoryScope = 'short', limit?: number): CompassHistory {
  const n = clampLimit(limit);
  if (!gitAvailable()) {
    return { scope, limit: n, commits: [], error: `git is not installed (looked for ${gitBin()}).` };
  }
  const check = isCompassRepo(dir);
  if (!check.isRepo) return { scope, limit: n, commits: [], error: check.error };
  const { commits, error } = listCommits(dir, { scope, limit: n });
  return { scope, limit: n, commits, error };
}
