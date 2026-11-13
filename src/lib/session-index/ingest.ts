import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inboxDir, openIndex, tx } from './store.ts';
import { redact } from './redact.ts';
import { SESSION_APPS, type AppRecord, type SessionDigest } from './types.ts';

const CHUNK_CHARS = 1800;
// A paragraph this long that shows up in this many sessions is a pasted brief or injected instructions,
// not the work: a coordinator's shared rules made every worker session look like every task.
const BOILERPLATE_MIN_CHARS = 200;
const BOILERPLATE_SESSIONS = 3;

const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const paragraphs = (text: string) => text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

function isDigest(d: unknown): d is SessionDigest {
  const x = d as SessionDigest;
  return !!x && x.v === 1 && SESSION_APPS.includes(x.app) && typeof x.id === 'string' && Array.isArray(x.msgs);
}

/** Every host's digests and app records, one digest per session: the newest copy wins when two stores hold it. */
export function readInbox(dir = inboxDir()) {
  const digests = new Map<string, SessionDigest>();
  const apps = new Map<string, AppRecord>();
  const hosts: { host: string; files: number; lastSync: string | null }[] = [];
  let hostDirs: string[] = [];
  try { hostDirs = fs.readdirSync(dir); } catch { /* nothing sent yet */ }
  for (const host of hostDirs.sort()) {
    const hdir = path.join(dir, host);
    let files: string[];
    try { files = fs.readdirSync(hdir).filter((f) => f.endsWith('.json') && !f.startsWith('.')); } catch { continue; }
    let newest = 0;
    for (const f of files) {
      const full = path.join(hdir, f);
      // Another machine can replace a file between the listing and this read; skip it this time
      // rather than give up on the whole run.
      try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch { continue; }
      const data = readJson<unknown>(full);
      if (f.startsWith('apps-')) {
        for (const r of (data as { records?: AppRecord[] } | null)?.records ?? []) {
          const prev = apps.get(r.cli);
          if (!prev || (r.active ?? 0) > (prev.active ?? 0)) apps.set(r.cli, r);
        }
      } else if (isDigest(data)) {
        const uid = `${data.app}:${data.id}`;
        const prev = digests.get(uid);
        if (!prev || (data.ended ?? '') > (prev.ended ?? '') || ((data.ended ?? '') === (prev.ended ?? '') && data.turns > prev.turns)) {
          digests.set(uid, data);
        }
      }
    }
    hosts.push({ host, files: files.length, lastSync: newest ? new Date(newest).toISOString() : null });
  }
  return { digests, apps, hosts };
}

/** Paragraphs repeated across sessions (by hash). */
export function boilerplate(digests: Iterable<SessionDigest>): Set<string> {
  const seen = new Map<string, number>();
  for (const d of digests) {
    const mine = new Set<string>();
    for (const [, text] of d.msgs) for (const p of paragraphs(text)) if (p.length >= BOILERPLATE_MIN_CHARS) mine.add(sha(p));
    for (const h of mine) seen.set(h, (seen.get(h) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n >= BOILERPLATE_SESSIONS).map(([h]) => h));
}

/** The conversation as search chunks, shared briefs removed and text redacted once more. */
export function chunk(d: SessionDigest, common: Set<string>): string[] {
  const out: string[] = [];
  let cur = '';
  for (const [role, text] of d.msgs) {
    const kept = paragraphs(text).filter((p) => p.length < BOILERPLATE_MIN_CHARS || !common.has(sha(p))).join('\n\n');
    if (!kept) continue;
    const piece = `${role === 'user' ? 'Adamya' : 'Agent'}: ${redact(kept)}\n`;
    if (cur && cur.length + piece.length > CHUNK_CHARS) { out.push(cur); cur = ''; }
    cur += piece;
  }
  if (cur) out.push(cur);
  return out;
}

const firstLine = (d: SessionDigest) => {
  const first = d.msgs.find(([r]) => r === 'user')?.[1] ?? '';
  return redact(first.replace(/\s+/g, ' ').trim()).slice(0, 300);
};

/**
 * Fold the inbox into index.db. Only sessions whose digest (or app record, or the shared-brief set) changed
 * are rewritten, so a run with nothing new is cheap. Returns what it did.
 */
export function ingest(opts: { rebuild?: boolean; now?: Date } = {}) {
  const { digests, apps, hosts } = readInbox();
  const db = openIndex();
  const common = boilerplate(digests.values());
  const commonHash = sha([...common].sort().join(','));
  const prevCommon = (db.prepare("select v from meta where k = 'boilerplate'").get() as { v?: string } | undefined)?.v;
  const rebuild = opts.rebuild || prevCommon !== commonHash;
  const known = new Map((db.prepare('select uid, hash from sessions').all() as { uid: string; hash: string }[]).map((r) => [r.uid, r.hash]));
  const at = (opts.now ?? new Date()).toISOString();
  const upsert = db.prepare(`insert into sessions(uid, app, id, host, path, key, title, cwd, project, branch, started, ended, turns, files, refs, first, bridge, ssh, hash, ingested_at)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    on conflict(uid) do update set app=excluded.app, id=excluded.id, host=excluded.host, path=excluded.path, key=excluded.key, title=excluded.title,
      cwd=excluded.cwd, project=excluded.project, branch=excluded.branch, started=excluded.started, ended=excluded.ended, turns=excluded.turns,
      files=excluded.files, refs=excluded.refs, first=excluded.first, bridge=excluded.bridge, ssh=excluded.ssh, hash=excluded.hash, ingested_at=excluded.ingested_at`);
  const delChunks = db.prepare('delete from chunks where uid = ?');
  const delFts = db.prepare('delete from chunks_fts where uid = ?');
  const addChunk = db.prepare('insert into chunks(uid, n, text) values (?,?,?)');
  const addFts = db.prepare('insert into chunks_fts(text, uid, n) values (?,?,?)');
  let changed = 0;
  tx(db, () => {
    for (const [uid, d] of digests) {
      const app = d.app === 'claude-code' ? apps.get(d.id) : undefined;
      const title = redact(app?.title || d.title || '').slice(0, 200);
      const hash = sha(JSON.stringify([d, app?.title, app?.bridge, app?.ssh]));
      if (!rebuild && known.get(uid) === hash) continue;
      changed++;
      upsert.run(uid, d.app, d.id, d.host, d.path, d.key ?? null, title, d.cwd, d.project, d.branch, d.started ?? null, d.ended ?? null,
        d.turns, JSON.stringify(d.files.slice(0, 15)), JSON.stringify(d.refs), firstLine(d), app?.bridge?.[0] ?? null, app?.ssh ?? null, hash, at);
      delChunks.run(uid);
      delFts.run(uid);
      // The header is chunk 0, so a search for the title or project finds the session.
      const parts = [`${title}\n${d.project} ${d.branch}\n${d.files.map((f) => path.basename(f)).join(' ')}`, ...chunk(d, common)];
      parts.forEach((text, n) => { addChunk.run(uid, n, text); addFts.run(text, uid, n); });
    }
    db.prepare("insert into meta(k, v) values ('boilerplate', ?) on conflict(k) do update set v = excluded.v").run(commonHash);
    db.prepare("insert into meta(k, v) values ('ingested_at', ?) on conflict(k) do update set v = excluded.v").run(at);
    db.exec('delete from hosts');
    const addHost = db.prepare('insert into hosts(host, files, last_sync) values (?,?,?)');
    for (const h of hosts) addHost.run(h.host, h.files, h.lastSync);
  });
  return { sessions: digests.size, changed, boilerplate: common.size, hosts: hosts.map((h) => h.host) };
}
