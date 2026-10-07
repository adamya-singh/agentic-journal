// Horizon: the home page's priority view. Tasks are sorted into zones by how soon they are due,
// from "holds" (overdue, clear these first) out to "orbit" (later). Shared by the API route and the client.
import type { Task } from '@/lib/types';

export type HorizonZone = 'hold' | 'ignition' | 'climb' | 'altitude' | 'orbit';
export const HORIZON_RING_ZONES: Exclude<HorizonZone, 'hold'>[] = ['ignition', 'climb', 'altitude', 'orbit'];

export interface HorizonItem {
  id: string;
  listType: 'have-to-do' | 'want-to-do';
  title: string;
  short: string;
  label: string;
  group: string;          // the direction it sits in: a course, Jobs, Life or Other
  weight: number;
  due: string;            // ISO timestamp
  implied: boolean;       // due time assumed (OA invite + 3 days), not stated
  hours: number;          // hours until due; negative when overdue
  zone: HorizonZone;
  day: string;            // "Tomorrow", "Fri", "Mon Oct 26"
  left: string;           // "2d", "8h", "11d over"
}

export interface HorizonUndated {
  id: string;
  short: string;
  title: string;
  label: string;
}

export interface HorizonCleared {
  id: string;
  short: string;
  day: string;
}

export interface HorizonData {
  now: string;
  items: HorizonItem[];
  holds: HorizonItem[];
  undated: HorizonUndated[];
  cleared: HorizonCleared[];
  hiddenStale: number;
  letGoThisWeek: number;
  bounds: { climb: number; altitude: number };   // hours from now to next Monday and the Monday after
}

const HOLD_WINDOW_DAYS = 7;       // overdue longer than this is treated as stale and left off the horizon
const HOLDS_MAX = 4;
const ORBIT_MAX = 6;              // keep the outer ring readable
const UNDATED_MAX = 8;
const OA_ASSUMED_WINDOW_DAYS = 3;

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 864e5);
}

function parseDue(task: Task): Date | null {
  if (!task.dueDate) return null;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = (task.dueTimeStart || '23:59').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

// OA tasks generated from employer email say "Deadline: not stated" and carry the invite time.
function impliedOaDue(task: Task): Date | null {
  const notes = task.notesMarkdown || '';
  if (!/\*\*Deadline:\*\*\s*not stated/i.test(notes)) return null;
  const m = /\*\*Invited:\*\*\s*(?:\w{3},\s*)?(\w{3})\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(notes);
  if (!m) return null;
  const month = MON.findIndex((x) => x.toLowerCase() === m[1].toLowerCase());
  if (month < 0) return null;
  let hour = Number(m[4]) % 12;
  if (m[6].toUpperCase() === 'PM') hour += 12;
  const invited = new Date(Number(m[3]), month, Number(m[2]), hour, Number(m[5]));
  return new Date(invited.getTime() + OA_ASSUMED_WINDOW_DAYS * 864e5);
}

function fmtLeft(hours: number): string {
  const a = Math.abs(hours);
  const s = a < 36 ? `${Math.max(1, Math.round(a))}h` : `${Math.round(a / 24)}d`;
  return hours < 0 ? `${s} over` : s;
}

function dayLabel(due: Date, now: Date, implied: boolean): string {
  if (implied) return `assumed ${MON[due.getMonth()]} ${due.getDate()}`;
  const n = dayDiff(due, now);
  if (n === 0) return due.getHours() < 18 ? 'Today' : 'Tonight';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return DAY[due.getDay()];
  return `${DAY[due.getDay()]} ${MON[due.getMonth()]} ${due.getDate()}`;
}

export const GROUP_JOBS = 'Jobs', GROUP_LIFE = 'Life', GROUP_OTHER = 'Other';

// The direction a task points in: its course tag, or Jobs / Life / Other.
function groupFor(text: string, label: string, listType: string): string {
  if (/\bOA\b|online assessment|take-home|interview|recruit|job application/i.test(text)) return GROUP_JOBS;
  if (label) return label;
  if (listType === 'want-to-do') return GROUP_LIFE;
  return GROUP_OTHER;
}

function zoneFor(due: Date, hours: number, now: Date): HorizonZone {
  if (hours < 0) return 'hold';
  if (hours <= 48) return 'ignition';
  const today = startOfDay(now);
  const nextMonday = new Date(today.getTime() + (((8 - today.getDay()) % 7) || 7) * 864e5);
  if (due < nextMonday) return 'climb';
  if (due < new Date(nextMonday.getTime() + 7 * 864e5)) return 'altitude';
  return 'orbit';
}

// "[Stat Learning] Homework 2" -> label "Stat Learning", short "Stat Learning HW2".
export function shortenTask(text: string): { short: string; label: string } {
  let label = '';
  let rest = text.trim();
  const course = /^\[([^\]]+)\]\s*(.*)$/.exec(rest);
  if (course) { label = course[1].trim(); rest = course[2].trim(); }
  const oa = /^Complete\s+(.+?)\s+OA\b/i.exec(rest);
  if (oa) return { short: `${oa[1]} OA`, label: label || 'Jobs' };
  rest = rest
    .replace(/\s*[|–—-]\s+.*$/, '')
    .replace(/\s*\(.*?\)\s*$/, '')
    .replace(/^Catch up on\s+/i, '')
    .replace(/^(Prepare and finalize|Prepare|Submit|Complete|Finish|Watch)\s+/i, '')
    .replace(/["“”]/g, '')
    .replace(/\bHomework\s*(\d+)/i, 'HW$1')
    .replace(/\bIn Person Presentation\b/i, 'Presentation')
    .trim();
  const generic = /^(HW\d*|Midterm\b|Final\b|Quiz\b|Exam\b|Lab\b|Lecture\b|Presentation\b|Show & Tell\b|Module\b|Class\b|\d{1,2}\/\d{1,2}\b)/i.test(rest);
  let short = label && generic ? `${label} ${rest}` : rest;
  if (short.length > 26) {
    const cut = short.slice(0, 26);
    short = `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 14)).trimEnd()}…`;
  }
  short = short.charAt(0).toUpperCase() + short.slice(1);
  return { short, label: label || '' };
}

function weightFor(text: string, listType: string): number {
  if (listType === 'want-to-do') return 2;
  if (/\bOA\b|online assessment|take-home|midterm|final exam|\bexam\b/i.test(text)) return 5;
  if (/presentation|diploma|interview/i.test(text)) return 4;
  if (/homework|\bHW\b|assignment|lecture|notes/i.test(text)) return 3;
  return 3;
}

function flatten(tasks: Task[]): Task[] {
  const out: Task[] = [];
  const walk = (list: Task[]) => list.forEach((t) => { out.push(t); if (t.childTasks?.length) walk(t.childTasks); });
  walk(tasks);
  return out;
}

export interface HorizonInputs {
  haveToDo: Task[];
  wantToDo: Task[];
  currentHaveToDoIds: string[];
  completed: { id: string; text: string; completedAt?: string }[];
  letGoThisWeek?: number;
  now?: Date;
}

export function buildHorizon(input: HorizonInputs): HorizonData {
  const now = input.now ?? new Date();
  const items: HorizonItem[] = [];
  let hiddenStale = 0;
  const pending = (t: Task) => !t.completed && !t.isDaily;

  const add = (task: Task, listType: HorizonItem['listType']) => {
    let due = parseDue(task);
    let implied = false;
    if (!due && listType === 'have-to-do') {
      due = impliedOaDue(task);
      implied = !!due;
    }
    if (!due) return;
    const hours = (due.getTime() - now.getTime()) / 36e5;
    const weight = weightFor(task.text, listType);
    // A missed class attendance can't be cleared; old overdue items are stale unless they're high stakes.
    const stale = hours < -30 * 24 ||
      (hours < 0 && !implied && (/\battendance\b/i.test(task.text) || (hours < -HOLD_WINDOW_DAYS * 24 && weight < 5)));
    if (stale) { hiddenStale += 1; return; }
    const { short, label } = shortenTask(task.text);
    items.push({
      id: task.id,
      listType,
      title: task.text,
      short,
      label: label || (listType === 'want-to-do' ? 'Want to do' : ''),
      group: groupFor(task.text, label, listType),
      weight,
      due: due.toISOString(),
      implied,
      hours,
      zone: zoneFor(due, hours, now),
      day: dayLabel(due, now, implied),
      left: fmtLeft(hours),
    });
  };
  flatten(input.haveToDo).filter(pending).forEach((t) => add(t, 'have-to-do'));
  flatten(input.wantToDo).filter(pending).forEach((t) => add(t, 'want-to-do'));

  // Untagged tasks that name a course ("…with Regression notes") point in that course's direction.
  const courses = [...new Set(items.map((i) => i.label).filter((l) => l && l !== 'Want to do'))];
  items.forEach((i) => {
    if (i.group !== GROUP_OTHER) return;
    const hit = courses.find((c) => i.title.toLowerCase().includes(c.toLowerCase()));
    if (hit) i.group = hit;
  });

  items.sort((a, b) => a.hours - b.hours);
  const holds = items
    .filter((i) => i.zone === 'hold')
    .sort((a, b) => b.weight - a.weight || b.hours - a.hours)
    .slice(0, HOLDS_MAX);
  let orbitCount = 0;
  const ringItems = items.filter((i) => {
    if (i.zone === 'hold') return false;
    if (i.zone === 'orbit') { orbitCount += 1; return orbitCount <= ORBIT_MAX; }
    return true;
  });

  // Undated: whatever is queued in Current with no due date, in the order ranked there.
  const datedIds = new Set(items.map((i) => i.id));
  const byId = new Map(flatten(input.haveToDo).map((t) => [t.id, t]));
  const undated: HorizonUndated[] = [];
  for (const id of input.currentHaveToDoIds) {
    const t = byId.get(id);
    if (!t || !pending(t) || datedIds.has(id) || t.dueDate) continue;
    const { short, label } = shortenTask(t.text);
    undated.push({ id, short, title: t.text, label });
    if (undated.length >= UNDATED_MAX) break;
  }

  const weekAgo = now.getTime() - 7 * 864e5;
  const cleared: HorizonCleared[] = input.completed
    .filter((c) => c.completedAt && new Date(c.completedAt).getTime() >= weekAgo)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .map((c) => ({ id: c.id, short: shortenTask(c.text).short, day: DAY[new Date(c.completedAt as string).getDay()] }));

  const today = startOfDay(now);
  const nextMonday = new Date(today.getTime() + (((8 - today.getDay()) % 7) || 7) * 864e5);
  const bounds = {
    climb: (nextMonday.getTime() - now.getTime()) / 36e5,
    altitude: (nextMonday.getTime() + 7 * 864e5 - now.getTime()) / 36e5,
  };
  return { now: now.toISOString(), items: ringItems, holds, undated, cleared, hiddenStale, letGoThisWeek: input.letGoThisWeek ?? 0, bounds };
}

// The three answers the hero leads with.
export function horizonAnswers(data: HorizonData) {
  const next = data.items.find((i) => i.zone === 'ignition') || data.items[0] || null;
  const big = data.items.find((i) => i.weight >= 5 && i.hours > 0 && i.hours < 24 * 14) || null;
  return { next, big, holds: data.holds, cleared: data.cleared.length, letGo: data.letGoThisWeek };
}
