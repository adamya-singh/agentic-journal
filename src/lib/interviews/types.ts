// The Interviews casebook: one record per hiring process, by recruiting season.
// Notes live as Markdown files beside index.json; Jobs data (emails, milestones)
// is read live and never copied in here.

export type RoundKind = 'screen' | 'oa' | 'tech' | 'ml' | 'behav' | 'fit' | 'onsite' | 'other';
export type NoteKind =
  | 'job-description' | 'prep' | 'research' | 'notes' | 'transcript' | 'oa'
  | 'post-mortem' | 'outcome' | 'offer' | 'emails' | 'file';
export type NoteAuthor = 'you' | 'openclaw' | 'claude' | 'import';
export type OutcomeKind = 'offer' | 'rejected' | 'no-reply' | 'withdrawn';

export interface TalkSummary {
  /** [start second, length in seconds, who] from transcript timestamps. */
  segs: [number, number, 'you' | 'them'][];
  total: number;
  youShare: number;
  turns: number;
}

export interface StoredRound {
  /** For a Jobs process, the id of the derived round this overrides, or a new id for one added by hand. */
  id: string;
  name?: string;
  kind?: RoundKind;
  /** ISO time the round happened or is booked for (a date alone for imported rounds). */
  at?: string;
  time?: string;
  duration?: string;
  people?: string[];
  format?: string;
  note?: string;
  cancelled?: boolean;
}

export interface StoredNote {
  id: string;
  title: string;
  kind: NoteKind;
  /** 'before', 'after', or a round id. */
  round: string;
  date: string;
  author: NoteAuthor;
  /** File name inside the process folder. */
  file: string;
  bytes: number;
  importedFrom?: string;
  omiTranscriptId?: string;
  talk?: TalkSummary;
}

export interface StoredFlag {
  id: string;
  text: string;
  options: { label: string; roundId: string; at: string }[];
  resolved?: string;
}

export interface InterviewProcess {
  id: string;
  season: string;
  listingId?: string;
  company: string;
  role: string;
  location?: string;
  term?: string;
  comp?: string;
  outcome?: { kind: OutcomeKind; at?: string; note?: string };
  people: { name: string; role?: string; email?: string }[];
  rounds: StoredRound[];
  /** Only for processes Jobs never saw (the imported season). */
  events?: { at: string; kind: TimelineKind; label: string }[];
  notes: StoredNote[];
  flags?: StoredFlag[];
  createdAt: string;
  updatedAt: string;
}

export type TimelineKind =
  | 'applied' | 'received' | 'oa' | 'invite' | 'screen' | 'interview' | 'offer' | 'rejected' | 'note';

export interface InterviewQuestion {
  id: string;
  processId: string;
  /** Round id within the process. */
  round: string;
  type: 'behavioral' | 'coding' | 'system' | 'ml' | 'recruiter' | 'fit';
  text: string;
  answer?: string;
}

export interface InterviewLesson {
  id: string;
  processId: string;
  text: string;
  source: string;
  date: string;
}

export interface InterviewsIndex {
  version: 1;
  processes: InterviewProcess[];
  questions: InterviewQuestion[];
  lessons: InterviewLesson[];
  /** Company name (lowercase) → web domain, for logos. */
  domains: Record<string, string>;
}

// ---------- what the page gets ----------

export type RoundState = 'done' | 'upcoming' | 'capture' | 'unscheduled' | 'unrecorded' | 'cancelled';

export interface RoundView {
  id: string;
  name: string;
  kind: RoundKind;
  at?: string;
  time?: string;
  duration?: string;
  people: string[];
  format?: string;
  note?: string;
  state: RoundState;
  invitedAt?: string;
  noteIds: string[];
}

export interface NoteView extends Omit<StoredNote, 'file' | 'importedFrom'> {
  path?: string;
  draft?: boolean;
}

export interface ProcessView {
  /** Stable key for writes: the stored id, or `listing:<id>` before anything is stored. */
  key: string;
  season: string;
  source: 'imported' | 'jobs';
  listingId?: string;
  company: string;
  role: string;
  location?: string;
  term?: string;
  comp?: string;
  domain?: string;
  appliedAt?: string;
  outcome: { kind: 'open' | OutcomeKind; label: string; at?: string; note?: string };
  events: { at: string; kind: TimelineKind; label: string; summary?: string; from?: string }[];
  rounds: RoundView[];
  notes: NoteView[];
  people: { name: string; role?: string; email?: string }[];
  flags: StoredFlag[];
  /** How far it got, 0 (applied) to 1 (offer). */
  reach: number;
  postingUrl?: string;
}

export interface CasebookView {
  now: string;
  seasons: { id: string; label: string; range: string; source: string; count: number; submitted?: number }[];
  processes: ProcessView[];
  questions: InterviewQuestion[];
  lessons: InterviewLesson[];
}
