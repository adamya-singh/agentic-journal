// OpenClaw's sessions as digests, read from its agent database (read-only). OpenClaw runs on this machine only.
//
// A conversation is a session key (a task chat, a brief run, a dashboard or phone chat), its windows (resets,
// compactions) joined into one digest named by its first window. A cron job's key holds every run of the job as a
// window of its own; each run is its own digest, and only when it names a Journal task or card: the rest (feeds,
// syncs, checks) worked on nothing a task can show. Heartbeats are left out.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { feedRaw, finishDigest, newAcc, scanRefs, type DigestAcc } from './digest.ts';
import type { SessionDigest } from './types.ts';

export const openclawDbPath = () => process.env.OPENCLAW_AGENT_DB || path.join(os.homedir(), '.openclaw', 'agents', 'main', 'agent', 'openclaw-agent.sqlite');

/** The metadata OpenClaw puts before what was typed in a channel message (sender, ids), as fenced JSON. */
const CTX_BLOCK = /^[^\n]*⟦openclaw:ctx⟧[^\n]*\n```[a-z]*\n[\s\S]*?\n```\s*/;
const strip = (text: string) => { let out = text; for (let i = 0; i < 4 && CTX_BLOCK.test(out); i++) out = out.replace(CTX_BLOCK, ''); return out; };

/** A key whose windows are separate runs of one cron job. */
const CRON_JOB = /^agent:[^:]+:cron:[^:]+$/;
const ALWAYS = /:journal-(?:chat|brief|done|media-add)-/;
const RUNS = /:cron:|:run:|dryrun|:heartbeat$/;

export function openclawDigests(options: { known: ReadonlySet<string>; titles?: Map<string, string>; names?: Map<string, string>; host: string; dbPath?: string }): SessionDigest[] {
  const file = options.dbPath ?? openclawDbPath();
  if (!fs.existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('pragma busy_timeout = 5000;');
    const nodes = db.prepare('select session_key as key, display_name as name, label from session_nodes').all() as { key: string; name: string | null; label: string | null }[];
    const nodeOf = new Map(nodes.map((n) => [n.key, n]));
    const windows = db.prepare('select session_id as sid, session_key as key, created_at as at from session_windows order by created_at').all() as { sid: string; key: string; at: number }[];
    // Each window's group: its key's conversation, or (a cron job) the run itself.
    const groupOf = new Map<string, string>();
    const firstOf = new Map<string, string>();
    for (const w of windows) {
      if (/:heartbeat$/.test(w.key)) continue;
      const group = CRON_JOB.test(w.key) ? `w:${w.sid}` : `k:${w.key}`;
      groupOf.set(w.sid, group);
      if (!firstOf.has(group)) firstOf.set(group, w.sid);
    }
    const keyOf = new Map(windows.map((w) => [w.sid, w.key]));
    // A run is kept only when it names a Journal id, and most do not: a first pass looks for ids alone, a second
    // reads the messages of the runs that name one (holding every run's messages at once does not fit).
    const isRun = (group: string) => { const key = keyOf.get(firstOf.get(group)!) ?? group.slice(2); return !ALWAYS.test(key) && RUNS.test(key); };
    const accs = new Map<string, DigestAcc>();
    const runRefs = new Map<string, DigestAcc>();
    const rows = () => db.prepare('select c0 as text, c1 as sid, c3 as role, c4 as ts from session_transcript_fts_content order by id').iterate() as Iterable<{ text: string | null; sid: string; role: string; ts: number | null }>;
    const feed = (acc: DigestAcc, r: { text: string; role: string; ts: number | null }) => {
      const text = r.role === 'user' ? strip(r.text) : r.text;
      scanRefs(acc, text, options.known);
      feedRaw(acc, r.role === 'user' ? 'user' : 'agent', text, typeof r.ts === 'number' ? new Date(r.ts).toISOString() : null);
    };
    for (const r of rows()) {
      const group = groupOf.get(r.sid);
      if (!group || !r.text) continue;
      if (isRun(group)) {
        let refs = runRefs.get(group);
        if (!refs) { refs = newAcc('openclaw', firstOf.get(group)!); runRefs.set(group, refs); }
        scanRefs(refs, r.text, options.known);
        continue;
      }
      let acc = accs.get(group);
      if (!acc) { acc = newAcc('openclaw', firstOf.get(group)!); accs.set(group, acc); }
      feed(acc, r as { text: string; role: string; ts: number | null });
    }
    const wanted = new Set([...runRefs].filter(([, a]) => a.refs.length).map(([g]) => g));
    runRefs.clear();
    if (wanted.size) {
      for (const r of rows()) {
        const group = groupOf.get(r.sid);
        if (!group || !r.text || !wanted.has(group)) continue;
        let acc = accs.get(group);
        if (!acc) { acc = newAcc('openclaw', firstOf.get(group)!); accs.set(group, acc); }
        feed(acc, r as { text: string; role: string; ts: number | null });
      }
    }
    const out: SessionDigest[] = [];
    for (const [group, acc] of accs) {
      const key = keyOf.get(acc.id) ?? group.slice(2);
      if (!ALWAYS.test(key) && RUNS.test(key) && !acc.refs.length) continue;
      const node = nodeOf.get(key);
      const own = [node?.label, node?.name].find((t) => t && !t.startsWith('journal-') && !t.startsWith('agent:') && t !== key.split(':').pop());
      out.push(finishDigest(acc, { host: options.host, path: `openclaw:${key}` }, { key, title: options.titles?.get(key) ?? journalTitle(key, options.names) ?? own ?? '' }));
    }
    return out;
  } finally {
    db.close();
  }
}

/** The titles the Journal gave its task and card chats (tasks/brief-chats.json), by OpenClaw session key. */
export function journalChatTitles(dataDir: string): Map<string, string> {
  const out = new Map<string, string>();
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'tasks', 'brief-chats.json'), 'utf8')) as { threads?: { sessionKey?: unknown; title?: unknown }[] };
    for (const t of raw.threads ?? []) if (typeof t.sessionKey === 'string' && typeof t.title === 'string' && t.title && t.title !== 'New chat') out.set(t.sessionKey, t.title);
  } catch { /* no chats */ }
  return out;
}

const JOURNAL_KEY = /:journal-(chat|brief|done)-(card-ac-[0-9a-f]{8}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:-\d+)?$/;

/**
 * What a session the Journal started is about, in words, for one whose chat has no title of its own: its first message
 * is the Journal's long prompt ("Agentic Journal is asking you to fill in the brief…"), which says nothing at a glance.
 */
export function journalTitle(key: string, names: Map<string, string> | undefined): string | null {
  const m = JOURNAL_KEY.exec(key);
  if (!m) return null;
  const id = m[2]!.startsWith('card-ac-') ? `ac_${m[2]!.slice(8)}` : m[2]!;
  const name = names?.get(id);
  const what = name ? `“${name.length > 90 ? `${name.slice(0, 89)}…` : name}”` : id.startsWith('ac_') ? 'an action card' : 'a task';
  if (m[1] === 'brief') return `Filled in the brief for ${what}`;
  if (m[1] === 'done') return `Checked whether ${what} is done`;
  return `Chat about ${what}`;
}

/** The Journal's tasks and cards by id, with their titles (open, let go, and cards). */
export function journalNames(dataDir: string): Map<string, string> {
  const out = new Map<string, string>();
  const read = (file: string): unknown => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); } catch { return null; } };
  const put = (id: unknown, text: unknown) => { if (typeof id === 'string' && typeof text === 'string' && text.trim()) out.set(id, text.trim()); };
  for (const f of ['tasks/have-to-do.json', 'tasks/want-to-do.json']) for (const t of (read(f) as { tasks?: { id?: unknown; text?: unknown }[] } | null)?.tasks ?? []) put(t.id, t.text);
  for (const r of (read('tasks/let-go.json') as { records?: { task?: { id?: unknown; text?: unknown } }[] } | null)?.records ?? []) put(r.task?.id, r.task?.text);
  for (const c of (read('action-cards/cards.json') as { cards?: { id?: unknown; title?: unknown; headline?: unknown }[] } | null)?.cards ?? []) put(c.id, c.title ?? c.headline);
  return out;
}
