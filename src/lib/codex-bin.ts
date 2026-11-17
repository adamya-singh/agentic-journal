// Where Codex is on a device when `codex` is not on its login shell's PATH. The Codex and ChatGPT desktop apps carry
// their own CLI inside the app (the Mac's ChatGPT.app runs its app server from it), Codex keeps a managed copy under
// ~/.codex/packages, an npm install under nvm is only on the PATH of an interactive shell (nvm loads from .zshrc, not
// the login profile), and the editor extensions bundle one each. Found on the Mac, 2026-11-17: no `codex` on PATH, the
// ChatGPT.app CLI 0.169.0-alpha.11.1, an nvm codex 0.158.0 (the one its daemon runs), a Cursor extension's copy.
// On this laptop: /usr/lib/chatgpt/resources/codex (the ChatGPT app for Linux, 0.155) and
// ~/.codex/packages/standalone/current/bin/codex (what ~/.local/bin/codex points at).
// Node imports only, no app aliases: the session-index collector runs on plain node too.

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Where to look, in order, after the PATH: the desktop apps' own CLI, Codex's managed installs, npm installs that are
 * not on a login shell's PATH, then the editor extensions' copies. Shell words, `$HOME` and globs expanded by sh.
 */
export const CODEX_PLACES: readonly string[] = [
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',
  '"$HOME/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex"',
  '"$HOME/.codex/packages/standalone/current/bin/codex"',
  '"$HOME/.codex/packages/app-server-daemon/current/bin/codex"',
  '/usr/lib/chatgpt/resources/codex',
  '"$HOME/.local/bin/codex"',
  '"$HOME/.npm-global/bin/codex"',
  '"$HOME"/.nvm/versions/node/*/bin/codex',
  '"$HOME"/.cursor/extensions/openai.chatgpt-*/bin/*/codex',
  '"$HOME"/.vscode/extensions/openai.chatgpt-*/bin/*/codex',
];

/**
 * A POSIX sh script that prints how to run Codex there: `codex` when it is on the PATH, else the full path of the first
 * copy above that answers `--version`; nothing when there is none. Run it in `/bin/sh` (not the login shell itself:
 * zsh stops at a glob that matches nothing), with the login shell's environment. Read-only: it only runs `--version`.
 */
export function findCodexScript(places: readonly string[] = CODEX_PLACES): string {
  return [
    'if command -v codex >/dev/null 2>&1; then echo codex; exit 0; fi',
    `for c in ${places.join(' ')}; do`,
    '  [ -f "$c" ] && [ -x "$c" ] && "$c" --version >/dev/null 2>&1 && { printf \'%s\\n\' "$c"; exit 0; }',
    'done',
    'exit 0',
  ].join('\n');
}

/** The finder as one command, for a script that runs in a login shell (zsh) or in sh. */
export const findCodexCommand = (places: readonly string[] = CODEX_PLACES) => `/bin/sh -c ${shq(findCodexScript(places))}`;

/** How a script runs the Codex that was found: the bare word when it is on the PATH, else its path, quoted. */
export const codexWord = (bin: string | null | undefined) => (!bin || bin === 'codex' ? 'codex' : shq(bin));

/** A path under `home` written as `~/…`, the way he would type it (and what the pane may show). */
export function tildePath(file: string, home: string | null | undefined): string {
  if (!home || home === '/') return file;
  const h = home.replace(/\/+$/, '');
  return file === h ? '~' : file.startsWith(`${h}/`) ? `~/${file.slice(h.length + 1)}` : file;
}
