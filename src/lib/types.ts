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
  answeredAt?: string;
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

export interface JobApplicationSubmissionEvidence {
  url?: string;
  message?: string;
}

export interface JobApplicationRecord {
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
  submissionAttemptedAt?: string;
  submittedAt?: string;
  closedAt?: string;
  closedReason?: string;
  submissionEvidence?: JobApplicationSubmissionEvidence;
  createdAt: string;
  updatedAt: string;
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
}

export interface JobApplicationsStoreData {
  schemaVersion: 1;
  workerEnabled: boolean;
  enabledApplicationCategories: JobApplicationCategory[];
  applications: Record<string, JobApplicationRecord>;
  answerBank: JobApplicationAnswerBankEntry[];
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

export interface JobApplicationsViewData {
  schemaVersion: 1;
  workerEnabled: boolean;
  enabledApplicationCategories: JobApplicationCategory[];
  readiness: JobApplicationReadiness;
  counts: JobApplicationCounts;
  categoryCounts: JobApplicationCategoryCounts;
  eligibleBacklog: number;
  applications: Record<string, JobApplicationRecord>;
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
