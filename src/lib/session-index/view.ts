import fs from 'node:fs';
import path from 'node:path';
import { backendDataDir } from '../backend-data.ts';
import { indexExists, openIndex, type SessionRecord } from './store.ts';
import type { SessionApp, SessionRow, SessionTarget, SessionsView } from './types.ts';

// Which sessions belong on a task or an action card. Exact links only: a session is on the card because
// its OpenClaw key names it, it was started from it ([aj:...]), it names the task or card by id, or Adamya
// linked it himself. "Not this" always wins.

const MACHINE: Record<string, string> = { laptop: 'laptop', wsl: 'PC', mac: 'Mac' };
const LIVE_MS = 20 * 60_000;
// A session naming more Journal ids than this is a survey (day planning, a coordinator, a status check),
// not work on any one of them; it stays off cards unless it was started from one.
const HUB_REFS = 6;
// Sessions working on the Journal itself mention task and card ids as test data or while debugging, which
// says nothing about doing that task.
const JOURNAL_REPO = /^agentic-journal(?:-[0-9a-f]{12,})?$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^ac_[0-9a-f]{8}$/;

export const machineName = (host: string) => MACHINE[host] ?? host;

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
function journalIds() {
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

const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toRow(s: SessionRecord, tier: SessionRow['tier'], why: string, now = Date.now()): SessionRow {
  const row: SessionRow = {
    uid: s.uid, app: s.app as SessionApp, host: s.host, machine: machineName(s.host),
    title: s.title || s.first.slice(0, 80) || '(untitled)', project: s.project ?? '', started: s.started, ended: s.ended,
    turns: s.turns, live: !!s.ended && now - Date.parse(s.ended) < LIVE_MS, tier, why,
  };
  if (s.app === 'openclaw' && s.key) row.key = s.key;
  else if (s.app === 'claude-code' && s.bridge) row.href = `https://claude.ai/code/${encodeURIComponent(s.bridge)}`;
  else if (s.app === 'claude-code') row.resume = `cd ${shq(s.cwd || '~')} && claude --resume ${s.id}`;
  else if (s.app === 'codex') row.resume = `cd ${shq(s.cwd || '~')} && codex resume ${s.id}`;
  return row;
}

interface Link { s: SessionRecord; why: string }

/** The exact links for one task or card id. */
function linksFor(kind: 'task' | 'card', id: string, known: Set<string>): Link[] {
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
    if (JOURNAL_REPO.test(s.project ?? '')) continue;
    if (refs.filter((r) => ID.test(r) && known.has(r)).length > HUB_REFS) continue;
    out.push({ s, why: kind === 'card' ? 'Works on this card by its id' : 'Works on this task by its id' });
  }
  return out;
}

/** What a task or card's Sessions section shows. */
export function sessionsFor(target: SessionTarget, now = Date.now()): SessionsView {
  if (!indexExists()) return { rows: [], indexed: 0, hosts: [] };
  const db = openIndex();
  const kind = target.slice(0, target.indexOf(':')) as 'task' | 'card';
  const id = target.slice(kind.length + 1);
  const { ids, cardTask } = journalIds();
  const links = linksFor(kind, id, ids);
  // An agreed card and the task it made are one piece of work.
  if (kind === 'card' && cardTask.has(id)) {
    for (const l of linksFor('task', cardTask.get(id)!, ids)) links.push({ ...l, why: `${l.why.replace('this task', 'its task')}` });
  }
  if (kind === 'task') {
    for (const [cardId, taskId] of cardTask) {
      if (taskId === id) for (const l of linksFor('card', cardId, ids)) links.push({ ...l, why: l.why.replace('this card', 'its action card') });
    }
  }
  const feedback = db.prepare('select uid, verdict from feedback where target = ?').all(target) as { uid: string; verdict: string }[];
  const not = new Set(feedback.filter((f) => f.verdict === 'not').map((f) => f.uid));
  const get = db.prepare('select * from sessions where uid = ?');
  for (const f of feedback) {
    if (f.verdict !== 'link') continue;
    const s = get.get(f.uid) as unknown as SessionRecord | undefined;
    if (s) links.unshift({ s, why: 'You linked it' });
  }
  const rows = new Map<string, SessionRow>();
  for (const l of links) if (!not.has(l.s.uid) && !rows.has(l.s.uid)) rows.set(l.s.uid, toRow(l.s, 'linked', l.why, now));
  const sorted = [...rows.values()].sort((a, b) => Number(b.live) - Number(a.live) || (b.ended ?? '').localeCompare(a.ended ?? ''));
  return { rows: sorted, ...indexStatus() };
}

export function indexStatus(): Pick<SessionsView, 'indexed' | 'hosts'> {
  if (!indexExists()) return { indexed: 0, hosts: [] };
  const db = openIndex();
  const indexed = (db.prepare('select count(*) as n from sessions').get() as { n: number }).n;
  const hosts = (db.prepare('select host, last_sync from hosts order by host').all() as { host: string; last_sync: string | null }[])
    .map((h) => ({ host: h.host, machine: machineName(h.host), lastSync: h.last_sync }));
  return { indexed, hosts };
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
  return hits.map((h) => get.get(h.uid) as unknown as SessionRecord).filter(Boolean).map((s) => toRow(s, 'matched', '', now));
}

export function setFeedback(target: SessionTarget, uid: string, verdict: 'link' | 'not' | 'clear', now = new Date()) {
  if (!indexExists()) {
    if (verdict === 'clear') return;
    throw new Error('That session is not in the index.');
  }
  const db = openIndex();
  if (verdict === 'clear') {
    db.prepare('delete from feedback where target = ? and uid = ?').run(target, uid);
    return;
  }
  if (!db.prepare('select 1 from sessions where uid = ?').get(uid)) throw new Error('That session is not in the index.');
  db.prepare(`insert into feedback(target, uid, verdict, at) values (?,?,?,?)
    on conflict(target, uid) do update set verdict = excluded.verdict, at = excluded.at`).run(target, uid, verdict, now.toISOString());
}
