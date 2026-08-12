import * as fs from 'fs';
import * as path from 'path';
import { NextResponse } from 'next/server';
import { journalDataDir } from '@/lib/backend-data';
import { normalizeProjectList } from '@/lib/projects';
import type { ListType } from '@/lib/types';
import type { LibraryJournalUnit, LibraryTaskRow } from '@/lib/library/types';
import { readGeneralTasks, readCompletedTaskIndex } from '../../tasks/today/today-store-utils';
import { readCurrentTaskIds } from '../../tasks/current/current-store-utils';
import { readMiscTasks } from '../../tasks/misc/misc-store-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Strictly read-only aggregation for the Library page. Deliberately avoids
// POST /api/journal/read (which write-syncs plan lifecycle per date) and
// getValidatedCurrentTaskIds (which rewrites the store on read).

const DATE_FILE_REGEX = /^\d{4}-\d{2}-\d{2}\.json$/;
const LIST_TYPES: ListType[] = ['have-to-do', 'want-to-do'];

export async function GET() {
  try {
    const tasks: LibraryTaskRow[] = [];
    const taskTextById = new Map<string, string>();
    const projectSlugs = new Set<string>();

    // Open general tasks (with Current rank overlay)
    const generalIds = new Set<string>();
    for (const listType of LIST_TYPES) {
      const currentIds = readCurrentTaskIds(listType);
      const rankById = new Map(currentIds.map((id, index) => [id, index]));
      for (const task of readGeneralTasks(listType).tasks) {
        if (typeof task.id !== 'string' || typeof task.text !== 'string') continue;
        generalIds.add(task.id);
        taskTextById.set(task.id, task.text);
        for (const slug of normalizeProjectList(task.projects)) projectSlugs.add(slug);
        tasks.push({
          id: task.id,
          source: 'general',
          listType,
          text: task.text,
          completed: false,
          dueDate: task.dueDate,
          dueTimeStart: task.dueTimeStart,
          dueTimeEnd: task.dueTimeEnd,
          notesMarkdown: task.notesMarkdown,
          projects: task.projects,
          parentTaskId: task.parentTaskId,
          isDaily: task.isDaily,
          currentRank: rankById.get(task.id),
        });
      }
    }

    // Misc notes
    for (const task of readMiscTasks().tasks) {
      if (typeof task.id !== 'string' || typeof task.text !== 'string') continue;
      taskTextById.set(task.id, task.text);
      tasks.push({
        id: task.id,
        source: 'misc',
        listType: 'misc-notes',
        text: task.text,
        completed: false,
        notesMarkdown: task.notesMarkdown,
      });
    }

    // Completed index; daily tasks also live in general — merge instead of duplicating
    const completedIndex = readCompletedTaskIndex();
    const rowById = new Map(tasks.map((row) => [row.id, row]));
    for (const snapshot of Object.values(completedIndex.tasks)) {
      if (!snapshot || typeof snapshot.id !== 'string') continue;
      taskTextById.set(snapshot.id, snapshot.text);
      for (const slug of normalizeProjectList(snapshot.projects)) projectSlugs.add(slug);
      if (generalIds.has(snapshot.id)) {
        const row = rowById.get(snapshot.id);
        if (row) {
          row.completed = true;
          row.completedAt = snapshot.completedAt;
        }
        continue;
      }
      tasks.push({
        id: snapshot.id,
        source: 'completed',
        listType: snapshot.listType,
        text: snapshot.text,
        completed: true,
        completedAt: snapshot.completedAt,
        sourceDate: snapshot.sourceDate,
        dueDate: snapshot.dueDate,
        dueTimeStart: snapshot.dueTimeStart,
        dueTimeEnd: snapshot.dueTimeEnd,
        notesMarkdown: snapshot.notesMarkdown,
        projects: snapshot.projects,
        parentTaskId: snapshot.parentTaskId,
        isDaily: snapshot.isDaily,
      });
    }

    const journal = loadJournalUnits(taskTextById);

    return NextResponse.json({
      success: true,
      tasks,
      journal,
      projects: [...projectSlugs].sort(),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error building library list:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

function loadJournalUnits(taskTextById: Map<string, string>): LibraryJournalUnit[] {
  const units: LibraryJournalUnit[] = [];
  const dir = journalDataDir();
  if (!fs.existsSync(dir)) {
    return units;
  }

  for (const name of fs.readdirSync(dir).sort()) {
    if (!DATE_FILE_REGEX.test(name)) continue;
    const date = name.slice(0, 10);
    let file: Record<string, unknown>;
    try {
      file = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
    } catch (error) {
      console.error(`Skipping unreadable journal file ${name}:`, error);
      continue;
    }
    if (!file || typeof file !== 'object') continue;

    for (const [key, slot] of Object.entries(file)) {
      if (key === 'ranges' || key === 'staged' || key === 'indicators') continue;
      const entries = Array.isArray(slot) ? slot : [slot];
      for (const entry of entries) {
        const unit = normalizeEntry(entry, date, taskTextById, { hour: key });
        if (unit) units.push(unit);
      }
    }

    const ranges = Array.isArray((file as { ranges?: unknown }).ranges)
      ? ((file as { ranges: unknown[] }).ranges)
      : [];
    for (const entry of ranges) {
      const record = entry as { start?: unknown; end?: unknown };
      if (typeof record.start !== 'string' || typeof record.end !== 'string') continue;
      const unit = normalizeEntry(entry, date, taskTextById, {
        range: { start: record.start, end: record.end },
      });
      if (unit) units.push(unit);
    }
  }

  return units;
}

function normalizeEntry(
  entry: unknown,
  date: string,
  taskTextById: Map<string, string>,
  position: { hour?: string; range?: { start: string; end: string } },
): LibraryJournalUnit | null {
  if (entry === null || entry === undefined) return null;

  // Legacy plain-string entries are logged text
  if (typeof entry === 'string') {
    const text = entry.trim();
    if (!text) return null;
    return { date, ...position, entryMode: 'logged', text };
  }
  if (typeof entry !== 'object') return null;

  const record = entry as {
    entryMode?: unknown;
    text?: unknown;
    taskId?: unknown;
    listType?: unknown;
    taskText?: unknown;
    planStatus?: unknown;
    completed?: unknown;
    sourceRefs?: unknown;
  };

  const entryMode = record.entryMode === 'planned' ? 'planned' : 'logged';
  let text: string | undefined;
  let taskId: string | undefined;
  let listType: ListType | undefined;

  if (typeof record.text === 'string' && record.text.trim()) {
    text = record.text.trim();
  }
  if (typeof record.taskId === 'string') {
    taskId = record.taskId;
    listType = record.listType === 'want-to-do' ? 'want-to-do' : 'have-to-do';
    if (!text) {
      text =
        taskTextById.get(taskId) ??
        (typeof record.taskText === 'string' && record.taskText.trim()
          ? record.taskText.trim()
          : '[Task not found]');
    }
  }
  if (!text) return null;

  const omiRefs = Array.isArray(record.sourceRefs)
    ? record.sourceRefs
        .filter(
          (ref): ref is { source: string; transcriptDate: string; segmentId: string } =>
            !!ref &&
            typeof ref === 'object' &&
            (ref as { source?: unknown }).source === 'omi-transcript' &&
            typeof (ref as { transcriptDate?: unknown }).transcriptDate === 'string' &&
            typeof (ref as { segmentId?: unknown }).segmentId === 'string',
        )
        .map((ref) => ({ transcriptDate: ref.transcriptDate, segmentId: ref.segmentId }))
    : [];

  return {
    date,
    ...position,
    entryMode,
    planStatus: typeof record.planStatus === 'string' ? record.planStatus : undefined,
    completed: record.completed === true || undefined,
    text,
    taskId,
    listType,
    omiRefs: omiRefs.length > 0 ? omiRefs : undefined,
  };
}
