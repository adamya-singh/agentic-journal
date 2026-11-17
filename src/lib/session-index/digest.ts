// Session digests from the agents' own transcripts: Claude Code (~/.claude/projects/<dir>/<id>.jsonl) and Codex
// (<CODEX_HOME>/sessions/**/rollout-*.jsonl[.zst]), read line by line, and OpenClaw (its agent sqlite). Pure apart from
// the OpenClaw reader: the collector (collect.ts) feeds lines in, from this machine's disk or over ssh from another.
//
// A digest keeps what the index needs and no more: the session's folder, branch, times, how many times Adamya wrote,
// the files it changed, the Journal ids it names, and its first and last few messages (redacted). It is built by an
// accumulator that can be saved and fed more lines later, so a transcript that grew is read from where it was left.
import path from 'node:path';
import { redact } from './redact.ts';
import type { SessionApp, SessionDigest } from './types.ts';

export const KEEP_MSGS = 6;          // first and last messages kept
const MSG_MAX = 2000;
const FILES_MAX = 30;
const REFS_MAX = 200;
const SCAN_MAX = 20_000;             // of one tool input, for ids

/** A digest being built. JSON, so the collector can keep it between runs. */
export interface DigestAcc {
  app: SessionApp;
  id: string;
  cwd: string;
  branch: string;
  title: string;
  titleRank: number;
  started: string | null;
  ended: string | null;
  turns: number;
  first: [Role, string][];
  last: [Role, string][];
  total: number;
  prevKey: string | null;            // the API message the last agent text came from, so its blocks join up
  refs: string[];
  files: string[];
  redactions?: number;               // messages a secret was taken out of (they are kept redacted, here too)
}
type Role = 'user' | 'agent';

export function newAcc(app: SessionApp, id = ''): DigestAcc {
  return { app, id, cwd: '', branch: '', title: '', titleRank: 0, started: null, ended: null, turns: 0, first: [], last: [], total: 0, prevKey: null, refs: [], files: [] };
}

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;
const CARD_ID = /\bac_[0-9a-f]{8}\b/g;
const MARK = /\[aj:(task|card):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|ac_[0-9a-f]{8})\]/g;

/**
 * The Journal ids a text names: `[aj:task:<id>]` marks (a session started from a task), and any task or card id the
 * Journal knows. Other uuids (message ids, session ids) are not kept.
 */
export function scanRefs(acc: DigestAcc, text: string, known: ReadonlySet<string>): void {
  if (!text || acc.refs.length >= REFS_MAX) return;
  const add = (ref: string) => { if (!acc.refs.includes(ref) && acc.refs.length < REFS_MAX) acc.refs.push(ref); };
  if (text.includes('[aj:')) for (const m of text.matchAll(MARK)) add(`aj:${m[1]}:${m[2]}`);
  for (const m of text.matchAll(UUID)) if (known.has(m[0])) add(m[0]);
  if (text.includes('ac_')) for (const m of text.matchAll(CARD_ID)) if (known.has(m[0])) add(m[0]);
}

/** A copy of its own: a slice would keep the whole text it was cut from alive (V8 shares the parent string). */
const own = (text: string): string => JSON.parse(JSON.stringify(text)) as string;
const clipMsg = (text: string) => own(text.length > MSG_MAX ? `${text.slice(0, MSG_MAX - 1)}…` : text);

/** One message. An agent's text blocks of the same API message join into one. */
function pushMsg(acc: DigestAcc, role: Role, text: string, key: string | null = null): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  // Redacted as it is kept, so no secret sits in the collector's saved state either.
  const clean = redact(trimmed);
  if (clean !== trimmed) acc.redactions = (acc.redactions ?? 0) + 1;
  if (role === 'agent' && key && acc.prevKey === key) {
    const list = acc.last.length ? acc.last : acc.first;
    const prev = list[list.length - 1];
    if (prev && prev[0] === 'agent') { prev[1] = clipMsg(`${prev[1]}\n\n${clean}`); return; }
  }
  acc.prevKey = role === 'agent' ? key : null;
  acc.total++;
  if (acc.first.length < KEEP_MSGS) acc.first.push([role, clipMsg(clean)]);
  else {
    acc.last.push([role, clipMsg(clean)]);
    if (acc.last.length > KEEP_MSGS) acc.last.shift();
  }
}

function addFile(acc: DigestAcc, file: unknown): void {
  if (typeof file !== 'string' || !file || acc.files.includes(file) || acc.files.length >= FILES_MAX) return;
  acc.files.push(file);
}

function at(acc: DigestAcc, ts: unknown): void {
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return;
  const iso = new Date(ts).toISOString();
  if (!acc.started || iso < acc.started) acc.started = iso;
  if (!acc.ended || iso > acc.ended) acc.ended = iso;
}

function setTitle(acc: DigestAcc, title: unknown, rank: number): void {
  if (typeof title !== 'string' || !title.trim() || rank < acc.titleRank) return;
  acc.title = own(title.trim().slice(0, 200));
  acc.titleRank = rank;
}

const safeParse = (line: string): Record<string, unknown> | null => {
  try {
    const v = JSON.parse(line);
    return v && typeof v === 'object' ? v as Record<string, unknown> : null;
  } catch {
    return null;
  }
};

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? v as Record<string, unknown> : {});

/** One message already told apart from the rest (OpenClaw's). */
export function feedRaw(acc: DigestAcc, role: Role, text: string, ts: string | null): void {
  at(acc, ts);
  if (!text.trim()) return;
  if (role === 'user') acc.turns++;
  pushMsg(acc, role, text);
}

// ---- Claude Code.

/** What Claude Code itself puts in a user message (command output, reminders, notices): not something he wrote. */
const CLAUDE_NOT_TYPED = /^\s*(?:<local-command-|<command-(?:name|message|args)>|<task-notification>|<system-reminder>|<user-memory-input>|Caveat: The messages below|\[Request interrupted by user)/;
const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** One line of a Claude Code transcript. Lines from sub-agents (sidechains) are left out. */
export function feedClaudeLine(acc: DigestAcc, line: string, known: ReadonlySet<string>): void {
  // The large bookkeeping lines are skipped before parsing.
  if (line.startsWith('{"type":"api-request') || line.startsWith('{"type":"file-history-snapshot"')) return;
  const j = safeParse(line);
  if (!j) return;
  const type = j.type;
  if (type === 'custom-title') { setTitle(acc, j.customTitle, 3); return; }
  if (type === 'agent-name') { setTitle(acc, j.agentName, 2); return; }
  if (type === 'summary') { setTitle(acc, j.summary, 1); return; }
  if (type !== 'user' && type !== 'assistant') return;
  if (j.isSidechain === true) return;
  if (!acc.id && typeof j.sessionId === 'string') acc.id = j.sessionId;
  if (!acc.cwd && typeof j.cwd === 'string') acc.cwd = own(j.cwd);
  if (typeof j.gitBranch === 'string' && j.gitBranch && j.gitBranch !== 'HEAD') acc.branch = j.gitBranch;
  at(acc, j.timestamp);
  const message = rec(j.message);
  const content = message.content;
  if (type === 'user') {
    if (j.isMeta === true) return;
    const origin = rec(j.origin).kind;
    if (typeof origin === 'string' && origin !== 'human' && origin !== 'peer') return;
    const texts = typeof content === 'string' ? [content]
      : Array.isArray(content) ? content.map(rec).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text as string) : [];
    const text = texts.filter((t) => !CLAUDE_NOT_TYPED.test(t)).join('\n\n');
    if (!text.trim()) return;
    scanRefs(acc, text, known);
    acc.turns++;
    pushMsg(acc, 'user', text);
    return;
  }
  if (!Array.isArray(content)) {
    if (typeof content === 'string' && message.model !== '<synthetic>') { scanRefs(acc, content, known); pushMsg(acc, 'agent', content, String(message.id ?? '')); }
    return;
  }
  if (message.model === '<synthetic>') return;
  for (const block of content.map(rec)) {
    if (block.type === 'text' && typeof block.text === 'string') {
      scanRefs(acc, block.text, known);
      pushMsg(acc, 'agent', block.text, typeof message.id === 'string' ? message.id : null);
    } else if (block.type === 'tool_use') {
      const input = rec(block.input);
      if (FILE_TOOLS.has(String(block.name))) addFile(acc, input.file_path ?? input.notebook_path);
      scanRefs(acc, JSON.stringify(input).slice(0, SCAN_MAX), known);
    }
  }
}

// ---- Codex.

/** What Codex puts in the conversation as a user message (the environment, AGENTS.md, app context): not his. */
const CODEX_NOT_TYPED = /^\s*(?:<[a-z_]+(?:\s[^>]*)?>|# AGENTS\.md instructions)/i;
const PATCH_FILE = /\*\*\* (?:Update|Add|Delete) File: ([^\n]+)/g;

function codexText(content: unknown, kind: string): string {
  if (!Array.isArray(content)) return '';
  return content.map(rec).filter((c) => c.type === kind && typeof c.text === 'string').map((c) => c.text as string).join('\n\n');
}

/** One line of a Codex rollout. */
export function feedCodexLine(acc: DigestAcc, line: string, known: ReadonlySet<string>): void {
  const j = safeParse(line);
  if (!j) return;
  const p = rec(j.payload);
  if (j.type === 'session_meta') {
    if (typeof p.id === 'string' && !acc.id) acc.id = p.id;
    if (typeof p.cwd === 'string' && !acc.cwd) acc.cwd = p.cwd;
    const branch = rec(p.git).branch;
    if (typeof branch === 'string' && branch) acc.branch = branch;
    at(acc, p.timestamp);
    return;
  }
  if (j.type !== 'response_item') return;
  at(acc, j.timestamp);
  if (p.type === 'message') {
    if (p.role === 'user') {
      const text = codexText(p.content, 'input_text');
      if (!text.trim() || CODEX_NOT_TYPED.test(text)) return;
      scanRefs(acc, text, known);
      acc.turns++;
      pushMsg(acc, 'user', text);
    } else if (p.role === 'assistant') {
      const text = codexText(p.content, 'output_text');
      scanRefs(acc, text, known);
      pushMsg(acc, 'agent', text, typeof p.id === 'string' ? p.id : null);
    }
    return;
  }
  if (p.type === 'function_call' || p.type === 'custom_tool_call') {
    const input = typeof p.input === 'string' ? p.input : typeof p.arguments === 'string' ? p.arguments : '';
    const scanned = input.slice(0, SCAN_MAX);
    scanRefs(acc, scanned, known);
    if (scanned.includes('*** ')) for (const m of scanned.matchAll(PATCH_FILE)) addFile(acc, m[1]!.trim().replace(/\\n.*$/, ''));
  }
}

// ---- Several pieces of one session (Codex writes a thread in several rollout files) as one.

export function mergeAccs(parts: DigestAcc[]): DigestAcc {
  const sorted = [...parts].sort((a, b) => (a.started ?? '').localeCompare(b.started ?? ''));
  const out = newAcc(sorted[0]!.app, sorted.find((p) => p.id)?.id ?? '');
  for (const p of sorted) {
    if (!out.cwd) out.cwd = p.cwd;
    if (p.branch) out.branch = p.branch;
    if (p.titleRank >= out.titleRank && p.title) { out.title = p.title; out.titleRank = p.titleRank; }
    if (p.started && (!out.started || p.started < out.started)) out.started = p.started;
    if (p.ended && (!out.ended || p.ended > out.ended)) out.ended = p.ended;
    out.turns += p.turns;
    for (const [role, text] of [...p.first, ...p.last]) pushMsg(out, role, text);
    out.total += Math.max(0, p.total - p.first.length - p.last.length);
    for (const r of p.refs) if (!out.refs.includes(r) && out.refs.length < REFS_MAX) out.refs.push(r);
    for (const f of p.files) addFile(out, f);
    out.redactions = (out.redactions ?? 0) + (p.redactions ?? 0);
  }
  return out;
}

// ---- The digest itself.

export interface DigestPlace {
  host: string;
  path: string;
  /** The proj project a folder belongs to, when the registry knows it. */
  projectOf?(cwd: string): string | null;
}

export function finishDigest(acc: DigestAcc, place: DigestPlace, extra: { key?: string | null; title?: string } = {}): SessionDigest {
  let redactions = acc.redactions ?? 0;
  const msgs = [...acc.first, ...acc.last].map(([role, text]) => {
    const clean = redact(text);
    if (clean !== text) redactions++;
    return [role, clean] as [Role, string];
  });
  const project = (acc.cwd && place.projectOf?.(acc.cwd)) || (acc.cwd ? path.basename(acc.cwd.replace(/[\\/]+$/, '').replace(/\\/g, '/')) : '');
  return {
    v: 1, app: acc.app, id: acc.id, host: place.host, path: place.path, key: extra.key ?? null,
    title: redact(extra.title || acc.title || ''), cwd: acc.cwd, project, branch: acc.branch,
    started: acc.started, ended: acc.ended, turns: acc.turns, files: acc.files, refs: acc.refs, msgs,
    cut: acc.total > msgs.length, redactions,
  };
}
