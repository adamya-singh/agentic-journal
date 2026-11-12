import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { backendDataDir } from '../backend-data.ts';

// index.db holds every session's digest, its text in chunks (with full-text search), and Adamya's own
// links and "not this" answers. Synchronous like the other stores; WAL lets the ingest CLI write while the
// web server reads.

export const sessionIndexDir = () => path.join(backendDataDir(), 'session-index');
export const inboxDir = () => path.join(sessionIndexDir(), 'inbox');

const SCHEMA = `
create table if not exists sessions(
  uid text primary key, app text not null, id text not null, host text not null, path text, key text,
  title text not null default '', cwd text, project text, branch text, started text, ended text,
  turns integer not null default 0, files text not null default '[]', refs text not null default '[]',
  first text not null default '', bridge text, ssh text, hash text not null, ingested_at text not null);
create index if not exists sessions_key on sessions(key);
create table if not exists chunks(uid text not null, n integer not null, text text not null, primary key(uid, n));
create virtual table if not exists chunks_fts using fts5(text, uid unindexed, n unindexed, tokenize='porter unicode61');
create table if not exists feedback(target text not null, uid text not null, verdict text not null, at text not null, primary key(target, uid));
create table if not exists hosts(host text primary key, files integer not null, last_sync text);
create table if not exists meta(k text primary key, v text);
`;

let cached: { file: string; ino: number | null; db: DatabaseSync } | null = null;

const inodeOf = (file: string): number | null => {
  try { return fs.statSync(file).ino; } catch { return null; }
};

/**
 * Whether there is an index to read. A server no machine has sent sessions to has none; reading it must not make
 * one, and must not fail.
 */
export function indexExists(): boolean {
  try {
    return fs.statSync(path.join(sessionIndexDir(), 'index.db')).isFile();
  } catch {
    return false;
  }
}

/**
 * The index, created on first use. Kept open per process; tests that move BACKEND_DATA_DIR get a fresh one, and so
 * does a server whose index.db was replaced under it (restored from a backup, rebuilt from scratch).
 */
export function openIndex(): DatabaseSync {
  const file = path.join(sessionIndexDir(), 'index.db');
  if (cached?.file === file && cached.ino === inodeOf(file)) return cached.db;
  cached?.db.close();
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  // Session text is private even redacted: owner only.
  try { fs.chmodSync(path.dirname(file), 0o700); fs.chmodSync(file, 0o600); } catch { /* not ours to change */ }
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  cached = { file, ino: inodeOf(file), db };
  return db;
}

export function closeIndex() {
  cached?.db.close();
  cached = null;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('begin');
  try {
    const r = fn();
    db.exec('commit');
    return r;
  } catch (e) {
    db.exec('rollback');
    throw e;
  }
}

export interface SessionRecord {
  uid: string;
  app: string;
  id: string;
  host: string;
  path: string | null;
  key: string | null;
  title: string;
  cwd: string | null;
  project: string | null;
  branch: string | null;
  started: string | null;
  ended: string | null;
  turns: number;
  files: string;
  refs: string;
  first: string;
  bridge: string | null;
  ssh: string | null;
  hash: string;
}
