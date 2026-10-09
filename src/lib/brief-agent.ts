// OpenClaw's half of a task brief. The rules in task-brief.ts only know what is already saved; for most
// class tasks that is a title and a date. In the background OpenClaw reads whatever it can reach (Canvas,
// email, the journal, the web) and returns an "agent layer": extra facts, steps, links, warnings and
// one-press fixes. The layer is stored apart from the task and merged in when a brief is built, with
// every line keeping its source so a guess ('agent') is never confused with something read.
// Pure: no filesystem, so the route, the worker and the tests share it.
import { createHash } from 'crypto';
import { z } from 'zod';
import type { Task } from '@/lib/types';
import { JOURNAL_HOURS } from '@/lib/done-at';
import { dayLabel, impliedOaDue, parseDue, shortenTask } from '@/lib/horizon';
import type {
  BriefAction,
  BriefActionSpec,
  BriefRelState,
  BriefSource,
  BriefTaskRef,
  TaskBrief,
} from '@/lib/task-brief';

export type AgentSource = Extract<BriefSource, 'canvas' | 'email' | 'web' | 'journal' | 'notes' | 'jobs' | 'agent'>;

export interface AgentLayer {
  summary: string;
  stakes: string | null;
  where: string | null;
  next: { label: string; detail: string | null; href?: string; taskId?: string; src: AgentSource } | null;
  steps: { text: string; href?: string; src: AgentSource }[];
  facts: { k: string; v: string; src: AgentSource }[];
  links: { label: string; href: string; kind: 'start' | 'canvas' | 'slides' | 'email' | 'posting' | 'link'; src: AgentSource }[];
  flags: { level: 'warn' | 'info' | 'gap'; text: string; src: AgentSource; action?: BriefActionSpec & { id: string } }[];
  related: { taskId: string; rel: string; src: AgentSource }[];
  sections: { title: string; markdown: string; src: AgentSource }[];
}

export interface AgentRecord {
  taskId: string;
  fingerprint: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  queuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  failures: number;            // consecutive; reset by a success or a changed task
  layer: AgentLayer | null;    // the last good layer, kept while a refresh runs
  doneActions: string[];
}

export const REFILL_AFTER_MS = 3 * 864e5;        // Canvas pages and inboxes change; look again after 3 days
export const RETRY_FAILED_AFTER_MS = 60 * 60_000;
export const MAX_FAILURES = 3;
export const RUNNING_TIMEOUT_MS = 15 * 60_000;

/** Changes when the task itself changes, so an edited task gets a fresh look. */
export function taskFingerprint(task: Task): string {
  return createHash('sha1')
    .update(JSON.stringify([task.text, task.dueDate ?? '', task.dueTimeStart ?? '', task.notesMarkdown ?? '']))
    .digest('hex')
    .slice(0, 16);
}

/** Whether this task needs (another) fill now. */
export function needsFill(record: AgentRecord | undefined, fingerprint: string, now: Date): boolean {
  if (!record) return true;
  if (record.fingerprint !== fingerprint) return true;
  if (record.status === 'queued') return false;
  if (record.status === 'running') return now.getTime() - Date.parse(record.startedAt ?? record.queuedAt) > RUNNING_TIMEOUT_MS;
  if (record.status === 'failed') {
    return record.failures < MAX_FAILURES && now.getTime() - Date.parse(record.finishedAt ?? record.queuedAt) > RETRY_FAILED_AFTER_MS;
  }
  return now.getTime() - Date.parse(record.finishedAt ?? record.queuedAt) > REFILL_AFTER_MS;
}

// ───────────── the reply ─────────────

const str = (max: number) => z.string().trim().min(1).max(max);
const src = z.enum(['canvas', 'email', 'web', 'journal', 'notes', 'jobs', 'agent']).catch('agent');
const href = z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), 'http(s) only');
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const hour = z.enum(JOURNAL_HOURS);

const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('plan'), label: str(60), date: ymd, start: hour, end: hour.optional() }),
  z.object({
    kind: z.literal('add-task'), label: str(60), text: str(200),
    listType: z.enum(['have-to-do', 'want-to-do']).catch('have-to-do'),
    dueDate: ymd.optional(), dueTimeStart: hhmm.optional(), notesMarkdown: z.string().max(4000).optional(),
  }),
  z.object({ kind: z.literal('set-due'), label: str(60), dueDate: ymd, dueTimeStart: hhmm.optional() }),
  z.object({ kind: z.literal('save-notes'), label: str(60), markdown: str(6000) }),
  z.object({ kind: z.literal('merge'), label: str(60), taskIds: z.array(z.string().min(1)).min(1).max(5) }),
]);

const ITEM = {
  steps: z.object({ text: str(200), href: href.optional().catch(undefined), src }),
  facts: z.object({ k: str(40), v: str(300), src }),
  links: z.object({ label: str(80), href, kind: z.enum(['start', 'canvas', 'slides', 'email', 'posting', 'link']).catch('link'), src }),
  flags: z.object({ level: z.enum(['warn', 'info', 'gap']).catch('info'), text: str(300), src, action: ActionSchema.nullish().catch(null) }),
  related: z.object({ taskId: z.string().min(1), rel: str(40), src }),
  sections: z.object({ title: str(60), markdown: str(6000), src }),
};
const LIMITS = { steps: 10, facts: 10, links: 8, flags: 6, related: 6, sections: 4 } as const;
const NextSchema = z.object({
  label: str(80), detail: str(300).nullish(), href: href.optional().catch(undefined), taskId: z.string().optional(), src,
});
const HeadSchema = z.object({ summary: str(300), stakes: str(300).nullish().catch(null), where: str(160).nullish().catch(null) });

function hourIndex(h: string): number {
  return JOURNAL_HOURS.indexOf(h as (typeof JOURNAL_HOURS)[number]);
}

/**
 * Checks OpenClaw's reply and drops whatever can't be trusted to act on: links that aren't http(s),
 * related or merged tasks that aren't open tasks, plans in the past or with a backwards range.
 * Bad items are dropped one by one; only an unreadable reply as a whole is an error.
 */
export function validateAgentReply(
  raw: unknown,
  ctx: { taskId: string; openTaskIds: Set<string>; today: string }
): { ok: true; layer: AgentLayer } | { ok: false; error: string } {
  // Item by item, so one bad flag or link doesn't sink the rest.
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!obj) return { ok: false, error: 'reply was not a JSON object' };
  const head = HeadSchema.safeParse(obj);
  if (!head.success) return { ok: false, error: 'reply had no summary' };
  const items = <K extends keyof typeof ITEM>(key: K): z.infer<(typeof ITEM)[K]>[] =>
    (Array.isArray(obj[key]) ? (obj[key] as unknown[]) : [])
      .map((item) => ITEM[key].safeParse(item))
      .flatMap((p) => (p.success ? [p.data as z.infer<(typeof ITEM)[K]>] : []))
      .slice(0, LIMITS[key]);
  const nextParsed = obj.next ? NextSchema.safeParse(obj.next) : null;
  const r = {
    ...head.data,
    next: nextParsed?.success ? nextParsed.data : null,
    steps: items('steps'), facts: items('facts'), links: items('links'),
    flags: items('flags'), related: items('related'), sections: items('sections'),
  };

  const known = (id?: string) => !!id && id !== ctx.taskId && ctx.openTaskIds.has(id);
  const actionOk = (a: BriefActionSpec | z.infer<typeof ActionSchema>): boolean => {
    if (a.kind === 'plan') return a.date >= ctx.today && (!a.end || hourIndex(a.end) > hourIndex(a.start));
    if (a.kind === 'merge') return a.taskIds.every(known);
    if (a.kind === 'set-due') return a.dueDate >= ctx.today;
    return true;
  };

  const next = r.next
    ? {
        label: r.next.label,
        detail: r.next.detail ?? null,
        ...(r.next.href ? { href: r.next.href } : {}),
        ...(known(r.next.taskId) ? { taskId: r.next.taskId } : {}),
        src: r.next.src,
      }
    : null;

  let n = 0;
  return {
    ok: true,
    layer: {
      summary: r.summary,
      stakes: r.stakes ?? null,
      where: r.where ?? null,
      next,
      steps: r.steps.map((s) => ({ text: s.text, ...(s.href ? { href: s.href } : {}), src: s.src })),
      facts: r.facts,
      links: r.links,
      flags: r.flags.map((f) => {
        const action = f.action && actionOk(f.action)
          ? { ...(f.action.kind === 'merge' ? { ...f.action, titles: [], listTypes: [] } : f.action), id: `a${++n}` } as BriefActionSpec & { id: string }
          : undefined;
        return { level: f.level, text: f.text, src: f.src, ...(action ? { action } : {}) };
      }),
      related: r.related.filter((x) => known(x.taskId)),
      sections: r.sections,
    },
  };
}

// ───────────── merging into the brief ─────────────

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const GAP_ONLY_SAVED = /^Only the title/;

/**
 * Lays OpenClaw's layer over the rule-built brief. Rules win where both have something (they come from
 * saved data); OpenClaw fills what is empty and adds what is new.
 */
export function mergeAgentLayer(
  brief: TaskBrief,
  record: AgentRecord | undefined,
  ctx: { tasks: Map<string, BriefTaskRef>; now: Date }
): TaskBrief {
  if (!record) return brief;
  const agent = { status: record.status, finishedAt: record.finishedAt, summary: record.layer?.summary ?? null, error: record.error };
  const layer = record.layer;
  if (!layer) return { ...brief, agent };

  const ruleNextIsWeak = !brief.next || (!brief.next.href && !brief.next.taskId);
  const stepKeys = new Set(brief.steps.map((s) => norm(s.text)));
  const factKeys = new Set(brief.facts.map((f) => norm(f.k)));
  const hrefs = new Set(brief.links.map((l) => l.href));
  const relIds = new Set(brief.related.map((r) => r.taskId));
  const sectionKeys = new Set(brief.sections.map((s) => norm(s.title)));

  const relFor = (taskId: string, rel: string, src: AgentSource) => {
    const task = ctx.tasks.get(taskId)?.task;
    if (!task) return null;
    const due = parseDue(task) ?? impliedOaDue(task);
    const state: BriefRelState = due && due.getTime() < ctx.now.getTime() ? 'over' : 'open';
    return { taskId, short: shortenTask(task.text).short, rel, day: due ? dayLabel(due, ctx.now, !parseDue(task)) : 'No date', state, src, oc: true as const };
  };

  const flags = layer.flags.map((f) => {
    if (!f.action) return { level: f.level, text: f.text, src: f.src, oc: true as const };
    const a = f.action;
    const action: BriefAction = {
      ...(a.kind === 'merge'
        ? { ...a, titles: a.taskIds.map((id) => ctx.tasks.get(id)?.task.text ?? id), listTypes: a.taskIds.map((id) => ctx.tasks.get(id)?.listType ?? 'have-to-do') }
        : a),
      done: record.doneActions.includes(a.id),
    } as BriefAction;
    return { level: f.level, text: f.text, src: f.src, action, oc: true as const };
  });
  const added = layer.steps.length + layer.facts.length + layer.links.length + layer.sections.length + (layer.next ? 1 : 0);

  return {
    ...brief,
    when: { ...brief.when, where: brief.when.where ?? layer.where, ...(!brief.when.where && layer.where ? { whereOc: true as const } : {}) },
    stakes: brief.stakes ?? layer.stakes,
    ...(!brief.stakes && layer.stakes ? { stakesOc: true as const } : {}),
    next: ruleNextIsWeak && layer.next ? { ...layer.next, oc: true as const } : brief.next,
    steps: [
      ...brief.steps,
      ...layer.steps.filter((s) => !stepKeys.has(norm(s.text))).map((s) => ({ text: s.text, done: false, ...(s.href ? { href: s.href } : {}), src: s.src, oc: true as const })),
    ],
    facts: [...brief.facts, ...layer.facts.filter((f) => !factKeys.has(norm(f.k))).map((f) => ({ ...f, oc: true as const }))],
    links: [...brief.links, ...layer.links.filter((l) => !hrefs.has(l.href)).map((l) => ({ ...l, oc: true as const }))],
    flags: [...brief.flags.filter((f) => !(added > 0 && f.level === 'gap' && GAP_ONLY_SAVED.test(f.text))), ...flags],
    related: [
      ...brief.related,
      ...layer.related.filter((r) => !relIds.has(r.taskId)).map((r) => relFor(r.taskId, r.rel, r.src)).filter((r): r is NonNullable<typeof r> => !!r),
    ],
    sections: [...brief.sections, ...layer.sections.filter((s) => !sectionKeys.has(norm(s.title))).map((s) => ({ ...s, oc: true as const }))],
    agent,
  };
}

// ───────────── the prompt ─────────────

export function buildBriefAgentPrompt(input: {
  brief: TaskBrief;
  task: Task;
  otherTasks: { id: string; text: string; due: string | null }[];
  now: Date;
}): string {
  const { brief, task } = input;
  const ruleBrief = {
    kind: brief.kind, course: brief.course, when: brief.when, stakes: brief.stakes, next: brief.next,
    steps: brief.steps, facts: brief.facts, links: brief.links, flags: brief.flags,
    related: brief.related.map((r) => ({ taskId: r.taskId, short: r.short, rel: r.rel, day: r.day, state: r.state })),
  };
  return `Agentic Journal is asking you to fill in the brief for one of Adamya's tasks so he can start it without hunting for anything.

READ ONLY. Look at anything that helps: Canvas (in your browser; open a new tab and close it when you are done, and leave other tabs alone), his Rutgers email (read only), his Agentic Journal tasks, notes and journal, and the web. Do not change anything anywhere: no task, journal, Canvas, email or file changes, no messages to anyone. Suggest changes as actions instead (below); Adamya confirms each one himself.

Now: ${input.now.toString()}
Task id: ${task.id}
Task: ${task.text}
Due: ${task.dueDate ? `${task.dueDate}${task.dueTimeStart ? ` ${task.dueTimeStart}` : ' (no time; treated as 23:59)'}` : 'no date'}
Notes:
${task.notesMarkdown?.trim() || '(none)'}

What the Journal's rules already put in the brief (don't repeat these):
${JSON.stringify(ruleBrief)}

His other open tasks (use these ids for related tasks and merges):
${input.otherTasks.map((t) => `${t.id} | ${t.text}${t.due ? ` | due ${t.due}` : ''}`).join('\n')}

Find what he needs to start and finish it: the real instructions and requirements, points, length, the submission link and format, the exact deadline if it differs, who to contact, what it depends on, and what is likely to go wrong. For a class task, find the assignment or announcement on Canvas. For an exam, find what it covers and what is allowed. Prefer facts you read over guesses. Mark each item's src: "canvas", "email", "web", "journal", "notes", "jobs" for something you read there, or "agent" for your own inference.

Actions: attach one to a flag only when it fixes what the flag says. Kinds:
- {"kind":"plan","label":"Block 8–10pm tonight","date":"YYYY-MM-DD","start":"8pm","end":"10pm"}  (hours are journal hours: 7am…11pm, 12am…6am; end optional)
- {"kind":"add-task","label":"Add cheat-sheet task","text":"[Course] Cheat sheet","listType":"have-to-do","dueDate":"YYYY-MM-DD"}
- {"kind":"set-due","label":"Use Canvas due date","dueDate":"YYYY-MM-DD","dueTimeStart":"HH:MM"}
- {"kind":"save-notes","label":"Save instructions to notes","markdown":"..."}
- {"kind":"merge","label":"Merge into this task","taskIds":["<other open task id>"]}

Reply with ONLY one JSON object, no prose, no code fence:
{"summary":"<one line: what you read>","stakes":null|"<what it is and why it matters>","where":null|"<room / time window>",
 "next":null|{"label":"<the one thing to press or do first>","detail":"<why, one line>","href":"<url, optional>","taskId":"<open task id, optional>","src":"..."},
 "steps":[{"text":"...","href":"<optional>","src":"..."}],
 "facts":[{"k":"Points","v":"...","src":"..."}],
 "links":[{"label":"...","href":"https://...","kind":"start|canvas|slides|email|posting|link","src":"..."}],
 "flags":[{"level":"warn|info|gap","text":"...","src":"...","action":null|{...}}],
 "related":[{"taskId":"<open task id>","rel":"<2-3 words>","src":"..."}],
 "sections":[{"title":"...","markdown":"...","src":"..."}]}
Leave a list empty rather than padding it. If you could not find anything new, say so in summary and return empty lists.`;
}
