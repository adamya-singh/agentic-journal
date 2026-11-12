export type AcquisitionState =
  | 'wanted'
  | 'searching'
  | 'downloading'
  | 'importing'
  | 'ready'
  | 'paused'
  | 'attention';
export interface AcquiredItem {
  key: string;
  itemId: string;
  path: string;
}
export interface Acquisition {
  id: string;
  title: string;
  kind: 'film' | 'series';
  seasons: number[];
  wanted: boolean;
  revision: number;
  managerId?: number;
  status: AcquisitionState;
  progress?: number;
  note?: string;
  items: AcquiredItem[];
  attempts: number;
  retryAt?: string;
  searchedRevision?: number;
  searchedAt?: string;
  updatedAt: string;
}
export interface StorageStatus {
  available: boolean;
  usedBytes: number;
  freeBytes: number;
  reservedBytes: number;
  budgetBytes: number;
  minimumFreeBytes: number;
  paused: boolean;
  note?: string;
}
export interface AcquisitionStore {
  version: 1;
  migrated?: boolean;
  requests: Record<string, Acquisition>;
  metadata?: Record<string, MetadataRequest>;
  workerAt?: string;
  guardAt?: string;
  storage?: StorageStatus;
  services?: Record<string, { ok: boolean; note?: string }>;
}
export interface MetadataRequest {
  hash: string;
  magnet: string;
  category: string;
  savePath: string;
  requestId: string;
  revision: number;
  startedAt: number;
  retryAt?: number;
  preparing: boolean;
}
export const ACQUISITION_LABELS: Record<AcquisitionState, string> = {
  wanted: 'Wanted',
  searching: 'Searching',
  downloading: 'Downloading',
  importing: 'Importing',
  ready: 'Ready',
  paused: 'Paused',
  attention: 'Needs attention',
};
