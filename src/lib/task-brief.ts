// Task brief: everything the Journal knows about one task, organized so it can be started from the Horizon.
// Built on request from the task, its notes, the other tasks in its course or group, its journal history and,
// for online assessments, the job posting it came from. Pure, so the API route and tests share it.
import type { JobListing, Task } from '@/lib/types';
import {
  dayLabel,
  fmtLeft,
  groupFor,
  impliedOaDue,
  parseDue,
  shortenTask,
  zoneFor,
  GROUP_JOBS,
  GROUP_LIFE,
  GROUP_OTHER,
  type HorizonZone,
} from '@/lib/horizon';

// 'web' and 'agent' only come from OpenClaw's fill (see brief-agent.ts): 'agent' marks an inference, not something read.
export type BriefSource = 'task' | 'notes' | 'canvas' | 'email' | 'jobs' | 'journal' | 'rule' | 'web' | 'agent';
export type BriefKind =
  | 'assessment' | 'exam' | 'assignment' | 'catch-up' | 'presentation' | 'reading' | 'build' | 'errand' | 'plan' | 'task';
export type BriefLinkKind = 'start' | 'canvas' | 'slides' | 'email' | 'posting' | 'app' | 'link';
export type BriefRelState = 'done' | 'open' | 'over' | 'target';

// `oc` marks a line OpenClaw added (brief-agent.ts) rather than the rules.
export interface BriefFact { k: string; v: string; src: BriefSource; oc?: true }
export interface BriefLink { label: string; href: string; kind: BriefLinkKind; src: BriefSource; oc?: true }
export interface BriefStep { text: string; done: boolean; href?: string; src: BriefSource; oc?: true }
/** A one-press fix OpenClaw suggests alongside a flag; always confirmed before it runs. */
export type BriefActionSpec =
  | { kind: 'plan'; label: string; date: string; start: string; end?: string }
  | { kind: 'add-task'; label: string; text: string; listType: 'have-to-do' | 'want-to-do'; dueDate?: string; dueTimeStart?: string; notesMarkdown?: string }
  | { kind: 'set-due'; label: string; dueDate: string; dueTimeStart?: string }
  | { kind: 'save-notes'; label: string; markdown: string }
  | { kind: 'merge'; label: string; taskIds: string[]; titles: string[]; listTypes: ('have-to-do' | 'want-to-do')[] };
export type BriefAction = BriefActionSpec & { id: string; done: boolean };
export interface BriefFlag { level: 'warn' | 'info' | 'gap'; text: string; src: BriefSource; action?: BriefAction; oc?: true }
export interface BriefRelated { taskId: string; short: string; rel: string; day: string; state: BriefRelState; src: BriefSource; oc?: true }
export interface BriefSection { title: string; markdown: string; src: BriefSource; oc?: true }
export interface BriefHistory { when: string; text: string; src: BriefSource }

export interface TaskBrief {
  id: string;
  listType: 'have-to-do' | 'want-to-do';
  kind: BriefKind;
  title: string;
  short: string;
  group: string;
  course: { name: string; code?: string; canvas?: string } | null;
  when: {
    due: string | null;          // ISO
    day: string;                 // "Tomorrow", "Thu Oct 15", "No date"
    left: string | null;         // "2d", "5d over"
    zone: HorizonZone | 'undated';
    implied: boolean;            // assumed, not stated
    where: string | null;        // room and time window
    whereOc?: true;              // the room/time came from OpenClaw
    note: string | null;         // why the date is what it is
  };
  stakes: string | null;         // one line: what it is and why it matters
  stakesOc?: true;               // the stakes line came from OpenClaw
  next: { label: string; detail: string | null; href?: string; taskId?: string; src: BriefSource; oc?: true } | null;
  steps: BriefStep[];
  facts: BriefFact[];
  links: BriefLink[];
  flags: BriefFlag[];
  related: BriefRelated[];
  runway: boolean;               // draw related as the prep timeline before an exam
  sections: BriefSection[];
  history: BriefHistory[];
  notesMarkdown: string | null;
  generatedAt: string;
  agent: BriefAgentStatus | null;  // OpenClaw's background fill for this task, when there is one
}

export interface BriefAgentStatus {
  status: 'queued' | 'running' | 'done' | 'failed';
  finishedAt: string | null;
  summary: string | null;          // what it read, in one line
  error: string | null;
}

export interface BriefTaskRef { task: Task; listType: 'have-to-do' | 'want-to-do' }

export interface JournalTaskEntry {
  date: string;                  // YYYY-MM-DD
  hour: string;                  // "11pm", or "2pm–4pm" for a range
  entryMode: string;             // planned | logged
  planStatus?: string;           // active | missed | completed
  autoPlanned?: boolean;
}

export interface BriefJobContext {
  listing: JobListing | null;
  submittedAt?: string | null;
}

export interface BriefInputs {
  taskId: string;
  tasks: BriefTaskRef[];         // every pending task, both lists, flattened
  completed: { id: string; text: string; completedAt?: string }[];
  journal: JournalTaskEntry[];   // entries that point at this task
  job?: BriefJobContext | null;
  now?: Date;
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CANVAS = 'https://rutgers.instructure.com';

function fmtDay(d: Date): string { return `${DAY[d.getDay()]} ${MON[d.getMonth()]} ${d.getDate()}`; }
function fmtTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m || 0).padStart(2, '0')} ${ap}`;
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromYmd(s: string): Date { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }

// ───────────── notes parsing ─────────────

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ',
  sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', chi: 'χ', pi: 'π', rho: 'ρ', omega: 'ω', eta: 'η', nabla: '∇',
};
const SUP: Record<string, string> = { T: 'ᵀ', '-1': '⁻¹', '2': '²', '3': '³', n: 'ⁿ', '*': '*' };

/** Turn the simple LaTeX the triage notes use into readable text: $\hat{\boldsymbol{\beta}} = (\mathbf{X}^T \mathbf{X})^{-1}$ → β̂ = (XᵀX)⁻¹. */
export function latexToText(md: string): string {
  return md.replace(/\$\$?([^$]+)\$\$?/g, (_, expr: string) => {
    let s = expr;
    for (let i = 0; i < 4; i += 1) {
      s = s
        .replace(/\\(?:mathbf|boldsymbol|mathrm|text|textbf|mathit|operatorname)\{([^{}]*)\}/g, '$1')
        .replace(/\\hat\{([^{}]*)\}/g, '$1̂')
        .replace(/\\bar\{([^{}]*)\}/g, '$1̄')
        .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2');
    }
    s = s
      .replace(/\\([A-Za-z]+)/g, (m, name: string) => GREEK[name] ?? ({ dots: '…', ldots: '…', cdots: '⋯', times: '×', cdot: '·', le: '≤', ge: '≥', neq: '≠', approx: '≈', sim: '~', sum: 'Σ', quad: ' ', left: '', right: '' } as Record<string, string>)[name] ?? m)
      .replace(/\^\{([^{}]*)\}/g, (m, x: string) => SUP[x] ?? `^${x}`)
      .replace(/\^(\S)/g, (m, x: string) => SUP[x] ?? m)
      .replace(/_\{([^{}]*)\}/g, '_$1')
      .replace(/\s*([=+])\s*/g, ' $1 ')
      .replace(/([A-Za-zα-ω̂ᵀ⁻¹)]) (?=[A-Z(α-ω])/g, '$1')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return s;
  });
}

const LINK_RE = /\[([^\]]+)\]\(<?([^)>\s]+)>?\)/g;
const stripLinks = (s: string) => s.replace(LINK_RE, '$1');
const stripEmoji = (s: string) => s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2753}]️?/gu, '').trim();
const clean = (s: string) => latexToText(stripEmoji(stripLinks(s))).replace(/\*\*/g, '').replace(/[`_]/g, '').trim();

function linkKind(href: string, label: string, key: string): BriefLinkKind {
  if (/^\/jobs\?application=/.test(href)) return 'app';
  if (/mail\.google\.com/.test(href)) return 'email';
  if (/start|open the oa|assessment/i.test(key) || /open the oa/i.test(label)) return 'start';
  if (/posting/i.test(key) || /ashbyhq|greenhouse|lever\.co|workday|jobs\./i.test(href) && /posting/i.test(label)) return 'posting';
  if (/\.pptx?\b|\.pdf\b|slides/i.test(label) || /\/modules\/items\//.test(href)) return 'slides';
  if (/instructure\.com/.test(href)) return 'canvas';
  return 'link';
}

// "Tue, Sep 22, 2026, 7:47 AM EDT" → "Tue Sep 22, 7:47 AM"; "2026-10-09 (…)" → "Fri Oct 9".
function tidyFactValue(v: string): string {
  const stamp = /^(\w{3}),\s*(\w{3})\s+(\d{1,2}),\s*\d{4},\s*(\d{1,2}:\d{2}\s*[AP]M)(?:\s*[A-Z]{2,4})?$/.exec(v);
  if (stamp) return `${stamp[1]} ${stamp[2]} ${stamp[3]}, ${stamp[4]}`;
  const iso = /^(\d{4}-\d{2}-\d{2})\b/.exec(v);
  if (iso) return fmtDay(fromYmd(iso[1]));
  return v;
}

const GENERIC_LABEL = /^(open( the)? (oa|application|in gmail|in agentic journal)|job posting|link|here|open)$/i;

export interface ParsedNotes {
  intro: string;
  facts: BriefFact[];
  links: BriefLink[];
  steps: BriefStep[];
  sections: BriefSection[];
}

/** Read the structure the Journal's own writers use: "- **Key:** value" facts, markdown links, "- [ ]" checklists, "## Heading" or "**Heading**" sections. */
export function parseNotes(notes: string): ParsedNotes {
  const facts: BriefFact[] = [];
  const links: BriefLink[] = [];
  const steps: BriefStep[] = [];
  const sections: BriefSection[] = [];
  const seen = new Set<string>();
  const addLink = (label: string, href: string, key: string, src: BriefSource) => {
    if (seen.has(href) || /^#/.test(href)) return;
    seen.add(href);
    const kind = linkKind(href, label, key);
    let name = clean(label);
    if (GENERIC_LABEL.test(name) || !name) name = key || name || href;
    links.push({ label: name, href, kind, src });
  };
  const src: BriefSource = /Filled in from employer emails/i.test(notes) ? 'email' : 'notes';

  let title = '';
  let body: string[] = [];
  const intro: string[] = [];
  const flush = () => {
    const md = latexToText(body.join('\n')).trim();
    if (title) {
      if (!/checklist/i.test(title) && !/^materials|source links/i.test(title) && md) sections.push({ title, markdown: md, src });
    } else if (md) intro.push(md);
    body = [];
  };
  for (const raw of notes.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    const h = /^#{1,3}\s+(.+)$/.exec(line) || /^\*\*([^*]+)\*\*$/.exec(line.trim());
    if (h) { flush(); title = clean(h[1]); continue; }
    if (/^_.*_$/.test(line.trim())) continue;                      // "_Filled in from employer emails…_"
    const fact = /^- \*\*([^*]+?):\*\*\s*(.+)$/.exec(line);
    if (fact && !title) {
      const key = fact[1].trim();
      const value = fact[2].trim();
      const only = /^\[([^\]]+)\]\(<?([^)>\s]+)>?\)$/.exec(value);
      if (only) { addLink(only[1], only[2], key, src); continue; }
      facts.push({ k: key, v: tidyFactValue(clean(value)), src });
      for (const m of value.matchAll(LINK_RE)) addLink(m[1], m[2], key, src);
      continue;
    }
    const check = /^\s*- \[( |x|X)\]\s+(.+)$/.exec(line);
    if (check) {
      const first = LINK_RE.exec(check[2]); LINK_RE.lastIndex = 0;
      steps.push({ text: clean(check[2]), done: check[1] !== ' ', ...(first ? { href: first[2] } : {}), src });
    }
    // Links anywhere: label an email link by the bold lead of its line ("**Invitation** · …").
    for (const m of line.matchAll(LINK_RE)) {
      const lead = /^\s*- \*\*([^*]+)\*\*/.exec(line);
      const before = clean(line.slice(0, m.index).replace(/^\s*[-*]\s*/, '')).replace(/[:\s—–-]+$/, '');
      const key = /mail\.google/.test(m[2]) && lead ? `${clean(lead[1])} email` : before.length > 3 && before.length < 90 ? before : '';
      addLink(m[1], m[2], key, src);
    }
    body.push(line);
  }
  flush();
  return { intro: intro.join('\n\n').trim(), facts, links, steps, sections };
}

// ───────────── classification ─────────────

export function briefKind(text: string, listType: string): BriefKind {
  if (/\bOA\b|online assessment|take-home|coding challenge/i.test(text)) return 'assessment';
  if (/midterm|final exam|\bexam\b|\bquiz\b/i.test(text)) return 'exam';
  if (/catch up|\(missed\)|skipped class|review .*lecture/i.test(text)) return 'catch-up';
  if (/presentation|show & tell|\btalk\b/i.test(text)) return 'presentation';
  if (/homework|\bHW\d*\b|\blab\b|assignment|activity|hypothesis|feedback|\bpart \d|discussion|essay|report/i.test(text)) return 'assignment';
  if (/\bread\b|paper|chapter|book/i.test(text)) return 'reading';
  if (/^(buy|order|get|pick up)\b/i.test(text)) return 'errand';
  if (/build|design|implement|update|fix|set up|setup|refactor|deploy/i.test(text)) return 'build';
  if (listType === 'want-to-do') return 'plan';
  return 'task';
}

const STOP = new Set(['the', 'and', 'for', 'with', 'prepare', 'finalize', 'complete', 'submit', 'finish', 'class', 'in', 'on', 'of', 'to', 'a', 'an', 'my', 'do']);
function tokens(text: string): Set<string> {
  const body = text.replace(/^\[[^\]]+\]\s*/, '').toLowerCase().replace(/&/g, ' ');
  return new Set(body.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)));
}
const norm = (s: string) => s.replace(/^\[[^\]]+\]\s*/, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ───────────── the brief ─────────────

interface Placed { ref: BriefTaskRef; short: string; label: string; group: string; due: Date | null; implied: boolean; hours: number }

function place(ref: BriefTaskRef, now: Date): Placed {
  const { task, listType } = ref;
  let due = parseDue(task);
  let implied = false;
  if (!due && listType === 'have-to-do') { due = impliedOaDue(task); implied = !!due; }
  const { short, label } = shortenTask(task.text);
  return {
    ref, short, label, group: groupFor(task.text, label, listType), due, implied,
    hours: due ? (due.getTime() - now.getTime()) / 36e5 : Infinity,
  };
}

function relDay(p: Placed, now: Date): string {
  return p.due ? dayLabel(p.due, now, p.implied) : 'No date';
}

export function buildTaskBrief(input: BriefInputs): TaskBrief | null {
  const now = input.now ?? new Date();
  const placed = input.tasks.map((r) => place(r, now));
  // Untagged tasks that name a course point in that course's direction, as on the Horizon.
  const courses = [...new Set(placed.map((p) => p.label).filter((l) => l && l !== GROUP_JOBS))];
  placed.forEach((p) => {
    if (p.group !== GROUP_OTHER) return;
    const hit = courses.find((c) => p.ref.task.text.toLowerCase().includes(c.toLowerCase()));
    if (hit) p.group = hit;
  });
  const me = placed.find((p) => p.ref.task.id === input.taskId);
  if (!me) return null;
  const { task, listType } = me.ref;
  const notes = task.notesMarkdown?.trim() || '';
  const parsed = parseNotes(notes);
  const kind = briefKind(task.text, listType);
  const isCourse = ![GROUP_JOBS, GROUP_LIFE, GROUP_OTHER].includes(me.group);

  // Course: the [Label], its Canvas course from any task in the same course, its code from triage notes.
  let course: TaskBrief['course'] = null;
  if (isCourse) {
    course = { name: me.group };
    for (const p of placed.filter((x) => x.group === me.group)) {
      const n = p.ref.task.notesMarkdown || '';
      const c = /instructure\.com\/courses\/(\d+)/.exec(n);
      if (c && !course.canvas) course.canvas = `${CANVAS}/courses/${c[1]}`;
      const code = /Course:\s*[^(\n]*\((\d{2}:\d{3}:\d{3}(?::\d{2})?)\)/.exec(n);
      if (code && !course.code) course.code = code[1];
    }
  }

  // When and where.
  const zone: TaskBrief['when']['zone'] = me.due ? zoneFor(me.due, me.hours, now) : 'undated';
  const room = /\b([A-Z]{2,4}-\d{2,4}[A-Z]?)\b(?:\s*\(([^)]+)\))?/.exec(notes);
  let where: string | null = null;
  if (task.dueTimeStart && task.dueTimeEnd) where = `${fmtTime(task.dueTimeStart)}–${fmtTime(task.dueTimeEnd)}`;
  if (room) where = [room[1] + (room[2] && /campus/i.test(room[2]) ? `, ${room[2].replace(/\s*campus/i, '')}` : ''), where].filter(Boolean).join(' · ');
  let whenNote: string | null = null;
  if (me.implied && me.due) {
    whenNote = `The invite gave no deadline. The Horizon assumes 3 days after the invite: ${fmtDay(me.due)}.`;
  } else {
    const dl = /- \*\*Deadline:\*\*\s*(.+)/.exec(notes);
    if (dl && /no clock time/i.test(dl[1]) && me.due) whenNote = `No clock time was given, so this assumes 11:59 PM on ${fmtDay(me.due)}.`;
  }

  // Facts: the notes' own key/value lines, plus due and course facts.
  const facts: BriefFact[] = [];
  if (me.due && kind !== 'assessment') {
    const t = task.dueTimeStart ? `, ${fmtTime(task.dueTimeStart)}` : '';
    facts.push({ k: kind === 'exam' || kind === 'presentation' ? 'When' : 'Due', v: `${fmtDay(me.due)}${t}`, src: 'task' });
  }
  for (const f of parsed.facts) {
    if (/^deadline$/i.test(f.k) && me.due) { facts.push({ k: 'Deadline', v: f.v, src: f.src }); continue; }
    if (/^(course|date\/time|attendance)$/i.test(f.k) && kind !== 'catch-up') continue;
    facts.push(f);
  }

  // Job context for online assessments.
  const sections: BriefSection[] = [];
  const history: BriefHistory[] = [];
  const listing = input.job?.listing ?? null;
  if (listing) {
    if (listing.salary) facts.push({ k: 'Pay', v: listing.salary, src: 'jobs' });
    if (listing.location) facts.push({ k: 'Location', v: listing.location, src: 'jobs' });
    const about = [listing.companySummary, listing.notes].filter(Boolean).join('\n\n')
      .replace(/\bPros:\s*/, '**Pros** ').replace(/\s*\bCons:\s*/, '\n\n**Cons** ');
    if (about) sections.push({ title: `About ${listing.company}`, markdown: about, src: 'jobs' });
    if (input.job?.submittedAt) history.push({ when: fmtDay(new Date(input.job.submittedAt)), text: 'Applied', src: 'jobs' });
  }
  sections.push(...parsed.sections);

  // Steps: checklist lines, then subtasks.
  const steps: BriefStep[] = [...parsed.steps];
  (task.childTasks || []).forEach((c) => steps.push({ text: c.text, done: !!c.completed, src: 'task' }));

  // Exams: what the course's other notes say about this exam (Canvas announcements copied in by triage).
  const courseNotes: string[] = [];
  if (kind === 'exam' && isCourse) {
    const fold = (x: string) => norm(x).replace(/\bmid term\b/g, 'midterm');
    const needle = fold(task.text);
    for (const p of placed.filter((x) => x.group === me.group && x.ref.task.id !== task.id)) {
      for (const line of (p.ref.task.notesMarkdown || '').split('\n')) {
        if (!needle || !fold(line).includes(needle)) continue;
        for (const m of line.matchAll(LINK_RE)) {
          if (fold(m[1]).includes(needle) && !parsed.links.some((l) => l.href === m[2])) {
            parsed.links.push({ label: clean(m[1]), href: m[2], kind: linkKind(m[2], m[1], ''), src: 'canvas' });
          }
        }
        const bare = stripEmoji(line.trim().replace(/^[-*]\s*/, ''));
        if (/^\[/.test(bare)) continue;                     // a link line, already taken as a link
        const text = clean(bare.replace(/^\*\*[^*]{1,60}\*\*:?\s*/, '').replace(/^[^:]{1,40}:\s+/, ''));
        if (text.length > 30 && !courseNotes.includes(text)) courseNotes.push(text);
      }
    }
    if (courseNotes.length) sections.unshift({ title: 'From your course notes', markdown: courseNotes.slice(0, 3).map((t) => `- ${t}`).join('\n'), src: 'canvas' });
  }

  // Stakes: a short intro line, or what kind of thing it is.
  let stakes: string | null = null;
  const introText = clean(parsed.intro.replace(/\n+/g, ' '));
  if (introText && introText.length <= 220) stakes = introText;
  else if (introText) sections.unshift({ title: 'Notes', markdown: parsed.intro, src: 'notes' });
  if (!stakes && courseNotes[0] && courseNotes[0].length <= 220) stakes = courseNotes[0];
  if (!stakes && kind === 'exam' && isCourse) stakes = `${me.group} exam.`;

  // Related tasks.
  const others = placed.filter((p) => p.ref.task.id !== task.id);
  // Other tasks whose notes link to this one by name (a triage checklist pointing at the homework).
  const mentionedBy: Placed[] = [];
  const myName = norm(task.text);
  for (const p of others) {
    for (const m of (p.ref.task.notesMarkdown || '').matchAll(LINK_RE)) {
      if (norm(m[1]) !== myName) continue;
      if (!mentionedBy.includes(p)) mentionedBy.push(p);
      if (!parsed.links.some((l) => l.href === m[2])) parsed.links.unshift({ label: clean(m[1]), href: m[2], kind: linkKind(m[2], m[1], ''), src: 'notes' });
    }
  }
  const stateOf = (p: Placed): BriefRelState => (p.hours < 0 ? 'over' : 'open');
  const related: BriefRelated[] = [];
  const addRel = (p: Placed, rel: string, src: BriefSource = 'rule') => {
    if (related.some((r) => r.taskId === p.ref.task.id)) return;
    related.push({ taskId: p.ref.task.id, short: p.short, rel, day: relDay(p, now), state: stateOf(p), src });
  };
  const sameGroup = others.filter((p) => p.group === me.group && me.group !== GROUP_OTHER).sort((a, b) => a.hours - b.hours);
  // Like the Horizon: overdue by more than a week is stale, except catch-ups, which still matter for exams.
  const fresh = (p: Placed) => p.hours >= -7 * 24 || /catch up|\(missed\)/i.test(p.ref.task.text);
  const soonest = (list: Placed[]) => [...list.filter((p) => p.hours >= 0), ...list.filter((p) => p.hours < 0).reverse()];
  const isCatchUp = (p: Placed) => /catch up|\(missed\)|skipped class|review .*lecture/i.test(p.ref.task.text);
  // A missed attendance can't be made up, so it never counts as something to clear.
  const clearable = (p: Placed) => !/\battendance\b/i.test(p.ref.task.text);
  let runway = false;
  if (kind === 'exam' && me.due) {
    // Everything in the course that should be cleared before the exam, then the exam, then what comes after it.
    const before = sameGroup.filter((p) => clearable(p) && (p.due ? p.due < me.due! : isCatchUp(p)) && briefKind(p.ref.task.text, p.ref.listType) !== 'exam');
    const undatedFirst = [...before.filter((p) => !p.due), ...before.filter((p) => p.due)];
    undatedFirst.slice(0, 7).forEach((p) => addRel(p, isCatchUp(p) ? 'catch-up' : 'before the exam'));
    const doneRecently = input.completed
      .filter((c) => c.completedAt && shortenTask(c.text).label === me.label && me.label && new Date(c.completedAt) > new Date(now.getTime() - 21 * 864e5))
      .slice(-2);
    doneRecently.forEach((c) => related.unshift({ taskId: c.id, short: shortenTask(c.text).short, rel: 'done', day: `done ${fmtDay(new Date(c.completedAt as string)).slice(4)}`, state: 'done', src: 'rule' }));
    related.push({ taskId: task.id, short: me.short, rel: 'this exam', day: relDay(me, now), state: 'target', src: 'task' });
    const after = sameGroup.find((p) => p.due && p.due > me.due!);
    if (after) addRel(after, 'after');
    runway = related.length > 2;
  } else {
    // Tasks this one's notes link to by name.
    for (const l of parsed.links) {
      const hit = others.find((p) => norm(p.ref.task.text) === norm(l.label));
      if (hit) addRel(hit, 'in the notes', 'notes');
    }
    mentionedBy.forEach((p) => addRel(p, 'links to it', 'notes'));
    const peers = sameGroup.filter((p) => clearable(p) && fresh(p) && (me.group !== GROUP_JOBS || briefKind(p.ref.task.text, p.ref.listType) === kind));
    soonest(peers).slice(0, 4).forEach((p) => addRel(p, me.group === GROUP_JOBS ? `other ${kind === 'assessment' ? 'OA' : 'job task'}` : me.group === GROUP_LIFE ? 'also Life' : 'same course'));
    if (me.due) {
      others.filter((p) => p.due && ymd(p.due) === ymd(me.due!) && p.group !== me.group).slice(0, 2).forEach((p) => addRel(p, 'same day'));
    }
  }

  // Links: the course page last, so the task's own links come first.
  const links = [...parsed.links];
  if (course?.canvas && !links.some((l) => l.href === course!.canvas)) links.push({ label: 'Course on Canvas', href: course.canvas, kind: 'canvas', src: 'rule' });

  // Flags.
  const flags: BriefFlag[] = [];
  // A Canvas due date written in another task's notes that disagrees with this task's date.
  if (task.dueDate) {
    const mine = norm(task.text);
    for (const p of placed) {
      for (const line of (p.ref.task.notesMarkdown || '').split('\n')) {
        const m = /\[([^\]]+)\]\([^)]*instructure[^)]*\)[^\n]*?Due\s+(?:\w{3},?\s+)?(\w{3})\w*\s+(\d{1,2})/.exec(line);
        if (!m || norm(m[1]) !== mine) continue;
        const month = MON.findIndex((x) => x.toLowerCase() === m[2].slice(0, 3).toLowerCase());
        if (month < 0) continue;
        const canvasDay = new Date(fromYmd(task.dueDate).getFullYear(), month, Number(m[3]));
        if (ymd(canvasDay) !== task.dueDate) {
          flags.push({ level: 'warn', text: `Canvas lists the due date as ${fmtDay(canvasDay)}. This task says ${fmtDay(fromYmd(task.dueDate))}.`, src: 'canvas' });
        }
      }
      if (flags.length) break;
    }
  }
  // Missed lectures before an exam.
  if (kind === 'exam') {
    const missed = sameGroup.filter((p) => isCatchUp(p));
    if (missed.length) {
      const dates = missed.map((p) => /(\d{1,2}\/\d{1,2})/.exec(p.ref.task.text)?.[1]).filter((d): d is string => !!d)
        .sort((a, b) => { const [am, ad] = a.split('/').map(Number), [bm, bd] = b.split('/').map(Number); return am - bm || ad - bd; });
      flags.push({
        level: 'warn',
        text: `${missed.length} missed ${missed.length === 1 ? 'lecture is' : 'lectures are'} still open${dates.length ? `: ${dates.join(', ')}` : ''}.`,
        src: 'rule',
      });
    }
  }
  // Planned blocks that were missed.
  const missedBlocks = input.journal.filter((j) => j.entryMode === 'planned' && j.planStatus === 'missed').sort((a, b) => b.date.localeCompare(a.date));
  if (missedBlocks[0]) {
    const m = missedBlocks[0];
    flags.push({ level: 'info', text: `Your ${m.hour.toUpperCase()} block on ${fmtDay(fromYmd(m.date))} was missed${missedBlocks.length > 1 ? `, and ${missedBlocks.length - 1} more before it` : ''}.`, src: 'journal' });
  }
  // Due soon with nothing planned for it, and what else lands the same day.
  if (me.due && me.hours > 0 && me.hours <= 48) {
    const today = ymd(now);
    const planned = input.journal.some((j) => j.entryMode === 'planned' && !j.autoPlanned && j.date >= today && j.date <= ymd(me.due!) && j.planStatus !== 'missed');
    const sameDay = others.filter((p) => p.due && ymd(p.due) === ymd(me.due!)).map((p) => p.short);
    if (!planned) {
      flags.push({
        level: 'warn',
        text: `Nothing is planned for it yet.${sameDay.length ? ` ${relDay(me, now)} also has ${sameDay.slice(0, 2).join(' and ')} due.` : ''}`,
        src: 'journal',
      });
    }
  }
  // Tasks in the same group whose names overlap: one may be a duplicate.
  const myTokens = tokens(task.text);
  const similar = sameGroup.filter((p) => {
    const t = tokens(p.ref.task.text);
    const shared = [...myTokens].filter((w) => t.has(w)).length;
    return shared >= 2 && (shared === myTokens.size || shared === t.size);
  });
  if (similar.length) {
    flags.push({ level: 'info', text: `Similar ${similar.length === 1 ? 'task' : 'tasks'} in ${me.group}: ${similar.map((p) => `${p.short} (${relDay(p, now)})`).join(', ')}. Check none of them is a duplicate.`, src: 'rule' });
  }
  if (!me.due) flags.push({ level: 'gap', text: 'No date. Undated tasks are the ones that slip.', src: 'rule' });
  if (!notes && !steps.length && !courseNotes.length && !links.some((l) => l.src !== 'rule')) flags.push({ level: 'gap', text: me.due ? 'Only the title and due date are saved.' : 'Only the title is saved.', src: 'rule' });

  // History from the journal.
  input.journal
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 6)
    .forEach((j) => {
      const what = j.entryMode === 'logged' ? 'Logged time'
        : `${j.autoPlanned ? 'Auto-planned' : 'Planned'} ${j.hour.toUpperCase()}${j.planStatus === 'missed' ? ', missed' : j.planStatus === 'completed' ? ', done' : ''}`;
      history.push({ when: fmtDay(fromYmd(j.date)).slice(4), text: what, src: 'journal' });
    });

  // Next: the one thing to press.
  let next: TaskBrief['next'] = null;
  const firstStep = steps.find((s) => !s.done);
  const start = links.find((l) => l.kind === 'start');
  const canvasLink = links.find((l) => l.kind === 'canvas' && /assignments|quizzes/.test(l.href) && norm(l.label) === norm(task.text))
    || links.find((l) => l.kind === 'canvas' && /assignments|quizzes/.test(l.href) && kind === 'assignment');
  const slides = links.find((l) => l.kind === 'slides');
  if (kind === 'assessment' && start) {
    const len = parsed.facts.find((f) => /type|platform/i.test(f.k));
    next = { label: 'Start the assessment', href: start.href, detail: len ? `${len.k}: ${len.v}.` : null, src: start.src };
  } else if (kind === 'exam') {
    const prep = related.find((r) => r.rel !== 'this exam' && r.rel !== 'after' && r.state !== 'done' && (r.state === 'over' || r.day === 'No date'));
    if (prep) next = { label: `Clear ${prep.short} first`, taskId: prep.taskId, detail: prep.state === 'over' ? `It is overdue (${prep.day}).` : 'It has no date and comes before the exam.', src: 'rule' };
    else if (course?.canvas) next = { label: 'Open the course', href: course.canvas, detail: null, src: 'rule' };
  } else if (canvasLink) {
    next = { label: 'Open it on Canvas', href: canvasLink.href, detail: firstStep ? `First step: ${firstStep.text}` : null, src: canvasLink.src };
  } else if (kind === 'catch-up' && slides) {
    next = { label: `Open ${slides.label}`, href: slides.href, detail: firstStep ? `First step: ${firstStep.text}` : null, src: slides.src };
  } else if (firstStep) {
    next = { label: firstStep.text, href: firstStep.href, detail: 'First open step from the notes.', src: firstStep.src };
  } else if (links[0] && links[0].kind !== 'app' && links[0].kind !== 'email') {
    next = { label: `Open ${links[0].label}`, href: links[0].href, detail: null, src: links[0].src };
  }

  return {
    id: task.id,
    listType,
    kind,
    title: task.text,
    short: me.short,
    group: me.group,
    course,
    when: {
      due: me.due ? me.due.toISOString() : null,
      day: relDay(me, now),
      left: me.due ? fmtLeft(me.hours) : null,
      zone,
      implied: me.implied,
      where,
      note: whenNote,
    },
    stakes,
    next,
    steps,
    facts,
    links,
    flags,
    related: related.slice(0, 9),
    runway,
    sections,
    history,
    notesMarkdown: notes || null,
    generatedAt: now.toISOString(),
    agent: null,
  };
}
