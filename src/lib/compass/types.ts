// Shapes shared by the compass reader, the /api/compass route and the /compass page.
// The compass itself lives in OpenClaw's workspace (a git repo of markdown files, see docs/compass.md);
// the Journal only reads it. Everything here is plain JSON so it can cross the API boundary.

/** The seven H2 headings a short-term compass must carry, in order. */
export const SHORT_TERM_SECTIONS = [
  'Period',
  'Relation to the long-term compass',
  'Focus',
  'Not now',
  'Flow',
  'Signals',
  'For agents',
] as const;
export type ShortTermSection = (typeof SHORT_TERM_SECTIONS)[number];

/** Front-matter keys every compass (and draft) must carry. */
export const SHORT_TERM_REQUIRED_KEYS = [
  'kind',
  'period',
  'title',
  'start',
  'end',
  'review_by',
  'updated',
  'version',
] as const;

/**
 * From New York calendar dates: `closed` when the front matter says so, `upcoming` before `start`,
 * `expired` after `end`, `review-due` from `review_by` through `end`, otherwise `active`.
 */
export type CompassStatus = 'closed' | 'upcoming' | 'active' | 'review-due' | 'expired';

export interface CompassPeriodRef {
  /** `<start>--<end>`, the period id used for directories and drafts. */
  id: string;
  title: string;
  start: string;
  end: string;
  reviewBy: string | null;
}

export interface ShortTermCompass {
  /** False when the file is missing or unreadable; the other fields are then empty. */
  available: boolean;
  /** Front-matter title, else the H1, else "". */
  title: string;
  period: CompassPeriodRef | null;
  status: CompassStatus | null;
  version: number | null;
  updated: string | null;
  opened: string | null;
  closed: string | null;
  /** File modification time (ISO), null when unknown. */
  mtime: string | null;
  /** The markdown body without its front matter. */
  text: string;
  frontMatter: Record<string, string>;
  /** H2 heading → section markdown, in file order. */
  sections: Record<string, string>;
  /** Text before the first H2 (the H1 and any HTML comments). */
  preamble: string;
  relation: string;
  forAgents: string;
  path: string;
  /** Validation problems, worded for the page. Empty for a well-formed compass. */
  problems: string[];
}

export type LongTermFile = 'USER.md' | 'MEMORY.md' | 'SOUL.md';

export interface LongTermPart {
  file: LongTermFile;
  /** What the extracted block is called in the original file. */
  label: string;
  /** The extracted North Star block, or null when the file or its marker is missing. */
  text: string | null;
  path: string;
  exists: boolean;
  symlink: boolean;
  markerFound: boolean;
  mtime: string | null;
}

export interface LongTermCompass {
  available: boolean;
  /** The found parts joined under `## From USER.md` style headings. */
  text: string;
  parts: { user: LongTermPart; memory: LongTermPart; soul: LongTermPart };
  /** Mirror files that exist. */
  files: LongTermFile[];
  mirroredAt: string | null;
  mirroredAtSource: 'git' | 'mtime' | null;
  problems: string[];
}

export type LogEntryKind = 'pulse' | 'chat' | 'system' | 'other';

export interface LogEntry {
  date: string;
  kind: LogEntryKind;
  title: string | null;
  /** The heading line as written. */
  heading: string;
  body: string;
}

export type RetroVerdict = 'too short' | 'right' | 'too long' | 'unknown';

export type PeriodState = 'current' | 'closed' | 'unfinished';

export interface PeriodSummary {
  id: string;
  title: string;
  start: string;
  end: string;
  /** Inclusive length in weeks, one decimal. */
  weeks: number;
  state: PeriodState;
  current: boolean;
  opened: string | null;
  closed: string | null;
  finalVersion: number | null;
  verdict: RetroVerdict | null;
  hasSnapshot: boolean;
  hasLog: boolean;
  hasRetro: boolean;
  logEntries: number;
  lastLogDate: string | null;
  /** Repo-relative directory, present even when synthesised for the current period. */
  path: string;
  hasDir: boolean;
}

export interface PeriodRetro {
  text: string;
  frontMatter: Record<string, string>;
  sections: Record<string, string>;
  verdict: RetroVerdict | null;
  closed: string | null;
  path: string;
}

export interface PeriodLog {
  text: string;
  entries: LogEntry[];
  path: string;
}

export interface PeriodDetail {
  summary: PeriodSummary;
  compass: (ShortTermCompass & { source: 'snapshot' | 'current' }) | null;
  log: PeriodLog | null;
  retro: PeriodRetro | null;
}

export interface CompassDraft {
  id: string;
  title: string;
  start: string | null;
  end: string | null;
  reviewBy: string | null;
  version: number | null;
  updated: string | null;
  /** Date Adamya approved it, from the `approved:` key; null while it awaits approval. */
  approved: string | null;
  approvedBy: string | null;
  text: string;
  sections: Record<string, string>;
  path: string;
  problems: string[];
}

export type CommitAuthorKind = 'openclaw' | 'compass-sync' | 'adamya' | 'other';
export type CommitKind = 'short' | 'long' | 'pulse' | 'period' | 'draft' | 'repo' | 'other';

export interface CompassCommit {
  sha: string;
  shortSha: string;
  author: string;
  authorKind: CommitAuthorKind;
  /** Author date, ISO 8601. */
  date: string;
  subject: string;
  /** From the `compass(<kind>):` prefix. */
  kind: CommitKind;
}

export interface CommitDetail extends CompassCommit {
  body: string;
  files: string[];
  diff: string;
  truncated: boolean;
  additions: number;
  deletions: number;
}

export interface RepoInfo {
  dir: string;
  gitAvailable: boolean;
  isRepo: boolean;
  branch: string | null;
  head: CompassCommit | null;
  remote: string | null;
  /** git's first stderr line when the directory is not usable as a repo. */
  error: string | null;
}

export type HistoryScope = 'short' | 'long' | 'all';

export interface CompassHistory {
  scope: HistoryScope;
  limit: number;
  commits: CompassCommit[];
  error: string | null;
}

export interface CompassOverview {
  /** New York calendar date the statuses were computed for. */
  today: string;
  dir: string;
  /** True when the compass directory exists. */
  available: boolean;
  shortTerm: ShortTermCompass;
  longTerm: LongTermCompass;
  periods: PeriodSummary[];
  drafts: CompassDraft[];
  repo: RepoInfo;
  generatedAt: string;
}
