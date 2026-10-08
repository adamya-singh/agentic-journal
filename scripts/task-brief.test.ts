import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Task } from '../src/lib/types';
import { buildTaskBrief, latexToText, parseNotes, type BriefTaskRef } from '../src/lib/task-brief';

const now = new Date(2026, 9, 8, 12, 0);   // Thu Oct 8 2026, local time

const catchUpNotes = [
  '## Missed meeting',
  '- Course: REGRESSION METHODS (01:960:463:03)',
  '## What was covered',
  '- Normal equations $\\mathbf{X}^T \\mathbf{X} \\hat{\\boldsymbol{\\beta}} = \\mathbf{X}^T \\mathbf{Y}$',
  '## Materials and source links',
  '- 📢 [Announcement: Mid Term 1 - Oct 15 - Details](https://rutgers.instructure.com/courses/408904/discussion_topics/1)',
  '- 📝 [Homework 2 - SLR and MLR](https://rutgers.instructure.com/courses/408904/assignments/4562608) *(Due Oct 4 at 11:59 PM)*',
  '## Announcements and assignment impact',
  '- **Midterm 1 Announcement:** Midterm 1 is scheduled for Oct 15 in class covering Chapters 2-5; allows one 2-sided cheat sheet and basic calculator.',
  '## Catch-up checklist',
  '- [ ] Review the slides',
  '- [x] Read chapter 4',
].join('\n');

const oaNotes = [
  'Online assessment from **Confido** for **New Grad Software Engineer**.',
  '',
  '- **Start the assessment:** [open the OA](<https://example.com/challenge>)',
  '- **Deadline:** 2026-10-09 (5 business days from invitation; no clock time stated; weekends excluded)',
  '- **Type:** take-home engineering challenge',
  '- **Application:** [open in Agentic Journal](</jobs?application=8bad278e-3f67-4ac9-8181-744d2d02de4f>)',
  '- **Invited:** Sun, Oct 4, 2026, 1:38 PM EDT',
  '',
  '**Emails**',
  '',
  '- **Invitation** · "Challenge" · from Maddie — [open in Gmail](<https://mail.google.com/mail/#all/1>)',
  '',
  '_Filled in from employer emails. Anything you add below this line is kept._',
].join('\n');

const t = (id: string, text: string, extra: Partial<Task> = {}): BriefTaskRef => ({ task: { id, text, ...extra }, listType: 'have-to-do' });
const tasks: BriefTaskRef[] = [
  t('mid', '[Regression] Midterm 1', { dueDate: '2026-10-15', dueTimeStart: '17:40' }),
  t('hw2', '[Regression] Homework 2 - SLR and MLR', { dueDate: '2026-10-03', dueTimeStart: '23:59' }),
  t('cu29', '[Regression] Catch up on 9/29 lecture (missed)', { dueDate: '2026-10-04', notesMarkdown: catchUpNotes }),
  t('cu22', '[Regression] Catch up on 9/22 lecture (missed)'),
  t('att', '[Regression] Sept 29 Attendance', { dueDate: '2026-09-29' }),
  t('hw3', '[Regression] Homework 3', { dueDate: '2026-10-18' }),
  t('oa', 'Complete Confido OA (New Grad Software Engineer)', { dueDate: '2026-10-09', notesMarkdown: oaNotes }),
  t('ff', '[Data Context] Fair Face', { dueDate: '2026-10-09', dueTimeStart: '23:59' }),
];
const brief = (id: string) => {
  const b = buildTaskBrief({ taskId: id, tasks, completed: [], journal: [], now });
  assert.ok(b);
  return b;
};

test('LaTeX from triage notes reads as text', () => {
  assert.equal(latexToText('$\\hat{\\boldsymbol{\\beta}} = (\\mathbf{X}^T \\mathbf{X})^{-1} \\mathbf{X}^T \\mathbf{Y}$'), 'β̂ = (XᵀX)⁻¹XᵀY');
});

test('notes yield facts, named links, steps and sections', () => {
  const p = parseNotes(oaNotes);
  assert.deepEqual(p.facts.map((f) => f.k), ['Deadline', 'Type', 'Invited']);
  assert.equal(p.facts.find((f) => f.k === 'Invited')?.v, 'Sun Oct 4, 1:38 PM');
  assert.deepEqual(p.links.map((l) => [l.kind, l.label]), [['start', 'Start the assessment'], ['app', 'Application'], ['email', 'Invitation email']]);
  assert.deepEqual(p.sections.map((s) => s.title), ['Emails']);
  const c = parseNotes(catchUpNotes);
  assert.deepEqual(c.steps.map((s) => s.done), [false, true]);
  assert.ok(!c.sections.some((s) => /checklist|materials/i.test(s.title)));
});

test('an online assessment starts at its link and warns when nothing is planned', () => {
  const b = brief('oa');
  assert.equal(b.kind, 'assessment');
  assert.equal(b.next?.href, 'https://example.com/challenge');
  assert.match(b.when.note ?? '', /No clock time/);
  assert.ok(b.flags.some((f) => /Nothing is planned/.test(f.text) && /Fair Face/.test(f.text)));
});

test('an exam lists what to clear first, skips attendance, and reads its announcement from course notes', () => {
  const b = brief('mid');
  assert.equal(b.runway, true);
  const ids = b.related.map((r) => r.taskId);
  assert.ok(!ids.includes('att'));
  assert.deepEqual(ids, ['cu22', 'hw2', 'cu29', 'mid', 'hw3']);
  assert.equal(b.next?.taskId, 'cu22');
  assert.match(b.stakes ?? '', /2-sided cheat sheet/);
  assert.ok(b.links.some((l) => /Mid Term 1/.test(l.label)));
  assert.ok(b.flags.some((f) => f.text === '2 missed lectures are still open: 9/22, 9/29.'));
  assert.equal(b.course?.canvas, 'https://rutgers.instructure.com/courses/408904');
  assert.equal(b.course?.code, '01:960:463:03');
});

test('homework picks up its Canvas link and due date from another task\'s notes', () => {
  const b = brief('hw2');
  assert.equal(b.next?.href, 'https://rutgers.instructure.com/courses/408904/assignments/4562608');
  assert.ok(b.flags.some((f) => /Canvas lists the due date as Sun Oct 4/.test(f.text)));
  assert.ok(b.related.some((r) => r.taskId === 'cu29' && r.rel === 'links to it'));
});

test('a task with only a title says so', () => {
  const b = brief('ff');
  assert.ok(b.flags.some((f) => f.level === 'gap' && /Only the title and due date/.test(f.text)));
  assert.equal(b.next, null);
});
