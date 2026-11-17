// Where a task's coding-agent session can run: OpenClaw's shared workspace folder (where the task's file tabs
// live), or one of the projects the `proj` registry knows (~/projects/projects-index: registry.json, and
// hosts/<host>.json with each host's projects and their paths). Another device's projects run there, over ssh
// (ssh.ts), with that device's own agents.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { workspaceRoot } from '@/app/api/tasks/files/store';
import { archivedProjects, hostAlias, hostProjects, knownHosts, machineName, projRegistryDir, thisHost } from '@/lib/proj-hosts';
import type { DeviceInfo, Place, PlaceChoice } from './protocol';

export { projRegistryDir, thisHost };

const home = (p: string) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);

/** Every device sessions can run on: this machine first, then each other host of the registry (reached over ssh). */
export function listDevices(): DeviceInfo[] {
  const here = thisHost();
  return [here, ...knownHosts().filter((h) => h !== here)].map((host) => ({ host, label: machineName(host), alias: host === here ? null : hostAlias(host), here: host === here }));
}

/** A device the Journal knows: this machine, or a host of the registry. */
export const isKnownDevice = (host: string) => host === thisHost() || knownHosts().includes(host);

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
      } else if (!hostAlias(host)) {
        out.push({ host, cwd: project.path, label: project.name, kind: 'project', project: project.name, available: false, reason: `${machineName(host)} has no ssh name the Journal can use.` });
      } else {
        // Another device: its folder as its proj file writes it (`~/projects/x`); whether the device answers is its
        // status (the agents' list for that device), not the place's.
        out.push({ host, cwd: project.path, label: project.name, kind: 'project', project: project.name, available: true });
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
export function validatePlace(place: { host?: unknown; cwd?: unknown }, remoteHome?: string): { ok: true; place: Place } | { ok: false; error: string } {
  const here = thisHost();
  if (typeof place.host !== 'string' || typeof place.cwd !== 'string' || !place.cwd) return { ok: false, error: 'Say which machine and folder.' };
  if (place.host !== here) return validateRemotePlace(place.host, place.cwd, remoteHome);
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
 * A place on another device. Nothing there is looked at (that needs ssh, and the agent there refuses a folder that is
 * not there): the folder must be one of that host's projects in its proj file, or inside one, written as that file
 * writes it (`~/projects/x/sub`). A full path under the device's home (what its agent reports for a session) is read
 * as `~/…` when its home is known. `..` cannot lead out.
 */
function validateRemotePlace(host: string, cwd: string, remoteHome?: string): { ok: true; place: Place } | { ok: false; error: string } {
  if (!isKnownDevice(host)) return { ok: false, error: `No device is called ${host}.` };
  if (!hostAlias(host)) return { ok: false, error: `${machineName(host)} has no ssh name the Journal can use.` };
  let asked = cwd.trim().replace(/\/+$/, '') || cwd;
  if (remoteHome && (asked === remoteHome || asked.startsWith(`${remoteHome.replace(/\/+$/, '')}/`))) asked = `~${asked.slice(remoteHome.replace(/\/+$/, '').length)}`;
  if (!asked.startsWith('/') && asked !== '~' && !asked.startsWith('~/')) return { ok: false, error: 'The folder must be a full path.' };
  if (asked.split('/').some((part) => part === '..' || part === '.')) return { ok: false, error: 'That folder is not one of the places a session can run.' };
  const roots = listPlaces().filter((p) => p.host === host && p.available).map((p) => p.cwd.replace(/\/+$/, ''));
  if (!roots.some((root) => asked === root || asked.startsWith(`${root}/`))) return { ok: false, error: 'That folder is not one of the places a session can run.' };
  return { ok: true, place: { host, cwd: asked } };
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
  if (checked.place.host !== thisHost()) {
    // A subfolder of another device's project: offered under it, as it is written there.
    const parent = list.filter((p) => p.host === checked.place.host && p.available && cwd.startsWith(`${p.cwd}/`)).sort((a, b) => b.cwd.length - a.cwd.length)[0];
    if (!parent) return list;
    const at = list.indexOf(parent);
    const sub: PlaceChoice = { host: parent.host, cwd, label: `${parent.label} / ${cwd.slice(parent.cwd.length + 1)}`, kind: parent.kind, ...(parent.project ? { project: parent.project } : {}), available: true };
    return [...list.slice(0, at + 1), sub, ...list.slice(at + 1)];
  }
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
