// The way back into a Claude Code or Codex session from a terminal: its folder, then the agent's own resume
// command. Pure, so the browser can use it too (the task workspace's coding sessions, the session index rows).

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
/** A word the shell reads as itself is left bare (a uuid, a thread id); anything else is quoted. */
const word = (s: string) => (/^[A-Za-z0-9._:@%+=,/-]+$/.test(s) ? s : shq(s));

/** A folder for `cd`: `~` and `~/…` keep the tilde outside the quotes, so the shell still reads it as home. */
function folder(cwd: string | null): string {
  const dir = cwd || '~';
  if (dir === '~') return '~';
  if (dir.startsWith('~/')) return `~/${shq(dir.slice(2))}`;
  return shq(dir);
}

/**
 * `cd '<cwd>' && claude --resume <id>`, or `… && codex resume <id>`; the id is quoted when it needs it. A session on
 * another device (`ssh`: its ssh alias) is resumed there, in its login shell, so its own `codex` or `claude` is found:
 * `ssh -t macbook 'exec "$SHELL" -lc '\''cd … && codex resume …'\'''`, written as plainly as quoting allows.
 */
export function resumeCommand(app: 'claude-code' | 'codex', cwd: string | null, id: string, ssh?: string | null): string {
  const agent = `${app === 'claude-code' ? 'claude --resume' : 'codex resume'} ${word(id)}`;
  if (!ssh) return `cd ${folder(cwd)} && ${agent}`;
  // A folder of plain characters is left bare (one quoting less to read); anything else is quoted as here.
  const dir = cwd && /^~?[A-Za-z0-9._/-]+$/.test(cwd) ? cwd : folder(cwd);
  const local = `cd ${dir} && ${agent}`;
  // The script goes to the remote login shell in double quotes when nothing in it is special there (the usual case:
  // the folder's own quotes are single), else quoted whole.
  const inner = /[$`"\\!]/.test(local) ? `exec "$SHELL" -lc ${shq(local)}` : `exec "$SHELL" -lc "${local}"`;
  return `ssh -t ${word(ssh)} ${shq(inner)}`;
}
