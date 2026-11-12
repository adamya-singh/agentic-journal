import fs from 'fs';
import path from 'path';
import { jobsDataDir, writeJsonFileAtomic } from '@/lib/backend-data';
import type { InterviewProcess, InterviewsIndex, StoredNote } from './types';

// interviews/index.json holds every process; each process keeps its notes in
// interviews/<season>/<slug>/. Kept out of applications.json, which the
// application worker rewrites under a lock every minute.
export const interviewsDir = () => path.join(jobsDataDir(), 'interviews');
const indexFile = () => path.join(interviewsDir(), 'index.json');
export const logosDir = () => path.join(interviewsDir(), 'logos');

export const EMPTY_INDEX: InterviewsIndex = { version: 1, processes: [], questions: [], lessons: [], domains: {} };

export function readInterviews(): InterviewsIndex {
  try {
    const raw = JSON.parse(fs.readFileSync(indexFile(), 'utf8')) as Partial<InterviewsIndex>;
    return {
      version: 1,
      processes: raw.processes ?? [],
      questions: raw.questions ?? [],
      lessons: raw.lessons ?? [],
      domains: raw.domains ?? {},
    };
  } catch {
    return structuredClone(EMPTY_INDEX);
  }
}

/** Serializes writers across Next workers and the CLI; a stale lock is cleared after 2 minutes. */
export async function mutateInterviews<T>(run: (index: InterviewsIndex) => T | Promise<T>): Promise<T> {
  fs.mkdirSync(interviewsDir(), { recursive: true });
  const lock = path.join(interviewsDir(), '.index.lock');
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs > 120_000) fs.unlinkSync(lock);
    } catch {}
    try {
      const fd = fs.openSync(lock, 'wx');
      try {
        const index = readInterviews();
        const result = await run(index);
        writeJsonFileAtomic(indexFile(), index);
        return result;
      } finally {
        fs.closeSync(fd);
        try { fs.unlinkSync(lock); } catch {}
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || attempt > 40) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export const slugify = (value: string) =>
  value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'process';

/** Recruiting seasons run May 1 to April 30: Oct 2025 and Mar 2026 are both 2025-26. */
export function seasonFor(iso: string | undefined, now = new Date()): string {
  const date = iso ? new Date(iso) : now;
  const d = Number.isNaN(date.getTime()) ? now : date;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric' })
    .formatToParts(d);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  const start = month >= 5 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function processDir(process: Pick<InterviewProcess, 'id'>) {
  // ids are "<season>/<slug>"; refuse anything that could walk out of the folder.
  if (!/^\d{4}-\d{2}\/[a-z0-9-]+$/.test(process.id)) throw new Error(`Bad process id: ${process.id}`);
  return path.join(interviewsDir(), process.id);
}

export function readNoteBody(process: InterviewProcess, note: StoredNote): string {
  if (note.kind === 'file') return '';
  return fs.readFileSync(path.join(processDir(process), path.basename(note.file)), 'utf8');
}

export function writeNoteFile(process: InterviewProcess, file: string, body: string | Buffer): number {
  const dir = processDir(process);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, path.basename(file));
  const tmp = `${target}.${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, target);
  return fs.statSync(target).size;
}

/** A file name for a new note that doesn't collide with existing ones. */
export function noteFileName(process: InterviewProcess, title: string, ext = 'md') {
  const base = slugify(title);
  const taken = new Set(process.notes.map((n) => n.file));
  let name = `${base}.${ext}`;
  for (let i = 2; taken.has(name); i += 1) name = `${base}-${i}.${ext}`;
  return name;
}
