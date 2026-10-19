import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { JobApplicationRecord, JobEmployerUpdate, JobListing } from '../src/lib/types';
const root = mkdtempSync(path.join(tmpdir(), 'interview-task-'));
process.env.BACKEND_DATA_DIR = root;
after(() => rmSync(root, { recursive: true, force: true }));

const invite = (id: string, receivedAt: string, extra: Partial<JobEmployerUpdate> = {}): JobEmployerUpdate => ({
  id, source: 'email', stage: 'interview', receivedAt, appliedAt: receivedAt, gmailMessageId: id, gmailThreadId: id,
  from: 'Michelle <michelle@roadrunner.ai>', subject: 'Next Steps', summary: 'Invitation to schedule a phone screen.', ...extra,
});

test('an interview invite becomes one open task at the top of Current', async () => {
  const { ensureInterviewTask } = await import('../src/app/api/jobs/interview-task-utils');
  const { readGeneralTasks, writeGeneralTasks } = await import('../src/app/api/tasks/today/today-store-utils');
  const { readCurrentTaskIds } = await import('../src/app/api/tasks/current/current-store-utils');
  const listing = { id: 'rr', company: 'Roadrunner', positionTitle: 'Forward Deployed Engineer (New Grad)', link: 'https://example.com/job' } as JobListing;
  const first = invite('msg-1', '2026-10-18T18:49:45-04:00', { interviewRound: 'Recruiter Phone Screen' });
  const application = { listingId: 'rr', employerStage: 'interview', employerUpdates: [first] } as JobApplicationRecord;

  assert.equal(ensureInterviewTask(application, listing, first, '2026-10-18T23:08:46Z'), true);
  const read = () => readGeneralTasks('have-to-do').tasks.find((t) => t.id === application.interviewTask!.taskId);
  const task = read()!;
  assert.equal(task.text, 'Schedule Roadrunner recruiter phone screen (Forward Deployed Engineer (New Grad))');
  assert.equal(task.dueDate, '2026-10-19');
  assert.match(task.notesMarkdown!, /Reply to book a time:\*\* \[open the invite in Gmail\]/);
  assert.match(task.notesMarkdown!, /Round:\*\* Recruiter Phone Screen/);
  assert.equal(readCurrentTaskIds('have-to-do')[0], task.id);
  assert.equal(application.interviewTask!.gmailMessageId, 'msg-1');

  // A follow-up while the task is open adds to its notes and keeps the user's own.
  const general = readGeneralTasks('have-to-do');
  general.tasks.find((t) => t.id === task.id)!.notesMarkdown += '\n\nAsked for Tuesday afternoon.';
  writeGeneralTasks(general, 'have-to-do');
  const followUp = invite('msg-2', '2026-10-19T14:00:00Z', { subject: 'Re: Next Steps', summary: 'Sent a booking link.' });
  application.employerUpdates!.push(followUp);
  assert.equal(ensureInterviewTask(application, listing, followUp, '2026-10-19T14:10:00Z'), false);
  assert.equal(readGeneralTasks('have-to-do').tasks.filter((t) => t.text.startsWith('Schedule Roadrunner')).length, 1);
  assert.match(read()!.notesMarkdown!, /"Re: Next Steps"/);
  assert.match(read()!.notesMarkdown!, /Asked for Tuesday afternoon\.$/);

  // Done: a copy of the same invite does not bring it back, the next round's invite does.
  const done = readGeneralTasks('have-to-do');
  done.tasks = done.tasks.filter((t) => t.id !== task.id);
  writeGeneralTasks(done, 'have-to-do');
  application.employerUpdates![0].emailMessageIds = ['msg-1', 'msg-1-copy'];
  assert.equal(ensureInterviewTask(application, listing, { gmailMessageId: 'msg-1-copy', receivedAt: first.receivedAt }, '2026-10-20T00:00:00Z'), false);
  const next = invite('msg-3', '2026-10-24T15:00:00Z', { interviewRound: 'Technical Interview' });
  application.employerUpdates!.push(next);
  assert.equal(ensureInterviewTask(application, listing, next, '2026-10-24T15:05:00Z'), true);
  assert.equal(read()!.text, 'Schedule Roadrunner technical interview (Forward Deployed Engineer (New Grad))');
});
