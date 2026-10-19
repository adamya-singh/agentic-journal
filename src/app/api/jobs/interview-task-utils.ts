import { randomUUID } from 'crypto';
import { emailMessageIds } from './email-duplicate-utils';
import type { JobApplicationRecord, JobEmployerUpdate, JobListing, Task } from '@/lib/types';
import { readGeneralTasks, writeGeneralTasks } from '../tasks/today/today-store-utils';
import { handleDueDateSetup } from '../tasks/due-date-utils';
import {
  addTaskToCurrent,
  ensureCurrentSystemThroughToday,
  refreshActiveDailySnapshots,
} from '../tasks/current/current-store-utils';
import {
  ASSESSMENT_NOTES_MARKER,
  displayTime,
  gmailLink,
  link,
  localDate,
  mergeNotes,
} from './assessment-task-utils';

const LIST_TYPE = 'have-to-do' as const;
const DAY_MS = 24 * 60 * 60 * 1000;

type InterviewListing = Pick<JobListing, 'id' | 'company' | 'positionTitle' | 'link'>;

/** Interview emails from the employer, oldest first: invites and every later scheduling note. */
function interviewEmails(application: JobApplicationRecord): JobEmployerUpdate[] {
  return [...(application.employerUpdates ?? [])]
    .filter((update) => update.source === 'email' && update.stage === 'interview')
    .sort((first, second) => Date.parse(first.receivedAt) - Date.parse(second.receivedAt));
}

/** The emails since the invite the open task was made for. */
function taskEmails(application: JobApplicationRecord): JobEmployerUpdate[] {
  const emails = interviewEmails(application);
  const start = emails.findIndex((email) => email.gmailMessageId === application.interviewTask?.gmailMessageId);
  return start === -1 ? emails.slice(-1) : emails.slice(start);
}

const roundOf = (emails: JobEmployerUpdate[]) =>
  emails.findLast((email) => email.interviewRound)?.interviewRound;

export function buildInterviewNotes(listing: InterviewListing, application: JobApplicationRecord): string {
  const emails = taskEmails(application);
  const invitation = emails[0];
  const round = roundOf(emails);
  const gmail = invitation ? gmailLink(invitation) : undefined;
  const facts = [
    `- **Reply to book a time:** ${gmail ? link('open the invite in Gmail', gmail) : 'use the invitation email'}`,
    ...(round ? [`- **Round:** ${round}`] : []),
    `- **Role:** ${listing.positionTitle} at ${listing.company}`,
    ...(listing.link ? [`- **Posting:** ${link('job posting', listing.link)}`] : []),
    `- **Application:** ${link('open in Agentic Journal', `/jobs?application=${encodeURIComponent(listing.id)}`)}`,
    ...(application.submittedAt ? [`- **Applied:** ${displayTime(new Date(application.submittedAt))}`] : []),
    ...(invitation ? [`- **Invited:** ${displayTime(new Date(invitation.receivedAt))}`] : []),
    '- Once it is booked, record the time on the Jobs overview so it shows as an upcoming interview.',
  ];
  const emailLines = emails.flatMap((email) => {
    const emailGmail = gmailLink(email);
    const heading = [
      email.subject ? `"${email.subject}"` : undefined,
      email.from ? `from ${email.from}` : undefined,
      displayTime(new Date(email.receivedAt)),
    ].filter(Boolean).join(' · ');
    return [
      `- ${heading}${emailGmail ? ` — ${link('open in Gmail', emailGmail)}` : ''}`,
      ...(email.summary ? [`  - ${email.summary}`] : []),
    ];
  });
  return [
    `Interview invite from **${listing.company}** for **${listing.positionTitle}**.`,
    '',
    ...facts,
    ...(emailLines.length > 0 ? ['', '**Emails**', '', ...emailLines] : []),
    '',
    ASSESSMENT_NOTES_MARKER,
  ].join('\n');
}

function openInterviewTask(application: JobApplicationRecord, tasks: Task[]): Task | undefined {
  const taskId = application.interviewTask?.taskId;
  return taskId ? tasks.find((task) => task.id === taskId) : undefined;
}

/**
 * Puts an employer's interview invite at the top of Current as a have-to-do
 * task due the day after it arrived: booking the time is on Adamya, and an
 * auto-applied stage change alone tells him nothing. One open task per
 * application; a later email (a reschedule, the next round's details) while
 * it is open refreshes its notes, and the next invite after it is done gets a
 * new one. Returns true when a task was created.
 */
export function ensureInterviewTask(
  application: JobApplicationRecord,
  listing: InterviewListing,
  invitation: Pick<JobEmployerUpdate, 'gmailMessageId' | 'receivedAt'>,
  now: string,
): boolean {
  ensureCurrentSystemThroughToday();
  const general = readGeneralTasks(LIST_TYPE);
  const open = openInterviewTask(application, general.tasks);
  if (open) {
    const notes = mergeNotes(buildInterviewNotes(listing, application), open.notesMarkdown);
    if (notes === open.notesMarkdown) return false;
    open.notesMarkdown = notes;
    writeGeneralTasks(general, LIST_TYPE);
    refreshActiveDailySnapshots();
    return false;
  }
  // A copy of an email is folded into the first one, so compare by that one.
  const stored = interviewEmails(application).find((email) =>
    invitation.gmailMessageId && emailMessageIds(email).includes(invitation.gmailMessageId));
  const inviteId = stored?.gmailMessageId ?? invitation.gmailMessageId;
  // Already turned into a task that has since been done or removed.
  if (inviteId && application.interviewTask?.gmailMessageId === inviteId) return false;
  const round = roundOf(interviewEmails(application).filter((email) =>
    Date.parse(email.receivedAt) >= Date.parse(invitation.receivedAt)));
  application.interviewTask = {
    taskId: randomUUID(),
    createdAt: now,
    ...(inviteId ? { gmailMessageId: inviteId } : {}),
  };
  const received = new Date(invitation.receivedAt);
  const task: Task = {
    id: application.interviewTask.taskId,
    text: `Schedule ${listing.company} ${round ? round.toLowerCase() : 'interview'} (${listing.positionTitle})`,
    notesMarkdown: buildInterviewNotes(listing, application),
    ...(Number.isNaN(received.getTime()) ? {} : { dueDate: localDate(new Date(received.getTime() + DAY_MS)) }),
  };
  general.tasks.push(task);
  writeGeneralTasks(general, LIST_TYPE);
  if (task.dueDate) handleDueDateSetup(task.dueDate, LIST_TYPE, task);
  addTaskToCurrent(LIST_TYPE, task.id, 0);
  refreshActiveDailySnapshots();
  return true;
}
