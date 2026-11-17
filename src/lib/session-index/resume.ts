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

/** The program: its usual name, or the path of the copy to run (`~/…` keeps the tilde bare, so the shell expands it). */
function program(bin: string | null | undefined, name: string): string {
  if (!bin || bin === name) return name;
  if (bin.startsWith('~/')) return /^~\/[A-Za-z0-9._/@+-]+$/.test(bin) ? bin : `~/${shq(bin.slice(2))}`;
  return word(bin);
}

/**
 * `cd '<cwd>' && claude --resume <id>`, or `… && codex resume <id>`; the id is quoted when it needs it. A session on
 * another device (`ssh`: its ssh alias) is resumed there, in its login shell, so its own `codex` or `claude` is found:
 * `ssh -t macbook 'exec "$SHELL" -lc '\''cd … && codex resume …'\'''`, written as plainly as quoting allows.
 * `bin` is the Codex to run there when `codex` is not on that device's PATH (an app's own copy, as its look found it:
 * `/Applications/ChatGPT.app/…/codex`, or `~/…`).
 */
export function resumeCommand(app: 'claude-code' | 'codex', cwd: string | null, id: string, ssh?: string | null, bin?: string | null): string {
  const agent = `${app === 'claude-code' ? 'claude --resume' : `${program(bin, 'codex')} resume`} ${word(id)}`;
  if (!ssh) return `cd ${folder(cwd)} && ${agent}`;
  // A folder of plain characters is left bare (one quoting less to read); anything else is quoted as here.
  const dir = cwd && /^~?[A-Za-z0-9._/-]+$/.test(cwd) ? cwd : folder(cwd);
  const local = `cd ${dir} && ${agent}`;
  // The script goes to the remote login shell in double quotes when nothing in it is special there (the usual case:
  // the folder's own quotes are single), else quoted whole.
  const inner = /[$`"\\!]/.test(local) ? `exec "$SHELL" -lc ${shq(local)}` : `exec "$SHELL" -lc "${local}"`;
  return `ssh -t ${word(ssh)} ${shq(inner)}`;
}
