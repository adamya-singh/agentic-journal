import { randomUUID } from 'crypto';
import type { JobApplicationRecord, JobListing } from '@/lib/types';
import { noteFileName, seasonFor, slugify, writeNoteFile } from './store';
import type { InterviewProcess, InterviewsIndex, NoteAuthor, NoteKind, StoredNote, StoredRound } from './types';

// Writes shared by the API route and scripts/interviews.ts. Each takes the index
// inside mutateInterviews(), so callers get one lock and one atomic save.

export const NOTE_KINDS: NoteKind[] = ['job-description', 'prep', 'research', 'notes', 'transcript', 'oa', 'post-mortem', 'outcome', 'offer', 'emails', 'file'];

export interface ListingSource {
  listings: JobListing[];
  applications: Record<string, JobApplicationRecord>;
}

/** The stored process for a key: its id, or `listing:<id>`, which creates one on first write. */
export function processForKey(index: InterviewsIndex, key: string, source: ListingSource | undefined, create: boolean): InterviewProcess {
  if (key.startsWith('listing:')) {
    const listingId = key.slice('listing:'.length);
    const existing = index.processes.find((p) => p.listingId === listingId);
    if (existing) return existing;
    if (!create) throw new Error('No notes for that application yet');
    const listing = source?.listings.find((l) => l.id === listingId);
    if (!listing) throw new Error('Job posting not found');
    const app = source?.applications[listingId];
    const season = seasonFor(app?.submittedAt ?? app?.employerUpdates?.[0]?.receivedAt ?? listing.savedAt);
    let id = `${season}/${slugify(`${listing.company} ${listing.positionTitle}`)}`;
    for (let i = 2; index.processes.some((p) => p.id === id); i += 1) id = `${season}/${slugify(`${listing.company} ${listing.positionTitle}`)}-${i}`;
    const now = new Date().toISOString();
    const process: InterviewProcess = { id, season, listingId, company: listing.company, role: listing.positionTitle, people: [], rounds: [], notes: [], createdAt: now, updatedAt: now };
    index.processes.push(process);
    return process;
  }
  const process = index.processes.find((p) => p.id === key);
  if (!process) throw new Error('Process not found');
  return process;
}

export interface SaveNoteInput {
  key: string;
  noteId?: string;
  title?: string;
  kind?: NoteKind;
  round?: string;
  body: string;
  author?: NoteAuthor;
  date?: string;
}

export function saveNote(index: InterviewsIndex, input: SaveNoteInput, source?: ListingSource): StoredNote {
  const process = processForKey(index, input.key, source, true);
  const now = new Date().toISOString();
  let note = input.noteId ? process.notes.find((n) => n.id === input.noteId) : undefined;
  if (input.noteId && !note) throw new Error('Note not found');
  if (note?.kind === 'file') throw new Error('Files cannot be edited as text');
  if (!note) {
    const title = input.title?.trim() || 'Notes';
    note = {
      id: randomUUID(), title, kind: input.kind ?? 'notes', round: input.round ?? 'before',
      date: input.date ?? now, author: input.author ?? 'you', file: noteFileName(process, title), bytes: 0,
    };
    process.notes.push(note);
  } else {
    if (input.title?.trim()) note.title = input.title.trim();
    if (input.kind) note.kind = input.kind;
    if (input.round) note.round = input.round;
  }
  note.bytes = writeNoteFile(process, note.file, input.body);
  process.updatedAt = now;
  return note;
}

export function setRound(index: InterviewsIndex, key: string, round: StoredRound, source?: ListingSource): StoredRound {
  const process = processForKey(index, key, source, true);
  const existing = process.rounds.find((r) => r.id === round.id);
  const next = { ...existing, ...Object.fromEntries(Object.entries(round).filter(([, v]) => v !== undefined)) } as StoredRound;
  process.rounds = [...process.rounds.filter((r) => r.id !== round.id), next];
  process.updatedAt = new Date().toISOString();
  return next;
}

export function addPerson(index: InterviewsIndex, key: string, person: { name: string; role?: string; email?: string }, source?: ListingSource) {
  const process = processForKey(index, key, source, true);
  const found = process.people.find((p) => p.name.toLowerCase() === person.name.toLowerCase());
  if (found) Object.assign(found, Object.fromEntries(Object.entries(person).filter(([, v]) => v)));
  else process.people.push(person);
  process.updatedAt = new Date().toISOString();
}

export function resolveFlag(index: InterviewsIndex, key: string, flagId: string, option: string) {
  const process = processForKey(index, key, undefined, false);
  const flag = process.flags?.find((f) => f.id === flagId);
  if (!flag) throw new Error('Flag not found');
  if (!flag.options.some((o) => o.label === option)) throw new Error('Pick one of the offered answers');
  flag.resolved = option;
  process.updatedAt = new Date().toISOString();
}

export const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function setDomain(index: InterviewsIndex, company: string, domain: string) {
  const clean = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!DOMAIN_RE.test(clean)) throw new Error(`Not a domain: ${domain}`);
  index.domains[company.trim().toLowerCase()] = clean;
  return clean;
}
