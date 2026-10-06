export interface BookmarkSource {
  id: string;
  accountId: string;
  text: string;
  url: string;
  importedAt: string;
  publishedAt?: string;
  author: { id: string; name: string; username: string; avatar?: string };
  media: {
    type: string;
    url?: string;
    preview?: string;
    alt?: string;
    width?: number;
    height?: number;
  }[];
  links: { url: string; title?: string; description?: string; image?: string; domain: string }[];
  /** Position in X's bookmark order; higher means bookmarked more recently. */
  savedRank?: number;
}
export interface BookmarkAnnotation {
  favorite: boolean;
  read: boolean;
  tags: string[];
}
export type Bookmark = BookmarkSource &
  BookmarkAnnotation & { key: string; journalUrl: string; folders: string[] };
export interface BookmarkFolder {
  id: string;
  name: string;
  count: number;
}
/** Folder names and post membership from X; IDs are X post IDs. */
export interface BookmarkFolderStore {
  accountId?: string;
  syncedAt?: string;
  folders: { id: string; name: string }[];
  membership: Record<string, string[]>;
}
export const BOOKMARK_SORTS = [
  'saved',
  'saved-oldest',
  'posted',
  'posted-oldest',
  'author',
] as const;
export type BookmarkSort = (typeof BOOKMARK_SORTS)[number];
export interface SyncJob {
  id: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'cancelled';
  phase: 'recent' | 'history';
  cursor?: string;
  knownIds: string[];
  seenCursors?: string[];
  pages: number;
  imported: number;
  startedAt: string;
  updatedAt: string;
  reason?: string;
  cancelRequested?: boolean;
  scanComplete?: boolean;
  /** Ranks handed out to new bookmarks found ahead of the known ones. */
  rankTop?: number;
  rankUsed?: number;
}
export interface BookmarkState {
  version: 1;
  accountId?: string;
  username?: string;
  historyComplete: boolean;
  historyCursor?: string;
  budgetConfirmed: boolean;
  pilotComplete: boolean;
  pilotReviewed: boolean;
  job?: SyncJob;
  history: Omit<SyncJob, 'knownIds' | 'seenCursors'>[];
  usage: Record<string, number>;
  lastSyncAt?: string;
  lastConnectionError?: ConnectionFailure;
}
/** Sanitized: stage, HTTP status and an identifier-like X error code only. */
export interface ConnectionFailure {
  stage: string;
  status?: number;
  reason?: string;
  message: string;
  at: string;
}
export interface BookmarkStatus extends BookmarkState {
  configured: boolean;
  connected: boolean;
  total: number;
  estimate: number;
  monthlyLimit: number;
  callbackUrl: string;
  workerAvailable: boolean;
}
export interface BookmarkList {
  items: Bookmark[];
  total: number;
  tags: string[];
  nextOffset: number | null;
  folders: BookmarkFolder[];
  unsortedCount: number;
  collectionTotal: number;
  folderSyncedAt?: string;
}
