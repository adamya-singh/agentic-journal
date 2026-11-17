// Links from tasks to coding-agent sessions, in tasks/code-sessions.json, and where each task's sessions run, in
// tasks/task-places.json. Only links and a small glance (state, last line) are kept: the transcript stays with
// the agent. Only the Next server writes these files and every read-modify-write below is synchronous, so writes
// cannot interleave. The deploy queue reads code-sessions.json too (lib/deploy-queue.ts codeTurns).
import * as fs from 'fs';
import * as path from 'path';
import { tasksDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import {
  isAgentKind, isPermissionMode,
  type CodeSessionLink, type Place, type SessionPicks, type SessionState,
} from './protocol';

export const CODE_SESSIONS_SCHEMA_VERSION = 1;
type Links = Record<string, CodeSessionLink[]>;

const COMMENT = 'Coding-agent sessions (Codex, Claude Code) started from or attached to a task, keyed by task id. Only the link and a glance; the transcript stays with the agent.';
const PLACES_COMMENT = 'Where each task’s coding-agent sessions run: a host and a folder, keyed by task id.';

export function codeSessionsFilePath(): string {
  return path.join(tasksDataDir(), 'code-sessions.json');
}

export function taskPlacesFilePath(): string {
  return path.join(tasksDataDir(), 'task-places.json');
}

const iso = (value: unknown): string | null => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null);
const STATES: SessionState[] = ['idle', 'working', 'needs-you', 'failed', 'offline'];

/**
 * A stored link whose mode cannot be read gets `auto-edit`, the default before `own` was, and never `own`: the
 * agent's own settings can be full access, and a pick nobody can read must not widen what a session may do.
 */
const UNREADABLE_MODE = 'auto-edit' as const;

export function readPicks(raw: unknown): SessionPicks {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const text = (value: unknown) => (typeof value === 'string' && value.trim() && value.length <= 120 ? value.trim() : null);
  return { model: text(r.model), effort: text(r.effort), mode: isPermissionMode(r.mode) ? r.mode : UNREADABLE_MODE };
}

const ASK_KINDS = ['command', 'file-change', 'tool', 'other'] as const;
function readAsking(raw: unknown): CodeSessionLink['asking'] {
  if (!raw || typeof raw !== 'object') return null;
  const { kind, title } = raw as Record<string, unknown>;
  return (ASK_KINDS as readonly unknown[]).includes(kind) && typeof title === 'string' ? { kind: kind as (typeof ASK_KINDS)[number], title: title.slice(0, 200) } : null;
}

/** One stored link read back carefully; one that cannot be a link is dropped. */
function readLink(raw: unknown): CodeSessionLink | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || !isAgentKind(r.agent) || typeof r.sessionId !== 'string' || !r.sessionId) return null;
  const createdAt = iso(r.createdAt) ?? new Date(0).toISOString();
  return {
    id: r.id,
    agent: r.agent,
    host: typeof r.host === 'string' && r.host ? r.host : 'laptop',
    cwd: typeof r.cwd === 'string' ? r.cwd : '',
    sessionId: r.sessionId,
    title: typeof r.title === 'string' && r.title ? r.title : 'Untitled',
    picks: readPicks(r.picks),
    createdAt,
    touchedAt: iso(r.touchedAt) ?? createdAt,
    seenAt: iso(r.seenAt),
    lastState: STATES.includes(r.lastState as SessionState) ? r.lastState as SessionState : 'idle',
    lastLine: typeof r.lastLine === 'string' ? r.lastLine : '',
    ...(iso(r.workingSince) ? { workingSince: iso(r.workingSince) } : {}),
    ...(iso(r.settledAt) ? { settledAt: iso(r.settledAt) } : {}),
    ...(readAsking(r.asking) ? { asking: readAsking(r.asking) } : {}),
    ...(r.adopted === true ? { adopted: true } : {}),
    ...(r.archived === true ? { archived: true } : {}),
  };
}

export function readLinksFile(raw: unknown): Links {
  const file = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const stored = file.sessions && typeof file.sessions === 'object' ? file.sessions as Record<string, unknown> : {};
  const out: Links = {};
  for (const [taskId, list] of Object.entries(stored)) {
    if (!Array.isArray(list)) continue;
    const links = list.map(readLink).filter((l): l is CodeSessionLink => l !== null);
    if (links.length > 0) out[taskId] = links;
  }
  return out;
}

function read(): { links: Links; unreadable: boolean } {
  const file = codeSessionsFilePath();
  if (!fs.existsSync(file)) return { links: {}, unreadable: false };
  try {
    return { links: readLinksFile(JSON.parse(fs.readFileSync(file, 'utf-8'))), unreadable: false };
  } catch {
    return { links: {}, unreadable: true };
  }
}

function write(links: Links, unreadable: boolean): void {
  const file = codeSessionsFilePath();
  // A file that could not be read is set aside before it is written over, so no link is lost for good.
  if (unreadable) { try { fs.copyFileSync(file, path.join(path.dirname(file), `code-sessions.unreadable-${Date.now()}.json`)); } catch { /* the write still goes ahead */ } }
  writeJsonFileAtomic(file, { _comment: COMMENT, schemaVersion: CODE_SESSIONS_SCHEMA_VERSION, sessions: links });
}

export function mutateCodeSessions<T>(fn: (links: Links) => T): T {
  const data = read();
  const result = fn(data.links);
  write(data.links, data.unreadable);
  return result;
}

/** Like mutateCodeSessions, for a change that may turn out to be none: the file is written only when `fn` says so. */
export function updateCodeSessions(fn: (links: Links) => boolean): boolean {
  const data = read();
  if (!fn(data.links)) return false;
  write(data.links, data.unreadable);
  return true;
}

export function readAllCodeSessions(): Links {
  return read().links;
}

export function readCodeSessions(taskId: string): CodeSessionLink[] {
  return read().links[taskId] ?? [];
}

export function findCodeSession(linkId: string): { taskId: string; link: CodeSessionLink } | null {
  for (const [taskId, list] of Object.entries(read().links)) {
    const link = list.find((l) => l.id === linkId);
    if (link) return { taskId, link };
  }
  return null;
}

/** Changes one link where it is stored. False when it is gone. */
export function changeCodeSession(linkId: string, fn: (link: CodeSessionLink) => boolean | void): boolean {
  return updateCodeSessions((all) => {
    for (const list of Object.values(all)) {
      const link = list.find((l) => l.id === linkId);
      if (link) return fn(link) !== false;
    }
    return false;
  });
}

export function newLinkId(now = new Date()): string {
  return `cs${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---- Places.

function readPlaces(): Record<string, Place> {
  try {
    const raw = JSON.parse(fs.readFileSync(taskPlacesFilePath(), 'utf-8')) as { places?: Record<string, unknown> };
    const out: Record<string, Place> = {};
    for (const [taskId, value] of Object.entries(raw.places ?? {})) {
      const p = value as Partial<Place> | null;
      if (p && typeof p.host === 'string' && typeof p.cwd === 'string' && p.cwd) out[taskId] = { host: p.host, cwd: p.cwd };
    }
    return out;
  } catch {
    return {};
  }
}

export function readTaskPlace(taskId: string): Place | null {
  return readPlaces()[taskId] ?? null;
}

export function setTaskPlace(taskId: string, place: Place): void {
  const places = readPlaces();
  places[taskId] = { host: place.host, cwd: place.cwd };
  writeJsonFileAtomic(taskPlacesFilePath(), { _comment: PLACES_COMMENT, schemaVersion: 1, places });
}
