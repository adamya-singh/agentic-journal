// The devices Adamya works on, as the `proj` registry knows them (~/projects/projects-index): registry.json names each
// host and the ssh alias it is reached by (laptop → ubuntu-laptop, mac → macbook, wsl → win11), and hosts/<host>.json
// lists that host's projects and their paths. This machine's own host name is in ~/.config/proj/host.
// Node imports only, no app aliases: the session-index CLI reads it on plain node too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** The `proj` registry folder. PROJ_REGISTRY_DIR points elsewhere (the tests). */
export function projRegistryDir(): string {
  return process.env.PROJ_REGISTRY_DIR || path.join(os.homedir(), 'projects', 'projects-index');
}

/** This machine's `proj` host name (~/.config/proj/host); PROJ_HOST overrides it. */
export function thisHost(): string {
  if (process.env.PROJ_HOST) return process.env.PROJ_HOST;
  try {
    const name = fs.readFileSync(path.join(os.homedir(), '.config', 'proj', 'host'), 'utf-8').trim();
    if (HOST_NAME.test(name)) return name;
  } catch { /* not set up: this machine is the laptop */ }
  return 'laptop';
}

export const HOST_NAME = /^[a-z0-9_-]{1,40}$/i;
/** An ssh alias as the registry may give one: a Host name or user@host, nothing ssh would read as an option. */
const ALIAS = /^(?:[a-z0-9._-]+@)?[a-z0-9][a-z0-9._-]{0,99}$/i;

const readJson = (file: string): unknown => {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
};

function registry(): { hosts?: Record<string, { alias?: unknown } | null>; projects?: Record<string, { status?: unknown } | null> } | null {
  return readJson(path.join(projRegistryDir(), 'registry.json')) as ReturnType<typeof registry>;
}

/** Every host the registry knows (registry.json, then any hosts/<host>.json it does not name). */
export function knownHosts(): string[] {
  const listed = Object.keys(registry()?.hosts ?? {});
  let files: string[] = [];
  try { files = fs.readdirSync(path.join(projRegistryDir(), 'hosts')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { /* no registry */ }
  return [...new Set([...listed, ...files])].filter((h) => HOST_NAME.test(h));
}

/** How ssh reaches a host: its registry alias, else its own name. Null for a name ssh could misread. */
export function hostAlias(host: string): string | null {
  const alias = registry()?.hosts?.[host]?.alias;
  const name = typeof alias === 'string' && alias.trim() ? alias.trim() : host;
  return ALIAS.test(name) ? name : null;
}

/** The projects of one host as its `proj` file lists them: name → path, `~` left as written. */
export function hostProjects(host: string): { name: string; path: string }[] {
  if (!HOST_NAME.test(host)) return [];
  const raw = readJson(path.join(projRegistryDir(), 'hosts', `${host}.json`)) as { projects?: Record<string, { path?: unknown }> } | null;
  if (!raw?.projects || typeof raw.projects !== 'object') return [];
  return Object.entries(raw.projects)
    .filter(([, value]) => value && typeof value.path === 'string' && value.path)
    .map(([name, value]) => ({ name, path: value.path as string }));
}

export function archivedProjects(): Set<string> {
  return new Set(Object.entries(registry()?.projects ?? {}).filter(([, p]) => p?.status === 'archived').map(([name]) => name));
}

const MACHINE: Record<string, string> = { laptop: 'laptop', wsl: 'PC', mac: 'Mac' };
/** What a host is called in the Journal's words: laptop, PC, Mac. */
export const machineName = (host: string) => MACHINE[host] ?? host;
