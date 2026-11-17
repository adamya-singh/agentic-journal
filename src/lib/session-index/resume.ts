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

/** `cd '<cwd>' && claude --resume <id>`, or `… && codex resume <id>`; the id is quoted when it needs it. */
export function resumeCommand(app: 'claude-code' | 'codex', cwd: string | null, id: string): string {
  return `cd ${folder(cwd)} && ${app === 'claude-code' ? 'claude --resume' : 'codex resume'} ${word(id)}`;
}
