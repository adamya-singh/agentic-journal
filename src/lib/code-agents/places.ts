// Where a task's coding-agent session can run: OpenClaw's shared workspace folder (where the task's file tabs
// live), or one of the projects the `proj` registry knows (~/projects/projects-index: registry.json, and
// hosts/<host>.json with each host's projects and their paths). Only this machine's places can be started on for
// now; other hosts' projects are listed, marked as not yet available.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceRoot } from '@/app/api/tasks/files/store';
import type { Place, PlaceChoice } from './protocol';

/** The `proj` registry folder. PROJ_REGISTRY_DIR points elsewhere (the tests). */
export function projRegistryDir(): string {
  return process.env.PROJ_REGISTRY_DIR || path.join(os.homedir(), 'projects', 'projects-index');
}

/** This machine's `proj` host name (~/.config/proj/host); PROJ_HOST overrides it. */
export function thisHost(): string {
  if (process.env.PROJ_HOST) return process.env.PROJ_HOST;
  try {
    const name = fs.readFileSync(path.join(os.homedir(), '.config', 'proj', 'host'), 'utf-8').trim();
    if (/^[a-z0-9_-]{1,40}$/i.test(name)) return name;
  } catch { /* not set up: this machine is the laptop */ }
  return 'laptop';
}

const readJson = (file: string): unknown => {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
};

const home = (p: string) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/** The projects of one host as its `proj` file lists them: name → path, `~` left as written. */
function hostProjects(host: string): { name: string; path: string }[] {
  const raw = readJson(path.join(projRegistryDir(), 'hosts', `${host}.json`)) as { projects?: Record<string, { path?: unknown }> } | null;
  if (!raw?.projects || typeof raw.projects !== 'object') return [];
  return Object.entries(raw.projects)
    .filter(([, value]) => value && typeof value.path === 'string' && value.path)
    .map(([name, value]) => ({ name, path: value.path as string }));
}

function knownHosts(): string[] {
  const registry = readJson(path.join(projRegistryDir(), 'registry.json')) as { hosts?: Record<string, unknown> } | null;
  const listed = registry?.hosts && typeof registry.hosts === 'object' ? Object.keys(registry.hosts) : [];
  let files: string[] = [];
  try { files = fs.readdirSync(path.join(projRegistryDir(), 'hosts')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)); } catch { /* no registry */ }
  return [...new Set([...listed, ...files])];
}

function archivedProjects(): Set<string> {
  const registry = readJson(path.join(projRegistryDir(), 'registry.json')) as { projects?: Record<string, { status?: unknown }> } | null;
  return new Set(Object.entries(registry?.projects ?? {}).filter(([, p]) => p?.status === 'archived').map(([name]) => name));
}

/** Every place on offer: the workspace first, then this machine's projects, then other hosts' (not yet available). */
export function listPlaces(): PlaceChoice[] {
  const here = thisHost();
  const archived = archivedProjects();
  const out: PlaceChoice[] = [{ host: here, cwd: workspaceRoot(), label: 'OpenClaw workspace', kind: 'workspace', available: fs.existsSync(workspaceRoot()) }];
  const hosts = [here, ...knownHosts().filter((h) => h !== here)];
  for (const host of hosts) {
    for (const project of hostProjects(host).sort((a, b) => a.name.localeCompare(b.name))) {
      if (archived.has(project.name)) continue;
      if (host === here) {
        const cwd = home(project.path);
        const exists = fs.existsSync(cwd);
        out.push({ host, cwd, label: project.name, kind: 'project', project: project.name, available: exists, ...(exists ? {} : { reason: 'The folder is not there.' }) });
      } else {
        out.push({ host, cwd: project.path, label: project.name, kind: 'project', project: project.name, available: false, reason: `Sessions on ${host} are not available yet.` });
      }
    }
  }
  return out;
}

const real = (p: string): string | null => {
  try { return fs.realpathSync(p); } catch { return null; }
};

/**
 * A place a session may be started in: on this machine, an absolute folder that exists, and one of the places on
 * offer or inside one (links followed, so a link cannot lead out). The folder comes back with links resolved.
 */
export function validatePlace(place: { host?: unknown; cwd?: unknown }): { ok: true; place: Place } | { ok: false; error: string } {
  const here = thisHost();
  if (typeof place.host !== 'string' || typeof place.cwd !== 'string' || !place.cwd) return { ok: false, error: 'Say which machine and folder.' };
  if (place.host !== here) return { ok: false, error: `Sessions on ${place.host} are not available yet.` };
  const asked = home(place.cwd);
  if (!path.isAbsolute(asked)) return { ok: false, error: 'The folder must be a full path.' };
  const cwd = real(asked);
  if (!cwd) return { ok: false, error: 'That folder is not there.' };
  if (!fs.statSync(cwd).isDirectory()) return { ok: false, error: 'That is not a folder.' };
  const roots = listPlaces().filter((p) => p.host === here && p.available).map((p) => real(p.cwd)).filter((p): p is string => !!p);
  if (!roots.some((root) => cwd === root || cwd.startsWith(root + path.sep))) return { ok: false, error: 'That folder is not one of the places a session can run.' };
  return { ok: true, place: { host: here, cwd } };
}

/**
 * The places on offer to one task: every listed place, plus the task's own place when it is a folder inside one of
 * them (a session may run in a subfolder of the workspace or of a project; the picker can only show it this way).
 */
export function placesFor(taskPlace: Place | null): PlaceChoice[] {
  const list = listPlaces();
  if (!taskPlace || list.some((p) => p.host === taskPlace.host && p.cwd === taskPlace.cwd)) return list;
  const checked = validatePlace(taskPlace);
  if (!checked.ok) return list;
  const cwd = checked.place.cwd;
  const parent = list
    .filter((p) => p.host === checked.place.host && p.available)
    .map((p) => ({ p, root: real(p.cwd) }))
    .filter(({ root }) => !!root && (cwd === root || cwd.startsWith(root + path.sep)))
    .sort((a, b) => b.root!.length - a.root!.length)[0];
  if (!parent) return list;
  if (cwd === parent.root) return list;
  const sub: PlaceChoice = { host: checked.place.host, cwd, label: `${parent.p.label} / ${path.relative(parent.root!, cwd)}`, kind: parent.p.kind, ...(parent.p.project ? { project: parent.p.project } : {}), available: true };
  const at = list.indexOf(parent.p);
  return [...list.slice(0, at + 1), sub, ...list.slice(at + 1)];
}

/** The place a task's sessions run when none was picked: the shared workspace. */
export function defaultPlace(): Place {
  return { host: thisHost(), cwd: workspaceRoot() };
}
