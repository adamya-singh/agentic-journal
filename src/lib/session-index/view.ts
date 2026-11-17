import fs from 'node:fs';
import path from 'node:path';
import { backendDataDir } from '../backend-data.ts';
import { hostAlias, machineName, thisHost } from '../proj-hosts.ts';
import { deviceCodex } from './devices.ts';
import { resumeCommand } from './resume.ts';
import { indexExists, openIndex, type SessionRecord } from './store.ts';
import type { SessionApp, SessionRow, SessionTarget, SessionsView } from './types.ts';

// Which sessions belong on a task or an action card. Exact links only: a session is on the card because
// its OpenClaw key names it, it was started from it ([aj:...]), it names the task or card by id, or Adamya
// linked it himself. "Not this" always wins.

const LIVE_MS = 20 * 60_000;
// A session naming more Journal ids than this is a survey (day planning, a coordinator, a status check),
// not work on any one of them; it stays off cards unless it was started from one.
const HUB_REFS = 6;
// Sessions working on the Journal itself mention task and card ids as test data or while debugging, which
// says nothing about doing that task. Its copies and experiments count too (agentic-journal-quickadd,
// handwired-agentic-journal-experimentation on the PC).
const JOURNAL_REPO = /agentic-journal/;
// The Journal's "find a session" chats with OpenClaw (lib/session-finder.ts).
const FINDER_KEY = /:journal-find-/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^ac_[0-9a-f]{8}$/;

export { machineName };

export function parseTarget(value: string | null | undefined): SessionTarget | null {
  const m = /^(task):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$|^(card):(ac_[0-9a-f]{8})$/.exec(value ?? '');
  return m ? (`${m[1] ?? m[3]}:${m[2] ?? m[4]}` as SessionTarget) : null;
}

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Every task and card id the Journal knows, and which task each agreed card became. */
export function journalIds() {
  const dir = backendDataDir();
  const ids = new Set<string>();
  for (const f of ['have-to-do.json', 'want-to-do.json', 'completed-index.json', 'let-go.json']) {
    try {
      for (const m of fs.readFileSync(path.join(dir, 'tasks', f), 'utf8').matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)) ids.add(m[0]);
    } catch { /* no such list */ }
  }
  const cardTask = new Map<string, string>();
  for (const c of readJson<{ cards?: { id: string; decision?: { taskId?: string; undone?: string } }[] }>(path.join(dir, 'action-cards', 'cards.json'))?.cards ?? []) {
    ids.add(c.id);
    if (c.decision?.taskId && !c.decision.undone) cardTask.set(c.id, c.decision.taskId);
  }
  return { ids, cardTask };
}

export function toRow(s: SessionRecord, tier: SessionRow['tier'], why: string, now = Date.now()): SessionRow {
  const row: SessionRow = {
    uid: s.uid, app: s.app as SessionApp, host: s.host, machine: machineName(s.host),
    title: s.title || s.first.slice(0, 80) || '(untitled)', project: s.project ?? '', started: s.started, ended: s.ended,
    turns: s.turns, live: !!s.ended && now - Date.parse(s.ended) < LIVE_MS, tier, why,
  };
  if (s.app === 'openclaw' && s.key) row.key = s.key;
  else if (s.app === 'claude-code' && s.bridge) row.href = `https://claude.ai/code/${encodeURIComponent(s.bridge)}`;
  // A session on another device is resumed there, through ssh by its proj alias. One that ran in Windows itself (the
  // PC's Windows Claude or Codex app, a C: folder) has no command that reaches it from here.
  // A device whose `codex` is not on its PATH runs the copy the collector found there (the Mac's ChatGPT.app one).
  else if ((s.app === 'claude-code' || s.app === 'codex') && !/^[A-Za-z]:[\\/]/.test(s.cwd ?? '')) {
    const away = s.host !== thisHost();
    row.resume = resumeCommand(s.app, s.cwd, s.id, away ? hostAlias(s.host) : null, away && s.app === 'codex' ? deviceCodex(s.host) : null);
  }
  return row;
}

/** `live`, when set, is whether it runs now, whatever its record's times say. */
interface Link { s: SessionRecord; why: string; live?: boolean }

// ---- The task's own coding sessions: the Codex and Claude Code sessions started from a task's chats, or brought
// into them, as the Journal itself keeps them (tasks/code-sessions.json, written by lib/code-agents/store.ts). They
// are linked to the task exactly, from the moment they start, before (or without) any machine sending its sessions.
// A session the index also holds is one row: the index's record (its turns, its app title), with this link's reason.
// Read here by hand, not through code-agents/store.ts: the session-index CLI runs on plain node, without the app's
// import aliases.

interface CodeLink {
  agent: 'codex' | 'claude-code';
  host: string;
  cwd: string;
  sessionId: string;
  title: string;
  createdAt: string;
  touchedAt: string;
  settledAt: string | null;
  workingSince: string | null;
  adopted: boolean;
  archived: boolean;
}

const isoOr = (value: unknown, fallback: string | null): string | null => (typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : fallback);

/** Every task's coding sessions, by task id. A file that cannot be read has none. */
export function readCodeLinks(dir = backendDataDir()): Map<string, CodeLink[]> {
  const raw = readJson<{ sessions?: Record<string, unknown> }>(path.join(dir, 'tasks', 'code-sessions.json'));
  const out = new Map<string, CodeLink[]>();
  for (const [taskId, list] of Object.entries(raw?.sessions ?? {})) {
    if (!Array.isArray(list)) continue;
    const links: CodeLink[] = [];
    for (const item of list) {
      const r = (item ?? {}) as Record<string, unknown>;
      if ((r.agent !== 'codex' && r.agent !== 'claude-code') || typeof r.sessionId !== 'string' || !r.sessionId) continue;
      const createdAt = isoOr(r.createdAt, new Date(0).toISOString())!;
      links.push({
        agent: r.agent, host: typeof r.host === 'string' && r.host ? r.host : 'laptop', cwd: typeof r.cwd === 'string' ? r.cwd : '',
        sessionId: r.sessionId, title: typeof r.title === 'string' ? r.title : '', createdAt, touchedAt: isoOr(r.touchedAt, createdAt)!,
        settledAt: isoOr(r.settledAt, null), workingSince: isoOr(r.workingSince, null), adopted: r.adopted === true, archived: r.archived === true,
      });
    }
    if (links.length) out.set(taskId, links);
  }
  return out;
}

/** A link as an index record, for a session the index has not (yet) got from its machine. */
function codeRecord(l: CodeLink): SessionRecord {
  const ended = [l.settledAt, l.touchedAt].filter((t): t is string => !!t).sort().pop() ?? l.createdAt;
  return {
    uid: `${l.agent}:${l.sessionId}`, app: l.agent, id: l.sessionId, host: l.host, path: null, key: null, title: l.title, cwd: l.cwd || null,
    project: l.cwd ? path.basename(l.cwd) : null, branch: null, started: l.createdAt, ended, turns: 0, files: '[]', refs: '[]', first: '',
    bridge: null, ssh: null, hash: '',
  };
}

const WORKING_STALE_MS = 3 * 60 * 60_000;

/** The task's own coding sessions as links: the index's record of each when it has one. */
function codeLinksFor(taskId: string, links: Map<string, CodeLink[]>, now: number): Link[] {
  const mine = links.get(taskId) ?? [];
  if (!mine.length) return [];
  const get = indexExists() ? openIndex().prepare('select * from sessions where uid = ?') : null;
  return mine.map((l) => {
    const indexed = get?.get(`${l.agent}:${l.sessionId}`) as unknown as SessionRecord | undefined;
    const why = l.archived ? 'Was one of this task’s chats' : l.adopted ? 'Brought into this task’s chats' : 'Started from this task’s chats';
    // Running now when a turn runs (the hub's stamp), not when it was merely touched a moment ago.
    const working = !!l.workingSince && now - Date.parse(l.workingSince) < WORKING_STALE_MS;
    // The index's record too: its last message a moment ago does not make an idle session run.
    return { s: indexed ?? codeRecord(l), why, live: working };
  });
}

/** The session is one of the target's coding sessions (its task's, for a card that became one). */
function isCodeLinkOf(target: SessionTarget, uid: string): boolean {
  const kind = target.slice(0, target.indexOf(':'));
  const id = target.slice(kind.length + 1);
  const taskId = kind === 'task' ? id : journalIds().cardTask.get(id);
  return !!taskId && (readCodeLinks().get(taskId) ?? []).some((l) => `${l.agent}:${l.sessionId}` === uid);
}

/** The exact links for one task or card id. */
function linksFor(kind: 'task' | 'card', id: string, known: Set<string>): Link[] {
  if (!indexExists()) return [];
  const db = openIndex();
  const out: Link[] = [];
  const keyId = kind === 'card' ? `card-${id.replace('_', '-')}` : id;
  const byKey = db.prepare("select * from sessions where key like ? escape '\\'").all(`%:journal-%${keyId.replace(/[%_\\]/g, '\\$&')}-%`) as unknown as SessionRecord[];
  let latestBrief: SessionRecord | null = null;
  for (const s of byKey) {
    const m = /:journal-(brief|chat)-(card-ac-[0-9a-f]{8}|[0-9a-f-]{36})-\d+$/.exec(s.key ?? '');
    if (!m || m[2] !== keyId) continue;
    if (m[1] === 'brief') {
      // Every refresh of a brief is its own run; the latest one is the one worth opening.
      if (!latestBrief || (s.ended ?? '') > (latestBrief.ended ?? '')) latestBrief = s;
    } else {
      out.push({ s, why: kind === 'card' ? 'Your chat with OpenClaw about this card' : 'Your chat with OpenClaw about this task' });
    }
  }
  if (latestBrief) out.push({ s: latestBrief, why: 'OpenClaw filled in this brief' });
  const byRef = db.prepare('select * from sessions where refs like ?').all(`%"${id}"%`) as unknown as SessionRecord[];
  const marked = db.prepare('select * from sessions where refs like ?').all(`%"aj:${kind}:${id}"%`) as unknown as SessionRecord[];
  for (const s of marked) if ((JSON.parse(s.refs) as string[]).includes(`aj:${kind}:${id}`)) out.push({ s, why: `Started from this ${kind}` });
  for (const s of byRef) {
    const refs = JSON.parse(s.refs) as string[];
    if (!refs.includes(id)) continue;   // LIKE treats _ as a wildcard
    if (FINDER_KEY.test(s.key ?? '')) continue;   // a chat that looked for sessions for the task did not work on it
    if (JOURNAL_REPO.test(s.project ?? '')) continue;
    if (refs.filter((r) => ID.test(r) && known.has(r)).length > HUB_REFS) continue;
    out.push({ s, why: kind === 'card' ? 'Works on this card by its id' : 'Works on this task by its id' });
  }
  return out;
}

/** What a task or card's Sessions section shows. */
export function sessionsFor(target: SessionTarget, now = Date.now()): SessionsView {
  const codeLinks = readCodeLinks();
  const indexed = indexExists();
  if (!indexed && !codeLinks.size) return { rows: [], indexed: 0, hosts: [] };
  const kind = target.slice(0, target.indexOf(':')) as 'task' | 'card';
  const id = target.slice(kind.length + 1);
  const { ids, cardTask } = journalIds();
  // The task's own coding sessions first: their link is the surest, so theirs is the reason a row gives.
  const links = kind === 'task' ? codeLinksFor(id, codeLinks, now) : [];
  links.push(...linksFor(kind, id, ids));
  // An agreed card and the task it made are one piece of work.
  if (kind === 'card' && cardTask.has(id)) {
    const taskId = cardTask.get(id)!;
    for (const l of [...codeLinksFor(taskId, codeLinks, now), ...linksFor('task', taskId, ids)]) links.push({ ...l, why: `${l.why.replace('this task', 'its task')}` });
  }
  if (kind === 'task') {
    for (const [cardId, taskId] of cardTask) {
      if (taskId === id) for (const l of linksFor('card', cardId, ids)) links.push({ ...l, why: l.why.replace('this card', 'its action card') });
    }
  }
  const db = indexed ? openIndex() : null;
  const feedback = (db?.prepare('select uid, verdict from feedback where target = ?').all(target) ?? []) as { uid: string; verdict: string }[];
  const not = new Set(feedback.filter((f) => f.verdict === 'not').map((f) => f.uid));
  const get = db?.prepare('select * from sessions where uid = ?');
  for (const f of feedback) {
    if (f.verdict !== 'link' || !get) continue;
    const s = get.get(f.uid) as unknown as SessionRecord | undefined;
    if (s) links.unshift({ s, why: 'You linked it' });
  }
  const rows = new Map<string, SessionRow>();
  for (const l of links) {
    if (not.has(l.s.uid) || rows.has(l.s.uid)) continue;
    const row = toRow(l.s, 'linked', l.why, now);
    rows.set(l.s.uid, l.live === undefined ? row : { ...row, live: l.live });
  }
  const sorted = [...rows.values()].sort((a, b) => Number(b.live) - Number(a.live) || (b.ended ?? '').localeCompare(a.ended ?? ''));
  // OpenClaw rows open by their session key: the runs of one cron job (each its own session in the index) all open the
  // same place, so only the latest of them is listed.
  const keys = new Set<string>();
  const shown = sorted.filter((r) => {
    if (r.app !== 'openclaw' || !r.key) return true;
    if (keys.has(r.key)) return false;
    keys.add(r.key);
    return true;
  });
  return { rows: shown, ...indexStatus() };
}

export function indexStatus(): Pick<SessionsView, 'indexed' | 'hosts' | 'checkedAt'> {
  if (!indexExists()) return { indexed: 0, hosts: [] };
  const db = openIndex();
  const indexed = (db.prepare('select count(*) as n from sessions').get() as { n: number }).n;
  const hosts = (db.prepare('select host, last_sync from hosts order by host').all() as { host: string; last_sync: string | null }[])
    .map((h) => ({ host: h.host, machine: machineName(h.host), lastSync: h.last_sync }));
  const checkedAt = (db.prepare("select v from meta where k = 'ingested_at'").get() as { v?: string } | undefined)?.v ?? null;
  return { indexed, hosts, checkedAt };
}

/** Sessions whose title or text match, for linking one by hand. */
export function searchSessions(q: string, limit = 8, now = Date.now()): SessionRow[] {
  const words = (q.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []).slice(0, 8);
  if (!words.length || !indexExists()) return [];
  const db = openIndex();
  const match = words.map((w) => `"${w}"*`).join(' AND ');
  const hits = db.prepare(`select uid, min(score) as best from (select uid, bm25(chunks_fts) as score from chunks_fts where chunks_fts match ? order by score limit 300)
    group by uid order by best limit ?`)
    .all(match, limit) as { uid: string }[];
  const get = db.prepare('select * from sessions where uid = ?');
  return hits.map((h) => get.get(h.uid) as unknown as SessionRecord).filter((s) => s && !FINDER_KEY.test(s.key ?? '')).map((s) => toRow(s, 'matched', '', now));
}

export function setFeedback(target: SessionTarget, uid: string, verdict: 'link' | 'not' | 'clear', now = new Date()) {
  // "Not this" also works on one of the task's own coding sessions the index has not got yet: it is kept in the
  // index's feedback like any other (the index is made for it when this server has none).
  const ownCode = verdict === 'not' && isCodeLinkOf(target, uid);
  if (!indexExists() && !ownCode) {
    if (verdict === 'clear') return;
    throw new Error('That session is not in the index.');
  }
  const db = openIndex();
  if (verdict === 'clear') {
    db.prepare('delete from feedback where target = ? and uid = ?').run(target, uid);
    return;
  }
  if (!ownCode && !db.prepare('select 1 from sessions where uid = ?').get(uid)) throw new Error('That session is not in the index.');
  db.prepare(`insert into feedback(target, uid, verdict, at) values (?,?,?,?)
    on conflict(target, uid) do update set verdict = excluded.verdict, at = excluded.at`).run(target, uid, verdict, now.toISOString());
}
