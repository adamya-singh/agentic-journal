// The session index: every OpenClaw, Claude Code and Codex session on Adamya's machines, so a task or an
// action card can list the ones that worked on it. Each machine's `proj sessions` sends redacted digests
// to data/session-index/inbox/<host>/; `scripts/session-index.ts ingest` folds them into index.db.

export const SESSION_APPS = ['openclaw', 'claude-code', 'codex'] as const;
export type SessionApp = (typeof SESSION_APPS)[number];

/** One session as `proj sessions` writes it (v1). Text is already redacted on the machine it came from. */
export interface SessionDigest {
  v: 1;
  app: SessionApp;
  id: string;
  host: string;              // the proj host it ran on: laptop, wsl, mac
  path: string;
  key?: string | null;       // OpenClaw session key
  title: string;
  cwd: string;
  project: string;
  branch: string;
  started?: string | null;
  ended?: string | null;
  turns: number;
  files: string[];
  refs: string[];            // card, bugs/features and task ids, and [aj:...] marks, found in the session
  msgs: ['user' | 'agent', string][];
  cut: boolean;              // a long session: only its start and its end were kept
  redactions: number;
}

/** The Claude desktop app's record of a Claude Code session (title, Remote Control id, SSH host). */
export interface AppRecord {
  cli: string;
  app?: string;
  title: string;
  bridge: string[];
  ssh?: string | null;
  cwd?: string;
  archived?: boolean;
  created?: number;
  active?: number;
}

/** A task (`task:<id>`) or an action card (`card:<ac_id>`). */
export type SessionTarget = `task:${string}` | `card:${string}`;

/** How a session came to be on a card. Phase 2 has only exact links; `matched` is the search tier. */
export type RowTier = 'linked' | 'matched';

export interface SessionRow {
  uid: string;               // app:id
  app: SessionApp;
  host: string;
  machine: string;           // laptop, PC, Mac
  title: string;
  project: string;
  started: string | null;
  ended: string | null;
  turns: number;
  live: boolean;
  tier: RowTier;
  why: string;
  key?: string;              // OpenClaw: the Control UI opens it
  href?: string;             // Claude Code with a Remote Control id
  resume?: string;           // a command to copy when there is no link
}

export interface SessionsView {
  rows: SessionRow[];
  indexed: number;
  hosts: { host: string; machine: string; lastSync: string | null }[];
}
