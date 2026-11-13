// Horizon: the home page's priority view. Tasks are sorted into zones by how soon they are due,
// from "holds" (overdue, clear these first) out to "orbit" (later). Shared by the API route and the client.
import type { Task } from '@/lib/types';
import { PERMANENT_TRACKS, trackFor, trackOrder, type WantTrack } from '@/lib/want-tracks';

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

// A want-to-do task under the sun: it has no date, so it sits in its section by how high it is in his queue.
export interface HorizonWant {
  id: string;
  short: string;
  title: string;
  label: string;
  track: string;          // the section it sits in: Recharge, Level Up, his own label, or Life
}

// One section under the sun. The permanent ones are listed even with nothing in them.
export interface HorizonWantTrack {
  name: string;
  about: string;          // what belongs in it; empty for his own labels and Life
  open: number;           // every open task in it, shown or not
  permanent: boolean;
}

// A daily task: it never comes due, so it rides on the ring around the sun instead of the zones.
export interface HorizonDaily {
  id: string;
  listType: 'have-to-do' | 'want-to-do';
  title: string;
  short: string;
  minutes: number | null;   // the length the task names ("30 minutes", "1 hour"), if any
  done: boolean;            // checked off today
}

export interface HorizonCleared {
  id: string;
  short: string;
  day: string;
}

export interface HorizonData {
  now: string;
  items: HorizonItem[];
  further: HorizonItem[];   // later tasks the outer ring has no room for; the pulled-back view shows them
  holds: HorizonItem[];
  undated: HorizonUndated[];
  wants: HorizonWant[];             // want-to-do tasks with no date, the top of each section
  wantTracks: HorizonWantTrack[];   // the sections under the sun, in the order drawn
  wantsBySection: Record<string, HorizonWant[]>;  // every section's open tasks in queue order, for its tray (capped)
  cleared: HorizonCleared[];
  dailies: HorizonDaily[];
  dailyWeek: number[];    // dailies checked off on each of the last 7 days, oldest first, today last
  hiddenStale: number;
  letGoThisWeek: number;
  bounds: { climb: number; altitude: number };   // hours from now to next Monday and the Monday after
}

const HOLD_WINDOW_DAYS = 7;       // overdue longer than this is treated as stale and left off the horizon
const HOLDS_MAX = 4;
const ORBIT_MAX = 6;              // keep the outer ring readable
const UNDATED_MAX = 8;
const WANTS_MAX = 12;             // under the sun, across every section
const WANT_TRACKS_MAX = 6;
const WANTS_BY_SECTION_MAX = 60;  // a section's tray; its track's open still counts them all
const OA_ASSUMED_WINDOW_DAYS = 3;

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayDiff(a: Date, b: Date): number {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 864e5);
}

export function parseDue(task: Task): Date | null {
  if (!task.dueDate) return null;
  const [y, m, d] = task.dueDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  const [hh, mm] = (task.dueTimeStart || '23:59').split(':').map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}

// OA tasks generated from employer email say "Deadline: not stated" and carry the invite time.
export function impliedOaDue(task: Task): Date | null {
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

export function fmtLeft(hours: number): string {
  const a = Math.abs(hours);
  const s = a < 36 ? `${Math.max(1, Math.round(a))}h` : `${Math.round(a / 24)}d`;
  return hours < 0 ? `${s} over` : s;
}

export function dayLabel(due: Date, now: Date, implied: boolean): string {
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
export function groupFor(text: string, label: string, listType: string): string {
  if (/\bOA\b|online assessment|take-home|interview|recruit|job application/i.test(text)) return GROUP_JOBS;
  if (label) return label;
  if (listType === 'want-to-do') return GROUP_LIFE;
  return GROUP_OTHER;
}

export function zoneFor(due: Date, hours: number, now: Date): HorizonZone {
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

const DURATION = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|minutes?|mins?)\b/i;

// "do 1 leetcode problem (1 hour)" -> "1 leetcode problem", 60 minutes;
// "work out for 10 minutes" -> "Work out", 10 minutes.
export function shortenDaily(text: string): { short: string; minutes: number | null } {
  const m = DURATION.exec(text);
  const minutes = m ? Math.round(Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1)) : null;
  const unit = String.raw`\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?)\b`;
  let short = text.trim()
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(new RegExp(String.raw`\s+for\s+${unit}`, 'i'), '')
    .replace(new RegExp(String.raw`^do\s+${unit}\s+of\s+`, 'i'), '')
    .replace(/^do\s+/i, '')
    .trim();
  if (short.length > 24) {
    // Cut at a word, and not on a dangling "or"/"of" ("Karpathy videos or Stanford CS336" -> "Karpathy videos…").
    const words = short.slice(0, 24).split(' ').slice(0, -1);
    while (words.length > 1 && /^(or|and|of|the|to|a|on|for|with)$/i.test(words[words.length - 1])) words.pop();
    short = `${words.join(' ')}…`;
  }
  return { short: short.charAt(0).toUpperCase() + short.slice(1), minutes };
}

// "1h 30m", "40m".
export function fmtMinutes(total: number): string {
  const h = Math.floor(total / 60), m = total % 60;
  return h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
}

export function weightFor(text: string, listType: string): number {
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
  currentWantToDoIds?: string[];  // his want-to-do queue, first is highest
  wantTracks?: readonly WantTrack[];
  completed: { id: string; text: string; completedAt?: string }[];
  letGoThisWeek?: number;
  dailyDoneByDay?: string[][];   // ids of dailies checked off on each of the last 7 days, oldest first
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
  const further: HorizonItem[] = [];
  const ringItems = items.filter((i) => {
    if (i.zone === 'hold') return false;
    if (i.zone === 'orbit') {
      orbitCount += 1;
      if (orbitCount > ORBIT_MAX) { further.push(i); return false; }
    }
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

  // Under the sun: want-to-do tasks with no date, by section. Each section shows the top of his queue (then the
  // list's own order), one from each section in turn until the room is used, so no section crowds out another.
  const tracks = input.wantTracks ?? PERMANENT_TRACKS;
  const queue = new Map((input.currentWantToDoIds ?? []).map((id, rank) => [id, rank]));
  const bySection = new Map<string, HorizonWant[]>();
  flatten(input.wantToDo).filter(pending).filter((t) => !t.dueDate && !datedIds.has(t.id))
    .map((t, index) => ({ t, index }))
    .sort((a, b) => (queue.get(a.t.id) ?? Infinity) - (queue.get(b.t.id) ?? Infinity) || a.index - b.index)
    .forEach(({ t }) => {
      const { short, label } = shortenTask(t.text);
      const track = trackFor(t, label, tracks);
      bySection.set(track, [...(bySection.get(track) ?? []), { id: t.id, short, title: t.text, label, track }]);
    });
  const sections = trackOrder(bySection.keys(), tracks).filter((name) => tracks.some((track) => track.name === name) || bySection.has(name)).slice(0, WANT_TRACKS_MAX);
  const wants: HorizonWant[] = [];
  for (let row = 0; wants.length < WANTS_MAX && sections.some((name) => (bySection.get(name)?.length ?? 0) > row); row += 1) {
    for (const name of sections) {
      const want = bySection.get(name)?.[row];
      if (want && wants.length < WANTS_MAX) wants.push(want);
    }
  }
  const wantTracks: HorizonWantTrack[] = sections.map((name) => {
    const track = tracks.find((candidate) => candidate.name === name);
    return { name, about: track?.about ?? '', open: bySection.get(name)?.length ?? 0, permanent: !!track };
  });
  const wantsBySection: Record<string, HorizonWant[]> = Object.fromEntries(sections.map((name) => [name, (bySection.get(name) ?? []).slice(0, WANTS_BY_SECTION_MAX)]));

  const weekAgo = now.getTime() - 7 * 864e5;
  const cleared: HorizonCleared[] = input.completed
    .filter((c) => c.completedAt && new Date(c.completedAt).getTime() >= weekAgo)
    .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''))
    .map((c) => ({ id: c.id, short: shortenTask(c.text).short, day: DAY[new Date(c.completedAt as string).getDay()] }));

  const doneByDay = input.dailyDoneByDay ?? [];
  const doneToday = new Set(doneByDay[doneByDay.length - 1] ?? []);
  const dailies: HorizonDaily[] = [];
  const addDaily = (t: Task, listType: HorizonDaily['listType']) => {
    const { short, minutes } = shortenDaily(t.text);
    dailies.push({ id: t.id, listType, title: t.text, short, minutes, done: doneToday.has(t.id) });
  };
  flatten(input.haveToDo).filter((t) => t.isDaily).forEach((t) => addDaily(t, 'have-to-do'));
  flatten(input.wantToDo).filter((t) => t.isDaily).forEach((t) => addDaily(t, 'want-to-do'));

  const today = startOfDay(now);
  const nextMonday = new Date(today.getTime() + (((8 - today.getDay()) % 7) || 7) * 864e5);
  const bounds = {
    climb: (nextMonday.getTime() - now.getTime()) / 36e5,
    altitude: (nextMonday.getTime() + 7 * 864e5 - now.getTime()) / 36e5,
  };
  return {
    now: now.toISOString(), items: ringItems, further, holds, undated, wants, wantTracks, wantsBySection, cleared,
    dailies, dailyWeek: doneByDay.map((ids) => ids.length),
    hiddenStale, letGoThisWeek: input.letGoThisWeek ?? 0, bounds,
  };
}

// The three answers the hero leads with.
export function horizonAnswers(data: HorizonData) {
  const next = data.items.find((i) => i.zone === 'ignition') || data.items[0] || null;
  const big = data.items.find((i) => i.weight >= 5 && i.hours > 0 && i.hours < 24 * 14) || null;
  return { next, big, holds: data.holds, cleared: data.cleared.length, letGo: data.letGoThisWeek };
}
