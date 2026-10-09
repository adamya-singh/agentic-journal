import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/lib/types';
import { buildTaskBrief, type BriefTaskRef } from '../src/lib/task-brief';
import {
  buildBriefAgentPrompt,
  mergeAgentLayer,
  needsFill,
  taskFingerprint,
  validateAgentReply,
  type AgentRecord,
} from '../src/lib/brief-agent';

const now = new Date(2026, 9, 8, 12, 0);   // Thu Oct 8 2026
const t = (id: string, text: string, extra: Partial<Task> = {}): BriefTaskRef => ({ task: { id, text, ...extra }, listType: 'have-to-do' });
const tasks: BriefTaskRef[] = [
  t('ff', '[Data Context] Fair Face', { dueDate: '2026-10-09' }),
  t('pres', '[Data Context] In Person Presentation', { dueDate: '2026-10-12' }),
  t('dup', '[Data Context] Fair Face reflection', { dueDate: '2026-10-09' }),
  { task: { id: 'movie', text: 'Watch The Others' }, listType: 'want-to-do' },
];
const ctx = { taskId: 'ff', openTaskIds: new Set(tasks.map((r) => r.task.id)), today: '2026-10-08' };

const reply = {
  summary: 'Read the Fair Face assignment on Canvas.',
  stakes: '20-point reflection on facial recognition bias.',
  next: { label: 'Open the assignment', detail: 'Instructions and rubric are there.', href: 'https://rutgers.instructure.com/courses/1/assignments/2', src: 'canvas' },
  steps: [
    { text: 'Read the two linked articles', src: 'canvas' },
    { text: 'Write 500 words', src: 'canvas' },
    { text: '', src: 'canvas' },                                   // dropped: empty
  ],
  facts: [
    { k: 'Points', v: '20', src: 'canvas' },
    { k: 'Due', v: 'Fri Oct 9, 11:59 PM', src: 'canvas' },          // dropped at merge: the rules already have Due
  ],
  links: [
    { label: 'Assignment', href: 'https://rutgers.instructure.com/courses/1/assignments/2', kind: 'canvas', src: 'canvas' },
    { label: 'Bad', href: 'javascript:alert(1)', kind: 'link', src: 'web' },   // dropped: not http(s)
  ],
  flags: [
    { level: 'warn', text: 'Nothing is planned and it is due tomorrow.', src: 'agent', action: { kind: 'plan', label: 'Block 8–10pm tonight', date: '2026-10-08', start: '8pm', end: '10pm' } },
    { level: 'info', text: 'Looks like the same assignment as the reflection task.', src: 'agent', action: { kind: 'merge', label: 'Merge', taskIds: ['dup'] } },
    { level: 'warn', text: 'Old plan.', src: 'agent', action: { kind: 'plan', label: 'Yesterday', date: '2026-10-07', start: '8pm' } },     // action dropped: past
    { level: 'warn', text: 'Backwards.', src: 'agent', action: { kind: 'plan', label: 'Back', date: '2026-10-09', start: '10pm', end: '8pm' } }, // action dropped
    { level: 'info', text: 'Merge with self.', src: 'agent', action: { kind: 'merge', label: 'Self', taskIds: ['ff'] } },                   // action dropped
    { level: 'weird', text: 'Unknown level becomes info.', src: 'somewhere' },
  ],
  related: [
    { taskId: 'pres', rel: 'same unit', src: 'agent' },
    { taskId: 'nope', rel: 'ghost', src: 'agent' },                   // dropped: not an open task
  ],
  sections: [{ title: 'Rubric', markdown: '- Thesis (5)\n- Evidence (10)', src: 'canvas' }],
};

test('validation keeps good items and drops the ones that cannot be trusted', () => {
  const result = validateAgentReply(reply, ctx);
  assert.ok(result.ok);
  if (!result.ok) return;
  const l = result.layer;
  assert.equal(l.steps.length, 2);
  assert.deepEqual(l.links.map((x) => x.label), ['Assignment']);
  assert.deepEqual(l.related.map((r) => r.taskId), ['pres']);
  assert.deepEqual(l.flags.map((f) => f.action?.kind ?? null), ['plan', 'merge', null, null, null, null]);
  assert.equal(l.flags[5].level, 'info');
  assert.equal(l.flags[5].src, 'agent');
  assert.equal(l.next?.href, 'https://rutgers.instructure.com/courses/1/assignments/2');
  assert.notEqual(l.flags[0].action?.id, l.flags[1].action?.id);
});

test('a reply without a summary or not an object is an error', () => {
  assert.equal(validateAgentReply({ steps: [] }, ctx).ok, false);
  assert.equal(validateAgentReply([], ctx).ok, false);
  assert.equal(validateAgentReply(null, ctx).ok, false);
});

test('merging fills gaps, keeps the rules first, and marks OpenClaw lines', () => {
  const brief = buildTaskBrief({ taskId: 'ff', tasks, completed: [], journal: [], now });
  assert.ok(brief);
  if (!brief) return;
  assert.ok(brief.flags.some((f) => /^Only the title/.test(f.text)));
  const checked = validateAgentReply(reply, ctx);
  assert.ok(checked.ok);
  if (!checked.ok) return;
  const record: AgentRecord = {
    taskId: 'ff', fingerprint: 'x', status: 'done', queuedAt: now.toISOString(), startedAt: null,
    finishedAt: now.toISOString(), error: null, failures: 0, layer: checked.layer, doneActions: ['a1'],
  };
  const merged = mergeAgentLayer(brief, record, { tasks: new Map(tasks.map((r) => [r.task.id, r])), now });

  assert.equal(merged.agent?.status, 'done');
  assert.equal(merged.agent?.summary, 'Read the Fair Face assignment on Canvas.');
  assert.equal(merged.stakes, brief.stakes ?? '20-point reflection on facial recognition bias.');
  assert.equal(merged.next?.label, brief.next?.href || brief.next?.taskId ? brief.next.label : 'Open the assignment');
  assert.equal(merged.facts.filter((f) => f.k === 'Due').length, 1, 'rule Due kept, agent Due dropped');
  assert.ok(merged.facts.some((f) => f.k === 'Points' && f.oc));
  assert.ok(!merged.flags.some((f) => /^Only the title/.test(f.text)), 'gap flag goes once OpenClaw adds content');
  const plan = merged.flags.find((f) => f.action?.kind === 'plan');
  assert.equal(plan?.action?.done, true);
  const merge = merged.flags.find((f) => f.action?.kind === 'merge')?.action;
  assert.ok(merge && merge.kind === 'merge');
  if (merge?.kind === 'merge') {
    assert.deepEqual(merge.titles, ['[Data Context] Fair Face reflection']);
    assert.deepEqual(merge.listTypes, ['have-to-do']);
  }
  const rel = merged.related.find((r) => r.taskId === 'pres');
  assert.ok(rel);
  assert.equal(merged.sections.at(-1)?.title, 'Rubric');
  assert.equal(merged.sections.at(-1)?.oc, true);
});

test('a record without a layer only adds the status', () => {
  const brief = buildTaskBrief({ taskId: 'ff', tasks, completed: [], journal: [], now })!;
  const merged = mergeAgentLayer(brief, {
    taskId: 'ff', fingerprint: 'x', status: 'running', queuedAt: now.toISOString(), startedAt: now.toISOString(),
    finishedAt: null, error: null, failures: 0, layer: null, doneActions: [],
  }, { tasks: new Map(), now });
  assert.equal(merged.agent?.status, 'running');
  assert.deepEqual(merged.facts, brief.facts);
  assert.equal(mergeAgentLayer(brief, undefined, { tasks: new Map(), now }), brief);
});

test('a task is filled when new, changed, stale, stuck or due a retry', () => {
  const fp = taskFingerprint(tasks[0].task);
  assert.notEqual(fp, taskFingerprint({ ...tasks[0].task, notesMarkdown: 'new notes' }));
  const base: AgentRecord = {
    taskId: 'ff', fingerprint: fp, status: 'done', queuedAt: now.toISOString(), startedAt: null,
    finishedAt: now.toISOString(), error: null, failures: 0, layer: null, doneActions: [],
  };
  const later = (ms: number) => new Date(now.getTime() + ms);
  assert.equal(needsFill(undefined, fp, now), true);
  assert.equal(needsFill(base, fp, later(60_000)), false);
  assert.equal(needsFill(base, 'other', later(60_000)), true);
  assert.equal(needsFill(base, fp, later(4 * 864e5)), true);
  assert.equal(needsFill({ ...base, status: 'queued' }, fp, later(4 * 864e5)), false);
  assert.equal(needsFill({ ...base, status: 'running', startedAt: now.toISOString() }, fp, later(5 * 60_000)), false);
  assert.equal(needsFill({ ...base, status: 'running', startedAt: now.toISOString() }, fp, later(20 * 60_000)), true);
  assert.equal(needsFill({ ...base, status: 'failed', failures: 1 }, fp, later(30 * 60_000)), false);
  assert.equal(needsFill({ ...base, status: 'failed', failures: 1 }, fp, later(2 * 3600_000)), true);
  assert.equal(needsFill({ ...base, status: 'failed', failures: 3 }, fp, later(2 * 3600_000)), false);
});

test('the prompt carries the task, the rules brief and the ids it may use', () => {
  const brief = buildTaskBrief({ taskId: 'ff', tasks, completed: [], journal: [], now })!;
  const prompt = buildBriefAgentPrompt({
    brief, task: tasks[0].task, otherTasks: [{ id: 'pres', text: tasks[1].task.text, due: '2026-10-12' }], now,
  });
  assert.match(prompt, /READ ONLY/);
  assert.match(prompt, /Task: \[Data Context\] Fair Face/);
  assert.match(prompt, /pres \| \[Data Context\] In Person Presentation \| due 2026-10-12/);
  assert.match(prompt, /"kind":"merge"/);
});
