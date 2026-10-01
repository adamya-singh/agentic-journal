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
// Everything above this line is regenerated as new details arrive; notes the
// user adds below it are kept.
export const ASSESSMENT_NOTES_MARKER =
  '_Filled in from employer emails. Anything you add below this line is kept._';

type AssessmentListing = Pick<JobListing, 'id' | 'company' | 'positionTitle' | 'link'>;

const pad = (value: number) => String(value).padStart(2, '0');
// Task due dates are local calendar days, like everything else in the journal.
const localDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const displayTime = (date: Date) =>
  date.toLocaleString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
const validDate = (value: string | undefined) => {
  const date = value ? new Date(value) : undefined;
  return date && !Number.isNaN(date.getTime()) ? date : undefined;
};
// Angle brackets keep parentheses and spaces in a URL from ending the link.
const link = (label: string, url: string) => `[${label}](<${url.replace(/[<>\s]/g, encodeURIComponent)}>)`;

/** The inbox the email agent reads; links open in that account rather than the browser's first one. */
export function gmailLink(update: Pick<JobEmployerUpdate, 'gmailMessageId' | 'gmailThreadId'>): string | undefined {
  const id = update.gmailThreadId ?? update.gmailMessageId;
  if (!id) return undefined;
  const account = process.env.JOB_EMAIL_GMAIL_ACCOUNT?.trim();
  return account
    ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(account)}#all/${id}`
    : `https://mail.google.com/mail/u/0/#all/${id}`;
}

/**
 * The emails about the current assessment: the newest invitation that moved
 * the application into assessment, plus every later assessment reminder.
 */
function assessmentEmails(application: JobApplicationRecord): JobEmployerUpdate[] {
  const updates = [...(application.employerUpdates ?? [])].sort((first, second) =>
    first.receivedAt.localeCompare(second.receivedAt));
  const start = updates.findLastIndex((update) => update.stage === 'assessment');
  if (start === -1) return [];
  return updates
    .slice(start)
    .filter((update) => update.stage === 'assessment' || update.eventKind === 'assessment-reminder');
}

/** Later emails win: a reminder can carry a new deadline or the link. */
function latest<K extends keyof JobEmployerUpdate>(emails: JobEmployerUpdate[], key: K) {
  return emails.findLast((email) => email[key] !== undefined && email[key] !== '')?.[key];
}

export function buildAssessmentNotes(listing: AssessmentListing, application: JobApplicationRecord): string {
  const emails = assessmentEmails(application);
  const assessmentType = latest(emails, 'assessmentType');
  const provider = latest(emails, 'provider');
  const deadline = validDate(latest(emails, 'deadline'));
  const assessmentUrl = latest(emails, 'assessmentUrl');
  const invitation = emails[0];

  const facts = [
    assessmentUrl ? `- **Start the assessment:** ${link('open the OA', assessmentUrl)}` : '- **Start the assessment:** use the link in the invitation email',
    `- **Deadline:** ${deadline ? displayTime(deadline) : 'not stated in the email'}`,
    ...(assessmentType ? [`- **Type:** ${assessmentType}`] : []),
    ...(provider ? [`- **Platform:** ${provider}`] : []),
    `- **Role:** ${listing.positionTitle} at ${listing.company}`,
    ...(listing.link ? [`- **Posting:** ${link('job posting', listing.link)}`] : []),
    `- **Application:** ${link('open in Agentic Journal', `/jobs?application=${encodeURIComponent(listing.id)}`)}`,
    ...(application.submittedAt ? [`- **Applied:** ${displayTime(new Date(application.submittedAt))}`] : []),
    ...(invitation ? [`- **Invited:** ${displayTime(new Date(invitation.receivedAt))}`] : []),
  ];

  const emailLines = emails.flatMap((email) => {
    const gmail = gmailLink(email);
    const kind = email.eventKind === 'assessment-reminder' ? 'Reminder' : 'Invitation';
    const heading = [
      `**${kind}**`,
      email.subject ? `"${email.subject}"` : undefined,
      email.from ? `from ${email.from}` : undefined,
      displayTime(new Date(email.receivedAt)),
    ].filter(Boolean).join(' · ');
    return [
      `- ${heading}${gmail ? ` — ${link('open in Gmail', gmail)}` : ''}`,
      ...(email.summary ? [`  - ${email.summary}`] : []),
      ...(email.supportingParaphrase && email.supportingParaphrase !== email.summary
        ? [`  - ${email.supportingParaphrase}`]
        : []),
    ];
  });

  return [
    `Online assessment from **${listing.company}** for **${listing.positionTitle}**.`,
    '',
    ...facts,
    ...(emailLines.length > 0 ? ['', '**Emails**', '', ...emailLines] : []),
    '',
    ASSESSMENT_NOTES_MARKER,
  ].join('\n');
}

/** Regenerates the block above the marker; text below it (or notes with no marker) is kept. */
function mergeNotes(generated: string, existing: string | undefined): string {
  if (!existing) return generated;
  const at = existing.indexOf(ASSESSMENT_NOTES_MARKER);
  const userNotes = at === -1 ? existing : existing.slice(at + ASSESSMENT_NOTES_MARKER.length);
  return userNotes.trim() ? `${generated}\n\n${userNotes.trim()}` : generated;
}

function openAssessmentTask(application: JobApplicationRecord, tasks: Task[]): Task | undefined {
  const taskId = application.assessmentTask?.taskId;
  return taskId ? tasks.find((task) => task.id === taskId) : undefined;
}

/**
 * Adds an online assessment to the have-to-do backlog and puts it at the top
 * of Current. An application gets one open OA task at a time: while the last
 * one is still in General (not completed or removed), it is refreshed instead.
 * Returns true when a task was created.
 */
export function ensureAssessmentTask(
  application: JobApplicationRecord,
  listing: AssessmentListing,
  now: string,
): boolean {
  ensureCurrentSystemThroughToday();
  if (openAssessmentTask(application, readGeneralTasks(LIST_TYPE).tasks)) {
    syncAssessmentTask(application, listing);
    return false;
  }
  const general = readGeneralTasks(LIST_TYPE);
  const deadline = validDate(latest(assessmentEmails(application), 'deadline'));
  const task: Task = {
    id: randomUUID(),
    text: `Complete ${listing.company} OA (${listing.positionTitle})`,
    notesMarkdown: buildAssessmentNotes(listing, application),
    ...(deadline ? { dueDate: localDate(deadline) } : {}),
  };
  general.tasks.push(task);
  writeGeneralTasks(general, LIST_TYPE);
  if (task.dueDate) handleDueDateSetup(task.dueDate, LIST_TYPE, task);
  addTaskToCurrent(LIST_TYPE, task.id, 0);
  refreshActiveDailySnapshots();
  application.assessmentTask = { taskId: task.id, createdAt: now };
  return true;
}

/**
 * Brings an open OA task up to date with what the emails now say: notes, and
 * a due date once a deadline is known (a due date set by hand is kept).
 * Returns true when the task changed.
 */
export function syncAssessmentTask(application: JobApplicationRecord, listing: AssessmentListing): boolean {
  const general = readGeneralTasks(LIST_TYPE);
  const task = openAssessmentTask(application, general.tasks);
  if (!task) return false;
  const notes = mergeNotes(buildAssessmentNotes(listing, application), task.notesMarkdown);
  const deadline = validDate(latest(assessmentEmails(application), 'deadline'));
  const dueDate = task.dueDate ?? (deadline ? localDate(deadline) : undefined);
  if (notes === task.notesMarkdown && dueDate === task.dueDate) return false;
  const previous = { ...task };
  task.notesMarkdown = notes;
  if (dueDate) task.dueDate = dueDate;
  writeGeneralTasks(general, LIST_TYPE);
  if (task.dueDate && task.dueDate !== previous.dueDate) handleDueDateSetup(task.dueDate, LIST_TYPE, task, previous);
  refreshActiveDailySnapshots();
  return true;
}
