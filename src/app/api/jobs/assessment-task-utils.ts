import { randomUUID } from 'crypto';
import type { JobApplicationRecord, JobEmployerUpdate, JobListing, Task } from '@/lib/types';
import { readGeneralTasks, writeGeneralTasks } from '../tasks/today/today-store-utils';
import { handleDueDateSetup } from '../tasks/due-date-utils';
import {
  addTaskToCurrent,
  ensureCurrentSystemThroughToday,
  refreshActiveDailySnapshots,
} from '../tasks/current/current-store-utils';

const LIST_TYPE = 'have-to-do' as const;

const pad = (value: number) => String(value).padStart(2, '0');
// Task due dates are local calendar days, like everything else in the journal.
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const localTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export function buildAssessmentTask(
  listing: Pick<JobListing, 'company' | 'positionTitle'>,
  update: Pick<JobEmployerUpdate, 'assessmentType' | 'provider' | 'deadline' | 'subject' | 'summary' | 'gmailMessageId'>,
): Task {
  const deadline = update.deadline ? new Date(update.deadline) : undefined;
  const validDeadline = deadline && !Number.isNaN(deadline.getTime()) ? deadline : undefined;
  const notes = [
    `Online assessment from ${listing.company} for **${listing.positionTitle}**.`,
    '',
    ...(update.assessmentType ? [`- Type: ${update.assessmentType}`] : []),
    ...(update.provider ? [`- Platform: ${update.provider}`] : []),
    ...(validDeadline ? [`- Deadline: ${localDate(validDeadline)} ${localTime(validDeadline)}`] : []),
    ...(update.subject ? [`- Email: "${update.subject}"`] : []),
    ...(update.gmailMessageId
      ? [`- [Open in Gmail](https://mail.google.com/mail/u/0/#all/${update.gmailMessageId})`]
      : []),
    ...(update.summary ? ['', update.summary] : []),
    '',
    '_Added automatically from job application email updates._',
  ];
  return {
    id: randomUUID(),
    text: `Complete ${listing.company} OA (${listing.positionTitle})`,
    notesMarkdown: notes.join('\n'),
    ...(validDeadline ? { dueDate: localDate(validDeadline) } : {}),
  };
}

/**
 * Adds an online assessment to the have-to-do backlog and puts it at the top
 * of Current. An application gets one open OA task at a time: while the last
 * one is still in General (not completed or removed), nothing new is created.
 * Returns true when a task was created.
 */
export function ensureAssessmentTask(
  application: JobApplicationRecord,
  listing: Pick<JobListing, 'company' | 'positionTitle'>,
  update: Parameters<typeof buildAssessmentTask>[1],
  now: string,
): boolean {
  ensureCurrentSystemThroughToday();
  const general = readGeneralTasks(LIST_TYPE);
  const existing = application.assessmentTask?.taskId;
  if (existing && general.tasks.some((task) => task.id === existing)) return false;

  const task = buildAssessmentTask(listing, update);
  general.tasks.push(task);
  writeGeneralTasks(general, LIST_TYPE);
  if (task.dueDate) handleDueDateSetup(task.dueDate, LIST_TYPE, task);
  addTaskToCurrent(LIST_TYPE, task.id, 0);
  refreshActiveDailySnapshots();
  application.assessmentTask = { taskId: task.id, createdAt: now };
  return true;
}
