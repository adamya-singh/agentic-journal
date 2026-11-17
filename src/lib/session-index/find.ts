// A read-only search over the session index for OpenClaw, when Adamya asks it to find a session he remembers
// ("the Codex session last week on the Mac where I fixed the ESC flashing"): free text over each session's title,
// first message, project, files and conversation, with filters for the agent, the device, the folder and the dates.
// Each hit says enough to judge it (where it ran, when, how it began, the lines that matched); one session's detail
// adds the text the index holds of it. GET /api/session-index/find and `scripts/session-index.ts find` both use it.
// Node imports only: the CLI runs it on plain node.
import fs from 'node:fs';
import path from 'node:path';
import { machineName, thisHost } from '../proj-hosts.ts';
import { indexExists, openIndex, type SessionRecord } from './store.ts';
import type { SessionApp } from './types.ts';

export interface FindQuery {
  q?: string;
  app?: SessionApp;
  host?: string;               // a proj host: laptop, wsl, mac
  folder?: string;             // part of the folder it ran in
  after?: string;              // ISO date or time: active on or after it
  before?: string;             // active on or before it (a bare date counts to its end)
  limit?: number;
}

export interface FoundSession {
  uid: string;
  app: SessionApp;
  device: string;              // laptop, PC, Mac
  host: string;
  title: string;
  folder: string;
  project: string;
  branch: string;
  started: string | null;
  ended: string | null;
  turns: number;
  first: string;               // how it began: his first message, clipped
  files: string[];             // files it changed, by name
  match?: string;              // the lines that matched the words, «marked»
  transcript?: string;         // its transcript on this machine, for reading when the index says too little
}

export interface SessionDetail extends FoundSession { text: string; cut: boolean }

export const FIND_LIMIT_MAX = 25;
const DETAIL_TEXT_MAX = 9000;
// The Journal's own session finder chats are not what he is looking for.
const FINDER_KEY = '%:journal-find-%';

const APP_NAMES: Record<string, SessionApp> = {
  openclaw: 'openclaw', oc: 'openclaw', 'claude-code': 'claude-code', claude: 'claude-code', cc: 'claude-code', 'claude code': 'claude-code', codex: 'codex', cx: 'codex',
};
const HOST_NAMES: Record<string, string> = { laptop: 'laptop', ubuntu: 'laptop', linux: 'laptop', wsl: 'wsl', pc: 'wsl', windows: 'wsl', win11: 'wsl', mac: 'mac', macbook: 'mac', macos: 'mac' };

/** "Codex", "claude", "CC" → the app; null when it names none. */
export function appOf(value: string | null | undefined): SessionApp | null {
  const v = (value ?? '').trim().toLowerCase();
  return APP_NAMES[v] ?? null;
}

/** "PC", "Mac", "wsl" → the proj host; any other plain name is taken as a host itself. Null for nothing usable. */
export function hostOf(value: string | null | undefined): string | null {
  const v = (value ?? '').trim().toLowerCase();
  if (!v) return null;
  return HOST_NAMES[v] ?? (/^[a-z0-9_-]{1,40}$/.test(v) ? v : null);
}

/** A date or time as the filters take it; a bare date for `before` is the end of that day. Null when it is neither. */
export function boundOf(value: string | null | undefined, end: boolean): string | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return end ? `${v}T23:59:59.999Z` : `${v}T00:00:00.000Z`;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const words = (q: string) => (q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 10);

function found(s: SessionRecord, match?: string): FoundSession {
  let files: string[] = [];
  try { files = (JSON.parse(s.files) as string[]).map((f) => path.basename(f)).slice(0, 10); } catch { /* none */ }
  const out: FoundSession = {
    uid: s.uid, app: s.app as SessionApp, device: machineName(s.host), host: s.host,
    title: s.title || clip(s.first, 80) || '(untitled)', folder: s.cwd ?? '', project: s.project ?? '', branch: s.branch ?? '',
    started: s.started, ended: s.ended, turns: s.turns, first: clip(s.first, 300), files,
  };
  if (match) out.match = clip(match.replace(/\s+/g, ' ').trim(), 400);
  if (s.app !== 'openclaw' && s.host === thisHost() && s.path && path.isAbsolute(s.path)) {
    try { if (fs.statSync(s.path).isFile()) out.transcript = s.path; } catch { /* gone from the disk */ }
  }
  return out;
}

function filters(query: FindQuery): { sql: string; args: string[] } {
  const parts = ['(s.key is null or s.key not like ?)'];
  const args: string[] = [FINDER_KEY];
  if (query.app) { parts.push('s.app = ?'); args.push(query.app); }
  if (query.host) { parts.push('s.host = ?'); args.push(query.host); }
  if (query.folder?.trim()) { parts.push("(lower(coalesce(s.cwd, '')) like ? or lower(coalesce(s.project, '')) like ?)"); const f = `%${query.folder.trim().toLowerCase()}%`; args.push(f, f); }
  const after = boundOf(query.after, false), before = boundOf(query.before, true);
  if (after) { parts.push('coalesce(s.ended, s.started) >= ?'); args.push(after); }
  if (before) { parts.push('coalesce(s.started, s.ended) <= ?'); args.push(before); }
  return { sql: parts.join(' and '), args };
}

/**
 * Sessions that fit, best first. With words: every word must appear (each as a prefix); when that finds fewer than
 * asked, sessions with most of the words follow. Without words: the latest sessions that fit the filters.
 */
export function findSessions(query: FindQuery): FoundSession[] {
  if (!indexExists()) return [];
  const db = openIndex();
  const limit = Math.max(1, Math.min(FIND_LIMIT_MAX, Math.floor(query.limit ?? 12)));
  const where = filters(query);
  const terms = words(query.q ?? '');
  if (!terms.length) {
    const rows = db.prepare(`select s.* from sessions s where ${where.sql} order by coalesce(s.ended, s.started) desc limit ?`).all(...where.args, limit) as unknown as SessionRecord[];
    return rows.map((s) => found(s));
  }
  const out: FoundSession[] = [];
  const seen = new Set<string>();
  const snippet = db.prepare("select snippet(chunks_fts, 0, '«', '»', '…', 24) as m from chunks_fts where chunks_fts match ? and uid = ? order by bm25(chunks_fts) limit 1");
  for (const match of [terms.map((w) => `"${w}"*`).join(' AND '), terms.length > 1 ? terms.map((w) => `"${w}"*`).join(' OR ') : null]) {
    if (!match || out.length >= limit) continue;
    const hits = db.prepare(`select s.*, min(f.score) as best from (select uid, bm25(chunks_fts) as score from chunks_fts where chunks_fts match ? order by score limit 3000) f
      join sessions s on s.uid = f.uid where ${where.sql} group by s.uid order by best limit ?`).all(match, ...where.args, limit + seen.size) as unknown as SessionRecord[];
    for (const s of hits) {
      if (seen.has(s.uid) || out.length >= limit) continue;
      seen.add(s.uid);
      const m = (snippet.get(match, s.uid) as { m?: string } | undefined)?.m;
      out.push(found(s, m));
    }
  }
  return out;
}

/** One session and the text the index holds of it (its first and last messages, redacted), or null. */
export function sessionDetail(uid: string): SessionDetail | null {
  if (!indexExists()) return null;
  const db = openIndex();
  const s = db.prepare('select * from sessions where uid = ? and (key is null or key not like ?)').get(uid, FINDER_KEY) as unknown as SessionRecord | undefined;
  if (!s) return null;
  const chunks = db.prepare('select text from chunks where uid = ? and n > 0 order by n').all(uid) as { text: string }[];
  const text = chunks.map((c) => c.text).join('\n');
  return { ...found(s), text: clip(text, DETAIL_TEXT_MAX), cut: text.length > DETAIL_TEXT_MAX };
}

/** The index's record of one session, or undefined: what a uid OpenClaw names is checked against. */
export function indexedSession(uid: string): SessionRecord | undefined {
  if (!indexExists()) return undefined;
  return openIndex().prepare('select * from sessions where uid = ? and (key is null or key not like ?)').get(uid, FINDER_KEY) as unknown as SessionRecord | undefined;
}
