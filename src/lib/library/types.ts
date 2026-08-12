import type { ListType } from '@/lib/types';

export interface LibraryTaskRow {
  id: string;
  source: 'general' | 'misc' | 'completed';
  listType: ListType | 'misc-notes';
  text: string;
  completed: boolean;
  completedAt?: string;
  sourceDate?: string;
  dueDate?: string;
  dueTimeStart?: string;
  dueTimeEnd?: string;
  notesMarkdown?: string;
  projects?: string[];
  parentTaskId?: string;
  isDaily?: boolean;
  currentRank?: number;
}

export interface LibraryJournalUnit {
  date: string;
  hour?: string;
  range?: { start: string; end: string };
  entryMode: 'planned' | 'logged';
  planStatus?: string;
  completed?: boolean;
  text: string;
  taskId?: string;
  listType?: ListType;
  omiRefs?: Array<{ transcriptDate: string; segmentId: string }>;
}

export interface LibraryListResponse {
  success: boolean;
  tasks: LibraryTaskRow[];
  journal: LibraryJournalUnit[];
  projects: string[];
  generatedAt: string;
  error?: string;
}
