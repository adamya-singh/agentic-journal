// Shared types for task and journal systems

// ============ Task Types ============

export type ListType = 'have-to-do' | 'want-to-do';

export interface Task {
  id: string;
  text: string;
  notesMarkdown?: string;
  projects?: string[];
  parentTaskId?: string;
  parentTaskText?: string;
  childTasks?: Task[];
  dueDate?: string;
  dueTimeStart?: string;
  dueTimeEnd?: string;
  completed?: boolean;
  completedAt?: string;
  isDaily?: boolean;
}

export interface TasksData {
  _comment: string;
  tasks: Task[];
}

// ============ Project Roadmap Types ============

export type RoadmapCheckpointStatus = 'not-started' | 'in-progress' | 'completed';

export interface RoadmapTaskRef {
  taskId: string;
  listType: ListType;
}

export interface RoadmapCheckpoint {
  id: string;
  title: string;
  description?: string;
  status: RoadmapCheckpointStatus;
  tasks: RoadmapTaskRef[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRoadmap {
  project: string;
  goal: string;
  checkpoints: RoadmapCheckpoint[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRoadmapsData {
  _comment: string;
  schemaVersion: 1;
  roadmaps: Record<string, ProjectRoadmap>;
}

// ============ Project Preference Types ============

export interface ProjectPreferencesData {
  _comment: string;
  schemaVersion: 1;
  pinnedProjects: string[];
}

// ============ Job Listing Types ============

export type JobApplicationCategory =
  | 'fall-internship'
  | 'spring-internship'
  | 'summer-internship'
  | 'new-grad';
export type LegacyJobType = 'fall-coop' | 'spring-coop' | 'new-grad';
export type JobListingStatus = 'saved' | 'starred' | 'applied' | 'archived';

export interface JobListingSource {
  name: string;
  link: string;
}

export interface JobListingStatusHistoryEntry {
  status: JobListingStatus;
  changedAt: string;
}

export interface JobListing {
  id: string;
  company: string;
  companySummary: string;
  positionTitle: string;
  location: string;
  applicationCategories: JobApplicationCategory[];
  status: JobListingStatus;
  salary: string;
  link: string;
  source: JobListingSource;
  notes: string;
  postedDate?: string;
  postedDateText?: string;
  savedAt: string;
  statusHistory: JobListingStatusHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface JobListingsData {
  schemaVersion: 2;
  listings: JobListing[];
}

// ============ Job Application Types ============

export type JobApplicationStatus =
  | 'unstarted'
  | 'in-progress'
  | 'awaiting-user-input'
  | 'submitted'
  | 'closed';

export type JobApplicationResumeVariant = 'swe' | 'mle';
export type JobApplicationQuestionKind =
  | 'text'
  | 'single-select'
  | 'multi-select'
  | 'file'
  | 'action';
export type JobApplicationQuestionResolution = 'pending' | 'answered' | 'skipped' | 'auto-resolved';
export type JobApplicationAnswer = string | string[];

export interface JobApplicationQuestionOption {
  value: string;
  label: string;
}

export interface JobApplicationQuestionSuggestion {
  answer: JobApplicationAnswer;
  sourceAnswerId: string;
  confidence: number;
  category?: 'standard' | 'legal' | 'certification' | 'demographic';
}

export interface JobApplicationQuestion {
  employmentDateField?: 'start' | 'end';
  dateSource?: {
    experienceId: string;
    field: 'start' | 'end';
    value: string;
    attemptCount: number;
  };
  id: string;
  prompt: string;
  kind: JobApplicationQuestionKind;
  required: boolean;
  helpText?: string;
  pageUrl?: string;
  section?: string;
  options?: JobApplicationQuestionOption[];
  multiline?: boolean;
  answer?: JobApplicationAnswer;
  suggestion?: JobApplicationQuestionSuggestion;
  resolution: JobApplicationQuestionResolution;
  discoveredAt: string;
  /** Filled by the Journal from an answer Adamya already confirmed for the same question. */
  fromAnswerBank?: true;
  /** A "do this yourself" step the worker ran into more than once (kept as one question). */
  occurrences?: number;
  /** When that step was first run into, if it has happened more than once. */
  firstDiscoveredAt?: string;
  answeredAt?: string;
  generatedAnswer?: JobApplicationGeneratedAnswer;
  /** Set only by the human answer/review endpoints, never by a worker update. */
  eligibilityReviewedAnswer?: JobApplicationAnswer;
  /** Adamya asked OpenClaw to redraft this answer; its next draft needs explicit review. */
  redoRequest?: JobApplicationRedoRequest;
  /** Element screenshot of this question with its answer entered on the live form. */
  answerScreenshot?: JobApplicationQuestionScreenshot;
  /** View-time enrichment (never persisted): a matching saved answer from the bank. */
  bankMatch?: JobApplicationAnswerBankMatch;
}

export interface JobApplicationRedoRequest {
  instructions: string;
  previousAnswer: JobApplicationAnswer;
  requestedAt: string;
}

export interface JobApplicationQuestionScreenshot {
  id: string;
  attemptCount: number;
  capturedAt: string;
  width: number;
  height: number;
  byteSize: number;
}

export interface JobApplicationGeneratedAnswer {
  source: 'chatgpt-web';
  generatedAt: string;
  confidence: number;
  assumptions: string[];
  clarificationPrompt?: string;
  docAppend: {
    status: 'saved' | 'failed';
    entry: string;
    attemptedAt: string;
    error?: string;
  };
}

export interface JobApplicationAnswerBankMatch {
  entryId: string;
  answer: JobApplicationAnswer;
  prompt: string;
  tier: 'exact' | 'kind';
  /** false when a select-kind match's stored answer isn't among the new question's options. */
  usable: boolean;
  /** context: given for another job, a hint only (never filled in on its own). */
  scope: JobApplicationAnswerScope;
  context?: JobApplicationAnswerContext;
}

export interface JobApplicationStatusHistoryEntry {
  status: JobApplicationStatus;
  changedAt: string;
}

export interface JobApplicationLease {
  token: string;
  claimedAt: string;
  expiresAt: string;
}

export interface JobApplicationError {
  code: string;
  message: string;
  occurredAt: string;
  retryable: boolean;
}

/** One failed run, kept so Adamya can see why OpenClaw gave up. */
export interface JobApplicationErrorEvent {
  code: string;
  message: string;
  occurredAt: string;
  attempt: number;
  /** The worker reported it, or the Journal noticed a run that never reported back. */
  source: 'worker' | 'recovery';
  /** The worker's last progress report in that run. */
  lastStep?: string;
}

export interface JobApplicationSubmissionEvidence {
  url?: string;
  message?: string;
}

/** Where the employer says the application stands, learned from their emails. */
export type JobEmployerStage = 'received' | 'assessment' | 'interview' | 'offer' | 'rejected';

export type JobSimplifyTrackerStatus = 'Applied' | 'Screen' | 'Interviewing' | 'Offer' | 'Rejected';

export interface JobEmployerUpdate {
  enrichedAt?: string;
  eventKind?: 'stage-change' | 'assessment-reminder' | 'still-reviewing';
  assessmentType?: string;
  provider?: string;
  deadline?: string;
  deadlineWindow?: import('./assessment-deadline').AssessmentDeadlineWindow;
  interviewRound?: string;
  outcomeReason?: string;
  supportingParaphrase?: string;
  automation?: 'explicit' | 'unknown';
  assessmentUrl?: string;
  id: string;
  source: 'email' | 'manual';
  /** null records a manual reset back to plain "applied". */
  stage: JobEmployerStage | null;
  /** When the employer sent it (email) or when it was set by hand. */
  receivedAt: string;
  appliedAt: string;
  gmailMessageId?: string;
  /** All Gmail IDs folded into this event, including the primary ID. */
  emailMessageIds?: string[];
  gmailThreadId?: string;
  from?: string;
  subject?: string;
  summary?: string;
  confidence?: number;
}

/** An email OpenClaw could not confidently tie to one posting and stage. */
export interface JobEmailUpdateCandidate {
  enrichedAt?: string;
  details?: Partial<Pick<JobEmployerUpdate, 'eventKind' | 'assessmentType' | 'provider' | 'deadline' | 'deadlineWindow' | 'interviewRound' | 'outcomeReason' | 'supportingParaphrase' | 'automation' | 'assessmentUrl'>>;
  id: string;
  gmailMessageId: string;
  emailMessageIds?: string[];
  gmailThreadId?: string;
  receivedAt: string;
  from: string;
  subject: string;
  summary: string;
  suggestedStage?: JobEmployerStage;
  suggestedListingIds: string[];
  confidence: number;
  reason: string;
  createdAt: string;
}

export interface JobEmailUpdatesProcessedEntry {
  at: string;
  outcome: 'applied' | 'queued' | 'ignored';
  listingId?: string;
  /**
   * Handled while postings with an unconfirmed Submit were matchable. Older
   * set-aside emails get one more look, since they may settle one of those.
   */
  sawUnconfirmedSubmits?: true;
}

export interface JobEmailUpdatesState {
  enabled: boolean;
  lastPolledAt?: string;
  lastError?: { message: string; occurredAt: string };
  pending: JobEmailUpdateCandidate[];
  /** Gmail message ids already handled; the mailbox itself is never modified. */
  processed: Record<string, JobEmailUpdatesProcessedEntry>;
}

export type JobEmailUpdatesView = Omit<JobEmailUpdatesState, 'processed'>;

export interface JobApplicationSimplifySync {
  status: 'pending' | 'in-progress' | 'synced' | 'failed';
  /** Tracker column the card must end up in; absent means Applied. */
  targetStatus?: JobSimplifyTrackerStatus;
  attemptCount: number;
  updatedAt: string;
  nextRetryAt?: string;
  lease?: JobApplicationLease;
  cardId?: string;
  error?: string;
}

export interface JobApplicationScreenshot {
  id: string;
  pageNumber: number;
  segmentNumber: number;
  label: string;
  pageUrl?: string;
  capturedAt: string;
  contentType: 'image/png';
  byteSize: number;
}

export interface JobApplicationScreenshotCapture {
  id: string;
  attemptCount: number;
  startedAt: string;
  completedAt?: string;
  failedAt?: string;
  error?: string;
  screenshots: JobApplicationScreenshot[];
}

export interface JobApplicationRecord {
  submissionSnapshot?: import('./job-overview').SubmissionSnapshot;
  listingId: string;
  status: JobApplicationStatus;
  resumeVariant: JobApplicationResumeVariant;
  resumeOverride?: JobApplicationResumeVariant;
  canonicalApplicationUrl?: string;
  attemptCount: number;
  statusHistory: JobApplicationStatusHistoryEntry[];
  questions: JobApplicationQuestion[];
  lease?: JobApplicationLease;
  nextRetryAt?: string;
  resumeRequestedAt?: string;
  lastAttemptAt?: string;
  lastError?: JobApplicationError;
  /** Failed runs in a row; any real outcome or Adamya resuming it resets the count. */
  failureStreak?: number;
  /** The most recent failed runs, oldest first. */
  errorHistory?: JobApplicationErrorEvent[];
  submissionAttemptedAt?: string;
  submittedAt?: string;
  closedAt?: string;
  closedReason?: string;
  /** Human cancellation; closedReason records the explanation for OpenClaw. */
  cancelledAt?: string;
  submissionEvidence?: JobApplicationSubmissionEvidence;
  awaitingInputSince?: string;
  /** When autopilot may draft the remaining answers (awaitingInputSince + 24h). */
  autoCompleteEligibleAt?: string;
  /** Set while drafted answers wait in the review queue before submission. */
  reviewHoldSince?: string;
  /** Review deadline; stamped once, when the first draft enters the review queue. */
  autoSubmitEligibleAt?: string;
  simplifySync?: JobApplicationSimplifySync;
  employerStage?: JobEmployerStage;
  employerUpdates?: JobEmployerUpdate[];
  /** The journal task created when the employer sent an online assessment. */
  assessmentTask?: { taskId: string; createdAt: string; emailDueDate?: string };
  /** The journal task created when the employer invited Adamya to book an interview. */
  interviewTask?: { taskId: string; createdAt: string; gmailMessageId?: string };
  /** Live worker progress report; only meaningful while a lease is active. */
  progress?: JobApplicationProgress;
  screenshotCapture?: JobApplicationScreenshotCapture;
  incompleteScreenshotCapture?: JobApplicationScreenshotCapture;
  createdAt: string;
  updatedAt: string;
}

export interface JobApplicationReviewItem {
  id: string;
  listingId: string;
  questionId: string;
  question: string;
  answerUsed: JobApplicationAnswer;
  clarificationPrompt: string;
  confidence: number;
  company: string;
  role: string;
  createdAt: string;
  submittedAt?: string;
  status: 'pending' | 'confirmed' | 'corrected' | 'left-blank' | 'redo-requested' | 'dismissed';
  correctedAnswer?: JobApplicationAnswer;
  /** What Adamya told OpenClaw when this draft was sent back (status redo-requested). */
  redoInstructions?: string;
  /** Set on the draft OpenClaw wrote in response to a redo request. */
  redoneFrom?: Omit<JobApplicationRedoRequest, 'requestedAt'>;
  resolvedAt?: string;
  /** View-time enrichment (never persisted): the scope Confirm saves this answer with. */
  answerScope?: JobApplicationAnswerScope;
}

/**
 * general: Adamya's answer on every application (work authorization, contact
 * details). context: the answer he gave for one job ("How did you hear about
 * us?", "Why Notion?"), kept with that job and only ever a hint elsewhere.
 */
export type JobApplicationAnswerScope = 'general' | 'context';

export interface JobApplicationAnswerContext {
  company: string;
  role?: string;
}

export interface JobApplicationAnswerBankEntry {
  id: string;
  normalizedPrompt: string;
  prompt: string;
  kind: JobApplicationQuestionKind;
  optionsFingerprint?: string;
  answer: JobApplicationAnswer;
  confirmedAt: string;
  sourceListingId: string;
  scope: JobApplicationAnswerScope;
  /** Set when Adamya chose the scope himself rather than the Journal's default. */
  scopeSetBy?: 'adamya';
  /** The job the answer was given for. */
  context?: JobApplicationAnswerContext;
}

export interface JobApplicationsStoreData {
  schemaVersion: 3;
  autopilotMigrationAt?: string;
  workerEnabled: boolean;
  enabledApplicationCategories: JobApplicationCategory[];
  applications: Record<string, JobApplicationRecord>;
  answerBank: JobApplicationAnswerBankEntry[];
  reviewItems: JobApplicationReviewItem[];
  emailUpdates: JobEmailUpdatesState;
}

export interface JobApplicationReadiness {
  ready: boolean;
  resumeDirectory: string;
  missingFiles: string[];
}

export interface JobApplicationCounts {
  unstarted: number;
  inProgress: number;
  awaitingInput: number;
  submitted: number;
  closed: number;
}

export type JobApplicationCategoryCounts = Record<JobApplicationCategory, number>;

export interface JobApplicationProgress {
  step: string;
  label: string;
  detail?: string;
  updatedAt: string;
}

export interface JobApplicationQueuePreviewEntry {
  listingId: string;
  rank: number;
  reason: 'resume-requested' | 'starred' | 'saved';
}

export interface JobApplicationsViewData {
  schemaVersion: 2;
  workerEnabled: boolean;
  enabledApplicationCategories: JobApplicationCategory[];
  readiness: JobApplicationReadiness;
  counts: JobApplicationCounts;
  categoryCounts: JobApplicationCategoryCounts;
  eligibleBacklog: number;
  applications: Record<string, JobApplicationRecord>;
  answerBank: JobApplicationAnswerBankEntry[];
  reviewItems: JobApplicationReviewItem[];
  emailUpdates: JobEmailUpdatesView;
  schedulerHealth: {
    healthy: boolean;
    jobFound: boolean;
    enabled: boolean;
    error?: string;
  };
  queuePreview: JobApplicationQueuePreviewEntry[];
}

// ============ Journal Entry Types ============

/**
 * planned = intention/schedule
 * logged = what actually happened
 */
export type EntryMode = 'planned' | 'logged';
export type PlanStatus = 'active' | 'missed' | 'rescheduled' | 'completed' | 'canceled';

export interface PlanLogRef {
  date: string;
  hour?: string;
  range?: {
    start: string;
    end: string;
  };
}

export interface OmiTranscriptSourceRef {
  source: 'omi-transcript';
  transcriptDate: string;
  segmentId: string;
  startedAt?: string | null;
  endedAt?: string | null;
  transcriptHash: string;
  confidence: number;
  runId: string;
}

export type JournalSourceRef = OmiTranscriptSourceRef;

/**
 * A journal entry that references a task by ID.
 */
export interface TaskJournalEntry {
  taskId: string;
  listType: ListType;
  entryMode: EntryMode;
  journalEntryId?: string;
  sourceRefs?: JournalSourceRef[];
  autoPlannedFromDueTime?: true;
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A journal entry with free-form text (not linked to a task).
 */
export interface TextJournalEntry {
  text: string;
  entryMode: EntryMode;
  journalEntryId?: string;
  sourceRefs?: JournalSourceRef[];
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A journal entry can be:
 * - TaskJournalEntry: references a task by ID
 * - TextJournalEntry: free-form text
 * - string: legacy plain text (backward compatibility)
 */
export type JournalEntry = TaskJournalEntry | TextJournalEntry | string;

/**
 * A day's journal hour slot can be:
 * - A single JournalEntry (backward compatible)
 * - An array of JournalEntry (for multiple tasks per hour)
 */
export type JournalHourSlot = JournalEntry | JournalEntry[];

/**
 * A day's journal mapping hours to entries (single or multiple per hour)
 */
export type DayJournal = Record<string, JournalHourSlot>;

// ============ Resolved Journal Entry (for display) ============

/**
 * A resolved journal entry with all display information.
 */
export interface ResolvedJournalEntry {
  hour: string;
  text: string;
  type: 'task' | 'text';
  entryMode: EntryMode;
  journalEntryId?: string;
  sourceRefs?: JournalSourceRef[];
  planId?: string;
  planStatus?: PlanStatus;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  missedAt?: string;
  taskId?: string;
  listType?: ListType;
  parentTaskId?: string;
  parentTaskText?: string;
  completed?: boolean;
}

// ============ Range Entry Types ============

/**
 * A text-based journal range entry spanning multiple hours.
 */
export interface TextJournalRangeEntry {
  start: string; // e.g., "12pm"
  end: string; // e.g., "2pm"
  text: string;
  entryMode: EntryMode;
  journalEntryId?: string;
  sourceRefs?: JournalSourceRef[];
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A task-based journal range entry spanning multiple hours.
 */
export interface TaskJournalRangeEntry {
  start: string;
  end: string;
  taskId: string;
  listType: ListType;
  entryMode: EntryMode;
  journalEntryId?: string;
  sourceRefs?: JournalSourceRef[];
  autoPlannedFromDueTime?: true;
  planId?: string;
  planStatus?: PlanStatus;
  planCreatedAt?: string;
  planUpdatedAt?: string;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  completedByLogRef?: PlanLogRef;
  missedAt?: string;
}

/**
 * A journal range entry can be text-based or task-based.
 */
export type JournalRangeEntry = TextJournalRangeEntry | TaskJournalRangeEntry;

/**
 * A resolved journal range entry with all display information.
 */
export interface ResolvedJournalRangeEntry {
  start: string;
  end: string;
  text: string;
  type: 'task' | 'text';
  entryMode: EntryMode;
  journalEntryId?: string;
  sourceRefs?: JournalSourceRef[];
  planId?: string;
  planStatus?: PlanStatus;
  replannedToPlanId?: string;
  replannedFromPlanId?: string;
  missedAt?: string;
  taskId?: string;
  listType?: ListType;
  parentTaskId?: string;
  parentTaskText?: string;
  completed?: boolean;
}

// ============ Staged Entry Types ============

/**
 * A staged task entry - a task that is due on this day but not yet scheduled to a specific time.
 * These appear in the "staging area" / "unscheduled" section of the day.
 */
export interface StagedTaskEntry {
  taskId: string;
  listType: ListType;
}

/**
 * A resolved staged entry with all display information.
 */
export interface ResolvedStagedEntry {
  text: string;
  taskId: string;
  listType: ListType;
  parentTaskId?: string;
  parentTaskText?: string;
  completed?: boolean;
}

// ============ Type Guards ============

export function isTaskJournalEntry(entry: JournalEntry): entry is TaskJournalEntry {
  return typeof entry === 'object' && entry !== null && 'taskId' in entry && 'listType' in entry;
}

export function isTextJournalEntry(entry: JournalEntry): entry is TextJournalEntry {
  return typeof entry === 'object' && entry !== null && 'text' in entry && !('taskId' in entry);
}

export function isLegacyJournalStringEntry(entry: JournalEntry): entry is string {
  return typeof entry === 'string';
}

export function isTaskJournalRangeEntry(entry: JournalRangeEntry): entry is TaskJournalRangeEntry {
  return 'taskId' in entry && 'listType' in entry;
}

export function isTextJournalRangeEntry(entry: JournalRangeEntry): entry is TextJournalRangeEntry {
  return 'text' in entry && !('taskId' in entry);
}

export function isStagedTaskEntry(entry: StagedTaskEntry): entry is StagedTaskEntry {
  return (
    typeof entry === 'object' &&
    entry !== null &&
    'taskId' in entry &&
    'listType' in entry &&
    !('start' in entry)
  );
}

/**
 * Check if an hour slot contains multiple entries (is an array).
 */
export function isJournalEntryArray(
  slot: JournalHourSlot | null | undefined,
): slot is JournalEntry[] {
  return Array.isArray(slot);
}
