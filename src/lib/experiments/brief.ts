// An experiment as the task workspace reads it. Sunrise opens an experiment to the same workspace a task gets
// (the brief, the work surfaces, the chats with OpenClaw), so the workspace's services are told an experiment is
// there under the id "exp-<number>" and given its brief from the record. Experiments are not tasks: they are on
// no list, are never due and are never done or let go.
import type { BriefTaskRef, TaskBrief } from '../task-brief.ts';
import { readStore } from './store.ts';
import { readWriteup, writeupSummary } from './writeups.ts';
import { STATUS_WORDS, type Experiment } from './types.ts';

const PREFIX = 'exp-';
/** The id an experiment goes by in the workspace's stores (its work, its tabs, its chats). */
export const experimentTaskId = (id: string) => `${PREFIX}${id}`;
/** The experiment a workspace id names, or null when the id is a task's. */
export const experimentIdOf = (taskId: string) => (taskId.startsWith(PREFIX) && taskId.length > PREFIX.length ? taskId.slice(PREFIX.length) : null);

const clip = (text: string, limit: number) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= limit ? clean : `${clean.slice(0, limit - 1).trimEnd()}…`;
};
function find(taskId: string): { experiment: Experiment; all: Experiment[]; direction: string } | null {
  const id = experimentIdOf(taskId);
  if (id === null) return null;
  const store = readStore();
  const experiment = store.experiments.find((e) => e.id === id);
  if (!experiment) return null;
  return { experiment, all: store.experiments, direction: store.directions.find((d) => d.id === experiment.direction)?.name ?? 'Experiments' };
}

/** What the workspace's stores need to know an experiment is there: an id and its words. */
export function experimentRef(taskId: string): BriefTaskRef | null {
  const found = find(taskId);
  return found ? { task: { id: taskId, text: found.experiment.question }, listType: 'want-to-do' } : null;
}

/** The brief of an experiment: what it asked and found, its numbers, what it built on and led to, and his notes. */
export function experimentBrief(taskId: string, now = new Date()): TaskBrief | null {
  const found = find(taskId);
  if (!found) return null;
  const { experiment: e, all, direction } = found;
  const writeup = readWriteup(e.id);
  // What a chat is told of the experiment: his notes, kept short so the write-up after them is never the part cut.
  const told = [e.notes.trim().slice(0, 500), writeup ? writeupSummary(e.id, writeup) : ''].filter(Boolean).join('\n\n');
  const related = (other: Experiment, rel: string) => ({ taskId: experimentTaskId(other.id), short: clip(`${other.id} · ${other.question}`, 60), rel, day: other.day, state: 'done' as const, src: 'rule' as const });
  return {
    id: taskId, listType: 'want-to-do', kind: 'build', title: e.question, short: clip(e.question, 44), group: direction, course: null,
    when: { due: null, day: e.day, left: null, zone: 'undated', implied: false, where: null, note: null },
    stakes: e.answer || null,
    next: null,
    steps: [],
    facts: [
      { k: 'Experiment', v: `${e.id}, ${e.day}`, src: 'rule' },
      { k: 'Outcome', v: STATUS_WORDS[e.status], src: 'rule' },
      ...e.numbers.map((number, index) => ({ k: index === 0 ? 'Numbers' : '', v: number, src: 'rule' as const })),
    ],
    links: [],
    flags: e.flagged ? [{ level: 'info', text: 'You flagged this for follow-up.', src: 'rule' }] : [],
    related: [
      ...e.buildsOn.flatMap((id) => { const other = all.find((x) => x.id === id); return other ? [related(other, 'builds on')] : []; }),
      ...all.filter((other) => other.buildsOn.includes(e.id)).map((other) => related(other, 'led to')),
    ],
    runway: false,
    sections: [
      ...(e.details ? [{ title: 'Details', markdown: e.details, src: 'rule' as const }] : []),
      ...(e.notes.trim() ? [{ title: 'Your notes', markdown: e.notes, src: 'notes' as const }] : []),
    ],
    history: [], notesMarkdown: told || null, images: [], generatedAt: now.toISOString(), hook: null, agent: null,
  };
}
