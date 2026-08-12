import type { ListType, Task } from '@/lib/types';

/** Where a capture can land: the two General backlogs, or the unclassified fallback. */
export type CaptureListType = ListType | 'misc-notes';

export interface CaptureClassification {
  listType: ListType;
  projects: string[];
  dueDate?: string;
  isDaily?: boolean;
  cleanedText?: string;
}

export interface CaptureResponse {
  success: boolean;
  taskId?: string;
  task?: Task;
  listType?: CaptureListType;
  projects?: string[];
  dueDate?: string;
  isDaily?: boolean;
  /** false when classification failed and the capture fell back to misc-notes. */
  classified?: boolean;
  /** Present when the model rewrote the fragment; the original is kept in task notes. */
  cleanedText?: string;
  /** true when an OpenClaw agent prioritization request was recorded for this capture. */
  prioritizationRequested?: boolean;
  error?: string;
}
